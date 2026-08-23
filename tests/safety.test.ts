import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { outline } from "../src/commands/outline";

const FIXTURE = fileURLToPath(new URL("./fixtures/sample.ts", import.meta.url));
const SRC = fileURLToPath(new URL("../src", import.meta.url));

const sha256 = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

/** Komentar dilucuti dulu supaya kalimat seperti "tidak ada .save() di sini"
 *  tidak ikut tertangkap sebagai pelanggaran. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("outline tidak pernah menulis ke disk", () => {
  it("isi file sumber identik sebelum dan sesudah", () => {
    const before = sha256(FIXTURE);
    outline(FIXTURE);
    expect(sha256(FIXTURE)).toBe(before);
  });

  it("tetap identik setelah dijalankan berkali-kali", () => {
    const before = sha256(FIXTURE);
    for (let i = 0; i < 5; i++) outline(FIXTURE);
    expect(sha256(FIXTURE)).toBe(before);
  });

  it("mtime tidak bergeser", () => {
    const before = statSync(FIXTURE).mtimeMs;
    outline(FIXTURE);
    expect(statSync(FIXTURE).mtimeMs).toBe(before);
  });

  it("tidak ada file baru yang muncul di sekitarnya", () => {
    const dir = fileURLToPath(new URL("./fixtures", import.meta.url));
    const before = readdirSync(dir).sort();
    outline(FIXTURE);
    expect(readdirSync(dir).sort()).toEqual(before);
  });
});

describe("tidak ada jalur tulis di kode sumber", () => {
  it.each([
    [/\.saveSync\s*\(/, ".saveSync()"],
    [/\.save\s*\(/, ".save()"],
    [/\.emitSync\s*\(/, ".emitSync()"],
    [/\.emit\s*\(/, ".emit()"],
    [/writeFileSync|writeFile\s*\(/, "penulisan file langsung"],
  ])("src/ tidak memanggil %s", (pattern) => {
    const offenders = walk(SRC)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => pattern.test(stripComments(readFileSync(f, "utf8"))));
    expect(offenders).toEqual([]);
  });
});
