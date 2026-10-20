#!/usr/bin/env node
// Read-only check of metadata generated from this repository's VERSION.
const { releasePlan } = require('./sync-release-version');

try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/check-release-version.js');
    const plan = releasePlan();
    if (plan.changes.length) {
        throw new Error('Stale local metadata:\n' + plan.changes.map(change => change.filename).join('\n') +
            '\nRun node scripts/sync-release-version.js in this repository');
    }
    console.log('OK: local VERSION ' + plan.version + ' and generated metadata match.');
} catch (error) {
    console.error('Version check failed: ' + error.message);
    process.exitCode = 1;
}
