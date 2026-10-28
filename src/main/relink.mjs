import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fingerprint } from './fingerprint.mjs';
import { isAudioFile } from './audioFiles.mjs';

/**
 * Relinking (PLAN.md §4): find each reference track's audio on this machine.
 * Per track, in order:
 *
 *   1. relPath, against the .bday's folder
 *   2. the stored absolute path
 *   3. folder mappings (C:\Music <-> /home/me/Music), app-level config
 *   4. fingerprint match among files in known folders
 *   5. otherwise missing — the user locates it, which teaches a mapping
 *
 * Steps 1-3 also retry case-insensitively, because a playlist made on Windows
 * may spell a folder "music" where the Linux disk says "Music".
 *
 * Stored paths may come from either OS, so they're parsed with splitPath()
 * rather than the native `path` module. Candidates are always native paths.
 *
 * Only audio files are ever accepted. A .bday is untrusted input from someone
 * else's computer, and its stored paths must not be able to point Beachday at
 * arbitrary files.
 *
 * No Electron imports, so this module can be exercised from plain Node.
 */

// Upper bound on files indexed for a fingerprint search, so a .bday saved in
// a huge folder (Downloads, a whole drive) can't stall loading.
const SEARCH_FILE_LIMIT = 50_000;

/**
 * Split an absolute path from any OS into { root, segments }.
 * root is 'C:' for a drive, '//server/share' for UNC, '' for POSIX '/'.
 */
export function splitPath(p) {
  const s = p.replace(/\\/g, '/');
  let root = '';
  let rest = s;
  const drive = /^([a-zA-Z]:)(\/|$)/.exec(s);
  const unc = /^\/\/([^/]+)\/([^/]+)/.exec(s);
  if (drive) {
    root = drive[1].toUpperCase();
    rest = s.slice(2);
  } else if (unc) {
    root = `//${unc[1]}/${unc[2]}`.toLowerCase();
    rest = s.slice(unc[0].length);
  }
  return { root, segments: rest.split('/').filter(Boolean) };
}

const same = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

/** Apply one { from, to } mapping to a stored absolute path, or null if it doesn't match. */
export function applyMapping(absPath, mapping, join = path.join) {
  const target = splitPath(absPath);
  const from = splitPath(mapping.from);
  if (target.root !== from.root) return null;
  if (from.segments.length > target.segments.length) return null;
  if (!from.segments.every((segment, i) => same(segment, target.segments[i]))) return null;
  return join(mapping.to, ...target.segments.slice(from.segments.length));
}

/**
 * Derive a mapping from one manual relink: strip the longest common trailing
 * run of segments from both paths, and map what's left. If even the file name
 * differs, map the containing folders.
 *
 *   C:\Users\me\Music\Splatoon\a.flac  +  /home/me/Music/Splatoon/a.flac
 *   -> { from: 'C:\Users', to: '/home' }
 */
export function learnMapping(oldAbsPath, newPath) {
  const oldParts = splitPath(oldAbsPath);
  const newParts = splitPath(newPath);
  const max = Math.min(oldParts.segments.length, newParts.segments.length) - 1;
  let common = 0;
  while (
    common < max &&
    same(oldParts.segments.at(-1 - common), newParts.segments.at(-1 - common))
  ) {
    common++;
  }
  const keep = Math.max(common, 1);
  const fromSegments = oldParts.segments.slice(0, oldParts.segments.length - keep);
  const toSegments = newParts.segments.slice(0, newParts.segments.length - keep);

  const windowsStyle = oldAbsPath.includes('\\') || /^[a-zA-Z]:/.test(oldAbsPath);
  const from = windowsStyle
    ? `${oldParts.root}\\${fromSegments.join('\\')}`
    : `${oldParts.root}/${fromSegments.join('/')}`;
  const to = path.join(path.parse(newPath).root, ...toSegments);
  return { from, to };
}

async function isFile(candidate) {
  if (!isAudioFile(candidate)) return false;
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/**
 * Find `candidate` ignoring case, one segment at a time. Only reached after an
 * exact lookup fails, and only matters on case-sensitive filesystems.
 */
async function findIgnoringCase(candidate, listings) {
  const { root } = path.parse(candidate);
  const segments = candidate.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    if (!listings.has(current)) {
      listings.set(current, await readdir(current).catch(() => []));
    }
    const match = listings.get(current).find((name) => same(name, segment));
    if (!match) return null;
    current = path.join(current, match);
  }
  return (await isFile(current)) ? current : null;
}

/** Steps 1-3 for one track. Returns { path, how } or null. */
async function resolveByPath(track, { bdayDir, mappings }, listings) {
  const candidates = [];
  if (track.relPath && bdayDir) candidates.push(['relative', path.resolve(bdayDir, ...track.relPath.split('/'))]);
  if (track.absPath && path.isAbsolute(track.absPath)) candidates.push(['absolute', track.absPath]);
  for (const mapping of track.absPath ? mappings : []) {
    const mapped = applyMapping(track.absPath, mapping);
    if (mapped) candidates.push(['mapped', mapped]);
  }

  for (const [how, candidate] of candidates) {
    if (await isFile(candidate)) return { path: candidate, how };
  }
  for (const [how, candidate] of candidates) {
    const found = await findIgnoringCase(candidate, listings);
    if (found) return { path: found, how };
  }
  return null;
}

/** Index files under `dirs` by size, for fingerprint candidates. */
async function indexBySize(dirs) {
  const bySize = new Map();
  let count = 0;
  const visited = new Set();

  async function walk(dir) {
    if (count >= SEARCH_FILE_LIMIT || visited.has(dir)) return;
    visited.add(dir);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= SEARCH_FILE_LIMIT) return;
      if (entry.name.startsWith('.')) continue;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && isAudioFile(entry.name)) {
        count++;
        const { size } = await stat(entryPath).catch(() => ({ size: -1 }));
        if (!bySize.has(size)) bySize.set(size, []);
        bySize.get(size).push(entryPath);
      }
    }
  }

  for (const dir of dirs) await walk(dir);
  return bySize;
}

/**
 * Resolve reference tracks. `tracks` are manifest entries
 * ({ relPath, absPath, size, fingerprint }); returns one result per track:
 * { status: 'ok', path, how } or { status: 'missing' }.
 *
 * @param {object} options
 * @param {string|null} options.bdayDir   folder of the .bday (null if unsaved)
 * @param {{from: string, to: string}[]} options.mappings
 * @param {string[]} [options.searchDirs] extra folders for the fingerprint search
 */
export async function resolveTracks(tracks, { bdayDir, mappings, searchDirs = [] }) {
  const listings = new Map();
  const results = await Promise.all(
    tracks.map(async (track) => {
      const hit = await resolveByPath(track, { bdayDir, mappings }, listings);
      return hit ? { status: 'ok', ...hit } : { status: 'missing' };
    })
  );

  const missing = results
    .map((result, i) => [result, tracks[i]])
    .filter(([result, track]) => result.status === 'missing' && track.size && track.fingerprint);
  if (missing.length === 0) return results;

  // Step 4. Known folders: the .bday's own, mapping targets, folders the user
  // pointed at, and the album and artist folders of every track that resolved.
  const known = new Set([bdayDir, ...mappings.map((m) => m.to), ...searchDirs].filter(Boolean));
  for (const result of results) {
    if (result.status !== 'ok') continue;
    const album = path.dirname(result.path);
    known.add(album);
    known.add(path.dirname(album));
  }
  // Drop folders nested inside another known folder; walking the parent covers them.
  const roots = [...known].filter(
    (dir) => ![...known].some((other) => other !== dir && dir.startsWith(other + path.sep))
  );

  const bySize = await indexBySize(roots);
  const claimed = new Set(results.filter((r) => r.status === 'ok').map((r) => r.path));
  for (const [result, track] of missing) {
    for (const candidate of bySize.get(track.size) ?? []) {
      if (claimed.has(candidate)) continue;
      const print = await fingerprint({ path: candidate, size: track.size }).catch(() => null);
      if (print === track.fingerprint) {
        Object.assign(result, { status: 'ok', path: candidate, how: 'fingerprint' });
        claimed.add(candidate);
        break;
      }
    }
  }
  return results;
}
