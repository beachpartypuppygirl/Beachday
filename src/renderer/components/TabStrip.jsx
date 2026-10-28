import { useEffect, useRef, useSyncExternalStore } from 'react';
import * as store from '../store/playlists.js';
import * as actions from '../store/actions.js';

/**
 * Playlist tabs across the top of the list pane (PLAN.md §5 "Playlist tabs").
 * Click to view, middle-click or × to close, + for a new playlist. The tab
 * that's playing shows ♪. Overflow scrolls sideways (mouse wheel works too).
 */
export default function TabStrip() {
  const { order, playlists, viewedId, playingId } = useSyncExternalStore(store.subscribe, store.getState);
  const stripRef = useRef(null);

  // Keep the viewed tab in sight when it changes (Ctrl+Tab, Jump to Now Playing).
  useEffect(() => {
    stripRef.current?.querySelector('.tab--viewed')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [viewedId]);

  return (
    <div className="tabstrip">
      <div
        className="tabstrip__tabs"
        ref={stripRef}
        role="tablist"
        onWheel={(event) => {
          if (event.deltaY) event.currentTarget.scrollLeft += event.deltaY;
        }}
        onDoubleClick={(event) => event.target === event.currentTarget && actions.newPlaylist()}
      >
        {order.map((id) => {
          const playlist = playlists[id];
          const name = store.playlistName(playlist);
          const classes = [
            'tab',
            id === viewedId && 'tab--viewed',
            playlist.loadError && 'tab--broken',
            !playlist.loaded && !playlist.loadError && 'tab--unloaded',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={id}
              className={classes}
              role="tab"
              aria-selected={id === viewedId}
              title={playlist.filePath ?? 'Not saved yet'}
              onPointerDown={(event) => event.button === 0 && store.viewPlaylist(id)}
              onAuxClick={(event) => event.button === 1 && actions.closeTab(id)}
            >
              {id === playingId && <span className="tab__playing" aria-label="Playing">♪</span>}
              <span className="tab__name">{name}</span>
              {store.isDirty(playlist) && <span className="tab__dirty" title="Unsaved changes">•</span>}
              <button
                className="tab__close"
                type="button"
                aria-label={`Close ${name}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => actions.closeTab(id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button className="tabstrip__new" type="button" title="New playlist (Ctrl+N)" aria-label="New playlist" onClick={actions.newPlaylist}>
        +
      </button>
    </div>
  );
}
