// Builds dist/din-rail-cards.js, the one file Home Assistant loads.
//   --watch  rebuild it on every change
//   --serve  also serve it at http://localhost:5050/din-rail-cards.js, for
//            the demo of the Home Assistant frontend (see the README)
import { context } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
// A release build takes its version from the tag (v1.2.3)
const version = process.env.VERSION || pkg.version;
const serve = process.argv.includes("--serve");
const watch = serve || process.argv.includes("--watch");
const PORT = Number(process.env.PORT) || 5050;

const ctx = await context({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  outfile: "dist/din-rail-cards.js",
  define: {
    DIN_RAIL_VERSION: JSON.stringify(watch ? `${version}-dev` : version),
  },
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
}
if (serve) {
  // The demo runs on another port, so it needs CORS to load the module
  await ctx.serve({ port: PORT, servedir: "dist", cors: { origin: "*" } });
  console.log(`Serving http://localhost:${PORT}/din-rail-cards.js`);
}
if (!watch) {
  await ctx.rebuild();
  await ctx.dispose();
}
