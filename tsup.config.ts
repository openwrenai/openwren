import { defineConfig } from "tsup";

// Externalize all node_modules (direct and transitive) — anything that's not
// a relative import. The app ships with its own node_modules at install time.
const external = [/^[^./]/];

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    target: "node22",
    platform: "node",
    outDir: "dist",
    splitting: false,
    dts: false,
    external,
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    target: "node22",
    platform: "node",
    outDir: "dist",
    splitting: false,
    dts: false,
    external,
  },
]);
