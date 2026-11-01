// End-to-end tests (Playwright): real browser, real build, real localStorage.
// Run with `npm run test:e2e`. First time on a machine: `npx playwright install chromium`.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.js", // not *.test.js, so Vitest never picks these up
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:4174",
    ...devices["Desktop Chrome"],
  },
  // Builds once and serves the production bundle while the tests run.
  webServer: {
    command: "npm run build && npx vite preview --port 4174 --strictPort",
    url: "http://localhost:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
