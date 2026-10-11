import { statSync } from "node:fs";
import { extname, isAbsolute } from "node:path";
import { CliError } from "./errors";

export const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

export function isSupportedSource(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/** Pastikan `filePath` adalah file sumber TS/JS yang ada; kalau tidak, lempar CliError. */
export function assertSourceFile(filePath: string): void {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    const where = isAbsolute(filePath) ? "" : ` (looked in ${process.cwd()})`;
    throw new CliError("ENOENT", `File not found: ${filePath}${where}`);
  }
  if (stat.isDirectory()) {
    throw new CliError(
      "EISDIR",
      `${filePath} is a directory, not a file. Pass an entry file (e.g. ${filePath}/index.ts), ` +
        `or run "clue survey ${filePath}" to profile the directory.`,
    );
  }

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new CliError(
      "EUNSUPPORTED",
      `Unsupported file type "${ext || "(none)"}": ${filePath}. Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`,
    );
  }
}
