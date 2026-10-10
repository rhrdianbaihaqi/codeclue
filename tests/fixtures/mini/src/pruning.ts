import "./types";
import defaultUtil, { alpha, beta as renamed, gamma } from "./util";
import type { User, Id } from "@/types";
import * as everything from "./util";
import Client from "./client";

/** Ringkasan. Kalimat kedua dibuang. @deprecated Pakai yang baru
 * saja. */
export function run(user: User, fn: typeof renamed): number {
  return alpha() + gamma() + fn();
}

export const ns: typeof everything.alpha = alpha;
