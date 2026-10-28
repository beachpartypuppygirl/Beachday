import { app } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * On-disk cache for embedded artwork, so the renderer can show it by URL
 * instead of shuttling megabytes of image data over IPC per track.
 *
 * Content-addressed: the file name is a hash of the image bytes, so an album's
 * 17 tracks sharing one cover produce one file, and re-importing is free.
 * Lives in userData/art-cache. It's a cache, not storage — playlist-side
 * custom art (Phase 7) is stored inside the .bday, never here.
 */

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

export const ART_CONTENT_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

const NAME_PATTERN = /^[0-9a-f]{32}\.(jpg|png|gif|webp|bmp)$/;

const cacheDir = () => path.join(app.getPath('userData'), 'art-cache');
let ensureDir = null;

/** Pick the image to represent a track: the front cover if tagged, else the first. */
export function chooseCover(pictures = []) {
  return pictures.find((picture) => picture.type === 'Cover (front)') ?? pictures[0] ?? null;
}

/** Write `picture` ({ format, data }) to the cache. Returns its cache name, or null. */
export async function cacheArt(picture) {
  const extension = EXTENSIONS[picture?.format?.toLowerCase()];
  if (!extension || !picture.data?.length) return null;

  const hash = createHash('sha256').update(picture.data).digest('hex').slice(0, 32);
  const name = `${hash}.${extension}`;

  ensureDir ??= mkdir(cacheDir(), { recursive: true });
  await ensureDir;
  try {
    // 'wx' fails if the file exists — which, content-addressed, means it's already correct.
    await writeFile(path.join(cacheDir(), name), picture.data, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return name;
}

/** Map a cache name from a URL back to a path, rejecting anything that isn't one. */
export function resolveArtPath(name) {
  return NAME_PATTERN.test(name) ? path.join(cacheDir(), name) : null;
}
