import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Project, ts } from "ts-morph";
import { CliError } from "./errors";

const BASE_OPTIONS = {
  // Tanpa ini, tsconfig dengan include luas akan memuat ribuan file dan
  // membuat outline satu file terasa seperti mengindeks seluruh repo.
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
  skipLoadingLibFiles: true,
} as const;

const FALLBACK_COMPILER_OPTIONS = {
  allowJs: true,
  jsx: ts.JsxEmit.Preserve,
} as const;

/** Telusuri ke atas dari sebuah file sampai menemukan tsconfig.json. */
export function findTsConfig(fromPath: string): string | undefined {
  let dir = dirname(resolve(fromPath));
  for (;;) {
    const candidate = join(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Project ts-morph seringan mungkin. Kalau tsconfig ditemukan ia dipakai —
 * supaya alias `@/` dan compilerOptions repo dikenali — tapi file-nya tidak
 * ikut dimuat; hanya file target yang ditambahkan pemanggil. tsconfig yang
 * tidak bisa dibaca melempar `CliError("ETSCONFIG")`.
 */
export function createProject(tsConfigFilePath?: string): Project {
  if (tsConfigFilePath === undefined) {
    return new Project({ ...BASE_OPTIONS, compilerOptions: FALLBACK_COMPILER_OPTIONS });
  }
  try {
    return new Project({ ...BASE_OPTIONS, tsConfigFilePath });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CliError("ETSCONFIG", `Cannot read ${tsConfigFilePath}: ${reason}`);
  }
}
