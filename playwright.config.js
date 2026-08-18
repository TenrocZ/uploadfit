import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/e2e/**/*.spec.js', '**/integration/**/*.test.js'],
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:8765',
    headless: true
  }
});
