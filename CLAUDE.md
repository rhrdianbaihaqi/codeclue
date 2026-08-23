# codeclue

CLI yang mengekstrak struktur codebase TypeScript untuk konsumsi AI coding agent.
Tujuannya: agent memahami kode asing dengan token minimal.

**Baca `SPEC.md` untuk spesifikasi lengkap sebelum mengerjakan apa pun.**

## Stack

- TypeScript (strict mode)
- `ts-morph` — satu-satunya runtime dependency
- `tsup` — build (ESM, target node18, shebang)
- `vitest` — testing
- Node ≥ 18, ESM (`"type": "module"`)

## Aturan keras

1. **Zero runtime dependency selain `ts-morph`.** Jangan tambahkan
   commander, yargs, chalk, atau apa pun. Parse `argv` manual.
2. **Setiap command WAJIB mendukung `--json`** dengan envelope standar
   (lihat SPEC.md, bagian "Kontrak output").
3. **Setiap command WAJIB punya test** terhadap fixture di `tests/fixtures/`.
4. **JANGAN menambah command di luar SPEC.md.** Kalau ada ide baru,
   tulis ke `IDEAS.md`, jangan diimplementasikan.
5. **JANGAN pernah masuk `node_modules`** saat menelusuri import.
6. **Log bersih ke `stdout`, pesan status/progress ke `stderr`.**
   Supaya `clue trace x | pbcopy` tidak ikut menyalin progress.

## Prinsip desain

**CLI deterministik, LLM bernalar.** Kalau suatu pekerjaan jawabannya
selalu sama (parsing, traversal, hitung), kerjakan di CLI. Jangan pernah
menyerahkannya ke LLM.

**Kalau ragu, pertahankan.** Saat tidak yakin apakah sebuah baris/simbol
itu noise atau bukan — simpan. Membuang informasi penting jauh lebih
merusak kepercayaan daripada menyisakan sedikit noise.

**Untuk `outline`: jangan menyusun signature secara manual.**
Muat file ke ts-morph, kosongkan body fungsi di memori, lalu print ulang
`getFullText()`. ts-morph mengurus formatting, generic, dan overload
otomatis. Menyusun string manual akan tenggelam di edge case.

```ts
const sf = project.addSourceFileAtPath(path);
sf.forEachDescendant(node => {
  if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
    node.getBody()?.replaceWithText("{ /* ... */ }");
  }
});
const outline = sf.getFullText();
```

## Struktur direktori

```
codeclue/
├── .claude-plugin/
│   └── marketplace.json
├── skills/
│   └── codeclue-explore/SKILL.md
├── src/
│   ├── cli.ts              # entry, shebang, parse argv
│   ├── envelope.ts         # ok() / fail()
│   ├── commands/
│   │   ├── outline.ts
│   │   ├── graph.ts
│   │   ├── trace.ts
│   │   └── survey.ts
│   └── lib/
│       ├── project.ts      # setup ts-morph
│       ├── resolve.ts      # resolusi import + alias tsconfig
│       └── count.ts        # estimasi token
├── tests/
│   └── fixtures/           # repo mini untuk uji
├── SPEC.md
├── BUILD-PLAN.md
└── package.json
```

## Testing

Fixture harus mencakup minimal: fungsi async, generic, class dengan method,
arrow function, function overload, default export, re-export (`export *`),
circular import, dan import lewat alias `@/`.

Test untuk `outline` harus menegaskan: signature tetap utuh, body hilang,
tipe tidak berubah.

## Publish

```json
{
  "name": "codeclue",
  "bin": { "clue": "./dist/cli.js" },
  "files": ["dist"],
  "type": "module",
  "engines": { "node": ">=18" }
}
```

Nama paket `codeclue`, nama binary `clue`. Jangan tertukar.
