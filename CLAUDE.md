# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Perintah

```bash
npm run build                    # tsup -> dist/cli.js (ESM, shebang)
npm run dev                      # tsup --watch
npm test                         # vitest run (semua test)
npx vitest run tests/outline.test.ts           # satu file test
npx vitest run -t "nama test"                  # satu test berdasarkan nama
npm run typecheck                # tsc --noEmit (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes)
node dist/cli.js outline src/run.ts --json     # jalankan CLI hasil build
```

Tidak ada linter. `prepublishOnly` menjalankan build + test.

## Status implementasi

`outline`, `graph`, `trace`, dan `version` sudah ada. Hanya `survey` yang masih rencana (lihat SPEC.md / BUILD-PLAN.md, yang
dikerjakan satu sesi per deliverable). Fixture: `tests/fixtures/sample.ts` (outline)
dan repo mini `tests/fixtures/mini/` (alias `@/`, circular import, `export *`,
pruning import). Mini repo dikecualikan dari tsconfig root agar `tsc` utama tidak
mengeluh soal alias; ia punya tsconfig sendiri.

## Arsitektur

- `src/cli.ts` hanya entry tipis (shebang + `run(process.argv)`) supaya modul bisa
  di-import tanpa efek samping. Logikanya di `src/run.ts`: parser argv manual,
  tabel `COMMANDS`, dan `run(argv, io)` yang menerima `stdout`/`stderr` injeksi
  untuk test (`tests/cli.test.ts`). Tiap handler
  mengembalikan `{ data, human, note }`: `data` masuk envelope `--json`, `human`
  ke stdout, `note` (ringkasan token) ke stderr dan disembunyikan saat `--json`.
  Error dilempar sebagai `CliError(code, message)` (`lib/errors.ts`) dan
  dikonversi menjadi `fail()` envelope di `run()`.
- `parseArgv`: flag boolean didaftar di `BOOLEAN_FLAGS`; flag lain dianggap
  bernilai. Flag boolean baru WAJIB ditambahkan ke set itu, kalau tidak ia
  menelan argumen posisional berikutnya.
- `src/envelope.ts`: `CONTRACT` adalah version handshake skema `data` — naikkan
  hanya bila bentuk `data` berubah secara breaking. `src/version.ts` adalah
  sumber `VERSION`.
- `lib/project.ts`: ts-morph `Project` sengaja ringan (tanpa memuat file dari
  tsconfig, tanpa lib files, tanpa dependency resolution); tsconfig dipakai
  hanya agar alias dan compilerOptions dikenali. Pemanggil menambah file sendiri.
- `commands/outline.ts`: implementasinya mengumpulkan daftar edit (body blok ->
  `{ /* ... */ }`, JSDoc dipangkas ke kalimat pertama + `@deprecated`), lalu
  menerapkannya lewat `lib/edits.ts` (`applyEdits`, splice string dari belakang
  ke depan; jangan kembali ke `replaceWithText` per edit — O(n²)). Import yang
  bindingnya tak muncul di outline dibuang oleh `lib/imports.ts`; pemakaian dicari
  lewat word-boundary termasuk di komentar/string (konservatif), import tanpa
  binding dan `React` di file JSX selalu dipertahankan. Arrow dengan body ekspresi
  dibiarkan; fungsi bersarang dilewati (`traversal.skip()`). Tidak pernah
  memanggil `.save()` — `tests/safety.test.ts` menegakkan ini (hash file
  sebelum/sesudah dan pemindaian `src/` untuk pemanggilan tulis).
- `commands/graph.ts` + `lib/resolve.ts`: BFS per lapis dari entry; specifier diambil
  dengan `ts.preProcessFile` (tanpa membangun ts-morph `Project`) dan di-resolve
  dengan `ts.resolveModuleName` memakai compilerOptions tsconfig (`paths`, ekstensi
  implisit, `/index`, `.js`->`.ts`). Hasil di `node_modules` atau
  `isExternalLibraryImport` selalu dilaporkan `external` dan TIDAK ditelusuri
  (aturan keras #5). Node di kedalaman maksimum tidak diperluas, jadi `importedBy`
  hanya memuat importer yang ikut diperluas. Siklus dicari dengan Tarjan iteratif
  dan dilaporkan di `cycles`; BFS memakai set visited sehingga tidak looping.
  Keluaran diurutkan agar deterministik. Import relatif ke file non-TS yang ada
  (`.svelte`, `.css`, `?url`) menjadi daun graph, bukan `unresolved`.
- `commands/trace.ts`: memanggil `graph(depth + 1)` — node satu tingkat di luar
  `--depth` tampil sebagai path agar pembaca tahu ada yang di luar batas. `classify()`
  (murni, diuji terpisah) memetakan kedalaman ke lapis `full/outline/exports/path`,
  lalu menggeser: fan-in >= `FAN_IN_PROMOTE` naik satu lapis (tidak sampai full),
  test jadi path, `.d.ts`/generated turun satu lapis; entry tidak pernah bergeser.
  Outline memakai `outlineSourceFile` dengan satu ts-morph `Project` bersama;
  daftar export murni sintaksis (`lib/exports.ts`). `totals.traceTokens` dihitung
  dari teks `formatTrace()` — teks itu sengaja tidak memuat angka totals.
  `vitest.config.ts` mengecualikan `tests/fixtures/**` (ada fixture bernama `*.test.ts`).
- Import antar file di `src/` ditulis tanpa ekstensi (`"./commands/outline"`);
  tsup yang melakukan bundling.

## Struktur direktori (target akhir)

```
codeclue/
├── .claude-plugin/
│   └── marketplace.json
├── skills/
│   └── codeclue-explore/SKILL.md
├── src/
│   ├── cli.ts              # entry tipis, shebang
│   ├── run.ts              # parse argv, router, run(argv, io)
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
