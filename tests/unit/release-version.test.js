import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import releaseVersion from '../../scripts/sync-release-version.js';
import { MANIFEST } from '../support/paths.js';

const { releasePlan, synchronize } = releaseVersion;
function createVersionProject(context, version = '4.2.1') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-version-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'standalone');
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  };
  write('VERSION', version + '\n');
  write('client/manifest.json', { ...MANIFEST, version: '1.0.0', version_name: 'old' });
  return { directory, root, write, read: (name) => fs.readFileSync(path.join(root, name), 'utf8') };
}

test('version sync updates only the local manifest and is idempotent', (context) => {
  const project = createVersionProject(context);
  const { version, version_name, ...unchanged } = JSON.parse(project.read('client/manifest.json'));

  const plan = synchronize(project.root);

  assert.equal(plan.version, '4.2.1');
  assert.equal(plan.changes.length, 1);
  assert.ok(plan.changes.every((change) => change.filename.startsWith(project.root + path.sep)));
  assert.equal(project.read('VERSION'), '4.2.1\n');
  assert.deepEqual(JSON.parse(project.read('client/manifest.json')), {
    ...unchanged,
    version: '4.2.1',
  });
  assert.equal(synchronize(project.root).changes.length, 0);
});

test('version sync does not read or overwrite neighbouring repositories', (context) => {
  const project = createVersionProject(context);
  for (const name of ['proctoring', 'proctoring-ml', 'local-proctoring']) {
    fs.mkdirSync(path.join(project.directory, name));
    fs.writeFileSync(path.join(project.directory, name, 'VERSION'), 'do-not-touch\n');
  }

  synchronize(project.root);

  for (const name of ['proctoring', 'proctoring-ml', 'local-proctoring']) {
    assert.equal(
      fs.readFileSync(path.join(project.directory, name, 'VERSION'), 'utf8'),
      'do-not-touch\n',
    );
  }
});

test('planning a version sync does not write files', (context) => {
  const project = createVersionProject(context);
  const before = project.read('client/manifest.json');
  assert.ok(releasePlan(project.root).changes.length > 0);
  assert.equal(project.read('client/manifest.json'), before);
});

test('invalid versions are rejected before writing the manifest', (context) => {
  for (const version of [
    '3.1.0-local.1',
    '03.1.0',
    '3.1',
    '3.1.0+build',
    '-1.0.0',
    '3.1.0\n4.0.0',
  ]) {
    const project = createVersionProject(context, version);
    const before = project.read('client/manifest.json');
    assert.throws(() => synchronize(project.root), /VERSION/);
    assert.equal(project.read('client/manifest.json'), before);
  }
});

test('an invalid manifest key prevents every version-sync write', (context) => {
  const project = createVersionProject(context);
  project.write('client/manifest.json', {
    ...MANIFEST,
    key: Buffer.from('different').toString('base64'),
  });
  const before = project.read('client/manifest.json');
  assert.throws(() => synchronize(project.root), /identity changed/);
  assert.equal(project.read('client/manifest.json'), before);
});
