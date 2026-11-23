import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
    exclude: ["app/e2e/**", "**/node_modules/**"],
    env: { TZ: "Europe/Madrid" },
  },
});
