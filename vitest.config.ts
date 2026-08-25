import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ["src/test/setup.ts"],
    globalSetup: ["src/test/globalSetup.ts"],
  },
  resolve: {
    alias: {
      "@domain": path.resolve("src/domain"),
      "@shared": path.resolve("src/shared"),
      "@server": path.resolve("src/server"),
    },
  },
});
