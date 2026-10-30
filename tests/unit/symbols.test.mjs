// Generated default art (src/renderer/symbols.js), in plain Node.
import assert from 'node:assert/strict';
const { drawSymbol, RECIPES, SYMBOL_PAD } = await import(new URL('../../src/renderer/symbols.js', import.meta.url));
const { symbolSeed } = await import(new URL('../../src/renderer/store/art.js', import.meta.url));

const pass = (name) => console.log('PASS', name);

// Every coordinate a symbol's shapes are drawn at (not the mask's backdrop or gradients).
const coordinates = (svg) =>
  [...svg.replace(/<mask[\s\S]*?<\/mask>/g, '').matchAll(/ d="([^"]+)"/g)].flatMap(([, d]) => d.replace(/[MLZ]/g, ' ').trim().split(/\s+/).map(Number));

assert.equal(drawSymbol('abc').svg, drawSymbol('abc').svg);
assert.notEqual(drawSymbol('abc').svg, drawSymbol('abd').svg);
pass('the same seed draws the same symbol; another seed, another');

const seen = new Set();
const t = performance.now();
for (let i = 0; i < 400; i++) {
  const { recipe, svg } = drawSymbol(`seed-${i}`);
  seen.add(recipe);
  assert.ok(svg.startsWith('<svg') && !svg.includes('NaN') && !svg.includes('Infinity'), `seed-${i}`);
  const values = coordinates(svg);
  assert.ok(values.length > 0 && values.every((v) => v >= SYMBOL_PAD - 0.05 && v <= 100 - SYMBOL_PAD + 0.05), `seed-${i} (${recipe}) strays outside the padding`);
}
const each = (performance.now() - t) / 400;
assert.deepEqual([...seen].sort(), Object.keys(RECIPES).sort());
pass(`400 seeds: all ${seen.size} recipes appear, every symbol clear of the edges, nothing NaN (${each.toFixed(2)}ms each)`);

for (const recipe of Object.keys(RECIPES)) {
  for (let i = 0; i < 25; i++) assert.ok(coordinates(drawSymbol(`r${i}`, { recipe }).svg).length > 0);
}
pass('each recipe draws on its own');

assert.equal(symbolSeed({ id: 't1', fingerprint: 'fp', relPath: 'a/b.flac' }), 'fp');
assert.equal(symbolSeed({ id: 't1', fingerprint: null, relPath: 'Music\\Album\\b.flac' }), 'b.flac');
assert.equal(symbolSeed({ id: 't1', fingerprint: null, relPath: null, absPath: '/x/c.mp3' }), 'c.mp3');
assert.equal(symbolSeed({ id: 't1' }), 't1');
pass('the seed is the fingerprint, else the file name, else the id');
