# Ideas

Di luar SPEC.md — dicatat, belum diimplementasikan.

- **`trace --outline-entry`**: tampilkan entry sebagai outline, bukan isi utuh.
  Di repo nyata (mis. entry 1.400 baris) entry utuh mendominasi token peta
  (penghematan hanya 11–35%); outline-entry cocok untuk orientasi awal sebelum
  memilih file yang dibuka utuh.
- **`graph`/`trace` untuk `.svelte`/`.vue`**: sekarang file itu hanya daun (path saja)
  dan import di dalam `<script>`-nya tidak ditelusuri.
