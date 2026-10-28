import { useEffect } from 'react';
import TitleBar from './components/TitleBar.jsx';
import TrackList from './components/TrackList.jsx';
import Transport from './components/Transport.jsx';
import Dialogs from './components/Dialogs.jsx';
import { usePlayer } from './audio/usePlayer.js';
import { handleShortcut, runCommand } from './menus/commands.js';
import { requestAppClose, restoreSession } from './store/actions.js';

/**
 * App shell. The layout mirrors PLAN.md §1: a large art pane on the left
 * (1/2-2/3 of the window) and the track list on the right, with the transport
 * bar across the bottom.
 *
 * The art pane shows the playing track's embedded art, letterboxed. Phase 6
 * adds the draggable split, GIF guardrail and the full art resolution chain.
 */
let sessionRestore = null;

export default function App() {
  useEffect(() => {
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  // Main asks before the window closes, so unsaved playlists can be settled.
  useEffect(() => window.beachday.app.onCloseRequested(requestAppClose), []);

  // Reopen last session's tabs (once; StrictMode runs effects twice in dev).
  useEffect(() => {
    if (!sessionRestore) sessionRestore = restoreSession();
  }, []);

  return (
    <div className="app">
      <TitleBar />

      <main className="workspace">
        {/* Left-click anywhere on the art toggles playback, as in foobar2000. */}
        <section
          className="pane pane--art"
          onClick={(event) => event.button === 0 && runCommand('playback.playPause')}
        >
          <ArtPane />
        </section>

        <section className="pane pane--list">
          <TrackList />
        </section>
      </main>

      <Transport />
      <Dialogs />
    </div>
  );
}

function ArtPane() {
  const { current: track } = usePlayer();

  if (track?.artUrl) {
    return <img className="art" src={track.artUrl} alt="" draggable={false} />;
  }
  return (
    <div className="placeholder">
      <span className="placeholder__label">{track ? 'No Artwork' : 'Art Pane'}</span>
      <p>
        {track
          ? 'This track has no embedded art. Custom art per track arrives in Phase 7.'
          : 'Artwork for the playing track shows here.'}
      </p>
    </div>
  );
}
