import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
  },
  // Don't start a dev server — assume it's already running
  webServer: undefined,
});
