// XC-R static — single-player build of the XC-R player.
//
// Same RNBO device (xplosive-collision, rnbo.js 1.4.2), same preset space,
// same sound analysis, radar and score of targets as XC-R's
// `src/clients/player.js` + `src/server.js`, but with no server: no
// soundworks, no shared state, no controller. It runs from any static host
// (GitHub Pages) and is meant to try the instrument and the game on one phone.
//
// What changed from the networked system:
//   - the other player is a GHOST PARTNER. It has its own input on the pad
//     (still, or moving on its own with `auto`) and its own sound: a silent
//     one, read from the calibration of the patch (assets/targets.json) at the
//     position of its dot, mirrored when `mapping` is "mirrored", exactly as
//     the second phone would hear it. With `auto` it explores the pad like a
//     player and, during a round, looks for its configuration of the target.
//   - what XC-R's server did (the shared dot, matching the targets, the
//     points, the rounds, the ranking) runs here, between you and the ghost.
//   - the controller's switches become buttons at the bottom of the page:
//     control (shared / own), goal (coop / comp / free), mapping
//     (mirrored / same), trial / round, next target, ghost, auto. Everything
//     else can be set with URL parameters (see the README).
//   - the ranking is kept in this browser (localStorage), the logs in memory
//     (`xcr.downloadLogs()` from the console).
//   - device motion is read from the browser directly (with the iOS
//     permission prompt on the enter button) instead of through
//     @ircam/devicemotion; the enter screen replaces the platform-init screen.

import { html, render } from './vendor/lit-html.js';
import { loadPresets, createPresetSpace, bindPresetSpace } from './lib/preset-space.js';
import { DESCRIPTORS, normalise, normaliseConfig, closenessTo } from './lib/descriptors.js';
import { createSoundAnalysis } from './lib/sound-analysis.js';
import { drawRadar } from './lib/radar.js';
import { orderScore } from './lib/score-order.js';

// Where the RNBO export and the target database live
const PATCH_EXPORT_URL = 'assets/rnbo_export/patch.export.json';
const TARGETS_URL = 'assets/targets.json';
const STORAGE_PREFIX = 'xcr-static:';

// ── URL parameters ───────────────────────────────────────────────────────────
// - `?debug`       console logs and the devicemotion read-out on screen
// - `?nomotion`    no motion sensors: drag on the pad instead
// - `?calibrate`   sweep the pad and measure the descriptors (`?calibrate=6`
//                  for a 6x6 grid); the result is kept in this browser and
//                  downloaded as targets.json
// - `?targets=default`  ignore a calibration kept in this browser
// - `?control=own`, `?goal=comp|free`, `?mapping=same`, `?scoring=sharpness`
//                  initial condition (the buttons change it afterwards)
// - `?round=60`    round length in seconds (180 by default)
// - `?tolerance=0.15`, `?hold=1`, `?timeout=45`, `?points=10`  the score
// - `?ghost`, `?auto`   start with the ghost shown / moving on its own
const urlParams = new URLSearchParams(window.location.search);
const debug = urlParams.has('debug');
const calibrate = urlParams.has('calibrate');
const useMotion = !urlParams.has('nomotion');
const debugLog = (...args) => {
  if (debug) {
    console.log(...args);
  }
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const clampCoord = (value) => {
  const v = Number(value);
  return Number.isFinite(v) ? clamp(v, 0, 100) : 50;
};
function clampInt(value, min, max, fallback) {
  const v = parseInt(value, 10);
  return Number.isFinite(v) ? clamp(v, min, max) : fallback;
}
function paramNumber(name, min, max, fallback) {
  const v = Number(urlParams.get(name));
  return urlParams.has(name) && Number.isFinite(v) ? clamp(v, min, max) : fallback;
}
function paramEnum(name, list, fallback) {
  const v = urlParams.get(name);
  return list.includes(v) ? v : fallback;
}
const randomIn = (min, max) => min + Math.random() * (max - min);
const roundTo = (value, digits) => {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
};
const roundToTenths = (v) => roundTo(v, 1);
const roundToHundredths = (v) => roundTo(v, 2);
const formatNumber = (value) => {
  const v = Number(value);
  return Number.isFinite(v) ? v.toFixed(2) : '0.00';
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => performance.now() / 1000;

const storage = {
  get(key) {
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(STORAGE_PREFIX + key);
    } catch {
      // no-op
    }
  },
};

function downloadFile(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Settings — the defaults of XC-R's global state (src/global/global.js) ────

const ROUND_DURATION_MS = paramNumber('round', 5, 3600, 3 * 60) * 1000;
const ROUNDS_PER_SESSION = 3;
const POINT_COUNTER_INTERVAL_MS = 100;
const TARGET_MATCH_INTERVAL_MS = 100;
const SESSION_LOG_INTERVAL_MS = 20; // 50 Hz, kept in memory
const SESSION_LOG_MAX_ROWS = 200000;

// Team bands of a cooperative session (PLACEHOLDER thresholds, as in XC-R)
const TEAM_BANDS = [
  { name: 'gold', min: 150 },
  { name: 'silver', min: 60 },
  { name: 'bronze', min: 0 },
];

// Sound analysis, as in the player
const SMOOTH_ALPHA = 1 / 20;

// Motion, as in the player: a log-weighted moving average over the last 50
// samples, then the accelerometer is mapped to the pad (0-100), inverted on x
const MAX_G = 2.81;
const MOTION_SMOOTHING_WINDOW = 50;
const MOTION_FALLBACK_DELAY_MS = 1500;
// The dot on screen eases toward its position (only what is seen: the sound
// follows the position itself)
const DOT_DISPLAY_LERP = 0.08;

// Ghost partner
const GHOST_MARGIN = 4; // keep the ghost's input this far from the edges
// Automated movement imitates a player: it explores one sector of the pad
// (short moves, small pauses), then suddenly dashes to another sector. During
// a round it also looks for its configuration of the target: it heads for
// the position where it would match it, missing it by less and less the
// longer the target has been played. Speeds in pad units per second.
const GHOST_EXPLORE_SPEED = [18, 45];
const GHOST_DASH_SPEED = [110, 200];
const GHOST_SECTOR_RADIUS = 14;
const GHOST_SECTOR_JUMP = 35;
const GHOST_EXPLORE_TIME = [1.5, 6];
const GHOST_PAUSE = [0, 0.6];
const GHOST_PAUSE_CHANCE = 0.35;
const GHOST_INERTIA = 0.15;
const GHOST_SEEK_CHANCE = 0.5; // chance of looking for the target on each move
const GHOST_SEEK_TIME = [3, 8]; // seconds spent looking for (and holding) it
const GHOST_SEEK_MISS = 18; // initial miss distance, pad units
const GHOST_SEEK_LEARN = 12; // seconds for the miss to shrink by e
const GHOST_SOUND_NOISE = 0.015; // jitter of the ghost's sound, share of each range
const GHOST_SOUND_INTERVAL_MS = 100; // as often as a phone analyses its sound

// ── RNBO ─────────────────────────────────────────────────────────────────────

// Load rnbo.js for the version the patch was exported with: the copy shipped
// in assets/rnbo/<version>/ first, then Cycling '74's CDN as a fallback.
function loadRNBOScript(version) {
  if (/^\d+\.\d+\.\d+-dev$/.test(version)) {
    return Promise.reject(new Error(`Patch exported with a debug RNBO version (${version}) — export a release build.`));
  }
  const v = encodeURIComponent(version);
  const sources = [
    `assets/rnbo/${v}/rnbo.min.js`,
    `https://c74-public.nyc3.digitaloceanspaces.com/rnbo/${v}/rnbo.min.js`,
  ];
  const tryLoad = (i) => new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = sources[i];
    if (i > 0) {
      el.crossOrigin = 'anonymous';
    }
    el.onload = resolve;
    el.onerror = () => {
      el.remove();
      if (i + 1 < sources.length) {
        console.warn(`[rnbo] ${sources[i]} not found, trying ${sources[i + 1]}`);
        tryLoad(i + 1).then(resolve, reject);
      } else {
        reject(new Error(`Failed to load rnbo.js v${version}`));
      }
    };
    document.body.append(el);
  });
  return tryLoad(0);
}

// iOS only delivers devicemotion after an explicit permission, which has to be
// requested from inside a user gesture.
function requestMotionPermission() {
  const DME = window.DeviceMotionEvent;
  if (useMotion && DME && typeof DME.requestPermission === 'function') {
    return DME.requestPermission().catch(() => 'denied');
  }
  return Promise.resolve('granted');
}

// Mobile browsers report 100vh/100dvh as taller than what's actually visible
// whenever a collapsible toolbar is on screen: --app-vh tracks the real
// visible viewport instead, so the dot can't disappear off the bottom edge.
function syncAppViewportHeightVar() {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-vh', `${height}px`);
}
syncAppViewportHeightVar();
window.addEventListener('resize', syncAppViewportHeightVar);
window.addEventListener('orientationchange', syncAppViewportHeightVar);
window.visualViewport?.addEventListener('resize', syncAppViewportHeightVar);
window.visualViewport?.addEventListener('scroll', syncAppViewportHeightVar);

// ── Target database ──────────────────────────────────────────────────────────
// XC-R's server: loadTargetDb, mirrorPartner, buildTargetDb (calibration).

function isValidDescriptor(d) {
  return d && typeof d.key === 'string' && Number.isFinite(d.min) && Number.isFinite(d.max) && d.max > d.min;
}

function parseTargetDb(db) {
  const descriptors = Array.isArray(db?.descriptors) && db.descriptors.length > 0
    && db.descriptors.every(isValidDescriptor)
    ? db.descriptors.map(({ key, label, min, max }) => ({ key, label: label ?? key, min, max }))
    : DESCRIPTORS;
  const targets = (Array.isArray(db?.targets) ? db.targets : [])
    .filter((t) => t && Number.isFinite(t.x) && Number.isFinite(t.y) && t.values
      && descriptors.every((d) => Number.isFinite(t.values[d.key])));
  const byId = new Map(targets.map((t) => [t.id, t]));
  const score = (Array.isArray(db?.score) ? db.score : targets.filter((t) => t.usable !== false).map((t) => t.id))
    .filter((id) => byId.has(id));
  const grid = clampInt(db?.grid, 2, 12, Math.round(Math.sqrt(targets.length)) || 0);
  return { descriptors, targets, score, byId, grid, measuredAt: db?.measuredAt ?? null };
}

// The target measured closest to the opposite position of the pad
function mirrorPartner(entry, targets) {
  let best = entry;
  let bestDistance = Infinity;
  targets.forEach((other) => {
    const distance = Math.hypot(other.x - (1 - entry.x), other.y - (1 - entry.y));
    if (distance < bestDistance) {
      best = other;
      bestDistance = distance;
    }
  });
  return best;
}

// The ghost's sound: the descriptors measured on the calibration grid,
// interpolated (bilinear) at a position of the preset space (0-1).
function createSoundMap(targetDb) {
  const n = targetDb.grid;
  const keys = targetDb.descriptors.map((d) => d.key);
  const cells = new Map();
  targetDb.targets.forEach((t) => {
    const col = clamp(Math.round((t.x * n) - 0.5), 0, n - 1);
    const row = clamp(Math.round((t.y * n) - 0.5), 0, n - 1);
    cells.set(row * n + col, t.values);
  });
  const ok = n >= 2 && cells.size === n * n;

  return function soundAt(px, py) {
    if (!ok) {
      return Object.fromEntries(keys.map((key) => [key, 0]));
    }
    const u = clamp((px * n) - 0.5, 0, n - 1);
    const v = clamp((py * n) - 0.5, 0, n - 1);
    const c0 = Math.floor(u);
    const r0 = Math.floor(v);
    const c1 = Math.min(c0 + 1, n - 1);
    const r1 = Math.min(r0 + 1, n - 1);
    const fu = u - c0;
    const fv = v - r0;
    const at = (r, c) => cells.get(r * n + c);
    return Object.fromEntries(keys.map((key) => {
      const top = at(r0, c0)[key] * (1 - fu) + at(r0, c1)[key] * fu;
      const bottom = at(r1, c0)[key] * (1 - fu) + at(r1, c1)[key] * fu;
      return [key, top * (1 - fv) + bottom * fv];
    }));
  };
}

const SILENCE_LOUDNESS = 20;
const MAX_UNSTABLE_SD = 0.1;
const MAX_DRIFT = 0.1;
const RANGE_MARGIN = 0.15;
const toSignificant = (value, digits = 3) => Number(Number(value).toPrecision(digits));

function buildTargetDb(data) {
  const entries = Array.isArray(data?.entries) ? data.entries.slice(0, 400) : [];
  const keys = DESCRIPTORS.map((d) => d.key);
  const measured = entries.filter((e) => e && Number.isFinite(e.x) && Number.isFinite(e.y)
    && keys.every((key) => Number.isFinite(e.values?.[key])));
  if (measured.length === 0) {
    throw new Error('no valid measurement');
  }

  const audible = measured.filter((e) => e.values.loudness >= SILENCE_LOUDNESS);
  const descriptors = DESCRIPTORS.map((d) => {
    const values = (audible.length > 0 ? audible : measured).map((e) => e.values[d.key]);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const margin = Math.max((high - low) * RANGE_MARGIN, (d.max - d.min) * 0.01);
    return { key: d.key, label: d.label, min: toSignificant(Math.max(0, low - margin)), max: toSignificant(high + margin) };
  });

  const targets = measured.map((e, i) => {
    const sd = Object.fromEntries(keys.map((key) => [key, toSignificant(Number(e.sd?.[key]) || 0)]));
    const drift = Object.fromEntries(keys.map((key) => [key, toSignificant(Number(e.drift?.[key]) || 0)]));
    const stable = descriptors.every((d) => sd[d.key] / (d.max - d.min) <= MAX_UNSTABLE_SD
      && drift[d.key] / (d.max - d.min) <= MAX_DRIFT);
    return {
      id: i,
      name: `T${String(i + 1).padStart(2, '0')}`,
      x: roundTo(e.x, 3),
      y: roundTo(e.y, 3),
      values: Object.fromEntries(keys.map((key) => [key, toSignificant(e.values[key], 4)])),
      sd,
      drift,
      usable: e.values.loudness >= SILENCE_LOUDNESS && stable,
    };
  });

  return {
    measuredAt: new Date().toISOString(),
    sampleRate: Number(data.sampleRate) || null,
    grid: Number(data.grid) || null,
    descriptors,
    score: orderScore(targets.filter((t) => t.usable), descriptors),
    targets,
  };
}

async function fetchTargetDb() {
  const stored = urlParams.get('targets') === 'default' ? null : storage.get('targets');
  if (stored) {
    console.log(`[score] using the calibration kept in this browser (${stored.measuredAt})`);
    return { db: stored, source: 'browser' };
  }
  try {
    const response = await fetch(TARGETS_URL);
    if (!response.ok) {
      throw new Error(`${response.status}`);
    }
    return { db: await response.json(), source: 'file' };
  } catch (err) {
    console.warn(`[score] no targets: could not read ${TARGETS_URL} (${err.message})`);
    return { db: null, source: 'none' };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main($container, audioContext) {
  // ── RNBO device and preset space ───────────────────────────────────────────

  const response = await fetch(PATCH_EXPORT_URL);
  if (!response.ok) {
    throw new Error(`Could not fetch ${PATCH_EXPORT_URL} (${response.status})`);
  }
  const patcher = await response.json();
  if (!window.RNBO) {
    await loadRNBOScript(patcher.desc.meta.rnboversion);
  }

  // The presets are not taken from the RNBO export: they are read from a
  // text file and laid out as points on the pad (see lib/preset-space.js)
  let presets = [];
  try {
    presets = await loadPresets();
  } catch (err) {
    console.error('Failed to load presets file:', err);
  }

  const device = await RNBO.createDevice({ context: audioContext, patcher });
  console.log(`[rnbo] ${patcher.desc.meta.name} — rnbo.js ${patcher.desc.meta.rnboversion}, ${presets.length} presets`);

  const outputNode = audioContext.createGain();
  device.node.connect(outputNode);
  outputNode.connect(audioContext.destination);

  const inportTags = new Set(device.messages
    .filter((m) => m.type === RNBO.MessagePortType.Inport)
    .map((m) => m.tag));
  const hasInport = (tag) => inportTags.has(tag);
  const sendToInport = (tag, values) => {
    if (hasInport(tag)) {
      device.scheduleEvent(new RNBO.MessageEvent(RNBO.TimeNow, tag, values));
    }
  };
  const setParam = (name, value) => {
    const param = device.parameters.find((p) => p.name === name);
    if (!param) {
      return false;
    }
    param.value = clamp(value, param.min, param.max);
    return true;
  };
  debugLog('Inports:', [...inportTags]);

  const presetSpace = createPresetSpace(presets);
  const presetMorph = bindPresetSpace(presetSpace, { hasInport, sendToInport, setParam });

  // One preset of the export is still loaded once, as a baseline for the
  // parameters the preset space does not drive (phase_q, bp_q, modulation).
  const baselinePreset = (patcher.presets || [])[1];
  if (baselinePreset) {
    device.setPreset(baselinePreset.preset);
  }

  // v1's inter-player mechanics (collision, proximity, periphery, alarm) are
  // gone: their inports are parked at 0 once and never touched again.
  ['state', 'proximity', 'periphery', 'alarm'].forEach((tag) => sendToInport(tag, [0]));
  sendToInport('start', [1]);

  // ── State ──────────────────────────────────────────────────────────────────
  // What XC-R kept in the `global`, `user` and `control` shared states.

  const loaded = await fetchTargetDb();
  let targetDb = parseTargetDb(loaded.db);
  let targetSource = loaded.source;
  let soundAt = createSoundMap(targetDb);

  const global = {
    running: true,
    training: true, // trial: the radar shows the sound only, no score
    control: paramEnum('control', ['shared', 'own'], 'shared'),
    goal: paramEnum('goal', ['coop', 'comp', 'free'], 'coop'),
    mapping: paramEnum('mapping', ['mirrored', 'same'], 'mirrored'),
    scoring: paramEnum('scoring', ['targets', 'sharpness'], 'targets'),
    round: 0,
    targetStep: 0,
    targetCount: 0,
    target: null,
    targetMatch: {},
    matchTolerance: paramNumber('tolerance', 0.01, 0.5, 0.15),
    matchHold: paramNumber('hold', 0, 10, 1),
    targetTimeout: paramNumber('timeout', 0, 600, 45),
    targetPoints: paramNumber('points', 0, 1000, 10),
  };

  const zeroSound = () => Object.fromEntries(DESCRIPTORS.map((d) => [d.key, 0]));

  // Player 0 is you, player 1 is the ghost (the second phone: its preset
  // space is the mirrored one when `mapping` is "mirrored").
  const me = {
    id: 0,
    input: { x: 50, y: 50 }, // own input on the pad (0-100)
    dot: { x: 50, y: 50 }, // the dot seen and heard
    raw: { ax: null, ay: null, az: null, t: null },
    soundRaw: zeroSound(),
    sound: zeroSound(),
    sharpness: 0,
  };
  const ghost = {
    id: 1,
    input: { x: 22 + Math.random() * 56, y: 22 + Math.random() * 56 },
    dot: { x: 50, y: 50 },
    sound: null,
    sharpness: 0,
    visible: urlParams.has('ghost'),
    auto: urlParams.has('auto'),
  };
  const players = [me, ghost];
  const pointCounters = [0, 0];
  let result = null; // end-of-round feedback, shown on the overlay

  const isMatchActive = () => global.running && !global.training;
  const isMirrored = (player) => global.mapping === 'mirrored' && player.id % 2 === 1;

  // Position of a player's dot in their own preset space (0-1)
  function soundPosition(player) {
    let px = player.dot.x / 100;
    let py = player.dot.y / 100;
    if (isMirrored(player)) {
      px = 1 - px;
      py = 1 - py;
    }
    return { px, py };
  }

  // ── Logs ───────────────────────────────────────────────────────────────────

  const eventLog = [];
  const sessionLog = [];
  let sessionLogTimer = null;

  function getConditionFlags() {
    return {
      round: global.round,
      control: global.control,
      goal: global.goal,
      mapping: global.mapping,
      scoring: global.scoring,
      targetStep: global.targetStep,
      target: global.target?.id ?? null,
    };
  }

  function logEvent(event, details = {}) {
    eventLog.push({ time: roundTo(now(), 3), event, ...getConditionFlags(), ...details });
    debugLog('[event]', event, details);
  }

  function getSessionLogSample() {
    return {
      time: roundTo(now(), 3),
      ...getConditionFlags(),
      players: players.map((p) => ({
        id: p.id,
        ghost: p === ghost,
        ...(p === me ? me.raw : {}),
        x: roundToTenths(p.input.x),
        y: roundToTenths(p.input.y),
        X: roundToHundredths(p.dot.x),
        Y: roundToHundredths(p.dot.y),
        sharpness: roundToHundredths(p.sharpness),
        descriptors: targetDb.descriptors.map((d) => roundTo(Number(p.sound?.[d.key]) || 0, 3)),
        closeness: global.targetMatch[p.id]?.closeness ?? null,
        matched: global.targetMatch[p.id]?.matched ?? false,
        score: roundToHundredths(pointCounters[p.id]),
      })),
    };
  }

  function startSessionLog() {
    if (sessionLogTimer === null) {
      sessionLogTimer = setInterval(() => {
        if (sessionLog.length < SESSION_LOG_MAX_ROWS) {
          sessionLog.push(getSessionLogSample());
        }
      }, SESSION_LOG_INTERVAL_MS);
    }
  }

  function stopSessionLog() {
    clearInterval(sessionLogTimer);
    sessionLogTimer = null;
  }

  // ── Dot control (XC-R's server updateDots) ────────────────────────────────
  // - shared: one dot, the midpoint of both inputs
  // - own:    each player's own input

  function updateDots() {
    if (global.control === 'shared') {
      const mid = {
        x: roundToHundredths((me.input.x + ghost.input.x) / 2),
        y: roundToHundredths((me.input.y + ghost.input.y) / 2),
      };
      me.dot = { ...mid };
      ghost.dot = { ...mid };
    } else {
      me.dot = { x: roundToHundredths(me.input.x), y: roundToHundredths(me.input.y) };
      ghost.dot = { x: roundToHundredths(ghost.input.x), y: roundToHundredths(ghost.input.y) };
    }
    applyDot();
  }

  // Morph the sound to a position of the preset space (0-1)
  function morphTo(px, py) {
    presetMorph.apply(px, py);
    // the patch reads the position of the dot where it used to read the
    // device's own tilt (same -10..10 range and orientation as before)
    sendToInport('accelerometer', [-((px * 2) - 1) * 10, ((py * 2) - 1) * 10, 0]);
  }

  function applyDot() {
    // during a calibration the sweep drives the sound, not the dot
    if (calibrate) {
      return;
    }
    const { px, py } = soundPosition(me);
    morphTo(px, py);
  }

  // ── Sound analysis (yours) ─────────────────────────────────────────────────

  let patchReportsLoudness = false;

  function trackSound(key, value) {
    if (!Number.isFinite(value)) {
      return;
    }
    me.soundRaw[key] = value;
    me.sound[key] = (SMOOTH_ALPHA * value) + ((1 - SMOOTH_ALPHA) * me.sound[key]);
  }

  createSoundAnalysis({
    audioContext,
    source: device.node,
    onValues: ({ loudness, ...spectral }) => {
      Object.entries(spectral).forEach(([key, value]) => trackSound(key, value));
      if (!patchReportsLoudness) {
        trackSound('loudness', loudness);
      }
    },
  }).catch((err) => console.error('Sound analysis unavailable:', err));

  device.messageEvent.subscribe((ev) => {
    const value = Number(Array.isArray(ev.payload) ? ev.payload[0] : ev.payload);
    if (ev.tag === 'out2' && Number.isFinite(value)) {
      trackSound('sharpness', value);
      me.sharpness = value;
    }
    if (ev.tag === 'out3') {
      patchReportsLoudness = true;
      trackSound('loudness', value);
    }
  });

  // ── The ghost's sound ──────────────────────────────────────────────────────
  // What the second phone would hear at the position of its dot, from the
  // calibration grid, with a little jitter, smoothed like a phone's analysis.

  function updateGhostSound() {
    const { px, py } = soundPosition(ghost);
    const measured = soundAt(px, py);
    const next = {};
    targetDb.descriptors.forEach((d) => {
      const jitter = (Math.random() * 2 - 1) * GHOST_SOUND_NOISE * (d.max - d.min);
      const value = Math.max(0, measured[d.key] + jitter);
      const prev = ghost.sound?.[d.key];
      next[d.key] = Number.isFinite(prev) ? (SMOOTH_ALPHA * value) + ((1 - SMOOTH_ALPHA) * prev) : value;
    });
    ghost.sound = next;
    ghost.sharpness = next.sharpness ?? 0;
  }

  setInterval(updateGhostSound, GHOST_SOUND_INTERVAL_MS);

  // ── Points (XC-R's server point counters) ──────────────────────────────────

  let pointCounterTimer = null;

  function tickPointCounters() {
    // v1's rule, only when points are not earned by reaching targets
    if (!isMatchActive() || global.scoring !== 'sharpness') {
      return;
    }
    players.forEach((p) => {
      pointCounters[p.id] += (p.sharpness ** 3) / 200;
    });
    renderHud();
  }

  function startPointCounters() {
    if (pointCounterTimer === null) {
      pointCounterTimer = setInterval(tickPointCounters, POINT_COUNTER_INTERVAL_MS);
    }
  }

  function stopPointCounters() {
    clearInterval(pointCounterTimer);
    pointCounterTimer = null;
  }

  // ── The score: a sequence of targets (XC-R's server) ───────────────────────

  const matchedSince = new Map();
  let targetStartedAt = null;
  let targetPlayedFrom = now(); // for the ghost: how long the target has been played
  let targetsReachedInRound = 0;

  // When the two configurations are the sounds of two different positions
  // (coop / free with a mirrored mapping) both have to be usable ones
  function getActiveScore() {
    const needsPartner = global.goal !== 'comp' && global.mapping === 'mirrored';
    return needsPartner
      ? targetDb.score.filter((id) => mirrorPartner(targetDb.byId.get(id), targetDb.targets).usable !== false)
      : targetDb.score;
  }

  function buildTarget() {
    const score = getActiveScore();
    if (global.scoring !== 'targets' || score.length === 0) {
      return null;
    }
    const entry = targetDb.byId.get(score[global.targetStep % score.length]);
    const partner = global.mapping === 'mirrored' ? mirrorPartner(entry, targetDb.targets) : entry;
    const second = global.goal === 'comp' ? entry : partner;
    return {
      step: global.targetStep,
      id: entry.id,
      name: entry.name,
      configs: [entry.values, second.values],
      // where each configuration was measured, in that player's preset space
      // (only the ghost uses it, to look for its target)
      positions: [{ x: entry.x, y: entry.y }, { x: second.x, y: second.y }],
    };
  }

  function setTargetStep(step) {
    global.targetStep = Math.max(0, Math.floor(Number(step)) || 0);
    matchedSince.clear();
    targetStartedAt = null;
    targetPlayedFrom = now();
    global.target = buildTarget();
    global.targetMatch = {};
    global.targetCount = getActiveScore().length;
    renderApp();
  }

  function reachTarget(winnerIds) {
    const targetPoints = Number(global.targetPoints) || 0;
    const points = global.goal === 'comp' ? targetPoints : targetPoints / winnerIds.length;
    winnerIds.forEach((id) => {
      pointCounters[id] += points;
    });
    targetsReachedInRound += 1;
    logEvent('target_reached', { winners: winnerIds, scores: pointCounters.map(roundToHundredths) });
    setTargetStep(global.targetStep + 1);
  }

  function evaluateTarget() {
    if (!isMatchActive() || !global.target) {
      return;
    }
    const t = now();
    const timeout = Number(global.targetTimeout) || 0;
    if (targetStartedAt === null) {
      targetStartedAt = t;
    } else if (timeout > 0 && t - targetStartedAt >= timeout) {
      logEvent('target_timeout');
      setTargetStep(global.targetStep + 1);
      return;
    }

    const tolerance = Number(global.matchTolerance);
    const hold = Math.max(0, Number(global.matchHold) || 0);
    const ids = players.map((p) => p.id);
    const res = {};

    players.forEach((p) => {
      const closeness = closenessTo(p.sound, global.target.configs[p.id % 2], targetDb.descriptors);
      const matched = closeness >= 1 - tolerance;
      if (!matched) {
        matchedSince.delete(p.id);
      } else if (!matchedSince.has(p.id)) {
        matchedSince.set(p.id, t);
      }
      res[p.id] = { closeness: roundToHundredths(closeness), matched };
    });

    const heldFor = (id) => (matchedSince.has(id) ? t - matchedSince.get(id) : 0);
    const progress = (seconds) => (hold > 0 ? Math.min(1, seconds / hold) : (seconds > 0 ? 1 : 0));
    let winners = [];

    if (global.goal === 'comp') {
      // a race: the first to hold a match
      ids.forEach((id) => { res[id].hold = progress(heldFor(id)); });
      winners = ids.filter((id) => res[id].matched && heldFor(id) >= hold);
    } else {
      // together: everybody has to match at the same time
      const together = ids.every((id) => res[id].matched);
      const heldTogether = together ? Math.min(...ids.map(heldFor)) : 0;
      ids.forEach((id) => { res[id].hold = progress(heldTogether); });
      winners = together && heldTogether >= hold ? ids : [];
    }
    ids.forEach((id) => { res[id].hold = Math.round(res[id].hold * 10) / 10; });

    if (winners.length > 0) {
      reachTarget(winners);
      return;
    }
    global.targetMatch = res;
  }

  setInterval(evaluateTarget, TARGET_MATCH_INTERVAL_MS);

  // ── Ranking (XC-R's data/leaderboard.json, kept in this browser) ──────────

  let sessionId = null;

  function readLeaderboard() {
    const data = storage.get('leaderboard');
    return Array.isArray(data?.sessions) ? data.sessions : [];
  }

  function recordRound() {
    const scores = pointCounters.map(roundToHundredths);
    const team = roundToHundredths(pointCounters[0] + pointCounters[1]);
    const stamp = new Date().toISOString();
    const sessions = readLeaderboard();

    let entry = sessions.find((s) => s.id === sessionId);
    if (!sessionId || !entry) {
      sessionId = stamp;
      entry = { id: sessionId, startedAt: stamp, rounds: [] };
      sessions.push(entry);
    }
    entry.rounds.push({ round: global.round, endedAt: stamp, team, scores, targetsReached: targetsReachedInRound });
    Object.assign(entry, {
      control: global.control,
      goal: global.goal,
      mapping: global.mapping,
      scoring: global.scoring,
      updatedAt: stamp,
      team,
      scores,
      targetsReached: entry.rounds.reduce((sum, r) => sum + r.targetsReached, 0),
    });
    sessions.sort((a, b) => (b.team - a.team) || String(a.startedAt).localeCompare(String(b.startedAt)));
    sessions.forEach((s, i) => { s.rank = i + 1; });
    storage.set('leaderboard', { updatedAt: stamp, sessions });
    return { rank: entry.rank, sessions: sessions.length };
  }

  function publishResult(ranking) {
    const base = { goal: global.goal, round: global.round, final: global.round >= ROUNDS_PER_SESSION };
    const team = roundToHundredths(pointCounters[0] + pointCounters[1]);
    const my = roundToHundredths(pointCounters[0]);
    const other = roundToHundredths(pointCounters[1]);
    if (global.goal === 'coop') {
      const band = TEAM_BANDS.find((b) => team >= b.min)?.name ?? null;
      result = { ...base, team, band, ...ranking };
    } else if (global.goal === 'comp') {
      result = { ...base, my, other, outcome: Math.sign(my - other) };
    } else {
      result = base;
    }
  }

  // ── Rounds ─────────────────────────────────────────────────────────────────

  let roundTimer = null;
  let roundCompleted = false;
  let matchActive = false;

  function startRound() {
    roundCompleted = false;
    global.round += 1;
    result = null;
    targetsReachedInRound = 0;
    matchedSince.clear();
    targetStartedAt = null;
    targetPlayedFrom = now();
    startPointCounters();
    startSessionLog();
    roundTimer = setTimeout(() => {
      roundTimer = null;
      roundCompleted = true;
      setGlobal({ running: false });
    }, ROUND_DURATION_MS);
    logEvent('round_start');
  }

  function stopRound() {
    clearTimeout(roundTimer);
    roundTimer = null;
    stopPointCounters();
    stopSessionLog();
    logEvent(roundCompleted ? 'round_end' : 'round_abort', { scores: pointCounters.map(roundToHundredths) });
    if (roundCompleted) {
      publishResult(recordRound());
    }
  }

  function syncMatchWithConditions() {
    const next = isMatchActive();
    if (next === matchActive) {
      return;
    }
    matchActive = next;
    if (matchActive) {
      startRound();
    } else {
      stopRound();
    }
  }

  function startNewSession() {
    global.round = 0;
    pointCounters[0] = 0;
    pointCounters[1] = 0;
    result = null;
    sessionId = null;
    setTargetStep(0);
    logEvent('session_reset');
  }

  // What the controller's switches did (global.onUpdate, on the server and
  // on the player)
  function setGlobal(updates) {
    const changed = Object.keys(updates).filter((key) => global[key] !== updates[key]);
    if (changed.length === 0) {
      return;
    }
    changed.forEach((key) => { global[key] = updates[key]; });
    const has = (key) => changed.includes(key);

    if (has('running') || has('training')) {
      // restart the patch at the start of a round, stop it when it is over
      if (has('training') && !global.training) {
        sendToInport('start', [0]);
      }
      sendToInport('start', [global.running ? 1 : 0]);
      syncMatchWithConditions();
    }
    if (has('control')) {
      updateDots();
    }
    if (has('mapping')) {
      applyDot();
    }
    if (has('scoring') || has('goal') || has('mapping')) {
      setTargetStep(global.targetStep);
    }
    if (['control', 'goal', 'mapping', 'scoring'].some(has)) {
      logEvent('condition_change');
    }
    renderApp();
  }

  // ── Buttons ────────────────────────────────────────────────────────────────

  const nextIn = (list, value) => list[(list.indexOf(value) + 1) % list.length];

  const actions = {
    control: () => setGlobal({ control: nextIn(['shared', 'own'], global.control) }),
    goal: () => setGlobal({ goal: nextIn(['coop', 'comp', 'free'], global.goal) }),
    mapping: () => setGlobal({ mapping: nextIn(['mirrored', 'same'], global.mapping) }),
    // trial -> round; round (running or over) -> back to trial
    session: () => {
      if (global.training) {
        if (result?.final) {
          startNewSession();
        }
        setGlobal({ training: false, running: true });
      } else {
        setGlobal({ training: true, running: true });
      }
    },
    // the end-of-round screen: the next round, or a new session after the last one
    nextRound: () => {
      if (result?.final) {
        startNewSession();
      }
      setGlobal({ running: true });
    },
    next: () => {
      setTargetStep(global.targetStep + 1);
      logEvent('target_skip');
    },
    ghost: () => {
      ghost.visible = !ghost.visible;
      renderApp();
    },
    auto: () => {
      ghost.auto = !ghost.auto;
      Object.assign(ghostMove, { vx: 0, vy: 0, sectorUntil: 0, pauseUntil: 0, lastTime: null, phase: 'explore' });
      renderApp();
    },
  };

  // ── View ───────────────────────────────────────────────────────────────────

  let calibrationStatus = calibrate ? 'calibration: starting' : '';

  function getVisibleTarget() {
    if (!global.target || calibrate || global.goal === 'free' || global.training || !global.running) {
      return null;
    }
    return global.target.configs[me.id % 2];
  }

  function getOverlayContent() {
    if (!result) {
      return { title: 'round over', detail: '' };
    }
    const title = `round ${result.round} over`;
    if (result.goal === 'coop') {
      const rank = result.rank ? `\nranking: ${result.rank} of ${result.sessions}` : '';
      return { title, detail: `team S-Points: ${formatNumber(result.team)}${rank}` };
    }
    if (result.goal === 'comp') {
      const verdict = result.outcome > 0 ? 'YOU WIN' : (result.outcome < 0 ? 'you lose' : 'draw');
      return { title, detail: `${verdict}\nyou ${formatNumber(result.my)} · other ${formatNumber(result.other)}` };
    }
    return { title, detail: '' };
  }

  const btn = (label, title, onClick, active = false, extra = '') => html`
    <button type="button" class="scene-btn ${active ? 'active' : ''} ${extra}"
            aria-pressed=${active} title=${title} @click=${onClick}>${label}</button>
  `;

  function renderApp() {
    const overlayVisible = !global.running;
    const overlay = getOverlayContent();
    const inRound = !global.training;
    const lastRound = result?.final;

    render(html`
      <div id="app-root" class="cloud-app player-app goal-${global.goal} ${global.training ? 'is-training-mode' : ''} ${getVisibleTarget() ? 'has-target' : ''}">
        <div id="gameover-overlay" role="status" aria-live="polite"
             style="display: ${overlayVisible ? 'flex' : 'none'}" @click=${actions.nextRound}>
          <div id="gameover-text">${overlay.title}</div>
          <div id="gameover-detail">${overlay.detail}</div>
          <div class="gameover-hint">${lastRound ? 'tap for a new session' : 'tap for the next round'}</div>
        </div>
        <div class="player-points-hud player-points-hud-my">
          <span class="player-points-label">My S-Points:</span>
          <span class="player-points-value" id="hud-my"></span>
        </div>
        <div class="player-points-hud player-points-hud-other">
          <span class="player-points-label">Other S-Points:</span>
          <span class="player-points-value" id="hud-other"></span>
        </div>
        <div class="player-points-hud player-points-hud-team">
          <span class="player-points-label">Team S-Points:</span>
          <span class="player-points-value" id="hud-team"></span>
        </div>
        <div class="player-points-hud player-points-hud-target">
          <span class="player-points-label">Target</span>
          <span class="player-points-value">${global.targetStep + 1}</span>
        </div>
        ${calibrationStatus ? html`<div class="calibration-status">${calibrationStatus}</div>` : null}
        <canvas id="radar-canvas" aria-hidden="true"></canvas>
        <div id="motion-scene">
          ${presetSpace.points.map((p) => html`
            <span class="preset-point" style="left: ${p.x * 100}%; top: ${p.y * 100}%"></span>
          `)}
          <div id="my-input-ring" aria-hidden="true"></div>
          <div id="ghost-dot" aria-hidden="true"></div>
          <div id="motion-dot" aria-hidden="true"></div>
        </div>
        ${debug ? html`<pre id="devicemotion-debug" class="motion-debug-view">Waiting for motion...</pre>` : null}
        ${calibrate ? null : html`
          <nav class="scene-controls" aria-label="test controls">
            ${btn(global.control, 'control: one shared dot (midpoint of both inputs) / your own dot', actions.control)}
            ${btn(global.goal, 'goal: cooperative / competitive / free', actions.goal)}
            ${btn(global.mapping === 'mirrored' ? 'mirror' : 'same', "mapping: the ghost's preset space is mirrored / the same", actions.mapping)}
            <span class="scene-btn-sep" aria-hidden="true"></span>
            ${btn(inRound ? 'round' : 'trial', 'trial (training, no score) / a scored round', actions.session, inRound)}
            ${btn('next', 'skip to the next target', actions.next)}
            <span class="scene-btn-sep" aria-hidden="true"></span>
            ${btn('ghost', 'show / hide the ghost partner', actions.ghost, ghost.visible)}
            ${btn('auto', 'the ghost moves on its own', actions.auto, ghost.auto)}
          </nav>
        `}
      </div>
    `, $container);
    renderHud();
  }

  function renderHud() {
    const set = (id, value) => {
      const el = $container.querySelector(id);
      if (el) {
        el.textContent = formatNumber(value);
      }
    };
    set('#hud-my', pointCounters[0]);
    set('#hud-other', pointCounters[1]);
    set('#hud-team', pointCounters[0] + pointCounters[1]);
  }

  renderApp();

  const $scene = () => $container.querySelector('#motion-scene');

  // ── Frame loop: dots, ghost, radar ─────────────────────────────────────────

  const shown = { x: me.dot.x, y: me.dot.y };
  let radarValues = DESCRIPTORS.map(() => 0);
  let partnerValues = null;
  let radarSignature = '';
  let lastHudPoints = '';

  function place(el, x, y) {
    el.style.left = `${clampCoord(x)}%`;
    el.style.top = `${clampCoord(y)}%`;
  }

  function drawDots(target) {
    const $dot = $container.querySelector('#motion-dot');
    const $ghost = $container.querySelector('#ghost-dot');
    const $ring = $container.querySelector('#my-input-ring');
    if (!$dot) {
      return;
    }
    shown.x += (target.x - shown.x) * DOT_DISPLAY_LERP;
    shown.y += (target.y - shown.y) * DOT_DISPLAY_LERP;
    place($dot, shown.x, shown.y);

    const shared = global.control === 'shared';
    const ghostVisible = ghost.visible && !calibrate;
    const ghostPos = shared ? ghost.input : ghost.dot;
    place($ghost, ghostPos.x, ghostPos.y);
    $ghost.classList.toggle('is-visible', ghostVisible);
    $ghost.classList.toggle('is-input-ring', shared);
    $ghost.classList.toggle('is-matched', Boolean(global.targetMatch[ghost.id]?.matched) && !global.training);
    place($ring, me.input.x, me.input.y);
    $ring.classList.toggle('is-visible', ghostVisible && shared);
  }

  function getPartner() {
    return calibrate || global.control !== 'shared' ? null : ghost;
  }

  function drawRadarFrame() {
    const canvas = $container.querySelector('#radar-canvas');
    if (!canvas) {
      return;
    }
    const descriptors = targetDb.descriptors;
    const config = getVisibleTarget();
    const match = config ? global.targetMatch[me.id] : null;
    radarValues = descriptors.map((d, i) => {
      const value = normalise(d, me.sound[d.key]);
      const prev = radarValues[i] ?? 0;
      return prev + ((value - prev) * 0.2);
    });
    const partner = getPartner();
    partnerValues = partner && partner.sound
      ? descriptors.map((d, i) => {
        const value = normalise(d, partner.sound[d.key]);
        const prev = partnerValues?.[i] ?? value;
        return prev + ((value - prev) * 0.2);
      })
      : null;
    const partnerMatched = Boolean(partner && config && global.targetMatch[partner.id]?.matched);
    const target = config ? normaliseConfig(config, descriptors) : null;
    const signature = JSON.stringify([
      radarValues.map((v) => v.toFixed(3)), partnerValues?.map((v) => v.toFixed(3)), partnerMatched,
      target, match?.matched, match?.hold, canvas.clientWidth, canvas.clientHeight,
    ]);
    if (signature === radarSignature) {
      return;
    }
    radarSignature = signature;
    drawRadar(canvas, {
      descriptors,
      values: radarValues,
      partner: partnerValues,
      partnerMatched,
      target,
      matched: Boolean(match?.matched),
      hold: Number(match?.hold) || 0,
    });
  }

  let calibrationDot = null;

  function frame(frameTime) {
    requestAnimationFrame(frame);
    if (ghost.auto && !calibrate) {
      stepGhost(frameTime);
    } else {
      ghostMove.lastTime = null;
    }
    drawDots(calibrationDot ?? me.dot);
    drawRadarFrame();
    const points = pointCounters.map((v) => v.toFixed(2)).join();
    if (points !== lastHudPoints) {
      lastHudPoints = points;
      renderHud();
    }
  }

  // ── Ghost movement ─────────────────────────────────────────────────────────

  const ghostMove = {
    phase: 'explore', // 'explore' | 'dash' | 'seek'
    center: { ...ghost.input },
    target: { ...ghost.input },
    miss: { x: 0, y: 0 },
    speed: 0,
    vx: 0,
    vy: 0,
    sectorUntil: 0,
    pauseUntil: 0,
    seekUntil: 0,
    lastTime: null,
  };

  const keepInside = (v) => clamp(v, GHOST_MARGIN, 100 - GHOST_MARGIN);

  // Where the ghost's input has to be for it to match its configuration of
  // the target: its dot at the position the configuration was measured at
  // (mirrored back if its space is mirrored); with a shared dot, the input
  // that puts the midpoint there, given where you are.
  function ghostGoalInput() {
    const pos = global.target?.positions?.[ghost.id % 2];
    if (!pos || !isMatchActive()) {
      return null;
    }
    const mirrored = isMirrored(ghost);
    const dot = { x: (mirrored ? 1 - pos.x : pos.x) * 100, y: (mirrored ? 1 - pos.y : pos.y) * 100 };
    if (global.control === 'shared') {
      return { x: clampCoord(2 * dot.x - me.input.x), y: clampCoord(2 * dot.y - me.input.y) };
    }
    return dot;
  }

  function pickExploreTarget() {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * GHOST_SECTOR_RADIUS;
    ghostMove.target = {
      x: keepInside(ghostMove.center.x + Math.cos(a) * d),
      y: keepInside(ghostMove.center.y + Math.sin(a) * d),
    };
    ghostMove.speed = randomIn(...GHOST_EXPLORE_SPEED);
  }

  function startExploring(t) {
    ghostMove.phase = 'explore';
    ghostMove.center = { ...ghost.input };
    ghostMove.sectorUntil = t + randomIn(...GHOST_EXPLORE_TIME);
    pickExploreTarget();
  }

  function startDash() {
    let next = null;
    for (let i = 0; i < 30; i += 1) {
      next = { x: randomIn(GHOST_MARGIN, 100 - GHOST_MARGIN), y: randomIn(GHOST_MARGIN, 100 - GHOST_MARGIN) };
      if (Math.hypot(next.x - ghost.input.x, next.y - ghost.input.y) >= GHOST_SECTOR_JUMP) {
        break;
      }
    }
    ghostMove.phase = 'dash';
    ghostMove.target = next;
    ghostMove.speed = randomIn(...GHOST_DASH_SPEED);
    ghostMove.pauseUntil = 0;
  }

  function startSeeking(t) {
    // it misses by less and less the longer the target has been played
    const missRadius = 1 + GHOST_SEEK_MISS * Math.exp(-(t - targetPlayedFrom) / GHOST_SEEK_LEARN);
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * missRadius;
    ghostMove.phase = 'seek';
    ghostMove.miss = { x: Math.cos(a) * d, y: Math.sin(a) * d };
    ghostMove.seekUntil = t + randomIn(...GHOST_SEEK_TIME);
    ghostMove.speed = randomIn(...GHOST_EXPLORE_SPEED) * 1.4;
    ghostMove.pauseUntil = 0;
  }

  function stepGhost(frameTime) {
    const t = frameTime / 1000;
    const dt = ghostMove.lastTime === null ? 0 : clamp(t - ghostMove.lastTime, 0, 0.1);
    ghostMove.lastTime = t;
    if (ghostMove.sectorUntil === 0) {
      startExploring(t);
    }

    if (ghostMove.phase === 'seek') {
      const goal = ghostGoalInput();
      if (!goal || t >= ghostMove.seekUntil) {
        startExploring(t);
      } else {
        ghostMove.target = {
          x: keepInside(goal.x + ghostMove.miss.x),
          y: keepInside(goal.y + ghostMove.miss.y),
        };
      }
    }

    const dx = ghostMove.target.x - ghost.input.x;
    const dy = ghostMove.target.y - ghost.input.y;
    const dist = Math.hypot(dx, dy);

    let wantVx = 0;
    let wantVy = 0;
    if (t >= ghostMove.pauseUntil && dist > 0.5) {
      const speed = Math.min(ghostMove.speed, dist * 6);
      wantVx = (dx / dist) * speed;
      wantVy = (dy / dist) * speed;
    }

    if (dist < 2 && ghostMove.phase !== 'seek') {
      if (ghostMove.phase === 'dash') {
        startExploring(t);
      } else if (ghostGoalInput() && Math.random() < GHOST_SEEK_CHANCE) {
        startSeeking(t);
      } else if (t >= ghostMove.sectorUntil) {
        startDash();
      } else {
        pickExploreTarget();
        if (Math.random() < GHOST_PAUSE_CHANCE) {
          ghostMove.pauseUntil = t + randomIn(...GHOST_PAUSE);
        }
      }
    }

    const k = dt > 0 ? 1 - Math.exp(-dt / GHOST_INERTIA) : 0;
    ghostMove.vx += (wantVx - ghostMove.vx) * k;
    ghostMove.vy += (wantVy - ghostMove.vy) * k;
    if (dt > 0) {
      ghost.input = {
        x: keepInside(ghost.input.x + ghostMove.vx * dt),
        y: keepInside(ghost.input.y + ghostMove.vy * dt),
      };
      updateDots();
    }
  }

  // ── Motion ─────────────────────────────────────────────────────────────────

  const motionLogWeights = Array.from({ length: MOTION_SMOOTHING_WINDOW }, (_, i) => Math.log(i + 2));
  const motionXHistory = [];
  const motionYHistory = [];

  function smoothMotion(history, next) {
    history.push(next);
    if (history.length > MOTION_SMOOTHING_WINDOW) {
      history.shift();
    }
    const offset = MOTION_SMOOTHING_WINDOW - history.length;
    let sum = 0;
    let weights = 0;
    for (let i = 0; i < history.length; i += 1) {
      sum += history[i] * motionLogWeights[offset + i];
      weights += motionLogWeights[offset + i];
    }
    return weights > 0 ? sum / weights : next;
  }

  // Inverted on x so the dot moves opposite to the raw accelerometer reading
  function mapAccelToInput(accX, accY) {
    const nx = clamp(accX / MAX_G, -1, 1);
    const ny = clamp(accY / MAX_G, -1, 1);
    return { x: roundToTenths(((-nx + 1) * 0.5) * 100), y: roundToTenths(((ny + 1) * 0.5) * 100) };
  }

  function setMyInput(input, raw) {
    me.input = { x: clampCoord(input.x), y: clampCoord(input.y) };
    me.raw = { ...raw, t: roundTo(now(), 3) };
    updateDots();
  }

  let motionEventReceived = false;
  let pointerDragEnabled = false;
  let lastMotionDebug = 0;

  function setPointerDrag(enabled) {
    pointerDragEnabled = enabled;
    $scene()?.classList.toggle('is-pointer-drag-enabled', enabled);
    debugLog(enabled ? 'Device motion unavailable: pointer drag enabled' : 'Device motion detected');
  }

  function updateMotionDebug(e, acc) {
    const t = performance.now();
    if (!debug || t - lastMotionDebug < 50) {
      return;
    }
    lastMotionDebug = t;
    const el = $container.querySelector('#devicemotion-debug');
    const f = (v) => (typeof v === 'number' ? v.toFixed(2) : '--');
    if (el) {
      el.textContent = [
        `interval: ${f(e.interval)} ms`,
        `accG: x ${f(acc.x)} y ${f(acc.y)} z ${f(acc.z)}`,
        `input: x ${f(me.input.x)} y ${f(me.input.y)}`,
        `dot:   X ${f(me.dot.x)} Y ${f(me.dot.y)}`,
      ].join('\n');
    }
  }

  if (useMotion && typeof window.DeviceMotionEvent !== 'undefined') {
    window.addEventListener('devicemotion', (e) => {
      const acc = e.accelerationIncludingGravity || {};
      // desktop browsers may fire empty events: ignore those
      if (typeof acc.x !== 'number' && typeof acc.y !== 'number' && typeof acc.z !== 'number') {
        return;
      }
      if (!motionEventReceived) {
        motionEventReceived = true;
        setPointerDrag(false);
      }
      const ax = typeof acc.x === 'number' ? acc.x : 0;
      const ay = typeof acc.y === 'number' ? acc.y : 0;
      const az = typeof acc.z === 'number' ? acc.z : 0;
      const input = mapAccelToInput(smoothMotion(motionXHistory, ax), smoothMotion(motionYHistory, ay));
      if (!calibrate) {
        setMyInput(input, { ax, ay, az });
      }
      updateMotionDebug(e, acc);
    });
    setTimeout(() => {
      if (!motionEventReceived) {
        setPointerDrag(true);
      }
    }, MOTION_FALLBACK_DELAY_MS);
  } else {
    setPointerDrag(true);
  }

  // Without motion events, dragging on the pad sets your input instead
  let dragPointerId = null;
  const scene = $scene();

  function applyPointer(e) {
    const rect = scene.getBoundingClientRect();
    if (!rect.width || !rect.height || calibrate) {
      return;
    }
    setMyInput({
      x: roundToTenths(((e.clientX - rect.left) / rect.width) * 100),
      y: roundToTenths(((e.clientY - rect.top) / rect.height) * 100),
    }, { ax: null, ay: null, az: null });
  }

  scene.addEventListener('pointerdown', (e) => {
    if (!pointerDragEnabled || (typeof e.button === 'number' && e.button !== 0)) {
      return;
    }
    dragPointerId = e.pointerId;
    applyPointer(e);
    try {
      scene.setPointerCapture(e.pointerId);
    } catch {
      // no-op
    }
  });
  scene.addEventListener('pointermove', (e) => {
    if (pointerDragEnabled && dragPointerId === e.pointerId) {
      applyPointer(e);
    }
  });
  const stopDrag = (e) => {
    if (dragPointerId === e.pointerId) {
      dragPointerId = null;
    }
  };
  scene.addEventListener('pointerup', stopDrag);
  scene.addEventListener('pointercancel', stopDrag);
  scene.addEventListener('pointerleave', stopDrag);

  // ── Calibration (`?calibrate`) ─────────────────────────────────────────────
  // As in XC-R: sweep the pad on a grid of positions, row by row and back and
  // forth, then once more the other way round; at each position let the sound
  // settle, then measure the mean and the spread of each descriptor. The
  // result becomes the target database of this browser, and is downloaded as
  // targets.json (copy it to assets/targets.json to ship it).

  async function runCalibration() {
    const SETTLE_MS = 3000;
    const MEASURE_MS = 3000;
    const SAMPLE_MS = 100;
    const n = clampInt(urlParams.get('calibrate'), 2, 12, 5);
    const descriptorKeys = DESCRIPTORS.map((d) => d.key);

    const positions = [];
    for (let row = 0; row < n; row += 1) {
      for (let i = 0; i < n; i += 1) {
        const col = row % 2 === 0 ? i : n - 1 - i;
        positions.push({ x: (col + 0.5) / n, y: (row + 0.5) / n, passes: [] });
      }
    }
    const sweeps = [positions, [...positions].reverse()];
    const total = sweeps.length * positions.length;
    let done = 0;

    sendToInport('start', [1]);
    await wait(1000);

    for (const sweep of sweeps) {
      for (const position of sweep) {
        done += 1;
        calibrationStatus = `calibration: measure ${done} of ${total}`;
        renderApp();
        morphTo(position.x, position.y);
        calibrationDot = { x: position.x * 100, y: position.y * 100 };
        await wait(SETTLE_MS);

        const samples = [];
        for (let elapsed = 0; elapsed < MEASURE_MS; elapsed += SAMPLE_MS) {
          samples.push({ ...me.soundRaw });
          await wait(SAMPLE_MS);
        }
        const values = {};
        const sd = {};
        descriptorKeys.forEach((key) => {
          const mean = samples.reduce((sum, s) => sum + s[key], 0) / samples.length;
          const variance = samples.reduce((sum, s) => sum + ((s[key] - mean) ** 2), 0) / samples.length;
          values[key] = mean;
          sd[key] = Math.sqrt(variance);
        });
        position.passes.push({ values, sd });
        debugLog('calibration', position.x, position.y, values);
      }
    }

    const entries = positions.map(({ x, y, passes }) => {
      const values = {};
      const sd = {};
      const drift = {};
      descriptorKeys.forEach((key) => {
        const means = passes.map((p) => p.values[key]);
        values[key] = means.reduce((sum, v) => sum + v, 0) / means.length;
        sd[key] = Math.max(...passes.map((p) => p.sd[key]));
        drift[key] = Math.max(...means) - Math.min(...means);
      });
      return { x, y, values, sd, drift };
    });

    try {
      const db = buildTargetDb({ grid: n, sampleRate: audioContext.sampleRate, entries });
      const kept = storage.set('targets', db);
      targetDb = parseTargetDb(db);
      targetSource = 'browser';
      soundAt = createSoundMap(targetDb);
      setTargetStep(0);
      downloadFile('targets.json', `${JSON.stringify(db, null, 2)}\n`);
      calibrationStatus = `calibration saved: ${db.score.length} targets in the score, of ${db.targets.length} measured`
        + (kept ? '' : ' (not kept: storage unavailable)');
    } catch (err) {
      calibrationStatus = `calibration not saved: ${err.message}`;
    }
    calibrationDot = null;
    renderApp();
  }

  // ── Start ──────────────────────────────────────────────────────────────────

  setTargetStep(0);
  updateDots();
  updateGhostSound();
  requestAnimationFrame(frame);
  // setPreset above is applied asynchronously by the device: send the
  // position of the preset space again once it has settled
  setTimeout(() => {
    presetMorph.reset();
    applyDot();
  }, 300);
  if (calibrate) {
    runCalibration();
  }
  console.log(`[score] ${targetDb.score.length} targets in the score (${targetDb.targets.length} measured), from ${targetSource === 'browser' ? 'this browser' : TARGETS_URL}`);

  // Exposed for testing from the console
  window.xcr = {
    global,
    me,
    ghost,
    pointCounters,
    device,
    get targetDb() {
      return targetDb;
    },
    get result() {
      return result;
    },
    set: setGlobal,
    leaderboard: readLeaderboard,
    eventLog,
    sessionLog,
    downloadLogs() {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const lines = (rows) => rows.map((row) => JSON.stringify(row)).join('\n');
      downloadFile(`xcr_Events-log_${stamp}.jsonl`, `${lines(eventLog)}\n`, 'application/x-ndjson');
      downloadFile(`xcr_Session-log_${stamp}.jsonl`, `${lines(sessionLog)}\n`, 'application/x-ndjson');
    },
    clearCalibration() {
      storage.remove('targets');
      console.log('Calibration removed: reload to use assets/targets.json');
    },
    clearLeaderboard() {
      storage.remove('leaderboard');
    },
  };
}

// ── Enter screen ─────────────────────────────────────────────────────────────
// Audio (and, on iOS, motion sensors) can only start from a user gesture.

function renderEnter($container, { busy = false, error = null } = {}) {
  render(html`
    <div id="enter-overlay">
      <div id="enter-content">
        <div id="enter-title">XC-R</div>
        <div id="enter-text">${calibrate
          ? 'calibration: the pad will be swept by itself.\nkeep the phone still, at the volume of the study.'
          : `tilt your phone to move the dot: the noise follows it.
the radar behind it shows your sound, and the target to reach.
your partner is a ghost: it moves its own input,
and hears its own sound.

turn the volume up gently — this gets loud.`}</div>
        ${useMotion ? null : html`<div class="enter-note">no motion sensors: drag on the pad</div>`}
        ${error ? html`<div class="enter-error">${error}</div>` : null}
        <button id="enter-button" type="button" ?disabled=${busy} @click=${() => start($container)}>
          ${busy ? 'loading…' : '>>>'}
        </button>
      </div>
    </div>
  `, $container);
}

let starting = false;

async function start($container) {
  if (starting) {
    return;
  }
  starting = true;

  // Both of these must be called synchronously inside the click
  const motionPermission = requestMotionPermission();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioCtx();
  const resumed = audioContext.resume();

  renderEnter($container, { busy: true });

  try {
    await Promise.all([motionPermission, resumed]);
    await main($container, audioContext);
  } catch (err) {
    console.error(err);
    audioContext.close().catch(() => {});
    starting = false;
    renderEnter($container, { error: `Could not start the device: ${err.message || err}` });
  }
}

if (window.location.protocol === 'file:') {
  document.getElementById('app').textContent = 'XC-R has to be served from a web server (see the README), not opened as a file.';
} else {
  renderEnter(document.getElementById('app'));
}
