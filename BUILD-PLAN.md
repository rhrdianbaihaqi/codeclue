# Rencana Build codeclue — 9 Sesi

Aturan main tiap sesi:
1. Mulai dengan `/clear` di Claude Code
2. Kerjakan **satu** deliverable saja
3. Baca diff-nya — kalau ada yang tidak kamu pahami, tanya sekarang
4. Verifikasi manual
5. Commit, tutup sesi

Kalau sesi berantakan: `git reset --hard HEAD` dan ulangi. Itu sebabnya
kita commit tiap sesi.

---

## Sesi 1 — Scaffold + envelope

**Prompt:**
```
Baca SPEC.md dan CLAUDE.md.

Buat scaffold proyek:
- tsup.config.ts: ESM, target node18, shebang di output
- vitest.config.ts
- src/envelope.ts: helper ok(command, data) dan fail(command, code, message)
  yang menghasilkan { ok, command, version, contract: 1, data, error }
- src/cli.ts: parse argv manual (tanpa library), dukung --json, --help,
  --version. Router command sederhana.
- Satu command "version" untuk memverifikasi pipeline end-to-end
- Test untuk envelope.ts

Jangan buat command lain.
```

**Verifikasi:**
```bash
npm run build
node dist/cli.js version --json     # harus keluar JSON valid
node dist/cli.js --help
npm test
```

**Commit:** `chore: scaffold + envelope contract`

---

## Sesi 2 — `outline` (inti)

**Prompt:**
```
Implementasikan command: clue outline <file>

Pakai ts-morph. Ikuti pendekatan di CLAUDE.md — kosongkan body fungsi
di memori lalu print ulang getFullText(). JANGAN menyusun string
signature secara manual.

Pertahankan: export, interface, type alias, signature fungsi/method,
generic, JSDoc baris pertama.
Buang: isi body fungsi, komentar internal.

Output --json:
{ file, outline, originalTokens, outlineTokens, savedPercent }

Buat src/lib/count.ts untuk estimasi token (karakter / 4).
Tulis test dengan fixture: fungsi async, generic, class dengan method,
arrow function, default export.
```

**Verifikasi:** jalankan ke file TypeScript nyata, baca hasilnya.
Signature harus utuh dan bisa dipahami tanpa body.

**Commit:** `feat: outline command`

---

## Sesi 3 — Pengerasan `outline`

**Prompt:**
```
Jalankan clue outline terhadap 15 file berbeda di ../fixtures-real/.
Temukan kasus yang hasilnya rusak, tidak valid secara sintaks, atau
kehilangan informasi penting.

Perbaiki satu per satu. Tambahkan test regresi untuk tiap perbaikan.

Perhatikan khusus: function overload, decorator, abstract class,
namespace, export * from, const assertion, dan file .tsx.
```

**Commit:** `fix: outline edge cases`

---

## Sesi 4 — `graph`

**Prompt:**
```
Implementasikan: clue graph <file> --depth N

BFS di import graph. Buat src/lib/resolve.ts yang menangani:
- relative path (./ dan ../)
- alias dari tsconfig paths (@/...)
- ekstensi implisit (.ts, .tsx, .js, /index.ts)
- bare import → catat sebagai eksternal, JANGAN masuk node_modules

Deteksi circular import dan tangani tanpa infinite loop.

Output --json:
{ entry, nodes: [{ path, depth, importedBy: [] }], edges, external: [] }
```

**Verifikasi:** jalankan di repo nyata dengan `--depth 3`, pastikan tidak
hang dan tidak ada path `node_modules` di hasil.

**Commit:** `feat: import graph command`

---

## Sesi 5 — `trace` ⭐

**Prompt:**
```
Implementasikan: clue trace <entry> --depth 2

Gabungkan graph + outline dengan klasifikasi berlapis sesuai SPEC.md:
entry = utuh, depth 1 = outline, depth 2 = daftar export, depth 3+ = path.

Heuristik:
- Naikkan lapis untuk file dengan fan-in tinggi
- Turunkan/buang *.test.ts, *.spec.ts, *.d.ts

Output --json berisi konten tiap lapis, token per file, total token,
dan perbandingan "kalau semua file dibaca utuh berapa token".
```

**Verifikasi:** jalankan ke entry point nyata. Cek angka penghematannya
masuk akal (target ≥70%).

**Commit:** `feat: trace command with layered context`

---

## Sesi 6 — `survey`

**Prompt:**
```
Implementasikan: clue survey [dir]

Pindai repo, hormati .gitignore. Output --json:
- 20 file paling boros token
- total token repo
- saran ignore list (lockfile, generated, snapshot, dist, coverage)

Output human-readable berupa tabel yang rapi ke stdout.
```

**Commit:** `feat: survey command`

---

## Sesi 7 — Pengerasan menyeluruh

**Prompt:**
```
Uji keempat command terhadap 3 repo di ../fixtures-real/.
Perbaiki setiap crash.

Pastikan pesan error jelas dan actionable untuk kasus:
- file tidak ada
- file bukan TypeScript/JavaScript
- tsconfig.json tidak ditemukan
- dijalankan di folder tanpa package.json
- entry point berupa folder, bukan file

Pastikan stdout hanya berisi output, semua progress ke stderr.
Lengkapi --help tiap command.
```

**Commit:** `fix: error handling and CLI polish`

---

## Sesi 8 — SKILL.md

**Prompt:**
```
Buat skills/codeclue-explore/SKILL.md.

Ini instruksi PROSEDURAL untuk AI coding agent, bukan dokumentasi.
Gaya: imperatif, langkah bernomor, larangan eksplisit.

Struktur:
- frontmatter: name, description berisi trigger phrase
  ("gimana X bekerja", "telusuri alur", "saya baru di repo ini")
- Kapan dipakai
- Aturan keras:
  1. JANGAN membaca file apa pun sebelum menjalankan clue trace
  2. Maksimal 3 file dibaca utuh per sesi
  3. Kalau butuh area lain, jalankan trace ulang dengan entry berbeda
     — jangan membuka file serampangan
- Prosedur bernomor yang memanggil npx codeclue
- Format output ke pengguna, termasuk laporan estimasi penghematan token
```

**Commit:** `feat: codeclue-explore skill`

---

## Sesi 9 — Uji skill di lapangan (paling penting)

Ini bukan sesi koding — ini iterasi menulis.

**Cara:** buka repo asing, aktifkan skill, minta agent menjelaskan sebuah
alur. Amati: apakah dia menjalankan `clue trace` lebih dulu, atau langsung
membuka file satu per satu?

Kalau tidak patuh, pertajam kalimat aturannya dan ulangi. Biasanya butuh
5–10 putaran. Bagian "Aturan keras" itulah produkmu — tanpa larangan yang
tegas, agent akan kembali ke kebiasaan lamanya.

**Commit:** `fix: sharpen skill rules`

---

## Setelah sesi 9

**Kumpulkan bukti angka.** Ambil 5 repo open source, jalankan skenario
yang sama dengan dan tanpa codeclue, catat selisih token. Tabel ini
adalah README-mu, pitch-mu, dan isi post promosimu sekaligus.

**Publish:**
```bash
npm publish --dry-run     # cek isi tarball
npm publish
```

**Plugin Claude Code:** untuk format `.claude-plugin/marketplace.json`,
contek dari repo pocketto (contoh yang terbukti jalan), lalu cocokkan
dengan dokumentasi Claude Code terkini — skema plugin bisa berubah.

**Promosi:** Show HN, r/webdev, X, komunitas dev Indonesia. Sertakan GIF
terminal (pakai `vhs` atau `asciinema`).
