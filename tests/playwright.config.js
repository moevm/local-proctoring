import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './ui',
  testMatch: '**/*.spec.js',
  timeout: 60000,
  expect: { timeout: 15000 },
  // Desktop capture and focus are shared by an Xvfb display.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  outputDir: './reports/artifacts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
    ['junit', { outputFile: 'reports/junit.xml' }],
  ],
});
