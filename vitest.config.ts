import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Fixture boleh bernama *.test.ts (untuk menguji deteksi file test); bukan test sungguhan.
    exclude: [...configDefaults.exclude, "tests/fixtures/**"],
    environment: "node",
  },
});
