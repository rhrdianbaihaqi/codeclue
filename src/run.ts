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

const HELP = `codeclue ${VERSION} — extract codebase structure for AI coding agents

  clue <command> [options]

Commands
  outline <file>       One file's skeleton: signatures, types, exports
  version              Print the version and contract number

Options
  --json               Emit the JSON envelope
  --help, -h           Show this help
  --version, -v        Print the version

Every command supports --json. Results go to stdout, progress to stderr.
`;

interface CommandResult {
  data: unknown;
  /** Teks bersih untuk stdout — inilah yang tersalin saat di-pipe. */
  human: string;
  /** Ringkasan status; selalu ke stderr, tidak pernah ikut ter-pipe. */
  note?: string;
}

/** Tujuan keluaran; diinjeksi supaya `run()` bisa diuji tanpa menyentuh process. */
export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const processIo: Io = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
};

type Handler = (parsed: ParsedArgv, io: Io) => CommandResult;

const COMMANDS: Record<string, Handler> = {
  version: () => ({
    data: { name: "codeclue", version: VERSION, node: process.version },
    human: `codeclue ${VERSION}`,
  }),

  outline: (parsed, io) => {
    const file = parsed.positionals[0];
    if (file === undefined) {
      throw new CliError("EARGS", "Missing required argument <file>. Example: clue outline src/run.ts");
    }
    const result = outline(file, { warn: (message) => io.stderr(`${message}\n`) });
    return {
      data: result,
      human: result.outline,
      note:
        `~${result.originalTokens} tokens -> ~${result.outlineTokens} tokens ` +
        `(${result.savedPercent}% saved)`,
    };
  },
};

function emit(io: Io, envelope: Envelope, human: string, asJson: boolean): void {
  io.stdout(asJson ? `${JSON.stringify(envelope, null, 2)}\n` : `${human}\n`);
}

export function run(argv: string[], io: Io = processIo): number {
  const parsed = parseArgv(argv);
  const asJson = parsed.flags.json === true;

  if (parsed.flags.help === true) {
    io.stdout(HELP);
    return 0;
  }

  const command = parsed.flags.version === true ? "version" : parsed.command;

  if (command === null) {
    if (asJson) {
      emit(io, fail("", "NO_COMMAND", "No command given. Try: clue --help"), "", true);
      return 1;
    }
    io.stdout(HELP);
    return 0;
  }

  const handler = COMMANDS[command];
  if (handler === undefined) {
    const message = `Unknown command: ${command}. Available: ${Object.keys(COMMANDS).join(", ")}`;
    if (asJson) {
      emit(io, fail(command, "UNKNOWN_COMMAND", message), "", true);
    } else {
      io.stderr(`${message}\n`);
    }
    return 1;
  }

  try {
    const result = handler(parsed, io);
    emit(io, ok(command, result.data), result.human, asJson);
    if (result.note !== undefined && !asJson) io.stderr(`${result.note}\n`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof CliError ? err.code : "INTERNAL_ERROR";
    if (asJson) {
      emit(io, fail(command, code, message), "", true);
    } else {
      io.stderr(`Error: ${message}\n`);
    }
    return 1;
  }
}
