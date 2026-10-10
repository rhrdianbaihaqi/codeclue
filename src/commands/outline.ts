import { Node } from "ts-morph";
import type {
  ArrowFunction,
  ClassStaticBlockDeclaration,
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
import { applyEdits } from "../lib/edits";
import type { Edit } from "../lib/edits";
import { CliError } from "../lib/errors";
import { assertSourceFile } from "../lib/files";
import { declarationRange, pruneImportEdits } from "../lib/imports";
import { createProject, findTsConfig } from "../lib/project";

const BODY_PLACEHOLDER = "{ /* ... */ }";

/** Berapa pesan sintaks yang ditampilkan sebelum diringkas. */
const MAX_SYNTAX_MESSAGES = 3;

export interface OutlineOptions {
  /** Ke mana peringatan non-fatal dikirim. Default: stderr. */
  warn?: (message: string) => void;
}

export interface OutlineResult {
  file: string;
  outline: string;
  originalTokens: number;
  outlineTokens: number;
  savedPercent: number;
  /** Jumlah error sintaks pada file sumber; 0 berarti parse bersih. */
  syntaxErrors: number;
}

type FunctionLike =
  | ArrowFunction
  | ClassStaticBlockDeclaration
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
    Node.isClassStaticBlockDeclaration(node) ||
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

  // @deprecated mengubah keputusan pembaca (jangan dipakai), jadi bertahan.
  const deprecated = doc
    .getTags()
    .filter((tag) => tag.getTagName() === "deprecated")
    .map((tag) => `@deprecated ${(tag.getCommentText() ?? "").replace(/\s+/g, " ").trim()}`.trim());

  const trimmed = `/** ${[summary, ...deprecated].join(" ")} */`;
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

export function outline(filePath: string, options: OutlineOptions = {}): OutlineResult {
  const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));

  assertSourceFile(filePath);

  const tsConfigFilePath = findTsConfig(filePath);
  if (tsConfigFilePath === undefined) {
    warn(`Warning: no tsconfig.json found from ${filePath}; falling back to defaults.`);
  }

  // Hanya file target yang ditambahkan. Tidak pernah ada .save() di sini —
  // seluruh manipulasi berhenti di memori, file di disk tidak disentuh.
  let project;
  try {
    project = createProject(tsConfigFilePath);
  } catch (err) {
    // tsconfig rusak tidak boleh menggagalkan outline — alias tidak dipakai di sini.
    if (!(err instanceof CliError) || err.code !== "ETSCONFIG") throw err;
    warn(`Warning: ${err.message} (falling back to defaults)`);
    project = createProject();
  }
  const sf = project.addSourceFileAtPath(filePath);
  const original = sf.getFullText();

  // Outline dari kode yang gagal di-parse hanya tebakan. Tetap dihasilkan
  // (kalau ragu, pertahankan), tapi pembaca harus tahu.
  const syntaxDiagnostics = project.getProgram().getSyntacticDiagnostics(sf);
  if (syntaxDiagnostics.length > 0) {
    warn(`Warning: ${syntaxDiagnostics.length} syntax error(s) in ${filePath}; outline may be incomplete or wrong.`);
    for (const d of syntaxDiagnostics.slice(0, MAX_SYNTAX_MESSAGES)) {
      const text = d.getMessageText();
      const message = typeof text === "string" ? text : text.getMessageText();
      warn(`  line ${d.getLineNumber() ?? "?"}: ${message}`);
    }
  }

  const bodyEdits = collectEdits(sf);

  // Pemakaian import dinilai dari outline tanpa deklarasi import itu sendiri.
  const importRanges = sf
    .getImportDeclarations()
    .map((decl) => ({ ...declarationRange(decl, original), text: "" }));
  const usageText = applyEdits(original, [...bodyEdits, ...importRanges]);
  const isJsx = /\.[jt]sx$/i.test(filePath);

  const result = applyEdits(original, [...bodyEdits, ...pruneImportEdits(sf, usageText, isJsx)]);

  const originalTokens = estimateTokens(original);
  const outlineTokens = estimateTokens(result);

  return {
    file: filePath,
    outline: result,
    originalTokens,
    outlineTokens,
    savedPercent: savedPercent(originalTokens, outlineTokens),
    syntaxErrors: syntaxDiagnostics.length,
  };
}
