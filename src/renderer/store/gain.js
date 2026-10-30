/**
 * Per-track gain (PLAN.md §11, decided 2026-10-28), as pure functions.
 *
 * A track's gain is playlist-side: `overrides.gainDb`. Until the user sets
 * one, a track plays at its ReplayGain track gain, or 0dB without one. So
 * "seeded from ReplayGain" needs nothing written at import, playlists made
 * before Phase 7 get it too, and Reset Gain is simply removing the override.
 *
 * Boosts are capped at +12dB: Phase 2 measured +12dB peaking at -0.09dBFS
 * through the limiter (PLAN.md §10).
 */

export const GAIN_MAX_DB = 12;
export const GAIN_MIN_DB = -30;

export const clampGain = (db) => Math.min(GAIN_MAX_DB, Math.max(GAIN_MIN_DB, Number(db) || 0));

/** What a track plays at without an override: its ReplayGain, or 0dB. */
export const seedGainDb = (track) =>
  Number.isFinite(track.tags?.replayGainDb) ? clampGain(track.tags.replayGainDb) : 0;

/** The gain a track plays at, in dB. */
export const trackGainDb = (track) =>
  Number.isFinite(track.overrides?.gainDb) ? clampGain(track.overrides.gainDb) : seedGainDb(track);

/** "+3.5 dB", "-6.92 dB", "0 dB". */
export function formatGain(db) {
  const rounded = Math.round(db * 100) / 100;
  if (rounded === 0) return '0 dB';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} dB`;
}
