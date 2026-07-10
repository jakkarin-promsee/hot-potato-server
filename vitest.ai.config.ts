import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.ai.test.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    // Enables the live.ai.test.ts gate without a separate shell export.
    env: { RUN_AI_TESTS: "true" },
    // Match nodemon/dev — required on some Windows networks for Gemini TLS.
    execArgv: ["--use-system-ca"],
  },
});
