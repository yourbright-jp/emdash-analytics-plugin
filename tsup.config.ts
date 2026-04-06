import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    admin: "src/admin.tsx"
  },
  format: ["esm"],
  outDir: "dist",
  target: "es2022",
  sourcemap: false,
  clean: true,
  splitting: false,
  dts: false,
  external: [
    "emdash",
    "emdash/plugin-utils",
    "astro/zod",
    "react",
    "@emdash-cms/auth",
    "ulidx"
  ]
});
