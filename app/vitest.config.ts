import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.{ts,tsx}"],
    exclude: ["app/e2e/**", "**/node_modules/**"],
    // UTC+14, far from Madrid: code that reads the host zone instead of Madrid's fails here.
    env: { TZ: "Pacific/Kiritimati" },
  },
});
