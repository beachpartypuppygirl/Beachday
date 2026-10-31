// Lyrics: reading LRC (store/lrc.js) and the LRCLIB client (src/main/lyrics.mjs), against a fake server. Run via tests/run-unit.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { parseLyrics, lineAt } = await import(new URL('../../src/renderer/store/lrc.js', import.meta.url));
const { bestMatch, cleanQuery, createLyrics } = await import(new URL('../../src/main/lyrics.mjs', import.meta.url));

// --- LRC ---
let parsed = parseLyrics('[ar:Someone]\n[00:12.50] second\r\n[00:01.00]first\n[00:20.00][01:00.5] chorus\n[00:30.00]\n');
assert.equal(parsed.synced, true);
assert.deepEqual(parsed.lines.map((l) => l.time), [1, 12.5, 20, 30, 60.5], 'sorted, a line with two stamps appears twice, an empty stamp is kept');
assert.deepEqual(parsed.lines.map((l) => l.text), ['first', 'second', 'chorus', '', 'chorus']);
parsed = parseLyrics('[offset: +500]\n[00:10.00] a');
assert.equal(parsed.lines[0].time, 9.5, 'a positive offset shows lines sooner');
parsed = parseLyrics('\n\n  Verse one\n\nVerse two [quietly]\n\n');
assert.equal(parsed.synced, false);
assert.deepEqual(parsed.lines.map((l) => l.text), ['  Verse one', '', 'Verse two [quietly]'], 'plain text keeps its blank lines, and square brackets in words are words');
assert.ok(parsed.lines.every((l) => l.time === null));
assert.deepEqual(parseLyrics('').lines, []);
assert.deepEqual(parseLyrics(null).lines, []);
const lines = [{ time: 1 }, { time: 5 }, { time: 9 }];
assert.equal(lineAt(lines, 0.5), -1, 'before the first line');
assert.equal(lineAt(lines, 1), 0);
assert.equal(lineAt(lines, 8.9), 1);
assert.equal(lineAt(lines, 100), 2);
console.log('PASS reading LRC and plain lyrics');

// --- The client ---
assert.equal(cleanQuery({ title: '' }), null, 'no title, nothing to look up');
assert.equal(cleanQuery(null), null);
assert.equal(cleanQuery({ title: 'x', duration: 'long' }).duration, null);
assert.equal(cleanQuery({ title: 'x', duration: 175.4 }).duration, 175);
assert.equal(bestMatch([{ duration: 300, syncedLyrics: 'x' }], 175), null, 'a different length is a different recording');
assert.equal(bestMatch([{ duration: 175, plainLyrics: 'p' }, { duration: 176, syncedLyrics: 's' }], 175).syncedLyrics, 's', 'synced first');
console.log('PASS query cleaning and search matching');

const response = (status, body, headers = {}) => ({ status, ok: status < 400, text: async () => JSON.stringify(body), headers: new Headers(headers) });
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'beachday-lyrics-'));
let calls = [];
let reply = () => response(404, {});
const fetch = async (url, options) => {
  calls.push({ url, ua: options.headers['User-Agent'] });
  return reply(url);
};
const fresh = (name) => createLyrics({ cacheDir: path.join(dir, name), userAgent: 'Beachday v9', fetch, api: 'http://fake', gapMs: 0, log: () => {} });
const song = { fingerprint: 'sha256:abc', title: 'Cobalt Coastlands', artist: 'Game Freak', album: 'Arceus', duration: 191.2 };

let lyrics = fresh('a');
reply = () => response(200, { syncedLyrics: '[00:01.00] hi', plainLyrics: 'hi', instrumental: false });
assert.deepEqual(await lyrics.fetch(song), { status: 'found', synced: '[00:01.00] hi', plain: 'hi' });
assert.equal(calls.length, 1);
assert.match(calls[0].url, /^http:\/\/fake\/get\?/);
const asked = new URL(calls[0].url).searchParams;
assert.equal(asked.get('track_name'), 'Cobalt Coastlands');
assert.equal(asked.get('artist_name'), 'Game Freak');
assert.equal(asked.get('album_name'), 'Arceus');
assert.equal(asked.get('duration'), '191');
assert.equal(calls[0].ua, 'Beachday v9', 'it says who it is');
console.log('PASS a lookup asks for the track, by name');

calls = [];
assert.equal((await lyrics.cached(song)).synced, '[00:01.00] hi', 'remembered…');
assert.equal(calls.length, 0, '…without the network');
assert.equal(await lyrics.cached({ ...song, fingerprint: 'sha256:other' }), null);
console.log('PASS answers are cached on disk');

lyrics = fresh('b');
reply = (url) => (url.includes('/get?') ? response(404, {}) : response(200, [{ duration: 400, syncedLyrics: 'wrong' }, { duration: 192, plainLyrics: 'right' }]));
calls = [];
assert.equal((await lyrics.fetch(song)).plain, 'right', 'an inexact match falls back to search');
assert.equal(calls.length, 2);
assert.ok(calls[1].url.includes('/search?') && !calls[1].url.includes('album_name'), 'search leaves out what might differ');

lyrics = fresh('c');
reply = () => response(200, { instrumental: true, syncedLyrics: null, plainLyrics: null });
assert.deepEqual(await lyrics.fetch(song), { status: 'instrumental' });
lyrics = fresh('d');
reply = (url) => (url.includes('/get?') ? response(404, {}) : response(200, []));
assert.deepEqual(await lyrics.fetch(song), { status: 'none' });
assert.deepEqual(await lyrics.cached(song), { status: 'none' }, '“none” is remembered, so it isn’t asked again');
calls = [];
assert.deepEqual(await lyrics.fetch({ ...song, artist: '' }), { status: 'none' });
assert.equal(calls.length, 0, 'no artist: no guess, no request');
console.log('PASS search fallback, instrumentals, nothing found');

// “None” expires.
let clock = 1_000_000;
lyrics = createLyrics({ cacheDir: path.join(dir, 'e'), userAgent: 'x', fetch, api: 'http://fake', gapMs: 0, now: () => clock });
await lyrics.fetch(song);
clock += 31 * 24 * 60 * 60 * 1000;
assert.equal(await lyrics.cached(song), null, 'a month later, “none” is worth asking again');
console.log('PASS “nothing found” is rechecked after a month');

// Being told to wait.
clock = 1_000_000;
lyrics = createLyrics({ cacheDir: path.join(dir, 'f'), userAgent: 'x', fetch, api: 'http://fake', gapMs: 0, now: () => clock });
reply = () => response(429, {}, { 'Retry-After': '120' });
calls = [];
assert.deepEqual(await lyrics.fetch(song), { status: 'unavailable' });
assert.equal(await lyrics.cached(song), null, 'not remembered');
assert.equal(calls.length, 1);
reply = () => response(200, { plainLyrics: 'later' });
assert.deepEqual(await lyrics.fetch(song), { status: 'unavailable' }, 'while paused…');
assert.equal(calls.length, 1, '…nothing is sent');
clock += 119_000;
assert.deepEqual(await lyrics.fetch(song), { status: 'unavailable' });
assert.equal(calls.length, 1, 'Retry-After is honoured to the end');
clock += 2_000;
assert.equal((await lyrics.fetch(song)).plain, 'later');
assert.equal(calls.length, 2);
reply = () => { throw new Error('offline'); };
assert.deepEqual(await createLyrics({ cacheDir: path.join(dir, 'g'), userAgent: 'x', fetch, api: 'http://fake', gapMs: 0 }).fetch(song), { status: 'unavailable' }, 'offline is quiet');
console.log('PASS Retry-After, and being offline');

// A moment's wait is sat out, once.
lyrics = fresh('i');
let busy = 1;
reply = () => (busy-- > 0 ? response(503, {}, { 'Retry-After': '0.05' }) : response(200, { plainLyrics: 'after a moment' }));
calls = [];
assert.equal((await lyrics.fetch(song)).plain, 'after a moment');
assert.equal(calls.length, 2, 'asked again, once');
lyrics = fresh('j');
reply = () => response(503, {}, { 'Retry-After': '0.05' });
calls = [];
assert.deepEqual(await lyrics.fetch(song), { status: 'unavailable' });
assert.equal(calls.length, 2, 'and only once');
console.log('PASS a busy moment is waited out once');

// One at a time, spaced out.
let running = 0, most = 0;
const times = [];
const slow = async () => {
  times.push(Date.now());
  most = Math.max(most, ++running);
  await new Promise((r) => setTimeout(r, 15));
  running--;
  return response(200, { plainLyrics: 'x' });
};
lyrics = createLyrics({ cacheDir: path.join(dir, 'h'), userAgent: 'x', fetch: slow, api: 'http://fake', gapMs: 60 });
await Promise.all([1, 2, 3, 4].map((n) => lyrics.fetch({ ...song, fingerprint: `f${n}` })));
assert.equal(most, 1, 'never two at once');
assert.ok(times.every((t, i) => i === 0 || t - times[i - 1] >= 55), `spaced out: ${times.map((t, i) => t - (times[i - 1] ?? t))}`);
console.log('PASS requests go one at a time, spaced out');

await fs.rm(dir, { recursive: true, force: true });
