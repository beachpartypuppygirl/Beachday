import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerMediaScheme, handleMediaProtocol } from './media.mjs';
import { AUDIO_EXTENSIONS, collectAudioFiles, readTracks } from './metadata.mjs';

// ESM has no __dirname; derive it from import.meta.url.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEV_SERVER_URL = 'http://localhost:5173';

// Unpackaged means `npm run dev`, so load from the Vite dev server.
// BEACHDAY_LOAD_DIST=1 forces the built bundle while still unpackaged,
// which is how we smoke-test a production build without packaging it.
const useDevServer = !app.isPackaged && process.env.BEACHDAY_LOAD_DIST !== '1';

/** @type {BrowserWindow | null} */
let mainWindow = null;

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
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

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

// Import. Each handler resolves to track objects (metadata.mjs), already
// ordered and with playable URLs granted. Progress goes out as
// 'tracks:import-progress' events, so a large folder doesn't look frozen.

async function importPaths(event, paths) {
  const files = await collectAudioFiles(paths);
  return readTracks(files, (done, total) => {
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

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

registerMediaScheme();

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

  app.whenReady().then(() => {
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
