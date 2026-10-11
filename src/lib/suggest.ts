/** Jarak edit Levenshtein; cukup untuk nama command yang pendek. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** Kandidat terdekat dalam jarak 2 (atau prefix), atau `undefined` bila tak ada yang mirip. */
export function closestMatch(input: string, candidates: string[]): string | undefined {
  let best: { name: string; score: number } | undefined;
  for (const name of candidates) {
    const score = name.startsWith(input) && input.length >= 2 ? 0 : distance(input, name);
    if (score <= 2 && (best === undefined || score < best.score)) best = { name, score };
  }
  return best?.name;
}
