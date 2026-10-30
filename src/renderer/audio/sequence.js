/**
 * Play order (PLAN.md §5 "Shuffle — permutation with a cursor", "Linked
 * tracks — chains are atomic"), as pure functions over the engine's queue.
 *
 * The queue is the playing playlist in display order. A track's `linkNext`
 * names the track that must follow it. A link only counts when that track is
 * the very next one in the queue: chains are contiguous by definition, so a
 * link that stopped being contiguous (a template change regrouped the
 * playlist, say) is simply not a link, rather than a chain that half works.
 *
 * Units are what the order is made of: a chain, or a single unlinked track.
 * Shuffle permutes units, then plays each one's tracks in order, so a chain
 * can never be broken up and only its head is ever a shuffle entry point.
 *
 * A shuffle is a list of track ids in play order plus a cursor walking it.
 * Previous walks back (real history), every track plays once per cycle
 * (shuffle-remaining for free), and a queue edit keeps the order: units stay
 * where they were, and new ones land at random positions not yet played.
 *
 * `random` is injectable (() => [0, 1)) so tests are deterministic.
 */

/** Units as arrays of queue indices, in queue order. */
export function unitsOf(queue) {
  const units = [];
  queue.forEach((track, i) => {
    if (i > 0 && queue[i - 1].linkNext === track.id) units.at(-1).push(i);
    else units.push([i]);
  });
  return units;
}

/** Units as arrays of track ids. */
export const unitIdsOf = (queue) => unitsOf(queue).map((unit) => unit.map((i) => queue[i].id));

/** Fisher–Yates over a copy. */
function shuffled(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * A fresh shuffle of the queue's units, as track ids.
 *   first      a track id whose unit goes first (turning shuffle on mid-song:
 *              the playing unit stays where it is, at the start)
 *   notFirst   a track id whose unit must not go first (a new cycle mustn't
 *              open with the unit that just ended it)
 */
export function shuffleQueue(queue, random = Math.random, { first = null, notFirst = null } = {}) {
  const units = unitIdsOf(queue);
  const leading = first ? units.find((unit) => unit.includes(first)) : null;
  const rest = shuffled(leading ? units.filter((unit) => unit !== leading) : units, random);
  if (!leading && notFirst && rest.length > 1 && rest[0].includes(notFirst)) {
    const swap = 1 + Math.floor(random() * (rest.length - 1));
    [rest[0], rest[swap]] = [rest[swap], rest[0]];
  }
  return (leading ? [leading, ...rest] : rest).flat();
}

/**
 * Carry a shuffle across a queue change. Units keep their relative order
 * (ranked by where their tracks were); units with no known track (added, or
 * newly linked into being) go at random places after the cursor's unit.
 *
 * `pos` is the cursor: the index of the current track in `ids`, or a
 * half-step (n - 0.5) when the current track has left the queue, meaning
 * "between two tracks". Returns { ids, pos } in the same terms.
 */
export function reconcileShuffle(ids, pos, queue, currentId, random = Math.random) {
  const rank = new Map(ids.map((id, i) => [id, i]));
  const units = unitIdsOf(queue);
  const known = [];
  const added = [];
  for (const unit of units) {
    const ranks = unit.map((id) => rank.get(id)).filter((r) => r !== undefined);
    if (ranks.length) known.push({ unit, rank: Math.min(...ranks) });
    else added.push(unit);
  }
  known.sort((a, b) => a.rank - b.rank);
  const order = known.map(({ unit }) => unit);

  // Everything up to and including the current unit has had its turn.
  const currentUnit = order.findIndex((unit) => unit.includes(currentId));
  const played = currentUnit >= 0 ? currentUnit + 1 : order.filter((_, i) => known[i].rank <= pos).length;
  for (const unit of shuffled(added, random)) {
    const at = played + Math.floor(random() * (order.length - played + 1));
    order.splice(at, 0, unit);
  }

  const next = order.flat();
  const at = next.indexOf(currentId);
  if (at >= 0) return { ids: next, pos: at };
  const before = order.slice(0, played).flat().length;
  return { ids: next, pos: before - 0.5 };
}

/**
 * The user picked a track while shuffling: its unit moves to just after the
 * cursor, so it plays now and isn't heard again this cycle. The cursor ends
 * just before the unit; the caller starts the picked track (mid-chain picks
 * start there and play out the rest of the chain).
 */
export function bringForward(ids, pos, unit) {
  const inUnit = new Set(unit);
  const removedBefore = ids.slice(0, Math.floor(pos) + 1).filter((id) => inUnit.has(id)).length;
  const rest = ids.filter((id) => !inUnit.has(id));
  const at = Math.max(0, Math.floor(pos) + 1 - removedBefore);
  return { ids: [...rest.slice(0, at), ...unit, ...rest.slice(at)], pos: at - 0.5 };
}
