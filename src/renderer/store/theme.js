/**
 * Per-playlist theming (PLAN.md §5 "Theming — derive, don't slot"), as pure
 * functions: three raw colours in, the token set components read out.
 *
 *   primary    the background family: window, panels, menus, borders, text tint
 *   secondary  the accent: buttons, selected rows, the active tab, focus rings
 *   tertiary   the highlight: group names, album, seek bar, transport buttons
 *
 * A pale primary makes a light theme, by luminance alone: there's no mode to
 * choose. Surfaces step from the background towards the text, so `--bg` is the
 * deepest layer of a dark theme and the palest layer of a light one.
 *
 * Every pairing in PAIRINGS is held to its WCAG contrast ratio by moving
 * lightness only, so a colour keeps its hue. The background keeps the exact
 * colour picked unless text can't stay readable across its surfaces.
 *
 * styles/tokens.css is deriveTheme(DEFAULT_PALETTE) written out (a unit test
 * keeps them equal), so the app looks right before any playlist has loaded.
 */

/** Used by every playlist with `palette: null`. */
export const DEFAULT_PALETTE = { primary: '#14110f', secondary: '#e8766b', tertiary: '#f0c040' };

/** Starting points in the Colors dialog. */
export const PALETTE_PRESETS = [
  { name: 'Beachday', palette: DEFAULT_PALETTE },
  { name: 'Ink', palette: { primary: '#101010', secondary: '#d9d9d9', tertiary: '#ffc81e' } },
  { name: 'Midnight', palette: { primary: '#0f1420', secondary: '#6ea8fe', tertiary: '#ffd166' } },
  { name: 'Forest', palette: { primary: '#101a14', secondary: '#7bc47f', tertiary: '#e6c35c' } },
  { name: 'Grape', palette: { primary: '#1a1226', secondary: '#c58af9', tertiary: '#ff9ecb' } },
  { name: 'Sand', palette: { primary: '#f4ecdf', secondary: '#a04533', tertiary: '#2b6978' } },
  { name: 'Sky', palette: { primary: '#eaf3fb', secondary: '#2864a4', tertiary: '#8e560d' } },
  { name: 'Blossom', palette: { primary: '#fdeef2', secondary: '#a33465', tertiary: '#7348ac' } },
];

const ROLES = ['primary', 'secondary', 'tertiary'];

// How far each surface sits from --bg, in HSL lightness, towards the text.
const STEP = { surface: 0.03, raised: 0.07, hover: 0.11, borderStrong: 0.175 };

// Contrast the background must leave its text at the --surface-hover layer.
// More than the 4.5 text needs, so secondary and muted text still have room
// to be quieter than primary text.
const INK_ROOM = 6;

const TEXT_RATIO = 4.5;
const QUIET_RATIO = 3;

/** How strongly a selected row is tinted, at most; the solver may use less. */
const SELECTED_MIX = 0.24;
const SELECTED_SOFT = 2 / 3;

/** Every contrast the theme promises: [foreground, background, minimum ratio]. */
export const PAIRINGS = [
  ['--text-primary', '--bg', TEXT_RATIO],
  ['--text-primary', '--surface', TEXT_RATIO],
  ['--text-primary', '--surface-raised', TEXT_RATIO],
  ['--text-primary', '--surface-hover', TEXT_RATIO],
  ['--text-primary', '--selected', TEXT_RATIO],
  ['--text-primary', '--border-strong', QUIET_RATIO],
  ['--text-secondary', '--surface', TEXT_RATIO],
  ['--text-secondary', '--surface-raised', TEXT_RATIO],
  ['--text-secondary', '--surface-hover', TEXT_RATIO],
  ['--text-secondary', '--selected', QUIET_RATIO],
  ['--text-muted', '--surface', QUIET_RATIO],
  ['--text-muted', '--surface-raised', QUIET_RATIO],
  ['--accent', '--bg', TEXT_RATIO],
  ['--accent', '--surface', TEXT_RATIO],
  ['--accent', '--surface-raised', TEXT_RATIO],
  ['--highlight', '--bg', TEXT_RATIO],
  ['--highlight', '--surface', TEXT_RATIO],
  ['--highlight', '--surface-raised', TEXT_RATIO],
  ['--highlight', '--selected-soft', QUIET_RATIO],
  ['--accent-contrast', '--accent', TEXT_RATIO],
  ['--accent-contrast', '--accent-hover', TEXT_RATIO],
  ['--accent-contrast', '--highlight', TEXT_RATIO],
];

// --- Colour ------------------------------------------------------------------

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));

/** "#rrggbb" from "#rgb", "rgb", "#rrggbb" or "rrggbb", in any case; else null. */
export function parseHex(text) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(text ?? '').trim());
  if (!match) return null;
  const digits = match[1].toLowerCase();
  return `#${digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits}`;
}

const toRgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const fromRgb = (rgb) => `#${rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

function rgbToHsl([r, g, b]) {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === red ? ((green - blue) / d + 6) % 6 : max === green ? (blue - red) / d + 2 : (red - green) / d + 4;
  return [h * 60, s, l];
}

function hslToHex([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return fromRgb([r, g, b].map((v) => (v + m) * 255));
}

const toHsl = (hex) => rgbToHsl(toRgb(hex));

const withLightness = ([h, s], l) => hslToHex([h, s, clamp(l)]);

/** `a` over `b` at `t`: what CSS's color-mix(in srgb, a t, b) gives. */
export function mix(a, b, t) {
  const [ra, rb] = [toRgb(a), toRgb(b)];
  return fromRgb(ra.map((v, i) => v * t + rb[i] * (1 - t)));
}

/** WCAG relative luminance. */
export function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Move `hex`'s lightness in `direction` (+1 lighter, -1 darker) until it clears every one of `against`. */
function ensureContrast(hex, against, ratio, direction) {
  const hsl = toHsl(hex);
  const passes = (candidate) => against.every((other) => contrast(candidate, other) >= ratio);
  for (let l = hsl[2]; l >= 0 && l <= 1; l += direction * 0.005) {
    const candidate = withLightness(hsl, l);
    if (passes(candidate)) return candidate;
  }
  return direction > 0 ? '#ffffff' : '#000000';
}

// --- Deriving ----------------------------------------------------------------

/** The ink a background calls for, tinted with its hue. */
const inkFor = ([h, s], direction) => hslToHex([h, Math.min(s, 0.3), direction > 0 ? 0.93 : 0.1]);

const surfacesFrom = ([h, s, l], direction) => {
  const at = (step) => withLightness([h, s], l + direction * step);
  return {
    surface: at(STEP.surface),
    raised: at(STEP.raised),
    hover: at(STEP.hover),
    borderStrong: at(STEP.borderStrong),
  };
};

/**
 * The background as picked, moved away from its text only as far as it takes:
 * a mid-tone colour has no ink that reads across all of its surfaces.
 */
function solveBackground(primary, direction) {
  const hsl = toHsl(primary);
  const [h, s, picked] = hsl;
  const ink = inkFor(hsl, direction);
  for (let l = picked; l >= 0 && l <= 1; l -= direction * 0.005) {
    const hover = surfacesFrom([h, s, l], direction).hover;
    if (contrast(ink, hover) >= INK_ROOM) return l === picked ? primary : withLightness(hsl, l);
  }
  return direction > 0 ? '#000000' : '#ffffff';
}

/** The strongest tint of `accent` over `surface` that the text on a selected row still reads on. */
function selectionTint(accent, surface, textPrimary, textSecondary) {
  for (let t = SELECTED_MIX; t > 0; t -= 0.01) {
    const tint = mix(accent, surface, t);
    if (contrast(textPrimary, tint) >= TEXT_RATIO && contrast(textSecondary, tint) >= QUIET_RATIO) return t;
  }
  return 0;
}

/** Text that sits on accent- and highlight-coloured fills: the background itself, when it reads. */
function fillText(bg, fills) {
  const worst = (candidate) => Math.min(...fills.map((fill) => contrast(candidate, fill)));
  if (worst(bg) >= TEXT_RATIO) return bg;
  return worst('#ffffff') >= worst('#000000') ? '#ffffff' : '#000000';
}

/**
 * A palette's tokens. `mode` is 'dark' or 'light'. `used` holds the colours
 * actually shown for each role, which differ from the palette's where
 * contrast moved them.
 */
export function deriveTheme(palette) {
  const { primary, secondary, tertiary } = normalizePalette(palette) ?? DEFAULT_PALETTE;

  // +1: dark theme, surfaces and text get lighter. -1: the reverse.
  const direction = contrast('#ffffff', primary) >= contrast('#000000', primary) ? 1 : -1;
  const bg = solveBackground(primary, direction);
  const hsl = toHsl(bg);
  const [h, s] = hsl;
  const { surface, raised, hover, borderStrong } = surfacesFrom(hsl, direction);

  const textPrimary = inkFor(hsl, direction);
  const textStart = (saturation, l) => hslToHex([h, Math.min(s, saturation), l]);
  const accent = ensureContrast(secondary, [bg, surface, raised], TEXT_RATIO, direction);
  const highlight = ensureContrast(tertiary, [bg, surface, raised], TEXT_RATIO, direction);

  const accentHsl = toHsl(accent);
  const stepped = accentHsl[2] + direction * 0.05;
  // Already at the end of the range: hover steps back instead.
  const accentHover = withLightness(accentHsl, stepped >= 0 && stepped <= 1 ? stepped : accentHsl[2] - direction * 0.05);

  const textSecondary = ensureContrast(textStart(0.13, direction > 0 ? 0.68 : 0.32), [surface, raised, hover], TEXT_RATIO, direction);
  const textMuted = ensureContrast(textStart(0.08, direction > 0 ? 0.455 : 0.47), [surface, raised], QUIET_RATIO, direction);

  const tint = selectionTint(accent, surface, textPrimary, textSecondary);
  const selected = mix(accent, surface, tint);
  const selectedSoft = mix(accent, surface, tint * SELECTED_SOFT);

  return {
    mode: direction > 0 ? 'dark' : 'light',
    used: { primary: bg, secondary: accent, tertiary: highlight },
    tokens: {
      '--bg': bg,
      '--surface': surface,
      '--surface-raised': raised,
      '--surface-hover': hover,
      '--text-primary': textPrimary,
      '--text-secondary': textSecondary,
      '--text-muted': textMuted,
      '--accent': accent,
      '--accent-hover': accentHover,
      '--accent-contrast': fillText(bg, [accent, accentHover, highlight]),
      '--highlight': highlight,
      '--selected': selected,
      '--selected-soft': selectedSoft,
      '--border': hover,
      '--border-strong': borderStrong,
    },
  };
}

/** Put a palette's theme on the page. */
export function applyTheme(palette, root = document.documentElement) {
  const { mode, tokens } = deriveTheme(palette);
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  root.style.colorScheme = mode;
  root.dataset.theme = mode;
}

/** A palette in canonical form, or null if it isn't three colours. */
export function normalizePalette(palette) {
  const entries = ROLES.map((role) => [role, parseHex(palette?.[role])]);
  return entries.every(([, value]) => value) ? Object.fromEntries(entries) : null;
}

export const samePalette = (a, b) => ROLES.every((role) => parseHex(a?.[role]) === parseHex(b?.[role]));

// --- Suggesting from art -----------------------------------------------------

const VIVID_SATURATION = 0.25;
/** Two colours at least this far apart in hue read as different colours. */
const HUE_APART = 35;

const hueDistance = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** The image's colours, most common first: { hsl, count }. */
function colorsOf(rgba) {
  const buckets = new Map();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    bucket.r += rgba[i];
    bucket.g += rgba[i + 1];
    bucket.b += rgba[i + 2];
    bucket.count++;
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .map(({ r, g, b, count }) => ({ hsl: rgbToHsl([r / count, g / count, b / count]), count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Palettes drawn from an image's RGBA pixels: a deep, a light and a bold
 * reading of it. Colours only need to be good starting points; deriveTheme
 * makes each one readable. [] for an image with nothing opaque in it.
 */
export function suggestPalettes(rgba) {
  const colors = colorsOf(rgba);
  if (!colors.length) return [];
  const [dominant] = colors;

  // Strong colours of the image, by how much of it they are and how vivid.
  const vivid = colors
    .filter(({ hsl: [, s, l] }) => s >= VIVID_SATURATION && l >= 0.2 && l <= 0.85)
    .map((color) => ({ ...color, score: color.count * color.hsl[1] * (1 - Math.abs(2 * color.hsl[2] - 1)) }))
    .sort((a, b) => b.score - a.score);
  const first = vivid[0]?.hsl ?? null;
  const second = first && vivid.find(({ hsl }) => hueDistance(hsl[0], first[0]) >= HUE_APART)?.hsl;

  // A greyscale image has no accent to give: go neutral.
  const accent = first ? hslToHex(first) : '#d9d9d9';
  const highlight = second ? hslToHex(second) : first ? hslToHex([(first[0] + 40) % 360, first[1], first[2]]) : '#ffffff';

  const [h, s] = dominant.hsl;
  const deep = hslToHex([h, Math.min(s, 0.35), 0.09]);
  const pale = hslToHex([h, Math.min(s, 0.45), 0.93]);
  const bold = first ? accent : hslToHex(dominant.hsl);
  const boldAccent = second ? highlight : '#ffffff';
  const boldHighlight = first ? hslToHex([first[0], 0.5, 0.9]) : '#ffffff';

  return [
    { primary: deep, secondary: accent, tertiary: highlight },
    { primary: pale, secondary: accent, tertiary: highlight },
    { primary: bold, secondary: boldAccent, tertiary: boldHighlight },
  ];
}
