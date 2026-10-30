import omggif from 'omggif';
import gifenc from 'gifenc';

const { GifReader } = omggif;
const { GIFEncoder, quantize, applyPalette } = gifenc;

/**
 * The GIF import guardrail (PLAN.md §5 "Art pane").
 *
 * Chromium keeps decoded GIF frames as full-size bitmaps, so what a GIF costs
 * in memory is width × height × 4 bytes × frames, not its file size. A
 * 1920×1080, 200-frame GIF is ~1.6GB decoded. At import, an animation over
 * budget is re-encoded once at a smaller size (and, only if it has a huge
 * number of frames, at fewer frames), and that copy is what gets cached and
 * stored in a .bday's art/. Typical album-art GIFs (500×500, ~30 frames:
 * ~30MB) are well under budget and pass through untouched.
 *
 * Pure JS (omggif to decode, gifenc to encode), so it cross-builds for
 * Windows with nothing native, and no Electron imports, so it runs from plain
 * Node in the unit tests. The work yields between frames, because it runs in
 * main, which also serves the audio stream.
 */

/** Decoded size an animation may reach before it's downscaled. */
export const GIF_DECODED_BUDGET = 256 * 1024 * 1024;
/** Downscaling never takes the longest edge below this; frames are dropped instead. */
export const GIF_MIN_EDGE = 360;

// Past these, a GIF is refused rather than processed: no real cover art is
// this big, and a hostile .bday shouldn't be able to stall main.
const MAX_PIXELS = 50_000_000;
const MAX_FRAMES = 10_000;

/** Chromium (like every browser) shows a delay of 0 or 1 centisecond as 100ms. */
const delayMs = (centiseconds) => (centiseconds <= 1 ? 100 : centiseconds * 10);

export const isGif = (data) => data?.length >= 6 && data.toString('latin1', 0, 4) === 'GIF8';

/** { width, height, frames, decodedBytes } without decoding any pixels, or null if unreadable. */
export function inspectGif(data) {
  try {
    const reader = new GifReader(data);
    const frames = reader.numFrames();
    return { width: reader.width, height: reader.height, frames, decodedBytes: reader.width * reader.height * 4 * frames };
  } catch {
    return null;
  }
}

/**
 * Output size and frame step for a GIF of this shape. step = 1 keeps every
 * frame; step = k keeps one in k (their delays are merged, so it runs the
 * same length).
 */
export function planGif({ width, height, frames }, { budget = GIF_DECODED_BUDGET, minEdge = GIF_MIN_EDGE } = {}) {
  const cost = width * height * 4 * frames;
  if (cost <= budget) return { width, height, step: 1, changed: false };

  let scale = Math.sqrt(budget / cost);
  const longest = Math.max(width, height);
  if (longest * scale < minEdge) scale = Math.min(1, minEdge / longest);
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const step = Math.max(1, Math.ceil((outWidth * outHeight * 4 * frames) / budget));
  return { width: outWidth, height: outHeight, step, changed: true };
}

/**
 * Apply the guardrail. Resolves { data, changed, width, height, frames }, or
 * null when the GIF can't be read or is beyond any sensible size. `data` is
 * the input itself when nothing needed to change.
 */
export async function guardGif(data, options = {}) {
  let reader;
  try {
    reader = new GifReader(data);
  } catch {
    return null;
  }
  const { width, height } = reader;
  const frames = reader.numFrames();
  if (!frames || width * height > MAX_PIXELS || frames > MAX_FRAMES) return null;

  const plan = planGif({ width, height, frames }, options);
  if (!plan.changed) return { data, changed: false, width, height, frames };

  try {
    const out = await reencode(reader, plan);
    return { data: out.data, changed: true, width: plan.width, height: plan.height, frames: out.frames };
  } catch {
    return null; // Corrupt frame data: treat as unreadable.
  }
}

async function reencode(reader, plan) {
  const { width, height } = reader;
  const count = reader.numFrames();
  const canvas = new Uint8Array(width * height * 4); // starts fully transparent
  const loops = reader.loopCount();
  const encoder = GIFEncoder();

  // Frames are written one behind, because a frame's disposal depends on the
  // next one: if the next frame has transparent pixels, this one must be
  // cleared away rather than show through.
  let pending = null;
  let first = null;
  let written = 0;
  const write = (frame, nextTransparent) => {
    encoder.writeFrame(frame.index, plan.width, plan.height, {
      palette: frame.palette,
      delay: frame.delay,
      transparent: frame.transparentIndex != null,
      transparentIndex: frame.transparentIndex ?? 0,
      dispose: nextTransparent ? 2 : 1,
      // GIF: no loop extension = play once; 0 = forever.
      repeat: loops == null ? -1 : loops,
    });
    written++;
  };

  for (let i = 0; i < count; i++) {
    const info = reader.frameInfo(i);
    const before = info.disposal === 3 ? canvas.slice() : null;
    reader.decodeAndBlitFrameRGBA(i, canvas);

    if (i % plan.step === 0) {
      const frame = indexFrame(resize(canvas, width, height, plan.width, plan.height));
      frame.delay = 0;
      if (pending) write(pending, frame.transparentIndex != null);
      pending = frame;
      first ??= frame;
    }
    pending.delay += delayMs(info.delay);

    // Dispose of this frame before the next one is drawn.
    if (info.disposal === 2) clearRect(canvas, width, height, info);
    else if (before) canvas.set(before);

    await new Promise((resolve) => setImmediate(resolve));
  }
  write(pending, first.transparentIndex != null); // loops back round to the first frame
  encoder.finish();
  return { data: Buffer.from(encoder.bytes()), frames: written };
}

function clearRect(canvas, width, height, { x, y, width: w, height: h }) {
  const x1 = Math.min(width, x + w);
  const y1 = Math.min(height, y + h);
  for (let row = Math.max(0, y); row < y1; row++) {
    canvas.fill(0, (row * width + Math.max(0, x)) * 4, (row * width + x1) * 4);
  }
}

/**
 * Area-average downscale of RGBA pixels. Averages in premultiplied alpha, so
 * transparent pixels don't darken the edges of what's next to them.
 */
export function resize(src, width, height, outWidth, outHeight) {
  const out = new Uint8Array(outWidth * outHeight * 4);
  const spans = (from, to) =>
    Array.from({ length: to }, (_, i) => {
      const start = Math.floor((i * from) / to);
      return [start, Math.max(start + 1, Math.floor(((i + 1) * from) / to))];
    });
  const xs = spans(width, outWidth);
  const ys = spans(height, outHeight);

  for (let oy = 0; oy < outHeight; oy++) {
    const [y0, y1] = ys[oy];
    for (let ox = 0; ox < outWidth; ox++) {
      const [x0, x1] = xs[ox];
      let r = 0, g = 0, b = 0, a = 0;
      for (let y = y0; y < y1; y++) {
        let p = (y * width + x0) * 4;
        for (let x = x0; x < x1; x++, p += 4) {
          const alpha = src[p + 3];
          r += src[p] * alpha;
          g += src[p + 1] * alpha;
          b += src[p + 2] * alpha;
          a += alpha;
        }
      }
      const q = (oy * outWidth + ox) * 4;
      const n = (x1 - x0) * (y1 - y0);
      if (a > 0) {
        out[q] = Math.round(r / a);
        out[q + 1] = Math.round(g / a);
        out[q + 2] = Math.round(b / a);
      }
      out[q + 3] = Math.round(a / n);
    }
  }
  return out;
}

/** Quantize one RGBA frame to a palette, with one slot for transparency if it needs it. */
function indexFrame(rgba) {
  let transparent = false;
  for (let p = 3; p < rgba.length; p += 4) {
    if (rgba[p] < 128) {
      transparent = true;
      break;
    }
  }
  const palette = quantize(rgba, transparent ? 255 : 256);
  const index = applyPalette(rgba, palette);
  if (!transparent) return { index, palette, transparentIndex: null };

  const transparentIndex = palette.length;
  palette.push([0, 0, 0]);
  for (let i = 0, p = 3; i < index.length; i++, p += 4) {
    if (rgba[p] < 128) index[i] = transparentIndex;
  }
  return { index, palette, transparentIndex };
}
