/**
 * Modul contoh untuk menguji outline.
 *
 * Baris-baris tambahan ini harus hilang, hanya baris pertama yang bertahan.
 */

export interface User {
  id: string;
  name: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Ambil satu user dari API. */
export async function fetchUser(id: string): Promise<User> {
  // komentar internal yang harus ikut hilang
  const res = await fetch(`/users/${id}`);
  return (await res.json()) as User;
}

export function pick<T, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = obj[key];
  return out;
}

export function parse(input: string): number;
export function parse(input: number): number;
export function parse(input: string | number): number {
  return typeof input === "string" ? Number(input) : input;
}

export const toSlug = (text: string): string => {
  const lower = text.toLowerCase();
  return lower.replace(/\s+/g, "-");
};

export const double = (n: number): number => n * 2;

/**
 * Gabungkan dua daftar sambil membuang duplikat berdasarkan
 * kunci yang diberikan. Kalimat kedua ini harus hilang.
 */
export function mergeBy<T>(a: readonly T[], b: readonly T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of [...a, ...b]) seen.set(key(item), item);
  return [...seen.values()];
}

export class Repo<T extends { id: string }> {
  private readonly items = new Map<string, T>();

  constructor(private readonly label: string) {
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }

  async save(item: T): Promise<void> {
    this.items.set(item.id, item);
  }
}

export default class Client {
  request(path: string): Promise<Response> {
    return fetch(path);
  }
}
