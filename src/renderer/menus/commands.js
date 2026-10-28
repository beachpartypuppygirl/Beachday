import { player } from '../audio/engine.js';
import * as store from '../store/playlists.js';
import * as ui from '../store/ui.js';
import * as actions from '../store/actions.js';

/**
 * Every menu item and keyboard shortcut, from one table (MENUS.md
 * "Implementation notes"). The menu bar, the global shortcut handler and the
 * Keyboard Shortcuts dialog all read from here, so moving an item between
 * menus is a one-line change in MENUS below.
 *
 * Items whose phase hasn't landed are left out entirely — hidden, not
 * disabled — so the menus never advertise features that don't exist yet.
 *
 * Command fields (functions take the context from getContext()):
 *   label      string | (ctx) => string
 *   shortcut   e.g. 'Ctrl+Shift+S'; `aliases` for extra bindings
 *   enabled    (ctx) => boolean, default true
 *   checked    (ctx) => boolean, for toggles and radio items
 *   run        (ctx) => void
 */

const VOLUME_STEP = 0.05;

/** Everything a command needs to decide its label, state and action. */
export function getContext() {
  const { playlists, viewedId } = store.getState();
  const playlist = playlists[viewedId];
  return {
    playlist,
    selected: playlist?.loaded ? store.selectedIds(playlist) : [],
    tabCount: store.getState().order.length,
    playerState: player.getState(),
    recentFiles: ui.getState().recentFiles,
    restoreTabs: ui.getState().restoreTabs,
    busy: Boolean(ui.getState().busy),
  };
}

const idle = (ctx) => !ctx.busy;
/** Idle, and the viewed tab is loaded (a restored tab may not be yet). */
const ready = (ctx) => idle(ctx) && Boolean(ctx.playlist?.loaded);
const hasSelection = (ctx) => ready(ctx) && ctx.selected.length > 0;
/** Exactly one selected track, and it isn't missing. */
const oneFound = (ctx) =>
  ready(ctx) && ctx.selected.length === 1 && ctx.playlist.resolution[ctx.selected[0]]?.status === 'ok';
const grouped = (ctx) => ready(ctx) && Boolean(ctx.playlist.doc.grouping);

export const COMMANDS = {
  // --- File ---
  'file.new': { label: 'New Playlist', shortcut: 'Ctrl+N', enabled: idle, run: actions.newPlaylist },
  'file.open': { label: 'Open Playlist…', shortcut: 'Ctrl+O', enabled: idle, run: () => actions.openPlaylist() },
  'file.save': { label: 'Save', shortcut: 'Ctrl+S', enabled: ready, run: () => actions.saveViewed() },
  'file.saveAs': {
    label: 'Save As…',
    shortcut: 'Ctrl+Shift+S',
    enabled: ready,
    run: () => actions.saveViewed({ saveAs: true }),
  },
  'file.exportBundled': {
    label: 'Export Bundled Copy…',
    enabled: (ctx) => ready(ctx) && ctx.playlist.doc.tracks.length > 0,
    run: () => actions.saveViewed({ storage: 'bundled', copy: true }),
  },
  'file.addFiles': { label: 'Add Files…', enabled: ready, run: actions.addFiles },
  'file.addFolder': { label: 'Add Folder…', enabled: ready, run: actions.addFolder },
  'file.closeTab': {
    label: 'Close Tab',
    shortcut: 'Ctrl+W',
    enabled: (ctx) => idle(ctx) && !(ctx.tabCount === 1 && store.isPristine(ctx.playlist)),
    run: actions.closeViewed,
  },
  'file.nextTab': {
    label: 'Next Tab',
    shortcut: 'Ctrl+Tab',
    enabled: (ctx) => ctx.tabCount > 1,
    run: () => store.viewAdjacent(1),
  },
  'file.previousTab': {
    label: 'Previous Tab',
    shortcut: 'Ctrl+Shift+Tab',
    enabled: (ctx) => ctx.tabCount > 1,
    run: () => store.viewAdjacent(-1),
  },
  // Goes through the window's close request, so unsaved changes are asked about.
  'file.exit': { label: 'Exit', run: () => window.beachday.window.close() },

  // --- Edit ---
  'edit.undo': {
    label: (ctx) => (ctx.playlist?.past.length ? `Undo ${ctx.playlist.past.at(-1).label}` : 'Undo'),
    shortcut: 'Ctrl+Z',
    enabled: (ctx) => idle(ctx) && ctx.playlist?.past.length > 0,
    run: actions.undo,
  },
  'edit.redo': {
    label: (ctx) => (ctx.playlist?.future.length ? `Redo ${ctx.playlist.future[0].label}` : 'Redo'),
    shortcut: 'Ctrl+Y',
    aliases: ['Ctrl+Shift+Z'],
    enabled: (ctx) => idle(ctx) && ctx.playlist?.future.length > 0,
    run: actions.redo,
  },
  'edit.cut': { label: 'Cut', shortcut: 'Ctrl+X', enabled: hasSelection, run: actions.cutSelection },
  'edit.copy': { label: 'Copy', shortcut: 'Ctrl+C', enabled: hasSelection, run: actions.copySelection },
  'edit.paste': {
    label: 'Paste',
    shortcut: 'Ctrl+V',
    enabled: (ctx) => ready(ctx) && actions.hasClipboard(),
    run: actions.paste,
  },
  'edit.selectAll': {
    label: 'Select All',
    shortcut: 'Ctrl+A',
    enabled: (ctx) => ready(ctx) && ctx.playlist.doc.tracks.length > 0,
    run: (ctx) => store.selectAll(ctx.playlist.id),
  },
  'edit.remove': {
    label: 'Remove from Playlist',
    shortcut: 'Delete',
    enabled: hasSelection,
    run: actions.removeSelection,
  },

  // --- View ---
  'view.collapseAll': {
    label: 'Collapse All Groups',
    enabled: grouped,
    run: (ctx) => store.setAllCollapsed(ctx.playlist.id, true),
  },
  'view.expandAll': {
    label: 'Expand All Groups',
    enabled: grouped,
    run: (ctx) => store.setAllCollapsed(ctx.playlist.id, false),
  },
  'view.jumpToNowPlaying': {
    label: 'Jump to Now Playing',
    shortcut: 'Ctrl+J',
    enabled: (ctx) => Boolean(ctx.playerState.current) && store.getState().order.includes(store.getState().playingId),
    run: actions.jumpToNowPlaying,
  },
  'view.zoomIn': { label: 'Zoom In', shortcut: 'Ctrl+=', run: () => window.beachday.view.zoomIn() },
  'view.zoomOut': { label: 'Zoom Out', shortcut: 'Ctrl+-', run: () => window.beachday.view.zoomOut() },
  'view.resetZoom': { label: 'Reset Zoom', shortcut: 'Ctrl+0', run: () => window.beachday.view.resetZoom() },

  // --- Playback ---
  'playback.playPause': {
    label: (ctx) => (ctx.playerState.status === 'playing' ? 'Pause' : 'Play'),
    shortcut: 'Space',
    run: (ctx) => {
      // Nothing loaded yet: start the viewed playlist — from the selection, or the top.
      if (store.getState().playingId || !ctx.playlist?.loaded) return player.togglePlay();
      const first = ctx.selected[0] ?? store.layoutOf(ctx.playlist).order[0];
      if (first) store.play(ctx.playlist.id, first);
    },
  },
  'playback.stop': { label: 'Stop', run: () => player.stop() },
  'playback.previous': { label: 'Previous', run: () => player.previous() },
  'playback.next': { label: 'Next', run: () => player.next() },
  'playback.volumeUp': {
    label: 'Volume Up',
    run: (ctx) => player.setVolume(ctx.playerState.volume + VOLUME_STEP),
  },
  'playback.volumeDown': {
    label: 'Volume Down',
    run: (ctx) => player.setVolume(ctx.playerState.volume - VOLUME_STEP),
  },
  'playback.mute': {
    label: 'Mute',
    checked: (ctx) => ctx.playerState.muted,
    run: () => player.toggleMute(),
  },

  // --- Playlist ---
  'playlist.grouping.off': {
    label: 'Off',
    checked: (ctx) => !ctx.playlist?.doc.grouping,
    enabled: ready,
    run: (ctx) => store.setGrouping(ctx.playlist.id, null),
  },
  'playlist.grouping.album': {
    label: 'By Album',
    checked: (ctx) => ctx.playlist?.doc.grouping?.preset === 'album',
    enabled: ready,
    run: (ctx) => store.setGrouping(ctx.playlist.id, 'album'),
  },
  'playlist.grouping.artist': {
    label: 'By Artist',
    checked: (ctx) => ctx.playlist?.doc.grouping?.preset === 'artist',
    enabled: ready,
    run: (ctx) => store.setGrouping(ctx.playlist.id, 'artist'),
  },
  'playlist.storage.reference': {
    label: 'Reference',
    checked: (ctx) => ctx.playlist?.storage === 'reference',
    enabled: ready,
    run: () => actions.setStorage('reference'),
  },
  'playlist.storage.bundled': {
    label: 'Bundled',
    checked: (ctx) => ctx.playlist?.storage === 'bundled',
    enabled: ready,
    run: () => actions.setStorage('bundled'),
  },
  'playlist.relink': {
    label: 'Find Missing Tracks / Relink…',
    enabled: (ctx) => ready(ctx) && store.missingCount(ctx.playlist) > 0,
    run: () => ui.openDialog('relink'),
  },

  // --- Track (acts on the selection) ---
  'track.showInFolder': {
    label: 'Show in File Manager',
    enabled: oneFound,
    run: actions.showSelectedInFolder,
  },
  'track.properties': {
    label: 'Properties…',
    shortcut: 'Alt+Enter',
    enabled: hasSelection,
    run: () => ui.openDialog('properties'),
  },

  // --- Options ---
  'options.folderMappings': { label: 'Folder Mappings…', run: () => ui.openDialog('mappings') },
  'options.restoreTabs': {
    label: 'Restore Tabs on Startup',
    checked: (ctx) => ctx.restoreTabs,
    run: actions.toggleRestoreTabs,
  },

  // --- Help ---
  'help.shortcuts': { label: 'Keyboard Shortcuts', run: () => ui.openDialog('shortcuts') },
  'help.about': { label: 'About Beachday', run: () => ui.openDialog('about') },
};

const fileName = (filePath) => filePath.split(/[\\/]/).pop();

/** The Track menu, also the track list's right-click menu (MENUS.md). */
export const TRACK_ITEMS = ['track.showInFolder', 'track.properties'];

/** Right-click on a track: the Track menu, plus the clipboard and Remove. */
export const TRACK_CONTEXT_ITEMS = [...TRACK_ITEMS, '-', 'edit.cut', 'edit.copy', 'edit.paste', '-', 'edit.remove'];

/**
 * The bar (order agreed in MENUS.md). Items: a command id, '-' for a
 * separator, or a submenu { label, items } where items may be a function of
 * the context (Open Recent).
 */
export const MENUS = [
  {
    label: 'File',
    items: [
      'file.new',
      'file.open',
      {
        label: 'Open Recent',
        items: (ctx) =>
          ctx.recentFiles.map((filePath) => ({
            label: fileName(filePath),
            title: filePath,
            enabled: idle,
            run: () => actions.openPlaylist(filePath),
          })),
      },
      'file.save',
      'file.saveAs',
      'file.exportBundled',
      '-',
      'file.addFiles',
      'file.addFolder',
      '-',
      'file.closeTab',
      'file.nextTab',
      'file.previousTab',
      '-',
      'file.exit',
    ],
  },
  {
    label: 'Edit',
    items: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', '-', 'edit.selectAll', 'edit.remove'],
  },
  {
    label: 'View',
    items: [
      'view.collapseAll',
      'view.expandAll',
      'view.jumpToNowPlaying',
      '-',
      'view.zoomIn',
      'view.zoomOut',
      'view.resetZoom',
    ],
  },
  {
    label: 'Playback',
    items: [
      'playback.playPause',
      'playback.stop',
      'playback.previous',
      'playback.next',
      '-',
      'playback.volumeUp',
      'playback.volumeDown',
      'playback.mute',
    ],
  },
  {
    label: 'Playlist',
    items: [
      { label: 'Grouping', items: ['playlist.grouping.off', 'playlist.grouping.album', 'playlist.grouping.artist'] },
      '-',
      { label: 'Storage', items: ['playlist.storage.reference', 'playlist.storage.bundled'] },
      'playlist.relink',
    ],
  },
  { label: 'Track', items: TRACK_ITEMS },
  { label: 'Options', items: ['options.folderMappings', 'options.restoreTabs'] },
  { label: 'Help', items: ['help.shortcuts', '-', 'help.about'] },
];

/** Run a command by id, as a menu click would (for buttons outside the menus). */
export function runCommand(id) {
  const ctx = getContext();
  const command = COMMANDS[id];
  if (!command.enabled || command.enabled(ctx)) command.run(ctx);
}

/** Resolve a menu item spec into { label, shortcut, enabled, checked, run, items }. */
export function resolveItem(item, ctx) {
  if (item === '-') return { separator: true };
  const command = typeof item === 'string' ? COMMANDS[item] : item;
  const value = (field, fallback) =>
    typeof command[field] === 'function' && field !== 'run' ? command[field](ctx) : (command[field] ?? fallback);
  const items = typeof command.items === 'function' ? command.items(ctx) : command.items;
  return {
    id: typeof item === 'string' ? item : command.label,
    label: value('label', ''),
    title: command.title,
    shortcut: command.shortcut,
    enabled: items ? items.length > 0 : value('enabled', true),
    checked: command.checked ? command.checked(ctx) : undefined,
    run: command.run,
    items,
  };
}

// --- Keyboard shortcuts ------------------------------------------------------

/** 'Ctrl+Shift+S' for a keydown event. Ctrl and Cmd both count as Ctrl. */
export function shortcutOf(event) {
  let key = event.key;
  if (key === ' ') key = 'Space';
  else if (key === '+') key = '='; // Ctrl+Shift+= and the numpad plus both zoom in
  else if (key.length === 1) key = key.toUpperCase();
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.shiftKey && key !== '=') parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  parts.push(key);
  return parts.join('+');
}

const BINDINGS = new Map(
  Object.entries(COMMANDS).flatMap(([id, command]) =>
    [command.shortcut, ...(command.aliases ?? [])].filter(Boolean).map((shortcut) => [shortcut, id])
  )
);

/**
 * Handle a keydown against the table. Returns true if a command ran.
 * Ignored while typing in a field, and Space is left to a focused control
 * (a focused button already activates on Space).
 */
export function handleShortcut(event) {
  if (event.repeat && !event.key.startsWith('Arrow')) return false;
  if (ui.getState().dialog) return false; // A dialog owns the keyboard while open.
  const target = event.target;
  if (target.closest?.('input, textarea, select, [contenteditable="true"]')) return false;
  const shortcut = shortcutOf(event);
  if (shortcut === 'Space' && target.closest?.('button, [role="slider"], [role="menuitem"]')) return false;

  const id = BINDINGS.get(shortcut);
  if (!id) return false;
  const ctx = getContext();
  const command = COMMANDS[id];
  event.preventDefault();
  if (command.enabled && !command.enabled(ctx)) return true;
  command.run(ctx);
  return true;
}
