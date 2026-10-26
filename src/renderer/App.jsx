import { useEffect, useState } from 'react';
import TitleBar from './components/TitleBar.jsx';

/**
 * Phase 1 shell. The layout mirrors PLAN.md §1: a large art pane on the left
 * (1/2-2/3 of the window) and the track list on the right, with the transport
 * bar across the bottom. Everything inside those regions is a placeholder.
 *
 * The right pane currently holds a smoke test that exercises the full IPC
 * path in both directions — renderer -> main -> native dialog -> renderer.
 * Phase 3 replaces it with the real track list.
 */
export default function App() {
  const [info, setInfo] = useState(null);
  const [pickedFiles, setPickedFiles] = useState([]);

  useEffect(() => {
    window.beachday.app.getInfo().then(setInfo);
  }, []);

  async function handlePickFiles() {
    setPickedFiles(await window.beachday.dialog.openAudioFiles());
  }

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
          <div className="smoke">
            <h2 className="smoke__heading">Phase 1 — Shell &amp; IPC</h2>
            <p className="smoke__note">
              Verifies the renderer can reach the main process and back. Replaced by the
              real track list in Phase 3.
            </p>

            {info ? (
              <dl className="smoke__grid">
                <dt>app</dt>
                <dd>
                  {info.name} {info.version}
                </dd>
                <dt>electron</dt>
                <dd>{info.electron}</dd>
                <dt>chrome</dt>
                <dd>{info.chrome}</dd>
                <dt>node</dt>
                <dd>{info.node}</dd>
                <dt>platform</dt>
                <dd>
                  {info.platform}/{info.arch}
                </dd>
                <dt>mode</dt>
                <dd>{info.packaged ? 'packaged' : 'development'}</dd>
              </dl>
            ) : (
              <p className="smoke__note">Waiting on main process…</p>
            )}

            <button className="button" type="button" onClick={handlePickFiles}>
              Test native file dialog
            </button>

            {pickedFiles.length > 0 && (
              <ul className="smoke__results">
                {pickedFiles.map((filePath) => (
                  <li key={filePath}>{filePath}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>

      <footer className="transport">
        Transport bar — progress, play/pause/stop, previous/next, shuffle, volume · Phase 2
      </footer>
    </div>
  );
}
