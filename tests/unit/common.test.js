import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommonEnvironment } from '../support/unit/common-environment.js';
test('metadata uses UTC and preserves milliseconds through date round trip', async () => {
  const api = await createCommonEnvironment(),
    input = new Date('2026-10-26T12:34:56.789+03:00');
  assert.equal(api.getCurrentDateString(input), '2026-10-26T09:34:56.789Z');
  assert.equal(api.parseDateString(api.getCurrentDateString(input)).getTime(), input.getTime());
});

test('duration handles day boundaries, reversed inputs and durations longer than one day', async () => {
  const api = await createCommonEnvironment(),
    start = new Date('2026-10-25T23:59:59.250Z'),
    end = new Date('2026-10-27T00:00:01.750Z');
  assert.equal(api.getDifferenceInTime(start, end), '24:00:02');
  assert.equal(api.getDifferenceInTime(end, start), '24:00:02');
  assert.equal(api.getDifferenceInTime(start, start), '00:00:00');
  assert.match(
    api.getFormattedDateString(new Date(2026, 9, 26, 1, 2, 3)),
    /^01:02:03, 26\.10\.2026$/,
  );
});

test('generated offline IDs are valid, unique and carry the current timestamp', async () => {
  const api = await createCommonEnvironment(),
    now = Math.floor(Date.now() / 1000),
    ids = new Set();
  for (let i = 0; i < 100; i++) {
    const id = api.generateObjectId();
    assert.match(id, /^[a-f0-9]{24}$/);
    ids.add(id);
    assert.ok(Math.abs(parseInt(id.slice(0, 8), 16) - now) <= 1);
  }
  assert.equal(ids.size, 100);
});

test('free-space check subtracts usage and propagates a storage estimate failure', async () => {
  const available = await createCommonEnvironment();
  const unavailable = await createCommonEnvironment({
    navigator: {
      storage: {
        estimate: async () => {
          throw new Error('No quota');
        },
      },
    },
  });
  assert.equal(await available.getAvailableDiskSpace(), 9000);
  await assert.rejects(unavailable.getAvailableDiskSpace(), /No quota/);
});
