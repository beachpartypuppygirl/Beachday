import { app } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { guardGif } from './gif.mjs';

/**
 * On-disk art cache, so the renderer can show art by URL instead of shuttling
 * megabytes of image data over IPC per track.
 *
 * Content-addressed: the file name is a hash of the image bytes as they came
 * in, so an album's 17 tracks sharing one cover produce one file, and
 * re-importing is free. Lives in userData/art-cache.
 *
 * Two kinds of art pass through it:
 *   embedded art   extracted from audio tags; re-extracted on machines that lack it
 *   playlist art   custom track art, group art, the playlist cover (PLAN.md §4).
 *                  The .bday is where it's stored; it's unpacked here on open, and
 *                  documents refer to it as "art/<cache name>" (playlistArtRef).
 *
 * Everything goes through the GIF guardrail (gif.mjs) on the way in, so the
 * cache never holds an animation too big to decode. The type comes from the
 * bytes, never from a declared format or file extension: tags and .bday files
 * are untrusted input.
 */

export const ART_CONTENT_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

/** Bigger than any real cover; refusing it keeps a hostile file from filling memory. */
export const MAX_ART_BYTES = 64 * 1024 * 1024;

const NAME_PATTERN = /^[0-9a-f]{32}\.(jpg|png|gif|webp|bmp)$/;
export const PLAYLIST_ART_DIR = 'art/';

const cacheDir = () => path.join(app.getPath('userData'), 'art-cache');
/** name -> in-flight write, so two imports of one cover don't race. */
const writing = new Map();

/** The image type of `data` from its magic bytes, as a cache extension, or null. */
export function sniffImageType(data) {
  if (!data || data.length < 12) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.toString('latin1', 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (data.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (data.toString('latin1', 0, 2) === 'BM') return 'bmp';
  return null;
}

/** Pick the image to represent a track: the front cover if tagged, else the first. */
export function chooseCover(pictures = []) {
  return pictures.find((picture) => picture.type === 'Cover (front)') ?? pictures[0] ?? null;
}

/**
 * Write image bytes (`picture.data`) to the cache. Resolves its cache name, or
 * null when it isn't an image we show (or is a GIF beyond rescue).
 */
export async function cacheArt(picture) {
  const data = picture?.data && Buffer.from(picture.data.buffer, picture.data.byteOffset, picture.data.byteLength);
  const extension = sniffImageType(data);
  if (!extension || data.length > MAX_ART_BYTES) return null;

  const name = `${createHash('sha256').update(data).digest('hex').slice(0, 32)}.${extension}`;
  if (!writing.has(name)) {
    writing.set(name, store(name, data).finally(() => writing.delete(name)));
  }
  return writing.get(name);
}

async function store(name, data) {
  const target = path.join(cacheDir(), name);
  if (await exists(target)) return name; // Content-addressed: already correct.

  let bytes = data;
  if (name.endsWith('.gif')) {
    const guarded = await guardGif(data);
    if (!guarded) return null;
    bytes = guarded.data;
  }

  // Every time, not once: the folder may have been cleared while running.
  await mkdir(cacheDir(), { recursive: true });
  // Temp + rename: the protocol may be asked for this name while it's written.
  const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(temp, bytes);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return name;
}

/** Cache an image file the user picked (Track ▸ Set Custom Art). */
export async function cacheArtFile(filePath) {
  const { size } = await stat(filePath);
  if (size > MAX_ART_BYTES) return null;
  return cacheArt({ data: await readFile(filePath) });
}

/** Map a cache name from a URL back to a path, rejecting anything that isn't one. */
export function resolveArtPath(name) {
  return NAME_PATTERN.test(name) ? path.join(cacheDir(), name) : null;
}

const exists = (filePath) => access(filePath).then(() => true, () => false);

export async function artExists(name) {
  const filePath = resolveArtPath(name);
  return Boolean(filePath) && exists(filePath);
}

/** "art/<name>": how documents and .bday manifests refer to playlist art. */
export const playlistArtRef = (name) => `${PLAYLIST_ART_DIR}${name}`;

/** The cache name in a playlist art reference, or null if it isn't a valid one. */
export function artNameOfRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(PLAYLIST_ART_DIR)) return null;
  const name = ref.slice(PLAYLIST_ART_DIR.length);
  return NAME_PATTERN.test(name) ? name : null;
}
