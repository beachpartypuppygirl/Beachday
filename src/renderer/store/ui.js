import { useSyncExternalStore } from 'react';

/**
 * Transient UI state that isn't part of any playlist: which dialog is open,
 * long-running work in progress, and short notices.
 */

/** View ▸ Reset Art Pane Size: inside PLAN.md §5's 1/2–2/3 target. */
export const DEFAULT_ART_FRACTION = 0.55;

const listeners = new Set();
let state = {
  /** null | 'relink' | 'mappings' | 'shortcuts' | 'about' | 'properties' */
  dialog: null,
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
  /** View ▸ Show Art Pane, and its share of the window width (mirrors app config) */
  artPane: { visible: true, fraction: DEFAULT_ART_FRACTION },
  /** Options ▸ Pause GIFs When Window Is Unfocused (mirrors app config) */
  pauseGifs: true,
  /** Options ▸ Pause GIFs When Playback Pauses: the art pane's GIF follows the music */
  pauseGifsWithPlayback: true,
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

export const openDialog = (dialog) => set({ dialog });
export const closeDialog = () => set({ dialog: null });
export const setBusy = (busy) => set({ busy });

export function notify(notice) {
  clearTimeout(noticeTimer);
  set({ notice });
  noticeTimer = setTimeout(() => set({ notice: null }), NOTICE_MS);
}

export const setRestoreTabs = (restoreTabs) => set({ restoreTabs });

export async function loadPrefs() {
  const { artPane, pauseGifs, pauseGifsWithPlayback } = await window.beachday.prefs.get();
  set({ artPane, pauseGifs, pauseGifsWithPlayback });
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

let scrollNonce = 0;
export const requestScroll = (playlistId, trackId) =>
  set({ scrollRequest: { playlistId, trackId, nonce: ++scrollNonce } });

export async function refreshRecent() {
  set({ recentFiles: await window.beachday.playlist.recent() });
}
