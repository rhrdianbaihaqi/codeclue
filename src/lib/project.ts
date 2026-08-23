import { Project, ts } from "ts-morph";

/**
 * Project ts-morph seringan mungkin: tidak memuat lib files, tidak
 * menelusuri dependency, dan tidak ikut menarik file dari tsconfig.
 * Outline hanya butuh AST sintaksis, bukan type checker penuh.
 */
export function createProject(): Project {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
    },
  });
}
