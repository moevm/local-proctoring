import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoggerEnvironment } from '../support/unit/logger-environment.js';
test('logger caps history at 10000 entries while retaining the newest batch', async () => {
  const environment = await createLoggerEnvironment({
    extension_logs: JSON.stringify(
      Array.from({ length: 10000 }, (_, n) => ({ action: 'old-' + n })),
    ),
  });
  environment.logClientAction('new');
  await environment.flushLogs();
  const logs = JSON.parse(environment.state.extension_logs);
  assert.equal(logs.length, 10000);
  assert.equal(logs.at(-1).action, 'new');
  assert.equal(logs[0].action, 'old-1');
});

test('overlapping flushes do not duplicate entries or lose subsequent batches', async () => {
  const environment = await createLoggerEnvironment();
  environment.logClientAction('first');
  await Promise.all([environment.flushLogs(), environment.flushLogs()]);
  environment.logClientAction('second');
  await environment.flushLogs();
  assert.deepEqual(
    JSON.parse(environment.state.extension_logs).map((row) => row.action),
    ['first', 'second'],
  );
});

test('logger replaces malformed history with valid current events during flush', async () => {
  const environment = await createLoggerEnvironment({ extension_logs: '{broken' });
  environment.logClientAction('after corruption');
  await environment.flushLogs();
  assert.equal(JSON.parse(environment.state.extension_logs)[0].action, 'after corruption');
  assert.equal(environment.prepareLogs('{broken')[0].error, 'Invalid logs');
});

test('failed storage write preserves buffered logs for a later retry', async () => {
  const environment = await createLoggerEnvironment({}, { writeError: true });
  environment.logClientAction('must survive');
  await environment.flushLogs();
  assert.equal(environment.state.extension_logs, undefined);
  environment.flags.writeError = false;
  await environment.flushLogs();
  assert.equal(JSON.parse(environment.state.extension_logs)[0].action, 'must survive');
});

test('single oversized event does not exceed the 8 MiB storage budget', async () => {
  const environment = await createLoggerEnvironment();
  environment.logClientAction({ action: 'large event', message: 'x'.repeat(9 * 1024 * 1024) });
  await environment.flushLogs();
  assert.ok(new TextEncoder().encode(environment.state.extension_logs).length <= 8 * 1024 * 1024);
  assert.ok(Array.isArray(JSON.parse(environment.state.extension_logs)));
});

test('TTL cleanup retains recent events and leaves pending videos and metadata untouched', async () => {
  const now = Date.now();
  const environment = await createLoggerEnvironment({
    sessionId: 'keep',
    tempFiles: ['keep.webm'],
    metadata: { keep: true },
    extension_logs: JSON.stringify([
      { time_act: new Date(now - 2 * 86400000).toISOString() },
      { time_act: new Date(now - 1000).toISOString() },
    ]),
  });
  await environment.checkAndCleanLogs();
  assert.equal(JSON.parse(environment.state.extension_logs).length, 1);
  assert.equal(environment.state.sessionId, 'keep');
  assert.deepEqual(environment.state.tempFiles, ['keep.webm']);
  assert.deepEqual(environment.state.metadata, { keep: true });
});

test('TTL cleanup tolerates corrupt logs and does not prevent popup initialization', async () => {
  const environment = await createLoggerEnvironment({
    extension_logs: '{corrupt',
    tempFiles: ['keep.webm'],
  });
  await environment.checkAndCleanLogs();
  assert.deepEqual(environment.state.tempFiles, ['keep.webm']);
});

test('explicit log clearing does not erase the session, ACK or OPFS index', async () => {
  const environment = await createLoggerEnvironment({
    extension_logs: '[]',
    sessionId: 'keep',
    uploadAttempt: { keep: true },
    tempFiles: ['keep.webm'],
  });
  await environment.clearLogs();
  assert.equal(environment.state.extension_logs, undefined);
  assert.equal(environment.state.sessionId, 'keep');
  assert.deepEqual(environment.state.uploadAttempt, { keep: true });
  assert.deepEqual(environment.state.tempFiles, ['keep.webm']);
});
