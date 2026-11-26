// Builds dist/din-rail-cards.js, the one file Home Assistant loads.
// --watch rebuilds it on every change.
import { context } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
// A release build takes its version from the tag (v1.2.3)
const version = process.env.VERSION || pkg.version;
const watch = process.argv.includes("--watch");

const ctx = await context({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  outfile: "dist/din-rail-cards.js",
  define: { DIN_RAIL_VERSION: JSON.stringify(version) },
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
