import { useSyncExternalStore } from 'react';
import { player } from '../audio/engine.js';

/**
 * Transient UI state that isn't part of any playlist: which dialog is open,
 * long-running work in progress, and short notices.
 */

/** View ▸ Reset Art Pane Size: inside PLAN.md §5's 1/2–2/3 target. */
export const DEFAULT_ART_FRACTION = 0.55;

const listeners = new Set();
let state = {
  /**
   * null | 'relink' | 'mappings' | 'shortcuts' | 'about' | 'properties' |
   * 'playlistProperties' | 'colors' | 'gain' | 'lyrics' | 'grouping' | 'groups' | 'sharing'
   */
  dialog: null,
  /** What the open dialog is about, e.g. { key } for 'groups', { ids } for 'gain' */
  dialogArgs: null,
  /** Playlist ▸ Colors: the palette being tried, shown in place of the viewed playlist's */
  palettePreview: null,
  /** null | { label, fraction? } — a save or import in progress */
  busy: null,
  /** null | string — a short message, cleared after a few seconds */
  notice: null,
  /** Open Recent entries, refreshed after every open and save */
  recentFiles: [],
  /** Options ▸ Restore Tabs on Startup (mirrors app config) */
  restoreTabs: true,
  /** Ask the track list to scroll a row into view: { playlistId, trackId, nonce } */
  scrollRequest: null,
  /** Track ▸ Rename (F2): edit this row's title in place. { playlistId, trackId, nonce } */
  renameRequest: null,
  /** View ▸ Show Art Pane, and its share of the window width (mirrors app config) */
  artPane: { visible: true, fraction: DEFAULT_ART_FRACTION },
  /** Options ▸ Pause GIFs When Window Is Unfocused (mirrors app config) */
  pauseGifs: true,
  /** Options ▸ Pause GIFs When Playback Pauses: the art pane's GIF follows the music */
  pauseGifsWithPlayback: true,
  /**
   * Options ▸ Show Track Shapes Instead of Art: the art pane, group headers and
   * the OS overlay show each track's generated symbol, whatever art it has (mirrors app config)
   */
  showShapes: false,
  /** View ▸ Art Pane: 'art' | 'lyrics' | 'over' (mirrors app config) */
  artPaneMode: 'art',
  /** View ▸ Art Pane ▸ Dim Art Behind Lyrics (mirrors app config) */
  dimLyricsArt: true,
  /** Options ▸ Fetch Lyrics Automatically (mirrors app config) */
  fetchLyrics: false,
};

const NOTICE_MS = 5000;
let noticeTimer = null;

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getState = () => state;
export const useUi = () => useSyncExternalStore(subscribe, getState);

export const openDialog = (dialog, dialogArgs = null) => set({ dialog, dialogArgs });
export const closeDialog = () => set({ dialog: null, dialogArgs: null });
export const setBusy = (busy) => set({ busy });
export const setPalettePreview = (palettePreview) => set({ palettePreview });

export function notify(notice) {
  clearTimeout(noticeTimer);
  set({ notice });
  noticeTimer = setTimeout(() => set({ notice: null }), NOTICE_MS);
}

export const setRestoreTabs = (restoreTabs) => set({ restoreTabs });

export async function loadPrefs() {
  const prefs = await window.beachday.prefs.get();
  const { artPane, pauseGifs, pauseGifsWithPlayback, showShapes, artPaneMode, dimLyricsArt, fetchLyrics } = prefs;
  set({ artPane, pauseGifs, pauseGifsWithPlayback, showShapes, artPaneMode, dimLyricsArt, fetchLyrics });
  player.setShowShapes(showShapes);
}

/**
 * Change the art pane. `persist: false` updates the screen only, for every
 * pointer move of a drag; the drag's end persists.
 */
export function setArtPane(patch, { persist = true } = {}) {
  set({ artPane: { ...state.artPane, ...patch } });
  if (persist) window.beachday.prefs.set({ artPane: state.artPane });
}

export function setPauseGifs(pauseGifs) {
  set({ pauseGifs });
  window.beachday.prefs.set({ pauseGifs });
}

export function setPauseGifsWithPlayback(pauseGifsWithPlayback) {
  set({ pauseGifsWithPlayback });
  window.beachday.prefs.set({ pauseGifsWithPlayback });
}

export function setShowShapes(showShapes) {
  set({ showShapes });
  player.setShowShapes(showShapes);
  window.beachday.prefs.set({ showShapes });
}

/** App-level, like the other view preferences: one way of looking at every playlist. */
function setPref(patch) {
  set(patch);
  window.beachday.prefs.set(patch);
}

export const setArtPaneMode = (artPaneMode) => setPref({ artPaneMode });
export const setDimLyricsArt = (dimLyricsArt) => setPref({ dimLyricsArt });
export const setFetchLyrics = (fetchLyrics) => setPref({ fetchLyrics });

let scrollNonce = 0;
export const requestScroll = (playlistId, trackId) =>
  set({ scrollRequest: { playlistId, trackId, nonce: ++scrollNonce } });
export const requestRename = (playlistId, trackId) =>
  set({ renameRequest: { playlistId, trackId, nonce: ++scrollNonce } });
export const clearRename = () => set({ renameRequest: null });

export async function refreshRecent() {
  set({ recentFiles: await window.beachday.playlist.recent() });
}
