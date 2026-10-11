---
name: codeclue-explore
description: Explore an unfamiliar TypeScript/JavaScript codebase with minimal tokens by running `clue trace` before opening any file. Use when the user asks how something works or to trace a flow - "how does X work", "trace the flow of X", "walk me through X", "where is X handled", "I'm new to this repo", "gimana X bekerja", "telusuri alur X", "saya baru di repo ini", "jelaskan arsitektur". Do not use for editing a file you already know, or for non-TS/JS repos.
---

# Explore a codebase with codeclue

`clue` is deterministic: it parses the code and returns a layered map for ~0 LLM
tokens. Your job is to reason over that map, not to rebuild it by opening files.

## Hard rules

1. **Do NOT read the contents of any source file until you have run `clue trace`.**
   No `cat`, no Read, no content search of source files first. Listing or globbing
   file *names* to find an entry point is allowed.
2. **Read at most 3 files in full per session.** `clue outline <file>` does not count.
   Count every full read, and stop at 3.
3. **Need another area? Run `clue trace` again with a different entry.**
   Do not browse, grep around, or open files "to get a feel".
4. **Never present a path-only or exports-only file as understood.** You have seen
   its name or its API, not its behavior. Say so, or outline it first.
5. **Token numbers are estimates.** Always write them with `~`.

## When to use

The user asks how something works, wants a flow traced, or is new to a TS/JS repo.
Skip it when you are told the exact file and a small edit to make.

## Procedure

1. **Pick one entry file** from the question. Find it by name only:
   `git ls-files | grep -i <keyword>` or a glob. Prefer the file that wires the feature
   together (route, handler, service, `index.ts`, `main.ts`) over a leaf utility.
   If the repo is large and you have no idea where to start, run
   `npx github:rhrdianbaihaqi/codeclue survey` first to see the heaviest files and the directory shape.
2. **Run the trace with `--depth 1` first**, from the repo root, as a plain command
   (no shell variables or wrappers around it):
   `npx github:rhrdianbaihaqi/codeclue trace <entry> --depth 1`
   If the entry file is huge (the map's first section is thousands of tokens), add `--outline-entry` to see it as a skeleton.
   Go to `--depth 2` only if the depth-1 map was small (the last line says
   `~X tokens`; under about 3000 is fine). A header like `[exports · outline saves 0% ...]` means a type-heavy
   file was reduced to its export names; run `clue outline <path>` only if you need it. If the tool says the output is
   too large, never read all of it: rerun with a narrower entry, and outline only the
   files you need.
3. **Read the map, top to bottom.** Layers are:
   - `[entry · full]`: the entry's whole source.
   - `[outline]`: signatures and types, bodies removed (`/* ... */`).
   - `[exports]`: only the export names.
   - `[path]`: just a path; depth limit, a test, or generated code.
   - `### cycles`: files that import each other.
   The last stderr line reports `N files: ~X tokens vs ~Y if read in full (Z% saved)`.
4. **Answer from the map where you can.** Name the files, the functions, and how they
   connect, using only what the map shows.
5. **Go deeper only where needed.** For one specific file, in this order:
   1. `npx github:rhrdianbaihaqi/codeclue outline <file>` (cheap skeleton; one or two files at a time,
      not a loop over the whole directory),
   2. then, only if you must see the logic, read it in full (counts toward the limit of 3).
6. **Different area?** Back to step 1 with a new entry. Never exceed the limit of 3
   full reads; if you are at 3, trace again or tell the user what you could not verify.
7. **Report** in the format below.

## If `clue` fails

- Read the `Error:` line; it says what to fix (wrong path, directory instead of file,
  unsupported file type). Correct the argument and rerun.
- `Did you mean ...?` means a mistyped command. Use the suggestion.
- If `npx` cannot run (no network or no Node), tell the user, then fall back to reading
  files, but still open as few as you can.
- Never respond to an error by opening a pile of files.

## Output to the user

Keep it short and grounded in the map:

1. **Answer** (a few sentences): how it works, in the user's language.
2. **Flow**: the key files in order, one line each, `path - what it does`.
3. **Not verified**: files you saw only as `[exports]` or `[path]`, and anything
   that depends on a body you did not read.
4. **Cost**: `Used codeclue: ~X tokens of context vs ~Y to read these N files in full
   (~Z% less, estimated). Full reads: K of 3.`
