import { fileURLToPath } from "node:url";
import { Project, ts } from "ts-morph";
import { beforeAll, describe, expect, it } from "vitest";
import { outline } from "../src/commands/outline";
import type { OutlineResult } from "../src/commands/outline";

const FIXTURE = fileURLToPath(new URL("./fixtures/sample.ts", import.meta.url));

let result: OutlineResult;
let text: string;

beforeAll(() => {
  result = outline(FIXTURE);
  text = result.outline;
});

describe("signature bertahan utuh", () => {
  it("fungsi async lengkap dengan tipe kembalian", () => {
    expect(text).toContain("export async function fetchUser(id: string): Promise<User>");
  });

  it("generic dengan constraint", () => {
    expect(text).toContain("export function pick<T, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K>");
  });

  it("kedua baris overload", () => {
    expect(text).toContain("export function parse(input: string): number;");
    expect(text).toContain("export function parse(input: number): number;");
    expect(text).toContain("export function parse(input: string | number): number");
  });

  it("class generic, constructor, getter, dan method", () => {
    expect(text).toContain("export class Repo<T extends { id: string }>");
    expect(text).toContain("constructor(private readonly label: string)");
    expect(text).toContain("get size(): number");
    expect(text).toContain("async save(item: T): Promise<void>");
  });

  it("default export", () => {
    expect(text).toContain("export default class Client");
    expect(text).toContain("request(path: string): Promise<Response>");
  });

  it("arrow function", () => {
    expect(text).toContain("export const toSlug = (text: string): string");
    expect(text).toContain("export const double = (n: number): number => n * 2;");
  });
});

describe("tipe tidak berubah", () => {
  it("interface tetap lengkap dengan anggotanya", () => {
    expect(text).toContain("export interface User");
    expect(text).toContain("id: string;");
    expect(text).toContain("name: string;");
  });

  it("type alias union tetap utuh", () => {
    expect(text).toContain(
      "export type Result<T> = { ok: true; value: T } | { ok: false; error: string };",
    );
  });

  it("field class tetap ada", () => {
    expect(text).toContain("private readonly items = new Map<string, T>();");
  });
});

describe("body hilang", () => {
  it.each([
    ["await res.json()", "isi fungsi async"],
    ["text.toLowerCase()", "isi arrow function"],
    ["this.items.set(item.id, item)", "isi method"],
    ["this.items.clear()", "isi constructor"],
    ["return this.items.size", "isi getter"],
    ["out[key] = obj[key]", "isi fungsi generic"],
    ["return fetch(path)", "isi method default export"],
  ])("%s tidak ada lagi (%s)", (needle) => {
    expect(text).not.toContain(needle);
  });

  it("komentar internal ikut hilang", () => {
    expect(text).not.toContain("komentar internal");
  });

  it("body diganti penanda yang seragam", () => {
    expect(text.match(/\{ \/\* \.\.\. \*\/ \}/g)?.length).toBeGreaterThanOrEqual(7);
  });
});

describe("JSDoc", () => {
  it("baris pertama bertahan", () => {
    expect(text).toContain("/** Ambil satu user dari API. */");
    expect(text).toContain("/** Modul contoh untuk menguji outline. */");
  });

  it("baris lanjutan dibuang", () => {
    expect(text).not.toContain("hanya baris pertama yang bertahan");
  });

  it("kalimat yang melintasi dua baris tidak terpotong di tengah", () => {
    expect(text).toContain(
      "/** Gabungkan dua daftar sambil membuang duplikat berdasarkan kunci yang diberikan. */",
    );
    expect(text).not.toContain("Kalimat kedua ini harus hilang");
  });
});

describe("hasil tetap TypeScript yang sah", () => {
  it("tidak ada error sintaksis saat outline di-parse ulang", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("outline.ts", text);
    const errors = sf
      .getPreEmitDiagnostics()
      .filter((d) => d.getCategory() === ts.DiagnosticCategory.Error)
      .filter((d) => d.getCode() >= 1000 && d.getCode() < 2000);
    expect(errors.map((d) => d.getMessageText())).toEqual([]);
  });
});

describe("hitungan token", () => {
  it("outline lebih ringan dari aslinya", () => {
    expect(result.outlineTokens).toBeLessThan(result.originalTokens);
  });

  it("savedPercent konsisten dengan kedua angka", () => {
    const expected = Math.round(
      ((result.originalTokens - result.outlineTokens) / result.originalTokens) * 100,
    );
    expect(result.savedPercent).toBe(expected);
    expect(result.savedPercent).toBeGreaterThan(0);
  });

  it("file menunjuk ke path yang diminta", () => {
    expect(result.file).toBe(FIXTURE);
  });
});

describe("error", () => {
  it("file tidak ada -> ENOENT", () => {
    expect(() => outline("tidak/ada/file.ts")).toThrowError(/File tidak ditemukan/);
  });

  it("direktori -> EISDIR", () => {
    expect(() => outline(fileURLToPath(new URL("./fixtures", import.meta.url)))).toThrowError(
      /adalah direktori/,
    );
  });
});
