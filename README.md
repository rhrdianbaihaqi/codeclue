<div align="center">

# codeclue

**Your agent reads 5,600 tokens to learn what a file does.
It only needed 1,300.**

[![npm](https://img.shields.io/npm/v/codeclue/alpha?label=npm%40alpha&color=cb3837)](https://www.npmjs.com/package/codeclue)
[![status](https://img.shields.io/badge/status-alpha-orange)](#status)
[![node](https://img.shields.io/badge/node-%E2%89%A518-5fa04e)](#install)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-1-informational)](#why-its-small)
[![license](https://img.shields.io/npm/l/codeclue?color=blue)](LICENSE)

</div>

---

Point an AI coding agent at an unfamiliar repo and watch it burn context: it
opens whole files to answer one question. But it rarely needs the
implementation — it needs to know **what exists and what shape it has**.

`codeclue` deletes the bodies and keeps the shape.

```bash
npx codeclue@alpha outline src/context.ts
```

```
~5673 tokens -> ~3044 tokens (46% saved)
```

No install, no config, no API key. It reads one file and prints its skeleton.

## See it

```ts
// before — the implementation you mostly don't need
/**
 * Fetch a user from the API.
 * Retries twice on network failure, then throws.
 */
export async function fetchUser(id: string): Promise<User> {
  const res = await fetch(`/users/${id}`);
  if (!res.ok) throw new HttpError(res.status);
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

```ts
// after — everything an agent needs to call this code correctly
/** Fetch a user from the API. */
export async function fetchUser(id: string): Promise<User> { /* ... */ }

export class Repo<T extends { id: string }> {
  private readonly items = new Map<string, T>();
  constructor(private readonly label: string) { /* ... */ }
  get size(): number { /* ... */ }
}
```

Generics survive. Overloads survive. Your formatting survives. Nothing is
re-typed by hand — the file is parsed with [ts-morph](https://ts-morph.com),
bodies are blanked **in memory**, and the original text is printed back.

## The receipts

Run across every non-test `.ts`/`.tsx` file in [hono](https://github.com/honojs/hono)
and [h3](https://github.com/unjs/h3):

| | |
| --- | --- |
| Files processed | **274** |
| Failures | **0** |
| Tokens | **316,933 → 138,779** |
| Saved overall | **56%** |
| Median file | **58%** |

A sample, largest first:

| File | Before | After | Saved |
| --- | ---: | ---: | ---: |
| `h3/src/utils/proxy.ts` | 6,826 | 825 | **88%** |
| `h3/src/utils/request.ts` | 5,628 | 1,378 | **76%** |
| `hono/src/jsx/dom/render.ts` | 6,637 | 1,894 | **71%** |
| `hono/src/hono-base.ts` | 4,079 | 1,312 | **68%** |
| `hono/src/context.ts` | 5,673 | 3,044 | 46% |
| `hono/src/types.ts` | 22,457 | 22,422 | 0% |

That last row is not a bug — `types.ts` is pure type declarations. There are no
bodies to remove, so nothing is removed. **When in doubt, codeclue keeps it.**
Losing something you needed is far worse than leaving a little noise.

## Install

```bash
npx codeclue@alpha outline src/index.ts     # no install
npm install -g codeclue@alpha               # or keep it around
```

Requires **Node 18+**. The package is `codeclue`; the command is `clue`.
Keep the `@alpha` tag — it pins you to the prerelease line.

## Built for agents, not just humans

Every command speaks JSON:

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

`contract` is a version handshake for the shape of `data`. Bump-on-break means a
consumer built against contract 1 **fails loudly** instead of silently
misreading a future payload. Check it before you trust `data`.

Errors use the same envelope — `ok: false`, `data: null`, and a machine code:

| Code | Meaning |
| --- | --- |
| `EARGS` | Required argument missing |
| `ENOENT` | File does not exist |
| `EISDIR` | Path is a directory |
| `UNKNOWN_COMMAND` | No such command |
| `NO_COMMAND` | `--json` with no command |
| `INTERNAL_ERROR` | Anything unexpected |

Exit `0` on success, `1` on failure.

### Results to stdout, noise to stderr

```bash
clue outline src/index.ts | pbcopy   # copies the outline. Only the outline.
```

The `~5673 tokens -> ~3044 tokens` line, warnings, and progress all go to
stderr. Your pipe stays clean.

## It never touches your files

`codeclue` only reads. It never calls `.save()`, never writes, never drops a
file next to yours. The test suite hashes every fixture before and after each
run and **fails if one byte changes** — plus a static check that no write path
exists anywhere in `src/`.

## Status

Alpha. One command works today, and the roadmap is deliberate rather than long:

| Command | What it does | |
| --- | --- | --- |
| `clue outline <file>` | One file's skeleton | ✅ |
| `clue version` | Version + contract | ✅ |
| `clue graph <file> --depth N` | Walk the import graph, never entering `node_modules` | 🚧 |
| `clue trace <entry> --depth 2` | Layered map: entry in full, depth 1 as skeletons, depth 2 as export lists | 🚧 |
| `clue survey [dir]` | Token profile of a repo: heaviest files, suggested ignore list | 🚧 |

🚧 commands print `Unknown command` and exit `1`. The JSON shape may still shift
before `0.1.0` — that is what the `contract` field is for.

`trace` is the one this is all building toward: one command that hands an agent
a whole subsystem at the right level of detail.

## tsconfig, handled

`codeclue` walks up from your file to find `tsconfig.json`, uses your
`compilerOptions` and path aliases — but **does not load its file list**, so
outlining one file in a 5,000-file monorepo stays instant. No tsconfig? It falls
back to defaults, warns on stderr, and keeps going.

## Token counts are estimates

`characters ÷ 4`, always printed with a `~`. Tokenizers differ between models —
read these as a ratio, not a bill.

<a id="why-its-small"></a>

## Why it's small

One runtime dependency: `ts-morph`. No arg parser, no colour library, no
framework. `argv` is parsed by hand, in about 50 lines.

## The idea

> **The CLI does what is deterministic. The model does what needs reasoning.**

Parsing an AST, walking an import graph, counting tokens — these always produce
the same answer. They have no business consuming a context window. Every
mechanical step moved out of the model is a token spent on actual thinking.

## License

MIT © 2026 rahardianz
