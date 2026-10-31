/**
 * Reading lyrics text, as pure functions: LRC ("[01:23.45] a line") when it
 * has timestamps, plain lines when it doesn't. The same reader serves lyrics
 * from LRCLIB and whatever's pasted into Track ▸ Edit Lyrics.
 */

const STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const STAMPS_AT_START = /^(?:\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/;
const OFFSET = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i;
const METADATA = /^\s*\[[a-z#]+:.*\]\s*$/i;

/** { synced, lines: [{ time, text }] }; `time` is null in plain lyrics. */
export function parseLyrics(text) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  const rows = source.split('\n');
  const offsetRow = rows.find((row) => OFFSET.test(row));
  // In LRC a positive offset shows lines sooner.
  const offset = offsetRow ? Number(OFFSET.exec(offsetRow)[1]) / 1000 : 0;

  const timed = [];
  for (const row of rows) {
    const stamps = STAMPS_AT_START.exec(row)?.[0];
    if (!stamps) continue;
    const words = row.slice(stamps.length).trim();
    for (const [, minutes, seconds] of stamps.matchAll(STAMP)) {
      timed.push({ time: Math.max(0, Number(minutes) * 60 + Number(seconds.replace(':', '.')) - offset), text: words });
    }
  }
  if (timed.length) return { synced: true, lines: timed.sort((a, b) => a.time - b.time) };

  const plain = rows.filter((row) => !METADATA.test(row)).map((row) => row.trimEnd());
  while (plain.length && !plain[0].trim()) plain.shift();
  while (plain.length && !plain.at(-1).trim()) plain.pop();
  return { synced: false, lines: plain.map((line) => ({ time: null, text: line })) };
}

/** The index of the line showing at `position` seconds, or -1 before the first. */
export function lineAt(lines, position) {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lines[middle].time <= position) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
