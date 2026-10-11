import { realpathSync, statSync } from "node:fs";
import { dirname, extname, normalize, resolve as resolvePath } from "node:path";
import { ts } from "ts-morph";
import { isSupportedSource } from "./files";

export type Resolution =
  | { kind: "file"; path: string }
  | { kind: "external"; name: string }
  | { kind: "unresolved" };

export interface Resolver {
  resolve(specifier: string, fromFile: string): Resolution;
}

/** Semua specifier modul di sebuah file: import, export-from, `import()`, `require()`. */
export function extractSpecifiers(text: string): string[] {
  const info = ts.preProcessFile(text, true, true);
  return [...new Set(info.importedFiles.map((f) => f.fileName))];
}

/** `@scope/pkg/sub` -> `@scope/pkg`, `pkg/sub` -> `pkg`, `node:fs` tetap. */
export function packageName(specifier: string): string {
  if (specifier.startsWith("node:")) return specifier;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

const isRelative = (specifier: string): boolean =>
  specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");

/** Apakah specifier cocok dengan salah satu pola `paths` tsconfig (mis. `@/*`)? */
function matchesPathAlias(specifier: string, paths: ts.MapLike<string[]> | undefined): boolean {
  if (paths === undefined) return false;
  return Object.keys(paths).some((pattern) => {
    const star = pattern.indexOf("*");
    if (star === -1) return pattern === specifier;
    return (
      specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1))
    );
  });
}

/**
 * Import relatif ke file non-TS/JS (`./App.svelte`, `./app.css`, `./logo.svg?url`)
 * tidak dipahami resolver TypeScript, tapi filenya nyata. Dikembalikan sebagai
 * path agar masuk graph sebagai daun (tidak di-parse), bukan "rusak".
 */
function resolveAsset(specifier: string, fromFile: string): string | undefined {
  if (!isRelative(specifier)) return undefined;
  const clean = specifier.split(/[?#]/)[0]!;
  if (extname(clean) === "" || isSupportedSource(clean)) return undefined;
  const candidate = resolvePath(dirname(fromFile), clean);
  try {
    return statSync(candidate).isFile() ? realpathSync(candidate) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolusi import memakai resolver modul TypeScript sendiri, jadi `paths`,
 * ekstensi implisit, `/index`, dan pemetaan `.js` -> `.ts` mengikuti perilaku
 * kompiler. Hasil yang berada di `node_modules` (atau ditandai
 * `isExternalLibraryImport`, mis. workspace yang di-symlink) TIDAK pernah
 * dikembalikan sebagai file: ia dilaporkan sebagai `external` dan tidak ditelusuri.
 */
export function createResolver(options: ts.CompilerOptions, cwd: string): Resolver {
  const cache = ts.createModuleResolutionCache(cwd, (f) => f, options);

  return {
    resolve(specifier, fromFile) {
      if (specifier.startsWith("node:")) return { kind: "external", name: specifier };

      const { resolvedModule } = ts.resolveModuleName(specifier, fromFile, options, ts.sys, cache);

      if (resolvedModule !== undefined) {
        const path = resolvedModule.resolvedFileName;
        if (resolvedModule.isExternalLibraryImport === true || path.split(/[\\/]/).includes("node_modules")) {
          return { kind: "external", name: packageName(specifier) };
        }
        // TS memakai "/" di semua platform; samakan dengan path asli OS supaya file yang
        // sama tidak tercatat dua kali sebagai node (entry memakai "\\" di Windows).
        return { kind: "file", path: normalize(path) };
      }

      // Tidak ketemu: relatif atau cocok alias = import rusak; sisanya dianggap
      // paket yang tidak terpasang (tetap dicatat sebagai eksternal).
      const asset = resolveAsset(specifier, fromFile);
      if (asset !== undefined) return { kind: "file", path: normalize(asset) };
      if (isRelative(specifier) || matchesPathAlias(specifier, options.paths)) return { kind: "unresolved" };
      return { kind: "external", name: packageName(specifier) };
    },
  };
}
