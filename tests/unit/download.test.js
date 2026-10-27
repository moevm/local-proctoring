import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createUploadEnvironment } from '../support/unit/upload-environment.js';
let environment;
beforeEach(async () => {
  environment = await createUploadEnvironment();
});
test('downloads remain alive until completion and remove their listeners', async () => {
  environment.interrupted = false;
  await environment.downloadBlob(new Blob(['data']), 'test.webm');
  assert.equal(environment.changes.size, 0);
});
