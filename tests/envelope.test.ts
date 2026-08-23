import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTRACT, fail, ok } from "../src/envelope";
import { VERSION } from "../src/version";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("VERSION", () => {
  it("tidak boleh melenceng dari package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });
});

describe("ok()", () => {
  it("menghasilkan envelope sukses sesuai kontrak", () => {
    expect(ok("version", { name: "codeclue" })).toEqual({
      ok: true,
      command: "version",
      version: VERSION,
      contract: 1,
      data: { name: "codeclue" },
      error: null,
    });
  });

  it("meneruskan data apa adanya", () => {
    const data = { files: ["a.ts"], tokens: 42 };
    expect(ok("trace", data).data).toBe(data);
  });

  it("menerima data falsy tanpa mengubahnya jadi null", () => {
    expect(ok("survey", 0).data).toBe(0);
    expect(ok("survey", false).data).toBe(false);
    expect(ok("survey", "").data).toBe("");
  });
});

describe("fail()", () => {
  it("menghasilkan envelope gagal sesuai kontrak", () => {
    expect(fail("outline", "ENOENT", "File tidak ditemukan")).toEqual({
      ok: false,
      command: "outline",
      version: VERSION,
      contract: 1,
      data: null,
      error: { code: "ENOENT", message: "File tidak ditemukan" },
    });
  });
});

describe("kontrak envelope", () => {
  it("CONTRACT bernilai 1", () => {
    expect(CONTRACT).toBe(1);
  });

  it("kedua helper punya set field yang identik", () => {
    const fields = ["ok", "command", "version", "contract", "data", "error"];
    expect(Object.keys(ok("version", null))).toEqual(fields);
    expect(Object.keys(fail("version", "E", "m"))).toEqual(fields);
  });

  it("bisa di-serialize jadi JSON tanpa kehilangan field", () => {
    const envelope = fail("graph", "EDEPTH", "Depth harus angka");
    expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
  });
});
