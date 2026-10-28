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
    playerState: player.getState(),
    recentFiles: ui.getState().recentFiles,
    busy: Boolean(ui.getState().busy),
  };
}

const idle = (ctx) => !ctx.busy;

export const COMMANDS = {
  // --- File ---
  'file.new': { label: 'New Playlist', shortcut: 'Ctrl+N', enabled: idle, run: actions.newPlaylist },
  'file.open': { label: 'Open Playlist…', shortcut: 'Ctrl+O', enabled: idle, run: () => actions.openPlaylist() },
  'file.save': { label: 'Save', shortcut: 'Ctrl+S', enabled: idle, run: () => actions.saveViewed() },
  'file.saveAs': {
    label: 'Save As…',
    shortcut: 'Ctrl+Shift+S',
    enabled: idle,
    run: () => actions.saveViewed({ saveAs: true }),
  },
  'file.exportBundled': {
    label: 'Export Bundled Copy…',
    enabled: (ctx) => idle(ctx) && ctx.playlist?.doc.tracks.length > 0,
    run: () => actions.saveViewed({ storage: 'bundled', copy: true }),
  },
  'file.addFiles': { label: 'Add Files…', enabled: idle, run: actions.addFiles },
  'file.addFolder': { label: 'Add Folder…', enabled: idle, run: actions.addFolder },
  'file.close': {
    label: 'Close Playlist',
    shortcut: 'Ctrl+W',
    enabled: (ctx) => idle(ctx) && !store.isPristine(ctx.playlist),
    run: actions.closeViewed,
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

  // --- View ---
  'view.zoomIn': { label: 'Zoom In', shortcut: 'Ctrl+=', run: () => window.beachday.view.zoomIn() },
  'view.zoomOut': { label: 'Zoom Out', shortcut: 'Ctrl+-', run: () => window.beachday.view.zoomOut() },
  'view.resetZoom': { label: 'Reset Zoom', shortcut: 'Ctrl+0', run: () => window.beachday.view.resetZoom() },

  // --- Playback ---
  'playback.playPause': {
    label: (ctx) => (ctx.playerState.status === 'playing' ? 'Pause' : 'Play'),
    shortcut: 'Space',
    run: () => {
      // Nothing loaded yet: start the viewed playlist from the top.
      const { playingId, viewedId } = store.getState();
      if (!playingId) store.play(viewedId, 0);
      else player.togglePlay();
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
  'playlist.storage.reference': {
    label: 'Reference',
    checked: (ctx) => ctx.playlist?.storage === 'reference',
    enabled: idle,
    run: () => actions.setStorage('reference'),
  },
  'playlist.storage.bundled': {
    label: 'Bundled',
    checked: (ctx) => ctx.playlist?.storage === 'bundled',
    enabled: idle,
    run: () => actions.setStorage('bundled'),
  },
  'playlist.relink': {
    label: 'Find Missing Tracks / Relink…',
    enabled: (ctx) => ctx.playlist && store.missingCount(ctx.playlist) > 0,
    run: () => ui.openDialog('relink'),
  },

  // --- Options ---
  'options.folderMappings': { label: 'Folder Mappings…', run: () => ui.openDialog('mappings') },

  // --- Help ---
  'help.shortcuts': { label: 'Keyboard Shortcuts', run: () => ui.openDialog('shortcuts') },
  'help.about': { label: 'About Beachday', run: () => ui.openDialog('about') },
};

const fileName = (filePath) => filePath.split(/[\\/]/).pop();

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
      'file.close',
      'file.exit',
    ],
  },
  { label: 'Edit', items: ['edit.undo', 'edit.redo'] },
  { label: 'View', items: ['view.zoomIn', 'view.zoomOut', 'view.resetZoom'] },
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
      { label: 'Storage', items: ['playlist.storage.reference', 'playlist.storage.bundled'] },
      'playlist.relink',
    ],
  },
  // Every Track item acts on the selection, which arrives with Phase 5.
  { label: 'Track', items: [], emptyHint: 'Track editing arrives with selection in Phase 5' },
  { label: 'Options', items: ['options.folderMappings'] },
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
