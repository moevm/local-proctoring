import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import { createBrowserScenario } from '../support/browser/scenario.js';

export { expect };
export const test = base.extend({
  createScenario: async ({}, use, testInfo) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-browser-test-'));
    const scenarios = [],
      errors = [];
    try {
      await use(async (options) => {
        const scenario = await createBrowserScenario(
          path.join(directory, String(scenarios.length)),
          options,
        );
        scenarios.push(scenario);
        return scenario;
      });
    } finally {
      for (const scenario of scenarios.reverse()) {
        try {
          await testInfo.attach('browser-and-api', {
            contentType: 'application/json',
            body: JSON.stringify(
              {
                browser: scenario.session.context.browser()?.version(),
                requests: scenario.api.requests.map(({ method, path }) => ({ method, path })),
                browserErrors: scenario.session.errors,
                apiErrors: scenario.api.errors,
              },
              null,
              2,
            ),
          });
        } catch (error) {
          errors.push(error.message);
        } finally {
          errors.push(...scenario.session.errors, ...scenario.api.errors);
          try {
            await scenario.close();
          } catch (error) {
            errors.push(error.message);
          }
        }
      }
      await fs.rm(directory, { recursive: true, force: true });
      expect(errors, 'Unexpected browser/API errors or teardown failures').toEqual([]);
    }
  },
  scenario: async ({ createScenario }, use) => {
    await use(await createScenario());
  },
  app: async ({ scenario }, use) => {
    await use(scenario.app);
  },
  api: async ({ scenario }, use) => {
    await use(scenario.api);
  },
  session: async ({ scenario }, use) => {
    await use(scenario.session);
  },
  recording: async ({ scenario }, use) => {
    await use(scenario.recording);
  },
});
