/**
 * Playlist-side tags: the artist, album and album artist a playlist gives a
 * track, in `overrides`, over what its file says. Like every override they
 * travel in the .bday; the file itself is never written.
 *
 * Pure and React-free.
 */

export const TAG_FIELDS = ['artist', 'album', 'albumArtist'];

/**
 * A track's override for `field`, or null. A blank one counts: swapping with an
 * empty tag has to leave the other side empty. A .bday is untrusted input.
 */
export const tagOverride = (track, field) => {
  const value = track.overrides?.[field];
  return typeof value === 'string' ? value : null;
};

/** What a track says for `field`: the playlist's value, else the file's, else ''. */
export const trackTag = (track, field) => tagOverride(track, field) ?? track.tags[field] ?? '';

/**
 * `track`'s overrides with `patch` applied (field -> value, null for the file's
 * own). A value the file already has needs no override. Returns the same object
 * if nothing changed.
 */
export function withTags(track, patch) {
  const changes = { ...patch };
  // An album artist that only repeats the artist follows it.
  const albumArtist = trackTag(track, 'albumArtist');
  if ('artist' in patch && !('albumArtist' in patch) && albumArtist && albumArtist === trackTag(track, 'artist')) {
    changes.albumArtist = patch.artist;
  }

  let { overrides } = track;
  for (const [field, value] of Object.entries(changes)) {
    const next = value === (track.tags[field] ?? '') ? null : value;
    if (next === tagOverride(track, field)) continue;
    const { [field]: _, ...rest } = overrides;
    overrides = next === null ? rest : { ...rest, [field]: next };
  }
  return overrides;
}

/** `track`'s overrides with its artist and album exchanged. */
export const withSwappedTags = (track) =>
  withTags(track, { artist: trackTag(track, 'album'), album: trackTag(track, 'artist') });
