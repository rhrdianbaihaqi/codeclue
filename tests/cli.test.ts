import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTRACT } from "../src/envelope";
import { parseArgv, run } from "../src/run";
import { VERSION } from "../src/version";

const FIXTURE = fileURLToPath(new URL("./fixtures/sample.ts", import.meta.url));

function exec(...argv: string[]): { code: number; stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  const code = run(argv, {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  });
  return { code, stdout, stderr };
}

describe("parseArgv", () => {
  it("memisahkan command, posisional, dan flag", () => {
    expect(parseArgv(["outline", "a.ts", "--json"])).toEqual({
      command: "outline",
      positionals: ["a.ts"],
      flags: { json: true },
    });
  });

  it("flag boolean tidak menelan argumen posisional berikutnya", () => {
    const parsed = parseArgv(["outline", "--json", "a.ts"]);
    expect(parsed.positionals).toEqual(["a.ts"]);
    expect(parsed.flags.json).toBe(true);
  });

  it("flag bernilai: bentuk spasi dan bentuk =", () => {
    expect(parseArgv(["x", "--depth", "2"]).flags.depth).toBe("2");
    expect(parseArgv(["x", "--depth=2"]).flags.depth).toBe("2");
  });

  it("alias -h dan -v", () => {
    expect(parseArgv(["-h"]).flags.help).toBe(true);
    expect(parseArgv(["-v"]).flags.version).toBe(true);
  });

  it("-- mengakhiri flag", () => {
    expect(parseArgv(["outline", "--", "--json"]).positionals).toEqual(["--json"]);
  });
});

describe("run: envelope --json", () => {
  it("sukses: envelope valid, stdout hanya JSON, stderr kosong", () => {
    const { code, stdout, stderr } = exec("outline", FIXTURE, "--json");
    expect(code).toBe(0);
    expect(stderr).toBe("");
    const env = JSON.parse(stdout);
    expect(env).toMatchObject({
      ok: true,
      command: "outline",
      version: VERSION,
      contract: CONTRACT,
      error: null,
    });
    expect(env.data.outline).toContain("export async function fetchUser");
  });

  it("flag --json sebelum file tidak merusak argumen", () => {
    expect(exec("outline", "--json", FIXTURE).code).toBe(0);
  });

  it("argumen kurang: EARGS, ok false, data null, exit 1", () => {
    const { code, stdout } = exec("outline", "--json");
    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, data: null, error: { code: "EARGS" } });
  });

  it("file tidak ada: ENOENT", () => {
    const { code, stdout } = exec("outline", "/tidak/ada.ts", "--json");
    expect(code).toBe(1);
    expect(JSON.parse(stdout).error.code).toBe("ENOENT");
  });

  it("command tidak dikenal: UNKNOWN_COMMAND", () => {
    const { code, stdout } = exec("bogus", "--json");
    expect(code).toBe(1);
    expect(JSON.parse(stdout).error.code).toBe("UNKNOWN_COMMAND");
  });

  it("tanpa command + --json: NO_COMMAND", () => {
    const { code, stdout } = exec("--json");
    expect(code).toBe(1);
    expect(JSON.parse(stdout).error.code).toBe("NO_COMMAND");
  });

  it("version --json", () => {
    const env = JSON.parse(exec("version", "--json").stdout);
    expect(env.data).toMatchObject({ name: "codeclue", version: VERSION });
  });
});

describe("run: mode teks", () => {
  it("stdout hanya outline bersih; ringkasan token ke stderr", () => {
    const { code, stdout, stderr } = exec("outline", FIXTURE);
    expect(code).toBe(0);
    expect(stdout).toContain("export async function fetchUser");
    expect(stdout).not.toMatch(/tokens ->/);
    expect(stderr).toMatch(/~\d+ tokens -> ~\d+ tokens/);
  });

  it("error ke stderr, stdout kosong", () => {
    const { code, stdout, stderr } = exec("outline", "/tidak/ada.ts");
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/^Error: File not found/);
  });

  it("--help dan tanpa command mencetak bantuan ke stdout", () => {
    expect(exec("--help").stdout).toMatch(/Commands/);
    const bare = exec();
    expect(bare.code).toBe(0);
    expect(bare.stdout).toMatch(/Commands/);
  });

  it("--version mencetak versi", () => {
    expect(exec("--version").stdout.trim()).toBe(`codeclue ${VERSION}`);
  });
});

describe("run: graph", () => {
  const MINI_ENTRY = fileURLToPath(new URL("./fixtures/mini/src/index.ts", import.meta.url));

  it("--json: envelope dengan nodes/edges/external/cycles", () => {
    const { code, stdout, stderr } = exec("graph", MINI_ENTRY, "--depth", "2", "--json");
    expect(code).toBe(0);
    expect(stderr).not.toMatch(/\S/);
    const env = JSON.parse(stdout);
    expect(env).toMatchObject({ ok: true, command: "graph", contract: CONTRACT });
    expect(env.data.nodes.length).toBeGreaterThan(1);
    expect(env.data).toHaveProperty("edges");
    expect(env.data).toHaveProperty("external");
    expect(env.data.cycles).toHaveLength(1);
  });

  it("mode teks: peta ke stdout, ringkasan ke stderr", () => {
    const { stdout, stderr } = exec("graph", MINI_ENTRY);
    expect(stdout).toContain("(entry, depth 2)");
    expect(stderr).toMatch(/\d+ files, \d+ external/);
  });

  it("--depth tanpa nilai atau bukan angka: EARGS", () => {
    expect(JSON.parse(exec("graph", MINI_ENTRY, "--depth", "abc", "--json").stdout).error.code).toBe("EARGS");
    expect(JSON.parse(exec("graph", MINI_ENTRY, "--depth", "--json").stdout).error.code).toBe("EARGS");
  });

  it("tanpa file: EARGS", () => {
    expect(JSON.parse(exec("graph", "--json").stdout).error.code).toBe("EARGS");
  });
});

describe("run: trace", () => {
  const ENTRY = fileURLToPath(new URL("./fixtures/mini/src/main.ts", import.meta.url));

  it("--json: envelope dengan files, layer, dan totals", () => {
    const { code, stdout } = exec("trace", ENTRY, "--json");
    expect(code).toBe(0);
    const env = JSON.parse(stdout);
    expect(env).toMatchObject({ ok: true, command: "trace", contract: CONTRACT });
    expect(env.data.files[0]).toMatchObject({ depth: 0, layer: "full" });
    expect(env.data.totals).toHaveProperty("fullTokens");
    expect(env.data.totals).toHaveProperty("traceTokens");
  });

  it("mode teks: peta bersih di stdout, perbandingan token di stderr", () => {
    const { stdout, stderr } = exec("trace", ENTRY);
    expect(stdout).toMatch(/### \S*main\.ts \[entry · full\]/);
    expect(stdout).not.toMatch(/tokens vs/);
    expect(stderr).toMatch(/files: ~\d+ tokens vs ~\d+ if read in full/);
  });

  it("argumen salah: EARGS", () => {
    expect(JSON.parse(exec("trace", "--json").stdout).error.code).toBe("EARGS");
    expect(JSON.parse(exec("trace", ENTRY, "--depth", "x", "--json").stdout).error.code).toBe("EARGS");
  });
});
