import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Test fixtures: a throwaway work folder laid out like someone's computer,
 * built from three test tracks in the audio folder (AUDIO: `audiotracks`
 * beside the project, or $BEACHDAY_TEST_AUDIO; music is never committed).
 * Tests copy them; the originals are never touched.
 *
 *   <work>/home/Music/Splatoon/Splatoon 3 - Cryogenic Hopetown.flac
 *   <work>/home/Music/Splatoon/Splatoon 2 Octo Expansion - Fly Octo Fly.mp3
 *   <work>/home/Music/Breakcore/feel sooooo hard (renamed).wav   (renamed: relinking must find it by fingerprint)
 *   <work>/home/{Downloads/inbox, Playlists, Extracted}, <work>/out
 */

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const AUDIO = process.env.BEACHDAY_TEST_AUDIO ?? path.join(ROOT, '..', 'audiotracks');

const TRACKS = [
  ['Splatoon 3 - Cryogenic Hopetown.flac', 'Splatoon/Splatoon 3 - Cryogenic Hopetown.flac'],
  ['Splatoon 2 Octo Expansion - Fly Octo Fly.mp3', 'Splatoon/Splatoon 2 Octo Expansion - Fly Octo Fly.mp3'],
  ['darkmagiciangirl - feel sooooo hard.wav', 'Breakcore/feel sooooo hard (renamed).wav'],
];

export async function makeWorkDir(label) {
  const missing = [];
  for (const [name] of TRACKS) {
    await fs.access(path.join(AUDIO, name)).catch(() => missing.push(name));
  }
  if (missing.length) {
    throw new Error(`Test audio missing from ${AUDIO} (set BEACHDAY_TEST_AUDIO to use another folder):\n  ${missing.join('\n  ')}`);
  }

  const work = await fs.mkdtemp(path.join(os.tmpdir(), `beachday-${label}-`));
  for (const dir of ['home/Music/Splatoon', 'home/Music/Breakcore', 'home/Downloads/inbox', 'home/Playlists', 'home/Extracted', 'out']) {
    await fs.mkdir(path.join(work, dir), { recursive: true });
  }
  for (const [name, target] of TRACKS) {
    await fs.copyFile(path.join(AUDIO, name), path.join(work, 'home/Music', target));
  }
  return work;
}

export const removeWorkDir = (work) => fs.rm(work, { recursive: true, force: true });
