import { contextBridge, ipcRenderer, webUtils, webFrame } from 'electron';

/**
 * The only bridge between the renderer and Node. Everything the UI can ask the
 * system to do is listed here explicitly — the renderer gets no ipcRenderer,
 * no require, and no fs. Adding a capability means adding it in three places:
 * a handler in main.mjs, a method here, and a call site in the UI.
 *
 * Subscription helpers return an unsubscribe function so they drop straight
 * into a React useEffect cleanup.
 */
/** Listen on a main -> renderer channel; returns the unsubscribe function. */
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('beachday', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChanged: (callback) => {
      const listener = (_event, isMaximized) => callback(isMaximized);
      ipcRenderer.on('window:maximized-changed', listener);
      return () => ipcRenderer.removeListener('window:maximized-changed', listener);
    },
  },

  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info'),
    /** Main asks before the window closes; answer with confirmClose() when it's safe. */
    onCloseRequested: (callback) => subscribe('app:close-requested', callback),
    confirmClose: () => ipcRenderer.invoke('app:confirm-close'),
    openLogs: () => ipcRenderer.invoke('app:open-logs'),
  },

  playlist: {
    open: () => ipcRenderer.invoke('playlist:open'),
    openRecent: (filePath) => ipcRenderer.invoke('playlist:open-recent', filePath),
    recent: () => ipcRenderer.invoke('playlist:recent'),
    save: (request) => ipcRenderer.invoke('playlist:save', request),
    onSaveProgress: (callback) => subscribe('playlist:save-progress', callback),
    resolve: (request) => ipcRenderer.invoke('playlist:resolve', request),
    locate: (request) => ipcRenderer.invoke('playlist:locate', request),
    openSession: (filePath) => ipcRenderer.invoke('playlist:open-session', filePath),
    showInFolder: (url) => ipcRenderer.invoke('track:show-in-folder', url),
  },

  session: {
    get: () => ipcRenderer.invoke('session:get'),
    save: (session) => ipcRenderer.invoke('session:save', session),
    setRestoreTabs: (restore) => ipcRenderer.invoke('config:set-restore-tabs', restore),
  },

  art: {
    /** Pick an image for playlist art. Resolves { ref, url } or null. */
    pick: (title) => ipcRenderer.invoke('art:pick', title),
  },

  lyrics: {
    /** What's stored on this computer for a track, or null. Never touches the network. */
    cached: (query) => ipcRenderer.invoke('lyrics:cached', query),
    /** Ask LRCLIB. */
    fetch: (query) => ipcRenderer.invoke('lyrics:fetch', query),
  },

  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (patch) => ipcRenderer.invoke('prefs:set', patch),
  },

  config: {
    getFolderMappings: () => ipcRenderer.invoke('config:get-mappings'),
    setFolderMappings: (mappings) => ipcRenderer.invoke('config:set-mappings', mappings),
  },

  dialog: {
    pickFolder: (title) => ipcRenderer.invoke('dialog:pick-folder', title),
    /** Resolves 'save' | 'discard' | 'cancel'. */
    confirmUnsaved: (name) => ipcRenderer.invoke('dialog:confirm-unsaved', name),
  },

  view: {
    // Half-steps, matching Chromium's own zoom increments closely enough.
    zoomIn: () => webFrame.setZoomLevel(Math.min(webFrame.getZoomLevel() + 0.5, 4)),
    zoomOut: () => webFrame.setZoomLevel(Math.max(webFrame.getZoomLevel() - 0.5, -3)),
    resetZoom: () => webFrame.setZoomLevel(0),
  },

  tracks: {
    pickFiles: () => ipcRenderer.invoke('tracks:pick-files'),
    pickFolder: () => ipcRenderer.invoke('tracks:pick-folder'),
    /**
     * Takes an array of File objects from a drop event (not the FileList —
     * contextBridge can't pass one). Only real dropped files have paths.
     */
    importDropped: (files) =>
      ipcRenderer.invoke(
        'tracks:import-dropped',
        Array.from(files, (file) => webUtils.getPathForFile(file))
      ),
    onImportProgress: (callback) => subscribe('tracks:import-progress', callback),
  },
});
