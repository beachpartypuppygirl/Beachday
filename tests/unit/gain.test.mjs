// Per-track gain (store/gain.js): ReplayGain seed, the +12dB cap. Run via tests/run-unit.mjs.
import assert from 'node:assert/strict';
const { trackGainDb, seedGainDb, clampGain, formatGain, GAIN_MAX_DB } = await import(new URL('../../src/renderer/store/gain.js', import.meta.url));
const T = (replayGainDb, gainDb) => ({ tags: { replayGainDb }, overrides: gainDb === undefined ? {} : { gainDb } });
assert.equal(trackGainDb(T(null)), 0, 'no ReplayGain, no override: 0dB');
assert.equal(trackGainDb(T(-6.92)), -6.92, 'seeded from ReplayGain');
assert.equal(trackGainDb(T(-6.92, 2)), 2, 'an override wins');
assert.equal(trackGainDb(T(-6.92, 0)), 0, 'a 0dB override is still an override');
assert.equal(seedGainDb(T(20)), GAIN_MAX_DB, 'ReplayGain boosts are capped too');
assert.equal(trackGainDb(T(null, 99)), GAIN_MAX_DB, 'overrides are capped (a hand-edited .bday)');
assert.equal(clampGain('nonsense'), 0);
assert.equal(formatGain(-6.92), '−6.92 dB');
assert.equal(formatGain(3), '+3 dB');
assert.equal(formatGain(0), '0 dB');
console.log('PASS gain seed, override, cap, formatting');
