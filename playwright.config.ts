import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e', fullyParallel: false, workers: 1, retries: 0,
  timeout: 90000, expect: { timeout: 15000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: true, actionTimeout: 20000, viewport: { width: 1440, height: 1000 }, locale: 'de-DE',
    trace: 'retain-on-failure', screenshot: 'only-on-failure'
  }
});
