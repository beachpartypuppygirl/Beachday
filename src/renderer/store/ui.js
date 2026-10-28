import { useSyncExternalStore } from 'react';

/**
 * Transient UI state that isn't part of any playlist: which dialog is open,
 * long-running work in progress, and short notices.
 */

const listeners = new Set();
let state = {
  /** null | 'relink' | 'mappings' | 'shortcuts' | 'about' */
  dialog: null,
  /** null | { label, fraction? } — a save or import in progress */
  busy: null,
  /** null | string — a short message, cleared after a few seconds */
  notice: null,
  /** Open Recent entries, refreshed after every open and save */
  recentFiles: [],
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

export async function refreshRecent() {
  set({ recentFiles: await window.beachday.playlist.recent() });
}
