import { contextBridge, ipcRenderer } from 'electron';

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

  dialog: {
    openAudioFiles: () => ipcRenderer.invoke('dialog:open-audio-files'),
  },
});
