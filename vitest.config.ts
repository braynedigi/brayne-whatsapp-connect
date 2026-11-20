import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.tsx"],
    globals: false,
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
