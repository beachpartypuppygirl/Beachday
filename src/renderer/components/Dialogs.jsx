import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as store from '../store/playlists.js';
import * as ui from '../store/ui.js';
import * as actions from '../store/actions.js';
import { COMMANDS } from '../menus/commands.js';
import { formatTime } from '../format.js';

/** Renders whichever dialog the ui store says is open. */
export default function Dialogs() {
  const { dialog } = ui.useUi();
  if (dialog === 'relink') return <RelinkDialog />;
  if (dialog === 'mappings') return <FolderMappingsDialog />;
  if (dialog === 'shortcuts') return <ShortcutsDialog />;
  if (dialog === 'about') return <AboutDialog />;
  if (dialog === 'properties') return <PropertiesDialog />;
  return null;
}

function Modal({ title, children, footer, wide = false }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') ui.closeDialog();
    };
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.querySelector('button, input')?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="modal" onPointerDown={(event) => event.target === event.currentTarget && ui.closeDialog()}>
      <div className={`modal__panel${wide ? ' modal__panel--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <h2 className="modal__title">{title}</h2>
        <div className="modal__body">{children}</div>
        <div className="modal__footer">{footer}</div>
      </div>
    </div>
  );
}

// --- Relink ------------------------------------------------------------------

function RelinkDialog() {
  const { playlists, viewedId } = useSyncExternalStore(store.subscribe, store.getState);
  const playlist = playlists[viewedId];
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(null);

  const missing = playlist.doc.tracks.filter((track) => playlist.resolution[track.id]?.status !== 'ok');

  const run = async (work) => {
    setWorking(true);
    try {
      const found = await work();
      if (found !== null) setMessage(found ? `Found ${found} ${found === 1 ? 'track' : 'tracks'}.` : 'No matches found.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      title="Missing tracks"
      wide
      footer={
        <>
          <span className="modal__message">{message}</span>
          <button className="button button--quiet" type="button" disabled={working || !missing.length} onClick={() => run(() => actions.resolveMissing({ searchFolder: true }))}>
            Search a folder…
          </button>
          <button className="button" type="button" onClick={ui.closeDialog}>
            {missing.length ? 'Close' : 'Done'}
          </button>
        </>
      }
    >
      {missing.length === 0 ? (
        <p className="modal__text">Every track in this playlist is found.</p>
      ) : (
        <>
          <p className="modal__text">
            {missing.length} {missing.length === 1 ? 'track isn’t' : 'tracks aren’t'} where this playlist
            expects. Locate one, and Beachday learns where that folder lives on this computer and looks
            there for the rest. Or search a folder: files are matched by content, even if renamed.
          </p>
          <ul className="relink__list">
            {missing.map((track) => (
              <li key={track.id} className="relink__row">
                <div className="relink__info">
                  <span className="relink__title">{track.overrides.title || track.tags.title}</span>
                  <span className="relink__path" title={track.absPath ?? ''}>
                    {track.absPath ?? track.relPath ?? 'Unknown location'}
                  </span>
                </div>
                <button className="button button--quiet" type="button" disabled={working} onClick={() => run(() => actions.locateTrack(track.id))}>
                  Locate…
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

// --- Folder mappings ---------------------------------------------------------

function FolderMappingsDialog() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    window.beachday.config.getFolderMappings().then(setRows);
  }, []);

  const update = (i, patch) => setRows(rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const browse = async (i) => {
    const folder = await window.beachday.dialog.pickFolder('Choose the folder on this computer');
    if (folder) update(i, { to: folder });
  };

  const save = async () => {
    await window.beachday.config.setFolderMappings(rows);
    ui.closeDialog();
    // New mappings may find tracks that were missing.
    const { playlists, viewedId } = store.getState();
    if (store.missingCount(playlists[viewedId]) > 0) actions.resolveMissing();
  };

  return (
    <Modal
      title="Folder mappings"
      wide
      footer={
        <>
          <button className="button button--quiet" type="button" onClick={() => setRows([...(rows ?? []), { from: '', to: '' }])}>
            Add mapping
          </button>
          <span className="modal__spacer" />
          <button className="button button--quiet" type="button" onClick={ui.closeDialog}>
            Cancel
          </button>
          <button className="button" type="button" disabled={!rows} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <p className="modal__text">
        Where another computer’s music folders are on this one. A playlist made with tracks in
        <code> C:\Music</code> finds them in whatever folder that maps to. Beachday adds these for you
        when you locate a missing track.
      </p>
      {rows && rows.length === 0 && <p className="modal__text modal__text--muted">No mappings yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="mappings__list">
          {rows.map((row, i) => (
            <li key={i} className="mappings__row">
              <input
                className="field"
                value={row.from}
                placeholder="Folder on the other computer"
                aria-label="Folder on the other computer"
                onChange={(event) => update(i, { from: event.target.value })}
              />
              <span className="mappings__arrow">→</span>
              <input
                className="field"
                value={row.to}
                placeholder="Folder on this computer"
                aria-label="Folder on this computer"
                onChange={(event) => update(i, { to: event.target.value })}
              />
              <button className="button button--quiet" type="button" onClick={() => browse(i)}>
                Browse…
              </button>
              <button className="button button--quiet" type="button" aria-label="Remove mapping" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// --- Track properties (read-only; Beachday never writes tags) ---------------

function PropertiesDialog() {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const playlist = state.playlists[state.viewedId];
  const ids = store.selectedIds(playlist);
  const byId = new Map(playlist.doc.tracks.map((track) => [track.id, track]));
  const tracks = ids.map((id) => byId.get(id)).filter(Boolean);
  const close = <button className="button" type="button" onClick={ui.closeDialog}>Close</button>;

  if (tracks.length !== 1) {
    const duration = tracks.reduce((sum, track) => sum + (track.tags.duration ?? 0), 0);
    const size = tracks.reduce((sum, track) => sum + (track.size ?? 0), 0);
    return (
      <Modal title={`${tracks.length} tracks`} footer={close}>
        <dl className="about">
          <dt>Total time</dt>
          <dd>{formatTime(duration)}</dd>
          <dt>Total size</dt>
          <dd>{formatBytes(size)}</dd>
        </dl>
      </Modal>
    );
  }

  const [track] = tracks;
  const { tags } = track;
  const resolved = playlist.resolution[track.id];
  const format = [tags.codec, tags.bitrate && `${tags.bitrate} kbps`, tags.sampleRate && `${tags.sampleRate / 1000} kHz`, tags.bitsPerSample && `${tags.bitsPerSample}-bit`]
    .filter(Boolean)
    .join(' · ');
  const fields = [
    ['Title', tags.title],
    ['Artist', tags.artist],
    ['Album artist', tags.albumArtist],
    ['Album', tags.album],
    ['Track', [tags.trackNo, tags.discNo && `disc ${tags.discNo}`].filter(Boolean).join(', ')],
    ['Year', tags.year],
    ['Genre', tags.genre],
    ['Length', tags.duration != null ? formatTime(tags.duration) : null],
    ['Format', format],
    ['ReplayGain', tags.replayGainDb != null ? `${tags.replayGainDb > 0 ? '+' : ''}${tags.replayGainDb.toFixed(2)} dB` : null],
    ['Size', track.size ? formatBytes(track.size) : null],
    ['Location', resolved?.status === 'ok' ? (resolved.how === 'bundled' ? 'Inside this playlist (bundled)' : track.absPath) : `Missing — ${track.absPath ?? 'unknown'}`],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');

  return (
    <Modal title="Track properties" wide footer={close}>
      <p className="modal__text modal__text--muted">Read from the file’s tags. Beachday never changes them.</p>
      <dl className="about">
        {fields.map(([label, value]) => (
          <div key={label} className="about__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

// --- Help --------------------------------------------------------------------

function ShortcutsDialog() {
  const bound = Object.values(COMMANDS).filter((command) => command.shortcut);
  return (
    <Modal title="Keyboard shortcuts" footer={<button className="button" type="button" onClick={ui.closeDialog}>Close</button>}>
      <dl className="shortcuts">
        {bound.map((command) => (
          <div key={command.shortcut} className="shortcuts__row">
            <dt>{typeof command.label === 'function' ? command.label(SHORTCUT_LABEL_CONTEXT) : command.label}</dt>
            <dd>
              <kbd>{command.shortcut}</kbd>
              {command.aliases?.map((alias) => (
                <kbd key={alias}>{alias}</kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

// Dynamic labels ("Undo Add Tracks", "Pause") read context; show their plain form here.
const SHORTCUT_LABEL_CONTEXT = { playlist: null, playerState: { status: 'stopped' }, recentFiles: [] };

function AboutDialog() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    window.beachday.app.getInfo().then(setInfo);
  }, []);
  return (
    <Modal title="About Beachday" footer={<button className="button" type="button" onClick={ui.closeDialog}>Close</button>}>
      <p className="modal__text">A local audio player, and a playlist format that travels.</p>
      {info && (
        <dl className="about">
          <dt>Version</dt>
          <dd>{info.version}</dd>
          <dt>Electron</dt>
          <dd>{info.electron}</dd>
          <dt>Chromium</dt>
          <dd>{info.chrome}</dd>
          <dt>Platform</dt>
          <dd>
            {info.platform}/{info.arch}
          </dd>
        </dl>
      )}
    </Modal>
  );
}
