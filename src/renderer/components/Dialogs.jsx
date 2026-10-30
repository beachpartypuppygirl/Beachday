import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as store from '../store/playlists.js';
import * as ui from '../store/ui.js';
import * as actions from '../store/actions.js';
import { COMMANDS } from '../menus/commands.js';
import { formatTime } from '../format.js';
import { player } from '../audio/engine.js';
import { artRefUrl } from '../store/art.js';
import { GAIN_MAX_DB, GAIN_MIN_DB, clampGain, formatGain, seedGainDb, trackGainDb } from '../store/gain.js';
import { PRESETS, SUB_LINES, TOKENS, applyGroupEdits, buildLayout } from '../store/grouping.js';
import { DEFAULT_PALETTE, PALETTE_PRESETS, deriveTheme, normalizePalette, parseHex, samePalette } from '../store/theme.js';
import ArtImage from './ArtImage.jsx';
import { GroupHeader } from './TrackList.jsx';

const viewedPlaylist = (state) => state.playlists[state.viewedId];

/** Renders whichever dialog the ui store says is open. */
export default function Dialogs() {
  const { dialog } = ui.useUi();
  if (dialog === 'relink') return <RelinkDialog />;
  if (dialog === 'mappings') return <FolderMappingsDialog />;
  if (dialog === 'shortcuts') return <ShortcutsDialog />;
  if (dialog === 'about') return <AboutDialog />;
  if (dialog === 'properties') return <PropertiesDialog />;
  if (dialog === 'playlistProperties') return <PlaylistPropertiesDialog />;
  if (dialog === 'colors') return <ColorsDialog />;
  if (dialog === 'gain') return <GainDialog />;
  if (dialog === 'grouping') return <GroupingDialog />;
  if (dialog === 'groups') return <GroupsDialog />;
  return null;
}

function Modal({ title, children, footer, wide = false, className = '', preview = false }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') ui.closeDialog();
    };
    document.addEventListener('keydown', onKeyDown);
    const panel = panelRef.current;
    const first = panel?.querySelector('[data-autofocus]') ?? panel?.querySelector('button, input');
    first?.focus();
    first?.select?.();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className={`modal${preview ? ' modal--preview' : ''}`} onPointerDown={(event) => event.target === event.currentTarget && ui.closeDialog()}>
      <div className={`modal__panel${wide ? ' modal__panel--wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
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

  const gain = trackGainDb(track);
  const gainSource = Number.isFinite(track.overrides.gainDb) ? 'set in this playlist' : tags.replayGainDb != null ? 'from ReplayGain' : 'default';
  const group = playlist.doc.grouping && track.groupId ? store.layoutOf(playlist).groupOf.get(track.id) : null;
  const playlistFields = [
    ['Name', track.overrides.title],
    ['Gain', `${formatGain(gain)} (${gainSource})`],
    ['Custom art', track.overrides.art ? 'Yes' : null],
    ['Group', group?.key === track.groupId ? `${group.mainName} (moved here)` : null],
  ].filter(([, value]) => value);

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
      <h3 className="modal__section">In this playlist</h3>
      <dl className="about">
        {playlistFields.map(([label, value]) => (
          <div key={label} className="about__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

// --- Playlist properties (Playlist ▸ Properties…) ---------------------------

function PlaylistPropertiesDialog() {
  const playlist = viewedPlaylist(useSyncExternalStore(store.subscribe, store.getState));
  const { busy } = ui.useUi();
  const [draft, setDraft] = useState(() => ({ ...playlist.doc.meta }));
  const update = (patch) => setDraft({ ...draft, ...patch });
  const unnamed = store.playlistName({ ...playlist, doc: { ...playlist.doc, meta: { ...playlist.doc.meta, name: '' } } });
  const coverUrl = artRefUrl(draft.cover);

  const chooseCover = async () => {
    const ref = await actions.pickArt('Choose playlist cover');
    if (ref) setDraft((current) => ({ ...current, cover: ref }));
  };

  const apply = () => {
    store.setMeta(playlist.id, {
      name: draft.name.trim(),
      author: draft.author.trim(),
      description: draft.description.trim(),
      cover: draft.cover ?? null,
    });
    ui.closeDialog();
  };

  return (
    <Modal
      title="Playlist properties"
      wide
      footer={
        <>
          <button className="button button--quiet" type="button" onClick={ui.closeDialog}>
            Cancel
          </button>
          <button className="button" type="button" disabled={Boolean(busy)} onClick={apply}>
            Apply
          </button>
        </>
      }
    >
      <div className="meta">
        <div className="meta__fields">
          <label className="form__label">
            Name
            <input className="field" data-autofocus value={draft.name} placeholder={unnamed} onChange={(e) => update({ name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && apply()} />
          </label>
          <label className="form__label">
            Author
            <input className="field" value={draft.author} placeholder="Who made this playlist" onChange={(e) => update({ author: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && apply()} />
          </label>
          <label className="form__label">
            Description
            <textarea className="field form__textarea" rows={5} value={draft.description} onChange={(e) => update({ description: e.target.value })} />
          </label>
        </div>
        <div className="meta__cover">
          <span className="form__label">Cover</span>
          <div className="artpick">
            {coverUrl ? <ArtImage key={coverUrl} className="artpick__image" src={coverUrl} /> : <span className="artpick__none">No cover</span>}
          </div>
          <div className="artpick__actions">
            <button className="button button--quiet" type="button" disabled={Boolean(busy)} onClick={chooseCover}>
              Choose…
            </button>
            <button className="button button--quiet" type="button" disabled={!draft.cover} onClick={() => update({ cover: null })}>
              Remove
            </button>
          </div>
        </div>
      </div>
      <p className="modal__text modal__text--muted form__note">
        Saved inside the playlist, cover included, so they travel with it.
      </p>
    </Modal>
  );
}

// --- Colors (Playlist ▸ Colors…) ---------------------------------------------

const COLOR_ROLES = [
  { role: 'primary', label: 'Primary', hint: 'Background: window, panels, menus' },
  { role: 'secondary', label: 'Secondary', hint: 'Accent: buttons, selected rows, active tab' },
  { role: 'tertiary', label: 'Tertiary', hint: 'Highlight: group names, seek bar, transport' },
];

/** One colour: the native picker, and its hex to type or paste. */
function ColorField({ label, hint, value, used, autoFocus, onChange, onEnter }) {
  const [text, setText] = useState(value);
  // Keep what's being typed ("#abc") unless the colour really changed elsewhere.
  useEffect(() => {
    if (parseHex(text) !== value) setText(value);
  }, [value]);
  const type = (next) => {
    setText(next);
    const parsed = parseHex(next);
    if (parsed) onChange(parsed);
  };
  return (
    <div className="colors__row">
      <input className="colors__swatch" type="color" value={value} aria-label={`${label} colour`} onChange={(e) => type(e.target.value)} />
      <span className="colors__role">
        {label}
        <span className="colors__hint">{hint}</span>
        {used !== value && <span className="colors__note">Shown as {used}, to stay readable</span>}
      </span>
      <input
        className={`field colors__hex${parseHex(text) ? '' : ' colors__hex--bad'}`}
        data-autofocus={autoFocus ? true : undefined}
        value={text}
        spellCheck={false}
        aria-label={`${label} hex`}
        onChange={(e) => type(e.target.value)}
        onBlur={() => setText(value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter()}
      />
    </div>
  );
}

function PaletteChips({ palette }) {
  return (
    <span className="preset__chips" aria-hidden="true">
      {COLOR_ROLES.map(({ role }) => (
        <span key={role} className="preset__chip" style={{ background: palette[role] }} />
      ))}
    </span>
  );
}

function ColorsDialog() {
  const playlist = viewedPlaylist(useSyncExternalStore(store.subscribe, store.getState));
  // null: this playlist uses the default colours.
  const [draft, setDraft] = useState(() => normalizePalette(playlist.doc.palette));
  const [suggestion, setSuggestion] = useState(null);
  const colors = draft ?? DEFAULT_PALETTE;
  const { mode, used } = deriveTheme(colors);
  const artUrl = actions.paletteArtUrl(playlist);

  // The whole app is the preview; Cancel just lets go of it.
  useEffect(() => ui.setPalettePreview(colors), [colors]);
  useEffect(() => () => ui.setPalettePreview(null), []);

  const choose = (palette) => {
    setDraft(palette);
    setSuggestion(null);
  };
  const apply = () => {
    store.setPalette(playlist.id, draft);
    ui.closeDialog();
  };
  // Each click moves to the next reading of the art.
  const suggest = async () => {
    const list = suggestion?.list ?? (await actions.suggestFromArt(artUrl));
    if (!list.length) return setSuggestion({ list, index: -1 });
    const index = suggestion ? (suggestion.index + 1) % list.length : 0;
    setDraft(list[index]);
    setSuggestion({ list, index });
  };

  const message = !suggestion
    ? `A ${mode} theme.`
    : suggestion.index < 0
      ? 'That art couldn’t be read.'
      : `Suggestion ${suggestion.index + 1} of ${suggestion.list.length}. Click again for another.`;

  return (
    <Modal
      title="Playlist colors"
      preview
      footer={
        <>
          <span className="modal__message">{message}</span>
          <button className="button button--quiet" type="button" onClick={ui.closeDialog}>
            Cancel
          </button>
          <button className="button" type="button" onClick={apply}>
            Apply
          </button>
        </>
      }
    >
      <div className="colors">
        {COLOR_ROLES.map(({ role, label, hint }, i) => (
          <ColorField
            key={role}
            label={label}
            hint={hint}
            value={colors[role]}
            used={used[role]}
            autoFocus={i === 0}
            onChange={(value) => choose({ ...colors, [role]: value })}
            onEnter={apply}
          />
        ))}
      </div>
      <h3 className="modal__section">Start from</h3>
      <div className="presets">
        {PALETTE_PRESETS.map(({ name, palette }) => (
          <button key={name} className={`preset${samePalette(palette, colors) ? ' preset--on' : ''}`} type="button" onClick={() => choose(palette === DEFAULT_PALETTE ? null : palette)}>
            <PaletteChips palette={palette} />
            {name}
          </button>
        ))}
      </div>
      <p className="artpick__actions form__note">
        <button className="button button--quiet" type="button" disabled={!artUrl} title={artUrl ? undefined : 'This playlist has no art yet'} onClick={suggest}>
          Suggest from Art
        </button>
      </p>
      <p className="modal__text modal__text--muted form__note">
        Saved inside the playlist, so they travel with it. Beachday only shifts a colour if text wouldn’t be readable on it.
      </p>
    </Modal>
  );
}

// --- Gain (Track ▸ Adjust Gain…) ---------------------------------------------

function GainDialog() {
  const { dialogArgs } = ui.useUi();
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const playlist = state.playlists[dialogArgs.playlistId];
  const ids = new Set(dialogArgs.ids);
  const tracks = (playlist?.doc.tracks ?? []).filter((track) => ids.has(track.id));
  const gains = tracks.map(trackGainDb);
  const mixed = gains.some((gain) => gain !== gains[0]);
  const [text, setText] = useState(() => String(gains[0] ?? 0));
  const parsed = Number.parseFloat(text.replace('−', '-').replace('+', ''));
  const valid = Number.isFinite(parsed);
  const db = valid ? clampGain(parsed) : null;

  // Hear it on the playing track before applying.
  const playingId = state.playingId === dialogArgs.playlistId ? player.getState().current?.id : null;
  const previewId = playingId && ids.has(playingId) ? playingId : null;
  useEffect(() => {
    if (previewId && db != null) player.previewGain(previewId, db);
  }, [previewId, db]);
  useEffect(() => () => previewId && player.previewGain(previewId, null), [previewId]);

  const apply = () => {
    if (db == null) return;
    store.setTrackGain(playlist.id, dialogArgs.ids, db);
    ui.closeDialog();
  };
  const reset = () => {
    store.setTrackGain(playlist.id, dialogArgs.ids, null);
    ui.closeDialog();
  };

  const [single] = tracks;
  const seedNote =
    tracks.length === 1
      ? single.tags.replayGainDb != null
        ? `ReplayGain says ${formatGain(seedGainDb(single))} for this track; that’s where it starts.`
        : 'This file has no ReplayGain tag, so it starts at 0 dB.'
      : 'Each track starts at its ReplayGain value (or 0 dB without one).';

  return (
    <Modal
      title={tracks.length === 1 ? `Gain: ${single.overrides.title || single.tags.title}` : `Gain for ${tracks.length} tracks`}
      footer={
        <>
          <button className="button button--quiet" type="button" onClick={reset}>
            Reset to ReplayGain
          </button>
          <span className="modal__spacer" />
          <button className="button button--quiet" type="button" onClick={ui.closeDialog}>
            Cancel
          </button>
          <button className="button" type="button" disabled={db == null} onClick={apply}>
            Apply
          </button>
        </>
      }
    >
      <div className="gain">
        <input
          className="gain__slider"
          type="range"
          min={GAIN_MIN_DB}
          max={GAIN_MAX_DB}
          step={0.5}
          value={db ?? 0}
          aria-label="Gain in dB"
          onChange={(e) => setText(e.target.value)}
        />
        <label className="gain__value">
          <input
            className="field gain__field"
            data-autofocus
            value={text}
            inputMode="decimal"
            aria-label="Gain in dB"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
          />
          dB
        </label>
      </div>
      {valid && parsed > GAIN_MAX_DB && <p className="modal__text">Boosts stop at +{GAIN_MAX_DB} dB, past which the limiter can’t keep them clean.</p>}
      {mixed && <p className="modal__text">These tracks have different gains now. Apply sets them all to this.</p>}
      <p className="modal__text modal__text--muted">
        {seedNote} {previewId ? 'You’re hearing the change on the playing track.' : ''}
      </p>
    </Modal>
  );
}

// --- Grouping template (Playlist ▸ Grouping ▸ Custom…) -----------------------

/** A token list that inserts into whichever template field was focused last. */
function TokenHelp({ onInsert }) {
  return (
    <p className="tokens">
      {TOKENS.map((token) => (
        <button key={token} className="tokens__token" type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => onInsert(`%${token}%`)}>
          %{token}%
        </button>
      ))}
    </p>
  );
}

/**
 * Insert text at the caret of the template field being edited. Token buttons
 * don't take focus, so that's normally the focused field; `lastField` covers
 * focus having moved elsewhere since.
 */
function insertAtCaret(lastField, setValue, text) {
  const active = document.activeElement;
  const input = active?.matches?.('.modal input[name]') ? active : lastField.current;
  if (!input) return;
  const { selectionStart = input.value.length, selectionEnd = input.value.length } = input;
  const value = input.value.slice(0, selectionStart) + text + input.value.slice(selectionEnd);
  setValue(input.name, value);
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(selectionStart + text.length, selectionStart + text.length);
  });
}

const PREVIEW_GROUPS = 3;

function GroupingDialog() {
  const playlist = viewedPlaylist(useSyncExternalStore(store.subscribe, store.getState));
  const fromTemplate = (template) => ({
    groupKey: template.groupKey,
    mainName: template.mainName,
    sub0: template.subNames[0] ?? '',
    sub1: template.subNames[1] ?? '',
  });
  const [draft, setDraft] = useState(() => fromTemplate(playlist.doc.grouping ?? PRESETS.album));
  const lastField = useRef(null);
  const setField = (name, value) => setDraft((current) => ({ ...current, [name]: value }));
  const template = {
    groupKey: draft.groupKey,
    mainName: draft.mainName,
    subNames: [draft.sub0, draft.sub1].slice(0, SUB_LINES).filter((line, i, all) => line || all.slice(i + 1).some(Boolean)),
  };
  const layout = buildLayout({ ...playlist.doc, grouping: template }, playlist.resolution, new Set());

  const apply = () => {
    store.setGroupingTemplate(playlist.id, template);
    ui.closeDialog();
  };

  const field = (name, label, hint) => (
    <label className="form__label">
      {label}
      <input
        className="field form__mono"
        name={name}
        value={draft[name]}
        placeholder={hint}
        spellCheck={false}
        data-autofocus={name === 'groupKey' ? true : undefined}
        onFocus={(e) => (lastField.current = e.currentTarget)}
        onChange={(e) => setField(name, e.target.value)}
      />
    </label>
  );

  return (
    <Modal
      title="Custom grouping"
      wide
      footer={
        <>
          <span className="modal__message">Start from:</span>
          <button className="button button--quiet" type="button" onClick={() => setDraft(fromTemplate(PRESETS.album))}>
            By Album
          </button>
          <button className="button button--quiet" type="button" onClick={() => setDraft(fromTemplate(PRESETS.artist))}>
            By Artist
          </button>
          <span className="modal__spacer" />
          <button className="button button--quiet" type="button" onClick={ui.closeDialog}>
            Cancel
          </button>
          <button className="button" type="button" onClick={apply}>
            Apply
          </button>
        </>
      }
    >
      <p className="modal__text">
        Tracks whose <strong>Group by</strong> line comes out the same share a group. The other lines are
        the group’s header. Click a token to add it. A segment between “ | ” that comes out empty is left out.
      </p>
      <div className="form">
        {field('groupKey', 'Group by', 'Empty: every track in one group')}
        {field('mainName', 'Header', '%album%')}
        {field('sub0', 'Second line', '%albumartist%')}
        {field('sub1', 'Third line', '%tracks% | Time: %duration%')}
      </div>
      <TokenHelp onInsert={(text) => insertAtCaret(lastField, setField, text)} />
      <h3 className="modal__section">
        Preview · {layout.groups.length} {layout.groups.length === 1 ? 'group' : 'groups'}
      </h3>
      <div className="grouppreview">
        {layout.groups.slice(0, PREVIEW_GROUPS).map((group) => (
          <GroupHeader key={group.key} group={group} />
        ))}
        {layout.groups.length === 0 && <p className="modal__text modal__text--muted">This playlist has no tracks yet.</p>}
      </div>
    </Modal>
  );
}

// --- Edit Groups (Playlist ▸ Edit Groups…, a header's Edit Group…) ------------

function GroupsDialog() {
  const { dialogArgs, busy } = ui.useUi();
  const playlist = viewedPlaylist(useSyncExternalStore(store.subscribe, store.getState));
  const [edits, setEdits] = useState(() => new Map());
  const [selectedKey, setSelectedKey] = useState(dialogArgs?.key ?? null);
  const lastField = useRef(null);
  const doc = playlist.doc;
  const draftDoc = applyGroupEdits(doc, edits);
  const layout = buildLayout(draftDoc, playlist.resolution, new Set());
  const groups = layout.groups ?? [];
  const group = groups.find((g) => g.key === selectedKey) ?? groups[0];

  // Each line's placeholder is what it shows without an override.
  const plainDoc = { ...draftDoc, groups: draftDoc.groups.map(({ mainName, subNames, ...rest }) => (rest.custom ? { ...rest, mainName } : rest)) };
  const plain = buildLayout(plainDoc, playlist.resolution, new Set()).groups?.find((g) => g.key === group?.key);

  if (!group) {
    return (
      <Modal title="Edit groups" footer={<button className="button" type="button" onClick={ui.closeDialog}>Close</button>}>
        <p className="modal__text">Turn on grouping (Playlist ▸ Grouping) to edit groups.</p>
      </Modal>
    );
  }

  const entry = draftDoc.groups.find((g) => g.key === group.key) ?? { key: group.key };
  const patch = (fields) => setEdits((current) => new Map(current).set(group.key, { ...current.get(group.key), ...fields }));
  const subNames = Array.from({ length: SUB_LINES }, (_, i) => entry.subNames?.[i] ?? '');
  const setSub = (i, value) => patch({ subNames: subNames.map((line, j) => (j === i ? value : line)) });
  const setByName = (name, value) => (name === 'mainName' ? patch({ mainName: value }) : setSub(Number(name.slice(3)), value));
  const explicitArt = artRefUrl(entry.art);

  const chooseArt = async () => {
    const ref = await actions.pickArt('Choose group art');
    if (ref) patch({ art: ref });
  };

  const apply = () => {
    if (edits.size) store.editGroups(playlist.id, edits);
    ui.closeDialog();
  };

  return (
    <Modal
      title="Edit groups"
      wide
      className="modal__panel--groups"
      footer={
        <>
          {group.custom && (
            <button className="button button--quiet" type="button" title="Its tracks go back to the groups their tags give them" onClick={() => patch({ dissolve: true })}>
              Dissolve Group
            </button>
          )}
          <span className="modal__spacer" />
          <button className="button button--quiet" type="button" onClick={ui.closeDialog}>
            Cancel
          </button>
          <button className="button" type="button" disabled={Boolean(busy)} onClick={apply}>
            Apply
          </button>
        </>
      }
    >
      <div className="groupedit">
        <ul className="groupedit__list" role="listbox" aria-label="Groups">
          {groups.map((g) => (
            <li
              key={g.key}
              role="option"
              aria-selected={g === group}
              className={`groupedit__item${g === group ? ' groupedit__item--selected' : ''}`}
              onClick={() => setSelectedKey(g.key)}
            >
              <span className="groupedit__names">
                <span className="groupedit__name">{g.mainName}</span>
                {g.subNames[0] && <span className="groupedit__sub">{g.subNames[0]}</span>}
              </span>
              <span className="groupedit__count">
                {g.custom ? 'custom · ' : ''}
                {g.trackIds.length}
              </span>
            </li>
          ))}
        </ul>
        <div className="groupedit__form" key={group.key}>
          <div className="grouppreview">
            <GroupHeader group={group} />
          </div>
          <div className="form">
            <label className="form__label">
              Header
              <input
                className="field"
                name="mainName"
                data-autofocus={dialogArgs?.focusName ? true : undefined}
                value={entry.mainName ?? ''}
                placeholder={plain?.mainName}
                spellCheck={false}
                onFocus={(e) => (lastField.current = e.currentTarget)}
                onChange={(e) => patch({ mainName: e.target.value })}
              />
            </label>
            {subNames.map((line, i) => (
              <label key={i} className="form__label">
                {i === 0 ? 'Second line' : 'Third line'}
                <input
                  className="field"
                  name={`sub${i}`}
                  value={line}
                  placeholder={plain?.subNames[i] ?? ''}
                  spellCheck={false}
                  onFocus={(e) => (lastField.current = e.currentTarget)}
                  onChange={(e) => setSub(i, e.target.value)}
                />
              </label>
            ))}
            <TokenHelp onInsert={(text) => insertAtCaret(lastField, setByName, text)} />
            <label className="form__label">
              Description
              <textarea className="field form__textarea" rows={3} value={entry.description ?? ''} onChange={(e) => patch({ description: e.target.value })} />
            </label>
            <div className="form__label">
              Art
              <div className="artpick__row">
                <div className="artpick artpick--small">
                  {explicitArt ? <ArtImage key={explicitArt} className="artpick__image" src={explicitArt} paused /> : <span className="artpick__none">From its tracks</span>}
                </div>
                <button className="button button--quiet" type="button" disabled={Boolean(busy)} onClick={chooseArt}>
                  Choose…
                </button>
                <button className="button button--quiet" type="button" disabled={!entry.art} onClick={() => patch({ art: null })}>
                  Clear
                </button>
              </div>
            </div>
          </div>
          <p className="modal__text modal__text--muted form__note">Empty lines show what the grouping gives them (in grey).</p>
        </div>
      </div>
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
