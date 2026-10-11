# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The JSON `contract`
number only changes on breaking changes to the shape of `data`.

## [Unreleased]

### Added
- `clue survey [dir]`: token profile of a repo (top 20 files, total, ignore suggestions); respects `.gitignore`.
- CI workflow (typecheck, tests, build on Linux/macOS/Windows; runtime smoke test on Node 18/20).

### Changed
- README documents all four commands, with `trace` and `survey` examples.

## [0.1.0-alpha.0]

### Added
- `clue outline`, `clue graph`, `clue trace`, `clue version`; JSON envelope with `contract: 1`.
