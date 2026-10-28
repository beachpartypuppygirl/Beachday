import { player } from '../audio/engine.js';

/**
 * The playlist store (PLAN.md §5 "Playlist tabs", "Undo / redo").
 *
 * Holds many open playlists at once — `order` is the future tab strip — and
 * tracks which one is viewed and which one is playing, which can differ.
 * Phase 4 shows one at a time; Phase 5 adds the tabs.
 *
 * Each playlist separates:
 *   doc         the document: what a .bday saves. Immutable; every change
 *               produces a new doc through edit(), the one undoable path.
 *   resolution  this session's view of where each track's audio is
 *               (trackId -> { status, url, artUrl }). Not undoable, not saved.
 *
 * Dirty means doc !== savedDoc. Undoing back to the saved state is clean
 * again for free, because it restores that exact object.
 */

const HISTORY_LIMIT = 200;

let nextId = 1;
const listeners = new Set();

let state = {
  /** id -> playlist */
  playlists: {},
  /** Open playlists in tab order. A playing playlist that was closed stays in `playlists` but leaves `order`. */
  order: [],
  viewedId: null,
  playingId: null,
};

// meta.name stays empty until the user names the playlist (Phase 7); until
// then it's shown under its file name. See playlistName().
const emptyDoc = () => ({
  meta: { name: '', description: '', author: '', cover: null },
  palette: null,
  grouping: null,
  groups: [],
  tracks: [],
});

function makePlaylist({ filePath = null, storage = 'reference', doc = emptyDoc(), resolution = {} } = {}) {
  return {
    id: `p${nextId++}`,
    filePath,
    storage,
    doc,
    savedDoc: doc,
    past: [],
    future: [],
    resolution,
  };
}

function set(patch) {
  state = { ...state, ...patch };
  syncQueue();
  listeners.forEach((listener) => listener());
}

function updatePlaylist(id, patch) {
  const playlist = state.playlists[id];
  if (!playlist) return;
  set({ playlists: { ...state.playlists, [id]: { ...playlist, ...patch } } });
}

// --- Reading -----------------------------------------------------------------

export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getState = () => state;

export const isDirty = (playlist) => playlist.doc !== playlist.savedDoc;

export function playlistName(playlist) {
  if (playlist.doc.meta.name) return playlist.doc.meta.name;
  if (playlist.filePath) return playlist.filePath.split(/[\\/]/).pop().replace(/\.bday$/i, '');
  return 'Untitled';
}

/** Empty, never saved, untouched: safe to replace without asking. */
export const isPristine = (playlist) =>
  !playlist.filePath && playlist.doc.tracks.length === 0 && !isDirty(playlist);

export const missingCount = (playlist) =>
  playlist.doc.tracks.filter((track) => playlist.resolution[track.id]?.status !== 'ok').length;

/** What the UI and the engine show for a track: overrides win over tags. */
export function trackView(track, resolution) {
  const resolved = resolution?.[track.id];
  return {
    id: track.id,
    url: resolved?.status === 'ok' ? resolved.url : null,
    missing: resolved?.status !== 'ok',
    artUrl: resolved?.artUrl ?? null,
    title: track.overrides.title || track.tags.title,
    artist: track.tags.artist,
    album: track.tags.album,
    duration: track.tags.duration,
    gainDb: track.overrides.gainDb ?? 0,
    path: track.absPath,
  };
}

// --- Playlists ---------------------------------------------------------------

/** Add a new empty playlist and view it. */
export function createPlaylist() {
  const playlist = makePlaylist();
  set({
    playlists: { ...state.playlists, [playlist.id]: playlist },
    order: [...state.order, playlist.id],
    viewedId: playlist.id,
  });
  return playlist.id;
}

/** Add a playlist that main opened from disk, and view it. */
export function addOpenedPlaylist({ filePath, storage, doc, resolution }) {
  const playlist = makePlaylist({ filePath, storage, doc, resolution });
  set({
    playlists: { ...state.playlists, [playlist.id]: playlist },
    order: [...state.order, playlist.id],
    viewedId: playlist.id,
  });
  return playlist.id;
}

/** The open playlist with this file, if any (opening it again just views it). */
export const findByPath = (filePath) =>
  state.order.map((id) => state.playlists[id]).find((p) => p.filePath === filePath) ?? null;

export function viewPlaylist(id) {
  if (state.order.includes(id)) set({ viewedId: id });
}

/**
 * Close a playlist. If it's playing, it keeps playing out of sight until
 * playback moves to another playlist; prompting for unsaved changes is the
 * caller's job (actions.js), so by now its document is settled.
 */
export function closePlaylist(id) {
  const order = state.order.filter((other) => other !== id);
  const playlists = { ...state.playlists };
  if (id !== state.playingId) delete playlists[id];
  const viewedId = state.viewedId === id ? (order.at(-1) ?? null) : state.viewedId;
  set({ playlists, order, viewedId });
  if (state.order.length === 0) createPlaylist();
}

/** Drop the unsaved changes of a playlist that's being closed. */
export function revertToSaved(id) {
  const playlist = state.playlists[id];
  if (playlist) updatePlaylist(id, { doc: playlist.savedDoc, past: [], future: [] });
}

// --- Editing (the one undoable path) -----------------------------------------

/**
 * Apply `recipe(doc) -> newDoc` to a playlist as one undoable step.
 * `label` names it in Edit ▸ Undo <label>.
 */
export function edit(id, label, recipe) {
  const playlist = state.playlists[id];
  if (!playlist) return;
  const doc = recipe(playlist.doc);
  if (doc === playlist.doc) return;
  updatePlaylist(id, {
    doc,
    past: [...playlist.past, { label, doc: playlist.doc }].slice(-HISTORY_LIMIT),
    future: [],
  });
}

export function undo(id) {
  const playlist = state.playlists[id];
  const step = playlist?.past.at(-1);
  if (!step) return;
  updatePlaylist(id, {
    doc: step.doc,
    past: playlist.past.slice(0, -1),
    future: [{ label: step.label, doc: playlist.doc }, ...playlist.future],
  });
}

export function redo(id) {
  const playlist = state.playlists[id];
  const step = playlist?.future[0];
  if (!step) return;
  updatePlaylist(id, {
    doc: step.doc,
    past: [...playlist.past, { label: step.label, doc: playlist.doc }],
    future: playlist.future.slice(1),
  });
}

/** Append imported tracks ({ track, resolution } items from main). */
export function addTracks(id, items) {
  if (!items.length) return;
  mergeResolution(
    id,
    Object.fromEntries(items.map(({ track, resolution }) => [track.id, resolution]))
  );
  edit(id, items.length === 1 ? 'Add Track' : 'Add Tracks', (doc) => ({
    ...doc,
    tracks: [...doc.tracks, ...items.map(({ track }) => track)],
  }));
}

// --- Not undoable ------------------------------------------------------------

/** Session-only location updates (relinking). Never part of history. */
export function mergeResolution(id, resolution) {
  const playlist = state.playlists[id];
  if (playlist) updatePlaylist(id, { resolution: { ...playlist.resolution, ...resolution } });
}

/**
 * Record a completed save. `savedDoc` is the document as it was sent; if the
 * user kept editing while a long (bundled) save ran, the current doc differs
 * and the playlist correctly stays dirty.
 *
 * `stored` carries what main wrote for each track's location (relPath etc.),
 * folded into the document without an undo step when nothing changed meanwhile.
 */
export function markSaved(id, { filePath, storage, savedDoc, stored }) {
  const playlist = state.playlists[id];
  if (!playlist) return;
  let doc = playlist.doc;
  let saved = savedDoc;
  if (doc === savedDoc) {
    doc = saved = {
      ...savedDoc,
      tracks: savedDoc.tracks.map((track) => (stored[track.id] ? { ...track, ...stored[track.id] } : track)),
    };
  }
  updatePlaylist(id, { filePath, storage, doc, savedDoc: saved });
}

// --- Playback ----------------------------------------------------------------

const queueOf = (playlist) => playlist.doc.tracks.map((track) => trackView(track, playlist.resolution));

/** Start playing track `index` of playlist `id`. */
export function play(id, index) {
  const playlist = state.playlists[id];
  if (!playlist) return;
  if (state.playingId !== id) {
    // A closed playlist that was only kept around for playback can go now.
    const playlists = { ...state.playlists };
    if (state.playingId && !state.order.includes(state.playingId)) delete playlists[state.playingId];
    set({ playlists, playingId: id });
  }
  player.playIndex(index);
}

// The engine plays a flat queue. Whenever the playing playlist's tracks or
// their resolution change, hand it the new queue; it keeps its place by id.
let synced = { id: null, tracks: null, resolution: null };

function syncQueue() {
  const playlist = state.playlists[state.playingId];
  if (!playlist) {
    if (synced.id !== null) player.setQueue([]);
    synced = { id: null, tracks: null, resolution: null };
    return;
  }
  const { tracks } = playlist.doc;
  if (synced.id === playlist.id && synced.tracks === tracks && synced.resolution === playlist.resolution) return;
  synced = { id: playlist.id, tracks, resolution: playlist.resolution };
  player.setQueue(queueOf(playlist));
}

createPlaylist();
