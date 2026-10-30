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

// Pins, custom groups and per-group header overrides (Phase 7).
const { applyGroupEdits, pinTracks, derivedKey, CUSTOM_PREFIX } = await import(new URL('../../src/renderer/store/grouping.js', import.meta.url));
const names = (layout) => layout.rows.map((r) => (r.type === 'group' ? `[${r.group.mainName}]` : r.id));
let pinned = pinTracks(tracks, PRESETS.album, ['b1'], derivedKey(PRESETS.album, tracks[0]));
assert.deepEqual(names(buildLayout({ tracks: pinned, grouping: PRESETS.album }, {}, new Set())), ['[Arceus]', 'a1', 'b1', 'a2', '[Unknown Album]', 'w1'], 'a pinned track joins the group, in playlist order');
assert.equal(pinTracks(pinned, PRESETS.album, ['a1'], derivedKey(PRESETS.album, tracks[0])), pinned, 'pinning a track to its own group changes nothing');
L = buildLayout({ tracks: pinned, grouping: PRESETS.album }, {}, new Set());
assert.deepEqual(L.groups[0].subNames[0], 'Pokemon', 'header fields come from a track that belongs by its tags');
assert.deepEqual(names(buildLayout({ tracks: pinned, grouping: PRESETS.artist }, {}, new Set())).filter((n) => n.startsWith('[')), ['[Pokemon]', '[Splatoon]', '[dmg]'], 'a pin to a group the template no longer makes falls back');
console.log('PASS pinning tracks to groups');

const key = CUSTOM_PREFIX + 'g_test';
const custom = { tracks: pinTracks(tracks, PRESETS.album, ['w1', 'a2'], key), grouping: PRESETS.album, groups: [{ key, custom: true, mainName: 'Favourites' }] };
L = buildLayout(custom, {}, new Set());
assert.deepEqual(names(L), ['[Arceus]', 'a1', '[Octo]', 'b1', '[Favourites]', 'a2', 'w1'], 'a custom group holds its pinned tracks');
assert.equal(L.groups[2].custom, true);
assert.deepEqual(names(buildLayout({ ...custom, grouping: PRESETS.artist }, {}, new Set())).slice(-3), ['[Favourites]', 'a2', 'w1'], 'custom groups survive a template change');
assert.deepEqual(names(buildLayout({ ...custom, groups: [] }, {}, new Set())).filter((n) => n.startsWith('[')), ['[Arceus]', '[Octo]', '[Unknown Album]'], 'a pin to a custom group that is gone falls back');
console.log('PASS custom groups');

let edited = applyGroupEdits(custom, new Map([[L.groups[0].key, { mainName: '%album% (PLA)', subNames: ['', 'Switch'], description: 'Hisui!' }]]));
L = buildLayout(edited, {}, new Set());
assert.equal(L.groups[0].mainName, 'Arceus (PLA)', 'main name override is a template');
assert.deepEqual(L.groups[0].subNames, ['Pokemon', 'Switch'], 'an empty override line keeps the grouping line');
assert.equal(L.groups[0].description, 'Hisui!');
assert.equal(applyGroupEdits(edited, new Map([[L.groups[0].key, { description: 'Hisui!' }]])), edited, 'no-op edit returns the same doc');
const cleared = applyGroupEdits(edited, new Map([[L.groups[0].key, { mainName: '', subNames: ['', ''], description: '' }]]));
assert.deepEqual(cleared.groups.find((g) => g.key === L.groups[0].key), { key: L.groups[0].key }, 'clearing removes the fields');
const dissolved = applyGroupEdits(edited, new Map([[key, { dissolve: true }]]));
assert.ok(!dissolved.groups.some((g) => g.key === key) && dissolved.tracks.every((t) => !t.groupId), 'dissolving unpins its tracks and drops the group');
const hostile = buildLayout({ tracks, grouping: PRESETS.album, groups: [{ key: L.groups[0].key, mainName: 42, subNames: 'x' }, { nokey: true }] }, {}, new Set());
assert.equal(hostile.groups[0].mainName, 'Arceus', 'malformed group entries from a .bday are ignored');
console.log('PASS group header overrides, descriptions, dissolve');

// Custom Groups Only: tags group nothing; everything not in a custom group shares one group.
const manual = { tracks: pinTracks(tracks, PRESETS.manual, ['b1'], key), grouping: PRESETS.manual, groups: [{ key, custom: true, mainName: 'Mine' }] };
assert.deepEqual(names(buildLayout(manual, {}, new Set())), ['[Ungrouped Tracks]', 'a1', 'a2', 'w1', '[Mine]', 'b1']);
assert.deepEqual(buildLayout(manual, {}, new Set()).groups[1].subNames, ['1 Track | Time: 1:00'], 'custom groups take the mode’s count line');
console.log('PASS Custom Groups Only');
