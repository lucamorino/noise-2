// Sound descriptors of a player's sound, analysed on the phone (RNBO for
// sharpness, Essentia for the others; see lib/sound-analysis.js), shared by
// every part of the system: the radar in the background of the player, the
// matching against targets (server) and the logs. Same set as B3-T0G3TH3R
// and The Contested Zone.
//
// - min, max: the range drawn on the radar, to which values are normalised.
//   These are the defaults; a calibration of the patch (see the README)
//   stores ranges fitted to what the patch can actually reach, which the
//   server then publishes in `global.descriptors`.
export const DESCRIPTORS = [
  { key: 'sharpness',          label: 'Sharpness',  min: 0.5, max: 3 },
  { key: 'loudness',           label: 'Loudness',   min: 0,   max: 100 },
  { key: 'spectralCentroid',   label: 'Centroid',   min: 0,   max: 4000 },
  { key: 'dissonance',         label: 'Dissonance', min: 0,   max: 0.5 },
  { key: 'spectralComplexity', label: 'Complexity', min: 0,   max: 60 },
];

/**
 * A descriptor's value mapped to 0..1 over its range (clamped).
 */
export function normalise(descriptor, value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, (value - descriptor.min) / (descriptor.max - descriptor.min)));
}

/**
 * A configuration ({ [key]: value } in descriptor units) as normalised
 * values, in the order of `descriptors`.
 */
export function normaliseConfig(config, descriptors = DESCRIPTORS) {
  return descriptors.map((d) => normalise(d, config?.[d.key]));
}

/**
 * How close a sound is to a target configuration: 1 minus the normalised
 * distance of the descriptor farthest from it. A sound matches its target
 * when closeness >= 1 - tolerance, i.e. when every descriptor is within
 * `tolerance` of the target on its range.
 */
export function closenessTo(values, config, descriptors = DESCRIPTORS) {
  const target = normaliseConfig(config, descriptors);
  const distances = descriptors.map((d, i) => Math.abs(normalise(d, values?.[d.key]) - target[i]));
  return 1 - Math.max(...distances);
}
