import { contextBridge, ipcRenderer, webUtils } from 'electron';

/**
 * The only bridge between the renderer and Node. Everything the UI can ask the
 * system to do is listed here explicitly — the renderer gets no ipcRenderer,
 * no require, and no fs. Adding a capability means adding it in three places:
 * a handler in main.mjs, a method here, and a call site in the UI.
 *
 * Subscription helpers return an unsubscribe function so they drop straight
 * into a React useEffect cleanup.
 */
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
    onImportProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on('tracks:import-progress', listener);
      return () => ipcRenderer.removeListener('tracks:import-progress', listener);
    },
  },
});
