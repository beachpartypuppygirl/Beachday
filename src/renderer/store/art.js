/**
 * The art resolution chain (PLAN.md §5), as pure functions over a document.
 *
 * Playlist art (custom track art, group art, the playlist cover) is referred
 * to in documents as "art/<cache name>": main unpacks it into the art cache
 * when a .bday opens, and packs it back into the file's art/ on save. Embedded
 * art arrives separately, as each track's resolution.artUrl.
 *
 *   track      custom art → embedded art
 *   group      explicit group art → first track with art (custom, then embedded)
 *              → playlist cover → its first track's generated symbol
 *   art pane   the playing track's art → its group's art (grouped view)
 *              → playlist cover → the track's generated symbol
 *
 * null at the end of a chain means "draw the generated symbol" (symbols.js),
 * from symbolSeed.
 */

const ART_URL_PREFIX = 'beachday-media://art/';

/** The URL to show a playlist art reference ("art/<name>") at, or null. */
export const artRefUrl = (ref) =>
  typeof ref === 'string' && ref.startsWith('art/') ? ART_URL_PREFIX + ref.slice('art/'.length) : null;

/** A track's own art: playlist-side custom art wins over what's embedded in the file. */
export const trackArtUrl = (track, resolved) => artRefUrl(track.overrides?.art) ?? resolved?.artUrl ?? null;

/** Explicit art for a group, from the document's groups (keyed like the layout's groups). */
export const groupArtRef = (doc, key) => (doc.groups ?? []).find((group) => group.key === key)?.art ?? null;

/**
 * What a track's generated symbol is drawn from: its audio fingerprint, so it
 * follows the file through renames, moves and other people's machines. A
 * track not fingerprinted yet falls back to its file name, then its id.
 */
export const symbolSeed = (track) =>
  track.fingerprint ?? (track.relPath ?? track.absPath)?.split(/[\\/]/).pop() ?? track.id;

/** Animated GIFs get paused when the window loses focus. */
export const isGifUrl = (url) => typeof url === 'string' && url.toLowerCase().endsWith('.gif');
