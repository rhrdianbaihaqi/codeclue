import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { outline } from "../src/commands/outline";

const mini = (rel: string): string =>
  fileURLToPath(new URL(`./fixtures/mini/${rel}`, import.meta.url));

const quiet = { warn: () => {} };

describe("import yang tidak dipakai", () => {
  const text = outline(mini("src/pruning.ts"), quiet).outline;

  it("import tanpa binding dipertahankan", () => {
    expect(text).toContain('import "./types";');
  });

  it("default import tak terpakai dibuang, named yang terpakai bertahan", () => {
    expect(text).not.toContain("defaultUtil");
    expect(text).toContain('beta as renamed');
  });

  it("named import yang hanya dipakai di body dibuang", () => {
    expect(text).not.toMatch(/\bgamma\b/);
  });

  it("named import yang dipakai di luar body bertahan (juga lewat deklarasi lain)", () => {
    expect(text).toMatch(/import \{[^}]*\balpha\b[^}]*\} from "\.\/util"/);
  });

  it("type import dipangkas sebagian", () => {
    expect(text).toContain('import type { User } from "@/types";');
    expect(text).not.toContain("Id }");
  });

  it("namespace import yang dipakai di tipe bertahan", () => {
    expect(text).toContain('import * as everything from "./util";');
  });

  it("deklarasi yang seluruh bindingnya tak terpakai dihapus utuh", () => {
    expect(text).not.toContain('"./client"');
    expect(text).not.toMatch(/\n\n\n/);
  });

  it("outline tetap lebih kecil dan body hilang", () => {
    expect(text).not.toContain("alpha() + gamma()");
    expect(text).toContain("export function run(user: User, fn: typeof renamed): number");
  });
});

describe("JSDoc @deprecated", () => {
  const text = outline(mini("src/pruning.ts"), quiet).outline;

  it("bertahan bersama kalimat pertama, kalimat kedua dibuang", () => {
    expect(text).toContain("/** Ringkasan. @deprecated Pakai yang baru saja. */");
    expect(text).not.toContain("Kalimat kedua");
  });
});

describe("fixture repo mini", () => {
  it("circular import: kedua sisi di-outline tanpa crash dan import dipertahankan", () => {
    const a = outline(mini("src/a.ts"), quiet).outline;
    const b = outline(mini("src/b.ts"), quiet).outline;
    expect(a).toContain('import { b } from "./b";');
    expect(b).toContain('import { a } from "./a";');
    expect(b).not.toContain("User");
  });

  it("alias @/ dikenali lewat tsconfig fixture tanpa peringatan", () => {
    const warnings: string[] = [];
    const result = outline(mini("src/a.ts"), { warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
    expect(result.outline).toContain('import type { User } from "@/types";');
  });

  it("barrel export * dan re-export default tidak diubah", () => {
    const text = outline(mini("src/index.ts"), quiet).outline;
    expect(text).toContain('export * from "./a";');
    expect(text).toContain('export * from "./b";');
    expect(text).toContain('export { default as Client } from "./client";');
  });
});
