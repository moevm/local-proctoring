#!/usr/bin/env node
// This repository only. Its own VERSION is the sole editable source.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const PROJECT = 'extension';

function releasePlan(root = path.resolve(__dirname, '..')) {
    const read = filename => fs.readFileSync(filename, 'utf8');
    const version = read(path.join(root, 'VERSION')).trim();
    assert.ok(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), 'VERSION must be MAJOR.MINOR.PATCH without suffixes');
    assert.ok(version.split('.').every(part => Number.isSafeInteger(Number(part))), 'VERSION exceeds numeric limits');
    const changes = [];
    const add = (filename, before, after) => { if (before !== after) changes.push({ filename, before, after }); };
    assert.ok(version !== '0.0.0' && version.split('.').every(part => Number(part) <= 65535), 'VERSION must fit Chrome numeric limits');
    const filename = path.join(root, 'client/manifest.json');
    const before = read(filename), manifest = JSON.parse(before);
    const { createHash } = require('node:crypto');
    const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
        .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
    assert.equal(id, 'nlhjjbgkbfkopkigkbkojpkbffbkeohg', 'Extension identity changed; refusing to sync');
    const updated = { ...manifest, version };
    delete updated.version_name;
    add(filename, before, JSON.stringify(updated, null, 2) + '\n');
    return { version, changes };
}

function synchronize(root) {
    // All inputs, formats and extension identity are checked before the first write.
    const plan = releasePlan(root);
    for (const change of plan.changes) fs.writeFileSync(change.filename, change.after);
    return plan;
}

module.exports = { releasePlan, synchronize, PROJECT };

if (require.main === module) {
    try {
        assert.equal(process.argv.length, 2, 'Usage: node scripts/sync-release-version.js (edit VERSION first)');
        const plan = synchronize();
        console.log('Version ' + plan.version + ': synchronized ' + plan.changes.length + ' generated files.');
    } catch (error) {
        console.error('Version sync failed: ' + error.message);
        process.exitCode = 1;
    }
}
