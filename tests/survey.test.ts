import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOP_N, formatSurvey, suggestIgnore, survey } from "../src/commands/survey";
import { isIgnored, parseGitignore } from "../src/lib/gitignore";
import { run } from "../src/run";

const FIXTURE = fileURLToPath(new URL("./fixtures/survey", import.meta.url));
const quiet = { warn: () => {} };

function makeTree(files: Record<string, string | Buffer>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "clue-survey-")));
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const paths = (r: ReturnType<typeof survey>): string[] => r.top.map((f) => f.path);

describe("survey (fixture)", () => {
  const result = survey(FIXTURE, { ...quiet, cwd: FIXTURE });

  it("menghitung semua file teks dan total token", () => {
    expect(result.totals.files).toBe(4);
    expect(result.totals.binarySkipped).toBe(0);
    expect(result.totals.tokens).toBe(result.top.reduce((sum, f) => sum + f.tokens, 0));
  });

  it("top terurut menurun menurut token; persen sesuai total", () => {
    const tokens = result.top.map((f) => f.tokens);
    expect(tokens).toEqual([...tokens].sort((a, b) => b - a));
    expect(paths(result)).toContain("src/big.ts");
    expect(result.top.reduce((s, f) => s + f.percent, 0)).toBeGreaterThanOrEqual(99);
  });

  it("menyarankan lockfile dan snapshot, bukan source", () => {
    const patterns = result.suggestions.map((s) => s.pattern);
    expect(patterns).toContain("package-lock.json");
    expect(patterns).toContain("__snapshots__/");
    expect(patterns).not.toContain("src/");
    expect(result.suggestions.find((s) => s.pattern === "package-lock.json")?.reason).toBe("lockfile");
    const sum = result.suggestions.reduce((s, x) => s + x.tokens, 0);
    expect(result.suggestedSavings.tokens).toBe(sum);
  });

  it("deterministik", () => {
    expect(survey(FIXTURE, { ...quiet, cwd: FIXTURE })).toEqual(result);
  });

  it("format: tabel dengan angka berawalan ~", () => {
    const text = formatSurvey(result);
    expect(text).toMatch(/^\.: 4 files, ~\d+ tokens/);
    expect(text).toContain("Top 4 files by tokens");
    expect(text).toMatch(/~\d+\s+\d+%\s+src\/big\.ts/);
    expect(text).toContain("Suggested ignores");
    expect(text).toContain("package-lock.json");
  });
});

describe("survey (pindai tanpa git, hormati .gitignore)", () => {
  const root = makeTree({
    ".gitignore": "ignored.txt\nbuild-cache/\n*.log\n/rootonly.md\n!keep.log\nsub/*.tmp\n",
    "src/a.ts": "export const a = 1;\n",
    "ignored.txt": "x".repeat(4000),
    "build-cache/x.js": "y".repeat(4000),
    "debug.log": "z".repeat(4000),
    "keep.log": "keep",
    "rootonly.md": "r".repeat(400),
    "docs/rootonly.md": "d",
    "sub/a.tmp": "t".repeat(400),
    "sub/a.keep": "k",
    "dist/out.js": "o".repeat(800),
    "node_modules/pkg/index.js": "n".repeat(8000),
    "sub/node_modules/deep.js": "n".repeat(8000),
  });
  const result = survey(root, { ...quiet, cwd: root });

  it("memakai jalur walk di luar repo git", () => {
    expect(result.source).toBe("walk");
  });

  it("membuang yang diabaikan dan tidak pernah masuk node_modules", () => {
    const all = paths(result).sort();
    expect(all).toEqual([".gitignore", "dist/out.js", "docs/rootonly.md", "keep.log", "src/a.ts", "sub/a.keep"].sort());
  });

  it("menyarankan dist/ yang belum diabaikan", () => {
    expect(result.suggestions.map((s) => s.pattern)).toEqual(["dist/"]);
  });

  it("menghormati .gitignore bersarang", () => {
    const nested = makeTree({ "a/.gitignore": "secret.txt\n", "a/secret.txt": "s", "a/open.txt": "o", "secret.txt": "top" });
    expect(paths(survey(nested, { ...quiet, cwd: nested })).sort()).toEqual(["a/.gitignore", "a/open.txt", "secret.txt"]);
  });
});

describe("survey (git)", () => {
  it("memakai git ls-files: tracked + untracked, tanpa yang diabaikan", () => {
    const root = makeTree({
      ".gitignore": "secret.txt\n",
      "src/a.ts": "export const a = 1;\n",
      "secret.txt": "s".repeat(4000),
      "yarn.lock": "l".repeat(400),
    });
    try {
      execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
    } catch {
      return; // git tidak tersedia di lingkungan ini
    }
    execFileSync("git", ["add", "src/a.ts"], { cwd: root, stdio: "ignore" });
    const result = survey(root, { ...quiet, cwd: root });
    expect(result.source).toBe("git");
    expect(paths(result).sort()).toEqual([".gitignore", "src/a.ts", "yarn.lock"]);
    expect(result.suggestions.map((s) => s.pattern)).toEqual(["yarn.lock"]);
  });
});

describe("survey (kasus tepi)", () => {
  it("melewati file biner dan menghitungnya", () => {
    const root = makeTree({ "a.ts": "export {};\n", "img.png": Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]) });
    const r = survey(root, { ...quiet, cwd: root });
    expect(r.totals).toMatchObject({ files: 1, binarySkipped: 1 });
  });

  it("membatasi top ke 20 file", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) files[`f${String(i).padStart(2, "0")}.ts`] = "x".repeat(40 + i);
    const root = makeTree(files);
    const r = survey(root, { ...quiet, cwd: root });
    expect(TOP_N).toBe(20);
    expect(r.top).toHaveLength(20);
    expect(r.totals.files).toBe(30);
    expect(r.top[0]?.path).toBe("f29.ts");
  });

  it("direktori kosong: nol file, tanpa crash", () => {
    const root = makeTree({});
    const r = survey(root, { ...quiet, cwd: root });
    expect(r.totals).toEqual({ files: 0, tokens: 0, binarySkipped: 0 });
    expect(r.top).toEqual([]);
    expect(formatSurvey(r)).toBe(".: 0 files, ~0 tokens");
  });

  it("default dir = cwd; dir dilaporkan relatif ke cwd", () => {
    const root = makeTree({ "pkg/a.ts": "export {};\n" });
    expect(survey(undefined, { ...quiet, cwd: root }).dir).toBe(".");
    expect(survey("pkg", { ...quiet, cwd: root }).dir).toBe("pkg");
  });

  it("error jelas: tidak ada / bukan direktori", () => {
    const root = makeTree({ "a.ts": "x" });
    expect(() => survey("nope", { ...quiet, cwd: root })).toThrow(/Directory not found: nope/);
    expect(() => survey("a.ts", { ...quiet, cwd: root })).toThrow(/is a file, not a directory/);
  });
});

describe("suggestIgnore", () => {
  it.each([
    ["package-lock.json", "package-lock.json"],
    ["packages/x/yarn.lock", "yarn.lock"],
    ["pnpm-lock.yaml", "pnpm-lock.yaml"],
    ["dist/a.js", "dist/"],
    ["packages/x/coverage/lcov.info", "coverage/"],
    ["src/__snapshots__/a.snap", "__snapshots__/"],
    ["src/a.test.ts.snap", "*.snap"],
    ["public/app.min.js", "*.min.*"],
    ["lib/a.js.map", "*.map"],
    ["src/api.generated.ts", "*.generated.*"],
    ["src/route.gen.ts", "*.gen.*"],
  ])("%s -> %s", (path, pattern) => {
    expect(suggestIgnore(path)?.pattern).toBe(pattern);
  });

  it("kalau ragu, pertahankan: source biasa tidak disarankan", () => {
    expect(suggestIgnore("src/index.ts")).toBeNull();
    expect(suggestIgnore("src/distance.ts")).toBeNull();
    expect(suggestIgnore("build/script.ts")).toBeNull();
    expect(suggestIgnore("types/api.d.ts")).toBeNull();
  });
});

describe("gitignore matcher", () => {
  const m = (text: string, base = "") => [parseGitignore(text, base)];

  it("pola tanpa slash cocok di kedalaman mana pun; ber-anchor hanya di base", () => {
    expect(isIgnored(m("a.txt"), "x/y/a.txt", false)).toBe(true);
    expect(isIgnored(m("/a.txt"), "x/a.txt", false)).toBe(false);
    expect(isIgnored(m("/a.txt"), "a.txt", false)).toBe(true);
    expect(isIgnored(m("x/a.txt"), "x/a.txt", false)).toBe(true);
    expect(isIgnored(m("x/a.txt"), "y/x/a.txt", false)).toBe(false);
  });

  it("dir-only, negasi, ** dan komentar", () => {
    expect(isIgnored(m("out/"), "out", true)).toBe(true);
    expect(isIgnored(m("out/"), "out", false)).toBe(false);
    expect(isIgnored(m("*.log\n!keep.log"), "keep.log", false)).toBe(false);
    expect(isIgnored(m("a/**/z.txt"), "a/b/c/z.txt", false)).toBe(true);
    expect(isIgnored(m("a/**/z.txt"), "a/z.txt", false)).toBe(true);
    expect(isIgnored(m("# comment\n\n"), "# comment", false)).toBe(false);
  });

  it(".gitignore bersarang dievaluasi relatif ke basenya", () => {
    const matchers = [parseGitignore("*.tmp", ""), parseGitignore("/only.txt", "sub")];
    expect(isIgnored(matchers, "sub/only.txt", false)).toBe(true);
    expect(isIgnored(matchers, "sub/deep/only.txt", false)).toBe(false);
    expect(isIgnored(matchers, "sub/x.tmp", false)).toBe(true);
  });
});

describe("clue survey (CLI)", () => {
  const capture = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { stdout: (t: string) => void out.push(t), stderr: (t: string) => void err.push(t) } };
  };

  it("--json: envelope standar dengan data survey", () => {
    const { out, io } = capture();
    expect(run(["survey", FIXTURE, "--json"], io)).toBe(0);
    const env = JSON.parse(out.join(""));
    expect(env).toMatchObject({ ok: true, command: "survey", contract: 1, error: null });
    expect(env.data.totals.files).toBe(4);
    expect(env.data.top.length).toBeGreaterThan(0);
    expect(env.data.suggestions.length).toBeGreaterThan(0);
  });

  it("mode manusia: tabel ke stdout, ringkasan ke stderr", () => {
    const { out, err, io } = capture();
    expect(run(["survey", FIXTURE], io)).toBe(0);
    expect(out.join("")).toContain("Top 4 files by tokens");
    expect(out.join("")).not.toContain("ignore suggestions could drop");
    expect(err.join("")).toContain("ignore suggestions could drop");
  });

  it("error: direktori tidak ada -> ENOENT di envelope", () => {
    const { out, io } = capture();
    expect(run(["survey", "/no/such/dir/anywhere", "--json"], io)).toBe(1);
    const env = JSON.parse(out.join(""));
    expect(env).toMatchObject({ ok: false, data: null, error: { code: "ENOENT" } });
  });

  it("--help menyebut survey", () => {
    const { out, io } = capture();
    run(["--help"], io);
    expect(out.join("")).toContain("survey [dir]");
  });
});
