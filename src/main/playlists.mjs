import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { readBday, writeBday, bundledName, BdayError, FORMAT_VERSION } from './bday.mjs';
import { resolveTracks, learnMapping } from './relink.mjs';
import { fingerprint } from './fingerprint.mjs';
import { ensureArt, newTrackId } from './metadata.mjs';
import { grantMediaSource, sourceForUrl, repointMediaUrl, artUrl } from './media.mjs';
import { cacheArt, cacheArtFile, artExists, artNameOfRef, playlistArtRef, resolveArtPath } from './art.mjs';
import { getConfig, addRecentFile, removeRecentFile, addFolderMapping, updateConfig } from './config.mjs';
import { AUDIO_EXTENSIONS } from './audioFiles.mjs';

/**
 * Playlist files: open, save (both storage modes), convert, relink.
 *
 * The renderer owns the playlist *document* (PLAN.md §5, the store); main owns
 * every byte on disk. On save the renderer sends the document plus each
 * track's playback URL, and main maps URLs back to real sources — so the
 * renderer never supplies a path main will read audio from.
 *
 * Playback URLs stay stable across saves. When a save moves audio (into a
 * bundle, out of one, or to new offsets in a re-saved bundle), the existing
 * URL is repointed, so a track that's playing keeps playing and can still seek.
 */

const BDAY_FILTERS = [{ name: 'Beachday Playlist', extensions: ['bday'] }];
const IMAGE_FILTERS = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }];

// .bday paths the user has chosen through a dialog or Open Recent. Save
// writes only to these, never to a path the renderer names on its own.
const knownPlaylistPaths = new Set();

const windowOf = (event) => BrowserWindow.fromWebContents(event.sender);

async function showError(event, message, detail) {
  await dialog.showMessageBox(windowOf(event), { type: 'error', message, detail });
}

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

/** Turn a manifest into a document, filling anything an older or hand-made file lacks. */
function documentFromManifest(manifest, filePath) {
  const seen = new Set();
  const tracks = (Array.isArray(manifest.tracks) ? manifest.tracks : []).map((track) => {
    const id = typeof track.id === 'string' && !seen.has(track.id) ? track.id : newTrackId();
    seen.add(id);
    return {
      id,
      absPath: track.absPath ?? null,
      relPath: track.relPath ?? null,
      size: track.size ?? null,
      fingerprint: track.fingerprint ?? null,
      tags: track.tags ?? { title: path.parse(track.relPath ?? track.absPath ?? 'Untitled').name },
      overrides: track.overrides ?? {},
      groupId: track.groupId ?? null,
      linkNext: track.linkNext ?? null,
    };
  });
  return {
    meta: {
      name: manifest.meta?.name ?? '',
      description: manifest.meta?.description ?? '',
      author: manifest.meta?.author ?? '',
      cover: manifest.meta?.cover ?? null,
    },
    palette: manifest.palette ?? null,
    grouping: manifest.grouping ?? null,
    groups: Array.isArray(manifest.groups) ? manifest.groups.filter((group) => group && typeof group === 'object') : [],
    tracks,
  };
}

/**
 * Rewrite every playlist art reference in `doc` (cover, group art, custom
 * track art) to point into this machine's art cache, unpacking each from the
 * .bday's art/ entries on the way. A reference whose image is missing or
 * unusable is dropped, so the art chain falls through to the next step.
 */
async function unpackArt(doc, art) {
  const unpacked = new Map();
  const unpack = (ref) => {
    if (!ref) return null;
    if (!unpacked.has(ref)) {
      unpacked.set(ref, (async () => {
        const data = art.get(ref);
        let name = null;
        if (data) name = await cacheArt({ data }).catch(() => null);
        else if (await artExists(artNameOfRef(ref))) name = artNameOfRef(ref);
        return name && playlistArtRef(name);
      })());
    }
    return unpacked.get(ref);
  };
  const tracks = await Promise.all(
    doc.tracks.map(async (track) => {
      if (!track.overrides.art) return track;
      const { art: _, ...overrides } = track.overrides;
      const ref = await unpack(track.overrides.art);
      return { ...track, overrides: ref ? { ...overrides, art: ref } : overrides };
    })
  );
  const groups = await Promise.all(doc.groups.map(async (group) => (group.art ? { ...group, art: await unpack(group.art) } : group)));
  return { ...doc, meta: { ...doc.meta, cover: await unpack(doc.meta.cover) }, groups, tracks };
}

/** Resolve reference tracks and build session resolution entries for them. */
async function resolveReferences(tracks, bdayPath, searchDirs = []) {
  const results = await resolveTracks(tracks, {
    bdayDir: bdayPath ? path.dirname(bdayPath) : null,
    mappings: getConfig().folderMappings,
    searchDirs,
  });
  const resolution = {};
  await Promise.all(
    tracks.map(async (track, i) => {
      const result = results[i];
      if (result.status !== 'ok') {
        resolution[track.id] = { status: 'missing', url: null, artUrl: await ensureArt(track.tags?.artName, null) };
        return;
      }
      const { size } = await stat(result.path);
      const source = { path: result.path, size };
      resolution[track.id] = {
        status: 'ok',
        how: result.how,
        url: grantMediaSource(source),
        artUrl: await ensureArt(track.tags?.artName, source),
      };
    })
  );
  return resolution;
}

async function openPlaylist(filePath) {
  const { manifest, entries, art } = await readBday(filePath);
  const doc = await unpackArt(documentFromManifest(manifest, filePath), art);

  const resolution = {};
  const references = [];
  for (const track of doc.tracks) {
    const entry = manifest.bundled && track.relPath ? entries.get(track.relPath) : undefined;
    if (!entry) {
      references.push(track);
      continue;
    }
    const source = { path: filePath, offset: entry.offset, size: entry.size, name: track.relPath };
    resolution[track.id] = {
      status: 'ok',
      how: 'bundled',
      url: grantMediaSource(source),
      artUrl: await ensureArt(track.tags?.artName, source),
    };
  }
  Object.assign(resolution, await resolveReferences(references, filePath));

  knownPlaylistPaths.add(filePath);
  await addRecentFile(filePath);
  return { filePath, storage: manifest.bundled ? 'bundled' : 'reference', doc, resolution };
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

const toPosix = (p) => p.split(path.sep).join('/');

/** relPath from the .bday's folder, or null across Windows drives. */
function relativePath(bdayPath, audioPath) {
  const relative = path.relative(path.dirname(bdayPath), audioPath);
  return path.isAbsolute(relative) ? null : toPosix(relative);
}

/** Copy a source (possibly a bundled entry) to a loose file in `dir`. */
async function extractTo(dir, source, taken) {
  const { name, ext } = path.parse(path.basename(source.name ?? source.path));
  let target = path.join(dir, `${name}${ext}`);
  for (let n = 2; taken.has(target.toLowerCase()) || fs.existsSync(target); n++) {
    target = path.join(dir, `${name} (${n})${ext}`);
  }
  taken.add(target.toLowerCase());
  const offset = source.offset ?? 0;
  await pipeline(
    fs.createReadStream(source.path, { start: offset, end: offset + source.size - 1 }),
    fs.createWriteStream(target, { flags: 'wx' })
  );
  return { path: target, size: source.size };
}

/**
 * Write `doc` to `targetPath` as `storage` ('reference' | 'bundled').
 *
 * @param {object} options
 * @param {Record<string, string>} options.urls  trackId -> playback URL (resolved tracks)
 * @param {boolean} options.copy  Export Bundled Copy: write elsewhere, leave this session alone
 * @param {string|null} options.extractDir  bundled -> reference: where the audio goes
 */
async function savePlaylist(targetPath, doc, storage, { urls, copy, extractDir, onProgress }) {
  const sources = new Map();
  for (const track of doc.tracks) {
    const source = sourceForUrl(urls[track.id]);
    if (source) sources.set(track.id, source);
  }

  // Bundled -> reference: audio living inside a .bday has to land somewhere first.
  const extracted = new Map();
  if (storage === 'reference') {
    const taken = new Set();
    for (const [id, source] of sources) {
      if (source.offset == null) continue;
      if (!extractDir) throw new Error('Bundled audio needs a folder to be extracted to');
      await mkdir(extractDir, { recursive: true });
      extracted.set(id, await extractTo(extractDir, source, taken));
    }
  }

  // Playlist art travels inside the file. Only valid references to images in
  // the cache are written; anything else is dropped from the manifest.
  const art = new Map();
  const keepArt = (ref) => {
    const name = artNameOfRef(ref);
    const artPath = name && resolveArtPath(name);
    if (!artPath || !fs.existsSync(artPath)) return null;
    art.set(ref, artPath);
    return ref;
  };

  const taken = new Set();
  const audio = [];
  let unbundled = 0;
  const tracks = await Promise.all(
    doc.tracks.map(async (track) => {
      const source = extracted.get(track.id) ?? sources.get(track.id);
      const stored = {
        id: track.id,
        absPath: track.absPath,
        relPath: track.relPath,
        size: track.size,
        fingerprint: track.fingerprint,
        tags: track.tags,
        overrides: track.overrides,
        groupId: track.groupId,
        linkNext: track.linkNext,
      };
      if (track.overrides.art && !keepArt(track.overrides.art)) {
        const { art: _, ...overrides } = track.overrides;
        stored.overrides = overrides;
      }
      // Missing audio: keep what we knew, so it can still be relinked later.
      if (!source) {
        if (storage === 'bundled') unbundled++;
        return stored;
      }

      const loose = source.offset == null;
      if (loose) stored.absPath = source.path;
      const size = source.size ?? (await stat(source.path)).size;
      if (size !== track.size || !track.fingerprint) {
        // Retagged or newly found: refresh what relinking matches on.
        stored.size = size;
        stored.fingerprint = await fingerprint({ ...source, size }).catch(() => track.fingerprint);
      }

      if (storage === 'bundled') {
        audio.push({ id: track.id, source: { ...source, size } });
      } else {
        stored.relPath = relativePath(targetPath, source.path);
      }
      return stored;
    })
  );

  // Name bundle entries in playlist order (not async completion order), so
  // duplicate file names get the same "(2)" suffix on every save.
  const order = new Map(doc.tracks.map((track, i) => [track.id, i]));
  audio.sort((a, b) => order.get(a.id) - order.get(b.id));
  for (const item of audio) {
    item.name = bundledName(path.basename(item.source.name ?? item.source.path), taken);
    tracks[order.get(item.id)].relPath = item.name;
  }

  const manifest = {
    formatVersion: FORMAT_VERSION,
    bundled: storage === 'bundled',
    meta: { ...doc.meta, cover: keepArt(doc.meta.cover) },
    palette: doc.palette,
    grouping: doc.grouping,
    groups: doc.groups.map((group) => (group.art ? { ...group, art: keepArt(group.art) } : group)),
    tracks,
  };
  await writeBday(targetPath, manifest, audio, onProgress, [...art].map(([name, artPath]) => ({ name, path: artPath })));

  if (!copy) {
    // Keep playback URLs pointing at wherever the audio now lives.
    for (const [id, file] of extracted) repointMediaUrl(urls[id], file);
    if (storage === 'bundled') {
      const { entries } = await readBday(targetPath);
      for (const { id, name } of audio) {
        const entry = entries.get(name);
        repointMediaUrl(urls[id], { path: targetPath, offset: entry.offset, size: entry.size, name });
      }
    }
  }

  knownPlaylistPaths.add(targetPath);
  await addRecentFile(targetPath);
  return {
    filePath: targetPath,
    unbundled,
    // What the document should now say about each track's location.
    stored: Object.fromEntries(
      tracks.map(({ id, absPath, relPath, size, fingerprint: print }) => [
        id,
        { absPath, relPath, size, fingerprint: print },
      ])
    ),
  };
}

async function askSavePath(event, { title, defaultName }) {
  const result = await dialog.showSaveDialog(windowOf(event), {
    title,
    defaultPath: `${(defaultName || 'Untitled').replace(/[\\/:*?"<>|]/g, '_')}.bday`,
    filters: BDAY_FILTERS,
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath.toLowerCase().endsWith('.bday') ? result.filePath : `${result.filePath}.bday`;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

export function registerPlaylistIpc() {
  ipcMain.handle('playlist:open', async (event) => {
    const result = await dialog.showOpenDialog(windowOf(event), {
      title: 'Open playlist',
      properties: ['openFile'],
      filters: BDAY_FILTERS,
    });
    if (result.canceled) return null;
    return openOrReport(event, result.filePaths[0]);
  });

  ipcMain.handle('playlist:open-recent', async (event, filePath) => {
    if (!getConfig().recentFiles.includes(filePath)) return null;
    if (!fs.existsSync(filePath)) {
      await removeRecentFile(filePath);
      await showError(event, 'That playlist is no longer there.', filePath);
      return null;
    }
    return openOrReport(event, filePath);
  });

  ipcMain.handle('playlist:recent', () => getConfig().recentFiles);

  // --- Session tabs (PLAN.md §5) ---

  ipcMain.handle('session:get', () => {
    const { restoreTabs, session } = getConfig();
    return { restoreTabs, tabs: restoreTabs ? session.tabs : [], active: session.active };
  });

  /** The renderer reports open saved tabs whenever they change. */
  ipcMain.handle('session:save', (_event, session) => {
    if (!Array.isArray(session?.tabs)) return;
    const tabs = session.tabs
      .filter((tab) => typeof tab?.filePath === 'string' && tab.filePath.toLowerCase().endsWith('.bday'))
      .map((tab) => ({ filePath: tab.filePath, name: String(tab.name ?? '') }));
    const active = Number.isInteger(session.active) ? session.active : 0;
    return updateConfig({ session: { tabs, active } });
  });

  ipcMain.handle('config:set-restore-tabs', (_event, restoreTabs) => updateConfig({ restoreTabs: Boolean(restoreTabs) }));

  /**
   * Load a restored tab. Allowed only for paths in the saved session or
   * recent files. Resolves { missing: true } when the file has gone, without
   * an error dialog: the tab itself shows that.
   */
  ipcMain.handle('playlist:open-session', async (event, filePath) => {
    const { session, recentFiles } = getConfig();
    if (!session.tabs.some((tab) => tab.filePath === filePath) && !recentFiles.includes(filePath)) return null;
    if (!fs.existsSync(filePath)) return { missing: true };
    return openOrReport(event, filePath);
  });

  /** Track ▸ Show in File Manager. Bundled audio shows its .bday. */
  ipcMain.handle('track:show-in-folder', (_event, url) => {
    const source = sourceForUrl(url);
    if (source) shell.showItemInFolder(source.path);
  });

  /**
   * request: { filePath, saveAs, copy, storage, doc, urls, name }
   * Returns { filePath, unbundled, stored } or null if cancelled.
   */
  ipcMain.handle('playlist:save', async (event, request) => {
    const { storage, doc, urls, copy = false } = request;
    let targetPath = request.saveAs || copy ? null : request.filePath;
    if (targetPath && !knownPlaylistPaths.has(targetPath)) targetPath = null;
    targetPath ??= await askSavePath(event, {
      title: copy ? 'Export bundled copy' : 'Save playlist',
      defaultName: copy ? `${doc.meta.name} (bundled)` : doc.meta.name,
    });
    if (!targetPath) return null;

    let extractDir = null;
    const hasBundledAudio = Object.values(urls).some((url) => sourceForUrl(url)?.offset != null);
    if (storage === 'reference' && hasBundledAudio) {
      const pick = await dialog.showOpenDialog(windowOf(event), {
        title: 'Choose a folder for the bundled audio',
        buttonLabel: 'Extract here',
        defaultPath: path.dirname(targetPath),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (pick.canceled) return null;
      extractDir = path.join(pick.filePaths[0], `${path.parse(targetPath).name} audio`);
    }

    try {
      return await savePlaylist(targetPath, doc, storage, {
        urls,
        copy,
        extractDir,
        onProgress: (written, total) => {
          if (!event.sender.isDestroyed()) event.sender.send('playlist:save-progress', { written, total });
        },
      });
    } catch (error) {
      await showError(event, "Couldn't save the playlist.", error.message);
      return null;
    }
  });

  /** Re-run relinking for missing tracks, optionally searching a chosen folder. */
  ipcMain.handle('playlist:resolve', async (event, { filePath, tracks, searchFolder = false }) => {
    let searchDirs = [];
    if (searchFolder) {
      const pick = await dialog.showOpenDialog(windowOf(event), {
        title: 'Search a folder for missing tracks',
        properties: ['openDirectory'],
      });
      if (pick.canceled) return null;
      searchDirs = pick.filePaths;
    }
    return resolveReferences(tracks, knownPlaylistPaths.has(filePath) ? filePath : null, searchDirs);
  });

  /**
   * Manually locate one missing track. The choice teaches a folder mapping, so
   * the renderer follows up with playlist:resolve for the rest.
   */
  ipcMain.handle('playlist:locate', async (event, { filePath, track }) => {
    const pick = await dialog.showOpenDialog(windowOf(event), {
      title: `Locate "${track.tags?.title ?? 'track'}"`,
      defaultPath: filePath && knownPlaylistPaths.has(filePath) ? path.dirname(filePath) : undefined,
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
    });
    if (pick.canceled) return null;

    const chosen = pick.filePaths[0];
    if (track.absPath) await addFolderMapping(learnMapping(track.absPath, chosen));
    const { size } = await stat(chosen);
    const source = { path: chosen, size };
    return {
      status: 'ok',
      how: 'located',
      url: grantMediaSource(source),
      artUrl: await ensureArt(track.tags?.artName, source),
    };
  });

  /**
   * Choose an image for playlist art (Track ▸ Set Custom Art). It goes through
   * the art cache, and so through the GIF guardrail. Resolves { ref, url },
   * or null if cancelled or unusable (after saying why).
   */
  ipcMain.handle('art:pick', async (event, title = 'Choose an image') => {
    const pick = await dialog.showOpenDialog(windowOf(event), { title, properties: ['openFile'], filters: IMAGE_FILTERS });
    if (pick.canceled) return null;
    const name = await cacheArtFile(pick.filePaths[0]).catch(() => null);
    if (!name) {
      await showError(event, "Couldn't use that image.", 'Beachday shows JPEG, PNG, GIF, WebP and BMP images up to 64MB.');
      return null;
    }
    return { ref: playlistArtRef(name), url: artUrl(name) };
  });

  ipcMain.handle('config:get-mappings', () => getConfig().folderMappings);

  ipcMain.handle('config:set-mappings', (_event, mappings) => {
    if (!Array.isArray(mappings)) return getConfig().folderMappings;
    const clean = mappings
      .filter((m) => typeof m?.from === 'string' && typeof m?.to === 'string' && m.from.trim() && m.to.trim())
      .map((m) => ({ from: m.from.trim(), to: m.to.trim() }));
    return updateConfig({ folderMappings: clean }).then(() => clean);
  });

  ipcMain.handle('dialog:pick-folder', async (event, title) => {
    const pick = await dialog.showOpenDialog(windowOf(event), { title, properties: ['openDirectory'] });
    return pick.canceled ? null : pick.filePaths[0];
  });

  /** Native Save / Don't Save / Cancel. Resolves 'save' | 'discard' | 'cancel'. */
  ipcMain.handle('dialog:confirm-unsaved', async (event, name) => {
    const { response } = await dialog.showMessageBox(windowOf(event), {
      type: 'question',
      message: `Save changes to "${name}"?`,
      detail: "Your changes will be lost if you don't save them.",
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    return ['save', 'discard', 'cancel'][response];
  });
}

async function openOrReport(event, filePath) {
  try {
    return await openPlaylist(filePath);
  } catch (error) {
    const reason = error instanceof BdayError ? error.message : `Couldn't read it (${error.message}).`;
    await showError(event, `Couldn't open "${path.basename(filePath)}".`, reason);
    return null;
  }
}
