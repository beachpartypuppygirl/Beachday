import { player } from '../audio/engine.js';
import { applyGroupEdits, buildLayout, moveTracks, moveGroup, newCustomKey, pinTracks, PRESETS, withChains } from './grouping.js';
import { artRefUrl, symbolSeed, trackArtUrl } from './art.js';
import { clampGain, trackGainDb } from './gain.js';
import { trackTag, withSwappedTags, withTags } from './tags.js';
import { DEFAULT_PALETTE, normalizePalette, samePalette } from './theme.js';

/**
 * The playlist store (PLAN.md §5 "Playlist tabs", "Undo / redo").
 *
 * Holds many open playlists — `order` is the tab strip — and tracks which one
 * is viewed and which one is playing, which can differ.
 *
 * Each playlist separates:
 *   doc         the document: what a .bday saves. Immutable; every change
 *               produces a new doc through edit(), the one undoable path.
 *   resolution  this session's view of where each track's audio is
 *               (trackId -> { status, url, artUrl }). Not undoable, not saved.
 *   view        selection and collapsed groups. Not undoable and not "dirty";
 *               collapse state is written into the .bday when it's saved.
 *
 * Dirty means doc !== savedDoc. Undoing back to the saved state is clean
 * again for free, because it restores that exact object.
 *
 * A tab restored from the last session starts unloaded (loaded: false) and
 * is filled in by loadInto() the first time it's viewed.
 */

const HISTORY_LIMIT = 200;
/** Far past any song's lyrics, and well short of bloating a .bday. */
export const LYRICS_MAX_CHARS = 64 * 1024;

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

// meta.name stays empty until the user names the playlist (Playlist ▸
// Properties); until then it's shown under its file name. See playlistName().
const emptyDoc = () => ({
  meta: { name: '', description: '', author: '', cover: null },
  palette: null,
  grouping: null,
  groups: [],
  tracks: [],
});

const emptyView = (collapsed = new Set()) => ({
  collapsed,
  selection: new Set(),
  /** Shift+click extends from here. */
  anchorId: null,
  /** Keyboard focus row. */
  focusId: null,
  /** The selection, while it's a group's tracks picked without the group (see selectGroupTracks). */
  tracksOnly: null,
});

/** Collapsed group keys as stored in a document's `groups`. */
const collapsedOf = (doc) => new Set((doc.groups ?? []).filter((g) => g.collapsed).map((g) => g.key));

function makePlaylist({ filePath = null, storage = 'reference', doc = emptyDoc(), resolution = {}, loaded = true, name = '' } = {}) {
  return {
    id: `p${nextId++}`,
    filePath,
    storage,
    doc,
    savedDoc: doc,
    past: [],
    future: [],
    resolution,
    view: emptyView(collapsedOf(doc)),
    loaded,
    /** Unloaded tabs remember their name so the strip can label them. */
    sessionName: name,
    /** 'missing' when a restored tab's file has gone. */
    loadError: null,
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

const updateView = (id, patch) => {
  const playlist = state.playlists[id];
  if (playlist) updatePlaylist(id, { view: { ...playlist.view, ...patch } });
};

// --- Reading -----------------------------------------------------------------

export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getState = () => state;

export const isDirty = (playlist) => playlist.doc !== playlist.savedDoc;

export function playlistName(playlist) {
  if (playlist.doc.meta.name) return playlist.doc.meta.name;
  if (playlist.sessionName) return playlist.sessionName;
  if (playlist.filePath) return playlist.filePath.split(/[\\/]/).pop().replace(/\.bday$/i, '');
  return 'Untitled';
}

/** Empty, never saved, untouched: safe to replace without asking. */
export const isPristine = (playlist) =>
  !playlist.filePath && playlist.doc.tracks.length === 0 && !isDirty(playlist);

export const missingCount = (playlist) =>
  playlist.doc.tracks.filter((track) => playlist.resolution[track.id]?.status !== 'ok').length;

/** A track's own lyrics, if any. A .bday is untrusted input. */
const customLyrics = (track) => {
  const { lyrics } = track.overrides;
  return typeof lyrics === 'string' && lyrics.trim() ? lyrics.slice(0, LYRICS_MAX_CHARS) : null;
};

/** What the UI and the engine show for a track: overrides win over tags. */
export function trackView(track, resolution) {
  const resolved = resolution?.[track.id];
  return {
    id: track.id,
    url: resolved?.status === 'ok' ? resolved.url : null,
    missing: resolved?.status !== 'ok',
    artUrl: trackArtUrl(track, resolved),
    symbolSeed: symbolSeed(track),
    title: track.overrides.title || track.tags.title,
    artist: trackTag(track, 'artist'),
    album: trackTag(track, 'album'),
    duration: track.tags.duration,
    gainDb: trackGainDb(track),
    customLyrics: customLyrics(track),
    // The file's own title, not a playlist rename: it's the song being looked
    // up. Edited tags do count, since they're there to say whose song it is.
    lyricsQuery: {
      fingerprint: track.fingerprint ?? null,
      title: track.tags.title,
      artist: trackTag(track, 'artist'),
      album: trackTag(track, 'album'),
      duration: track.tags.duration,
    },
    // The engine works out chains from this (audio/sequence.js).
    linkNext: track.linkNext ?? null,
    path: track.absPath,
  };
}

// Layouts are cached per playlist and rebuilt only when an input changes.
const layoutCache = new Map();

/** The flattened row model for a playlist (grouping.js). */
export function layoutOf(playlist) {
  const { doc, resolution, view } = playlist;
  const cached = layoutCache.get(playlist.id);
  if (
    cached &&
    cached.tracks === doc.tracks &&
    cached.grouping === doc.grouping &&
    cached.groups === doc.groups &&
    cached.meta === doc.meta &&
    cached.resolution === resolution &&
    cached.collapsed === view.collapsed
  ) {
    return cached.layout;
  }
  const layout = buildLayout(doc, resolution, view.collapsed);
  layoutCache.set(playlist.id, {
    tracks: doc.tracks,
    grouping: doc.grouping,
    groups: doc.groups,
    meta: doc.meta,
    resolution,
    collapsed: view.collapsed,
    layout,
  });
  return layout;
}

/**
 * What the art pane shows for a track (art.js): its own art, else its group's
 * (grouped view), else the playlist cover. null: draw the track's symbol.
 */
export function paneArtUrl(playlist, trackId) {
  const track = playlist?.doc.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  return (
    trackArtUrl(track, playlist.resolution[trackId]) ??
    layoutOf(playlist).groupOf.get(trackId)?.artUrl ??
    artRefUrl(playlist.doc.meta.cover)
  );
}

/** `ids` plus the rest of any chain they're in, in display order: chains move as one. */
export const chainsOf = (playlist, ids) => withChains(layoutOf(playlist), ids);

/** Selected track ids in display order. */
export function selectedIds(playlist) {
  const { selection } = playlist.view;
  if (selection.size === 0) return [];
  return layoutOf(playlist).order.filter((id) => selection.has(id));
}

// --- Playlists and tabs ------------------------------------------------------

function addPlaylist(playlist, { view = true } = {}) {
  set({
    playlists: { ...state.playlists, [playlist.id]: playlist },
    order: [...state.order, playlist.id],
    viewedId: view ? playlist.id : state.viewedId,
  });
  return playlist.id;
}

/** Add a new empty playlist and view it. */
export const createPlaylist = () => addPlaylist(makePlaylist());

/** Add a playlist that main opened from disk, and view it. */
export const addOpenedPlaylist = (result) => addPlaylist(makePlaylist(result));

/** Add a tab restored from the last session, not yet loaded. */
export const addSessionTab = ({ filePath, name }) =>
  addPlaylist(makePlaylist({ filePath, name, loaded: false }), { view: false });

/** Fill an unloaded (or relocated) tab with what main opened. */
export function loadInto(id, { filePath, storage, doc, resolution }) {
  const playlist = state.playlists[id];
  if (!playlist) return;
  updatePlaylist(id, {
    filePath,
    storage,
    doc,
    savedDoc: doc,
    resolution,
    view: emptyView(collapsedOf(doc)),
    loaded: true,
    loadError: null,
  });
}

export const markLoadError = (id, loadError) => updatePlaylist(id, { loadError });

/** The open playlist with this file, if any (opening it again just views it). */
export const findByPath = (filePath) =>
  state.order.map((id) => state.playlists[id]).find((p) => p.filePath === filePath) ?? null;

export function viewPlaylist(id) {
  if (state.order.includes(id)) set({ viewedId: id });
}

/** Step through tabs: +1 next, -1 previous, wrapping. */
export function viewAdjacent(step) {
  const { order, viewedId } = state;
  if (order.length < 2) return;
  const i = order.indexOf(viewedId);
  set({ viewedId: order[(i + step + order.length) % order.length] });
}

/**
 * Close a tab. If it's playing, it keeps playing out of sight until playback
 * moves to another playlist; prompting for unsaved changes is the caller's
 * job (actions.js), so by now its document is settled.
 */
export function closePlaylist(id) {
  const index = state.order.indexOf(id);
  const order = state.order.filter((other) => other !== id);
  const playlists = { ...state.playlists };
  if (id !== state.playingId) {
    delete playlists[id];
    layoutCache.delete(id);
  }
  // Closing the viewed tab views its neighbour, as browsers do.
  const viewedId = state.viewedId === id ? (order[Math.min(index, order.length - 1)] ?? null) : state.viewedId;
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

const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * Insert tracks ({ track, resolution } items) after `afterId` in playlist
 * order, or at the end. Used by import (append) and paste; `select` selects
 * the inserted tracks (paste does, so they can be moved straight away).
 */
export function insertTracks(id, items, { afterId = null, label, select = false } = {}) {
  if (!items.length) return;
  mergeResolution(id, Object.fromEntries(items.map(({ track, resolution }) => [track.id, resolution])));
  edit(id, label ?? plural(items.length, 'Add Track', 'Add Tracks'), (doc) => {
    const at = afterId ? doc.tracks.findIndex((track) => track.id === afterId) + 1 : doc.tracks.length;
    const inserted = items.map(({ track }) => track);
    return { ...doc, tracks: [...doc.tracks.slice(0, at), ...inserted, ...doc.tracks.slice(at)] };
  });
  if (!select) return;
  const last = items.at(-1).track.id;
  updateView(id, { selection: new Set(items.map(({ track }) => track.id)), anchorId: items[0].track.id, focusId: last });
}

/** Append imported tracks. */
export const addTracks = (id, items) => insertTracks(id, items);

export function removeTracks(id, ids, label) {
  if (!ids.length) return;
  const removing = new Set(ids);
  const playlist = state.playlists[id];
  // Focus lands on the row after the removed block, so repeated Delete works.
  const order = layoutOf(playlist).order;
  const lastIndex = Math.max(...ids.map((trackId) => order.indexOf(trackId)));
  const nextFocus = order.slice(lastIndex + 1).find((trackId) => !removing.has(trackId)) ??
    [...order].reverse().find((trackId) => !removing.has(trackId)) ?? null;
  edit(id, label ?? plural(ids.length, 'Remove Track', 'Remove Tracks'), (doc) => {
    // A chain closes up around removed tracks: A → B → C without B is A → C.
    const byId = new Map(doc.tracks.map((track) => [track.id, track]));
    const healed = (next) => {
      while (next && removing.has(next)) next = byId.get(next)?.linkNext ?? null;
      return next;
    };
    const tracks = doc.tracks
      .filter((track) => !removing.has(track.id))
      .map((track) => (track.linkNext && removing.has(track.linkNext) ? { ...track, linkNext: healed(track.linkNext) } : track));
    return { ...doc, tracks };
  });
  updateView(id, {
    selection: nextFocus ? new Set([nextFocus]) : new Set(),
    anchorId: nextFocus,
    focusId: nextFocus,
  });
}

/** Drag-reorder: move `ids` before `beforeId`, or after `afterId` (neither = end). */
export function moveTracksTo(id, ids, { beforeId = null, afterId = null } = {}) {
  edit(id, plural(ids.length, 'Move Track', 'Move Tracks'), (doc) => {
    const tracks = moveTracks(doc.tracks, ids, beforeId, afterId);
    return tracks === doc.tracks ? doc : { ...doc, tracks };
  });
}

/**
 * Drag tracks into a custom group: pin them to it and put them where they
 * were dropped, as one step. `at` is { beforeId } or { afterId }.
 */
export function dropIntoGroup(id, ids, key, at) {
  edit(id, plural(ids.length, 'Move Track to Group', 'Move Tracks to Group'), (doc) => {
    const pinned = pinTracks(doc.tracks, doc.grouping, ids, key);
    const tracks = moveTracks(pinned, ids, at.beforeId ?? null, at.afterId ?? null);
    return tracks === doc.tracks ? doc : { ...doc, tracks };
  });
}

/** Drag-reorder a whole group before another (null = end). */
export function moveGroupTo(id, key, beforeKey) {
  const playlist = state.playlists[id];
  const layout = layoutOf(playlist);
  edit(id, 'Move Group', (doc) => {
    const tracks = moveGroup(doc.tracks, layout, key, beforeKey);
    return tracks === doc.tracks ? doc : { ...doc, tracks };
  });
}

/** Track ▸ Set Custom Art / Clear Custom Art. `ref` is "art/<name>", or null to clear. */
export function setTrackArt(id, ids, ref) {
  const targets = new Set(ids);
  const label = ref ? 'Set Custom Art' : 'Clear Custom Art';
  edit(id, label, (doc) => {
    let changed = false;
    const tracks = doc.tracks.map((track) => {
      if (!targets.has(track.id) || (track.overrides.art ?? null) === ref) return track;
      changed = true;
      const { art: _, ...overrides } = track.overrides;
      return { ...track, overrides: ref ? { ...overrides, art: ref } : overrides };
    });
    return changed ? { ...doc, tracks } : doc;
  });
}

/** Playlist ▸ Grouping. `preset` is a PRESETS key, or null for off. */
export function setGrouping(id, preset) {
  const labels = { album: 'Group by Album', artist: 'Group by Artist', manual: 'Custom Groups Only' };
  const label = preset ? labels[preset] : 'Turn Off Grouping';
  edit(id, label, (doc) =>
    (doc.grouping?.preset ?? null) === preset ? doc : { ...doc, grouping: preset ? PRESETS[preset] : null }
  );
}

/**
 * Playlist ▸ Grouping ▸ Custom…: a user-written template
 * ({ groupKey, mainName, subNames }). One that matches a preset becomes it.
 */
export function setGroupingTemplate(id, template) {
  const same = (a, b) => a.groupKey === b.groupKey && a.mainName === b.mainName && JSON.stringify(a.subNames) === JSON.stringify(b.subNames);
  const preset = Object.values(PRESETS).find((candidate) => same(candidate, template));
  const grouping = preset ?? { preset: 'custom', groupKey: template.groupKey, mainName: template.mainName, subNames: template.subNames };
  edit(id, 'Custom Grouping', (doc) => (doc.grouping && same(doc.grouping, grouping) && doc.grouping.preset === grouping.preset ? doc : { ...doc, grouping }));
}

/** Change some tracks' overrides. `change(overrides, track)` returns new overrides, or the same object. */
function editOverrides(id, ids, label, change) {
  const targets = new Set(ids);
  edit(id, label, (doc) => {
    let changed = false;
    const tracks = doc.tracks.map((track) => {
      if (!targets.has(track.id)) return track;
      const overrides = change(track.overrides, track);
      if (overrides === track.overrides) return track;
      changed = true;
      return { ...track, overrides };
    });
    return changed ? { ...doc, tracks } : doc;
  });
}

const without = (overrides, field) => {
  if (!(field in overrides)) return overrides;
  const { [field]: _, ...rest } = overrides;
  return rest;
};

/**
 * Track ▸ Rename. The name lives in the playlist, never in the file's tags.
 * An empty name, or the tag title itself, removes the override.
 */
export function renameTrack(id, trackId, title) {
  const name = title.trim();
  editOverrides(id, [trackId], 'Rename Track', (overrides, track) => {
    if (!name || name === track.tags.title) return without(overrides, 'title');
    return overrides.title === name ? overrides : { ...overrides, title: name };
  });
}

/** Track ▸ Edit Tags: `patch` sets artist, album or albumArtist on `ids` (null: back to the file's own). */
export function setTrackTags(id, ids, patch) {
  editOverrides(id, ids, 'Edit Tags', (_, track) => withTags(track, patch));
}

/** Track ▸ Swap Artist and Album: for files tagged the wrong way round. */
export function swapArtistAlbum(id, ids) {
  editOverrides(id, ids, 'Swap Artist and Album', (_, track) => withSwappedTags(track));
}

/** Track ▸ Adjust Gain: set `ids` to `db` (clamped to the cap), or null to reset to ReplayGain. */
export function setTrackGain(id, ids, db) {
  if (db == null) {
    editOverrides(id, ids, 'Reset Gain', (overrides) => without(overrides, 'gainDb'));
    return;
  }
  const value = Math.round(clampGain(db) * 100) / 100;
  editOverrides(id, ids, 'Adjust Gain', (overrides) => (overrides.gainDb === value ? overrides : { ...overrides, gainDb: value }));
}

/**
 * Track ▸ Edit Lyrics: lyrics that belong to this playlist and travel in its
 * .bday. Empty removes them, back to whatever's fetched. Fetched lyrics are
 * never stored here (PLAN.md §18), so saving them unedited changes nothing.
 */
export function setTrackLyrics(id, trackId, text, { fetched = null } = {}) {
  const lyrics = text.trim() ? text.trimEnd().slice(0, LYRICS_MAX_CHARS) : null;
  editOverrides(id, [trackId], 'Edit Lyrics', (overrides) => {
    if (!lyrics || (lyrics === fetched?.trimEnd() && !overrides.lyrics)) return without(overrides, 'lyrics');
    return overrides.lyrics === lyrics ? overrides : { ...overrides, lyrics };
  });
}

/** Track ▸ Reset All Overrides: name, tags, art, gain and group pin, back to the file's own. */
export function resetOverrides(id, ids) {
  const targets = new Set(ids);
  edit(id, 'Reset All Overrides', (doc) => {
    let changed = false;
    const tracks = doc.tracks.map((track) => {
      if (!targets.has(track.id) || (Object.keys(track.overrides).length === 0 && !track.groupId)) return track;
      changed = true;
      return { ...track, overrides: {}, groupId: null };
    });
    return changed ? { ...doc, tracks } : doc;
  });
}

/** Playlist ▸ Properties: name, description, author, cover ("art/<name>" or null). */
export function setMeta(id, meta) {
  edit(id, 'Edit Playlist Properties', (doc) => {
    const next = { ...doc.meta, ...meta };
    return JSON.stringify(next) === JSON.stringify(doc.meta) ? doc : { ...doc, meta: next };
  });
}

/** Playlist ▸ Colors. The default palette is stored as none, so a playlist can return to it. */
export function setPalette(id, palette) {
  const next = palette && !samePalette(palette, DEFAULT_PALETTE) ? normalizePalette(palette) : null;
  edit(id, 'Change Colors', (doc) => {
    const same = next && doc.palette ? samePalette(next, doc.palette) : next === doc.palette;
    return same ? doc : { ...doc, palette: next };
  });
}

/** Edit Groups: `edits` maps group keys to patches (grouping.js applyGroupEdits). */
export function editGroups(id, edits, label = 'Edit Groups') {
  edit(id, label, (doc) => applyGroupEdits(doc, edits));
}

/** Track ▸ Move to Group: pin `ids` to group `key`, or null to follow their tags again. */
export function moveToGroup(id, ids, key) {
  const playlist = state.playlists[id];
  const members = playlist ? chainsOf(playlist, ids) : ids;
  edit(id, key ? 'Move to Group' : 'Ungroup Tracks', (doc) => {
    if (!doc.grouping) return doc;
    const tracks = pinTracks(doc.tracks, doc.grouping, members, key);
    return tracks === doc.tracks ? doc : { ...doc, tracks };
  });
}

/**
 * Track ▸ Move to Group ▸ New Group: a custom group holding `ids`. Returns
 * its key. With grouping off, this also turns on Custom Groups Only, so the
 * rest of the playlist isn't suddenly regrouped by its tags.
 */
export function createGroup(id, ids, mainName = 'New Group') {
  const key = newCustomKey();
  const playlist = state.playlists[id];
  const members = playlist ? chainsOf(playlist, ids) : ids;
  edit(id, 'New Group', (doc) => {
    const grouping = doc.grouping ?? PRESETS.manual;
    return { ...doc, grouping, groups: [...doc.groups, { key, custom: true, mainName }], tracks: pinTracks(doc.tracks, grouping, members, key) };
  });
  return key;
}

// --- Link chains (PLAN.md §5 "Chain editing — contiguous by definition") -----

/**
 * Track ▸ Link Selected: join the selection, and any chains it touches, into
 * one chain in display order. Always succeeds:
 *   - tracks that aren't neighbours move up to follow the first one
 *   - in a grouped view, tracks from other groups join the first one's group
 *     (pinned), since a chain has to sit inside one group to be contiguous
 */
export function linkTracks(id, ids) {
  const playlist = state.playlists[id];
  if (!playlist) return;
  const layout = layoutOf(playlist);
  const block = withChains(layout, ids);
  if (block.length < 2) return;
  edit(id, 'Link Tracks', (doc) => {
    let tracks = doc.tracks;
    if (doc.grouping) {
      const home = layout.groupOf.get(block[0]);
      if (block.some((trackId) => layout.groupOf.get(trackId) !== home)) tracks = pinTracks(tracks, doc.grouping, block, home.key);
    }
    tracks = moveTracks(tracks, block.slice(1), null, block[0]);
    const next = new Map(block.map((trackId, i) => [trackId, block[i + 1] ?? null]));
    const inBlock = new Set(block);
    tracks = tracks.map((track) => {
      // Inside the block: link to the next one. Outside: a stale link into it would be a second way in.
      const linkNext = next.has(track.id) ? next.get(track.id) : inBlock.has(track.linkNext) ? null : (track.linkNext ?? null);
      return linkNext === (track.linkNext ?? null) ? track : { ...track, linkNext };
    });
    return { ...doc, tracks };
  });
}

/** Track ▸ Unlink: the selected tracks leave their chains (the links into and out of each are cut). */
export function unlinkTracks(id, ids) {
  const leaving = new Set(ids);
  edit(id, 'Unlink Tracks', (doc) => {
    let changed = false;
    const tracks = doc.tracks.map((track) => {
      if (!track.linkNext || !(leaving.has(track.id) || leaving.has(track.linkNext))) return track;
      changed = true;
      return { ...track, linkNext: null };
    });
    return changed ? { ...doc, tracks } : doc;
  });
}

// --- View state (not undoable) -----------------------------------------------

export function setSelection(id, ids, { anchorId, focusId } = {}) {
  const playlist = state.playlists[id];
  if (!playlist) return;
  updateView(id, {
    selection: new Set(ids),
    anchorId: anchorId === undefined ? playlist.view.anchorId : anchorId,
    focusId: focusId === undefined ? playlist.view.focusId : focusId,
  });
}

export function selectAll(id) {
  const playlist = state.playlists[id];
  if (playlist) setSelection(id, layoutOf(playlist).order);
}

/**
 * Group header ▸ Select All Tracks in Group: its tracks, not the group, so the
 * header stays unlit. `tracksOnly` holds this very Set, so any other selection
 * ends the state by not being it. A collapsed group opens to show them.
 */
export function selectGroupTracks(id, key) {
  const playlist = state.playlists[id];
  const group = playlist && layoutOf(playlist).groups?.find((g) => g.key === key);
  if (!group) return;
  if (group.collapsed) toggleCollapsed(id, key);
  const selection = new Set(group.trackIds);
  updateView(id, { selection, tracksOnly: selection, anchorId: group.trackIds[0], focusId: group.trackIds.at(-1) });
}

export function toggleCollapsed(id, key) {
  const playlist = state.playlists[id];
  if (!playlist) return;
  const collapsed = new Set(playlist.view.collapsed);
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
  updateView(id, { collapsed });
}

export function setAllCollapsed(id, isCollapsed) {
  const playlist = state.playlists[id];
  const groups = playlist && layoutOf(playlist).groups;
  if (groups) updateView(id, { collapsed: isCollapsed ? new Set(groups.map((g) => g.key)) : new Set() });
}

/** Expand whichever group holds `trackId`, so it can be shown. */
export function revealTrack(id, trackId) {
  const playlist = state.playlists[id];
  const group = playlist && layoutOf(playlist).groupOf.get(trackId);
  if (group && playlist.view.collapsed.has(group.key)) toggleCollapsed(id, group.key);
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
  updatePlaylist(id, { filePath, storage, doc, savedDoc: saved, sessionName: '' });
}

// --- Playback ----------------------------------------------------------------

/** The engine's queue: display order, so grouped playlists play as shown. */
const queueOf = (playlist) => {
  const byId = new Map(playlist.doc.tracks.map((track) => [track.id, track]));
  return layoutOf(playlist).order.map((id) => trackView(byId.get(id), playlist.resolution));
};

/** Start playing track `trackId` of playlist `id`; null plays from the start (or a fresh shuffle). */
export function play(id, trackId) {
  const playlist = state.playlists[id];
  if (!playlist) return;
  if (state.playingId !== id) {
    // A closed playlist that was only kept around for playback can go now.
    const playlists = { ...state.playlists };
    if (state.playingId && !state.order.includes(state.playingId)) delete playlists[state.playingId];
    set({ playlists, playingId: id });
  }
  if (trackId === null) return player.playFirst();
  const index = layoutOf(state.playlists[id]).order.indexOf(trackId);
  if (index >= 0) player.playIndex(index);
}

// The engine plays a flat queue. Whenever the playing playlist's order or
// resolution changes, hand it the new queue; it keeps its place by id.
let synced = { id: null, tracks: null, resolution: null, grouping: null, groups: null };

function syncQueue() {
  const playlist = state.playlists[state.playingId];
  if (!playlist) {
    if (synced.id !== null) player.clear();
    synced = { id: null, tracks: null, resolution: null, grouping: null, groups: null };
    return;
  }
  // Custom groups (doc.groups) take part in the display order too.
  const { tracks, grouping, groups } = playlist.doc;
  if (
    synced.id === playlist.id &&
    synced.tracks === tracks &&
    synced.resolution === playlist.resolution &&
    synced.grouping === grouping &&
    synced.groups === groups
  ) {
    return;
  }
  synced = { id: playlist.id, tracks, resolution: playlist.resolution, grouping, groups };
  player.setQueue(queueOf(playlist));
}

createPlaylist();
