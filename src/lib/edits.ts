/** Satu penggantian teks pada rentang tertentu dari sumber asli. */
export interface Edit {
  start: number;
  width: number;
  text: string;
}

/**
 * Terapkan edit langsung ke string, dari belakang ke depan supaya posisi
 * edit berikutnya tidak bergeser. Rentang edit tidak boleh bertumpuk.
 * Tidak melalui ts-morph: `replaceWithText` per edit mem-parse ulang seluruh
 * file tiap kali (O(n^2)).
 */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.start + edit.width);
  }
  return result;
}
