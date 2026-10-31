import { useSyncExternalStore } from 'react';
import { player } from '../audio/engine.js';
import * as ui from './ui.js';
import { parseLyrics } from './lrc.js';

/**
 * Which lyrics a track has, and when to go looking for them (PLAN.md §18).
 *
 * A playlist's own lyrics (overrides.lyrics, from Track ▸ Edit Lyrics) always
 * win. Otherwise main's local cache is read for the playing track and the one
 * being prepared next, which costs nothing. With Options ▸ Fetch Lyrics
 * Automatically on, a cache miss goes to LRCLIB, for those two tracks only:
 * never a whole playlist. Track ▸ Fetch Lyrics asks for one track on purpose.
 */

/** Skipping through tracks shouldn't look any of them up; a pick that stays does. */
const SETTLE_MS = 1500;

const api = window.beachday;
const listeners = new Set();

/**
 * lyricsKey -> { status: 'loading' | 'found' | 'instrumental' | 'none' | 'unavailable', synced?, plain? }
 * Track ids are only unique within a playlist; the audio's fingerprint is the song.
 */
let entries = {};
const pending = new Set();

const keyOf = (track) => track.lyricsQuery.fingerprint ?? track.id;

const notify = () => listeners.forEach((listener) => listener());
const put = (key, entry) => {
  entries = { ...entries, [key]: entry };
  notify();
};
const drop = (key) => {
  const { [key]: _, ...rest } = entries;
  entries = rest;
  notify();
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A track's stored result, or null if nothing's known yet. */
export const fetchedLyrics = (track) => entries[keyOf(track)] ?? null;

/** The text the Edit Lyrics dialog starts from. */
export function lyricsText(track) {
  const entry = fetchedLyrics(track);
  return track.customLyrics ?? entry?.synced ?? entry?.plain ?? '';
}

/** What to show for a track: { status, synced, lines }. */
export function lyricsOf(track) {
  if (track?.customLyrics) return { status: 'found', ...parseLyrics(track.customLyrics) };
  const entry = track && fetchedLyrics(track);
  if (entry?.status !== 'found') return { status: entry?.status ?? 'none', synced: false, lines: [] };
  return { status: 'found', ...parseLyrics(entry.synced ?? entry.plain) };
}

export const useLyrics = (track) => {
  useSyncExternalStore(subscribe, () => entries);
  return lyricsOf(track);
};

const wanted = (key) => {
  const { current, upcoming } = player.getState();
  return [current, upcoming].some((track) => track && keyOf(track) === key);
};

/** Read the cache for a track, then go online if that's allowed and it's still wanted. */
async function prepare(track) {
  if (!track || track.customLyrics) return;
  const key = keyOf(track);
  // Couldn't reach LRCLIB last time: this is the "later" it gets tried again.
  const known = entries[key] && entries[key].status !== 'unavailable';
  if (known || pending.has(key)) return;
  pending.add(key);
  try {
    const cached = await api.lyrics.cached(track.lyricsQuery);
    if (cached) return put(key, cached);
    if (!ui.getState().fetchLyrics) return;
    put(key, { status: 'loading' });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    if (wanted(key)) put(key, await api.lyrics.fetch(track.lyricsQuery));
    else drop(key);
  } finally {
    pending.delete(key);
  }
}

/** Track ▸ Fetch Lyrics: ask LRCLIB for this track now, whatever's stored. */
export async function fetchNow(track) {
  const key = keyOf(track);
  put(key, { status: 'loading' });
  const result = await api.lyrics.fetch(track.lyricsQuery);
  put(key, result);
  return result;
}

/** Options ▸ Fetch Lyrics Automatically was turned on: what's playing shouldn't have to wait for the next track. */
export function prepareWanted() {
  const { current, upcoming } = player.getState();
  prepare(current);
  prepare(upcoming);
}

let seen = { current: null, upcoming: null };

player.subscribe(() => {
  const { current, upcoming } = player.getState();
  if (current?.id !== seen.current) prepare(current);
  if (upcoming?.id !== seen.upcoming) prepare(upcoming);
  seen = { current: current?.id ?? null, upcoming: upcoming?.id ?? null };
});
