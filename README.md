# codeclue

[![npm](https://img.shields.io/npm/v/codeclue/alpha?label=npm%40alpha&color=cb3837)](https://www.npmjs.com/package/codeclue)
[![status](https://img.shields.io/badge/status-alpha-orange)](#status)
[![node](https://img.shields.io/badge/node-%E2%89%A518-5fa04e)](#requirements)
[![license](https://img.shields.io/npm/l/codeclue?color=blue)](LICENSE)
[![deps](https://img.shields.io/badge/runtime%20deps-1-informational)](#why-it-is-small)

**Read a TypeScript file's shape without reading the file.** `codeclue` strips
function bodies and prints what is left — signatures, types, exports — so an AI
coding agent can understand unfamiliar code for a fraction of the tokens.

```bash
npx codeclue@alpha outline src/context.ts
```

```
~3293 tokens -> ~774 tokens (76% saved)
```

---

## Status

**Alpha.** One command works today:

| Command | Status |
| --- | --- |
| `clue outline <file>` | ✅ working |
| `clue version` | ✅ working |
| `clue graph <file>` | 🚧 not built yet |
| `clue trace <entry>` | 🚧 not built yet |
| `clue survey [dir]` | 🚧 not built yet |

Anything marked 🚧 will print `Unknown command` and exit `1`. The API and
the JSON shape may still change before `0.1.0`.

## Install

Run it without installing:

```bash
npx codeclue@alpha outline src/index.ts
```

Or install the binary globally — note the package is `codeclue`, the command is
`clue`:

```bash
npm install -g codeclue@alpha
```

<a id="requirements"></a>Requires **Node.js 18 or newer**. The `@alpha` tag
matters: without it you may get a different release once `0.1.0` ships.

## What `outline` does

Given this file:

```ts
/**
 * Fetch a user from the API.
 * This second line is dropped.
 */
export async function fetchUser(id: string): Promise<User> {
  const res = await fetch(`/users/${id}`);
  return (await res.json()) as User;
}

export class Repo<T extends { id: string }> {
  private readonly items = new Map<string, T>();
  constructor(private readonly label: string) {
    this.items.clear();
  }
  get size(): number {
    return this.items.size;
  }
}
```

`clue outline` prints:

```ts
/** Fetch a user from the API. */
export async function fetchUser(id: string): Promise<User> { /* ... */ }

export class Repo<T extends { id: string }> {
  private readonly items = new Map<string, T>();
  constructor(private readonly label: string) { /* ... */ }
  get size(): number { /* ... */ }
}
```

**Kept:** `export`, interfaces, type aliases, function and method signatures,
generics, overload signatures, class fields, the first sentence of each JSDoc.

**Dropped:** function bodies and the comments inside them.

Bodies are emptied for function declarations, methods, constructors, getters and
setters, function expressions, arrow functions, and methods inside object
literals. An arrow with an expression body (`(n) => n * 2`) is left alone — it is
already as short as its signature.

Signatures are never rebuilt by hand. The file is parsed with
[ts-morph](https://ts-morph.com), bodies are blanked **in memory**, and the
result is re-printed — so generics, overloads and your original formatting
survive exactly as written.

### Your files are never modified

`codeclue` only reads. It never calls `.save()`, never writes, and never creates
files next to yours. The test suite hashes each fixture before and after every
run and fails if a single byte changes.

## JSON output

Every command supports `--json` and returns the same envelope:

```bash
clue outline src/index.ts --json
```

```json
{
  "ok": true,
  "command": "outline",
  "version": "0.1.0-alpha.0",
  "contract": 1,
  "data": {
    "file": "src/index.ts",
    "outline": "export function hi(name: string): string { /* ... */ }\n",
    "originalTokens": 569,
    "outlineTokens": 371,
    "savedPercent": 35
  },
  "error": null
}
```

On failure, `ok` is `false`, `data` is `null`, and `error` is filled in:

```json
{
  "ok": false,
  "command": "outline",
  "version": "0.1.0-alpha.0",
  "contract": 1,
  "data": null,
  "error": { "code": "ENOENT", "message": "File not found: nope.ts" }
}
```

**`contract` is a version handshake for the shape of `data`.** It is bumped on
any breaking change, so a consumer expecting an older contract can fail loudly
instead of misreading the payload. Check it before trusting `data`.

### Error codes

| Code | Meaning |
| --- | --- |
| `EARGS` | A required argument is missing |
| `ENOENT` | The file does not exist |
| `EISDIR` | The path is a directory, not a file |
| `UNKNOWN_COMMAND` | No such command |
| `NO_COMMAND` | `--json` was passed with no command |
| `INTERNAL_ERROR` | Anything unexpected |

Exit code is `0` on success and `1` on failure.

## stdout vs stderr

Results go to **stdout**. Progress, warnings and the savings summary go to
**stderr**. That split is deliberate:

```bash
clue outline src/index.ts | pbcopy    # copies the outline only
```

The `~3293 tokens -> ~774 tokens` line never lands in your clipboard, your pipe, or
your redirected file.

## tsconfig

`codeclue` walks up from the target file looking for `tsconfig.json`. If it finds
one it is used, so your `compilerOptions` and path aliases are understood — but
its file list is **not** loaded, so pointing at one file in a large repo does not
drag in thousands of others.

If no `tsconfig.json` is found, it falls back to defaults and prints a warning to
stderr. It does not fail.

## Token counts are estimates

Counts use `characters ÷ 4` and are always shown as approximate (`~774 token`).
Different models tokenize differently — treat these as a ratio, not a bill.

<a id="why-it-is-small"></a>

## Why it is small

One runtime dependency: `ts-morph`. No argument-parsing library, no colour
library. `argv` is parsed by hand.

## Why this exists

An AI coding agent dropped into an unfamiliar codebase reads dozens of whole
files to answer one question. Most of that is irrelevant — the agent needs to
know *what exists and what shape it has*, not how it is implemented.

The guiding rule:

> The CLI does what is deterministic. The model does what needs reasoning.

Parsing an AST, walking an import graph and counting tokens always produce the
same answer, so they belong in a CLI, not in a context window. Every mechanical
step moved out of the model is a token not burned.

## License

MIT © 2026 rahardianz
