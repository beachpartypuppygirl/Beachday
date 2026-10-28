import { useEffect, useState, useSyncExternalStore } from 'react';
import { player } from './engine.js';

/** Discrete player state (queue, index, status, volume...). Re-renders on change. */
export function usePlayer() {
  return useSyncExternalStore(player.subscribe, player.getState);
}

/**
 * Playback position in seconds, sampled every animation frame. <audio>'s own
 * 'timeupdate' fires only ~4 times a second, which makes a progress bar step.
 * React skips the re-render when the value hasn't changed (paused, stopped).
 */
export function usePlaybackPosition() {
  const [position, setPosition] = useState(0);

  useEffect(() => {
    let frame;
    const tick = () => {
      setPosition(player.getPosition());
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);

  return position;
}
