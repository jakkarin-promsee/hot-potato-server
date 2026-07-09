import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.ai.test.ts"],
    fileParallelism: false, // one in-memory mongod at a time — deterministic
    testTimeout: 20000,
    hookTimeout: 120000, // first run downloads the mongod binary (~100MB)
  },
});
