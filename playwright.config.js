// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const PORT = 4173;

module.exports = defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    reducedMotion: "reduce", // apps disable animations; keeps clicks fast and stable
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory apps`,
    url: `http://127.0.0.1:${PORT}/shape-friends/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
