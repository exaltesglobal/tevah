import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Integration tests share one throwaway database, so files run one at a time.
  test: { testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false },
});
