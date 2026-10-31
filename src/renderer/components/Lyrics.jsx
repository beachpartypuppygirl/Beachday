import { useEffect, useRef, useState } from 'react';
import { player } from '../audio/engine.js';
import { useUi } from '../store/ui.js';
import { useLyrics } from '../store/lyrics.js';
import { lineAt } from '../store/lrc.js';

/**
 * Lyrics in the art pane (PLAN.md §5 "Art pane"): the current line of synced
 * lyrics highlighted and kept centred, or a block to scroll for plain ones.
 *
 * `overArt`: drawn over the art, where text can't rely on the theme. With no
 * lyrics that shows nothing at all, so the art is simply the art.
 */

const POLL_MS = 100;
/** After scrolling by hand, how long the view stays put before following the song again. */
const HAND_SCROLL_MS = 4000;

const MESSAGES = {
  loading: 'Looking for lyrics…',
  instrumental: 'Instrumental',
  unavailable: 'Couldn’t reach the lyrics service. Beachday will try again later.',
};

/** Which line is current. Polled, not per frame: lines change every few seconds at most. */
function useActiveLine(lines, synced) {
  const [active, setActive] = useState(-1);
  useEffect(() => {
    if (!synced) return setActive(-1);
    const update = () => setActive(lineAt(lines, player.getPosition()));
    update();
    const timer = setInterval(update, POLL_MS);
    return () => clearInterval(timer);
  }, [lines, synced]);
  return active;
}

export default function Lyrics({ track, overArt = false }) {
  const { status, synced, lines } = useLyrics(track);
  const { fetchLyrics, dimLyricsArt } = useUi();
  const active = useActiveLine(lines, synced);
  const scroller = useRef(null);
  const handScrolledAt = useRef(-Infinity);

  useEffect(() => {
    const box = scroller.current;
    const line = box?.children[active];
    if (!line || performance.now() - handScrolledAt.current < HAND_SCROLL_MS) return;
    box.scrollTop = line.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2;
  }, [active]);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [track.id]);

  if (lines.length === 0) {
    if (overArt) return null;
    const message = MESSAGES[status] ?? (fetchLyrics ? 'No lyrics found' : 'No lyrics yet. Use Track ▸ Fetch Lyrics, or turn on Options ▸ Fetch Lyrics Automatically.');
    return <p className="lyrics__message">{message}</p>;
  }

  return (
    <>
      {overArt && dimLyricsArt && <div className="lyrics__dim" />}
      <div
        className={`lyrics${overArt ? ' lyrics--over' : ''}${synced ? ' lyrics--synced' : ''}`}
        ref={scroller}
        data-synced={synced}
        data-active={active}
        onWheel={() => (handScrolledAt.current = performance.now())}
      >
        {lines.map((line, i) => (
          <p key={i} className={`lyrics__line${i === active ? ' lyrics__line--active' : ''}`}>
            {line.text || ' '}
          </p>
        ))}
      </div>
    </>
  );
}
