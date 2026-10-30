/**
 * Generated default art: the last step of the art chain (store/art.js).
 *
 * A track with no art of its own gets a symbol drawn from a seed (its audio
 * fingerprint; see art.js symbolSeed): a flowing, brush-stroke shape in one
 * colour family, on a transparent background, kept clear of the edges. The
 * same seed always draws the same symbol, on any machine, so a track keeps
 * its symbol in a friend's copy of the playlist.
 *
 * Eight recipes, each a few rules for laying down strokes, with every curve,
 * width and colour picked by a random number generator seeded from the track:
 *
 *   splash   one fat stroke with flicks off it and droplets around it
 *   flow     a bundle of strands that pinch together and fan apart
 *   curl     a stroke that winds into a curl, thin strands riding along it
 *   tail     a plume swelling into an S, with a pale tip and tufts
 *   ribbon   a band that twists over as it arcs, its back face darker
 *   twin     two curls interlocking, turned half a turn from each other
 *   wave     a lead-in curve, then a swoop the other way into a curling lip
 *   planet   an orbit swept round a planet, a chain of moons, rings, a crescent
 *
 * Drawing one takes about a millisecond, and nothing is stored: symbols are
 * drawn as they're needed, and kept by URL for a while (symbolUrl).
 *
 * Pure, apart from symbolPng (which needs a canvas), so it runs in the unit
 * tests. Changing anything here that consumes randomness changes every
 * track's symbol: treat the recipes as fixed once shipped.
 */

const TAU = Math.PI * 2;

// ---- Seeded randomness ------------------------------------------------------

/** FNV-1a: a seed string to 32 bits. */
function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: small, fast, and the same sequence everywhere. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const range = (r, a, b) => a + r() * (b - a);
const pick = (r, list) => list[Math.floor(r() * list.length)];
const int = (r, a, b) => Math.floor(range(r, a, b + 1));
const side = (r) => (r() < 0.5 ? -1 : 1);

/** A smooth random function on [0, 1]: a few sine waves added together. */
function wave(r, terms, amplitude) {
  const parts = Array.from({ length: terms }, (_, k) => ({
    f: range(r, 0.6, 1.4) * (k + 1),
    p: range(r, 0, TAU),
    a: (amplitude * range(r, 0.5, 1)) / (k + 1),
  }));
  return (u) => parts.reduce((sum, w) => sum + w.a * Math.sin(w.f * Math.PI * u + w.p), 0);
}

// ---- Geometry ---------------------------------------------------------------
// Shapes are closed polygons: arrays of [x, y].

/** A path made by walking forward and turning by curvature(u) as it goes. */
function walk({ x = 0, y = 0, angle = 0, length = 100, steps = 140, curvature }) {
  const points = [[x, y]];
  const ds = length / steps;
  for (let i = 1; i <= steps; i++) {
    angle += curvature(i / steps) * ds;
    x += Math.cos(angle) * ds;
    y += Math.sin(angle) * ds;
    points.push([x, y]);
  }
  return points;
}

function normals(points) {
  return points.map((_, i) => {
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, points.length - 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
}

function headingAt(points, i) {
  const a = points[Math.max(i - 1, 0)];
  const b = points[Math.min(i + 1, points.length - 1)];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

/** The outline of a band of width(u) along points, shifted sideways by offset(u). */
function ribbon(points, width, offset = () => 0) {
  const ns = normals(points);
  const n = points.length - 1;
  const left = [];
  const right = [];
  points.forEach(([x, y], i) => {
    const u = i / n;
    const w = Math.max(0, width(u)) / 2;
    const o = offset(u);
    left.push([x + ns[i][0] * (o + w), y + ns[i][1] * (o + w)]);
    right.push([x + ns[i][0] * (o - w), y + ns[i][1] * (o - w)]);
  });
  return [...left, ...right.reverse()];
}

/** A brush profile: 0 at both ends, `max` at the bulge; skew < 1 bulges early. */
const brush = (max, skew = 1, power = 0.75) => (u) => max * Math.pow(Math.sin(Math.PI * Math.pow(u, skew)), power);

/** A teardrop pointing along `angle`. */
function drop(x, y, size, angle, stretch = 1.8) {
  const points = [];
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * TAU;
    const along = Math.cos(t) * size * (Math.cos(t) > 0 ? stretch : 1);
    const across = Math.sin(t) * size * (0.55 + (0.45 * (1 - Math.cos(t))) / 2);
    points.push([x + along * Math.cos(angle) - across * Math.sin(angle), y + along * Math.sin(angle) + across * Math.cos(angle)]);
  }
  return points;
}

const circle = (x, y, radius, steps = 72) =>
  Array.from({ length: steps }, (_, i) => [x + Math.cos((i / steps) * TAU) * radius, y + Math.sin((i / steps) * TAU) * radius]);

const rotate = (points, angle) =>
  points.map(([x, y]) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)]);

/** A shape shaded along its stroke, from the path's start to its end (stops: [offset, shade]). */
const along = (points, path, stops) => ({ points, along: [path[0], path[path.length - 1]], stops });
const BASE_TO_TIP = [[0, 0], [0.4, 1], [0.8, 2], [1, 3]];

// ---- Colour -----------------------------------------------------------------

const HUES = [
  ['teal', 170], ['cyan', 188], ['azure', 205], ['blue', 222], ['indigo', 245],
  ['violet', 270], ['magenta', 298], ['pink', 326], ['crimson', 346], ['red', 4],
  ['orange', 22], ['amber', 38], ['yellow', 50], ['lime', 80], ['green', 138],
  ['white', null],
];
const hsl = (h, s, l) => `hsl(${((h % 360) + 360) % 360},${s}%,${l}%)`;

/** Four shades of one saturated colour (or white), darkest first. */
function palette(r) {
  const [name, hue] = pick(r, HUES);
  if (hue === null) {
    const tint = range(r, 0, 360);
    return { name, shades: [hsl(tint, 35, 80), hsl(tint, 40, 88), hsl(tint, 50, 94), '#ffffff'] };
  }
  const warmLight = hue >= 35 && hue <= 90; // yellows go olive when dark
  const tone = pick(r, warmLight ? ['vivid', 'bright'] : ['deep', 'vivid', 'vivid', 'bright']);
  const l = { deep: 32, vivid: 48, bright: 60 }[tone] + (warmLight ? 4 : 0);
  return {
    name: `${tone} ${name}`,
    shades: [hsl(hue - 6, 88, l - 9), hsl(hue, 92, l), hsl(hue + 5, 96, l + 9), hsl(hue + 10, 100, l + 18)],
  };
}

// ---- Recipes ----------------------------------------------------------------
// Each returns { layers: [{ shapes, shade }], cuts: [shape] }, in any units
// (the result is scaled to fit). shade is an index into the four shades,
// 'gradient' (one across the whole symbol) or 'along' (per shape, see along()).
// cuts are holes through everything.

function splash(r) {
  const spine = walk({ angle: range(r, 0, TAU), length: 100, curvature: wave(r, 3, range(r, 0.025, 0.05)) });
  const n = spine.length - 1;
  const ns = normals(spine);
  const width = brush(range(r, 13, 19), range(r, 0.6, 1.5), range(r, 0.5, 0.8));
  const body = [ribbon(spine, width)];

  for (let k = int(r, 2, 4); k > 0; k--) {
    const i = Math.floor(range(r, 0.15, 0.85) * n);
    const path = walk({
      x: spine[i][0], y: spine[i][1],
      angle: headingAt(spine, i) + side(r) * range(r, 0.5, 1.1),
      length: range(r, 14, 32), steps: 50,
      curvature: wave(r, 2, range(r, 0.04, 0.09)),
    });
    const start = width(i / n) * range(r, 0.45, 0.7);
    body.push(ribbon(path, (u) => start * Math.pow(1 - u, 0.9)));
  }

  // Droplets, mostly off the ends.
  const drops = [];
  for (let k = int(r, 3, 8); k > 0; k--) {
    const u = r() < 0.6 ? pick(r, [range(r, 0, 0.12), range(r, 0.88, 1)]) : range(r, 0.15, 0.85);
    const i = Math.floor(u * n);
    const s = side(r);
    const gap = width(u) / 2 + range(r, 3, 9);
    const heading = headingAt(spine, i) + (u > 0.5 ? 0 : Math.PI);
    drops.push(drop(spine[i][0] + ns[i][0] * gap * s, spine[i][1] + ns[i][1] * gap * s, range(r, 1, 2.6), heading + range(r, -0.6, 0.6)));
  }

  // Slits along the fat middle.
  const cuts = [];
  for (let k = int(r, 0, 3); k > 0; k--) {
    const c = Math.floor(range(r, 0.3, 0.7) * n);
    const half = Math.floor(range(r, 0.06, 0.12) * n);
    const w = width(c / n);
    const shift = range(r, -0.2, 0.2) * w;
    cuts.push(ribbon(spine.slice(c - half, c + half + 1), brush(w * range(r, 0.15, 0.3), 1, 0.9), () => shift));
  }

  return { layers: [{ shapes: body, shade: 'gradient' }, { shapes: drops, shade: 2 }], cuts };
}

function flow(r) {
  const spine = walk({ angle: range(r, 0, TAU), length: 110, curvature: wave(r, 3, range(r, 0.03, 0.06)) });
  const n = spine.length - 1;
  const pinch = wave(r, 2, 1);
  const spread = (u) => 3 + 9 * Math.abs(pinch(u));

  const strands = [];
  const count = int(r, 6, 11);
  for (let k = 0; k < count; k++) {
    const thick = k < 2;
    const start = thick ? range(r, 0, 0.08) : range(r, 0, 0.35);
    const end = thick ? range(r, 0.9, 1) : range(r, 0.6, 1);
    const lane = range(r, -1, 1);
    const drift = wave(r, 2, 0.5);
    const at = (u) => start + u * (end - start);
    strands.push({
      shade: thick ? pick(r, [1, 1, 2]) : pick(r, [0, 2, 3]),
      points: ribbon(
        spine.slice(Math.floor(start * n), Math.ceil(end * n) + 1),
        brush(thick ? range(r, 6, 10) : range(r, 0.7, 2.6), range(r, 0.6, 1.5), 0.7),
        (u) => (lane + drift(at(u))) * spread(at(u)),
      ),
    });
  }
  // The main shade first, so the thin strands lie over it.
  return {
    layers: [1, 0, 2, 3].map((shade) => ({ shapes: strands.filter((s) => s.shade === shade).map((s) => s.points), shade })),
    cuts: [],
  };
}

function curl(r) {
  const sign = side(r);
  const k0 = range(r, 0.005, 0.02);
  const k1 = range(r, 0.06, 0.12);
  const wobble = wave(r, 2, 0.015);
  const spine = walk({ angle: range(r, 0, TAU), length: range(r, 110, 140), curvature: (u) => sign * (k0 + k1 * u * u * u) + wobble(u) });
  const n = spine.length - 1;
  const main = range(r, 11, 16);
  const body = [ribbon(spine, brush(main, range(r, 0.45, 0.8), 0.7))];

  const riders = [];
  for (let k = int(r, 2, 4); k > 0; k--) {
    const start = range(r, 0, 0.3);
    const end = range(r, 0.55, 0.85);
    const lane = sign * side(r) * range(r, 0.7, 1.1) * main * 0.6 + range(r, -1.5, 1.5);
    riders.push(ribbon(spine.slice(Math.floor(start * n), Math.ceil(end * n) + 1), brush(range(r, 0.8, 2.2), 1, 0.7), () => lane));
  }

  // A few drops flung back off the open end.
  const drops = [];
  const back = headingAt(spine, 0) + Math.PI;
  for (let k = int(r, 0, 3); k > 0; k--) {
    const d = range(r, 6, 16);
    const a = back + range(r, -0.5, 0.5);
    drops.push(drop(spine[0][0] + Math.cos(a) * d, spine[0][1] + Math.sin(a) * d, range(r, 1, 2.2), a));
  }
  return {
    layers: [{ shapes: body, shade: 'gradient' }, { shapes: riders, shade: 3 }, { shapes: drops, shade: 2 }],
    cuts: [],
  };
}

function tail(r) {
  const sign = side(r);
  // Sweeps one way at the root, then hooks back the other way toward the tip: an S.
  const root = range(r, 0.02, 0.04);
  const hook = range(r, 0.05, 0.09);
  const wobble = wave(r, 2, 0.008);
  const spine = walk({ angle: range(r, 0, TAU), length: 110, curvature: (u) => sign * (root - (root + hook) * Math.pow(u, 1.5)) + wobble(u) });
  const n = spine.length - 1;
  const ns = normals(spine);
  const width = brush(range(r, 14, 19), range(r, 1.3, 1.7), range(r, 0.6, 0.75));
  const tip = range(r, 0.78, 0.88);
  const body = [along(ribbon(spine, width), spine, [[0, 0], [0.4, 1], [tip - 0.12, 2], [tip, 3], [1, 3]])];

  // Tufts: thin flicks off the edges, swept toward the tip.
  const tufts = [];
  for (let k = int(r, 2, 5); k > 0; k--) {
    const u = range(r, 0.45, 0.85);
    const i = Math.floor(u * n);
    const s = side(r);
    const edge = (width(u) / 2) * 0.85;
    const bend = -s * range(r, 0.02, 0.06);
    const path = walk({
      x: spine[i][0] + ns[i][0] * edge * s, y: spine[i][1] + ns[i][1] * edge * s,
      angle: headingAt(spine, i) + s * range(r, 0.2, 0.5),
      length: range(r, 6, 12), steps: 30, curvature: () => bend,
    });
    tufts.push(ribbon(path, (v) => 2.2 * Math.pow(1 - v, 0.8)));
  }
  return { layers: [{ shapes: body, shade: 'along' }, { shapes: tufts, shade: 1 }], cuts: [] };
}

function twistedRibbon(r) {
  const sign = side(r);
  const arc = range(r, 0.022, 0.034);
  const flip = r() < 0.4 ? range(r, 0.45, 0.6) : 2; // past 1 it never flips: a plain arc, not an S
  const wobble = wave(r, 2, 0.012);
  const spine = walk({ angle: range(r, 0, TAU), length: 110, curvature: (u) => sign * arc * (u < flip ? 1 : -1) + wobble(u) });
  const n = spine.length - 1;
  const twists = pick(r, [2, 2, 2, 3, 3, 3, 4]);
  const main = range(r, 12, 18);
  const envelope = brush(1, range(r, 0.7, 1.4), 0.4);

  // Each stretch between twists is a lens; alternate ones are the back face.
  const front = [];
  const back = [];
  for (let k = 0; k < twists; k++) {
    const i0 = Math.floor((k / twists) * n);
    const i1 = Math.ceil(((k + 1) / twists) * n);
    const width = (u) => main * Math.sin(Math.PI * u) * envelope((i0 + u * (i1 - i0)) / n);
    (k % 2 ? back : front).push(ribbon(spine.slice(i0, i1 + 1), width));
  }
  return { layers: [{ shapes: back, shade: 0 }, { shapes: front, shade: 'gradient' }], cuts: [] };
}

function twin(r) {
  const sign = side(r);
  const k0 = range(r, 0.015, 0.03);
  const k1 = range(r, 0.02, 0.05);
  const length = range(r, 80, 100);
  const gap = range(r, 3, 6);
  const main = range(r, 16, 22);
  const skew = range(r, 0.6, 1);
  const arm = walk({ x: gap, y: 0, angle: Math.PI / 2, length, curvature: (u) => sign * (k0 + k1 * (1 - u)) });
  const outline = ribbon(arm, (u) => main * Math.pow(Math.sin(Math.PI * Math.pow(Math.max(u, 0.02), skew)), 0.6));
  const shapes = [0, Math.PI].map((a) => along(rotate(outline, a), rotate(arm, a), BASE_TO_TIP));
  return { layers: [{ shapes, shade: 'along' }], cuts: [] };
}

/** Whether a stroke along `points`, width(u) wide, runs into an earlier part of itself. */
function touchesItself(points, width, margin) {
  const n = points.length - 1;
  for (let i = Math.floor(n * 0.5); i <= n; i += 2) {
    for (let j = 0; j < i - 40; j += 2) {
      const reach = (width(i / n) + width(j / n)) / 2 + margin;
      if (Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]) < reach) return true;
    }
  }
  return false;
}

function crashingWave(r) {
  const sign = side(r);
  const lead = 0.15 + 4.5 * Math.pow((r() + r()) / 2, 1.2); // radians: nearly flat to ¾ of a circle, mostly between
  const split = range(r, 0.35, 0.5);
  const length = range(r, 120, 140);
  const main = range(r, 20, 28);
  const width = brush(main, Math.log(0.5) / Math.log(split), range(r, 0.6, 0.75)); // heaviest at the split
  const curvature = (swoop) => (u) =>
    u < split
      ? (sign * lead * Math.PI * Math.sin((Math.PI * u) / split)) / (2 * split * length)
      : (-sign * swoop * 2.2 * Math.pow((u - split) / (1 - split), 1.2)) / ((1 - split) * length);

  // Back the swoop off until the lip clears the rest of the wave: it never closes on itself.
  let swoop = range(r, 4, 5);
  let spine;
  for (let tries = 0; tries < 20; tries++, swoop *= 0.95) {
    spine = walk({ angle: 0, length, steps: 180, curvature: curvature(swoop) });
    if (!touchesItself(spine, width, 1.5)) break;
  }
  const n = spine.length - 1;
  const ns = normals(spine);
  const body = along(ribbon(spine, width), spine, [[0, 0], [0.4, 1], [0.75, 2], [1, 3]]);

  // Lines of water inside the swell.
  const lines = [];
  for (let j = int(r, 1, 3); j > 0; j--) {
    const a = range(r, 0.05, 0.25);
    const b = range(r, 0.55, 0.75);
    const lane = range(r, -0.25, 0.25) * main;
    lines.push(ribbon(spine.slice(Math.floor(a * n), Math.ceil(b * n) + 1), brush(range(r, 0.8, 1.6), 1, 0.7), () => lane));
  }

  // Foam claws off the outside of the lip, and spray beyond them.
  const outward = sign;
  const foam = [];
  for (let j = int(r, 3, 5); j > 0; j--) {
    const u = range(r, split + 0.08, 0.72);
    const i = Math.floor(u * n);
    const edge = (width(u) / 2) * 0.8;
    const angle = headingAt(spine, i) + outward * range(r, 0.3, 0.7);
    const length = range(r, 7, 14);
    const bend = -outward * range(r, 0.04, 0.1);
    const path = walk({ x: spine[i][0] + ns[i][0] * edge * outward, y: spine[i][1] + ns[i][1] * edge * outward, angle, length, steps: 30, curvature: () => bend });
    const w = range(r, 2, 3.5);
    foam.push(ribbon(path, (v) => w * Math.pow(1 - v, 0.8)));
  }
  const drops = [];
  for (let j = int(r, 2, 6); j > 0; j--) {
    const u = range(r, split, 0.8);
    const i = Math.floor(u * n);
    const d = width(u) / 2 + range(r, 6, 16);
    const a = headingAt(spine, i) + outward * range(r, 0.6, 1.4);
    drops.push(drop(spine[i][0] + ns[i][0] * d * outward, spine[i][1] + ns[i][1] * d * outward, range(r, 0.9, 2), a));
  }
  return {
    layers: [
      { shapes: [body], shade: 'along' },
      { shapes: lines, shade: 3 },
      { shapes: foam, shade: 2 },
      { shapes: drops, shade: 3 },
    ],
    cuts: [],
  };
}

/** Half an elliptical band (a planet's ring), from angle `from` to `from` + π. */
function ringHalf(rx, ry, band, from) {
  const outer = [];
  const inner = [];
  for (let i = 0; i <= 48; i++) {
    const t = from + (i / 48) * Math.PI;
    const b = band * (0.55 + 0.45 * Math.abs(Math.sin(t))); // thinner where it's seen edge-on
    outer.push([Math.cos(t) * (rx + b / 2), Math.sin(t) * (ry + b / 2)]);
    inner.push([Math.cos(t) * (rx - b / 2), Math.sin(t) * (ry - b / 2)]);
  }
  return [...outer, ...inner.reverse()];
}

function planet(r) {
  // Mostly the abstract ones: an orbit swept round a planet, a chain of moons.
  const kind = pick(r, ['orbit', 'orbit', 'orbit', 'orbit', 'cluster', 'cluster', 'cluster', 'cluster', 'ringed', 'crescent']);
  const R = 24;
  const behind = [];
  const body = [];
  const front = [];
  const light = [];
  const cuts = [];

  if (kind === 'cluster') {
    // Moons along an arc, shrinking as they go.
    const count = int(r, 3, 5);
    const sweep = range(r, 1.6, 2.6);
    const start = range(r, 0, TAU);
    const orbit = range(r, 26, 34);
    for (let k = 0; k < count; k++) {
      const t = start + (k / (count - 1)) * sweep;
      (k === 0 ? body : light).push(circle(Math.cos(t) * orbit, Math.sin(t) * orbit, R * 0.55 * Math.pow(0.72, k) + 2));
    }
  } else {
    body.push(circle(0, 0, R));
    if (kind === 'crescent') {
      const a = range(r, 0, TAU);
      const d = R * range(r, 0.35, 0.55);
      cuts.push(circle(Math.cos(a) * d, Math.sin(a) * d, R * range(r, 0.85, 0.95)));
    }
    if (kind === 'ringed') {
      const rx = R * range(r, 1.6, 2.1);
      const ry = rx * range(r, 0.18, 0.32);
      const band = range(r, 3, 6);
      behind.push(ringHalf(rx, ry, band, Math.PI));
      front.push(ringHalf(rx, ry, band, 0));
    }
  }

  // An orbit: a thin brush arc swept round, often with a moon at its end.
  if (kind !== 'ringed' && (kind !== 'crescent' || r() < 0.5)) {
    const orbit = R * range(r, 1.35, 1.7);
    const start = range(r, 0, TAU);
    const sweep = range(r, 2.2, 3.6);
    const path = Array.from({ length: 80 }, (_, i) => {
      const t = start + (i / 79) * sweep;
      return [Math.cos(t) * orbit, Math.sin(t) * orbit];
    });
    front.push(ribbon(path, brush(range(r, 2, 3.5), range(r, 0.6, 1.4), 0.8)));
    if (r() < 0.8) light.push(circle(path[79][0], path[79][1], range(r, 2.5, 4.5)));
  }
  return {
    layers: [
      { shapes: behind, shade: 0 },
      { shapes: body, shade: 'gradient' },
      { shapes: front, shade: 2 },
      { shapes: light, shade: 3 },
    ],
    cuts,
  };
}

export const RECIPES = {
  splash,
  flow,
  curl,
  tail,
  ribbon: twistedRibbon,
  twin,
  wave: crashingWave,
  planet,
};
/** How often each is drawn, relative to the others. */
const WEIGHTS = { splash: 2, flow: 3, curl: 3, tail: 3, ribbon: 3, twin: 3, wave: 3, planet: 3 };
const POOL = Object.entries(WEIGHTS).flatMap(([name, weight]) => Array(weight).fill(name));

// ---- Drawing ----------------------------------------------------------------

/** How far (of 100) the symbol keeps from every edge. */
export const SYMBOL_PAD = 13;

const pathData = (points) => `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z`;

/**
 * Draw the symbol for `seed` (a string): { recipe, colour, svg }, svg being a
 * standalone 100×100 SVG document. `recipe` forces one (for sample sheets).
 */
export function drawSymbol(seed, { recipe } = {}) {
  const number = hashString(String(seed));
  const r = rng(number);
  const name = recipe ?? pick(r, POOL);
  const colours = palette(r);
  const drawing = RECIPES[name](r);
  const spin = range(r, 0, TAU);
  const id = `s${number.toString(36)}`;

  // Turn the whole symbol, then fit it inside the padded square, centred.
  const shapeOf = (shape) => (Array.isArray(shape) ? shape : shape.points);
  const all = rotate(drawing.layers.flatMap((layer) => layer.shapes.flatMap(shapeOf)), spin);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of all) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const scale = (100 - SYMBOL_PAD * 2) / Math.max(maxX - minX, maxY - minY);
  const place = (points) =>
    rotate(points, spin).map(([x, y]) => [50 + (x - (minX + maxX) / 2) * scale, 50 + (y - (minY + maxY) / 2) * scale]);

  const angle = range(r, 0, 360);
  const defs = [
    `<linearGradient id="${id}-grad" gradientTransform="rotate(${angle.toFixed(0)} .5 .5)">` +
      `<stop offset="0" stop-color="${colours.shades[0]}"/><stop offset=".45" stop-color="${colours.shades[1]}"/>` +
      `<stop offset="1" stop-color="${colours.shades[3]}"/></linearGradient>`,
  ];
  let mask = '';
  if (drawing.cuts.length) {
    defs.push(
      `<mask id="${id}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/>` +
        drawing.cuts.map((cut) => `<path d="${pathData(place(cut))}" fill="#000"/>`).join('') +
        `</mask>`,
    );
    mask = ` mask="url(#${id}-cut)"`;
  }

  let gradients = 0;
  const fillOf = (shape, shade) => {
    if (shade === 'gradient') return `url(#${id}-grad)`;
    if (shade !== 'along') return colours.shades[shade];
    const [[x1, y1], [x2, y2]] = place(shape.along);
    const gradient = `${id}-a${gradients++}`;
    defs.push(
      `<linearGradient id="${gradient}" gradientUnits="userSpaceOnUse" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}">` +
        shape.stops.map(([offset, k]) => `<stop offset="${offset}" stop-color="${colours.shades[k]}"/>`).join('') +
        `</linearGradient>`,
    );
    return `url(#${gradient})`;
  };
  const body = drawing.layers
    .flatMap(({ shapes, shade }) => shapes.map((shape) => `<path d="${pathData(place(shapeOf(shape)))}" fill="${fillOf(shape, shade)}"/>`))
    .join('');

  return {
    recipe: name,
    colour: colours.name,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${defs.join('')}</defs><g${mask}>${body}</g></svg>`,
  };
}

// ---- URLs -------------------------------------------------------------------

const MAX_KEPT = 300;
const urls = new Map();

/** A data: URL of the symbol for `seed`, kept for reuse (a long list redraws nothing). */
export function symbolUrl(seed) {
  const key = String(seed);
  let url = urls.get(key);
  if (url) {
    urls.delete(key); // re-insert: most recently used last
  } else {
    url = `data:image/svg+xml,${encodeURIComponent(drawSymbol(key).svg)}`;
    if (urls.size >= MAX_KEPT) urls.delete(urls.keys().next().value);
  }
  urls.set(key, url);
  return url;
}

/**
 * The symbol as a PNG Blob, size × size, on `background` (for the OS media
 * overlay, which takes no SVG and shows transparency badly). Needs a DOM.
 */
export async function symbolPng(seed, { size = 512, background = null } = {}) {
  const image = new Image();
  image.src = symbolUrl(seed);
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, size, size);
  }
  context.drawImage(image, 0, 0, size, size);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png'));
}
