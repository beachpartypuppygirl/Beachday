/**
 * Beachday audio engine (PLAN.md §3 "Audio graph", §5 "Inter-track gap").
 *
 *   deck A <audio> -> MediaElementSource -> trackGain A ┐
 *   deck B <audio> -> MediaElementSource -> trackGain B ┴-> masterGain -> limiter -> trim -> out
 *
 * Two decks, not one: during the final PRELOAD_WINDOW_S of the current track
 * the next one loads into the idle deck, and on 'ended' the decks swap. That
 * takes the inter-track gap from 200-500ms (swapping src) to ~20-100ms.
 *
 * Each deck has its own trackGain so the preloaded track's per-track dB is
 * already in place when it starts, without touching the one still playing.
 *
 * <audio> streams the file; decodeAudioData would hold the whole decoded PCM
 * in memory (~250MB for a 40MB FLAC).
 *
 * Order and repeat (Phase 8, PLAN.md §5): sequential follows the queue;
 * shuffle walks a permutation of units (chains and single tracks, see
 * sequence.js) with a cursor. Repeat Off stops at the end, All goes round
 * again (reshuffled), One replays the track when it ends. Next and Previous
 * always move, whatever the repeat mode.
 *
 * The engine is plain JS with no React dependency. UI reads it through
 * subscribe()/getState() (see usePlayer.js); playback position is polled with
 * getPosition() rather than pushed, so the progress bar can animate per frame
 * without re-rendering everything that reads state.
 */

import { symbolPng } from '../symbols.js';
import { bringForward, reconcileShuffle, shuffleQueue, unitIdsOf } from './sequence.js';

const PRELOAD_WINDOW_S = 10;
// Pressing Previous this far into a track restarts it instead.
const RESTART_THRESHOLD_S = 3;

// Limiter: clip protection for per-track gain boosts. Inaudible below the
// threshold. Chromium applies the Web Audio spec's automatic makeup gain,
// (1 / fullRangeGain)^0.6, which would lift everything ~0.57dB and push
// near-peak audio past 0dBFS. `trim` cancels it so the bus is unity gain below
// threshold. Measured: +12dB of boost into this chain peaks at -0.09dBFS.
const LIMITER = { threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.25 };
const MAKEUP_DB = -0.6 * LIMITER.threshold * (1 - 1 / LIMITER.ratio);

const VOLUME_KEY = 'beachday.volume';
const ORDER_KEY = 'beachday.order';
const REPEAT_KEY = 'beachday.repeat';
// Ramp time constant for volume changes; avoids zipper noise while dragging.
const VOLUME_SMOOTHING_S = 0.015;

export const dbToGain = (db) => Math.pow(10, db / 20);

// Slider position -> gain. Squaring roughly matches perceived loudness, so the
// bottom half of the slider isn't nearly silent and the top half all the same.
const volumeToGain = (volume) => volume * volume;

/**
 * Sequential order: which queue index plays after `index`, or -1 at the end.
 * Missing tracks (no URL) are skipped. Shuffle walks its own list instead.
 */
function nextIndex(index, queue) {
  for (let i = index + 1; i < queue.length; i++) if (queue[i].url) return i;
  return -1;
}

function previousIndex(index, queue) {
  for (let i = index - 1; i >= 0; i--) if (queue[i].url) return i;
  return -1;
}

class Deck {
  constructor(context, destination) {
    this.element = new Audio();
    // Required for Web Audio to receive samples from beachday-media:// (see media.mjs).
    this.element.crossOrigin = 'anonymous';
    this.element.preload = 'auto';
    this.gain = context.createGain();
    context.createMediaElementSource(this.element).connect(this.gain).connect(destination);
    /**
     * The track loaded into this deck. Identity, not queue position: the
     * playlist can be edited while a track is preloaded, and positions shift.
     */
    this.trackId = null;
    this.url = null;
    /**
     * Bumped on every load. Async results (a play() rejection) carry the value
     * they started with, so a failure report from a previous load can't be
     * pinned on whatever the deck holds now.
     */
    this.loadId = 0;
  }

  holds(track) {
    return Boolean(track) && this.trackId === track.id && this.url === track.url;
  }

  load(track) {
    this.trackId = track.id;
    this.url = track.url;
    this.loadId += 1;
    this.gainDb = track.gainDb ?? 0;
    this.gain.gain.value = dbToGain(this.gainDb);
    this.element.src = track.url;
    this.element.load();
  }

  /** Change the gain of what's loaded, mid-play: ramped, so there's no click. */
  setGain(db) {
    this.gainDb = db;
    const { context } = this.gain;
    this.gain.gain.cancelScheduledValues(context.currentTime);
    this.gain.gain.setTargetAtTime(dbToGain(db), context.currentTime, VOLUME_SMOOTHING_S);
  }

  clear() {
    this.trackId = null;
    this.url = null;
    this.loadId += 1;
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
  }
}

class Player {
  #listeners = new Set();
  #state = {
    queue: [],
    /** Index of the current track in the queue, or -1 (none, or detached — see below). */
    index: -1,
    /** The track loaded for playback, even if it has since left the queue. */
    current: null,
    /**
     * When the current track is removed from its playlist it keeps playing,
     * "detached": index is -1 and this is the queue position it occupied, so
     * Next plays whatever now sits there. null while attached.
     */
    detachedAt: null,
    /** 'empty' | 'stopped' | 'playing' | 'paused' */
    status: 'empty',
    duration: 0,
    volume: loadVolume(),
    muted: false,
    /** { index, message } for the most recent track that failed to play */
    error: null,
    /** Playback ▸ Order: 'sequential' | 'shuffle' */
    order: loadSetting(ORDER_KEY, ['sequential', 'shuffle']),
    /** Playback ▸ Repeat: 'off' | 'all' | 'one' */
    repeat: loadSetting(REPEAT_KEY, ['off', 'all', 'one']),
    /** Playback ▸ Stop After Current: stop when this track ends (then it switches itself off) */
    stopAfterCurrent: false,
  };

  /**
   * Shuffle: track ids in play order, and the cursor into them: the current
   * track's position, or a half-step between two when there's none (see
   * sequence.js reconcileShuffle). Only meaningful while order is 'shuffle'.
   */
  #shuffled = [];
  #shufflePos = -0.5;

  #context = null;
  #masterGain = null;
  /** @type {Deck} */ #active = null;
  /** @type {Deck} */ #idle = null;
  #teardown = [];

  // --- Subscription (arrow fields so they can be passed unbound) ----------

  subscribe = (listener) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getState = () => this.#state;

  /** Current playback position in seconds. Cheap; safe to call every frame. */
  getPosition = () => this.#active?.element.currentTime ?? 0;

  // --- Queue --------------------------------------------------------------

  /**
   * Replace the queue: { id, url, title, gainDb?, ... } per track, url null
   * when missing. The store calls this whenever the playing playlist changes.
   * The current track keeps playing and keeps its place, found by id.
   */
  setQueue(queue) {
    const { current, status } = this.#state;
    const index = current ? queue.findIndex((track) => track.id === current.id) : -1;
    if (this.#state.order === 'shuffle') {
      ({ ids: this.#shuffled, pos: this.#shufflePos } = reconcileShuffle(this.#shuffled, this.#shufflePos, queue, current?.id ?? null));
    }

    // A preload for a track that's no longer queued is wasted; #maybePreload
    // picks the right one on the next timeupdate.
    if (this.#idle && !queue.some((track) => this.#idle.holds(track))) this.#idle.clear();

    if (current && index < 0) {
      // The current track left its playlist (removed, cut, its add undone).
      // Keep playing it; remember where it was so Next carries on from there.
      const previous = this.#state.queue;
      const kept = new Set(queue.map((track) => track.id));
      const was = this.#state.index >= 0 ? this.#state.index : (this.#state.detachedAt ?? previous.length);
      const detachedAt = Math.min(
        previous.slice(0, was).filter((track) => kept.has(track.id)).length,
        queue.length
      );
      this.#set({ queue, index: -1, detachedAt });
      return;
    }

    this.#set({
      queue,
      index,
      current: index >= 0 ? queue[index] : current,
      detachedAt: index >= 0 ? null : this.#state.detachedAt,
      status: status === 'empty' && queue.length ? 'stopped' : status,
    });
    if (index < 0) return;
    const now = queue[index];
    // Renamed, or custom art set (or cleared), while playing: refresh the OS overlay.
    if (now.artUrl !== current.artUrl || now.title !== current.title) this.#updateMediaSession(now);
    // Gain adjusted while playing (or preloaded): it applies straight away.
    if (this.#active?.holds(now) && this.#active.gainDb !== (now.gainDb ?? 0) && this.#previewing?.id !== now.id) {
      this.#active.setGain(now.gainDb ?? 0);
    }
    const preloaded = this.#idle?.trackId && queue.find((track) => this.#idle.holds(track));
    if (preloaded && this.#idle.gainDb !== (preloaded.gainDb ?? 0)) this.#idle.setGain(preloaded.gainDb ?? 0);
  }

  #previewing = null;

  /**
   * Track ▸ Adjust Gain previews on the playing track before it's applied:
   * `db` for track `id` if it's the one playing, or null to go back to its
   * saved gain.
   */
  previewGain(id, db) {
    const { current } = this.#state;
    this.#previewing = db == null ? null : { id };
    if (!this.#active || current?.id !== id || !this.#active.holds(current)) return;
    this.#active.setGain(db ?? current.gainDb ?? 0);
  }

  /** The gain the playing deck applies, in dB (Properties, tests). */
  getAppliedGainDb = () => (this.#active?.trackId ? this.#active.gainDb : null);

  /** Stop and forget everything: the playing playlist is gone. */
  clear() {
    this.#active?.clear();
    this.#idle?.clear();
    this.#set({ queue: [], index: -1, current: null, detachedAt: null, status: 'empty', duration: 0, error: null });
  }

  /** The position Next/Previous count from. */
  #cursor() {
    const { index, detachedAt } = this.#state;
    return index >= 0 ? index : (detachedAt ?? 0) - 0.5;
  }

  // --- Transport ----------------------------------------------------------

  /**
   * Play queue position `index` (a double-click, Enter). While shuffling, its
   * unit moves up to play now (sequence.js bringForward). A pick in the
   * middle of a chain starts there and plays out the rest of the chain, in
   * either order, since a chain's tracks follow each other in both.
   */
  playIndex(index) {
    const { queue, order, current } = this.#state;
    if (index < 0 || index >= queue.length) return;
    if (order === 'shuffle') {
      const unit = unitIdsOf(queue).find((ids) => ids.includes(queue[index].id));
      if (!unit.includes(current?.id)) {
        ({ ids: this.#shuffled, pos: this.#shufflePos } = bringForward(this.#shuffled, this.#shufflePos, unit));
      }
    }
    this.#start(index);
  }

  /** Play from the beginning: the top of the queue, or the start of a fresh shuffle. */
  playFirst() {
    const { queue, order } = this.#state;
    if (order === 'shuffle') {
      this.#shuffled = shuffleQueue(queue);
      this.#shufflePos = -0.5;
    }
    const target = order === 'shuffle' ? this.#shuffleStep(1)?.index ?? -1 : nextIndex(-1, queue);
    if (target >= 0) this.#start(target);
  }

  // --- Order and repeat ---------------------------------------------------

  /** Playback ▸ Order. Turning shuffle on keeps the playing track playing, as the first of a fresh shuffle. */
  setOrder(order) {
    if (order === this.#state.order) return;
    this.#set({ order });
    saveSetting(ORDER_KEY, order);
    if (order === 'shuffle') this.reshuffle();
    this.#idle?.clear(); // A preload chosen for the old order is wrong now.
  }

  setRepeat(repeat) {
    this.#set({ repeat });
    saveSetting(REPEAT_KEY, repeat);
    this.#idle?.clear();
  }

  /** Playback ▸ Reshuffle: a new order for everything, with the playing unit first. */
  reshuffle() {
    const { queue, current, index } = this.#state;
    const playing = index >= 0 ? current.id : null;
    this.#shuffled = shuffleQueue(queue, Math.random, { first: playing });
    this.#shufflePos = playing ? this.#shuffled.indexOf(playing) : -0.5;
    this.#idle?.clear();
  }

  setStopAfterCurrent(stopAfterCurrent) {
    this.#set({ stopAfterCurrent });
    this.#idle?.clear();
  }

  /** The shuffle's play order, as track ids, and where the cursor is (tests). */
  getShuffle = () => ({ ids: [...this.#shuffled], pos: this.#shufflePos });

  togglePlay() {
    const { status, index, queue, current } = this.#state;
    if (status === 'playing') this.pause();
    else if (status === 'paused') this.#resume();
    // Stopped with the track still loaded: play from wherever it was seeked to.
    else if (status === 'stopped' && this.#active?.holds(current)) this.#resume();
    else if (index >= 0) this.#start(index);
    else this.playFirst();
  }

  pause() {
    if (this.#state.status !== 'playing') return;
    this.#active.element.pause();
    this.#set({ status: 'paused' });
  }

  stop() {
    if (!this.#active || this.#state.status === 'empty') return;
    this.#active.element.pause();
    this.#active.element.currentTime = 0;
    this.#idle.clear();
    this.#set({ status: 'stopped' });
  }

  next() {
    const target = this.#nextTarget();
    if (target >= 0) this.#start(target);
  }

  previous() {
    const target =
      this.#state.order === 'shuffle'
        ? (this.#shuffleStep(-1)?.index ?? -1)
        : previousIndex(Math.ceil(this.#cursor()), this.#state.queue);
    if (this.getPosition() > RESTART_THRESHOLD_S || target < 0) this.seek(0);
    else this.#start(target);
  }

  seek(seconds) {
    if (!this.#active?.trackId) return;
    const { duration } = this.#state;
    this.#active.element.currentTime = Math.min(Math.max(seconds, 0), duration || 0);
  }

  // --- Volume -------------------------------------------------------------

  setVolume(volume) {
    const clamped = Math.min(Math.max(volume, 0), 1);
    this.#set({ volume: clamped, muted: false });
    saveVolume(clamped);
    this.#applyVolume();
  }

  toggleMute() {
    this.#set({ muted: !this.#state.muted });
    this.#applyVolume();
  }

  // --- Lifecycle ----------------------------------------------------------

  /** Release audio resources. Used by hot reload; the app never calls it. */
  destroy() {
    this.#teardown.forEach((fn) => fn());
    this.#active?.clear();
    this.#idle?.clear();
    this.#context?.close();
    this.#listeners.clear();
  }

  // --- Internals ----------------------------------------------------------

  #set(patch) {
    this.#state = { ...this.#state, ...patch };
    this.#listeners.forEach((listener) => listener());
  }

  /** The AudioContext is created on first playback, which is a user gesture. */
  #ensureGraph() {
    if (this.#context) return;
    const context = new AudioContext();

    const limiter = context.createDynamicsCompressor();
    for (const [param, value] of Object.entries(LIMITER)) limiter[param].value = value;
    const trim = context.createGain();
    trim.gain.value = dbToGain(-MAKEUP_DB);

    this.#masterGain = context.createGain();
    this.#masterGain.connect(limiter).connect(trim).connect(context.destination);

    this.#context = context;
    this.#active = new Deck(context, this.#masterGain);
    this.#idle = new Deck(context, this.#masterGain);
    for (const deck of [this.#active, this.#idle]) this.#listen(deck);
    this.#applyVolume();
    this.#registerMediaSession();
  }

  #listen(deck) {
    const { element } = deck;
    const onEnded = () => deck === this.#active && this.#advance();
    const onTimeUpdate = () => deck === this.#active && this.#maybePreload();
    const onDuration = () => {
      if (deck === this.#active && Number.isFinite(element.duration)) {
        this.#set({ duration: element.duration });
      }
    };
    const onError = () => deck === this.#active && deck.trackId && this.#fail(this.#state.index);

    element.addEventListener('ended', onEnded);
    element.addEventListener('timeupdate', onTimeUpdate);
    element.addEventListener('durationchange', onDuration);
    element.addEventListener('error', onError);
    this.#teardown.push(() => {
      element.removeEventListener('ended', onEnded);
      element.removeEventListener('timeupdate', onTimeUpdate);
      element.removeEventListener('durationchange', onDuration);
      element.removeEventListener('error', onError);
    });
  }

  /**
   * What plays after the current track, as a queue index, or -1 for nothing.
   * `ended`: the track finished by itself, so Repeat One replays it. With
   * `peek`, nothing changes: a shuffle that would have to start a new cycle
   * says -1 (the preloader just doesn't preload across a reshuffle).
   */
  #nextTarget({ ended = false, peek = false } = {}) {
    const { queue, order, repeat, index, current } = this.#state;
    if (ended && repeat === 'one' && index >= 0 && current.url) return index;
    if (order === 'shuffle') {
      const step = this.#shuffleStep(1);
      if (step) return step.index;
      if (repeat !== 'all' || peek) return -1;
      // A new cycle, which mustn't open with the unit that just finished.
      this.#shuffled = shuffleQueue(queue, Math.random, { notFirst: current?.id });
      this.#shufflePos = -0.5;
      return this.#shuffleStep(1)?.index ?? -1;
    }
    const target = nextIndex(Math.floor(this.#cursor()), queue);
    return target < 0 && repeat === 'all' ? nextIndex(-1, queue) : target;
  }

  /** The next (+1) or previous (-1) playable track in the shuffle: { index, pos }, or null. */
  #shuffleStep(step) {
    const { queue } = this.#state;
    const indexById = new Map(queue.map((track, i) => [track.id, i]));
    const ids = this.#shuffled;
    for (let p = step > 0 ? Math.floor(this.#shufflePos) + 1 : Math.ceil(this.#shufflePos) - 1; p >= 0 && p < ids.length; p += step) {
      const index = indexById.get(ids[p]);
      if (index !== undefined && queue[index].url) return { index, pos: p };
    }
    return null;
  }

  #start(index) {
    this.#ensureGraph();
    const track = this.#state.queue[index];
    if (this.#state.order === 'shuffle') {
      const at = this.#shuffled.indexOf(track.id);
      if (at >= 0) this.#shufflePos = at;
    }

    if (!track.url) {
      // Missing audio (not relinked). Automatic advance never lands here.
      this.#active.clear();
      this.#idle.clear();
      this.#set({
        index,
        current: track,
        detachedAt: null,
        status: 'stopped',
        duration: 0,
        error: { index, message: `"${track.title}" is missing` },
      });
      return;
    }

    if (this.#idle.holds(track)) {
      // Preloaded: swap decks so playback starts from already-buffered audio.
      [this.#active, this.#idle] = [this.#idle, this.#active];
    } else {
      this.#active.load(track);
    }
    this.#idle.clear();

    const { duration } = this.#active.element;
    this.#set({
      index,
      current: track,
      detachedAt: null,
      status: 'playing',
      duration: Number.isFinite(duration) ? duration : 0,
      error: null,
    });
    this.#updateMediaSession(track);
    this.#playActive();
  }

  #resume() {
    this.#set({ status: 'playing' });
    this.#playActive();
  }

  #playActive() {
    const deck = this.#active;
    const { loadId } = deck;
    const { index } = this.#state;
    this.#context.resume();
    deck.element.play().catch((error) => {
      // AbortError means a newer load interrupted this play() — expected.
      if (error.name === 'AbortError') return;
      if (deck === this.#active && deck.loadId === loadId) this.#fail(index);
    });
  }

  #maybePreload() {
    const { element } = this.#active;
    if (!Number.isFinite(element.duration)) return;
    if (element.duration - element.currentTime > PRELOAD_WINDOW_S) return;

    const { queue, index, stopAfterCurrent } = this.#state;
    if (stopAfterCurrent) return;
    const target = this.#nextTarget({ ended: true, peek: true });
    // Repeat One restarts the playing deck; nothing to preload.
    if (target >= 0 && target !== index && !this.#idle.holds(queue[target])) this.#idle.load(queue[target]);
  }

  #advance() {
    const { stopAfterCurrent, index } = this.#state;
    const target = this.#nextTarget({ ended: true });
    if (stopAfterCurrent) {
      // Stop, with whatever comes next waiting, so Play carries on from there.
      this.#set({ stopAfterCurrent: false });
      if (target >= 0 && target !== index) this.#cue(target);
      else this.#stopAtStart();
    } else if (target === index) {
      // Repeat One.
      this.#active.element.currentTime = 0;
      this.#playActive();
    } else if (target >= 0) {
      this.#start(target);
    } else {
      this.#stopAtStart();
    }
  }

  #stopAtStart() {
    this.#active.element.currentTime = 0;
    this.#set({ status: 'stopped' });
  }

  /** Load queue position `index`, ready to play, without playing it. */
  #cue(index) {
    const track = this.#state.queue[index];
    if (this.#idle.holds(track)) [this.#active, this.#idle] = [this.#idle, this.#active];
    else this.#active.load(track);
    this.#idle.clear();
    if (this.#state.order === 'shuffle') this.#shufflePos = this.#shuffled.indexOf(track.id);
    this.#set({ index, current: track, detachedAt: null, status: 'stopped', duration: 0, error: null });
    this.#updateMediaSession(track);
  }

  /** A track couldn't be played: record it and move on rather than stalling. */
  #fail(index) {
    // The element's 'error' event and the play() rejection both report the
    // same failure; only handle it once. (A rejection that arrives after we've
    // already moved on is filtered by loadId in #playActive.)
    if (index !== this.#state.index || this.#state.error?.index === index) return;
    const track = this.#state.queue[index];
    const failure = { index, message: `Couldn't play "${track.title}"` };

    const target = this.#nextTarget();
    if (target >= 0 && target !== index) {
      this.#start(target);
    } else {
      this.#active.clear();
      this.#set({ status: 'stopped' });
    }
    // #start clears `error`, so set it last.
    this.#set({ error: failure });
  }

  #applyVolume() {
    if (!this.#masterGain) return;
    const { volume, muted } = this.#state;
    this.#masterGain.gain.setTargetAtTime(
      muted ? 0 : volumeToGain(volume),
      this.#context.currentTime,
      VOLUME_SMOOTHING_S
    );
  }

  /** OS media keys and media overlays (Windows SMTC, Linux MPRIS). */
  #registerMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const handlers = {
      play: () => this.togglePlay(),
      pause: () => this.pause(),
      stop: () => this.stop(),
      previoustrack: () => this.previous(),
      nexttrack: () => this.next(),
      seekto: ({ seekTime }) => this.seek(seekTime),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      navigator.mediaSession.setActionHandler(action, handler);
    }
    this.#teardown.push(() => {
      for (const action of Object.keys(handlers)) navigator.mediaSession.setActionHandler(action, null);
    });
  }

  #updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    const metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist ?? '',
      album: track.album ?? '',
    });
    navigator.mediaSession.metadata = metadata;
    if (track.artUrl && !this.#showShapes) this.#attachArtwork(metadata, async () => (await fetch(track.artUrl)).blob());
    else if (track.symbolSeed) this.#attachArtwork(metadata, () => symbolOverlayPng(track.symbolSeed));
  }

  #showShapes = false;

  /** Options ▸ Show Track Shapes Instead of Art: the OS overlay shows the symbol too. */
  setShowShapes(showShapes) {
    if (showShapes === this.#showShapes) return;
    this.#showShapes = showShapes;
    if (this.#state.current) this.#updateMediaSession(this.#state.current);
  }

  #artworkObjectUrl = null;

  /**
   * MediaSession only accepts http/https/data/blob artwork, so re-serve the
   * cached art (or the generated symbol, as a PNG) as a blob URL. Async: the
   * overlay gets art a moment later.
   */
  async #attachArtwork(metadata, makeBlob) {
    try {
      const blob = await makeBlob();
      // A newer track may have started while this was fetching.
      if (navigator.mediaSession.metadata !== metadata) return;
      if (this.#artworkObjectUrl) URL.revokeObjectURL(this.#artworkObjectUrl);
      this.#artworkObjectUrl = URL.createObjectURL(blob);
      metadata.artwork = [{ src: this.#artworkObjectUrl, type: blob.type }];
    } catch {
      // No overlay art is fine; the app's own art pane is unaffected.
    }
  }
}

/**
 * The generated symbol for the OS media overlay: a PNG (it takes no SVG), on
 * the app's background, since overlays show transparency as black or white.
 */
function symbolOverlayPng(seed) {
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#14110f';
  return symbolPng(seed, { size: 512, background });
}

function loadSetting(key, allowed) {
  try {
    const stored = localStorage.getItem(key);
    return allowed.includes(stored) ? stored : allowed[0];
  } catch {
    return allowed[0];
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not worth surfacing; the setting just won't persist.
  }
}

function loadVolume() {
  try {
    const stored = Number(localStorage.getItem(VOLUME_KEY));
    return stored > 0 && stored <= 1 ? stored : 0.7;
  } catch {
    return 0.7;
  }
}

function saveVolume(volume) {
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // Not worth surfacing; the volume just won't persist.
  }
}

export const player = new Player();

// Without this, each hot reload of this module would leave the previous
// engine's audio playing with no way to stop it.
if (import.meta.hot) import.meta.hot.dispose(() => player.destroy());
