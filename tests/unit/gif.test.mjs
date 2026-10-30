// GIF import guardrail (src/main/gif.mjs), in plain Node. Test GIFs are synthesized here.
import assert from 'node:assert/strict';
import omggif from 'omggif';
import { makeGif } from '../gif-fixture.mjs';
import { guardGif, inspectGif, planGif, resize, GIF_DECODED_BUDGET } from '../../src/main/gif.mjs';

const pass = (name) => console.log('PASS', name);

// --- Planning ---
assert.deepEqual(planGif({ width: 500, height: 500, frames: 30 }), { width: 500, height: 500, step: 1, changed: false });
pass('typical album-art GIF (500×500, 30 frames) is left alone');

let plan = planGif({ width: 1920, height: 1080, frames: 200 });
assert.ok(plan.changed && plan.step === 1 && plan.width < 1920);
assert.ok(plan.width * plan.height * 4 * 200 <= GIF_DECODED_BUDGET);
assert.ok(Math.abs(plan.width / plan.height - 1920 / 1080) < 0.01);
pass(`1920×1080×200 plans to ${plan.width}×${plan.height}, aspect kept, under budget`);

plan = planGif({ width: 1000, height: 1000, frames: 5000 });
assert.ok(plan.width === 360 && plan.step > 1 && (360 * 360 * 4 * Math.ceil(5000 / plan.step)) <= GIF_DECODED_BUDGET);
pass(`never below the minimum edge: drops frames instead (keeps 1 in ${plan.step})`);

// --- Resize ---
const half = resize(new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0]), 2, 2, 1, 1);
assert.deepEqual([...half], [255, 0, 0, 128]);
pass('area-average resize keeps colour next to transparency (premultiplied)');

// --- Re-encode, end to end (small budget so the test stays fast) ---
const big = makeGif(400, 300, 12, { delay: 50, clear: 40 });
const budget = 400 * 300 * 4 * 12 / 4; // a quarter of its decoded size
const out = await guardGif(big, { budget, minEdge: 64 });
const info = inspectGif(out.data);
assert.ok(out.changed && info.width === 200 && info.height === 150 && info.frames === 12, JSON.stringify(info));
assert.ok(info.decodedBytes <= budget);
const reader = new omggif.GifReader(out.data);
const pixels = new Uint8Array(200 * 150 * 4);
reader.decodeAndBlitFrameRGBA(5, pixels);
assert.equal(reader.frameInfo(5).delay, 5); // centiseconds: 50ms preserved
assert.equal(reader.loopCount(), 0); // loops forever, as the source did
assert.equal(pixels[3], 0); // transparent column survives
assert.equal(pixels[100 * 4 + 3], 255);
assert.equal(reader.frameInfo(5).disposal, 2); // next frame has transparency: clear, don't show through
pass('over-budget GIF re-encodes at half size, delays, looping and transparency intact');

const again = await guardGif(out.data, { budget, minEdge: 64 });
assert.ok(!again.changed && again.data === out.data);
pass('a guarded GIF passes through a second time unchanged');

const many = await guardGif(makeGif(100, 100, 40, { delay: 30 }), { budget: 100 * 100 * 4 * 10, minEdge: 100 });
const manyReader = new omggif.GifReader(many.data);
assert.equal(manyReader.numFrames(), 10);
let total = 0;
for (let i = 0; i < 10; i++) total += manyReader.frameInfo(i).delay;
assert.equal(total, 40 * 3);
pass('frame dropping merges delays, so the animation runs the same length');

assert.equal(await guardGif(Buffer.from('GIF89a not really')), null);
assert.equal(inspectGif(Buffer.from('nope')), null);
pass('unreadable GIFs are refused');
