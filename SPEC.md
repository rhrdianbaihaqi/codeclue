# codeclue — Spesifikasi Produk

## Satu kalimat

CLI yang mengekstrak struktur codebase TypeScript agar AI coding agent
bisa memahami kode asing dengan token minimal.

## Masalah

Saat AI coding agent bekerja di codebase yang belum dipahami, dia membaca
puluhan file utuh untuk menjawab satu pertanyaan. Sebagian besar isi file
itu tidak relevan — agent hanya perlu tahu *fungsi apa yang tersedia dan
bagaimana bentuk parameternya*, bukan isi implementasinya.

Contoh nyata, pertanyaan "bagaimana alur checkout bekerja?":

| Tanpa codeclue | Dengan codeclue |
|---|---|
| Baca 13 file utuh | Jalankan `clue trace` (0 token LLM) |
| ~38.000 token | Peta hasil trace: ~900 token |
| Masih ragu, baca 4 file lagi | 1 file utuh: ~2.100 token |
| | 5 file skeleton: ~1.200 token |
| **Total ≈ 38.000** | **Total ≈ 4.200** |

Target penghematan: **70–90%** pada skenario eksplorasi codebase asing.

## Prinsip inti

> CLI mengerjakan yang deterministik. LLM mengerjakan yang butuh penalaran.

- **Deterministik (CLI):** parsing AST, telusuri import graph, hitung token,
  klasifikasi lapisan. Jawabannya selalu sama — haram diserahkan ke LLM.
- **Penalaran (skill/LLM):** memutuskan file mana yang penting, menyimpulkan
  arsitektur, menjelaskan ke manusia.

Setiap pekerjaan mekanis yang dipindahkan ke CLI adalah token yang tidak dibakar.

## Command MVP

### 1. `clue outline <file>`
Skeleton satu file: signature, tipe, export — tanpa isi body fungsi.

Pertahankan: `export`, interface, type alias, signature fungsi/method,
generic, JSDoc baris pertama.
Buang: isi body fungsi, komentar internal, import yang tidak dipakai
di signature.

### 2. `clue graph <file> --depth N`
BFS di import graph mulai dari file. Menangani relative path, alias
`tsconfig.paths`, dan bare import.
**Tidak pernah masuk `node_modules`** — berhenti di batas itu, catat
sebagai dependency eksternal.

### 3. `clue trace <entry> --depth 2`  ⭐ command utama
Gabungan graph + outline dengan klasifikasi berlapis:

| Lapis | Perlakuan |
|---|---|
| entry | isi utuh |
| depth 1 | outline (skeleton) |
| depth 2 | daftar export saja |
| depth 3+ | path saja |

Heuristik prioritas:
- Naikkan lapis untuk file dengan fan-in tinggi (banyak yang mengimpor).
- Turunkan/buang: `*.test.ts`, `*.spec.ts`, `*.d.ts`, generated code.

### 4. `clue survey [dir]`
Profil token seluruh repo: 20 file paling boros, total token,
saran ignore list. Hormati `.gitignore`.

## Kontrak output

Semua command WAJIB mendukung `--json` dengan envelope ini:

```json
{
  "ok": true,
  "command": "trace",
  "version": "0.1.0",
  "contract": 1,
  "data": { },
  "error": null
}
```

Field `contract` adalah version handshake. Kalau skema `data` berubah
secara breaking, naikkan nomornya. Skill yang mengharapkan kontrak lama
harus gagal dengan pesan jelas, bukan salah membaca diam-diam.

Saat error: `ok: false`, `data: null`, `error: { code, message }`.

## Hitungan token

MVP: estimasi `panjang_karakter / 4`.
SELALU tampilkan sebagai estimasi (`~4.200 token`), jangan sebagai angka
pasti — tokenizer berbeda antar model. Upgrade ke `js-tiktoken` menyusul.

## Non-goal (JANGAN dibangun di MVP)

- Bahasa selain TypeScript/JavaScript
- Web UI atau dashboard
- Integrasi langsung ke API LLM
- Caching / index persisten
- Watch mode
- Konfigurasi file (`.codecluerc`) — MVP harus jalan tanpa konfigurasi
- Command di luar empat di atas

Kalau ada ide di luar daftar ini muncul saat build, catat di `IDEAS.md`
dan lanjutkan. Jangan implementasikan.

## Kriteria sukses MVP

1. Keempat command jalan tanpa crash di 3 repo TypeScript open source.
2. `clue trace` pada file nyata menghasilkan penghematan ≥70% dibanding
   membaca seluruh modul.
3. Ada satu SKILL.md yang terbukti mengubah perilaku agent (agent
   menjalankan trace lebih dulu, bukan membuka file serampangan).
4. Terpublish di npm dan bisa dijalankan lewat `npx codeclue`.
5. README memuat tabel bukti penghematan token dari ≥5 repo.
