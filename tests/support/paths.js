import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CLIENT_ROOT = fileURLToPath(new URL('../../client/', import.meta.url));
export const MANIFEST = JSON.parse(
  fs.readFileSync(new URL('../../client/manifest.json', import.meta.url)),
);
export const EXTENSION_URL = 'chrome-extension://nlhjjbgkbfkopkigkbkojpkbffbkeohg';
