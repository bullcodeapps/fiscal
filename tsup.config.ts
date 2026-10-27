import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "nfse/index": "src/nfse/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "node20",
});
