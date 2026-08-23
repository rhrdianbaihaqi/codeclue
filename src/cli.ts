#!/usr/bin/env node
import { outline } from "./commands/outline";
import { fail, ok } from "./envelope";
import type { Envelope } from "./envelope";
import { CliError } from "./lib/errors";
import { VERSION } from "./version";

/**
 * Flag yang tidak pernah membawa nilai. Sisanya diperlakukan sebagai
 * flag bernilai (`--depth 2` atau `--depth=2`) supaya `clue outline --json
 * file.ts` tidak salah menelan `file.ts` sebagai nilai `--json`.
 */
const BOOLEAN_FLAGS = new Set(["json", "help", "version"]);

const ALIASES: Record<string, string> = {
  h: "help",
  v: "version",
};

export interface ParsedArgv {
  command: string | null;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgv(argv: string[]): ParsedArgv {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let onlyPositionals = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (onlyPositionals) {
      positionals.push(arg);
      continue;
    }

    if (arg === "--") {
      onlyPositionals = true;
      continue;
    }

    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }

    const bare = arg.startsWith("--") ? arg.slice(2) : arg.slice(1);
    const eq = bare.indexOf("=");

    if (eq !== -1) {
      const name = bare.slice(0, eq);
      flags[ALIASES[name] ?? name] = bare.slice(eq + 1);
      continue;
    }

    const name = ALIASES[bare] ?? bare;

    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && (!next.startsWith("-") || next === "-")) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }

  const [command = null, ...rest] = positionals;
  return { command, positionals: rest, flags };
}

const HELP = `codeclue ${VERSION} — ekstrak struktur codebase untuk AI coding agent

  clue <command> [options]

Commands
  outline <file>       Skeleton satu file: signature, tipe, export
  version              Tampilkan versi dan nomor kontrak

Options
  --json               Keluarkan envelope JSON
  --help, -h           Tampilkan bantuan ini
  --version, -v        Tampilkan versi

Setiap command mendukung --json. Hasil ke stdout, progres ke stderr.
`;

interface CommandResult {
  data: unknown;
  /** Teks bersih untuk stdout — inilah yang tersalin saat di-pipe. */
  human: string;
  /** Ringkasan status; selalu ke stderr, tidak pernah ikut ter-pipe. */
  note?: string;
}

type Handler = (parsed: ParsedArgv) => CommandResult;

const COMMANDS: Record<string, Handler> = {
  version: () => ({
    data: { name: "codeclue", version: VERSION, node: process.version },
    human: `codeclue ${VERSION}`,
  }),

  outline: (parsed) => {
    const file = parsed.positionals[0];
    if (file === undefined) {
      throw new CliError("EARGS", "Argumen <file> wajib diisi. Contoh: clue outline src/cli.ts");
    }
    const result = outline(file);
    return {
      data: result,
      human: result.outline,
      note:
        `~${result.originalTokens} token -> ~${result.outlineTokens} token ` +
        `(hemat ${result.savedPercent}%)`,
    };
  },
};

function emit(envelope: Envelope, human: string, asJson: boolean): void {
  const out = asJson ? `${JSON.stringify(envelope, null, 2)}\n` : `${human}\n`;
  process.stdout.write(out);
}

export function run(argv: string[]): number {
  const parsed = parseArgv(argv);
  const asJson = parsed.flags.json === true;

  if (parsed.flags.help === true) {
    process.stdout.write(HELP);
    return 0;
  }

  const command = parsed.flags.version === true ? "version" : parsed.command;

  if (command === null) {
    if (asJson) {
      emit(fail("", "NO_COMMAND", "Tidak ada command. Coba: clue --help"), "", true);
      return 1;
    }
    process.stdout.write(HELP);
    return 0;
  }

  const handler = COMMANDS[command];
  if (handler === undefined) {
    const message = `Command tidak dikenal: ${command}. Yang tersedia: ${Object.keys(COMMANDS).join(", ")}`;
    if (asJson) {
      emit(fail(command, "UNKNOWN_COMMAND", message), "", true);
    } else {
      process.stderr.write(`${message}\n`);
    }
    return 1;
  }

  try {
    const result = handler(parsed);
    emit(ok(command, result.data), result.human, asJson);
    if (result.note !== undefined && !asJson) process.stderr.write(`${result.note}\n`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof CliError ? err.code : "INTERNAL_ERROR";
    if (asJson) {
      emit(fail(command, code, message), "", true);
    } else {
      process.stderr.write(`Error: ${message}\n`);
    }
    return 1;
  }
}

process.exitCode = run(process.argv.slice(2));
