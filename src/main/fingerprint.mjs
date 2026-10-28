import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/**
 * Cheap content fingerprint for relinking (PLAN.md §4): size + first 64KB +
 * last 64KB, hashed. Two reads regardless of file size, and enough to tell
 * "same audio file, moved" apart from "different file with the same name".
 *
 * Works on a byte range, so a track bundled inside a .bday (stored
 * uncompressed) has the same fingerprint as the loose file it came from.
 * Retagging a file changes its bytes, and so its fingerprint; path-based
 * relinking steps don't depend on it.
 */

const CHUNK = 64 * 1024;

/** @param {{ path: string, offset?: number, size: number }} source */
export async function fingerprint({ path, offset = 0, size }) {
  const handle = await open(path, 'r');
  try {
    const hash = createHash('sha256').update(`${size}:`);
    const headLength = Math.min(CHUNK, size);
    hash.update(await readExactly(handle, offset, headLength));
    if (size > CHUNK) {
      const tailLength = Math.min(CHUNK, size - CHUNK);
      hash.update(await readExactly(handle, offset + size - tailLength, tailLength));
    }
    return `sha256:${hash.digest('hex').slice(0, 32)}`;
  } finally {
    await handle.close();
  }
}

async function readExactly(handle, position, length) {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}
