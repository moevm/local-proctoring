import { webcrypto } from 'node:crypto';
import { loadClientModule } from './load-client-module.js';

/** Common utilities with deterministic browser storage capacity and real UTC dates. */
export function createCommonEnvironment(globals = {}) {
  return loadClientModule(
    'common.js',
    {
      crypto: webcrypto,
      navigator: { storage: { estimate: async () => ({ quota: 10000, usage: 1000 }) } },
      ...globals,
    },
    { './logger.js': { logClientAction() {} } },
  );
}
