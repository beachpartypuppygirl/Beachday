import TitleBar from './components/TitleBar.jsx';
import TrackList from './components/TrackList.jsx';
import Transport from './components/Transport.jsx';
import { usePlayer } from './audio/usePlayer.js';

/**
 * App shell. The layout mirrors PLAN.md §1: a large art pane on the left
 * (1/2-2/3 of the window) and the track list on the right, with the transport
 * bar across the bottom.
 *
 * The art pane shows the playing track's embedded art, letterboxed. Phase 6
 * adds the draggable split, GIF guardrail and the full art resolution chain.
 */
export default function App() {
  return (
    <div className="app">
      <TitleBar />

      <main className="workspace">
        <section className="pane pane--art">
          <ArtPane />
        </section>

        <section className="pane pane--list">
          <TrackList />
        </section>
      </main>

      <Transport />
    </div>
  );
}

function ArtPane() {
  const { queue, index, status } = usePlayer();
  const track = status === 'empty' ? null : queue[index];

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
