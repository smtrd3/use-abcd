import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./test-setup/vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      all: true,
      provider: "v8",
      reporter: ["clover", "lcov", "text"],
      include: ["src"],
    },
    typecheck: {
      enabled: true,
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
  },
});
