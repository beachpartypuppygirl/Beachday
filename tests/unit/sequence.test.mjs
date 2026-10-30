// Play order (audio/sequence.js) and chains in the layout (store/grouping.js). Run via tests/run-unit.mjs.
import assert from 'node:assert/strict';
const { unitsOf, unitIdsOf, shuffleQueue, reconcileShuffle, bringForward } = await import(new URL('../../src/renderer/audio/sequence.js', import.meta.url));
const { buildLayout, withChains, PRESETS } = await import(new URL('../../src/renderer/store/grouping.js', import.meta.url));

// Seeded random (mulberry32), so every run shuffles the same way.
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// A queue: letters are tracks, '>' links a track to the next ("ab>c" = a, b→c).
const Q = (spec) => {
  const ids = spec.replace(/>/g, '').split('');
  return ids.map((id, i) => ({ id, url: `u:${id}`, linkNext: spec[spec.indexOf(id) + 1] === '>' ? ids[i + 1] : null }));
};

assert.deepEqual(unitIdsOf(Q('ab>c>de')), [['a'], ['b', 'c', 'd'], ['e']]);
const stale = Q('abc'); stale[0].linkNext = 'c';
assert.deepEqual(unitIdsOf(stale), [['a'], ['b'], ['c']], 'a link to a track that isn’t next doesn’t count');
assert.deepEqual(unitsOf(Q('a>b')), [[0, 1]]);
console.log('PASS units: chains and single tracks');

const queue = Q('ab>c>defg>hij');
for (let seed = 1; seed <= 200; seed++) {
  const order = shuffleQueue(queue, seeded(seed));
  assert.equal(new Set(order).size, queue.length, 'every track exactly once');
  assert.ok(order.join('').includes('bcd') && order.join('').includes('gh'), 'chains stay whole and in order');
}
const firsts = new Set(Array.from({ length: 200 }, (_, seed) => shuffleQueue(queue, seeded(seed))[0]));
assert.ok(!firsts.has('c') && !firsts.has('d') && !firsts.has('h'), 'only a chain’s head ever starts a unit');
assert.ok(firsts.size >= 6, 'different seeds, different orders');
for (let seed = 1; seed <= 100; seed++) {
  assert.deepEqual(shuffleQueue(queue, seeded(seed), { first: 'c' }).slice(0, 3), ['b', 'c', 'd'], 'the playing unit leads');
  assert.notEqual(shuffleQueue(queue, seeded(seed), { notFirst: 'h' })[0], 'g', 'a new cycle never opens with the unit that just ended');
}
console.log('PASS shuffle: permutation of units, chains intact, first / notFirst');

// Queue changes keep the order; added units land after the cursor.
let { ids, pos } = { ids: shuffleQueue(queue, seeded(7)), pos: 0 };
pos = ids.indexOf(ids[4]);
const current = ids[pos];
let next = reconcileShuffle(ids, pos, Q('ab>c>defg>hijXY'), current, seeded(3));
assert.deepEqual(next.ids.filter((id) => !'XY'.includes(id)), ids, 'existing units keep their order');
assert.equal(next.ids[next.pos], current, 'the cursor stays on the current track');
assert.ok(next.ids.indexOf('X') > next.pos && next.ids.indexOf('Y') > next.pos, 'new tracks are still to come this cycle');
next = reconcileShuffle(ids, pos, Q('ab>c>defg>hij').filter((t) => t.id !== current), current, seeded(3));
assert.equal(next.pos % 1, 0.5, 'the current track removed: the cursor sits between two');
assert.equal(next.ids[Math.floor(next.pos) + 1], ids[pos + 1], '…and Next carries on from where it was');
// Linking two separate tracks into a chain: one unit, at the first one's place.
const relinked = Q('ab>c>def>gh>ij');
next = reconcileShuffle(ids, pos, relinked, current, seeded(3));
assert.ok(next.ids.join('').includes('fgh'), 'a new chain plays as one');
assert.equal(new Set(next.ids).size, relinked.length);
console.log('PASS reconcile: order kept, cursor kept, additions ahead, removals, new chains');

// Picking a track while shuffling moves its unit up to play now.
const base = ['a', 'e', 'b', 'c', 'd', 'f'];
let picked = bringForward(base, 1, ['b', 'c', 'd']);
assert.deepEqual(picked, { ids: ['a', 'e', 'b', 'c', 'd', 'f'], pos: 1.5 }, 'already next: stays');
picked = bringForward(base, 0, ['f']);
assert.deepEqual(picked, { ids: ['a', 'f', 'e', 'b', 'c', 'd'], pos: 0.5 }, 'a later unit comes up next');
picked = bringForward(base, 4, ['a']);
assert.deepEqual(picked, { ids: ['e', 'b', 'c', 'd', 'a', 'f'], pos: 3.5 }, 'an already-played unit is moved, not repeated twice over');
console.log('PASS bringForward');

// Chains in the layout: linked ids, row rails, whole chains.
const T = (id, album, linkNext = null) => ({ id, linkNext, tags: { title: id, album, artist: 'x', duration: 60 }, overrides: {} });
const tracks = [T('a', 'A', 'b'), T('b', 'A', 'c'), T('c', 'A'), T('d', 'B'), T('e', 'A')];
let L = buildLayout({ tracks, grouping: null }, {}, new Set());
assert.deepEqual([...L.linked], ['a', 'b']);
assert.deepEqual(L.rows.map((r) => `${r.linkUp ? '^' : ''}${r.id}${r.linkDown ? 'v' : ''}`), ['av', '^bv', '^c', 'd', 'e']);
assert.deepEqual(withChains(L, ['b']), ['a', 'b', 'c'], 'any member brings the whole chain');
assert.deepEqual(withChains(L, ['d', 'c']), ['a', 'b', 'c', 'd']);
// Grouped by album, a link to a track in another group isn't contiguous, so it doesn't hold.
const split = [T('a', 'A', 'd'), T('d', 'B'), T('e', 'A')];
L = buildLayout({ tracks: split, grouping: PRESETS.album }, {}, new Set());
assert.deepEqual(L.order, ['a', 'e', 'd']);
assert.equal(L.linked.size, 0, 'a link split up by grouping is inactive');
console.log('PASS chains in the layout');
