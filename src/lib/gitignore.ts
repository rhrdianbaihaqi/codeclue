/**
 * Pencocok `.gitignore` minimal untuk jalur tanpa git (lihat `survey`).
 * Mendukung: komentar, negasi `!`, pola ber-anchor (`/x`, `a/b`), pola khusus
 * direktori (`x/`), dan glob `*`, `?`, `**`. Kelas karakter `[...]` dianggap
 * literal. Kalau git tersedia, `survey` memakai git sendiri dan tidak lewat sini.
 */

interface Rule {
  regex: RegExp;
  negated: boolean;
  dirOnly: boolean;
}

export interface IgnoreMatcher {
  /** Direktori tempat `.gitignore` ini berada, relatif ke root pindaian ("" = root). */
  base: string;
  rules: Rule[];
}

function globToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return out;
}

export function parseGitignore(content: string, base: string): IgnoreMatcher {
  const rules: Rule[] = [];
  for (const raw of content.split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)\s+$/, "");
    if (line === "" || line.startsWith("#")) continue;

    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    }
    if (line.startsWith("\\")) line = line.slice(1);

    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (line === "") continue;

    const anchored = line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);

    const body = globToRegex(line);
    rules.push({ regex: new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`), negated, dirOnly });
  }
  return { base, rules };
}

/** Apakah `relPath` (relatif ke root pindaian) diabaikan? Matcher diurut dari terluar ke terdalam. */
export function isIgnored(matchers: IgnoreMatcher[], relPath: string, isDir: boolean): boolean {
  let ignored = false;
  for (const matcher of matchers) {
    const local = matcher.base === "" ? relPath : relPath.slice(matcher.base.length + 1);
    for (const rule of matcher.rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.regex.test(local)) ignored = !rule.negated;
    }
  }
  return ignored;
}
