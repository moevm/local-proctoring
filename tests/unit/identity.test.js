import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, createPublicKey } from 'node:crypto';
test('unpacked distribution keeps the shared extension ID', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../../client/manifest.json', import.meta.url), 'utf8'),
  );
  const der = Buffer.from(manifest.key, 'base64');
  assert.equal(createPublicKey({ key: der, type: 'spki', format: 'der' }).asymmetricKeyType, 'rsa');
  const id = [...createHash('sha256').update(der).digest().subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join('');
  assert.equal(id, 'nlhjjbgkbfkopkigkbkojpkbffbkeohg');
});
