# codeclue

Extract the structure of a TypeScript codebase so an AI coding agent can
understand unfamiliar code with minimal tokens.

> **Status: early development.** Only `clue version` works today. The
> commands below are the planned MVP and are not implemented yet — do not
> depend on this package in a real workflow.

## The problem

When an AI coding agent works in a codebase it does not know, it reads
dozens of whole files to answer a single question. Most of that content is
irrelevant: the agent needs to know *what functions exist and what their
parameters look like*, not how they are implemented.

Answering "how does checkout work?" on a real repository:

| Without codeclue | With codeclue |
| --- | --- |
| 13 whole files, ~38,000 tokens | trace map ~900 tokens |
| still unsure, 4 more files | 1 full file ~2,100 tokens |
| | 5 skeletons ~1,200 tokens |
| **≈ 38,000** | **≈ 4,200** |

Target saving: 70–90% when exploring an unfamiliar codebase.

## Design principle

> The CLI does what is deterministic. The LLM does what needs reasoning.

Parsing an AST, walking the import graph and counting tokens always give
the same answer, so they belong in the CLI, not in a model's context
window. Every mechanical step moved into the CLI is a token not burned.

## Install

```bash
npm install -g codeclue
```

Requires Node.js 18 or newer. The binary is named `clue`.

## Usage

```bash
clue version          # works today
clue version --json
clue --help
```

### Planned commands

| Command | What it will do |
| --- | --- |
| `clue outline <file>` | One file's skeleton: signatures, types, exports — no function bodies |
| `clue graph <file> --depth N` | Walk the import graph; never descends into `node_modules` |
| `clue trace <entry> --depth 2` | Layered map: entry in full, depth 1 as skeletons, depth 2 as export lists |
| `clue survey [dir]` | Token profile of a repo: the 20 heaviest files and a suggested ignore list |

## JSON output

Every command supports `--json` and returns the same envelope:

```json
{
  "ok": true,
  "command": "version",
  "version": "0.1.0",
  "contract": 1,
  "data": {},
  "error": null
}
```

`contract` is a version handshake for the shape of `data`. It is bumped on
any breaking change, so a consumer expecting an older contract fails loudly
instead of misreading the payload silently.

On failure: `ok` is `false`, `data` is `null`, and `error` carries `code`
and `message`. Results go to stdout, progress and status go to stderr, so
`clue trace x | pbcopy` copies only the result.

Token counts are estimates (characters ÷ 4) and are always shown as such —
tokenizers differ between models.

## License

MIT © 2026 rahardianz
