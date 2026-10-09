import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'CLOUD_MODE=true NODE_ENV=production AUTH_ENABLED=false JWT_SECRET=playwright-test-secret AGENT_SHARED_SECRET=playwright-test-secret GEMINI_API_KEY=test-key TAVILY_API_KEY=test-key node dist/server.cjs',
    url: 'http://localhost:3000/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
});