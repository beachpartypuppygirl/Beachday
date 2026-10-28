import { parseFile, parseStream } from 'music-metadata';
import fs from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { grantMediaSource, artUrl } from './media.mjs';
import { cacheArt, chooseCover, artExists } from './art.mjs';
import { fingerprint } from './fingerprint.mjs';
import { isAudioFile } from './audioFiles.mjs';

export { AUDIO_EXTENSIONS } from './audioFiles.mjs';

/**
 * Track import: find audio files, read their tags (read-only — Beachday never
 * writes tags), cache embedded art, and return plain track objects.
 */

// Tag parsing is I/O-bound; a few in flight at once keeps a large folder
// import fast without opening hundreds of file handles.
const PARSE_CONCURRENCY = 4;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

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
 * Import `filePaths` as playlist entries, reporting progress as (done, total).
 * Returned in album order: by folder, then disc, then track number, then name.
 *
 * Each result is { track, resolution }:
 *   track       what a .bday stores — id, where the audio was (absPath; relPath
 *               is computed at save time), size + fingerprint for relinking,
 *               and a snapshot of its tags, so a playlist shows titles and
 *               totals even before (or without) finding the audio.
 *   resolution  this session only — the playable URL and art URL.
 */
export async function importTracks(filePaths, onProgress = () => {}) {
  const items = new Array(filePaths.length);
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < filePaths.length) {
      const i = next++;
      items[i] = await importTrack(filePaths[i]);
      onProgress(++done, filePaths.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARSE_CONCURRENCY, filePaths.length) }, worker));

  return items.filter(Boolean).sort(
    ({ track: a }, { track: b }) =>
      collator.compare(path.dirname(a.absPath), path.dirname(b.absPath)) ||
      (a.tags.discNo ?? 0) - (b.tags.discNo ?? 0) ||
      (a.tags.trackNo ?? 0) - (b.tags.trackNo ?? 0) ||
      collator.compare(path.basename(a.absPath), path.basename(b.absPath))
  );
}

export const newTrackId = () => `t_${randomBytes(6).toString('hex')}`;

async function importTrack(filePath) {
  let size;
  try {
    ({ size } = await stat(filePath));
  } catch {
    return null; // Vanished between listing and reading.
  }
  const source = { path: filePath, size };
  const [tags, print] = await Promise.all([readTags(source), fingerprint(source).catch(() => null)]);
  return {
    track: {
      id: newTrackId(),
      absPath: filePath,
      relPath: null,
      size,
      fingerprint: print,
      tags,
      // Playlist-side metadata (Phase 7): title, art, gainDb overrides.
      overrides: {},
      groupId: null,
      linkNext: null,
    },
    resolution: {
      status: 'ok',
      url: grantMediaSource(source),
      artUrl: tags.artName ? artUrl(tags.artName) : null,
    },
  };
}

/**
 * Read tags from a file, or from a stored entry inside a .bday
 * (source.offset set; source.name gives the entry's file name). Never throws:
 * unreadable tags leave the file name standing in for a title.
 */
export async function readTags(source) {
  const fileName = source.name ?? source.path;
  const tags = {
    title: path.parse(fileName).name,
    artist: null,
    albumArtist: null,
    album: null,
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    duration: null,
    codec: codecLabel(null, fileName),
    lossless: null,
    sampleRate: null,
    bitsPerSample: null,
    bitrate: null,
    // Phase 7 seeds overrides.gainDb from this when a track is added (PLAN.md §11).
    replayGainDb: null,
    // Art cache entry name (art.mjs). Recreated from the audio on machines that lack it.
    artName: null,
  };

  try {
    const { common, format } =
      source.offset == null
        ? await parseFile(source.path)
        : await parseStream(
            fs.createReadStream(source.path, {
              start: source.offset,
              end: source.offset + source.size - 1,
            }),
            { path: fileName, size: source.size }
          );
    Object.assign(tags, {
      title: common.title?.trim() || tags.title,
      artist: common.artist ?? null,
      albumArtist: common.albumartist ?? null,
      album: common.album ?? null,
      trackNo: common.track?.no ?? null,
      discNo: common.disk?.no ?? null,
      year: common.year ?? null,
      genre: common.genre?.[0] ?? null,
      duration: Number.isFinite(format.duration) ? format.duration : null,
      codec: codecLabel(format, fileName),
      lossless: format.container === 'WAVE' ? true : (format.lossless ?? null),
      sampleRate: format.sampleRate ?? null,
      bitsPerSample: format.bitsPerSample ?? null,
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : null,
      replayGainDb: common.replaygain_track_gain?.dB ?? null,
      artName: await cacheArt(chooseCover(common.picture)).catch(() => null),
    });
  } catch {
    // Keep the defaults.
  }
  return tags;
}

/**
 * Art URL for a loaded track. The art cache is per machine, so a playlist
 * from elsewhere names art this machine has never seen: re-extract it from
 * the audio when the audio is available.
 */
export async function ensureArt(artName, source) {
  if (!artName) return null;
  if (await artExists(artName)) return artUrl(artName);
  if (!source) return null;
  const tags = await readTags(source);
  return tags.artName ? artUrl(tags.artName) : null;
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
