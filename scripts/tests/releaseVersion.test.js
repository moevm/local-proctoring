const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { releasePlan, synchronize, PROJECT } = require('../sync-release-version');

function fixture(t, version = '4.2.1') {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'independent-version-test-'));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const root = path.join(base, 'standalone');
    const write = (relative, value) => {
        const filename = path.join(root, relative);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
    };
    write('VERSION', version + '\n');
    if (PROJECT === 'platform') {
        for (const component of ['backend', 'frontend']) {
            write(component + '/package.json', { name: component, version: '1.0.0', dependencies: { untouched: '1.0.0' } });
            write(component + '/package-lock.json', { version: '1.0.0', lockfileVersion: 3,
                packages: { '': { name: component, version: '1.0.0' }, 'node_modules/untouched': { version: '1.0.0' } } });
        }
    } else {
        // This test reads only its own extension manifest, never another repository.
        const actual = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../client/manifest.json'), 'utf8'));
        write('client/manifest.json', { ...actual, version: '1.0.0', version_name: 'old' });
    }
    return { root, base, write, read: name => fs.readFileSync(path.join(root, name), 'utf8') };
}

test('standalone sync changes only local metadata and is idempotent', t => {
    const f = fixture(t), before = PROJECT === 'extension' ? JSON.parse(f.read('client/manifest.json')) : null;
    const plan = synchronize(f.root);
    assert.equal(plan.version, '4.2.1');
    assert.equal(plan.changes.length, PROJECT === 'platform' ? 4 : 1);
    assert.ok(plan.changes.every(change => change.filename.startsWith(f.root + path.sep)));
    assert.equal(f.read('VERSION'), '4.2.1\n');
    if (PROJECT === 'platform') {
        for (const component of ['backend', 'frontend']) {
            const pkg = JSON.parse(f.read(component + '/package.json'));
            const lock = JSON.parse(f.read(component + '/package-lock.json'));
            assert.equal(pkg.version, '4.2.1'); assert.equal(pkg.dependencies.untouched, '1.0.0');
            assert.equal(lock.version, '4.2.1'); assert.equal(lock.packages[''].version, '4.2.1');
            assert.equal(lock.packages['node_modules/untouched'].version, '1.0.0');
        }
    } else {
        const { version, version_name, ...untouched } = before;
        assert.deepEqual(JSON.parse(f.read('client/manifest.json')), { ...untouched, version: '4.2.1' });
    }
    assert.equal(synchronize(f.root).changes.length, 0);
});

test('different or invalid neighbour versions are not read or overwritten', t => {
    const f = fixture(t);
    for (const neighbour of ['proctoring', 'proctoring-ml', 'local-proctoring']) {
        const directory = path.join(f.base, neighbour);
        fs.mkdirSync(directory);
        fs.writeFileSync(path.join(directory, 'VERSION'), 'neighbour-do-not-touch\n');
    }
    synchronize(f.root);
    for (const neighbour of ['proctoring', 'proctoring-ml', 'local-proctoring']) {
        assert.equal(fs.readFileSync(path.join(f.base, neighbour, 'VERSION'), 'utf8'), 'neighbour-do-not-touch\n');
    }
});

test('planning is read-only', t => {
    const f = fixture(t), filename = PROJECT === 'platform' ? 'backend/package.json' : 'client/manifest.json';
    const before = f.read(filename);
    assert.ok(releasePlan(f.root).changes.length > 0);
    assert.equal(f.read(filename), before);
});

test('suffixes and invalid version syntax are rejected before writes', t => {
    for (const version of ['3.1.0-local.1', '03.1.0', '3.1', '3.1.0+build', '-1.0.0', '3.1.0\n4.0.0']) {
        const f = fixture(t, version), filename = PROJECT === 'platform' ? 'backend/package.json' : 'client/manifest.json';
        const before = f.read(filename);
        assert.throws(() => synchronize(f.root), /VERSION/);
        assert.equal(f.read(filename), before);
    }
});

test('invalid local metadata blocks synchronization before any write', t => {
    const f = fixture(t);
    if (PROJECT === 'platform') {
        f.write('frontend/package-lock.json', { version: '1.0.0', packages: {} });
        assert.throws(() => synchronize(f.root), /missing lock root/);
        assert.equal(JSON.parse(f.read('backend/package.json')).version, '1.0.0');
    } else {
        const original = JSON.parse(f.read('client/manifest.json'));
        f.write('client/manifest.json', { ...original, key: Buffer.from('different').toString('base64') });
        const before = f.read('client/manifest.json');
        assert.throws(() => synchronize(f.root), /identity changed/);
        assert.equal(f.read('client/manifest.json'), before);
    }
});
