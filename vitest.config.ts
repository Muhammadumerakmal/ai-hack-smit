import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // DB tests share one database; run files one at a time.
    fileParallelism: false,
    env: {
      ...loadEnv(mode, process.cwd(), ""), // DATABASE_URL from .env / .env.local
      // Run against a separate database: TEST_DATABASE_URL=postgresql://hcm:hcm@localhost:5432/hcm_a npx vitest run …
      ...(process.env.TEST_DATABASE_URL ? { DATABASE_URL: process.env.TEST_DATABASE_URL } : {}),
      APP_TZ: "Asia/Karachi",
      JWT_SECRET: "test-secret",
      AI_TIMEOUT_MS: "500",
    },
  },
}));
