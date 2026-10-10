import { Node } from "ts-morph";
import type { SourceFile } from "ts-morph";

export interface ExportEntry {
  name: string;
  kind: string;
}

/**
 * Daftar export sebuah file, murni sintaksis (tanpa resolusi dependensi).
 * Re-export `export * from "x"` dicatat apa adanya karena isinya ada di file lain.
 */
export function listExports(sf: SourceFile): ExportEntry[] {
  const entries: ExportEntry[] = [];
  const seen = new Set<string>();
  const add = (kind: string, name: string): void => {
    const key = `${kind}\0${name}`;
    if (seen.has(key)) return; // overload dihitung sekali
    seen.add(key);
    entries.push({ name, kind });
  };

  for (const stmt of sf.getStatements()) {
    if (Node.isFunctionDeclaration(stmt) && stmt.isExported()) {
      add("function", stmt.isDefaultExport() ? "default" : (stmt.getName() ?? "default"));
    } else if (Node.isClassDeclaration(stmt) && stmt.isExported()) {
      add("class", stmt.isDefaultExport() ? "default" : (stmt.getName() ?? "default"));
    } else if (Node.isInterfaceDeclaration(stmt) && stmt.isExported()) {
      add("interface", stmt.getName());
    } else if (Node.isTypeAliasDeclaration(stmt) && stmt.isExported()) {
      add("type", stmt.getName());
    } else if (Node.isEnumDeclaration(stmt) && stmt.isExported()) {
      add("enum", stmt.getName());
    } else if (Node.isModuleDeclaration(stmt) && stmt.isExported()) {
      add("namespace", stmt.getName());
    } else if (Node.isVariableStatement(stmt) && stmt.isExported()) {
      const kind = stmt.getDeclarationKind();
      for (const decl of stmt.getDeclarations()) add(kind, decl.getName());
    } else if (Node.isExportDeclaration(stmt)) {
      const from = stmt.getModuleSpecifierValue();
      const namespaceExport = stmt.getNamespaceExport();
      if (namespaceExport !== undefined) {
        add("namespace", `${namespaceExport.getName()} from "${from ?? ""}"`);
      } else if (stmt.isNamespaceExport()) {
        add("reexport", `* from "${from ?? ""}"`);
      } else {
        const kind = stmt.isTypeOnly() ? "type" : from === undefined ? "named" : "reexport";
        for (const spec of stmt.getNamedExports()) {
          const exported = spec.getAliasNode()?.getText() ?? spec.getName();
          add(kind, from === undefined ? exported : `${exported} from "${from}"`);
        }
      }
    } else if (Node.isExportAssignment(stmt)) {
      add(stmt.isExportEquals() ? "export=" : "default", stmt.isExportEquals() ? stmt.getExpression().getText() : "default");
    }
  }

  return entries;
}

/** Satu baris per jenis: `function: a, b` / `type: User, Result`. Urutan kemunculan pertama. */
export function formatExports(entries: readonly ExportEntry[]): string {
  const groups = new Map<string, string[]>();
  for (const e of entries) {
    const names = groups.get(e.kind) ?? [];
    names.push(e.name);
    groups.set(e.kind, names);
  }
  return [...groups].map(([kind, names]) => `${kind}: ${names.join(", ")}`).join("\n");
}
