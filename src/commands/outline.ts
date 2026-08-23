import { statSync } from "node:fs";
import { Node } from "ts-morph";
import type {
  ArrowFunction,
  ConstructorDeclaration,
  FunctionDeclaration,
  FunctionExpression,
  GetAccessorDeclaration,
  JSDoc,
  MethodDeclaration,
  SetAccessorDeclaration,
  SourceFile,
} from "ts-morph";
import { estimateTokens, savedPercent } from "../lib/count";
import { CliError } from "../lib/errors";
import { createProject } from "../lib/project";

const BODY_PLACEHOLDER = "{ /* ... */ }";

export interface OutlineResult {
  file: string;
  outline: string;
  originalTokens: number;
  outlineTokens: number;
  savedPercent: number;
}

/** Satu penggantian teks pada rentang node tertentu. */
interface Edit {
  start: number;
  width: number;
  text: string;
}

type FunctionLike =
  | ArrowFunction
  | ConstructorDeclaration
  | FunctionDeclaration
  | FunctionExpression
  | GetAccessorDeclaration
  | MethodDeclaration
  | SetAccessorDeclaration;

function isFunctionLike(node: Node): node is FunctionLike {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isConstructorDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node)
  );
}

/**
 * JSDoc dipangkas jadi kalimat pertamanya. Batasnya kalimat, bukan baris —
 * memotong per baris membelah kalimat di tengah dan menghasilkan teks yang
 * justru menyesatkan. Kalau tidak ada batas kalimat yang jelas, seluruh
 * deskripsi dipertahankan; kalau tidak ada deskripsi sama sekali (hanya tag
 * seperti @param), blok dibiarkan utuh.
 */
function trimJsDoc(doc: JSDoc): Edit | null {
  const description = doc.getDescription().replace(/\s+/g, " ").trim();
  if (description === "") return null;

  const sentenceEnd = /[.!?](\s|$)/.exec(description);
  const summary =
    sentenceEnd === null ? description : description.slice(0, sentenceEnd.index + 1);

  const trimmed = `/** ${summary} */`;
  if (doc.getText() === trimmed) return null;

  return { start: doc.getStart(), width: doc.getWidth(), text: trimmed };
}

function collectEdits(sf: SourceFile): Edit[] {
  const edits: Edit[] = [];

  const takeJsDocs = (node: Node): void => {
    if (!Node.isJSDocable(node)) return;
    for (const doc of node.getJsDocs()) {
      const edit = trimJsDoc(doc);
      if (edit !== null) edits.push(edit);
    }
  };


  sf.forEachDescendant((node, traversal) => {
    takeJsDocs(node);

    if (!isFunctionLike(node)) return;

    const body = node.getBody();
    // Arrow dengan body ekspresi (`(n) => n * 2`) dibiarkan — sudah sesingkat
    // signature-nya, dan menggantinya dengan blok mengubah arti kembaliannya.
    if (body === undefined || !Node.isBlock(body)) return;

    edits.push({ start: body.getStart(), width: body.getWidth(), text: BODY_PLACEHOLDER });

    // Fungsi bersarang ikut hilang bersama body induknya.
    traversal.skip();
  });

  return edits;
}

export function outline(filePath: string): OutlineResult {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    throw new CliError("ENOENT", `File tidak ditemukan: ${filePath}`);
  }
  if (stat.isDirectory()) {
    throw new CliError("EISDIR", `${filePath} adalah direktori, bukan file`);
  }

  const project = createProject();
  const sf = project.addSourceFileAtPath(filePath);
  const original = sf.getFullText();

  // Dari belakang ke depan supaya posisi edit berikutnya tidak bergeser.
  const edits = collectEdits(sf).sort((a, b) => b.start - a.start);
  for (const edit of edits) {
    sf.getDescendantAtStartWithWidth(edit.start, edit.width)?.replaceWithText(edit.text);
  }

  const result = sf.getFullText();
  const originalTokens = estimateTokens(original);
  const outlineTokens = estimateTokens(result);

  return {
    file: filePath,
    outline: result,
    originalTokens,
    outlineTokens,
    savedPercent: savedPercent(originalTokens, outlineTokens),
  };
}
