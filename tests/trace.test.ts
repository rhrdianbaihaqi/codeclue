import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FAN_IN_PROMOTE,
  OUTLINE_DEMOTE_MIN_TOKENS,
  classify,
  formatTrace,
  isGeneratedFile,
  shouldDemoteOutline,
  trace,
} from "../src/commands/trace";
import type { ClassifyInput, TraceResult } from "../src/commands/trace";
import { formatExports, listExports } from "../src/lib/exports";
import { createProject } from "../src/lib/project";

const MINI = fileURLToPath(new URL("./fixtures/mini", import.meta.url));
const quiet = { warn: () => {}, cwd: MINI };

const layerOf = (r: TraceResult, path: string): string | undefined =>
  r.files.find((f) => f.path === path)?.layer;

describe("classify", () => {
  const base: ClassifyInput = {
    depth: 1,
    maxDepth: 2,
    fanIn: 1,
    isEntry: false,
    isTest: false,
    isDeclaration: false,
    isGenerated: false,
    parsable: true,
  };

  it("tabel dasar: 0 utuh, 1 outline, 2 export, 3+ path", () => {
    expect(classify({ ...base, isEntry: true, depth: 0 }).layer).toBe("full");
    expect(classify({ ...base, depth: 1 }).layer).toBe("outline");
    expect(classify({ ...base, depth: 2 }).layer).toBe("exports");
    expect(classify({ ...base, depth: 3, maxDepth: 5 }).layer).toBe("path");
  });

  it("di luar --depth selalu path", () => {
    expect(classify({ ...base, depth: 3, maxDepth: 2 }).layer).toBe("path");
    expect(classify({ ...base, depth: 1, maxDepth: 0 }).layer).toBe("path");
  });

  it("fan-in tinggi naik satu lapis tapi tidak sampai full", () => {
    const hub = { fanIn: FAN_IN_PROMOTE };
    expect(classify({ ...base, ...hub, depth: 2 })).toEqual({ layer: "outline", reasons: [expect.stringMatching(/fan-in/)] });
    expect(classify({ ...base, ...hub, depth: 1 }).layer).toBe("outline");
    expect(classify({ ...base, fanIn: FAN_IN_PROMOTE - 1, depth: 2 }).layer).toBe("exports");
  });

  it("test jadi path; .d.ts dan generated turun satu lapis", () => {
    expect(classify({ ...base, isTest: true }).layer).toBe("path");
    expect(classify({ ...base, isDeclaration: true }).layer).toBe("exports");
    expect(classify({ ...base, isGenerated: true }).layer).toBe("exports");
    expect(classify({ ...base, isGenerated: true, depth: 2 }).layer).toBe("path");
  });

  it("entry tidak pernah bergeser, walau file test", () => {
    expect(classify({ ...base, isEntry: true, depth: 0, isTest: true }).layer).toBe("full");
  });

  it("bukan sumber TS/JS selalu path", () => {
    expect(classify({ ...base, parsable: false }).layer).toBe("path");
  });

  it("deteksi generated lewat path dan header", () => {
    expect(isGeneratedFile("src/generated/x.ts", "")).toBe(true);
    expect(isGeneratedFile("src/schema.generated.ts", "")).toBe(true);
    expect(isGeneratedFile("src/x.ts", "// @generated\n")).toBe(true);
    expect(isGeneratedFile("src/x.ts", "export const a = 1;")).toBe(false);
  });
});

describe("trace --outline-entry", () => {
  const entry = join(MINI, "src/main.ts");
  const normal = trace(entry, { ...quiet, depth: 1 });
  const outlined = trace(entry, { ...quiet, depth: 1, outlineEntry: true });

  it("classify: entry jadi outline hanya bila diminta; non-entry tidak terpengaruh", () => {
    const base: ClassifyInput = {
      depth: 0, maxDepth: 2, fanIn: 0, isEntry: true, isTest: false, isDeclaration: false, isGenerated: false, parsable: true,
    };
    expect(classify(base).layer).toBe("full");
    expect(classify({ ...base, outlineEntry: true }).layer).toBe("outline");
    expect(classify({ ...base, isEntry: false, depth: 1, outlineEntry: true }).layer).toBe("outline");
  });

  it("entry tampil sebagai outline dan lapis lain tidak berubah", () => {
    expect(layerOf(outlined, "src/main.ts")).toBe("outline");
    expect(formatTrace(outlined)).toContain("### src/main.ts [entry · outline]");
    const others = (r: TraceResult) => r.files.filter((f) => f.depth > 0).map((f) => [f.path, f.layer]);
    expect(others(outlined)).toEqual(others(normal));
  });

  it("outline entry tidak lebih besar dari entry utuh", () => {
    const tokens = (r: TraceResult) => r.files.find((f) => f.depth === 0)!.tokens;
    expect(tokens(outlined)).toBeLessThanOrEqual(tokens(normal));
  });
});

describe("trace: fixture mini", () => {
  const r = trace(join(MINI, "src/main.ts"), { ...quiet, depth: 2 });

  it("entry utuh, depth 1 outline, depth 2 dengan fan-in tinggi naik jadi outline", () => {
    expect(layerOf(r, "src/main.ts")).toBe("full");
    expect(layerOf(r, "src/c.ts")).toBe("outline");
    expect(layerOf(r, "src/types.ts")).toBe("outline");
    expect(r.files.find((f) => f.path === "src/types.ts")?.reasons.join()).toMatch(/fan-in 3/);
  });

  it("test jadi path saja; .d.ts dan generated turun jadi daftar export", () => {
    expect(layerOf(r, "src/widget.test.ts")).toBe("path");
    expect(layerOf(r, "src/api.d.ts")).toBe("exports");
    expect(layerOf(r, "src/generated/schema.ts")).toBe("exports");
  });

  it("isi tiap lapis: body hilang di outline, export tercatat, path tanpa isi", () => {
    const content = (p: string): string => r.files.find((f) => f.path === p)!.content;
    expect(content("src/main.ts")).toContain("widgetTest();");
    expect(content("src/c.ts")).toContain("export function c(user: User): string { /* ... */ }");
    expect(content("src/c.ts")).not.toContain("user.name");
    expect(content("src/api.d.ts")).toBe("interface: Api\nfunction: createApi");
    expect(content("src/widget.test.ts")).toBe("");
  });

  it("totals konsisten: fullTokens = jumlah file utuh, traceTokens = token teks keluaran", () => {
    const sum = r.files.reduce((n, f) => n + f.originalTokens, 0);
    expect(r.totals.fullTokens).toBe(sum);
    expect(r.totals.files).toBe(r.files.length);
    expect(r.totals.traceTokens).toBe(Math.ceil(formatTrace(r).length / 4));
  });

  it("teks keluaran: header per file, bagian path only, tanpa angka totals", () => {
    const text = formatTrace(r);
    expect(text).toMatch(/^# trace src\/main\.ts \(depth 2\)/);
    expect(text).toContain("### src/main.ts [entry · full]");
    expect(text).toContain("### path only\nsrc/widget.test.ts  (test file)");
    expect(text).not.toMatch(/saved/);
  });

  it("keluaran deterministik", () => {
    const again = trace(join(MINI, "src/main.ts"), { ...quiet, depth: 2 });
    expect(JSON.stringify(again)).toBe(JSON.stringify(r));
  });
});

describe("trace: batas kedalaman", () => {
  it("depth 0: hanya entry utuh, sisanya path", () => {
    const r = trace(join(MINI, "src/main.ts"), { ...quiet, depth: 0 });
    expect(layerOf(r, "src/main.ts")).toBe("full");
    expect(layerOf(r, "src/c.ts")).toBe("path");
    expect(r.files.every((f) => f.depth <= 1)).toBe(true);
  });

  it("node satu tingkat di luar --depth tampil sebagai path (tahu ada yang di luar batas)", () => {
    const r = trace(join(MINI, "src/index.ts"), { ...quiet, depth: 1 });
    expect(layerOf(r, "src/types.ts")).toBe("path");
  });
});

describe("trace: eksternal, rusak, siklus diteruskan dari graph", () => {
  it("circular import tidak looping", () => {
    const r = trace(join(MINI, "src/a.ts"), { ...quiet, depth: 5 });
    expect(r.cycles).toEqual([["src/a.ts", "src/b.ts"]]);
    expect(formatTrace(r)).toContain("### cycles\nsrc/a.ts <-> src/b.ts");
  });

  it("external dan unresolved muncul di teks", () => {
    const text = formatTrace(trace(join(MINI, "src/broken.ts"), { ...quiet, depth: 1 }));
    expect(text).toContain("### external\nleft-pad, node:fs");
    expect(text).toContain("./missing  <- src/broken.ts");
  });
});

describe("trace: input", () => {
  it("peringatan tsconfig tidak dobel", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "clue-trace-")));
    writeFileSync(join(dir, "a.ts"), 'import { b } from "./b";\nexport const a = b;\n');
    writeFileSync(join(dir, "b.ts"), "export const b = 1;\n");
    const warnings: string[] = [];
    trace(join(dir, "a.ts"), { cwd: dir, depth: 1, warn: (m) => warnings.push(m) });
    expect(warnings.filter((w) => /no tsconfig/.test(w))).toHaveLength(1);
  });

  it("file tidak ada dan depth tidak valid", () => {
    expect(() => trace(join(MINI, "nope.ts"), quiet)).toThrow(/File not found/);
    expect(() => trace(join(MINI, "src/a.ts"), { ...quiet, depth: -1 })).toThrow(/non-negative/);
  });
});

describe("listExports", () => {
  const exportsOf = (code: string): string => {
    const project = createProject();
    const sf = project.createSourceFile("x.ts", code);
    return formatExports(listExports(sf));
  };

  it("deklarasi, variabel, overload (sekali), dan default", () => {
    expect(
      exportsOf(
        [
          "export function f(a: string): void;",
          "export function f(a: number): void;",
          "export function f(a: any): void {}",
          "export class K {}",
          "export interface I {}",
          "export type T = string;",
          "export enum E { A }",
          "export const x = 1, y = 2;",
          "export default function () {}",
          "function hidden() {}",
        ].join("\n"),
      ),
    ).toBe(
      ["function: f, default", "class: K", "interface: I", "type: T", "enum: E", "const: x, y"].join("\n"),
    );
  });

  it("re-export dan export bernama dengan alias", () => {
    expect(
      exportsOf(
        [
          'export * from "./a";',
          'export * as ns from "./b";',
          'export { c as cc } from "./c";',
          "const local = 1;",
          "export { local as renamed };",
          'export type { Q } from "./q";',
        ].join("\n"),
      ),
    ).toBe(
      ['reexport: * from "./a", cc from "./c"', 'namespace: ns from "./b"', "named: renamed", 'type: Q from "./q"'].join(
        "\n",
      ),
    );
  });
});

describe("trace: aset non-TS", () => {
  it("tampil sebagai path saja dengan alasan", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "clue-trace-asset-")));
    writeFileSync(join(dir, "App.svelte"), "<script></script>\n");
    writeFileSync(join(dir, "main.ts"), 'import App from "./App.svelte";\nexport { App };\n');
    const r = trace(join(dir, "main.ts"), { cwd: dir, warn: () => {} });
    const app = r.files.find((f) => f.path === "App.svelte");
    expect(app).toMatchObject({ layer: "path", content: "" });
    expect(app?.reasons).toContain("not a TS/JS source");
  });
});

describe("trace: outline yang nyaris tidak menghemat", () => {
  const typeOnly = Array.from(
    { length: 200 },
    (_, i) => `export interface Shape${i} {\n  id: string;\n  value: number;\n  tags: string[];\n}\n`,
  ).join("\n");
  const logic = (n: number): string =>
    Array.from({ length: n }, (_, i) => `export function f${i}(a: number): number {\n  const x = a * ${i};\n  return x + a - ${i};\n}\n`).join("\n");

  it("shouldDemoteOutline: besar dan hemat <30% -> turun; kecil atau hemat banyak -> tetap", () => {
    expect(shouldDemoteOutline(OUTLINE_DEMOTE_MIN_TOKENS, OUTLINE_DEMOTE_MIN_TOKENS)).toBe(true);
    expect(shouldDemoteOutline(OUTLINE_DEMOTE_MIN_TOKENS - 1, OUTLINE_DEMOTE_MIN_TOKENS - 1)).toBe(false);
    expect(shouldDemoteOutline(5000, 5000 * 0.71)).toBe(true);
    expect(shouldDemoteOutline(5000, 5000 * 0.69)).toBe(false);
    expect(shouldDemoteOutline(5000, 1000)).toBe(false);
  });

  it("tetangga murni tipe yang besar turun ke exports dengan alasan yang terlihat", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "clue-trace-types-")));
    writeFileSync(join(dir, "types.ts"), typeOnly);
    writeFileSync(join(dir, "main.ts"), 'import type { Shape1 } from "./types";\nexport const x: Shape1 | undefined = undefined;\n');
    const r = trace(join(dir, "main.ts"), { cwd: dir, warn: () => {} });
    const types = r.files.find((f) => f.path === "types.ts")!;
    expect(types.layer).toBe("exports");
    expect(types.tokens).toBeLessThan(types.originalTokens / 2);
    expect(types.reasons.join(" ")).toMatch(/outline saves \d+% of ~\d+ tokens, exports only; see: clue outline types\.ts/);
    expect(types.exports?.length).toBe(200);
    const text = formatTrace(r);
    expect(text).toMatch(/### types\.ts \[exports · outline saves/);
    expect(text).toContain("interface: Shape0, Shape1");
  });

  it("file besar yang punya body tetap outline (outline menghemat banyak)", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "clue-trace-logic-")));
    writeFileSync(join(dir, "logic.ts"), logic(150));
    writeFileSync(join(dir, "main.ts"), 'import { f1 } from "./logic";\nexport const x = f1(1);\n');
    const logicFile = trace(join(dir, "main.ts"), { cwd: dir, warn: () => {} }).files.find((f) => f.path === "logic.ts")!;
    expect(logicFile.originalTokens).toBeGreaterThanOrEqual(OUTLINE_DEMOTE_MIN_TOKENS);
    expect(logicFile.layer).toBe("outline");
    expect(logicFile.reasons).toEqual([]);
  });

  it("file tipe yang kecil tetap outline (kalau ragu, pertahankan)", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "clue-trace-small-")));
    writeFileSync(join(dir, "types.ts"), "export interface A {\n  id: string;\n}\n");
    writeFileSync(join(dir, "main.ts"), 'import type { A } from "./types";\nexport const a: A | undefined = undefined;\n');
    const r = trace(join(dir, "main.ts"), { cwd: dir, warn: () => {} });
    expect(r.files.find((f) => f.path === "types.ts")?.layer).toBe("outline");
  });

  it("totals memakai teks hasil demosi; JSON tetap berbentuk sama", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "clue-trace-totals-")));
    writeFileSync(join(dir, "types.ts"), typeOnly);
    writeFileSync(join(dir, "main.ts"), 'import type { Shape1 } from "./types";\nexport const x: Shape1 | undefined = undefined;\n');
    const r = trace(join(dir, "main.ts"), { cwd: dir, warn: () => {} });
    expect(r.totals.traceTokens).toBeLessThan(r.totals.fullTokens / 2);
    expect(Object.keys(r.files[0]!).sort()).toEqual(
      ["content", "depth", "fanIn", "layer", "originalTokens", "path", "reasons", "tokens"].sort(),
    );
  });
});
