// Grouping, collapse and reorder logic (store/grouping.js). Run via tests/run-unit.mjs.
import assert from 'node:assert/strict';
const { buildLayout, moveTracks, moveGroup, PRESETS, fillTemplate } = await import(new URL('../../src/renderer/store/grouping.js', import.meta.url));
const T = (id, album, artist, extra = {}) => ({ id, tags: { title: id, album, artist, duration: 60, codec: 'MP3', bitrate: 192, genre: 'Nintendo Switch', year: 2022, ...extra }, overrides: {} });
const tracks = [T('a1', 'Arceus', 'Pokemon'), T('b1', 'Octo', 'Splatoon'), T('a2', 'Arceus', 'Pokemon'), T('w1', null, 'dmg', { codec: 'WAV', bitrate: null, genre: null })];
const doc = { tracks, grouping: PRESETS.album };
let L = buildLayout(doc, {}, new Set());
assert.deepEqual(L.order, ['a1', 'a2', 'b1', 'w1'], 'groups in first-appearance order, tracks kept together');
assert.deepEqual(L.rows.map((r) => r.type === 'group' ? `[${r.group.mainName}]` : r.id), ['[Arceus]', 'a1', 'a2', '[Octo]', 'b1', '[Unknown Album]', 'w1']);
assert.deepEqual(L.groups[0].subNames, ['Pokemon', 'Nintendo Switch | mp3 192 kbps | 2 Tracks | Time: 2:00']);
assert.deepEqual(L.groups[2].subNames, ['dmg', 'wav | 1 Track | Time: 1:00'], 'empty segments dropped');
assert.equal(fillTemplate('%genre% | %codec%', {}), '', 'all-empty template vanishes');
console.log('PASS grouping by album, headers, empty-segment cleanup');

L = buildLayout(doc, {}, new Set([L.groups[0].key]));
assert.deepEqual(L.rows.map((r) => r.type === 'group' ? 'G' : r.id), ['G', 'G', 'b1', 'G', 'w1'], 'collapsed group hides rows');
assert.deepEqual(L.order, ['a1', 'a2', 'b1', 'w1'], 'collapse does not change playback order');
console.log('PASS collapse');

assert.deepEqual(moveTracks(tracks, ['a2'], 'a1').map((t) => t.id), ['a2', 'a1', 'b1', 'w1']);
assert.deepEqual(moveTracks(tracks, ['a1', 'b1'], null).map((t) => t.id), ['a2', 'w1', 'a1', 'b1']);
assert.equal(moveTracks(tracks, ['a1'], 'a1'), tracks, 'no-op returns same array');
assert.equal(moveTracks(tracks, ['w1'], null), tracks, 'already last: same array');
console.log('PASS moveTracks');

L = buildLayout(doc, {}, new Set());
const moved = moveGroup(tracks, L, L.groups[1].key, L.groups[0].key);   // Octo before Arceus
assert.deepEqual(buildLayout({ ...doc, tracks: moved }, {}, new Set()).groups.map((g) => g.mainName), ['Octo', 'Arceus', 'Unknown Album']);
const last = moveGroup(tracks, L, L.groups[0].key, null);
assert.deepEqual(buildLayout({ ...doc, tracks: last }, {}, new Set()).groups.map((g) => g.mainName), ['Octo', 'Unknown Album', 'Arceus']);
console.log('PASS moveGroup');

// 5,000 tracks: layout cost.
const big = Array.from({ length: 5000 }, (_, i) => T(`t${i}`, `Album ${i % 300}`, `Artist ${i % 40}`));
let t0 = performance.now(); for (let i = 0; i < 20; i++) buildLayout({ tracks: big, grouping: PRESETS.album }, {}, new Set()); 
console.log(`PASS 5,000-track grouped layout: ${((performance.now() - t0) / 20).toFixed(1)}ms each`);
assert.deepEqual(moveTracks(tracks, ['a1'], null, 'a2').map((t) => t.id), ['b1', 'a2', 'a1', 'w1'], 'afterId');
assert.equal(moveTracks(tracks, ['a1'], null, 'a1'), tracks);
console.log('PASS moveTracks afterId');

// Art resolution chain (store/art.js): group art → first track with art (custom, then embedded) → cover → null.
const A = (name) => `art/${name.padEnd(32, '0')}.png`;
const url = (ref) => `beachday-media://art/${ref.slice(4)}`;
const arts = [T('x1', 'X', 'x'), T('x2', 'X', 'x'), T('y1', 'Y', 'y'), T('z1', 'Z', 'z')];
const embedded = { x2: { artUrl: 'beachday-media://art/emb.jpg' } };
let G = buildLayout({ tracks: arts, grouping: PRESETS.album, meta: {} }, embedded, new Set()).groups;
assert.deepEqual(G.map((g) => g.artUrl), ['beachday-media://art/emb.jpg', null, null], 'first track with embedded art; none → block');
arts[1] = { ...arts[1], overrides: { art: A('c') } };
arts[2] = { ...arts[2], overrides: { art: A('d') } };
G = buildLayout({ tracks: arts, grouping: PRESETS.album, meta: { cover: A('cover') }, groups: [{ key: G[2].key, art: A('g') }] }, embedded, new Set()).groups;
assert.deepEqual(G.map((g) => g.artUrl), [url(A('c')), url(A('d')), url(A('g'))], 'custom beats embedded; explicit group art wins');
G = buildLayout({ tracks: [T('q', 'Q', 'q')], grouping: PRESETS.album, meta: { cover: A('cover') } }, {}, new Set()).groups;
assert.equal(G[0].artUrl, url(A('cover')), 'playlist cover before the block');
console.log('PASS art resolution chain for group headers');
