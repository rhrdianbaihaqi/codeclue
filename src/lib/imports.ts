import type { ImportDeclaration, SourceFile } from "ts-morph";
import type { Edit } from "./edits";

/** Default import ini selalu dipertahankan di file JSX (dipakai implisit oleh JSX klasik). */
const IMPLICIT_JSX_BINDINGS = new Set(["React"]);

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isUsed(name: string, usageText: string): boolean {
  return new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`).test(usageText);
}

/** Rentang seluruh deklarasi, termasuk satu pemisah baris di belakangnya. */
export function declarationRange(decl: ImportDeclaration, fullText: string): { start: number; width: number } {
  const start = decl.getStart();
  let end = decl.getEnd();
  if (fullText.startsWith("\r\n", end)) end += 2;
  else if (fullText.startsWith("\n", end)) end += 1;
  return { start, width: end - start };
}

/**
 * Edit untuk membuang binding import yang tidak dipakai di `usageText`
 * (teks outline tanpa deklarasi import). Konservatif: pemakaian dicari
 * lewat word-boundary di seluruh teks, termasuk komentar dan string, jadi
 * yang ragu dipertahankan. Import tanpa binding (`import "x"`) tidak disentuh.
 */
export function pruneImportEdits(sf: SourceFile, usageText: string, isJsx: boolean): Edit[] {
  const fullText = sf.getFullText();
  const edits: Edit[] = [];

  for (const decl of sf.getImportDeclarations()) {
    const defaultImport = decl.getDefaultImport();
    const namespaceImport = decl.getNamespaceImport();
    const namedImports = decl.getNamedImports();
    const namedNode = decl.getImportClause()?.getNamedBindings(); // NamespaceImport | NamedImports | undefined
    if (defaultImport === undefined && namedNode === undefined) continue;

    const keepDefault =
      defaultImport !== undefined &&
      ((isJsx && IMPLICIT_JSX_BINDINGS.has(defaultImport.getText())) ||
        isUsed(defaultImport.getText(), usageText));

    const keptNamed = namedImports.filter((spec) =>
      isUsed((spec.getAliasNode() ?? spec.getNameNode()).getText(), usageText),
    );
    const keepBindings =
      namedNode === undefined
        ? false
        : namespaceImport !== undefined
          ? isUsed(namespaceImport.getText(), usageText)
          : keptNamed.length > 0;

    if (!keepDefault && !keepBindings) {
      edits.push({ ...declarationRange(decl, fullText), text: "" });
      continue;
    }

    if (defaultImport !== undefined && !keepDefault && namedNode !== undefined) {
      // `import D, { a } from` -> `import { a } from`
      edits.push({ start: defaultImport.getStart(), width: namedNode.getStart() - defaultImport.getStart(), text: "" });
    }
    if (defaultImport !== undefined && keepDefault && namedNode !== undefined && !keepBindings) {
      // `import D, { a } from` -> `import D from`
      edits.push({ start: defaultImport.getEnd(), width: namedNode.getEnd() - defaultImport.getEnd(), text: "" });
    }
    if (keepBindings && namespaceImport === undefined && namedNode !== undefined && keptNamed.length < namedImports.length) {
      edits.push({ start: namedNode.getStart(), width: namedNode.getWidth(), text: `{ ${keptNamed.map((s) => s.getText()).join(", ")} }` });
    }
  }

  return edits;
}
