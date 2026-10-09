import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { outline } from "../src/commands/outline";
import { createProject, findTsConfig } from "../src/lib/project";

const FIXTURE = fileURLToPath(new URL("./fixtures/sample.ts", import.meta.url));

describe("findTsConfig", () => {
  it("menemukan tsconfig repo dengan menelusuri ke atas", () => {
    const found = findTsConfig(FIXTURE);
    expect(found).toBeDefined();
    expect(found?.endsWith("tsconfig.json")).toBe(true);
  });

  it("mengembalikan undefined kalau tidak ada tsconfig sampai root", () => {
    const dir = mkdtempSync(join(tmpdir(), "clue-notsconfig-"));
    const file = join(dir, "lone.ts");
    writeFileSync(file, "export const x = 1;\n");
    expect(findTsConfig(file)).toBeUndefined();
  });
});

describe("fallback tanpa tsconfig", () => {
  it("tetap menghasilkan outline, tidak crash, dan memberi peringatan", () => {
    const dir = mkdtempSync(join(tmpdir(), "clue-notsconfig-"));
    const file = join(dir, "lone.ts");
    writeFileSync(file, "export function hi(name: string): string {\n  return `hai ${name}`;\n}\n");

    const warnings: string[] = [];
    const result = outline(file, { warn: (m) => warnings.push(m) });

    expect(result.outline).toContain("export function hi(name: string): string");
    expect(result.outline).not.toContain("hai ${name}");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no tsconfig\.json found/);
  });

  it("tidak memberi peringatan saat tsconfig ada", () => {
    const warnings: string[] = [];
    outline(FIXTURE, { warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
  });
});

describe("tsconfig rusak", () => {
  it("fallback ke default dengan peringatan yang menyebut file tsconfig", () => {
    const dir = mkdtempSync(join(tmpdir(), "clue-badtsconfig-"));
    writeFileSync(join(dir, "tsconfig.json"), "{ bad");
    const file = join(dir, "a.ts");
    writeFileSync(file, "export function f(): number {\n  return 1;\n}\n");

    const warnings: string[] = [];
    const result = outline(file, { warn: (m) => warnings.push(m) });

    expect(result.outline).toContain("export function f(): number");
    expect(result.outline).not.toContain("return 1");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Cannot read .*tsconfig\.json/);
    expect(warnings[0]).toMatch(/falling back to defaults/);
  });

  it("createProject melempar ETSCONFIG", () => {
    const dir = mkdtempSync(join(tmpdir(), "clue-badtsconfig-"));
    const tsconfig = join(dir, "tsconfig.json");
    writeFileSync(tsconfig, "{ bad");
    expect(() => createProject(tsconfig)).toThrow(expect.objectContaining({ code: "ETSCONFIG" }));
  });
});
