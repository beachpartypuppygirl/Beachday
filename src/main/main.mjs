import { app, BrowserWindow, ipcMain, dialog, shell, Menu, net } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerMediaScheme, handleMediaProtocol } from './media.mjs';
import { AUDIO_EXTENSIONS, collectAudioFiles, importTracks } from './metadata.mjs';
import { registerPlaylistIpc } from './playlists.mjs';
import { loadConfig, getConfig, updateConfig } from './config.mjs';
import { createLyrics } from './lyrics.mjs';
import { log, startLog } from './log.mjs';

// ESM has no __dirname; derive it from import.meta.url.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEV_SERVER_URL = 'http://localhost:5173';

// Unpackaged means `npm run dev`, so load from the Vite dev server.
// BEACHDAY_LOAD_DIST=1 forces the built bundle while still unpackaged,
// which is how we smoke-test a production build without packaging it.
const useDevServer = !app.isPackaged && process.env.BEACHDAY_LOAD_DIST !== '1';

/** @type {BrowserWindow | null} */
let mainWindow = null;

// Closing asks the renderer first, which prompts for unsaved playlists and then
// confirms (app:confirm-close). This flag lets that confirmed close through.
let closeConfirmed = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 940,
    minHeight: 560,
    // Frameless: Beachday draws its own title bar (see TitleBar.jsx).
    frame: false,
    // Matches --bg so there is no white flash before React paints.
    backgroundColor: '#14110f',
    // Windows takes this from the .exe; Linux needs telling.
    icon: path.join(__dirname, '../../build/icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload scripts require sandbox: false. The renderer stays
      // isolated and has no Node access; all disk work happens here in main.
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.on('render-process-gone', (_event, details) => log(`renderer gone: ${details.reason}`));
  mainWindow.webContents.on('console-message', ({ level, message }) => {
    if (level === 'error') log(`renderer: ${message}`);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (event) => {
    const { webContents } = mainWindow;
    // A crashed or never-loaded renderer can't answer; don't trap the user.
    if (closeConfirmed || webContents.isCrashed() || webContents.isLoading()) return;
    event.preventDefault();
    webContents.send('app:close-requested');
  });

  // With the application menu removed (see lifecycle), restore the one
  // developer shortcut worth having.
  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  // Keep the renderer's maximize/restore button in sync when the window
  // is resized by the OS (double-click titlebar, tiling, keyboard shortcut).
  const notifyMaximized = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', notifyMaximized);
  mainWindow.on('unmaximize', notifyMaximized);

  // Security hygiene: this app never navigates away from its own document,
  // and never opens child windows. Route real links to the system browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (useDevServer) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }
}

// ---------------------------------------------------------------------------
// IPC
//
// Every channel is invoke/handle (request -> response). The renderer has no
// filesystem access of its own; main is the only process that touches disk.
// ---------------------------------------------------------------------------

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle('window:toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('window:is-maximized', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});

ipcMain.handle('app:get-info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  packaged: app.isPackaged,
}));

// Import. Each handler resolves to { track, resolution } items (metadata.mjs),
// already ordered and with playable URLs granted. Progress goes out as
// 'tracks:import-progress' events, so a large folder doesn't look frozen.

async function importPaths(event, paths) {
  const files = await collectAudioFiles(paths);
  return importTracks(files, (done, total) => {
    if (!event.sender.isDestroyed()) event.sender.send('tracks:import-progress', { done, total });
  });
}

ipcMain.handle('tracks:pick-files', async (event) => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Add files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio', extensions: AUDIO_EXTENSIONS },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? [] : importPaths(event, result.filePaths);
});

ipcMain.handle('tracks:pick-folder', async (event) => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Add folder',
    properties: ['openDirectory', 'multiSelections'],
  });
  return result.canceled ? [] : importPaths(event, result.filePaths);
});

// Paths come from files the user dropped on the window. The preload resolves
// them from File objects (webUtils.getPathForFile), which page code can't
// forge, so this still only reaches files the user chose.
ipcMain.handle('tracks:import-dropped', (event, paths) => {
  if (!Array.isArray(paths)) return [];
  return importPaths(event, paths.filter((entry) => typeof entry === 'string' && entry));
});

// View preferences: app-level, never stored in a playlist.
ipcMain.handle('prefs:get', () => {
  const { artPane, pauseGifs, pauseGifsWithPlayback, showShapes, artPaneMode, dimLyricsArt, fetchLyrics } = getConfig();
  return { artPane, pauseGifs, pauseGifsWithPlayback, showShapes, artPaneMode, dimLyricsArt, fetchLyrics };
});

ipcMain.handle('prefs:set', (_event, patch) => {
  const clean = {};
  for (const key of ['pauseGifs', 'pauseGifsWithPlayback', 'showShapes', 'dimLyricsArt', 'fetchLyrics']) {
    if (typeof patch?.[key] === 'boolean') clean[key] = patch[key];
  }
  if (['art', 'lyrics', 'over'].includes(patch?.artPaneMode)) clean.artPaneMode = patch.artPaneMode;
  if (patch?.artPane) {
    const { visible, fraction } = { ...getConfig().artPane, ...patch.artPane };
    clean.artPane = {
      visible: Boolean(visible),
      fraction: Number.isFinite(fraction) ? Math.min(0.9, Math.max(0.1, fraction)) : 0.55,
    };
  }
  return updateConfig(clean);
});

// Lyrics live in main with every other network and disk concern; see lyrics.mjs.
let lyrics = null;
ipcMain.handle('lyrics:cached', (_event, query) => lyrics.cached(query));
ipcMain.handle('lyrics:fetch', (_event, query) => lyrics.fetch(query));

const logsDir = () => path.join(app.getPath('userData'), 'logs');
ipcMain.handle('app:open-logs', () => shell.openPath(logsDir()));

ipcMain.handle('app:confirm-close', () => {
  closeConfirmed = true;
  mainWindow?.close();
});

registerPlaylistIpc();

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

registerMediaScheme();

// Watches, and leaves Electron's own handling of the crash as it was.
process.on('uncaughtExceptionMonitor', (error) => log(`uncaught: ${error.stack ?? error}`));

// Only one Beachday at a time; a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // No native menu: Beachday draws its own (MENUS.md). Electron's default
    // menu would also claim Ctrl+W and Ctrl+Q, which ours use.
    Menu.setApplicationMenu(null);
    await startLog(logsDir());
    log(`Beachday ${app.getVersion()} on ${process.platform}/${process.arch}`);
    await loadConfig(app.getPath('userData'));
    lyrics = createLyrics({
      cacheDir: path.join(app.getPath('userData'), 'lyrics-cache'),
      // net.fetch, unlike Node's, follows the system's proxy settings.
      fetch: (url, options) => net.fetch(url, options),
      api: process.env.BEACHDAY_LRCLIB_URL,
      userAgent: `Beachday v${app.getVersion()}`,
      log,
    });
    handleMediaProtocol();
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
