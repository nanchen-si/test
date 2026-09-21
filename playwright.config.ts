import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/chat/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "npm run dev --workspace @weather-assistant/weather-mcp",
      env: {
        WEATHER_MCP_DATA_SOURCE: "fixture",
        WEATHER_MCP_FAILURE_TEST_MODE: "1",
      },
      url: "http://127.0.0.1:3101/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run dev --workspace @weather-assistant/chat",
      env: {
        DEEPSEEK_API_KEY: "",
        WEATHER_MCP_FAILURE_TEST_MODE: "1",
      },
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "edge",
      use: { ...devices["Desktop Chrome"], channel: "msedge" },
    },
  ],
});
