import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './browser-tests',
  workers: 1,
  use: {
    baseURL: process.env.REPORT_TEST_URL || 'http://localhost:80',
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
        (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined),
      args: ['--no-sandbox'],
    },
  },
});
