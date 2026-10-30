import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { usePlayer } from '../audio/usePlayer.js';
import * as store from '../store/playlists.js';
import * as ui from '../store/ui.js';
import * as actions from '../store/actions.js';
import { formatTime } from '../format.js';
import { TRACK_CONTEXT_ITEMS } from '../menus/commands.js';
import ContextMenu from './ContextMenu.jsx';
import TabStrip from './TabStrip.jsx';
import ArtImage from './ArtImage.jsx';
import { symbolUrl } from '../symbols.js';

/**
 * The viewed playlist: tab strip, header, and a virtualized list of the
 * flattened row model (store/grouping.js). Only the rows on screen are
 * rendered, and every row has a fixed height, so 5,000 tracks scroll as
 * smoothly as 50 and a pointer position maps to a row by arithmetic.
 *
 * Interactions, desktop conventions:
 *   click / Ctrl+click / Shift+click   select / toggle / range
 *   arrows, Home/End, PageUp/PageDown  move (Shift extends); Enter plays
 *   double-click                       play (a group header plays its first track)
 *   drag                               reorder tracks, or a group by its header
 *   right-click                        Track menu + clipboard
 *
 * Drag is hand-rolled on pointer events rather than HTML5 drag-and-drop,
 * which fights virtualization (dragged rows unmount as they scroll away).
 */

const TRACK_HEIGHT = 22;
const GROUP_HEIGHT = 74;
const DRAG_THRESHOLD_PX = 4;
const AUTOSCROLL_EDGE_PX = 36;
const AUTOSCROLL_MAX_PX = 18;

// Scroll position per playlist, so switching tabs comes back to the same place.
const scrollMemory = new Map();

export default function TrackList() {
  const { playlists, viewedId } = useSyncExternalStore(store.subscribe, store.getState);
  const playlist = playlists[viewedId];

  return (
    <div className="tracklist">
      <TabStrip />
      {!playlist ? null : playlist.loaded ? (
        <LoadedPlaylist key={playlist.id} playlist={playlist} />
      ) : (
        <UnloadedPlaylist playlist={playlist} />
      )}
    </div>
  );
}

function UnloadedPlaylist({ playlist }) {
  const name = store.playlistName(playlist);
  if (!playlist.loadError) {
    return (
      <div className="tracklist__empty">
        <p>Opening {name}…</p>
      </div>
    );
  }
  return (
    <div className="tracklist__empty">
      <p>{playlist.loadError === 'missing' ? `“${name}” isn’t where it was.` : `“${name}” couldn’t be opened.`}</p>
      <p className="tracklist__empty-hint">{playlist.filePath}</p>
      <div className="tracklist__empty-actions">
        {playlist.loadError === 'missing' && (
          <button className="button button--quiet" type="button" onClick={() => actions.relocateTab(playlist.id)}>
            Locate…
          </button>
        )}
        <button className="button button--quiet" type="button" onClick={() => actions.closeTab(playlist.id)}>
          Close Tab
        </button>
      </div>
    </div>
  );
}

function LoadedPlaylist({ playlist }) {
  const { playingId } = useSyncExternalStore(store.subscribe, store.getState);
  const { current, status } = usePlayer();
  const { busy, notice, scrollRequest } = ui.useUi();
  const [importProgress, setImportProgress] = useState(null);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [drag, setDrag] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const scrollRef = useRef(null);
  const pressRef = useRef(null);

  const layout = store.layoutOf(playlist);
  const { rows, order } = layout;
  const grouped = Boolean(layout.groups);
  const { selection, focusId } = playlist.view;
  const tracksById = useMemo(() => new Map(playlist.doc.tracks.map((t) => [t.id, t])), [playlist.doc.tracks]);
  const playingTrackId = playingId === playlist.id && status !== 'empty' ? current?.id : null;

  // Row geometry: fixed heights, so offsets are a running sum.
  const starts = useMemo(() => {
    const result = new Array(rows.length + 1);
    result[0] = 0;
    for (let i = 0; i < rows.length; i++) {
      result[i + 1] = result[i] + (rows[i].type === 'group' ? GROUP_HEIGHT : TRACK_HEIGHT);
    }
    return result;
  }, [rows]);
  const rowIndexById = useMemo(
    () => new Map(rows.map((row, i) => [row.type === 'group' ? `g:${row.key}` : row.id, i])),
    [rows]
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback((i) => starts[i + 1] - starts[i], [starts]),
    getItemKey: useCallback((i) => (rows[i].type === 'group' ? `g:${rows[i].key}` : rows[i].id), [rows]),
    overscan: 16,
  });
  useLayoutEffect(() => virtualizer.measure(), [starts, virtualizer]);

  // Per-tab scroll memory.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    element.scrollTop = scrollMemory.get(playlist.id) ?? 0;
    return () => scrollMemory.set(playlist.id, element.scrollTop);
  }, [playlist.id]);

  useEffect(
    () =>
      window.beachday.tracks.onImportProgress((progress) =>
        setImportProgress(progress.done < progress.total ? progress : null)
      ),
    []
  );

  // View ▸ Jump to Now Playing.
  useEffect(() => {
    if (scrollRequest?.playlistId !== playlist.id) return;
    const index = rowIndexById.get(scrollRequest.trackId);
    if (index !== undefined) virtualizer.scrollToIndex(index, { align: 'center' });
  }, [scrollRequest, playlist.id, rowIndexById, virtualizer]);

  // --- Selection -------------------------------------------------------------

  const select = (ids, anchorId, nextFocus = anchorId) =>
    store.setSelection(playlist.id, ids, { anchorId, focusId: nextFocus });

  const rangeIds = (fromId, toId) => {
    const a = order.indexOf(fromId);
    const b = order.indexOf(toId);
    if (a < 0 || b < 0) return [toId];
    return order.slice(Math.min(a, b), Math.max(a, b) + 1);
  };

  const clickTrack = (event, id) => {
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey && playlist.view.anchorId) {
      const range = rangeIds(playlist.view.anchorId, id);
      store.setSelection(playlist.id, additive ? [...new Set([...selection, ...range])] : range, { focusId: id });
    } else if (additive) {
      const next = new Set(selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      select([...next], id);
    } else {
      select([id], id);
    }
  };

  const clickGroup = (event, group) => {
    const additive = event.ctrlKey || event.metaKey;
    select(additive ? [...new Set([...selection, ...group.trackIds])] : group.trackIds, group.trackIds[0], group.trackIds.at(-1));
  };

  // --- Drag to reorder -------------------------------------------------------

  /** The row at content offset y (binary search over `starts`). */
  const rowAt = (y) => {
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  /** Where a drag would land at content offset y: { indicatorY, apply } or null if it can't. */
  const dropTargetAt = (y, dragging) => {
    if (!rows.length) return null;
    const i = rowAt(Math.max(0, Math.min(y, starts[rows.length] - 1)));
    const row = rows[i];
    const upper = y < (starts[i] + starts[i + 1]) / 2;

    if (dragging.kind === 'group') {
      // Groups drop between groups: before the one under the pointer if it's
      // in that group's top half, otherwise after it.
      const group = row.group;
      const groupIndex = layout.groups.indexOf(group);
      const top = starts[rowIndexById.get(`g:${group.key}`)];
      const nextGroup = layout.groups[groupIndex + 1];
      const bottom = nextGroup ? starts[rowIndexById.get(`g:${nextGroup.key}`)] : starts[rows.length];
      const before = y < (top + bottom) / 2;
      const beforeKey = before ? group.key : (nextGroup?.key ?? null);
      return { indicatorY: before ? top : bottom, apply: () => store.moveGroupTo(playlist.id, dragging.key, beforeKey) };
    }

    const { ids } = dragging;
    const move = (target) => () => store.moveTracksTo(playlist.id, ids, target);
    if (!grouped) {
      return upper
        ? { indicatorY: starts[i], apply: move({ beforeId: row.id }) }
        : { indicatorY: starts[i + 1], apply: move({ afterId: row.id }) };
    }

    // Grouped: tracks stay in their own group — their tags decide it, and a
    // track dropped elsewhere would jump straight back. Pinning a track to
    // another group is Track ▸ Move to Group (Phase 7).
    const home = layout.groupOf.get(ids[0]);
    if (!ids.every((id) => layout.groupOf.get(id) === home)) return null;
    const homeHeader = rowIndexById.get(`g:${home.key}`);
    if (row.type === 'track' && row.group === home) {
      return upper
        ? { indicatorY: starts[i], apply: move({ beforeId: row.id }) }
        : { indicatorY: starts[i + 1], apply: move({ afterId: row.id }) };
    }
    if (row.type === 'group' && row.group === home && !home.collapsed) {
      return { indicatorY: starts[homeHeader + 1], apply: move({ beforeId: home.trackIds[0] }) };
    }
    // The top half of the next group's header means "end of my group".
    const nextHeader = homeHeader + 1 + (home.collapsed ? 0 : home.trackIds.length);
    if (row.type === 'group' && i === nextHeader && upper) {
      const lastOther = [...home.trackIds].reverse().find((id) => !ids.includes(id));
      return lastOther ? { indicatorY: starts[i], apply: move({ afterId: lastOther }) } : null;
    }
    return null;
  };

  const contentY = (clientY) => {
    const element = scrollRef.current;
    return clientY - element.getBoundingClientRect().top + element.scrollTop;
  };

  /**
   * Track a press that may become a drag. `begin()` is called once the
   * pointer has moved far enough, and returns what's being dragged.
   */
  const beginPress = (event, begin, onClickWithoutDrag) => {
    const press = { x: event.clientX, y: event.clientY, clientX: event.clientX, clientY: event.clientY, dragging: null, target: null };
    pressRef.current = press;

    const retarget = () => {
      press.target = dropTargetAt(contentY(press.clientY), press.dragging);
      setDrag({ ...press.dragging, x: press.clientX, y: press.clientY, indicatorY: press.target?.indicatorY ?? null });
    };

    const onMove = (moveEvent) => {
      press.clientX = moveEvent.clientX;
      press.clientY = moveEvent.clientY;
      if (!press.dragging) {
        if (Math.hypot(moveEvent.clientX - press.x, moveEvent.clientY - press.y) < DRAG_THRESHOLD_PX) return;
        press.dragging = begin();
        if (!press.dragging) return;
      }
      retarget();
    };

    // Scroll while dragging near the top or bottom edge.
    let frame = requestAnimationFrame(function autoScroll() {
      const element = scrollRef.current;
      if (press.dragging && element) {
        const rect = element.getBoundingClientRect();
        const fromTop = press.clientY - rect.top;
        const fromBottom = rect.bottom - press.clientY;
        let step = 0;
        if (fromTop < AUTOSCROLL_EDGE_PX) step = -AUTOSCROLL_MAX_PX * (1 - Math.max(fromTop, 0) / AUTOSCROLL_EDGE_PX);
        else if (fromBottom < AUTOSCROLL_EDGE_PX) step = AUTOSCROLL_MAX_PX * (1 - Math.max(fromBottom, 0) / AUTOSCROLL_EDGE_PX);
        if (step) {
          element.scrollTop += step;
          retarget();
        }
      }
      frame = requestAnimationFrame(autoScroll);
    });

    const onUp = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      pressRef.current = null;
      setDrag(null);
      if (press.dragging) press.target?.apply();
      else onClickWithoutDrag?.();
    };
    const onCancel = () => {
      press.target = null;
      onUp();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  const trackTitle = (id) => {
    const track = tracksById.get(id);
    return track ? track.overrides.title || track.tags.title : '';
  };

  const onTrackPointerDown = (event, id) => {
    if (event.button !== 0) return;
    const modified = event.shiftKey || event.ctrlKey || event.metaKey;
    // Pressing an already-selected row keeps the selection so several rows
    // can be dragged together; a plain click narrows to that row on release.
    const keepForDrag = selection.has(id) && !modified;
    if (!keepForDrag) clickTrack(event, id);
    beginPress(
      event,
      () => {
        const ids = store.selectedIds(store.getState().playlists[playlist.id]);
        return ids.length ? { kind: 'tracks', ids, label: ids.length === 1 ? trackTitle(ids[0]) : `${ids.length} tracks` } : null;
      },
      keepForDrag ? () => select([id], id) : null
    );
  };

  const onGroupPointerDown = (event, group) => {
    if (event.button !== 0) return;
    clickGroup(event, group);
    beginPress(event, () => ({ kind: 'group', key: group.key, label: group.mainName }));
  };

  // --- Keyboard --------------------------------------------------------------

  const visibleTrackIds = useMemo(() => rows.filter((row) => row.type === 'track').map((row) => row.id), [rows]);

  const onKeyDown = (event) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'Enter'];
    if (!keys.includes(event.key) || event.altKey || event.ctrlKey || !visibleTrackIds.length) return;
    event.preventDefault();
    if (event.key === 'Enter') {
      const target = focusId ?? store.selectedIds(playlist)[0];
      if (target) store.play(playlist.id, target);
      return;
    }
    const at = visibleTrackIds.indexOf(focusId);
    const page = Math.max(1, Math.floor(scrollRef.current.clientHeight / TRACK_HEIGHT) - 1);
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page }[event.key];
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? visibleTrackIds.length - 1 : at < 0 ? 0 : at + step;
    next = Math.min(Math.max(next, 0), visibleTrackIds.length - 1);
    const id = visibleTrackIds[next];
    if (event.shiftKey && playlist.view.anchorId) {
      store.setSelection(playlist.id, rangeIds(playlist.view.anchorId, id), { focusId: id });
    } else {
      select([id], id);
    }
    virtualizer.scrollToIndex(rowIndexById.get(id), { align: 'auto' });
  };

  // --- Files dropped from the OS ---------------------------------------------

  const onDragOver = (event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setFileDragOver(true);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setFileDragOver(false);
    // An array, not the FileList: contextBridge passes File objects but turns a
    // FileList into an empty object.
    const files = [...event.dataTransfer.files];
    if (files.length) actions.importInto(() => window.beachday.tracks.importDropped(files));
  };

  // --- Render ----------------------------------------------------------------

  const tracks = playlist.doc.tracks;
  const totalDuration = tracks.reduce((sum, track) => sum + (track.tags.duration ?? 0), 0);
  const missing = store.missingCount(playlist);
  let statusLine = `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`;
  if (grouped) statusLine += ` in ${layout.groups.length} ${layout.groups.length === 1 ? 'group' : 'groups'}`;
  statusLine += ` | Time: ${formatTime(totalDuration)}`;
  if (selection.size > 1) statusLine += ` | ${selection.size} selected`;
  if (importProgress) statusLine = `Reading tags… ${importProgress.done} / ${importProgress.total}`;
  if (busy) statusLine = `${busy.label}…${busy.fraction != null ? ` ${Math.round(busy.fraction * 100)}%` : ''}`;

  return (
    <>
      <header className="tracklist__header">
        <div className="tracklist__heading">
          <span className="tracklist__name" title={playlist.filePath ?? 'Not saved yet'}>
            {store.playlistName(playlist)}
            {store.isDirty(playlist) && (
              <span className="tracklist__dirty" title="Unsaved changes">
                {' '}•
              </span>
            )}
          </span>
          <span className="tracklist__totals">{statusLine}</span>
        </div>
        {notice ? (
          <span className="tracklist__notice">{notice}</span>
        ) : (
          missing > 0 && (
            <button className="tracklist__missing" type="button" onClick={() => ui.openDialog('relink')}>
              {missing} missing · Relink…
            </button>
          )
        )}
      </header>

      <div
        className={`tracklist__scroll${fileDragOver ? ' tracklist__scroll--dragover' : ''}${drag ? ' tracklist__scroll--dragging' : ''}`}
        ref={scrollRef}
        tabIndex={0}
        role="listbox"
        aria-multiselectable="true"
        aria-label="Tracks"
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget) && setFileDragOver(false)}
        onDrop={onDrop}
        onPointerDown={(event) => {
          // Clicking empty space below the rows clears the selection.
          const empty = event.target === event.currentTarget || event.target.classList.contains('tracklist__canvas');
          if (empty && event.button === 0) select([], null, null);
        }}
      >
        {tracks.length === 0 && !importProgress ? (
          <div className="tracklist__empty">
            <p>Drop audio files or folders here</p>
            <p className="tracklist__empty-hint">mp3 · flac · wav · ogg · opus · m4a</p>
            <div className="tracklist__empty-actions">
              <button className="button button--quiet" type="button" onClick={actions.addFiles}>
                Add files…
              </button>
              <button className="button button--quiet" type="button" onClick={actions.addFolder}>
                Add folder…
              </button>
            </div>
          </div>
        ) : (
          <div className="tracklist__canvas" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              const style = { transform: `translateY(${item.start}px)`, height: item.size };
              if (row.type === 'group') {
                return (
                  <GroupHeader
                    key={item.key}
                    group={row.group}
                    style={style}
                    selected={row.group.trackIds.every((id) => selection.has(id))}
                    playing={Boolean(playingTrackId) && row.group.trackIds.includes(playingTrackId)}
                    onPointerDown={(event) => onGroupPointerDown(event, row.group)}
                    onDoubleClick={() => store.play(playlist.id, row.group.trackIds[0])}
                    onToggle={() => store.toggleCollapsed(playlist.id, row.group.key)}
                  />
                );
              }
              const track = tracksById.get(row.id);
              const isMissing = playlist.resolution[row.id]?.status !== 'ok';
              const classes = [
                'track',
                grouped && 'track--grouped',
                item.index % 2 && 'track--odd',
                selection.has(row.id) && 'track--selected',
                row.id === focusId && 'track--focus',
                row.id === playingTrackId && 'track--current',
                isMissing && 'track--missing',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={item.key}
                  className={classes}
                  style={style}
                  role="option"
                  aria-selected={selection.has(row.id)}
                  title={isMissing ? `Missing — ${track.absPath ?? 'unknown location'}` : (track.absPath ?? undefined)}
                  onPointerDown={(event) => onTrackPointerDown(event, row.id)}
                  onDoubleClick={() => store.play(playlist.id, row.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!selection.has(row.id)) select([row.id], row.id);
                    setContextMenu({ x: event.clientX, y: event.clientY });
                  }}
                >
                  <span className="track__number">{row.number}</span>
                  <span className="track__title">{track.overrides.title || track.tags.title}</span>
                  {(!grouped || isMissing) && (
                    <span className="track__artist">{isMissing ? 'missing' : track.tags.artist}</span>
                  )}
                  <span className="track__duration">
                    {track.tags.duration != null ? formatTime(track.tags.duration) : ''}
                  </span>
                </div>
              );
            })}
            {drag?.indicatorY != null && (
              <div className="tracklist__drop" style={{ transform: `translateY(${drag.indicatorY - 1}px)` }} />
            )}
          </div>
        )}
      </div>

      {drag && (
        <div className={`dragghost${drag.indicatorY == null ? ' dragghost--blocked' : ''}`} style={{ left: drag.x + 14, top: drag.y + 10 }}>
          {drag.label}
        </div>
      )}
      {contextMenu && <ContextMenu at={contextMenu} items={TRACK_CONTEXT_ITEMS} onClose={() => setContextMenu(null)} />}
    </>
  );
}

function GroupHeader({ group, style, selected, playing, onPointerDown, onDoubleClick, onToggle }) {
  // The last step of the art resolution chain (store/art.js): a generated symbol.
  const block = <img className="group__art group__art--generated" src={symbolUrl(group.symbolSeed)} alt="" draggable={false} />;
  return (
    <div
      className={`group${selected ? ' group--selected' : ''}${playing ? ' group--playing' : ''}${group.collapsed ? ' group--collapsed' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <button
        className="group__toggle"
        type="button"
        aria-label={group.collapsed ? 'Expand group' : 'Collapse group'}
        aria-expanded={!group.collapsed}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={onToggle}
      >
        ›
      </button>
      {group.artUrl ? <ArtImage key={group.artUrl} className="group__art" src={group.artUrl} fallback={block} /> : block}
      <div className="group__text">
        <span className="group__main">{group.mainName}</span>
        {group.subNames.map((line, i) => (
          <span key={i} className={i === 0 ? 'group__sub' : 'group__detail'}>
            {line}
          </span>
        ))}
      </div>
      {group.year && <span className="group__year">{group.year}</span>}
    </div>
  );
}
