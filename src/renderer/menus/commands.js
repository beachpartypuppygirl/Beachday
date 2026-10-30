import { player } from '../audio/engine.js';
import * as store from '../store/playlists.js';
import * as ui from '../store/ui.js';
import * as actions from '../store/actions.js';
import { seedGainDb, trackGainDb } from '../store/gain.js';

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
  const { playlists, viewedId, playingId } = store.getState();
  const playlist = playlists[viewedId];
  const current = player.getState().current;
  // The playing track, while it's still in its playlist (not removed mid-play).
  const playingTrack = current && playlists[playingId]?.doc.tracks.find((track) => track.id === current.id);
  const selected = playlist?.loaded ? store.selectedIds(playlist) : [];
  return {
    playlist,
    selected,
    selectedGroup: selectedGroup(playlist, selected),
    tabCount: store.getState().order.length,
    playerState: player.getState(),
    recentFiles: ui.getState().recentFiles,
    restoreTabs: ui.getState().restoreTabs,
    artPane: ui.getState().artPane,
    pauseGifs: ui.getState().pauseGifs,
    pauseGifsWithPlayback: ui.getState().pauseGifsWithPlayback,
    showShapes: ui.getState().showShapes,
    nowPlaying: playingTrack ? { playlist: playlists[playingId], track: playingTrack } : null,
    busy: Boolean(ui.getState().busy),
  };
}

/** The group holding the whole selection, in a grouped view (right-clicking a header selects its tracks). */
function selectedGroup(playlist, selected) {
  if (!playlist?.loaded || !playlist.doc.grouping || !selected.length) return null;
  const { groupOf } = store.layoutOf(playlist);
  const group = groupOf.get(selected[0]);
  return selected.every((id) => groupOf.get(id) === group) ? group : null;
}

const idle = (ctx) => !ctx.busy;
/** Idle, and the viewed tab is loaded (a restored tab may not be yet). */
const ready = (ctx) => idle(ctx) && Boolean(ctx.playlist?.loaded);
const hasSelection = (ctx) => ready(ctx) && ctx.selected.length > 0;
/** Exactly one selected track, and it isn't missing. */
const oneFound = (ctx) =>
  ready(ctx) && ctx.selected.length === 1 && ctx.playlist.resolution[ctx.selected[0]]?.status === 'ok';
const grouped = (ctx) => ready(ctx) && Boolean(ctx.playlist.doc.grouping);
/** Whether any selected track is linked to the one before or after it. */
const inChain = (ctx) => {
  const { order, linked } = store.layoutOf(ctx.playlist);
  if (!linked.size) return false;
  const selected = new Set(ctx.selected);
  return order.some((id, i) => linked.has(id) && (selected.has(id) || selected.has(order[i + 1])));
};
const selectedTracks = (ctx) => {
  const ids = new Set(ctx.selected);
  return ctx.playlist.doc.tracks.filter((track) => ids.has(track.id));
};

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
  'view.showArtPane': {
    label: 'Show Art Pane',
    checked: (ctx) => ctx.artPane.visible,
    run: actions.toggleArtPane,
  },
  'view.resetArtPane': {
    label: 'Reset Art Pane Size',
    enabled: (ctx) => ctx.artPane.visible && ctx.artPane.fraction !== ui.DEFAULT_ART_FRACTION,
    run: actions.resetArtPane,
  },
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
      // Nothing loaded yet: start the viewed playlist — from the selection, or
      // the start (the top, or a fresh shuffle).
      if (store.getState().playingId || !ctx.playlist?.loaded) return player.togglePlay();
      if (ctx.playlist.doc.tracks.length) store.play(ctx.playlist.id, ctx.selected[0] ?? null);
    },
  },
  'playback.stop': { label: 'Stop', run: () => player.stop() },
  'playback.previous': { label: 'Previous', run: () => player.previous() },
  'playback.next': { label: 'Next', run: () => player.next() },
  'playback.order.sequential': {
    label: 'Sequential',
    checked: (ctx) => ctx.playerState.order === 'sequential',
    run: () => player.setOrder('sequential'),
  },
  'playback.order.shuffle': {
    label: 'Shuffle',
    checked: (ctx) => ctx.playerState.order === 'shuffle',
    run: () => player.setOrder('shuffle'),
  },
  'playback.repeat.off': { label: 'Off', checked: (ctx) => ctx.playerState.repeat === 'off', run: () => player.setRepeat('off') },
  'playback.repeat.all': { label: 'All', checked: (ctx) => ctx.playerState.repeat === 'all', run: () => player.setRepeat('all') },
  'playback.repeat.one': { label: 'One', checked: (ctx) => ctx.playerState.repeat === 'one', run: () => player.setRepeat('one') },
  'playback.reshuffle': {
    label: 'Reshuffle',
    enabled: (ctx) => ctx.playerState.order === 'shuffle' && ctx.playerState.queue.length > 1,
    run: () => player.reshuffle(),
  },
  'playback.stopAfterCurrent': {
    label: 'Stop After Current',
    checked: (ctx) => ctx.playerState.stopAfterCurrent,
    enabled: (ctx) => Boolean(ctx.playerState.current),
    run: (ctx) => player.setStopAfterCurrent(!ctx.playerState.stopAfterCurrent),
  },
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
  'playlist.grouping.manual': {
    label: 'Custom Groups Only',
    checked: (ctx) => ctx.playlist?.doc.grouping?.preset === 'manual',
    enabled: ready,
    run: (ctx) => store.setGrouping(ctx.playlist.id, 'manual'),
  },
  'playlist.grouping.custom': {
    label: 'Custom…',
    checked: (ctx) => ctx.playlist?.doc.grouping?.preset === 'custom',
    enabled: ready,
    run: () => ui.openDialog('grouping'),
  },
  'playlist.properties': { label: 'Properties…', enabled: ready, run: () => ui.openDialog('playlistProperties') },
  'playlist.colors': { label: 'Colors…', enabled: ready, run: () => ui.openDialog('colors') },
  'playlist.editGroups': {
    label: 'Edit Groups…',
    enabled: (ctx) => grouped(ctx) && ctx.playlist.doc.tracks.length > 0,
    run: (ctx) => ui.openDialog('groups', { key: ctx.selectedGroup?.key ?? null }),
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
  'track.rename': {
    label: 'Rename…',
    shortcut: 'F2',
    enabled: (ctx) => ready(ctx) && ctx.selected.length === 1,
    run: (ctx) => {
      store.revealTrack(ctx.playlist.id, ctx.selected[0]);
      ui.requestRename(ctx.playlist.id, ctx.selected[0]);
    },
  },
  'track.gain': {
    label: (ctx) => (ctx.selected.length > 1 ? `Adjust Gain for ${ctx.selected.length} Tracks…` : 'Adjust Gain…'),
    enabled: hasSelection,
    run: (ctx) => ui.openDialog('gain', { playlistId: ctx.playlist.id, ids: ctx.selected }),
  },
  'track.resetGain': {
    label: 'Reset Gain',
    enabled: (ctx) => hasSelection(ctx) && selectedTracks(ctx).some((track) => trackGainDb(track) !== seedGainDb(track)),
    run: (ctx) => store.setTrackGain(ctx.playlist.id, ctx.selected, null),
  },
  'track.link': {
    label: 'Link Selected',
    shortcut: 'Ctrl+L',
    enabled: (ctx) => ready(ctx) && ctx.selected.length > 1,
    run: (ctx) => store.linkTracks(ctx.playlist.id, ctx.selected),
  },
  'track.unlink': {
    label: 'Unlink',
    shortcut: 'Ctrl+Shift+L',
    enabled: (ctx) => hasSelection(ctx) && inChain(ctx),
    run: (ctx) => store.unlinkTracks(ctx.playlist.id, ctx.selected),
  },
  'track.newGroup': {
    label: 'New Group…',
    enabled: hasSelection,
    run: actions.newGroupFromSelection,
  },
  'track.ungroup': {
    label: 'By Tags (Automatic)',
    checked: (ctx) => ctx.selected.length > 0 && selectedTracks(ctx).every((track) => !track.groupId),
    enabled: (ctx) => grouped(ctx) && selectedTracks(ctx).some((track) => track.groupId),
    run: (ctx) => store.moveToGroup(ctx.playlist.id, ctx.selected, null),
  },
  'track.resetOverrides': {
    label: 'Reset All Overrides',
    enabled: (ctx) =>
      hasSelection(ctx) && selectedTracks(ctx).some((track) => Object.keys(track.overrides).length > 0 || track.groupId),
    run: (ctx) => store.resetOverrides(ctx.playlist.id, ctx.selected),
  },
  'track.setArt': {
    label: (ctx) => (ctx.selected.length > 1 ? `Set Custom Art for ${ctx.selected.length} Tracks…` : 'Set Custom Art…'),
    enabled: hasSelection,
    run: (ctx) => actions.setCustomArt(ctx.playlist.id, ctx.selected),
  },
  'track.clearArt': {
    label: 'Clear Custom Art',
    enabled: (ctx) =>
      hasSelection(ctx) &&
      ctx.selected.some((id) => ctx.playlist.doc.tracks.find((track) => track.id === id)?.overrides.art),
    run: (ctx) => actions.clearCustomArt(ctx.playlist.id, ctx.selected),
  },
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

  // --- Art pane (right-click; acts on the playing track) ---
  'art.setNowPlaying': {
    label: 'Set Custom Art…',
    enabled: (ctx) => idle(ctx) && Boolean(ctx.nowPlaying),
    run: (ctx) => actions.setCustomArt(ctx.nowPlaying.playlist.id, [ctx.nowPlaying.track.id]),
  },
  'art.clearNowPlaying': {
    label: 'Clear Custom Art',
    enabled: (ctx) => idle(ctx) && Boolean(ctx.nowPlaying?.track.overrides.art),
    run: (ctx) => actions.clearCustomArt(ctx.nowPlaying.playlist.id, [ctx.nowPlaying.track.id]),
  },

  // --- Group header (right-click; acts on the group whose tracks are selected) ---
  'group.edit': {
    label: 'Edit Group…',
    enabled: (ctx) => ready(ctx) && Boolean(ctx.selectedGroup),
    run: (ctx) => ui.openDialog('groups', { key: ctx.selectedGroup.key }),
  },
  'group.setArt': {
    label: 'Set Group Art…',
    enabled: (ctx) => ready(ctx) && Boolean(ctx.selectedGroup),
    run: (ctx) => actions.setGroupArt(ctx.playlist.id, ctx.selectedGroup.key),
  },
  'group.clearArt': {
    label: 'Clear Group Art',
    enabled: (ctx) =>
      ready(ctx) && Boolean(ctx.selectedGroup) && ctx.playlist.doc.groups.some((g) => g.key === ctx.selectedGroup.key && g.art),
    run: (ctx) => actions.clearGroupArt(ctx.playlist.id, ctx.selectedGroup.key),
  },

  // --- Options ---
  'options.folderMappings': { label: 'Folder Mappings…', run: () => ui.openDialog('mappings') },
  'options.restoreTabs': {
    label: 'Restore Tabs on Startup',
    checked: (ctx) => ctx.restoreTabs,
    run: actions.toggleRestoreTabs,
  },
  'options.pauseGifs': {
    label: 'Pause GIFs When Window Is Unfocused',
    checked: (ctx) => ctx.pauseGifs,
    run: actions.togglePauseGifs,
  },
  'options.pauseGifsWithPlayback': {
    label: 'Pause GIFs When Playback Pauses',
    checked: (ctx) => ctx.pauseGifsWithPlayback,
    run: actions.togglePauseGifsWithPlayback,
  },

  'options.showShapes': {
    label: 'Show Track Shapes Instead of Art',
    checked: (ctx) => ctx.showShapes,
    run: (ctx) => ui.setShowShapes(!ctx.showShapes),
  },

  // --- Help ---
  'help.shortcuts': { label: 'Keyboard Shortcuts', run: () => ui.openDialog('shortcuts') },
  'help.about': { label: 'About Beachday', run: () => ui.openDialog('about') },
};

const fileName = (filePath) => filePath.split(/[\\/]/).pop();

// How many groups Move to Group lists before pointing at Edit Groups instead.
const MOVE_TO_GROUP_LIMIT = 40;

/** Track ▸ Move to Group ▸: every group in display order, then New Group… and unpinning. */
const MOVE_TO_GROUP = {
  label: 'Move to Group',
  items: (ctx) => {
    if (!hasSelection(ctx)) return [];
    // Grouping off: there are no groups yet, but a new one can be made.
    if (!grouped(ctx)) return ['track.newGroup'];
    const { groups } = store.layoutOf(ctx.playlist);
    const listed = groups.slice(0, MOVE_TO_GROUP_LIMIT).map((group) => ({
      label: `${group.mainName}${group.custom ? '' : group.subNames[0] ? ` — ${group.subNames[0]}` : ''}`,
      checked: () => ctx.selectedGroup === group,
      enabled: (inner) => !inner.busy,
      run: () => store.moveToGroup(ctx.playlist.id, ctx.selected, group.key),
    }));
    const more = groups.length > MOVE_TO_GROUP_LIMIT ? [{ label: `${groups.length - MOVE_TO_GROUP_LIMIT} more…`, enabled: () => false }] : [];
    return [...listed, ...more, '-', 'track.newGroup', 'track.ungroup'];
  },
};

/** The Track menu, also the track list's right-click menu (MENUS.md). */
export const TRACK_ITEMS = [
  'track.rename',
  'track.setArt',
  'track.clearArt',
  'track.gain',
  'track.resetGain',
  '-',
  'track.link',
  'track.unlink',
  MOVE_TO_GROUP,
  '-',
  'track.showInFolder',
  'track.properties',
  '-',
  'track.resetOverrides',
];

/** Right-click on a group header: the group itself, then the selection (its tracks) as usual. */
export const GROUP_CONTEXT_ITEMS = [
  'group.edit',
  'group.setArt',
  'group.clearArt',
  '-',
  'view.collapseAll',
  'view.expandAll',
  '-',
  'track.gain',
  'track.resetGain',
  MOVE_TO_GROUP,
  '-',
  'edit.cut',
  'edit.copy',
  'edit.remove',
];

/** Right-click on the art pane: art for the playing track, and the pane itself. */
export const ART_CONTEXT_ITEMS = [
  'art.setNowPlaying',
  'art.clearNowPlaying',
  '-',
  'view.jumpToNowPlaying',
  'view.resetArtPane',
  'view.showArtPane',
  '-',
  'options.showShapes',
  'options.pauseGifsWithPlayback',
];

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
      'view.showArtPane',
      'view.resetArtPane',
      '-',
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
      { label: 'Order', items: ['playback.order.sequential', 'playback.order.shuffle'] },
      { label: 'Repeat', items: ['playback.repeat.off', 'playback.repeat.all', 'playback.repeat.one'] },
      'playback.reshuffle',
      'playback.stopAfterCurrent',
      '-',
      'playback.volumeUp',
      'playback.volumeDown',
      'playback.mute',
    ],
  },
  {
    label: 'Playlist',
    items: [
      'playlist.properties',
      'playlist.colors',
      '-',
      {
        label: 'Grouping',
        items: [
          'playlist.grouping.off',
          'playlist.grouping.album',
          'playlist.grouping.artist',
          'playlist.grouping.manual',
          'playlist.grouping.custom',
        ],
      },
      'playlist.editGroups',
      '-',
      { label: 'Storage', items: ['playlist.storage.reference', 'playlist.storage.bundled'] },
      'playlist.relink',
    ],
  },
  { label: 'Track', items: TRACK_ITEMS },
  {
    label: 'Options',
    items: ['options.folderMappings', 'options.restoreTabs', '-', 'options.showShapes', 'options.pauseGifs', 'options.pauseGifsWithPlayback'],
  },
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
