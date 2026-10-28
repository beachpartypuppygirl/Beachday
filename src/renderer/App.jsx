import TitleBar from './components/TitleBar.jsx';
import Transport from './components/Transport.jsx';
import { player } from './audio/engine.js';
import { usePlayer } from './audio/usePlayer.js';

/**
 * App shell. The layout mirrors PLAN.md §1: a large art pane on the left
 * (1/2-2/3 of the window) and the track list on the right, with the transport
 * bar across the bottom.
 *
 * The right pane currently holds a Phase 2 test queue: pick files, then
 * double-click one to play it. Phase 3 replaces it with the real track list.
 */
export default function App() {
  return (
    <div className="app">
      <TitleBar />

      <main className="workspace">
        <section className="pane pane--art">
          <div className="placeholder">
            <span className="placeholder__label">Art Pane</span>
            <p>
              Large track artwork renders here, with a draggable split so it can take
              roughly half to two-thirds of the window.
            </p>
            <span className="placeholder__phase">Phase 6</span>
          </div>
        </section>

        <section className="pane pane--list">
          <TestQueue />
        </section>
      </main>

      <Transport />
    </div>
  );
}

function TestQueue() {
  const { queue, index, status } = usePlayer();

  async function handleAddFiles() {
    const tracks = await window.beachday.dialog.openAudioFiles();
    player.addTracks(tracks.map((track) => ({ ...track, id: crypto.randomUUID() })));
  }

  return (
    <div className="testqueue">
      <div className="testqueue__header">
        <div>
          <h2 className="testqueue__heading">Phase 2 — Test Queue</h2>
          <p className="testqueue__note">
            Double-click a track to play it. Replaced by the real track list in Phase 3.
          </p>
        </div>
        <button className="button" type="button" onClick={handleAddFiles}>
          Add files…
        </button>
      </div>

      <ol className="testqueue__list">
        {queue.map((track, i) => (
          <li
            key={track.id}
            className={`testqueue__track${i === index && status !== 'empty' ? ' testqueue__track--current' : ''}`}
            title={track.path}
            onDoubleClick={() => player.playIndex(i)}
          >
            <span className="testqueue__number">{i + 1}</span>
            <span className="testqueue__title">{track.title}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
