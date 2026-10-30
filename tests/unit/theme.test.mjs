// Theming (store/theme.js): derivation, the contrast promise, presets, art suggestions. Run via tests/run-unit.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { DEFAULT_PALETTE, PAIRINGS, PALETTE_PRESETS, contrast, deriveTheme, mix, normalizePalette, parseHex, samePalette, suggestPalettes } = await import(
  new URL('../../src/renderer/store/theme.js', import.meta.url)
);

// Basics
assert.equal(parseHex('#ABC'), '#aabbcc');
assert.equal(parseHex('aabbcc'), '#aabbcc');
assert.equal(parseHex('#12345'), null);
assert.equal(parseHex('red'), null);
assert.equal(parseHex(null), null);
assert.equal(contrast('#000000', '#ffffff'), 21);
assert.equal(contrast('#123456', '#123456'), 1);
assert.equal(mix('#ff0000', '#0000ff', 1), '#ff0000');
assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
console.log('PASS colour basics');

assert.equal(normalizePalette(null), null);
assert.equal(normalizePalette({ primary: '#000', secondary: '#fff' }), null, 'all three, or none');
assert.equal(normalizePalette({ primary: 'url(x)', secondary: '#fff', tertiary: '#fff' }), null, 'a .bday is untrusted');
assert.deepEqual(normalizePalette({ tertiary: '#FFF', primary: '#000', secondary: '#123', extra: 1 }), { primary: '#000000', secondary: '#112233', tertiary: '#ffffff' });
assert.ok(samePalette({ primary: '#000', secondary: '#FFF', tertiary: '#abc' }, { primary: '#000000', secondary: '#ffffff', tertiary: '#aabbcc' }));
console.log('PASS palettes are normalized');

// tokens.css is the default palette's derivation, written out.
const css = fs.readFileSync(new URL('../../src/renderer/styles/tokens.css', import.meta.url), 'utf8');
const { tokens, mode } = deriveTheme(DEFAULT_PALETTE);
for (const [name, value] of Object.entries(tokens)) {
  assert.ok(new RegExp(`${name}: ${value};`).test(css), `tokens.css: ${name} should be ${value}`);
}
assert.ok(css.includes(`color-scheme: ${mode};`), 'tokens.css: color-scheme');
console.log('PASS tokens.css matches the default derivation');

const unmoved = (palette) => assert.deepEqual(deriveTheme(palette).used, normalizePalette(palette), `${JSON.stringify(palette)} should need no adjusting`);
for (const { palette } of PALETTE_PRESETS) unmoved(palette);
assert.equal(deriveTheme(null).tokens['--bg'], DEFAULT_PALETTE.primary, 'no palette: the default');
assert.equal(deriveTheme({ primary: 'nonsense' }).tokens['--bg'], DEFAULT_PALETTE.primary, 'a bad palette: the default');
console.log('PASS presets and the default keep the colours picked');

// The promise: every pairing holds, for any three colours at all.
const failures = (theme) => PAIRINGS.filter(([fg, bg, ratio]) => contrast(theme.tokens[fg], theme.tokens[bg]) < ratio).map(([fg, bg, ratio]) => `${fg} on ${bg}: ${contrast(theme.tokens[fg], theme.tokens[bg]).toFixed(2)} < ${ratio}`);
let seed = 12345;
const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const hex = () => `#${Math.floor(random() * 0x1000000).toString(16).padStart(6, '0')}`;
const grey = () => { const v = Math.floor(random() * 256).toString(16).padStart(2, '0'); return `#${v}${v}${v}`; };
const hostile = ['#000000', '#ffffff', '#808080', '#777777', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffcccc', '#ccffcc'];
const cases = [];
for (const primary of hostile) for (const secondary of hostile) for (const tertiary of hostile) cases.push({ primary, secondary, tertiary });
for (let i = 0; i < 6000; i++) cases.push({ primary: i % 3 ? hex() : grey(), secondary: i % 5 ? hex() : grey(), tertiary: hex() });
for (const palette of cases) {
  const theme = deriveTheme(palette);
  assert.deepEqual(failures(theme), [], JSON.stringify(palette));
  for (const value of Object.values(theme.tokens)) assert.match(value, /^#[0-9a-f]{6}$/, JSON.stringify(palette));
}
console.log(`PASS every pairing holds across ${cases.length} palettes`);

// Light themes and adjustments
assert.equal(deriveTheme({ primary: '#f4ecdf', secondary: '#c2553f', tertiary: '#2d6e7e' }).mode, 'light');
assert.equal(deriveTheme({ primary: '#101a14', secondary: '#7bc47f', tertiary: '#e6c35c' }).mode, 'dark');
const pastels = deriveTheme({ primary: '#f8e8ee', secondary: '#f9d5e5', tertiary: '#eeeeaa' });
assert.equal(pastels.mode, 'light', 'three pastels: a light theme…');
assert.equal(pastels.used.primary, '#f8e8ee', '…with the background as picked…');
assert.notEqual(pastels.used.secondary, '#f9d5e5', '…and the pastel accent deepened');
const blue = deriveTheme({ primary: '#3355bb', secondary: '#ffffff', tertiary: '#ffff00' });
assert.notEqual(blue.used.primary, '#3355bb', 'a mid-tone background moves');
assert.equal(blue.mode, 'dark');
const hueOf = (color) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)); return b > r && b > g; };
assert.ok(hueOf(blue.used.primary), '…and stays its hue');
console.log('PASS light themes, and lightness moves only when contrast needs it');

// Suggestions
const image = (...runs) => Uint8Array.from(runs.flatMap(([rgba, n]) => Array.from({ length: n }, () => rgba)).flat());
const hueIs = (color, channel) => { const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)); return rgb.indexOf(Math.max(...rgb)) === channel; };
let suggested = suggestPalettes(image([[230, 30, 40, 255], [600]], [[30, 60, 220, 255], [300]], [[20, 20, 20, 255], [100]]));
assert.equal(suggested.length, 3, 'deep, light, bold');
assert.ok(hueIs(suggested[0].secondary, 0) && hueIs(suggested[0].tertiary, 2), 'accent and highlight are the image’s two colours, the commoner first');
assert.equal(deriveTheme(suggested[0]).mode, 'dark');
assert.equal(deriveTheme(suggested[1]).mode, 'light');
assert.equal(suggestPalettes(image([[0, 0, 0, 0], [100]])).length, 0, 'nothing opaque: no suggestion');
suggested = suggestPalettes(image([[128, 128, 128, 255], [100]], [[240, 240, 240, 255], [100]]));
assert.equal(suggested.length, 3, 'greyscale art still gives palettes');
for (const palette of suggested) assert.deepEqual(failures(deriveTheme(palette)), []);
console.log('PASS suggestions from art');
