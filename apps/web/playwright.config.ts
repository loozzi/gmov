import { defineConfig } from "@playwright/test";

// E2E runs against a Next DEV server (so the dev-only /e2e/* test routes
// exist) backed by the compose API stack (db/redis/api must be up:
// `docker compose up -d db redis api`).
//
// Env:
//   PLAYWRIGHT_BASE_URL    web under test (default http://localhost:3100)
//   PLAYWRIGHT_BACKEND_URL backend api for seeding (default http://localhost:8000)
//   CI                     when set, never reuse a running dev server
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
const BACKEND_URL =
  process.env.PLAYWRIGHT_BACKEND_URL ?? "http://localhost:8000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    // NOTE: no shared storageState on purpose. Refresh rotation invalidates
    // a refresh cookie on first use, so a static cookie file works for exactly
    // one test. Each spec logs in via loginViaApi() (helpers/auth.ts) instead.
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
    },
  },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  webServer: {
    command: "pnpm --filter gmov-web dev --port 3100 --hostname 127.0.0.1",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      BACKEND_URL,
      PUBLIC_API_URL: BACKEND_URL,
    },
  },
});
