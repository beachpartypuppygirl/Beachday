import { parseFile } from 'music-metadata';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { grantMediaUrl, artUrl } from './media.mjs';
import { cacheArt, chooseCover } from './art.mjs';

/**
 * Track import: find audio files, read their tags (read-only — Beachday never
 * writes tags), cache embedded art, and return plain track objects.
 */

export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'wav', 'ogg', 'opus', 'm4a', 'aac'];

// Tag parsing is I/O-bound; a few in flight at once keeps a large folder
// import fast without opening hundreds of file handles.
const PARSE_CONCURRENCY = 4;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const isAudioFile = (filePath) =>
  AUDIO_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase());

/**
 * Expand files and folders into a flat list of audio file paths. Folders are
 * walked recursively; hidden entries and symlinked folders (loop risk) are skipped.
 */
export async function collectAudioFiles(paths) {
  const found = [];
  // Resolve first so the same file reached two ways is only imported once.
  for (const entryPath of paths.map((entry) => path.resolve(entry))) {
    let info;
    try {
      info = await stat(entryPath);
    } catch {
      continue;
    }
    if (info.isDirectory()) await walk(entryPath, found);
    else if (isAudioFile(entryPath)) found.push(entryPath);
  }
  return [...new Set(found)];
}

async function walk(dir, found) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // Unreadable folder: skip it rather than failing the whole import.
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(entryPath, found);
    else if ((entry.isFile() || entry.isSymbolicLink()) && isAudioFile(entryPath)) found.push(entryPath);
  }
}

/**
 * Read tracks for `filePaths`, reporting progress as (done, total).
 * Returned in album order: by folder, then disc, then track number, then name.
 */
export async function readTracks(filePaths, onProgress = () => {}) {
  const tracks = new Array(filePaths.length);
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < filePaths.length) {
      const i = next++;
      tracks[i] = await readTrack(filePaths[i]);
      onProgress(++done, filePaths.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARSE_CONCURRENCY, filePaths.length) }, worker));

  return tracks.sort(
    (a, b) =>
      collator.compare(path.dirname(a.path), path.dirname(b.path)) ||
      (a.discNo ?? 0) - (b.discNo ?? 0) ||
      (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
      collator.compare(path.basename(a.path), path.basename(b.path))
  );
}

async function readTrack(filePath) {
  const track = {
    path: filePath,
    url: grantMediaUrl(filePath),
    // The file name stands in for a title until tags say otherwise.
    title: path.parse(filePath).name,
    artist: null,
    albumArtist: null,
    album: null,
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    duration: null,
    codec: codecLabel(null, filePath),
    lossless: null,
    sampleRate: null,
    bitsPerSample: null,
    bitrate: null,
    // Read, not applied: whether ReplayGain seeds per-track gain is a Phase 7 decision.
    replayGainDb: null,
    artUrl: null,
    metadataError: null,
  };

  try {
    const { common, format } = await parseFile(filePath);
    const cover = await cacheArt(chooseCover(common.picture)).catch(() => null);
    Object.assign(track, {
      title: common.title?.trim() || track.title,
      artist: common.artist ?? null,
      albumArtist: common.albumartist ?? null,
      album: common.album ?? null,
      trackNo: common.track?.no ?? null,
      discNo: common.disk?.no ?? null,
      year: common.year ?? null,
      genre: common.genre?.[0] ?? null,
      duration: Number.isFinite(format.duration) ? format.duration : null,
      codec: codecLabel(format, filePath),
      lossless: format.container === 'WAVE' ? true : (format.lossless ?? null),
      sampleRate: format.sampleRate ?? null,
      bitsPerSample: format.bitsPerSample ?? null,
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : null,
      replayGainDb: common.replaygain_track_gain?.dB ?? null,
      artUrl: cover ? artUrl(cover) : null,
    });
  } catch (error) {
    // Unreadable tags don't make a track unplayable; keep it with its file name.
    track.metadataError = error.message;
  }
  return track;
}

/**
 * A short display name for the format. music-metadata's codec strings vary
 * ("MPEG 1 Layer 3", and "non-PCM (65534)" for ordinary 24-bit extensible WAV),
 * so normalize the common ones and fall back to the extension.
 */
function codecLabel(format, filePath) {
  const extension = path.extname(filePath).slice(1).toUpperCase();
  if (!format) return extension;
  if (format.container === 'WAVE') return 'WAV';
  if (/layer 3/i.test(format.codec ?? '')) return 'MP3';
  return format.codec ?? extension;
}
