import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import TitleBar from './components/TitleBar.jsx';
import TrackList from './components/TrackList.jsx';
import Transport from './components/Transport.jsx';
import Dialogs from './components/Dialogs.jsx';
import ArtImage from './components/ArtImage.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import { usePlayer } from './audio/usePlayer.js';
import { handleShortcut, runCommand, ART_CONTEXT_ITEMS } from './menus/commands.js';
import { requestAppClose, restoreSession } from './store/actions.js';
import * as store from './store/playlists.js';
import { useUi, loadPrefs, setArtPane, DEFAULT_ART_FRACTION } from './store/ui.js';
import { symbolUrl } from './symbols.js';

/**
 * App shell. The layout mirrors PLAN.md §1: a large art pane on the left
 * (1/2-2/3 of the window) and the track list on the right, with the transport
 * bar across the bottom.
 *
 * The split between them is draggable (double-click the divider to reset),
 * and the art pane can be hidden: View ▸ Show Art Pane. Both are app-level
 * preferences, not playlist state.
 */
let sessionRestore = null;

// Pixel floors for the split. CSS enforces them as the window resizes; the
// drag respects them too, so the divider never runs ahead of the pointer.
const MIN_ART = 240;
const MIN_LIST = 420;
const KEY_STEP = 0.02;

export default function App() {
  useEffect(() => {
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  // Main asks before the window closes, so unsaved playlists can be settled.
  useEffect(() => window.beachday.app.onCloseRequested(requestAppClose), []);

  // View preferences, and last session's tabs (once; StrictMode runs effects twice in dev).
  useEffect(() => {
    if (!sessionRestore) sessionRestore = Promise.all([loadPrefs(), restoreSession()]);
  }, []);

  const { artPane } = useUi();
  const workspace = useRef(null);
  const [artMenu, setArtMenu] = useState(null);

  return (
    <div className="app">
      <TitleBar />

      <main
        className={`workspace${artPane.visible ? '' : ' workspace--no-art'}`}
        ref={workspace}
        style={{ '--art-fraction': `${artPane.fraction * 100}%` }}
      >
        {artPane.visible && (
          <>
            {/* Left-click anywhere on the art toggles playback, as in foobar2000;
                right-click is art for the playing track. */}
            <section
              className="pane pane--art"
              onClick={(event) => event.button === 0 && runCommand('playback.playPause')}
              onContextMenu={(event) => {
                event.preventDefault();
                setArtMenu({ x: event.clientX, y: event.clientY });
              }}
            >
              <ArtPane />
            </section>
            <Splitter workspace={workspace} fraction={artPane.fraction} />
          </>
        )}

        <section className="pane pane--list">
          <TrackList />
        </section>
      </main>

      <Transport />
      <Dialogs />
      {artMenu && <ContextMenu at={artMenu} items={ART_CONTEXT_ITEMS} onClose={() => setArtMenu(null)} />}
    </div>
  );
}

/** The fraction of the workspace's width at `clientX`, within the pixel floors. */
function fractionAt(workspace, clientX) {
  const { left, width } = workspace.getBoundingClientRect();
  const x = Math.min(Math.max(clientX - left, MIN_ART), width - MIN_LIST);
  return x / width;
}

/** The divider between the art pane and the list: drag, arrow keys, double-click to reset. */
function Splitter({ workspace, fraction }) {
  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.classList.add('splitter--dragging');
    const onMove = (move) => setArtPane({ fraction: fractionAt(workspace.current, move.clientX) }, { persist: false });
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      handle.classList.remove('splitter--dragging');
      setArtPane({});
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onKeyDown = (event) => {
    const step = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[event.key];
    if (!step) return;
    event.preventDefault();
    const { left, width } = workspace.current.getBoundingClientRect();
    setArtPane({ fraction: fractionAt(workspace.current, left + (fraction + step) * width) });
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize art pane"
      aria-valuenow={Math.round(fraction * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => setArtPane({ fraction: DEFAULT_ART_FRACTION })}
    />
  );
}

/**
 * The playing track's art, through the full chain (store/art.js): its own
 * art, its group's, the playlist cover, then its generated symbol.
 * A GIF here pauses with the music (Options ▸ Pause GIFs When Playback Pauses).
 * Options ▸ Show Track Shapes Instead of Art skips straight to the symbol.
 */
function ArtPane() {
  const { current, status } = usePlayer();
  const { playlists, playingId } = useSyncExternalStore(store.subscribe, store.getState);
  const { pauseGifsWithPlayback, showShapes } = useUi();

  if (!current) {
    return (
      <div className="placeholder">
        <span className="placeholder__label">Nothing Playing</span>
        <p>Artwork for the playing track shows here.</p>
      </div>
    );
  }
  const block = <img className="art art--generated" src={symbolUrl(current.symbolSeed)} alt="" draggable={false} />;
  const url = showShapes ? null : (store.paneArtUrl(playlists[playingId], current.id) ?? current.artUrl);
  const paused = pauseGifsWithPlayback && status !== 'playing';
  return url ? <ArtImage key={url} className="art" src={url} fallback={block} paused={paused} /> : block;
}
