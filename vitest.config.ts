import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "scripts/",
        "agent/",
        "*.config.*",
        "*.d.ts",
        "main.tsx",
        "App.tsx",
        "src/components/**",
        "server.ts",
      ],
    },
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    isolate: true,
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});