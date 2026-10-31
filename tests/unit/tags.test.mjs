// Playlist-side tags (store/tags.js), and grouping following them. Run via tests/run-unit.mjs.
import assert from 'node:assert/strict';
const { trackTag, tagOverride, withTags, withSwappedTags } = await import(new URL('../../src/renderer/store/tags.js', import.meta.url));
const { buildLayout, derivedKey, PRESETS } = await import(new URL('../../src/renderer/store/grouping.js', import.meta.url));

const T = (tags, overrides = {}) => ({ id: tags.title ?? 't', tags, overrides });
const flipped = T({ title: 'Distance', artist: 'Knife Man', album: 'AJJ' });

assert.equal(trackTag(flipped, 'artist'), 'Knife Man', 'no override: the file’s tag');
assert.equal(trackTag(T({ artist: 'A' }, { artist: 'B' }), 'artist'), 'B', 'an override wins');
assert.equal(trackTag(T({ artist: 'A' }, { artist: '' }), 'artist'), '', 'a blank override is still an override');
assert.equal(trackTag(T({}), 'album'), '', 'no tag at all: blank');
assert.equal(trackTag(T({ artist: 'A' }, { artist: 42 }), 'artist'), 'A', 'a hand-edited .bday can’t put a number here');
assert.equal(tagOverride(T({ artist: 'A' }, { artist: { x: 1 } }), 'artist'), null);

assert.deepEqual(withTags(T({ artist: 'A' }), { artist: 'B' }), { artist: 'B' }, 'sets an override');
assert.deepEqual(withTags(T({ artist: 'A' }, { artist: 'B' }), { artist: 'A' }), {}, 'the file’s own value needs no override');
assert.deepEqual(withTags(T({ artist: 'A' }, { artist: 'B', gainDb: 2 }), { artist: null }), { gainDb: 2 }, 'null goes back to the file, leaving other overrides');
const same = T({ artist: 'A' }, { artist: 'B' });
assert.equal(withTags(same, { artist: 'B' }), same.overrides, 'no change: the same object, so no undo step');
assert.equal(withTags(same, {}), same.overrides, 'an empty patch changes nothing');

// An album artist that repeats the artist follows it; a real one stays.
assert.deepEqual(withTags(T({ artist: 'A', albumArtist: 'A' }), { artist: 'B' }), { artist: 'B', albumArtist: 'B' }, 'album artist follows');
assert.deepEqual(withTags(T({ artist: 'A', albumArtist: 'Various' }), { artist: 'B' }), { artist: 'B' }, 'a different album artist is left alone');
assert.deepEqual(withTags(T({ artist: 'A', albumArtist: 'A' }), { artist: 'B', albumArtist: 'C' }), { artist: 'B', albumArtist: 'C' }, 'unless it was edited too');
assert.deepEqual(withTags(T({ artist: 'A', albumArtist: 'A' }, { artist: 'B', albumArtist: 'B' }), { artist: null }), {}, 'back to the file together');

// Swapping.
const swapped = { ...flipped, overrides: withSwappedTags(flipped) };
assert.deepEqual(swapped.overrides, { artist: 'AJJ', album: 'Knife Man' }, 'swaps per track');
assert.deepEqual(withSwappedTags(swapped), {}, 'swapping twice is back to the file, with no overrides left');
const noAlbum = T({ artist: 'Solo' });
const noAlbumSwapped = { ...noAlbum, overrides: withSwappedTags(noAlbum) };
assert.equal(trackTag(noAlbumSwapped, 'artist'), '', 'swapping with an empty album empties the artist');
assert.equal(trackTag(noAlbumSwapped, 'album'), 'Solo');
assert.deepEqual(withSwappedTags(noAlbumSwapped), {}, '…and back');
assert.deepEqual(withSwappedTags(T({ artist: 'K', album: 'A', albumArtist: 'K' })), { artist: 'A', album: 'K', albumArtist: 'A' }, 'a repeated album artist swaps along');

// Grouping reads the same values.
const tracks = [T({ title: 'a', artist: 'Knife Man', album: 'AJJ' }), T({ title: 'b', artist: 'Knife Man', album: 'AJJ' })];
const fixed = tracks.map((track) => ({ ...track, overrides: withSwappedTags(track) }));
const layout = buildLayout({ tracks: fixed, grouping: PRESETS.album }, {}, new Set());
assert.equal(layout.groups.length, 1);
assert.equal(layout.groups[0].mainName, 'Knife Man', 'an edited album names its group');
assert.deepEqual(layout.groups[0].subNames.slice(0, 1), ['AJJ'], 'an edited artist is the album artist too');
assert.notEqual(derivedKey(PRESETS.album, fixed[0]), derivedKey(PRESETS.album, tracks[0]), 'and decides the group');
const artists = buildLayout({ tracks: [fixed[0], tracks[1]], grouping: PRESETS.artist }, {}, new Set());
assert.deepEqual(artists.groups.map((g) => g.mainName), ['AJJ', 'Knife Man'], 'edited tracks part from unedited ones');
console.log('PASS playlist-side tags: overrides, swapping, album artist, grouping');
