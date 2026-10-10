import { ts } from "ts-morph";

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
        return { kind: "file", path };
      }

      // Tidak ketemu: relatif atau cocok alias = import rusak; sisanya dianggap
      // paket yang tidak terpasang (tetap dicatat sebagai eksternal).
      if (isRelative(specifier) || matchesPathAlias(specifier, options.paths)) return { kind: "unresolved" };
      return { kind: "external", name: packageName(specifier) };
    },
  };
}
