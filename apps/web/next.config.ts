import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@tevah/core"],
  serverExternalPackages: ["@node-rs/argon2"],
};

export default config;
