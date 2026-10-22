// Plain JavaScript: Hostinger's servers have an old glibc, so Next falls back to
// its WebAssembly compiler there, which can't load a TypeScript config.
/** @type {import("next").NextConfig} */
const config = {
  // Hostinger runs the self-contained server from .next/standalone.
  output: "standalone",
  transpilePackages: ["@tevah/core"],
};

export default config;
