import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Lyrics from LRCLIB (PLAN.md §18), and their local cache. No Electron imports.
 *
 * Being a good client of a free service is most of this file. Per LRCLIB's
 * docs: identify ourselves, one request at a time, and honour Retry-After.
 * REQUEST_GAP_MS keeps us under their ~45 requests a minute by construction,
 * and only the track that's playing or up next ever gets looked up.
 *
 * What's fetched stays in userData/lyrics-cache and NEVER goes into a .bday:
 * passing a playlist on shouldn't mean passing on copies of copyrighted text.
 * Each person's own copy of Beachday fetches its own.
 *
 * Results: { status: 'found', synced, plain } | { status: 'instrumental' } |
 * { status: 'none' } | { status: 'unavailable' } (offline, or told to wait;
 * the only one that isn't remembered, so it's tried again later).
 */

const LRCLIB_API = 'https://lrclib.net/api';
const REQUEST_GAP_MS = 1400;
const TIMEOUT_MS = 10_000;
/** Without a Retry-After of its own, a 429 or 503 waits this long. */
const DEFAULT_RETRY_S = 60;
/** A busy LRCLIB often asks for just a moment: a wait this short is sat out, once. */
const SHORT_RETRY_S = 5;
const MAX_RESPONSE_CHARS = 512 * 1024;
/** A track with no lyrics today may have some in a month. */
const RECHECK_NONE_MS = 30 * 24 * 60 * 60 * 1000;
/** How far /search results may differ from the track's length, in seconds. */
const DURATION_TOLERANCE_S = 3;

const text = (value) => (typeof value === 'string' && value.trim() ? value : null);

/** The fields of a query from the renderer, or null if it can't be looked up. */
export function cleanQuery(query) {
  const field = (value) => (typeof value === 'string' ? value.trim().slice(0, 300) : '');
  const clean = {
    fingerprint: field(query?.fingerprint) || null,
    title: field(query?.title),
    artist: field(query?.artist),
    album: field(query?.album),
    duration: Number.isFinite(query?.duration) && query.duration > 0 ? Math.round(query.duration) : null,
  };
  return clean.title ? clean : null;
}

/** A record from LRCLIB as a result, or null if it has nothing usable. */
function resultOf(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.instrumental === true) return { status: 'instrumental' };
  const synced = text(record.syncedLyrics);
  const plain = text(record.plainLyrics);
  return synced || plain ? { status: 'found', synced, plain } : null;
}

/** The best /search match: right length, synced lyrics first. */
export function bestMatch(records, duration) {
  if (!Array.isArray(records)) return null;
  const close = records.filter((record) => duration == null || Math.abs(record?.duration - duration) <= DURATION_TOLERANCE_S);
  const usable = close.filter((record) => resultOf(record)?.status === 'found');
  return usable.find((record) => text(record.syncedLyrics)) ?? usable[0] ?? null;
}

const cacheKey = ({ fingerprint, title, artist, album, duration }) =>
  createHash('sha256').update(fingerprint ?? JSON.stringify([title, artist, album, duration])).digest('hex');

/**
 * `userAgent` names this app to LRCLIB. `fetch` and `api` are swappable for
 * tests; `log` hears about failures.
 */
export function createLyrics({ cacheDir, userAgent, fetch, api = LRCLIB_API, gapMs = REQUEST_GAP_MS, log = () => {}, now = Date.now }) {
  const fileOf = (query) => path.join(cacheDir, `${cacheKey(query)}.json`);

  let queue = Promise.resolve();
  let nextRequestAt = 0;
  /** Set by a 429 or 503: nothing goes out before this. */
  let pausedUntil = 0;

  /** One request at a time, spaced out. Resolves parsed JSON, or null for a 404. */
  async function request(pathAndQuery, retried = false) {
    const wait = nextRequestAt - now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    nextRequestAt = now() + gapMs;
    const response = await fetch(`${api}${pathAndQuery}`, {
      headers: { 'User-Agent': userAgent },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (response.status === 429 || response.status === 503) {
      const retry = Number(response.headers.get('retry-after'));
      const seconds = retry > 0 ? retry : DEFAULT_RETRY_S;
      if (seconds <= SHORT_RETRY_S && !retried) {
        nextRequestAt = now() + seconds * 1000;
        return request(pathAndQuery, true);
      }
      pausedUntil = now() + seconds * 1000;
      throw new Error(`LRCLIB says wait (${response.status}), pausing until ${new Date(pausedUntil).toISOString()}`);
    }
    if (!response.ok) throw new Error(`LRCLIB: HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > MAX_RESPONSE_CHARS) throw new Error('LRCLIB: response too large');
    return JSON.parse(body);
  }

  async function lookUp({ title, artist, album, duration }) {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const search = `/search?${params}`;
    if (album) params.set('album_name', album);
    if (duration) params.set('duration', String(duration));
    const exact = resultOf(await request(`/get?${params}`));
    if (exact) return exact;
    // Tags vary in small ways (a remaster's length, an album's spelling).
    return resultOf(bestMatch(await request(search), duration)) ?? { status: 'none' };
  }

  async function remember(query, result) {
    await mkdir(cacheDir, { recursive: true });
    const target = fileOf(query);
    const temp = `${target}.tmp`;
    await writeFile(temp, JSON.stringify({ ...result, fetchedAt: now() }));
    await rename(temp, target);
  }

  return {
    /** What's stored for this track, without touching the network; null if nothing (or too old). */
    async cached(raw) {
      const query = cleanQuery(raw);
      if (!query) return null;
      try {
        const { fetchedAt, ...result } = JSON.parse(await readFile(fileOf(query), 'utf8'));
        if (result.status === 'none' && now() - fetchedAt > RECHECK_NONE_MS) return null;
        return result;
      } catch {
        return null;
      }
    },

    /** Ask LRCLIB, and remember the answer. Queued behind any other lookup. */
    fetch(raw) {
      const query = cleanQuery(raw);
      if (!query) return Promise.resolve({ status: 'none' });
      // Title and artist are the least LRCLIB can match on; a guess from a
      // title alone would too often be somebody else's song.
      if (!query.artist) return Promise.resolve({ status: 'none' });

      const job = async () => {
        if (pausedUntil > now()) return { status: 'unavailable' };
        try {
          const result = await lookUp(query);
          await remember(query, result);
          return result;
        } catch (error) {
          log(`lyrics: "${query.title}": ${error.message}`);
          return { status: 'unavailable' };
        }
      };
      const run = queue.then(job);
      queue = run;
      return run;
    },
  };
}
