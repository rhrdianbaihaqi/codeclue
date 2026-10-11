# Contributing

```bash
npm install
npm run typecheck && npm test && npm run build
```

Ground rules (details in `CLAUDE.md` and `SPEC.md`):

1. Zero runtime dependencies other than `ts-morph`. Parse `argv` by hand.
2. Every command supports `--json` with the standard envelope, and has tests against `tests/fixtures/`.
3. Results go to stdout, progress and status to stderr.
4. Never traverse into `node_modules`.
5. New command ideas go in `IDEAS.md`, not code. The command set is defined by `SPEC.md`.
6. When unsure whether something is noise, keep it.

Open an issue before large changes. Bug reports are most useful with the failing input and the
`--json` output.
