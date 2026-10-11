/**
 * Estimasi token untuk MVP: panjang karakter dibagi 4.
 *
 * SELALU tampilkan hasilnya sebagai estimasi (`~4.200 token`), jangan
 * sebagai angka pasti — tokenizer berbeda antar model.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Persentase token yang dihemat, dibulatkan ke bilangan bulat. */
export function savedPercent(original: number, reduced: number): number {
  if (original <= 0) return 0;
  return Math.round(((original - reduced) / original) * 100);
}

/** "66% saved", atau "no savings" bila hasilnya tidak lebih kecil (jangan tampilkan persen negatif). */
export function formatSaved(percent: number): string {
  return percent > 0 ? `${percent}% saved` : "no savings";
}
