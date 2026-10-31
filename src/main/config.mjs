import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * App-level settings in userData/config.json: things that belong to this
 * machine, never to a playlist. Folder mappings (PLAN.md §4) live here because
 * "C:\Music is /home/me/Music" is a fact about two computers, not a playlist.
 *
 * Written atomically (temp file + rename) so a crash mid-write can't leave
 * unparseable config.
 */

const RECENT_LIMIT = 10;

const DEFAULTS = {
  folderMappings: [],
  recentFiles: [],
  /** Options ▸ Restore Tabs on Startup */
  restoreTabs: true,
  /** Open tabs at last save: { tabs: [{ filePath, name }], active: index } (PLAN.md §5) */
  session: { tabs: [], active: 0 },
  /** View ▸ Show Art Pane, and its share of the window width (the draggable split) */
  artPane: { visible: true, fraction: 0.55 },
  /** Options ▸ Pause GIFs When Window Is Unfocused */
  pauseGifs: true,
  /** Options ▸ Pause GIFs When Playback Pauses */
  pauseGifsWithPlayback: true,
  /** Options ▸ Show Track Shapes Instead of Art: every track's generated symbol, art or not */
  showShapes: false,
  /** View ▸ Art Pane: 'art' | 'lyrics' | 'over' */
  artPaneMode: 'art',
  /** View ▸ Art Pane ▸ Dim Art Behind Lyrics */
  dimLyricsArt: true,
  /** Options ▸ Fetch Lyrics Automatically: off until asked, since it sends track names to LRCLIB */
  fetchLyrics: false,
  /** View ▸ Now Playing Label: 'artist' | 'album' | 'both' */
  nowPlayingLabel: 'album',
};

let configPath = null;
let config = null;
let writing = Promise.resolve();

export async function loadConfig(userDataDir) {
  configPath = path.join(userDataDir, 'config.json');
  try {
    config = { ...DEFAULTS, ...JSON.parse(await readFile(configPath, 'utf8')) };
  } catch {
    config = { ...DEFAULTS };
  }
  return config;
}

export const getConfig = () => config;

/** Merge `patch` into config and persist it. Writes are serialized. */
export function updateConfig(patch) {
  config = { ...config, ...patch };
  const snapshot = JSON.stringify(config, null, 2);
  writing = writing.then(async () => {
    await mkdir(path.dirname(configPath), { recursive: true });
    const temp = `${configPath}.tmp`;
    await writeFile(temp, snapshot);
    await rename(temp, configPath);
  });
  return writing;
}

export function addRecentFile(filePath) {
  const recentFiles = [filePath, ...config.recentFiles.filter((p) => p !== filePath)].slice(0, RECENT_LIMIT);
  return updateConfig({ recentFiles });
}

export function removeRecentFile(filePath) {
  return updateConfig({ recentFiles: config.recentFiles.filter((p) => p !== filePath) });
}

/** Add or replace a mapping (keyed by `from`, case-insensitively). */
export function addFolderMapping(mapping) {
  const others = config.folderMappings.filter((m) => m.from.toLowerCase() !== mapping.from.toLowerCase());
  return updateConfig({ folderMappings: [...others, mapping] });
}
