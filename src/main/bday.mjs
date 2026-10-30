import fs from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import yauzl from 'yauzl';
import yazl from 'yazl';

/**
 * The .bday container (PLAN.md §4): always a ZIP, in both storage modes.
 *
 *   playlist.json   the manifest (deflated)
 *   art/...         playlist-side art: custom track art, group art, the cover (stored)
 *   audio/...       bundled audio, present only when bundled (STORED, uncompressed)
 *
 * Audio is stored, not deflated: compressed audio barely shrinks, and a stored
 * entry is a plain byte range inside the zip. That lets the media protocol
 * stream (and seek) a bundled track straight out of the .bday by offset, with
 * no extraction step, however large the playlist.
 *
 * No Electron imports, so this module can be exercised from plain Node.
 */

export const FORMAT_VERSION = 1;
export const MANIFEST_NAME = 'playlist.json';
export const AUDIO_DIR = 'audio/';
export const ART_DIR = 'art/';

// Art is read into memory on open, so cap what a (possibly hostile) file can make us read.
const MAX_ART_ENTRY = 64 * 1024 * 1024;
const MAX_ART_TOTAL = 512 * 1024 * 1024;

export class BdayError extends Error {}

/**
 * Read a .bday. Returns the parsed manifest, the location of every stored
 * entry (name -> { offset, size }, offset of the entry's data in the zip), and
 * the bytes of each art/ entry (name -> Buffer).
 */
export async function readBday(filePath) {
  let zip;
  try {
    zip = await yauzl.openPromise(filePath, { autoClose: false });
  } catch (error) {
    throw new BdayError(`Not a Beachday playlist (${error.message})`);
  }

  try {
    let manifest = null;
    const entries = new Map();
    const art = new Map();
    let artTotal = 0;
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName === MANIFEST_NAME) {
        manifest = JSON.parse((await readEntry(zip, entry)).toString('utf8'));
      } else if (entry.fileName.startsWith(ART_DIR) && !entry.fileName.endsWith('/')) {
        // Art may be deflated in a hand-made file; it's small enough to read whole.
        if (entry.isEncrypted() || entry.uncompressedSize > MAX_ART_ENTRY) continue;
        if ((artTotal += entry.uncompressedSize) > MAX_ART_TOTAL) continue;
        art.set(entry.fileName, await readEntry(zip, entry));
      } else if (!entry.fileName.endsWith('/')) {
        if (entry.isCompressed() || entry.isEncrypted()) continue; // Not something we wrote; can't stream it.
        const { fileDataStart } = await zip.readLocalFileHeaderPromise(entry, { minimal: true });
        entries.set(entry.fileName, { offset: fileDataStart, size: entry.uncompressedSize });
      }
    }

    if (!manifest) throw new BdayError('Not a Beachday playlist (no playlist.json)');
    if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion > FORMAT_VERSION) {
      throw new BdayError('This playlist was made by a newer version of Beachday');
    }
    return { manifest, entries, art };
  } finally {
    zip.close();
  }
}

async function readEntry(zip, entry) {
  const stream = await zip.openReadStreamPromise(entry);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Write a .bday atomically: to a temp file beside the target, then renamed
 * over it. A failed save never leaves a half-written playlist, and the audio
 * sources may be entries of the very file being replaced.
 *
 * @param {string} targetPath
 * @param {object} manifest
 * @param {{ name: string, source: { path: string, offset?: number, size: number } }[]} audio
 * @param {(written: number, total: number) => void} [onProgress] bytes of audio copied
 * @param {{ name: string, path: string }[]} [art] art/ entries, each from a file
 */
export async function writeBday(targetPath, manifest, audio = [], onProgress = () => {}, art = []) {
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${randomBytes(4).toString('hex')}.tmp`
  );

  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), MANIFEST_NAME);
  // Images are already compressed; storing them costs nothing and saves the CPU.
  for (const { name, path: artPath } of art) zip.addFile(artPath, name, { compress: false });

  const total = audio.reduce((sum, item) => sum + item.source.size, 0);
  let written = 0;
  for (const { name, source } of audio) {
    zip.addReadStreamLazy(name, { compress: false, size: source.size }, (callback) => {
      const offset = source.offset ?? 0;
      const stream = fs.createReadStream(source.path, { start: offset, end: offset + source.size - 1 });
      stream.on('data', (chunk) => onProgress((written += chunk.length), total));
      callback(null, stream);
    });
  }
  zip.end();

  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tempPath);
      zip.on('error', reject);
      zip.outputStream.on('error', reject);
      out.on('error', reject);
      out.on('close', resolve);
      zip.outputStream.pipe(out);
    });
    await renameWithRetry(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/**
 * Windows: antivirus and indexers briefly lock freshly written files, so a
 * rename can fail with EPERM/EBUSY and succeed moments later.
 */
async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 8) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}

/**
 * A unique archive name under audio/ for a track, keeping its original file
 * name so an unzipped bundle is still browsable by hand.
 */
export function bundledName(fileName, taken) {
  const { name, ext } = path.parse(fileName.replace(/[\\/]/g, '_'));
  let candidate = `${AUDIO_DIR}${name}${ext}`;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${AUDIO_DIR}${name} (${n})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}
