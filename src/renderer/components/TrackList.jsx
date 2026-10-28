import { useEffect, useState } from 'react';
import { player } from '../audio/engine.js';
import { usePlayer } from '../audio/usePlayer.js';
import { formatTime } from '../format.js';

/**
 * Phase 3 flat track list. Phase 5 replaces the rendering with a virtualized
 * list (group headers, collapse, drag-reorder, multi-select); the header's
 * totals line and the row content carry over.
 *
 * The Add buttons are stand-ins for File ▸ Add Files / Add Folder (MENUS.md)
 * until the menu bar is built.
 */
export default function TrackList() {
  const { queue, index, status } = usePlayer();
  const [progress, setProgress] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => window.beachday.tracks.onImportProgress(setProgress), []);

  async function runImport(request) {
    try {
      const tracks = await request();
      player.addTracks(tracks.map((track) => ({ ...track, id: crypto.randomUUID() })));
    } catch (error) {
      // Per-file failures are already absorbed in main; this is the whole request failing.
      console.error('Import failed', error);
    } finally {
      setProgress(null);
    }
  }

  const onDragOver = (event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setIsDragOver(false);
    // An array, not the FileList: contextBridge passes File objects but turns a
    // FileList into an empty object.
    const files = [...event.dataTransfer.files];
    if (files.length) runImport(() => window.beachday.tracks.importDropped(files));
  };

  const totalDuration = queue.reduce((sum, track) => sum + (track.duration ?? 0), 0);

  return (
    <div
      className={`tracklist${isDragOver ? ' tracklist--dragover' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsDragOver(false);
      }}
      onDrop={onDrop}
    >
      <header className="tracklist__header">
        <span className="tracklist__totals">
          {progress
            ? `Reading tags… ${progress.done} / ${progress.total}`
            : `${queue.length} ${queue.length === 1 ? 'track' : 'tracks'} | Time: ${formatTime(totalDuration)}`}
        </span>
        <div className="tracklist__actions">
          <button
            className="tracklist__action"
            type="button"
            disabled={Boolean(progress)}
            onClick={() => runImport(window.beachday.tracks.pickFiles)}
          >
            Add files…
          </button>
          <button
            className="tracklist__action"
            type="button"
            disabled={Boolean(progress)}
            onClick={() => runImport(window.beachday.tracks.pickFolder)}
          >
            Add folder…
          </button>
        </div>
      </header>

      {queue.length === 0 && !progress ? (
        <div className="tracklist__empty">
          <p>Drop audio files or folders here</p>
          <p className="tracklist__empty-hint">mp3 · flac · wav · ogg · opus · m4a</p>
        </div>
      ) : (
        <ol className="tracklist__rows">
          {queue.map((track, i) => (
            <li
              key={track.id}
              className={`track${i === index && status !== 'empty' ? ' track--current' : ''}`}
              title={track.path}
              onDoubleClick={() => player.playIndex(i)}
            >
              <span className="track__number">{i + 1}</span>
              <span className="track__title">{track.title}</span>
              <span className="track__artist">{track.artist}</span>
              <span className="track__duration">
                {track.duration != null ? formatTime(track.duration) : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
