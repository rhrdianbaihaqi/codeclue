import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { estimateTokens } from "../lib/count";
import { CliError } from "../lib/errors";
import { isIgnored, parseGitignore } from "../lib/gitignore";
import type { IgnoreMatcher } from "../lib/gitignore";

export interface SurveyOptions {
  /** Basis path relatif pada keluaran. Default: process.cwd(). */
  cwd?: string;
  /** Ke mana peringatan non-fatal dikirim. Default: stderr. */
  warn?: (message: string) => void;
}

export interface SurveyFile {
  path: string;
  tokens: number;
  /** Persen dari total token repo. */
  percent: number;
}

export interface IgnoreSuggestion {
  /** Pola bergaya .gitignore, mis. `dist/` atau `package-lock.json`. */
  pattern: string;
  reason: string;
  files: number;
  tokens: number;
  percent: number;
}

export interface SurveyResult {
  dir: string;
  /** `git` = daftar file dari git (hormati semua aturan ignore); `walk` = pindai sendiri + .gitignore. */
  source: "git" | "walk";
  totals: { files: number; tokens: number; binarySkipped: number };
  top: SurveyFile[];
  suggestions: IgnoreSuggestion[];
  /** Total token yang hilang kalau semua saran diterapkan. */
  suggestedSavings: { tokens: number; percent: number };
}

export const TOP_N = 20;

const DIR_RULES: Record<string, string> = {
  dist: "build output",
  coverage: "test coverage report",
  ".next": "build output",
  ".nuxt": "build output",
  ".turbo": "tool cache",
  ".cache": "tool cache",
  __snapshots__: "test snapshots",
  __generated__: "generated code",
  generated: "generated code",
};

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "go.sum",
]);

const FILE_PATTERN_RULES: { test: RegExp; pattern: string; reason: string }[] = [
  { test: /\.min\.(js|css)$/, pattern: "*.min.*", reason: "minified bundle" },
  { test: /\.map$/, pattern: "*.map", reason: "source map" },
  { test: /\.snap$/, pattern: "*.snap", reason: "test snapshot" },
  { test: /\.generated\.[^.]+$/, pattern: "*.generated.*", reason: "generated code" },
  { test: /\.gen\.[^.]+$/, pattern: "*.gen.*", reason: "generated code" },
];

/** Satu file → paling banyak satu saran. Direktori didahulukan dari nama file. */
export function suggestIgnore(relPath: string): { pattern: string; reason: string } | null {
  const segments = relPath.split("/");
  for (const segment of segments.slice(0, -1)) {
    const reason = DIR_RULES[segment];
    if (reason !== undefined) return { pattern: `${segment}/`, reason };
  }
  const name = segments[segments.length - 1]!;
  if (LOCKFILES.has(name)) return { pattern: name, reason: "lockfile" };
  for (const rule of FILE_PATTERN_RULES) {
    if (rule.test.test(name)) return { pattern: rule.pattern, reason: rule.reason };
  }
  return null;
}

/** Jangan pernah menelusuri node_modules atau .git, apa pun isi .gitignore. */
function isAlwaysSkipped(relPath: string): boolean {
  return relPath.split("/").some((segment) => segment === "node_modules" || segment === ".git");
}

function listWithGit(root: string): string[] | null {
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [...new Set(out.toString("utf8").split("\0").filter((p) => p !== ""))];
  } catch {
    return null;
  }
}

function listByWalking(root: string): string[] {
  const files: string[] = [];

  const visit = (dir: string, rel: string, matchers: IgnoreMatcher[]): void => {
    const gitignore = join(dir, ".gitignore");
    const active = existsSync(gitignore)
      ? [...matchers, parseGitignore(readFileSync(gitignore, "utf8"), rel)]
      : matchers;

    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (isAlwaysSkipped(entryRel) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!isIgnored(active, entryRel, true)) visit(join(dir, entry.name), entryRel, active);
      } else if (entry.isFile() && !isIgnored(active, entryRel, false)) {
        files.push(entryRel);
      }
    }
  };

  visit(root, "", []);
  return files;
}

const pct = (part: number, whole: number): number => (whole <= 0 ? 0 : Math.round((part / whole) * 100));

export function survey(dir = ".", options: SurveyOptions = {}): SurveyResult {
  const cwd = options.cwd ?? process.cwd();
  const warn = options.warn ?? ((message: string) => void process.stderr.write(`${message}\n`));
  const root = resolve(cwd, dir);

  let stat;
  try {
    stat = statSync(root);
  } catch {
    throw new CliError("ENOENT", `Directory not found: ${dir}`);
  }
  if (!stat.isDirectory()) {
    throw new CliError("ENOTDIR", `${dir} is a file, not a directory. For one file try: clue outline ${dir}`);
  }

  const gitFiles = listWithGit(root);
  const source = gitFiles === null ? "walk" : "git";
  const paths = (gitFiles ?? listByWalking(root)).filter((p) => !isAlwaysSkipped(p)).sort();

  const sizes: SurveyFile[] = [];
  const buckets = new Map<string, IgnoreSuggestion>();
  let total = 0;
  let binarySkipped = 0;

  for (const path of paths) {
    const abs = join(root, path.split("/").join(sep));
    let buffer: Buffer;
    try {
      // File yang tercatat di git tapi sudah terhapus, symlink, atau submodule: lewati.
      const lstat = lstatSync(abs);
      if (!lstat.isFile()) continue;
      buffer = readFileSync(abs);
    } catch {
      warn(`Skipped unreadable file: ${path}`);
      continue;
    }
    if (buffer.subarray(0, 8000).includes(0)) {
      binarySkipped++;
      continue;
    }

    const tokens = estimateTokens(buffer.toString("utf8"));
    total += tokens;
    sizes.push({ path, tokens, percent: 0 });

    const hint = suggestIgnore(path);
    if (hint !== null) {
      const bucket = buckets.get(hint.pattern) ?? { ...hint, files: 0, tokens: 0, percent: 0 };
      bucket.files++;
      bucket.tokens += tokens;
      buckets.set(hint.pattern, bucket);
    }
  }

  const top = sizes
    .sort((a, b) => b.tokens - a.tokens || (a.path < b.path ? -1 : 1))
    .slice(0, TOP_N)
    .map((f) => ({ ...f, percent: pct(f.tokens, total) }));

  const suggestions = [...buckets.values()]
    .sort((a, b) => b.tokens - a.tokens || (a.pattern < b.pattern ? -1 : 1))
    .map((s) => ({ ...s, percent: pct(s.tokens, total) }));
  const savedTokens = suggestions.reduce((sum, s) => sum + s.tokens, 0);

  return {
    dir: relative(cwd, root) || ".",
    source,
    totals: { files: sizes.length, tokens: total, binarySkipped },
    top,
    suggestions,
    suggestedSavings: { tokens: savedTokens, percent: pct(savedTokens, total) },
  };
}

function table(headers: string[], rows: string[][], leftCols: number[]): string[] {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const fmt = (cells: string[]): string =>
    cells
      .map((c, i) => (leftCols.includes(i) ? c.padEnd(widths[i]!) : c.padStart(widths[i]!)))
      .join("  ")
      .trimEnd();
  return [fmt(headers), ...rows.map(fmt)];
}

/** Tabel rapi untuk stdout. Angka token selalu diawali `~` karena hanya estimasi. */
export function formatSurvey(result: SurveyResult): string {
  const { totals } = result;
  const lines: string[] = [`${result.dir}: ${totals.files} files, ~${totals.tokens} tokens`];

  if (result.top.length > 0) {
    lines.push("", `Top ${result.top.length} files by tokens`);
    lines.push(
      ...table(
        ["tokens", "%", "path"],
        result.top.map((f) => [`~${f.tokens}`, `${f.percent}%`, f.path]),
        [2],
      ),
    );
  }

  if (result.suggestions.length > 0) {
    const s = result.suggestedSavings;
    lines.push("", `Suggested ignores (would drop ~${s.tokens} tokens, ${s.percent}%)`);
    lines.push(
      ...table(
        ["pattern", "files", "tokens", "%", "reason"],
        result.suggestions.map((x) => [x.pattern, String(x.files), `~${x.tokens}`, `${x.percent}%`, x.reason]),
        [0, 4],
      ),
    );
  } else if (totals.files > 0) {
    lines.push("", "Suggested ignores: none");
  }

  return lines.join("\n");
}
