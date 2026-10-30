import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useUi } from '../store/ui.js';
import { isGifUrl } from '../store/art.js';

/**
 * An art image: the art pane and group thumbnails both draw through this.
 *
 * Still images are a plain <img>. GIFs are played here, frame by frame onto a
 * canvas with Chromium's ImageDecoder (WebCodecs), because an <img> can't
 * pause an animation. That makes pausing real: the GIF holds its frame and
 * carries on from it. As a bonus, only the frame on screen is ever decoded,
 * where an <img> would keep every decoded frame in memory.
 *
 * A GIF pauses when
 *   - the window is unfocused (Options ▸ Pause GIFs When Window Is Unfocused), or
 *   - the caller says so: the art pane pauses with playback
 *     (Options ▸ Pause GIFs When Playback Pauses).
 *
 * `fallback` renders instead if the image fails to load or decode (say, a
 * cache entry that was cleared), so the art chain still ends in the generated symbol.
 */

const subscribeFocus = (callback) => {
  window.addEventListener('focus', callback);
  window.addEventListener('blur', callback);
  return () => {
    window.removeEventListener('focus', callback);
    window.removeEventListener('blur', callback);
  };
};
export const useWindowFocused = () => useSyncExternalStore(subscribeFocus, () => document.hasFocus());

export default function ArtImage({ src, className, fallback = null, paused = false }) {
  const { pauseGifs } = useUi();
  const focused = useWindowFocused();
  const [failed, setFailed] = useState(null);

  if (failed === src) return fallback;
  if (isGifUrl(src)) {
    return (
      <AnimatedGif
        key={src}
        src={src}
        className={className}
        paused={paused || (pauseGifs && !focused)}
        onError={() => setFailed(src)}
      />
    );
  }
  return <img className={className} src={src} alt="" draggable={false} onError={() => setFailed(src)} />;
}

/** Browsers show a GIF delay of 10ms or less as 100ms; so do we, or some GIFs would race. */
const frameDelay = (durationMicros) => {
  const ms = (durationMicros ?? 0) / 1000;
  return ms <= 10 ? 100 : ms;
};

function AnimatedGif({ src, className, paused, onError }) {
  const canvasRef = useRef(null);
  const playback = useRef(null);
  const reportError = useRef(onError);
  reportError.current = onError;

  // One decoder per src (the component is keyed by it).
  useEffect(() => {
    const canvas = canvasRef.current;
    // busy: a frame is decoding, or its delay is running. One chain of ticks at a time.
    const state = { decoder: null, index: 0, count: 1, loops: 0, repeat: 0, timer: null, busy: false, paused: false, closed: false };
    playback.current = state;

    const draw = async () => {
      const { image } = await state.decoder.decode({ frameIndex: state.index });
      if (state.closed) return image.close();
      if (canvas.width !== image.displayWidth || canvas.height !== image.displayHeight) {
        canvas.width = image.displayWidth;
        canvas.height = image.displayHeight;
      }
      canvas.getContext('2d').drawImage(image, 0, 0);
      canvas.dataset.frame = String(state.index);
      const delay = frameDelay(image.duration);
      image.close();
      return delay;
    };

    // Show the current frame, then wait its delay and step on, unless paused.
    const tick = async () => {
      state.timer = null;
      state.busy = true;
      try {
        const delay = await draw();
        if (state.closed || state.paused || state.count < 2) return (state.busy = false);
        state.timer = setTimeout(() => {
          if (state.index + 1 < state.count) state.index++;
          else if (state.loops < state.repeat) {
            state.index = 0;
            state.loops++;
          } else return (state.busy = false); // played its loops out: rest on the last frame
          tick();
        }, delay);
      } catch {
        state.busy = false;
        if (!state.closed) reportError.current();
      }
    };
    state.resume = () => {
      if (!state.busy && !state.closed) tick();
    };

    (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state.decoder = new ImageDecoder({ data: response.body, type: 'image/gif' });
        await state.decoder.completed;
        if (state.closed) return;
        const track = state.decoder.tracks.selectedTrack;
        state.count = track.frameCount;
        state.repeat = track.repetitionCount; // Infinity: loop forever
        tick();
      } catch {
        if (!state.closed) reportError.current();
      }
    })();

    return () => {
      state.closed = true;
      clearTimeout(state.timer);
      state.decoder?.close();
    };
  }, [src]);

  // Pause and resume without losing our place.
  useEffect(() => {
    const state = playback.current;
    state.paused = paused;
    if (paused) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
        state.busy = false;
      }
      // Mid-decode, the tick sees state.paused and stops by itself.
    } else if (state.decoder) {
      state.resume();
    }
  }, [paused]);

  return <canvas ref={canvasRef} className={className} data-src={src} data-gif={paused ? 'paused' : 'playing'} />;
}
