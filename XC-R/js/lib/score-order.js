import { normaliseConfig } from './descriptors.js';

// Order of the targets in the score.
//
// Starting from a fixed shuffle (the same for every dyad), each target is
// followed by one that is clearly different from it: otherwise the players
// would already match the next target where they stand, and it would be
// reached without them doing anything.

// Smallest distance wanted between two consecutive targets, on the
// descriptor farthest apart (normalised, 0..1).
const MIN_STEP_DISTANCE = 0.3;

function seededShuffle(array, seed = 1) {
  // mulberry32: the same order every time for the same database
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function distance(a, b) {
  return Math.max(...a.map((value, i) => Math.abs(value - b[i])));
}

/**
 * @param {Array} targets      [{ id, values }], the targets to put in order
 * @param {Array} descriptors  [{ key, min, max }]
 * @returns {Array} their ids, in the order of the score
 */
export function orderScore(targets, descriptors) {
  const remaining = seededShuffle(targets).map((target) => ({
    id: target.id,
    config: normaliseConfig(target.values, descriptors),
  }));
  const ordered = [];

  while (remaining.length > 0) {
    const previous = ordered[ordered.length - 1];
    let pick = 0;
    if (previous) {
      // the first one far enough from the previous target, else the farthest
      pick = remaining.findIndex((candidate) => distance(candidate.config, previous.config) >= MIN_STEP_DISTANCE);
      if (pick < 0) {
        pick = remaining.reduce((best, candidate, i) => (
          distance(candidate.config, previous.config) > distance(remaining[best].config, previous.config) ? i : best
        ), 0);
      }
    }
    ordered.push(remaining.splice(pick, 1)[0]);
  }

  return ordered.map((target) => target.id);
}
