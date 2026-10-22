// Hostinger publishes .next/standalone and runs the server.js at its top. In this
// monorepo Next nests the app under apps/web, so lift it up and add the static
// files that standalone output leaves out.
import { cpSync, existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const app = process.cwd();
const standalone = join(app, ".next/standalone");
const nestedPath = readdirSync(standalone, { recursive: true }).find((p) => p.endsWith("server.js") && !p.includes("node_modules"));
if (!nestedPath) throw new Error("No server.js in .next/standalone; is output: 'standalone' set?");
const nested = join(standalone, nestedPath, "..");

if (nested !== standalone) {
  for (const entry of readdirSync(nested)) {
    const from = join(nested, entry);
    const to = join(standalone, entry);
    if (entry === "node_modules" && existsSync(to)) cpSync(from, to, { recursive: true, force: false });
    else renameSync(from, to);
  }
  rmSync(join(standalone, relative(standalone, nested).split(/[\\/]/)[0]), { recursive: true });
}
cpSync(join(app, ".next/static"), join(standalone, ".next/static"), { recursive: true });
if (existsSync(join(app, "public"))) cpSync(join(app, "public"), join(standalone, "public"), { recursive: true });
console.log("Standalone server ready at .next/standalone/server.js");
