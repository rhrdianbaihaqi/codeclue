# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The JSON `contract`
number only changes on breaking changes to the shape of `data`.

## [Unreleased]

### Added
- `clue survey [dir]`: token profile of a repo (top 20 files, total, ignore suggestions); respects `.gitignore`.
- CI workflow (typecheck, tests, build on Linux/macOS/Windows; runtime smoke test on Node 18/20).

### Changed
- `trace`: a neighbour at the outline layer whose outline saves <30% and whose file is >=1500 tokens (almost pure type declarations) is shown as `exports`, with the reason in its header and a pointer to `clue outline <path>`. On hono `src/hono-base.ts --depth 2`: ~33.7k -> ~9.7k tokens (79% saved vs 28%). JSON shape unchanged. Fixes #10.
- `clue <command> --help` prints that command's usage and examples; typos get a "Did you mean ...?" hint.
- Unknown options and extra arguments produce a stderr warning instead of being silently ignored.
- Clearer errors: relative missing paths mention the working directory; directories passed to `outline`/`graph`/`trace` point to an entry file or `clue survey`.
- README documents all four commands, with `trace` and `survey` examples.

## [0.1.0-alpha.0]

### Added
- `clue outline`, `clue graph`, `clue trace`, `clue version`; JSON envelope with `contract: 1`.
