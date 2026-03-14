import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'crash-isolation.spec.ts',
  timeout: 180_000,
  retries: 0,
  workers: 1, // serial — one browser at a time
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: false, // extensions require headed mode
    viewport: { width: 1280, height: 900 },
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
});
