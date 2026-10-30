// .bday format, fingerprinting and relinking, from plain Node. Run via tests/run-unit.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const M = new URL('../../src/main/', import.meta.url).href;
const { readBday, writeBday, bundledName } = await import(M + 'bday.mjs');
const { resolveTracks, applyMapping, learnMapping, splitPath } = await import(M + 'relink.mjs');
const { fingerprint } = await import(M + 'fingerprint.mjs');
const S = process.argv[2], H = S + '/home';
const ok = (name) => console.log('PASS', name);

// --- pure path logic, both directions ---
assert.deepEqual(splitPath('C:\\Users\\Me\\a.flac'), { root: 'C:', segments: ['Users', 'Me', 'a.flac'] });
assert.deepEqual(splitPath('/home/me/a.flac'), { root: '', segments: ['home', 'me', 'a.flac'] });
assert.deepEqual(splitPath('\\\\NAS\\Music\\a.flac'), { root: '//nas/music', segments: ['a.flac'] });
assert.equal(applyMapping('C:\\Users\\Me\\Music\\X\\a.flac', { from: 'c:\\users\\me\\music', to: '/home/t/Music' }), '/home/t/Music/X/a.flac');
assert.equal(applyMapping('/home/t/Music/X/a.flac', { from: '/home/t/Music', to: 'D:\\Music' }, path.win32.join), 'D:\\Music\\X\\a.flac');
assert.equal(applyMapping('C:\\Other\\a.flac', { from: 'C:\\Users', to: '/x' }), null);
assert.equal(applyMapping('C:\\Users2\\a.flac', { from: 'C:\\Users', to: '/x' }), null, 'segment boundary, not string prefix');
assert.deepEqual(learnMapping('C:\\Users\\Me\\Music\\Splatoon\\a.flac', '/home/me/Music/Splatoon/a.flac'), { from: 'C:\\Users', to: '/home' });
assert.deepEqual(learnMapping('C:\\Music\\a.flac', '/home/t/Tunes/b.flac'), { from: 'C:\\Music', to: '/home/t/Tunes' });
ok('path parsing / mapping / learning');

// --- fingerprints ---
const flac = H + '/Music/Splatoon/Splatoon 3 - Cryogenic Hopetown.flac';
const mp3 = H + '/Music/Splatoon/Splatoon 2 Octo Expansion - Fly Octo Fly.mp3';
const wav = H + '/Music/Breakcore/feel sooooo hard (renamed).wav';
const info = async (p) => { const size = (await fs.stat(p)).size; return { size, fingerprint: await fingerprint({ path: p, size }) }; };
const [fi, mi, wi] = await Promise.all([flac, mp3, wav].map(info));
assert.notEqual(fi.fingerprint, mi.fingerprint);
const tiny = S + '/tiny.bin'; await fs.writeFile(tiny, 'abc');
assert.match(await fingerprint({ path: tiny, size: 3 }), /^sha256:[0-9a-f]{32}$/);
ok('fingerprints');

// --- bundled round trip: entries stream by offset, fingerprint survives bundling ---
const taken = new Set();
const names = [flac, mp3, mp3].map((p) => bundledName(path.basename(p), taken));
assert.deepEqual(names, ['audio/Splatoon 3 - Cryogenic Hopetown.flac', 'audio/Splatoon 2 Octo Expansion - Fly Octo Fly.mp3', 'audio/Splatoon 2 Octo Expansion - Fly Octo Fly (2).mp3']);
const bday = S + '/bundled.bday';
let lastProgress = 0;
await writeBday(bday, { formatVersion: 1, bundled: true, tracks: [] }, [{ name: names[0], source: { path: flac, size: fi.size } }, { name: names[1], source: { path: mp3, size: mi.size } }], (w) => (lastProgress = w));
assert.equal(lastProgress, fi.size + mi.size);
const read = await readBday(bday);
assert.equal(read.manifest.bundled, true);
const e = read.entries.get(names[0]);
assert.equal(e.size, fi.size);
assert.equal(await fingerprint({ path: bday, offset: e.offset, size: e.size }), fi.fingerprint, 'bundled entry is byte-identical');
const fh = await fs.open(bday); const buf = Buffer.alloc(16); await fh.read(buf, 0, 16, e.offset); await fh.close();
assert.equal(buf.subarray(0, 4).toString(), 'fLaC', 'offset points at FLAC magic');
ok('bundled write/read, offset streaming, fingerprint stable');

// --- re-save over itself using its own entries as sources (atomic replace) ---
await writeBday(bday, { formatVersion: 1, bundled: true, tracks: [] }, [{ name: names[1], source: { path: bday, offset: read.entries.get(names[1]).offset, size: mi.size } }]);
const reread = await readBday(bday);
assert.equal(reread.entries.size, 1);
const e2 = reread.entries.get(names[1]);
assert.equal(await fingerprint({ path: bday, offset: e2.offset, size: e2.size }), mi.fingerprint);
assert.equal((await fs.readdir(S)).filter((f) => f.endsWith('.tmp')).length, 0, 'no temp files left');
ok('self-sourced re-save');

// --- error cases ---
await fs.writeFile(S + '/notzip.bday', 'hello');
await assert.rejects(readBday(S + '/notzip.bday'), /Not a Beachday playlist/);
await writeBday(S + '/future.bday', { formatVersion: 99 });
await assert.rejects(readBday(S + '/future.bday'), /newer version/);
ok('rejects non-zip and future formats');

// --- playlist art travels in art/ ---
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
await fs.writeFile(S + '/cover.png', png);
const artName = 'art/0123456789abcdef0123456789abcdef.png';
await writeBday(S + '/art.bday', { formatVersion: 1, bundled: false, meta: { cover: artName }, tracks: [] }, [], undefined, [{ name: artName, path: S + '/cover.png' }]);
const withArt = await readBday(S + '/art.bday');
assert.deepEqual([...withArt.art.keys()], [artName]);
assert.ok(withArt.art.get(artName).equals(png));
assert.equal(withArt.entries.has(artName), false, 'art is read as bytes, not offered as a streamable entry');
ok('art/ entries round-trip through a .bday');

// --- THE criterion: a playlist saved on Windows, opened on Linux ---
// Saved at C:\Users\Me\Playlists\mix.bday; now lives in ~/Downloads (not near the music).
const winTracks = [
  { relPath: '../Music/Splatoon/Splatoon 3 - Cryogenic Hopetown.flac', absPath: 'C:\\Users\\Me\\Music\\Splatoon\\Splatoon 3 - Cryogenic Hopetown.flac', ...fi },
  { relPath: '../music/splatoon/SPLATOON 2 OCTO EXPANSION - FLY OCTO FLY.mp3', absPath: 'C:\\Users\\Me\\Music\\Splatoon\\Splatoon 2 Octo Expansion - Fly Octo Fly.mp3', ...mi },
  { relPath: '../Music/Breakcore/feel sooooo hard.wav', absPath: 'C:\\Users\\Me\\Music\\Breakcore\\feel sooooo hard.wav', ...wi },
  { relPath: '../Music/Gone/missing.flac', absPath: 'C:\\Users\\Me\\Music\\Gone\\missing.flac', size: 123, fingerprint: 'sha256:nope' },
];
const dl = H + '/Downloads/inbox';
let r = await resolveTracks(winTracks, { bdayDir: dl, mappings: [] });
assert.deepEqual(r.map((x) => x.status), ['missing', 'missing', 'missing', 'missing'], 'nothing resolves from Downloads with no mapping');

// User relinks ONE track by hand -> mapping learned -> the rest follow.
const learned = learnMapping(winTracks[0].absPath, flac);
assert.deepEqual(learned, { from: 'C:\\Users\\Me', to: H }, JSON.stringify(learned));
r = await resolveTracks(winTracks, { bdayDir: dl, mappings: [learned] });
assert.deepEqual(r.map((x) => [x.status, x.how]), [['ok', 'mapped'], ['ok', 'mapped'], ['ok', 'fingerprint'], ['missing', undefined]], JSON.stringify(r));
assert.equal(r[2].path, wav, 'renamed file found by fingerprint');

// Same playlist placed next to the music: relative paths resolve (one needs case-insensitive matching).
await fs.mkdir(H + '/Playlists', { recursive: true });
r = await resolveTracks(winTracks, { bdayDir: H + '/Playlists', mappings: [] });
assert.deepEqual(r.map((x) => [x.status, x.how]), [['ok', 'relative'], ['ok', 'relative'], ['ok', 'fingerprint'], ['missing', undefined]], JSON.stringify(r));
assert.equal(r[1].path, mp3, 'case-insensitive relative match');
ok('Windows -> Linux relink: mapping learned from one track fixes the rest; renamed file found by fingerprint');
