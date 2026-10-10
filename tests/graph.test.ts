import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatGraph, graph } from "../src/commands/graph";
import { extractSpecifiers, packageName } from "../src/lib/resolve";

const MINI = fileURLToPath(new URL("./fixtures/mini", import.meta.url));
const quiet = { warn: () => {}, cwd: MINI };

const paths = (r: ReturnType<typeof graph>): string[] => r.nodes.map((n) => n.path);

describe("graph: kedalaman", () => {
  it("depth 0: hanya entry", () => {
    const r = graph(join(MINI, "src/index.ts"), { ...quiet, depth: 0 });
    expect(paths(r)).toEqual(["src/index.ts"]);
    expect(r.edges).toEqual([]);
  });

  it("depth 1: import langsung (export * dan re-export default ikut dihitung)", () => {
    const r = graph(join(MINI, "src/index.ts"), { ...quiet, depth: 1 });
    expect(paths(r)).toEqual(["src/index.ts", "src/a.ts", "src/b.ts", "src/client.ts"]);
    expect(r.nodes.every((n) => n.depth <= 1)).toBe(true);
  });

  it("depth 2: alias @/ ke types.ts ditemukan", () => {
    const r = graph(join(MINI, "src/index.ts"), { ...quiet, depth: 2 });
    const types = r.nodes.find((n) => n.path === "src/types.ts");
    expect(types).toMatchObject({ depth: 2, importedBy: ["src/a.ts", "src/b.ts"] });
  });

  it("default depth 2", () => {
    expect(graph(join(MINI, "src/index.ts"), quiet).depth).toBe(2);
  });
});

describe("graph: circular import", () => {
  it("tidak looping, dilaporkan di cycles, tiap node muncul sekali", () => {
    const r = graph(join(MINI, "src/a.ts"), { ...quiet, depth: 10 });
    expect(r.cycles).toEqual([["src/a.ts", "src/b.ts"]]);
    expect(new Set(paths(r)).size).toBe(r.nodes.length);
    expect(r.nodes.find((n) => n.path === "src/a.ts")?.importedBy).toEqual(["src/b.ts"]);
  });

  it("self-import terdeteksi sebagai siklus", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "clue-self-")));
    writeFileSync(join(dir, "self.ts"), 'import { x } from "./self";\nexport const x = 1;\n');
    const r = graph(join(dir, "self.ts"), { warn: () => {}, cwd: dir, depth: 5 });
    expect(r.cycles).toEqual([["self.ts"]]);
  });
});

describe("graph: eksternal dan rusak", () => {
  const r = graph(join(MINI, "src/broken.ts"), { ...quiet, depth: 1 });

  it("bare import dan node: dicatat sebagai eksternal, bukan node", () => {
    expect(r.external.map((e) => e.name)).toEqual(["left-pad", "node:fs"]);
    expect(r.external[0]?.importedBy).toEqual(["src/broken.ts"]);
  });

  it("relatif dan alias yang tidak ketemu masuk unresolved", () => {
    expect(r.unresolved).toEqual([
      { from: "src/broken.ts", specifier: "./missing" },
      { from: "src/broken.ts", specifier: "@/missing" },
    ]);
  });
});

describe("graph: tidak pernah masuk node_modules", () => {
  it("paket terpasang dilaporkan eksternal dan isinya tidak ditelusuri", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "clue-nm-")));
    mkdirSync(join(dir, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules/pkg/package.json"), '{"name":"pkg","main":"index.js"}');
    writeFileSync(join(dir, "node_modules/pkg/index.js"), 'require("./deep");\n');
    writeFileSync(join(dir, "node_modules/pkg/deep.js"), "module.exports = 1;\n");
    writeFileSync(join(dir, "entry.ts"), 'import pkg from "pkg";\nexport default pkg;\n');

    const r = graph(join(dir, "entry.ts"), { warn: () => {}, cwd: dir, depth: 5 });
    expect(r.external).toEqual([{ name: "pkg", importedBy: ["entry.ts"] }]);
    expect(paths(r)).toEqual(["entry.ts"]);
    expect(JSON.stringify(r)).not.toContain("deep");
  });
});

describe("graph: input dan keluaran", () => {
  it("keluaran deterministik", () => {
    const run = () => JSON.stringify(graph(join(MINI, "src/index.ts"), { ...quiet, depth: 3 }));
    expect(run()).toBe(run());
  });

  it("depth tidak valid ditolak", () => {
    expect(() => graph(join(MINI, "src/a.ts"), { ...quiet, depth: -1 })).toThrow(/non-negative/);
    expect(() => graph(join(MINI, "src/a.ts"), { ...quiet, depth: 1.5 })).toThrow(/non-negative/);
  });

  it("file tidak ada dan ekstensi tak didukung", () => {
    expect(() => graph(join(MINI, "nope.ts"), quiet)).toThrow(/File not found/);
    expect(() => graph(join(MINI, "tsconfig.json"), quiet)).toThrow(/Unsupported/);
  });

  it("formatGraph memuat entry, kedalaman, dan siklus", () => {
    const text = formatGraph(graph(join(MINI, "src/a.ts"), { ...quiet, depth: 2 }));
    expect(text).toContain("src/a.ts (entry, depth 2)");
    expect(text).toContain("depth 1");
    expect(text).toContain("src/a.ts <-> src/b.ts");
  });
});

describe("resolve helpers", () => {
  it("packageName", () => {
    expect(packageName("@scope/pkg/sub")).toBe("@scope/pkg");
    expect(packageName("pkg/sub/deep")).toBe("pkg");
    expect(packageName("node:fs")).toBe("node:fs");
  });

  it("extractSpecifiers: import, export-from, dynamic import, require, type import", () => {
    const text = [
      'import a from "./a";',
      'import type { T } from "./types";',
      'export * from "./b";',
      'export { c } from "./c";',
      'const d = await import("./d");',
      'const e = require("./e");',
      'import "./a";',
    ].join("\n");
    expect(extractSpecifiers(text).sort()).toEqual(["./a", "./b", "./c", "./d", "./e", "./types"]);
  });
});
