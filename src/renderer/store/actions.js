import * as store from './playlists.js';
import * as ui from './ui.js';
import { player } from '../audio/engine.js';

/**
 * User-level flows that span the store, main and dialogs: tabs, open, save,
 * close, import, clipboard, relink. Menu commands (menus/commands.js) call these.
 */

const api = window.beachday;

const viewed = () => store.getState().playlists[store.getState().viewedId];

/**
 * If playlist `id` has unsaved changes, ask what to do with them.
 * Resolves true when it's fine to proceed (saved or discarded), false to stop.
 */
export async function settleUnsaved(id) {
  const playlist = store.getState().playlists[id];
  if (!playlist || !store.isDirty(playlist)) return true;
  store.viewPlaylist(id); // Show which playlist the question is about.
  const choice = await api.dialog.confirmUnsaved(store.playlistName(playlist));
  if (choice === 'cancel') return false;
  if (choice === 'save') return save(id);
  store.revertToSaved(id);
  return true;
}

// --- Tabs --------------------------------------------------------------------

/** New tab. An untouched empty viewed tab is reused instead. */
export function newPlaylist() {
  if (viewed() && store.isPristine(viewed())) return;
  store.createPlaylist();
}

/** Add an opened playlist as a tab, replacing the viewed one if it's untouched and empty. */
function showOpened(result) {
  const existing = store.findByPath(result.filePath);
  if (existing) {
    if (!existing.loaded) store.loadInto(existing.id, result);
    store.viewPlaylist(existing.id);
    return;
  }
  const pristine = viewed() && store.isPristine(viewed()) ? viewed().id : null;
  store.addOpenedPlaylist(result);
  if (pristine) store.closePlaylist(pristine);
  if (store.missingCount(viewed()) > 0) ui.openDialog('relink');
}

/** Open a .bday — from a dialog, or `filePath` from Open Recent. */
export async function openPlaylist(filePath = null) {
  const result = filePath ? await api.playlist.openRecent(filePath) : await api.playlist.open();
  ui.refreshRecent();
  if (result) showOpened(result);
}

export async function closeTab(id) {
  const playlist = store.getState().playlists[id];
  if (!playlist || (store.isPristine(playlist) && store.getState().order.length === 1)) return;
  if (await settleUnsaved(id)) store.closePlaylist(id);
}

export const closeViewed = () => viewed() && closeTab(viewed().id);

/** Load a restored tab the first time it's viewed (PLAN.md §5: tabs are shortcuts). */
async function ensureLoaded(id) {
  const playlist = store.getState().playlists[id];
  if (!playlist || playlist.loaded || playlist.loadError || loading.has(id)) return;
  loading.add(id);
  try {
    const result = await api.playlist.openSession(playlist.filePath);
    if (!result) store.markLoadError(id, 'unreadable');
    else if (result.missing) store.markLoadError(id, 'missing');
    else {
      store.loadInto(id, result);
      if (store.getState().viewedId === id && store.missingCount(store.getState().playlists[id]) > 0) {
        ui.openDialog('relink');
      }
    }
  } finally {
    loading.delete(id);
  }
}
const loading = new Set();

/** A restored tab's file has moved: pick it again. */
export async function relocateTab(id) {
  const result = await api.playlist.open();
  ui.refreshRecent();
  if (!result) return;
  const other = store.findByPath(result.filePath);
  if (other && other.id !== id) {
    store.closePlaylist(id);
    store.viewPlaylist(other.id);
    return;
  }
  store.loadInto(id, result);
  store.viewPlaylist(id);
}

/** Reopen last session's tabs, unloaded until viewed. Runs once at startup. */
export async function restoreSession() {
  const { restoreTabs, tabs, active } = await api.session.get();
  ui.setRestoreTabs(restoreTabs);
  if (tabs.length) {
    const initial = viewed();
    const ids = tabs.map((tab) => store.addSessionTab(tab));
    store.viewPlaylist(ids[Math.min(Math.max(active, 0), ids.length - 1)]);
    if (initial && store.isPristine(initial)) store.closePlaylist(initial.id);
  }
  sessionReady = true;
  watchSession();
}

let sessionReady = false;

// Persist the saved tabs whenever they change, and load a tab when it's viewed.
function watchSession() {
  let lastKey = null;
  let timer = null;
  const onChange = () => {
    const { order, playlists, viewedId } = store.getState();
    ensureLoaded(viewedId);
    const saved = order.map((id) => playlists[id]).filter((p) => p.filePath);
    const tabs = saved.map((p) => ({ filePath: p.filePath, name: store.playlistName(p) }));
    const active = Math.max(0, saved.findIndex((p) => p.id === viewedId));
    const key = JSON.stringify([tabs, active]);
    if (key === lastKey) return;
    lastKey = key;
    clearTimeout(timer);
    timer = setTimeout(() => api.session.save({ tabs, active }), 300);
  };
  store.subscribe(onChange);
  onChange();
}

export async function toggleRestoreTabs() {
  const next = !ui.getState().restoreTabs;
  await api.session.setRestoreTabs(next);
  ui.setRestoreTabs(next);
}

/** Main asked to close the window: settle every unsaved playlist first. */
export async function requestAppClose() {
  if (!sessionReady) return api.app.confirmClose();
  for (const id of store.getState().order) {
    if (!(await settleUnsaved(id))) return;
  }
  api.app.confirmClose();
}

// --- Save --------------------------------------------------------------------

/**
 * Save playlist `id`. Options:
 *   saveAs   always ask for a location
 *   storage  'reference' | 'bundled' (default: unchanged)
 *   copy     Export Bundled Copy: write elsewhere, leave this playlist as it is
 * Resolves true when saved.
 */
export async function save(id, { saveAs = false, storage, copy = false } = {}) {
  const playlist = store.getState().playlists[id];
  if (!playlist?.loaded) return false;
  const doc = playlist.doc;
  const targetStorage = storage ?? playlist.storage;
  const urls = Object.fromEntries(
    doc.tracks
      .map((track) => [track.id, playlist.resolution[track.id]])
      .filter(([, resolved]) => resolved?.status === 'ok')
      .map(([trackId, resolved]) => [trackId, resolved.url])
  );
  // Collapse state is view state, but it travels in the .bday (PLAN.md §5).
  // The rest of a group entry (art, description) is document state, kept as is.
  const { collapsed } = playlist.view;
  const pinned = new Set(doc.tracks.map((track) => track.groupId).filter(Boolean));
  const groups = [
    ...doc.groups.map((group) => ({ ...group, collapsed: collapsed.has(group.key) })),
    ...[...collapsed].filter((key) => !doc.groups.some((group) => group.key === key)).map((key) => ({ key, collapsed: true })),
  ]
    .filter((group) => group.collapsed || Object.keys(group).some((field) => field !== 'key' && field !== 'collapsed'))
    // A custom group nothing is pinned to any more is gone.
    .filter((group) => !group.custom || pinned.has(group.key));

  const label = copy ? 'Exporting' : targetStorage === 'bundled' ? 'Bundling' : 'Saving';
  ui.setBusy({ label });
  const unsubscribe = api.playlist.onSaveProgress(({ written, total }) =>
    ui.setBusy({ label, fraction: total ? written / total : null })
  );
  let result;
  try {
    result = await api.playlist.save({
      filePath: playlist.filePath,
      saveAs,
      copy,
      storage: targetStorage,
      doc: { ...doc, groups },
      urls,
    });
  } finally {
    unsubscribe();
    ui.setBusy(null);
  }
  ui.refreshRecent();
  if (!result) return false;

  if (!copy) {
    store.markSaved(id, { filePath: result.filePath, storage: targetStorage, savedDoc: doc, stored: result.stored });
  }
  const skipped = result.unbundled
    ? ` ${result.unbundled} missing ${result.unbundled === 1 ? 'track' : 'tracks'} couldn't be bundled.`
    : '';
  ui.notify(`${copy ? 'Exported a bundled copy' : 'Saved'}.${skipped}`);
  return true;
}

export const saveViewed = (options) => viewed() && save(viewed().id, options);

/** Playlist ▸ Storage. Converting is a save in the other mode. */
export async function setStorage(storage) {
  const playlist = viewed();
  if (!playlist || playlist.storage === storage) return;
  await save(playlist.id, { storage });
}

export const undo = () => viewed() && store.undo(viewed().id);
export const redo = () => viewed() && store.redo(viewed().id);

// --- Import ------------------------------------------------------------------

/** Run an import request (pick files, pick folder, drop) into the viewed playlist. */
export async function importInto(request, { afterId = null } = {}) {
  const id = store.getState().viewedId;
  try {
    store.insertTracks(id, await request(), { afterId });
  } catch (error) {
    // Per-file failures are already absorbed in main; this is the whole request failing.
    console.error('Import failed', error);
  }
}

export const addFiles = () => importInto(api.tracks.pickFiles);
export const addFolder = () => importInto(api.tracks.pickFolder);

// --- Clipboard (in-app; how tracks move between playlists) --------------------

let clipboard = [];

export const hasClipboard = () => clipboard.length > 0;

function copySelectionItems(playlist) {
  const byId = new Map(playlist.doc.tracks.map((track) => [track.id, track]));
  return store.selectedIds(playlist).map((trackId) => ({
    track: byId.get(trackId),
    resolution: playlist.resolution[trackId] ?? { status: 'missing', url: null, artUrl: null },
  }));
}

export function copySelection() {
  const playlist = viewed();
  if (playlist) clipboard = copySelectionItems(playlist);
  if (clipboard.length) ui.notify(`Copied ${clipboard.length} ${clipboard.length === 1 ? 'track' : 'tracks'}.`);
}

export function cutSelection() {
  const playlist = viewed();
  if (!playlist) return;
  clipboard = copySelectionItems(playlist);
  store.removeTracks(playlist.id, clipboard.map(({ track }) => track.id), 'Cut');
}

/** Paste after the last selected track (or at the end), as new tracks. */
export function paste() {
  const playlist = viewed();
  if (!playlist || !clipboard.length) return;
  // Pasted tracks get new ids. Links between pasted tracks come along (a
  // copied chain pastes as a chain); links to anything else don't.
  const ids = new Map(clipboard.map(({ track }) => [track.id, `t_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`]));
  const items = clipboard.map(({ track, resolution }) => ({
    track: { ...track, id: ids.get(track.id), linkNext: ids.get(track.linkNext) ?? null },
    resolution,
  }));
  const afterId = store.selectedIds(playlist).at(-1) ?? null;
  store.insertTracks(playlist.id, items, { afterId, label: 'Paste', select: true });
}

export function removeSelection() {
  const playlist = viewed();
  if (playlist) store.removeTracks(playlist.id, store.selectedIds(playlist));
}

// --- Navigation --------------------------------------------------------------

/** View ▸ Jump to Now Playing: show the playing tab, open its group, select the row. */
export function jumpToNowPlaying() {
  const { playingId } = store.getState();
  const trackId = player.getState().current?.id;
  if (!playingId || !trackId) return;
  if (!store.getState().order.includes(playingId)) return; // Closed tab, playing out of sight.
  store.viewPlaylist(playingId);
  store.revealTrack(playingId, trackId);
  store.setSelection(playingId, [trackId], { anchorId: trackId, focusId: trackId });
  ui.requestScroll(playingId, trackId);
}

/** Track ▸ Show in File Manager, for the first selected track. */
export function showSelectedInFolder() {
  const playlist = viewed();
  const trackId = playlist && store.selectedIds(playlist)[0];
  const url = trackId && playlist.resolution[trackId]?.url;
  if (url) api.playlist.showInFolder(url);
}

// --- Relink ------------------------------------------------------------------

const missingTracks = (playlist) =>
  playlist.doc.tracks.filter((track) => playlist.resolution[track.id]?.status !== 'ok');

/**
 * Re-run relinking for the viewed playlist's missing tracks. With
 * `searchFolder`, the user picks a folder to search by fingerprint.
 * Resolves the number found, or null if cancelled.
 */
export async function resolveMissing({ searchFolder = false } = {}) {
  const playlist = viewed();
  const before = missingTracks(playlist);
  if (!before.length) return 0;
  const resolution = await api.playlist.resolve({ filePath: playlist.filePath, tracks: before, searchFolder });
  if (!resolution) return null;
  store.mergeResolution(playlist.id, resolution);
  return Object.values(resolution).filter((r) => r.status === 'ok').length;
}

/** Locate one missing track by hand; the folder mapping it teaches fixes others. */
export async function locateTrack(trackId) {
  const playlist = viewed();
  const track = playlist.doc.tracks.find((t) => t.id === trackId);
  const resolution = await api.playlist.locate({ filePath: playlist.filePath, track });
  if (!resolution) return null;
  store.mergeResolution(playlist.id, { [trackId]: resolution });
  const others = await resolveMissing();
  return 1 + (others ?? 0);
}

// --- Art (PLAN.md §5 "Art pane") ----------------------------------------------

/**
 * Set Custom Art: one image for tracks `ids` of playlist `id`. Track ▸ Set
 * Custom Art passes the selection; the art pane's right-click, the playing track.
 */
export async function setCustomArt(id, ids) {
  if (!ids?.length) return;
  const ref = await pickArt(ids.length === 1 ? 'Choose custom art' : `Choose custom art for ${ids.length} tracks`);
  if (ref) store.setTrackArt(id, ids, ref);
}

/**
 * Pick an image for playlist art (custom track art, a group's, the cover).
 * Resolves its "art/<name>" ref, or null if cancelled.
 */
export async function pickArt(title) {
  // A big GIF is downscaled on the way in (main's guardrail), which can take a moment.
  ui.setBusy({ label: 'Preparing art' });
  try {
    return (await api.art.pick(title))?.ref ?? null;
  } finally {
    ui.setBusy(null);
  }
}

/** Clear Custom Art: back to embedded art (or the rest of the chain). */
export const clearCustomArt = (id, ids) => store.setTrackArt(id, ids, null);

// --- Groups (PLAN.md §5 "Grouping") ------------------------------------------

/** Track ▸ Move to Group ▸ New Group…: make one from the selection, then name it. */
export function newGroupFromSelection() {
  const playlist = viewed();
  const ids = playlist && store.selectedIds(playlist);
  if (!ids?.length) return;
  const key = store.createGroup(playlist.id, ids);
  ui.openDialog('groups', { key, focusName: true });
}

/** Set Group Art…, from the group header's right-click menu. */
export async function setGroupArt(id, key) {
  const ref = await pickArt('Choose group art');
  if (ref) store.editGroups(id, new Map([[key, { art: ref }]]), 'Set Group Art');
}

export const clearGroupArt = (id, key) => store.editGroups(id, new Map([[key, { art: null }]]), 'Clear Group Art');

export const toggleArtPane = () => ui.setArtPane({ visible: !ui.getState().artPane.visible });
export const resetArtPane = () => ui.setArtPane({ fraction: ui.DEFAULT_ART_FRACTION });
export const togglePauseGifs = () => ui.setPauseGifs(!ui.getState().pauseGifs);
export const togglePauseGifsWithPlayback = () => ui.setPauseGifsWithPlayback(!ui.getState().pauseGifsWithPlayback);
