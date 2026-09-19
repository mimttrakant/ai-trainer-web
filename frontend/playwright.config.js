import { defineConfig } from "@playwright/test";
import process from "node:process";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://127.0.0.1:5180",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: process.env.TRAINING_LIVE_JOB ? undefined : {
    command: "npm run dev -- --host 127.0.0.1 --port 5180 --strictPort",
    url: "http://127.0.0.1:5180",
    reuseExistingServer: false,
  },
});
