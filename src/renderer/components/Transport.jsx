import { useRef, useState } from 'react';
import { player } from '../audio/engine.js';
import { usePlayer, usePlaybackPosition } from '../audio/usePlayer.js';
import { formatTime } from '../format.js';
import { runCommand } from '../menus/commands.js';

const SEEK_STEP_S = 5;

/**
 * The bottom bar, laid out after the reference foobar2000 skin: now-playing
 * text on the left, round transport buttons centred, time and volume on the
 * right, and a full-width seek bar underneath.
 *
 * The playback-order (shuffle) button arrives with Phase 8.
 */
export default function Transport() {
  const { current: track, status, duration, volume, muted, error } = usePlayer();
  const isPlaying = status === 'playing';

  return (
    <footer className="transport">
      <div className="transport__row">
        <div className="transport__now" title={track ? [track.album, track.title].filter(Boolean).join(' — ') : undefined}>
          {error ? (
            <span className="transport__error">{error.message}</span>
          ) : track ? (
            <>
              {(track.album ?? track.artist) && (
                <span className="transport__album">{track.album ?? track.artist}</span>
              )}
              <span className="transport__title">{track.title}</span>
            </>
          ) : (
            <span className="transport__idle">Nothing playing</span>
          )}
        </div>

        <div className="transport__controls">
          <TransportButton label="Previous" onClick={() => player.previous()}>
            <path d="M3 2h1.6v10H3zM12 2v10L5.5 7z" />
          </TransportButton>
          <TransportButton
            label={isPlaying ? 'Pause' : 'Play'}
            large
            onClick={() => runCommand('playback.playPause')}
          >
            {isPlaying ? <path d="M3.5 2h2.4v10H3.5zM8.1 2h2.4v10H8.1z" /> : <path d="M4 1.8v10.4L12 7z" />}
          </TransportButton>
          <TransportButton label="Stop" onClick={() => player.stop()}>
            <path d="M3 3h8v8H3z" />
          </TransportButton>
          <TransportButton label="Next" onClick={() => player.next()}>
            <path d="M9.4 2H11v10H9.4zM2 2v10l6.5-5z" />
          </TransportButton>
        </div>

        <div className="transport__right">
          <Volume volume={volume} muted={muted} />
          <Clock duration={duration} hasTrack={Boolean(track)} />
        </div>
      </div>

      <SeekBar duration={duration} disabled={!track || status === 'empty'} />
    </footer>
  );
}

function TransportButton({ label, large = false, onClick, children }) {
  return (
    <button
      className={`transport__button${large ? ' transport__button--large' : ''}`}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg viewBox="0 0 14 14" aria-hidden="true">
        <g fill="currentColor">{children}</g>
      </svg>
    </button>
  );
}

/** Elapsed / total. Click to switch between elapsed and remaining. */
function Clock({ duration, hasTrack }) {
  const position = usePlaybackPosition();
  const [showRemaining, setShowRemaining] = useState(false);

  if (!hasTrack) return <span className="transport__clock transport__clock--idle">0:00</span>;

  return (
    <button
      className="transport__clock"
      type="button"
      title={showRemaining ? 'Show elapsed time' : 'Show remaining time'}
      onClick={() => setShowRemaining((value) => !value)}
    >
      <span className="transport__clock-now">
        {showRemaining ? `-${formatTime(duration - position)}` : formatTime(position)}
      </span>
      <span className="transport__clock-total">{formatTime(duration)}</span>
    </button>
  );
}

function Volume({ volume, muted }) {
  return (
    <div className="volume">
      <button
        className="volume__mute"
        type="button"
        aria-label={muted ? 'Unmute' : 'Mute'}
        title={muted ? 'Unmute' : 'Mute'}
        onClick={() => player.toggleMute()}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="M1.5 5h2.5l3.5-3v10L4 9H1.5z" fill="currentColor" />
          {muted ? (
            <path d="M9.5 5l3 4M12.5 5l-3 4" stroke="currentColor" strokeWidth="1.3" fill="none" />
          ) : (
            <path
              d="M9.3 4.6a3.4 3.4 0 010 4.8M10.9 3a5.6 5.6 0 010 8"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
              opacity={volume > 0 ? 1 : 0.35}
            />
          )}
        </svg>
      </button>
      <input
        className="volume__slider"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={muted ? 0 : volume}
        aria-label="Volume"
        style={{ '--fill': `${(muted ? 0 : volume) * 100}%` }}
        onChange={(event) => player.setVolume(Number(event.target.value))}
      />
    </div>
  );
}

/**
 * Full-width seek bar. Dragging previews the position and seeks on release,
 * so a drag doesn't fire dozens of seeks into the media pipeline.
 */
function SeekBar({ duration, disabled }) {
  const position = usePlaybackPosition();
  const barRef = useRef(null);
  const [dragPosition, setDragPosition] = useState(null);

  const shown = dragPosition ?? position;
  const fraction = duration > 0 ? Math.min(shown / duration, 1) : 0;

  const positionAt = (clientX) => {
    const rect = barRef.current.getBoundingClientRect();
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * duration;
  };

  const onPointerDown = (event) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragPosition(positionAt(event.clientX));
  };

  const onPointerMove = (event) => {
    if (dragPosition !== null) setDragPosition(positionAt(event.clientX));
  };

  const onPointerUp = (event) => {
    if (dragPosition === null) return;
    player.seek(positionAt(event.clientX));
    setDragPosition(null);
  };

  const onKeyDown = (event) => {
    if (disabled) return;
    const step = { ArrowLeft: -SEEK_STEP_S, ArrowRight: SEEK_STEP_S }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    player.seek(player.getPosition() + step);
  };

  return (
    <div
      ref={barRef}
      className={`seekbar${disabled ? ' seekbar--disabled' : ''}${dragPosition !== null ? ' seekbar--dragging' : ''}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={formatTime(shown)}
      aria-disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDragPosition(null)}
      onKeyDown={onKeyDown}
    >
      <div className="seekbar__track">
        <div className="seekbar__fill" style={{ width: `${fraction * 100}%` }} />
        <div className="seekbar__handle" style={{ left: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}
