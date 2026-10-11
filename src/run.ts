import { DEFAULT_DEPTH, formatGraph, graph } from "./commands/graph";
import { outline } from "./commands/outline";
import { formatSurvey, survey } from "./commands/survey";
import { DEFAULT_TRACE_DEPTH, formatTrace, trace } from "./commands/trace";
import { fail, ok } from "./envelope";
import type { Envelope } from "./envelope";
import { formatSaved } from "./lib/count";
import { CliError } from "./lib/errors";
import { closestMatch } from "./lib/suggest";
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
  graph <file>         Import graph from a file (--depth N, default 2)
  trace <entry>        Layered map: entry in full, depth 1 outlines, depth 2 exports
  survey [dir]         Token profile of a repo: top 20 files, total, ignore suggestions
  version              Print the version and contract number

Options
  --depth N            Depth from the entry file (graph, trace; default 2)
  --json               Emit the JSON envelope
  --help, -h           Show this help
  --version, -v        Print the version

Every command supports --json. Results go to stdout, progress to stderr.
Per-command help: clue <command> --help
`;

interface CommandDoc {
  usage: string;
  summary: string;
  options: string[];
  examples: string[];
  /** Flag bernilai yang dikenali selain --json/--help/--version. */
  flags: string[];
  /** Jumlah argumen posisional yang dipakai. */
  args: number;
}

const COMMAND_DOCS: Record<string, CommandDoc> = {
  outline: {
    usage: "clue outline <file> [--json]",
    summary: "Print one file's skeleton: signatures, types and exports without function bodies.",
    options: [],
    examples: ["clue outline src/run.ts", "clue outline src/run.ts --json"],
    flags: [],
    args: 1,
  },
  graph: {
    usage: "clue graph <file> [--depth N] [--json]",
    summary: "Walk the import graph from a file (relative, tsconfig aliases). Never enters node_modules.",
    options: ["--depth N    how far to follow imports (default 2)"],
    examples: ["clue graph src/run.ts", "clue graph src/run.ts --depth 3 --json"],
    flags: ["depth"],
    args: 1,
  },
  trace: {
    usage: "clue trace <entry> [--depth N] [--json]",
    summary: "Layered map of a subsystem: entry in full, depth 1 as outlines, depth 2 as export lists, beyond as paths.",
    options: ["--depth N    how far to follow imports (default 2)"],
    examples: ["clue trace src/run.ts", "clue trace src/run.ts --depth 1 | pbcopy"],
    flags: ["depth"],
    args: 1,
  },
  survey: {
    usage: "clue survey [dir] [--json]",
    summary: "Token profile of a repo: top 20 files, total tokens, suggested ignore list. Respects .gitignore.",
    options: [],
    examples: ["clue survey", "clue survey packages/api --json"],
    flags: [],
    args: 1,
  },
  version: {
    usage: "clue version [--json]",
    summary: "Print the version and contract number.",
    options: [],
    examples: ["clue version --json"],
    flags: [],
    args: 0,
  },
};

export function commandHelp(name: string): string {
  const doc = COMMAND_DOCS[name]!;
  const lines = [`${doc.usage}`, "", doc.summary, ""];
  lines.push("Options");
  for (const option of doc.options) lines.push(`  ${option}`);
  lines.push("  --json       emit the JSON envelope", "  --help, -h   show this help", "");
  lines.push("Examples");
  for (const example of doc.examples) lines.push(`  ${example}`);
  lines.push("", "Results go to stdout; warnings and the token summary go to stderr.", "");
  return lines.join("\n");
}

/** Peringatan (bukan error) untuk flag tak dikenal dan argumen berlebih — tidak menggagalkan perintah. */
function inputWarnings(command: string, parsed: ParsedArgv): string[] {
  const doc = COMMAND_DOCS[command];
  if (doc === undefined) return [];
  const known = new Set(["json", "help", "version", ...doc.flags]);
  const warnings: string[] = [];
  for (const name of Object.keys(parsed.flags)) {
    if (!known.has(name)) warnings.push(`Warning: unknown option --${name} for "clue ${command}" (ignored). See: clue ${command} --help`);
  }
  const extra = parsed.positionals.slice(doc.args);
  if (extra.length > 0) {
    warnings.push(`Warning: ignoring extra argument${extra.length > 1 ? "s" : ""}: ${extra.join(" ")}`);
  }
  return warnings;
}

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

function parseDepth(parsed: ParsedArgv, fallback: number): number {
  const raw = parsed.flags.depth;
  if (raw === undefined) return fallback;
  const depth = raw === true ? Number.NaN : Number(raw);
  if (!Number.isInteger(depth) || depth < 0) {
    throw new CliError("EARGS", `--depth must be a non-negative integer, got ${raw === true ? "nothing" : String(raw)}`);
  }
  return depth;
}

const COMMANDS: Record<string, Handler> = {
  version: () => ({
    data: { name: "codeclue", version: VERSION, node: process.version },
    human: `codeclue ${VERSION}`,
  }),

  graph: (parsed, io) => {
    const file = parsed.positionals[0];
    if (file === undefined) {
      throw new CliError("EARGS", "Missing required argument <file>. Example: clue graph src/run.ts --depth 2");
    }
    const depth = parseDepth(parsed, DEFAULT_DEPTH);
    const result = graph(file, { depth, warn: (message) => io.stderr(`${message}\n`) });
    return {
      data: result,
      human: formatGraph(result),
      note:
        `${result.nodes.length} files, ${result.external.length} external, ` +
        `${result.unresolved.length} unresolved, ${result.cycles.length} cycle(s)`,
    };
  },

  trace: (parsed, io) => {
    const file = parsed.positionals[0];
    if (file === undefined) {
      throw new CliError("EARGS", "Missing required argument <entry>. Example: clue trace src/run.ts --depth 2");
    }
    const depth = parseDepth(parsed, DEFAULT_TRACE_DEPTH);
    const result = trace(file, { depth, warn: (message) => io.stderr(`${message}\n`) });
    const t = result.totals;
    return {
      data: result,
      human: formatTrace(result),
      note: `${t.files} files: ~${t.traceTokens} tokens vs ~${t.fullTokens} if read in full (${formatSaved(t.savedPercent)})`,
    };
  },

  survey: (parsed, io) => {
    const result = survey(parsed.positionals[0], { warn: (message) => io.stderr(`${message}\n`) });
    const sg = result.suggestedSavings;
    return {
      data: result,
      human: formatSurvey(result),
      note: `${result.totals.files} files, ~${result.totals.tokens} tokens; ignore suggestions could drop ~${sg.tokens} (${sg.percent}%)`,
    };
  },

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
        `(${formatSaved(result.savedPercent)})`,
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
    io.stdout(parsed.command !== null && parsed.command in COMMAND_DOCS ? commandHelp(parsed.command) : HELP);
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
    const names = Object.keys(COMMANDS);
    const guess = closestMatch(command, names);
    const message =
      `Unknown command: ${command}.` +
      (guess === undefined ? "" : ` Did you mean "${guess}"?`) +
      ` Available: ${names.join(", ")}`;
    if (asJson) {
      emit(io, fail(command, "UNKNOWN_COMMAND", message), "", true);
    } else {
      io.stderr(`${message}\n`);
    }
    return 1;
  }

  for (const warning of inputWarnings(command, parsed)) io.stderr(`${warning}\n`);

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
