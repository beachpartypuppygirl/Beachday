/**
 * Grouping (PLAN.md §5 "Grouping — token templates, not hardcoded modes").
 *
 * A grouping is a template, not a mode:
 *   groupKey   which tracks belong together
 *   mainName   the header's large line
 *   subNames   smaller lines beneath it
 * "By Album" and "By Artist" are presets; Phase 7's custom groups are the same
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

/**
 * @param {object} doc          playlist document
 * Each group's artUrl follows the art chain (art.js): explicit group art,
 * then the first track with art, then the playlist cover. null means the
 * header draws the generated symbol for symbolSeed (its first track's).
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

  const groups = [];
  const byKey = new Map();
  for (const track of doc.tracks) {
    const fields = trackFields(track);
    const key = keyOf(grouping.groupKey, fields);
    let group = byKey.get(key);
    if (!group) {
      group = { key, fields, trackIds: [], duration: 0, artUrl: null, symbolSeed: symbolSeed(track), year: null, playable: 0 };
      byKey.set(key, group);
      groups.push(group);
    }
    group.trackIds.push(track.id);
    group.duration += track.tags.duration ?? 0;
    group.artUrl ??= trackArtUrl(track, resolution[track.id]);
    group.year ??= track.tags.year ?? null;
  }

  const order = [];
  const rows = [];
  const groupOf = new Map();
  const coverUrl = artRefUrl(doc.meta?.cover);
  for (const group of groups) {
    group.artUrl = artRefUrl(groupArtRef(doc, group.key)) ?? group.artUrl ?? coverUrl;
    const count = group.trackIds.length;
    const extra = { tracks: `${count} ${count === 1 ? 'Track' : 'Tracks'}`, duration: formatDuration(group.duration) };
    const mainFields = { ...group.fields, album: group.fields.album || UNKNOWN.album, albumartist: group.fields.albumartist || UNKNOWN.albumartist };
    group.mainName = fillTemplate(grouping.mainName, mainFields, extra) || 'Untitled Group';
    group.subNames = grouping.subNames.map((template) => fillTemplate(template, group.fields, extra)).filter(Boolean);
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
