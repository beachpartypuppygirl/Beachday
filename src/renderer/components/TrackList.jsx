import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePlayer } from '../audio/usePlayer.js';
import * as store from '../store/playlists.js';
import * as ui from '../store/ui.js';
import * as actions from '../store/actions.js';
import { formatTime } from '../format.js';

/**
 * The viewed playlist as a flat list. Phase 5 replaces the rendering with a
 * virtualized list (group headers, collapse, drag-reorder, multi-select) and
 * adds the tab strip above the header; the header and row content carry over.
 */
export default function TrackList() {
  const { playlists, viewedId, playingId } = useSyncExternalStore(store.subscribe, store.getState);
  const { queue, index, status } = usePlayer();
  const { busy, notice } = ui.useUi();
  const [importProgress, setImportProgress] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const playlist = playlists[viewedId];

  useEffect(
    () =>
      window.beachday.tracks.onImportProgress((progress) =>
        setImportProgress(progress.done < progress.total ? progress : null)
      ),
    []
  );

  if (!playlist) return null;

  const tracks = playlist.doc.tracks.map((track) => store.trackView(track, playlist.resolution));
  const playingTrackId = playingId === viewedId && status !== 'empty' ? queue[index]?.id : null;
  const totalDuration = tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0);
  const missing = tracks.filter((track) => track.missing).length;

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
    if (files.length) actions.importInto(() => window.beachday.tracks.importDropped(files));
  };

  let statusLine = `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'} | Time: ${formatTime(totalDuration)}`;
  if (importProgress) statusLine = `Reading tags… ${importProgress.done} / ${importProgress.total}`;
  if (busy) statusLine = `${busy.label}…${busy.fraction != null ? ` ${Math.round(busy.fraction * 100)}%` : ''}`;

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
        <ol className="tracklist__rows">
          {tracks.map((track, i) => (
            <li
              key={track.id}
              className={`track${track.id === playingTrackId ? ' track--current' : ''}${track.missing ? ' track--missing' : ''}`}
              title={track.missing ? `Missing — ${track.path ?? 'unknown location'}` : track.path}
              onDoubleClick={() => store.play(viewedId, i)}
            >
              <span className="track__number">{i + 1}</span>
              <span className="track__title">{track.title}</span>
              <span className="track__artist">{track.missing ? 'missing' : track.artist}</span>
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
