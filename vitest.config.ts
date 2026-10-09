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
      ],
    },
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    isolate: true,
    pool: "forks",
  },
  resolve: {
    alias: [
      { find: /^@services\/(.*)$/, replacement: path.resolve(__dirname, "src/server/services/$1") },
      { find: /^@routes\/(.*)$/, replacement: path.resolve(__dirname, "src/server/routes/$1") },
      { find: /^@handlers\/(.*)$/, replacement: path.resolve(__dirname, "src/server/handlers/$1") },
      { find: /^@config\/(.*)$/, replacement: path.resolve(__dirname, "src/server/config/$1") },
      { find: /^@utils\/(.*)$/, replacement: path.resolve(__dirname, "src/server/utils/$1") },
      { find: /^@server\/(.*)$/, replacement: path.resolve(__dirname, "src/server/$1") },
      { find: /^@lib\/(.*)$/, replacement: path.resolve(__dirname, "src/lib/$1") },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, "$1") },
    ],
  },
});
