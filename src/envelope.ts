import { VERSION } from "./version";

/**
 * Version handshake untuk skema `data`. Naikkan kalau bentuk `data` berubah
 * secara breaking, supaya skill yang mengharapkan kontrak lama gagal dengan
 * jelas — bukan salah membaca diam-diam.
 */
export const CONTRACT = 1;

export interface EnvelopeError {
  code: string;
  message: string;
}

export interface Envelope<T = unknown> {
  ok: boolean;
  command: string;
  version: string;
  contract: number;
  data: T | null;
  error: EnvelopeError | null;
}

/** Envelope sukses: `data` terisi, `error` null. */
export function ok<T>(command: string, data: T): Envelope<T> {
  return {
    ok: true,
    command,
    version: VERSION,
    contract: CONTRACT,
    data,
    error: null,
  };
}

/** Envelope gagal: `data` null, `error` terisi. */
export function fail(command: string, code: string, message: string): Envelope<never> {
  return {
    ok: false,
    command,
    version: VERSION,
    contract: CONTRACT,
    data: null,
    error: { code, message },
  };
}
