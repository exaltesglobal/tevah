// Plain JavaScript: Hostinger's servers have an old glibc, so Next falls back to
// its WebAssembly compiler there, which can't load a TypeScript config.
/** @type {import("next").NextConfig} */
const config = {
  // Hostinger runs the self-contained server from .next/standalone.
  output: "standalone",
  transpilePackages: ["@tevah/core"],
  experimental: {
    // Uploads (bank statements, the Odoo export) go through server actions, whose default limit is 1 MB.
    serverActions: { bodySizeLimit: "16mb" },
  },
};

export default config;
