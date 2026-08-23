import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  // Shebang ada di src/cli.ts; esbuild mempertahankannya dan tsup
  // menandai output sebagai executable.
  banner: {},
  sourcemap: false,
  dts: false,
});
