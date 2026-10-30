// Synthesized animated GIFs for tests (unit and end-to-end). No image files are committed.
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;

/** An animated GIF whose left `clear` columns are transparent. */
export function makeGif(width, height, frames, { delay = 50, clear = 0 } = {}) {
  const encoder = GIFEncoder();
  for (let f = 0; f < frames; f++) {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const x = i % width;
      rgba[i * 4] = (x + f * 20) % 256;
      rgba[i * 4 + 1] = Math.floor(i / width) % 256;
      rgba[i * 4 + 2] = 128;
      rgba[i * 4 + 3] = x < clear ? 0 : 255;
    }
    // A dedicated transparent slot: gifenc's alpha quantizer merges it away in busy images.
    const palette = quantize(rgba, clear ? 255 : 256);
    const index = applyPalette(rgba, palette);
    if (clear) {
      palette.push([0, 0, 0]);
      for (let i = 0; i < width * height; i++) if (i % width < clear) index[i] = 255;
    }
    encoder.writeFrame(index, width, height, { palette, delay, transparent: Boolean(clear), transparentIndex: 255 });
  }
  encoder.finish();
  return Buffer.from(encoder.bytes());
}
