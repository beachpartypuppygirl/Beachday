/**
 * Grouping (PLAN.md §5 "Grouping — token templates, not hardcoded modes").
 *
 * A grouping is a template, not a mode:
 *   groupKey   which tracks belong together
 *   mainName   the header's large line
 *   subNames   smaller lines beneath it
 * "By Album" and "By Artist" are presets; Grouping ▸ Custom… is the same
 * thing with user-written templates.
 *
 * buildLayout() turns a playlist into the flattened row model the virtualized
 * list renders: [{ type: 'group' }, { type: 'track' }, ...]. Virtualizing a
 * nested tree is where grouped lists go wrong (PLAN.md §7); a flat array of
 * fixed-height rows doesn't.
 *
 * Display order: groups appear in the order their first track appears in the
 * playlist; within a group, tracks keep playlist order. Playback follows the
 * display order, so what you see is what plays.
 *
 * Pure and React-free.
 */

import { artRefUrl, groupArtRef, symbolSeed, trackArtUrl } from './art.js';

export const PRESETS = {
  album: {
    preset: 'album',
    groupKey: '%albumartist% / %album%',
    mainName: '%album%',
    subNames: ['%albumartist%', '%genre% | %codec% %bitrate% | %tracks% | Time: %duration%'],
  },
  artist: {
    preset: 'artist',
    groupKey: '%albumartist%',
    mainName: '%albumartist%',
    subNames: ['%tracks% | Time: %duration%'],
  },
  // Custom Groups Only: tags group nothing, so every track not in a custom
  // group shares one group. New Group… switches to this when grouping is off.
  manual: {
    preset: 'manual',
    groupKey: '',
    mainName: 'Ungrouped Tracks',
    subNames: ['%tracks% | Time: %duration%'],
  },
};

const UNKNOWN = { album: 'Unknown Album', albumartist: 'Unknown Artist' };

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Per-track token values. */
function trackFields(track) {
  const { tags } = track;
  return {
    title: track.overrides.title || tags.title || '',
    artist: tags.artist || '',
    albumartist: tags.albumArtist || tags.artist || '',
    album: tags.album || '',
    year: tags.year ? String(tags.year) : '',
    genre: tags.genre || '',
    codec: tags.codec ? tags.codec.toLowerCase() : '',
    bitrate: tags.bitrate ? `${tags.bitrate} kbps` : '',
  };
}

/**
 * Fill a template. Group-level tokens (%tracks%, %duration%) come from
 * `extra`. Empty segments between " | " separators are dropped, so a WAV
 * with no genre doesn't render "| WAV".
 */
export function fillTemplate(template, fields, extra = {}) {
  const value = template.replace(/%(\w+)%/g, (_, token) => extra[token] ?? fields[token] ?? '');
  return value
    .split(' | ')
    .map((part) => part.trim())
    .filter((part) => part && part !== 'Time:')
    .join(' | ');
}

const keyOf = (template, fields) =>
  template.replace(/%(\w+)%/g, (_, token) => (fields[token] || `\u0000${token}`).toLowerCase());

/** The group a track's tags put it in under `grouping`, ignoring any pin. */
export const derivedKey = (grouping, track) => keyOf(grouping.groupKey, trackFields(track));

/** Tokens a template can use, for the editors' help text. */
export const TOKENS = ['album', 'albumartist', 'artist', 'title', 'year', 'genre', 'codec', 'bitrate', 'tracks', 'duration'];

/** Header lines below the main name. The 74px header row fits two. */
export const SUB_LINES = 2;

/**
 * Custom groups (Track ▸ Move to Group ▸ New Group) are doc.groups entries
 * with `custom: true` and a key of this form. Unlike groups derived from tags,
 * they exist whatever the template is, for as long as a track is pinned to them.
 */
export const CUSTOM_PREFIX = 'custom:';
export const newCustomKey = () => `${CUSTOM_PREFIX}g_${Math.random().toString(16).slice(2, 10)}`;

const text = (value) => (typeof value === 'string' ? value : '');

/**
 * @param {object} doc          playlist document
 * Each group's artUrl follows the art chain (art.js): explicit group art,
 * then the first track with art, then the playlist cover. null means the
 * header draws the generated symbol for symbolSeed (its first track's).
 *
 * Membership: a track's `groupId` pins it to a group, overriding its tags.
 * A pin is honoured when it names a custom group, or a group that some
 * track's tags produce under the current template; a pin to a group that no
 * longer exists (the template changed) falls back to the track's own group.
 *
 * A doc.groups entry can override a group's header: `mainName` and
 * `subNames[i]` are templates that replace the grouping's, line by line
 * (empty = the grouping's). `description` rides along for the header's tooltip.
 *
 * @param {object} resolution   trackId -> { status, url, artUrl }
 * @param {Set<string>} collapsed  collapsed group keys
 * @returns {{
 *   order: string[],                 track ids in display (and playback) order
 *   groups: object[],                null when grouping is off
 *   rows: object[],                  flattened, collapse applied
 *   groupOf: Map<string, object>,    trackId -> group
 * }}
 */
export function buildLayout(doc, resolution, collapsed) {
  const grouping = doc.grouping;
  if (!grouping) {
    const order = doc.tracks.map((track) => track.id);
    const rows = doc.tracks.map((track, i) => ({ type: 'track', id: track.id, number: i + 1, group: null }));
    return { order, groups: null, rows, groupOf: new Map() };
  }

  const entries = new Map();
  for (const entry of doc.groups ?? []) if (typeof entry.key === 'string') entries.set(entry.key, entry);
  const derived = doc.tracks.map((track) => {
    const fields = trackFields(track);
    return { fields, key: keyOf(grouping.groupKey, fields) };
  });
  const derivedKeys = new Set(derived.map(({ key }) => key));
  const honoured = (pin) => typeof pin === 'string' && (derivedKeys.has(pin) || (pin.startsWith(CUSTOM_PREFIX) && entries.get(pin)?.custom));

  const groups = [];
  const byKey = new Map();
  doc.tracks.forEach((track, i) => {
    const own = derived[i];
    const key = honoured(track.groupId) ? track.groupId : own.key;
    let group = byKey.get(key);
    if (!group) {
      const entry = entries.get(key);
      group = {
        key,
        custom: Boolean(entry?.custom),
        // Header fields come from the first track that belongs by its tags; a
        // track pinned in from elsewhere only stands in until one turns up.
        fields: null,
        firstFields: own.fields,
        pinned: 0,
        trackIds: [],
        duration: 0,
        artUrl: null,
        symbolSeed: symbolSeed(track),
        year: null,
        description: text(entry?.description),
        playable: 0,
      };
      byKey.set(key, group);
      groups.push(group);
    }
    if (key === own.key) group.fields ??= own.fields;
    else group.pinned += 1;
    group.trackIds.push(track.id);
    group.duration += track.tags.duration ?? 0;
    group.artUrl ??= trackArtUrl(track, resolution[track.id]);
    group.year ??= track.tags.year ?? null;
  });

  const order = [];
  const rows = [];
  const groupOf = new Map();
  const coverUrl = artRefUrl(doc.meta?.cover);
  for (const group of groups) {
    const entry = entries.get(group.key);
    group.fields ??= group.firstFields;
    delete group.firstFields;
    group.artUrl = artRefUrl(groupArtRef(doc, group.key)) ?? group.artUrl ?? coverUrl;
    const count = group.trackIds.length;
    const extra = { tracks: `${count} ${count === 1 ? 'Track' : 'Tracks'}`, duration: formatDuration(group.duration) };
    const mainFields = { ...group.fields, album: group.fields.album || UNKNOWN.album, albumartist: group.fields.albumartist || UNKNOWN.albumartist };
    group.mainName = fillTemplate(text(entry?.mainName) || grouping.mainName, mainFields, extra) || 'Untitled Group';
    const overrides = Array.isArray(entry?.subNames) ? entry.subNames : [];
    const lines = Math.max(grouping.subNames.length, overrides.length);
    group.subNames = Array.from({ length: lines }, (_, i) => text(overrides[i]) || grouping.subNames[i] || '')
      .map((template) => fillTemplate(template, group.fields, extra))
      .filter(Boolean);
    group.collapsed = collapsed.has(group.key);

    rows.push({ type: 'group', key: group.key, group });
    group.trackIds.forEach((id, i) => {
      order.push(id);
      groupOf.set(id, group);
      if (!group.collapsed) rows.push({ type: 'track', id, number: i + 1, group });
    });
  }
  return { order, groups, rows, groupOf };
}

/**
 * Edit Groups: apply `edits` (key -> patch) to a document's group entries.
 * A patch sets any of mainName, subNames, description, art (null clears);
 * `dissolve: true` on a custom group unpins its tracks, which go back to the
 * groups their tags give them. Returns the same doc if nothing changed.
 */
export function applyGroupEdits(doc, edits) {
  let groups = [...(doc.groups ?? [])];
  let tracks = doc.tracks;
  let changed = false;
  for (const [key, patch] of edits) {
    if (patch.dissolve) {
      tracks = tracks.map((track) => (track.groupId === key ? { ...track, groupId: null } : track));
      groups = groups.filter((group) => group.key !== key);
      changed = true;
      continue;
    }
    const at = groups.findIndex((group) => group.key === key);
    const before = at >= 0 ? groups[at] : { key };
    const next = { ...before };
    for (const [field, value] of Object.entries(patch)) {
      const empty = value == null || value === '' || (Array.isArray(value) && value.every((line) => !line));
      if (empty) delete next[field];
      else next[field] = value;
    }
    if (JSON.stringify(next) === JSON.stringify(before)) continue;
    changed = true;
    if (at >= 0) groups[at] = next;
    else groups.push(next);
  }
  return changed ? { ...doc, groups, tracks } : doc;
}

/**
 * Track ▸ Move to Group: pin `ids` to group `key`, or unpin them (null). A
 * track whose tags already put it there is left unpinned, so it follows its
 * tags if they change. Returns the same tracks array if nothing changed.
 */
export function pinTracks(tracks, grouping, ids, key) {
  const targets = new Set(ids);
  let changed = false;
  const next = tracks.map((track) => {
    if (!targets.has(track.id)) return track;
    const groupId = key && key !== derivedKey(grouping, track) ? key : null;
    if ((track.groupId ?? null) === groupId) return track;
    changed = true;
    return { ...track, groupId };
  });
  return changed ? next : tracks;
}

/**
 * Move `ids` (in display order) so they sit immediately before `beforeId` in
 * the playlist, or immediately after `afterId`, or at the end when neither is
 * given. Returns a new tracks array, or the same one if nothing moved.
 *
 * "After" exists for dropping at the end of a group: the group's last track
 * in playlist order isn't necessarily next to the following group's first.
 */
export function moveTracks(tracks, ids, beforeId, afterId = null) {
  const moving = new Set(ids);
  if ((beforeId && moving.has(beforeId)) || (afterId && moving.has(afterId))) return tracks;
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const block = ids.map((id) => byId.get(id)).filter(Boolean);
  const rest = tracks.filter((track) => !moving.has(track.id));
  const at = beforeId
    ? rest.findIndex((track) => track.id === beforeId)
    : afterId
      ? rest.findIndex((track) => track.id === afterId) + 1
      : rest.length;
  const next = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  return next.every((track, i) => track === tracks[i]) ? tracks : next;
}

/**
 * Move a whole group before another group (or to the end). Every track of the
 * group moves, so the group's first appearance — its display position — moves.
 */
export function moveGroup(tracks, layout, key, beforeKey) {
  const group = layout.groups.find((g) => g.key === key);
  const before = beforeKey && layout.groups.find((g) => g.key === beforeKey);
  if (!group || before === group) return tracks;
  // Inserting before the target group's first track in playlist order puts
  // this group's first appearance ahead of it.
  const firstOfBefore = before && tracks.find((track) => layout.groupOf.get(track.id) === before);
  const displayIds = layout.order.filter((id) => layout.groupOf.get(id) === group);
  return moveTracks(tracks, displayIds, firstOfBefore?.id ?? null);
}
