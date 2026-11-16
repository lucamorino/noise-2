// ---------------------------------------------------------------------
// PRESET SPACE (ported from BH1)
// The presets are read from a text file and placed as points on the pad.
// Any position of the pad is turned into a full set of parameters by a
// kernel regression fitted on those points.
// ---------------------------------------------------------------------
export const PRESETS_URL = 'assets/BH1-presets.txt';

// Kernel width of the regression, in pad units (0-1). Small values make each
// preset a distinct plateau, large values blur all presets together.
export const PRESET_KERNEL_WIDTH = 0.15;

// Number of values per preset: style (1-3), fb_gain (4), fb_trim (5),
// fade (6) and mod (7).
const PRESET_SIZE = 7;

// Parse the coll-style presets file: "index, v1 v2 ... v7;"
export function parsePresets(text) {
  return text
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const comma = entry.indexOf(',');
      const values = entry
        .slice(comma + 1)
        .trim()
        .split(/\s+/)
        .map(Number);
      if (comma < 0 || values.length < PRESET_SIZE || values.some((v) => !Number.isFinite(v))) {
        console.warn('Ignoring malformed preset:', entry);
        return null;
      }
      return { index: Number(entry.slice(0, comma)), values: values.slice(0, PRESET_SIZE) };
    })
    .filter(Boolean);
}

export async function loadPresets(url = PRESETS_URL) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannot load presets file ${url} (${response.status})`);
  }
  return parsePresets(await response.text());
}

// Distribute the presets on a regular grid stretched over the whole pad (0-1
// coordinates), in file order: left to right, top to bottom. The outer
// presets sit on the corners and borders of the pad: 9 presets give a 3x3
// grid with presets 1, 3, 7, 9 on the corners, 2, 4, 6, 8 in the middle of
// the borders and 5 in the center.
export function layoutPresets(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  // a single row/column sits in the middle of the pad
  const pos = (i, n) => (n > 1 ? i / (n - 1) : 0.5);
  const points = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    points.push({ x: pos(col, cols), y: pos(row, rows) });
  }
  return points;
}

// Kernel regression (Nadaraya-Watson, gaussian kernel) over the preset
// points. The output is always a weighted average of the presets, so the
// morph is continuous and never leaves the range of values the presets
// were tuned in.
export function createPresetSpace(presets, kernelWidth = PRESET_KERNEL_WIDTH) {
  const positions = layoutPresets(presets.length);
  const points = presets.map((preset, i) => ({ ...positions[i], preset }));
  const k = 1 / (2 * kernelWidth * kernelWidth);

  function weightsAt(x, y) {
    // subtract the smallest distance before exp() so that at least one
    // weight is 1 and the sum can never underflow to 0
    const d2 = points.map((p) => (p.x - x) ** 2 + (p.y - y) ** 2);
    const d2min = Math.min(...d2);
    const w = d2.map((d) => Math.exp(-(d - d2min) * k));
    const sum = w.reduce((a, b) => a + b, 0);
    return w.map((v) => v / sum);
  }

  function valuesAt(x, y) {
    const w = weightsAt(x, y);
    const out = new Array(PRESET_SIZE).fill(0);
    points.forEach((p, i) => {
      for (let j = 0; j < PRESET_SIZE; j++) out[j] += w[i] * p.preset.values[j];
    });
    return out;
  }

  return { points, weightsAt, valuesAt };
}

// Bind a preset space to an RNBO device. `apply(x, y)` morphs the device to
// the given position of the space (0-1 coordinates):
// - `style` goes to the `style` inport as a 3-value list (and to the
//   `del` / `phase` / `bp` params where the device still has them)
// - `fb_gain` and `fb_trim` go to their params
// - `fade` and `mod` go to their inports (or params), when the device has them
export function bindPresetSpace(space, { hasInport, sendToInport, setParam }) {
  let lastSent = null;

  function apply(x, y) {
    if (space.points.length === 0) return null;
    const v = space.valuesAt(x, y);
    const changed = (from, to) =>
      !lastSent || v.slice(from, to).some((val, j) => val !== lastSent[from + j]);

    if (changed(0, 3)) {
      const style = v.slice(0, 3);
      if (hasInport('style')) sendToInport('style', style);
      ['del', 'phase', 'bp'].forEach((name, j) => setParam(name, style[j]));
    }
    if (changed(3, 4)) setParam('fb_gain', v[3]);
    if (changed(4, 5)) setParam('fb_trim', v[4]);
    if (changed(5, 6) && !setParam('fade', v[5]) && hasInport('fade')) {
      sendToInport('fade', [v[5]]);
    }
    if (changed(6, 7) && !setParam('mod', v[6]) && hasInport('mod')) {
      sendToInport('mod', [v[6]]);
    }
    lastSent = v;
    return v;
  }

  // Forget what was sent, so that the next apply() sends everything again
  function reset() {
    lastSent = null;
  }

  return { apply, reset };
}
