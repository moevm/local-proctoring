import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPolicy, compareVersions } from '../scripts/plugin-policy.js';
test('policy warns on old versions and blocks normalized deny list / minimum', () => {
    const policy = { latestVersion: '3.10', minimumVersion: '3.2', blockedVersions: ['3.5'], requireVersion: true };
    assert.equal(compareVersions('3.10', '3.9'), 1);
    assert.deepEqual(assessPolicy(policy, '3.1'), { blocked: true, outdated: true, unsupported: true, unknown: false });
    assert.deepEqual(assessPolicy(policy, '3.5.0'), { blocked: true, outdated: true, unsupported: true, unknown: false });
    assert.deepEqual(assessPolicy(policy, '3.11'), { blocked: false, outdated: false, unsupported: false, unknown: false });
    assert.throws(() => assessPolicy({}, '3.1'));
});

test('category blocking switches and unknown catalog match server rules', () => {
    const policy = { latestVersion: '4', minimumVersion: '3.5', knownVersions: ['3', '3.5', '4'], unknownVersions: ['9'],
        deprecatedVersions: [], blockedVersions: ['3'], requireVersion: false, blockOutdated: false, blockUnsupported: false, blockUnknown: false };
    assert.equal(assessPolicy(policy, '3').blocked, false);
    assert.equal(assessPolicy(policy, '3').unsupported, true);
    assert.equal(assessPolicy({ ...policy, blockOutdated: true }, '3.5').blocked, true);
    assert.equal(assessPolicy({ ...policy, blockUnsupported: true }, '3').blocked, true);
    assert.equal(assessPolicy({ ...policy, blockUnknown: true }, '9').blocked, true);
    assert.equal(assessPolicy({ ...policy, blockUnknown: true }, '4.1').blocked, true);
    assert.equal(assessPolicy(policy, '4.1').blocked, false);
    assert.throws(() => assessPolicy({ ...policy, blockUnsupported: 'false' }, '3'));
});
