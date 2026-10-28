import * as store from './playlists.js';
import * as ui from './ui.js';

/**
 * User-level flows that span the store, main and dialogs: open, save, close,
 * import, relink. Menu commands (menus/commands.js) call these.
 *
 * Phase 4 shows one playlist at a time, so New and Open *replace* the viewed
 * playlist (asking to save it first). The store already holds many; Phase 5's
 * tabs change these to open alongside instead.
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
  const choice = await api.dialog.confirmUnsaved(store.playlistName(playlist));
  if (choice === 'cancel') return false;
  if (choice === 'save') return save(id);
  store.revertToSaved(id);
  return true;
}

/** Show a new playlist in place of the viewed one. */
async function replaceViewed(addPlaylist) {
  const previous = viewed();
  if (previous && !(await settleUnsaved(previous.id))) return false;
  addPlaylist();
  if (previous) store.closePlaylist(previous.id);
  return true;
}

export async function newPlaylist() {
  if (viewed() && store.isPristine(viewed())) return;
  await replaceViewed(store.createPlaylist);
}

/** Open a .bday — from a dialog, or `filePath` from Open Recent. */
export async function openPlaylist(filePath = null) {
  const result = filePath ? await api.playlist.openRecent(filePath) : await api.playlist.open();
  ui.refreshRecent();
  if (!result) return;

  const existing = store.findByPath(result.filePath);
  if (existing) {
    store.viewPlaylist(existing.id);
    return;
  }
  const replaced = await replaceViewed(() => store.addOpenedPlaylist(result));
  if (replaced && store.missingCount(viewed()) > 0) ui.openDialog('relink');
}

/**
 * Save playlist `id`. Options:
 *   saveAs   always ask for a location
 *   storage  'reference' | 'bundled' (default: unchanged)
 *   copy     Export Bundled Copy: write elsewhere, leave this playlist as it is
 * Resolves true when saved.
 */
export async function save(id, { saveAs = false, storage, copy = false } = {}) {
  const playlist = store.getState().playlists[id];
  if (!playlist) return false;
  const doc = playlist.doc;
  const targetStorage = storage ?? playlist.storage;
  const urls = Object.fromEntries(
    doc.tracks
      .map((track) => [track.id, playlist.resolution[track.id]])
      .filter(([, resolved]) => resolved?.status === 'ok')
      .map(([id, resolved]) => [id, resolved.url])
  );

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
      doc,
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

export async function closeViewed() {
  const playlist = viewed();
  if (!playlist || store.isPristine(playlist)) return;
  if (await settleUnsaved(playlist.id)) store.closePlaylist(playlist.id);
}

/** Main asked to close the window: settle every unsaved playlist first. */
export async function requestAppClose() {
  const { order } = store.getState();
  for (const id of order) {
    if (!(await settleUnsaved(id))) return;
  }
  api.app.confirmClose();
}

export const undo = () => viewed() && store.undo(viewed().id);
export const redo = () => viewed() && store.redo(viewed().id);

// --- Import ------------------------------------------------------------------

/** Run an import request (pick files, pick folder, drop) into the viewed playlist. */
export async function importInto(request) {
  const id = store.getState().viewedId;
  try {
    store.addTracks(id, await request());
  } catch (error) {
    // Per-file failures are already absorbed in main; this is the whole request failing.
    console.error('Import failed', error);
  }
}

export const addFiles = () => importInto(api.tracks.pickFiles);
export const addFolder = () => importInto(api.tracks.pickFolder);

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
