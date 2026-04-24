// ─── Constants ────────────────────────────────────────────────────────────────
const TRANSPORT_H  = 52;
const BLOCK_H      = 52;        // base unit height (trigger = 1×, gate = 2–16×)

// Generator phases: [spawnMult, gateProb, minDurMs, maxDurMs]
// spawnMult scales SPAWN_MS — lower = denser; gateProb 0=all triggers, 1=all gates
const GEN_PHASES = [
  [0.25, 0.0,  2000,  5000],  // dense  · only triggers
  [0.25, 1.0,  3000,  7000],  // dense  · only gates
  [0.28, 0.5,  3000,  7000],  // dense  · mixed
  [0.7,  0.1,  5000, 12000],  // medium · mostly triggers
  [0.7,  0.9,  5000, 12000],  // medium · mostly gates
  [1.0,  0.5,  5000, 12000],  // normal · mixed  (baseline)
  [1.0,  0.0,  5000, 10000],  // normal · only triggers
  [1.0,  1.0,  5000, 10000],  // normal · only gates
  [2.5,  0.4,  5000, 12000],  // sparse · slightly trigger-heavy
  [3.5,  0.5,  4000, 10000],  // sparse · mixed
  [8.0,  0.5,  2000,  5000],  // near silence
];

// Mutable params — loaded from localStorage, editable via settings page
const _p       = JSON.parse(localStorage.getItem('noise-params') || '{}');
let SPEED      = _p.speed      ?? 2.5;
let SPAWN_MS   = _p.spawnMs    ?? 2100;
let HIT_WINDOW = _p.hitWindow  ?? 30;

const SAMPLE_FILES = [
  'samples/drakqs-NS-A%235-ff-1108.wav',
  'samples/drakqs-NS-A%235-ff-75.wav',
  'samples/drakqs-NS-A%235-pp-288.wav',
  'samples/drakqs-NS-A%235-pp-826.wav',
  'samples/drakqs-NS-A%236-ff-42.wav',
  'samples/drakqs-NS-A%236-ff-432.wav',
  'samples/drakqs-NS-A%236-pp-206.wav',
  'samples/drakqs-NS-A%236-pp-32.wav',
  'samples/drakqs-NS-A%236-pp-810.wav',
  'samples/drakqs-NS-A%237-f-1320.wav',
  'samples/drakqs-NS-A%237-ff-1039.wav',
  'samples/drakqs-NS-A2-pp-282.wav',
  'samples/drakqs-NS-A5-ff-1459.wav',
  'samples/drakqs-NS-A5-ff-401.wav',
  'samples/drakqs-NS-A5-pp-239.wav',
  'samples/drakqs-NS-A5-pp-248.wav',
  'samples/drakqs-NS-A6-f-899.wav',
  'samples/drakqs-NS-A6-ff-1025.wav',
  'samples/drakqs-NS-A6-ff-663.wav',
  'samples/drakqs-NS-A6-ff-816.wav',
  'samples/drakqs-NS-A6-ff-836.wav',
  'samples/drakqs-NS-A6-ff-844.wav',
  'samples/drakqs-NS-A6-pp-623.wav',
  'samples/drakqs-NS-A6-pp-883.wav',
  'samples/drakqs-NS-A6-pp-923.wav',
  'samples/drakqs-NS-A7-ff-1330.wav',
  'samples/drakqs-NS-A7-ff-518.wav',
  'samples/drakqs-NS-B4-pp-411.wav',
  'samples/drakqs-NS-B5-f-654.wav',
  'samples/drakqs-NS-B5-ff-244.wav',
  'samples/drakqs-NS-B5-ff-998.wav',
  'samples/drakqs-NS-B5-pp-436.wav',
  'samples/drakqs-NS-B5-pp-598.wav',
  'samples/drakqs-NS-B6-f-1225.wav',
  'samples/drakqs-NS-B6-ff-1432.wav',
  'samples/drakqs-NS-B6-ff-327.wav',
  'samples/drakqs-NS-B6-pp-337.wav',
  'samples/drakqs-NS-B6-pp-762.wav',
  'samples/drakqs-NS-B7-f-503.wav',
  'samples/drakqs-NS-B7-pp-1055.wav',
  'samples/drakqs-NS-B7-pp-721.wav',
  'samples/drakqs-NS-C%236-ff-272.wav',
  'samples/drakqs-NS-C%236-ff-300.wav',
  'samples/drakqs-NS-C%236-ff-595.wav',
  'samples/drakqs-NS-C%236-ff-596.wav',
  'samples/drakqs-NS-C%236-ff-809.wav',
  'samples/drakqs-NS-C%236-pp-247.wav',
  'samples/drakqs-NS-C%236-pp-353.wav',
  'samples/drakqs-NS-C%236-pp-708.wav',
  'samples/drakqs-NS-C%236-pp-793.wav',
  'samples/drakqs-NS-C%237-ff-441.wav',
  'samples/drakqs-NS-C%237-ff-996.wav',
  'samples/drakqs-NS-C%237-pp-312.wav',
  'samples/drakqs-NS-C%237-pp-388.wav',
  'samples/drakqs-NS-C%237-pp-821.wav',
  'samples/drakqs-NS-C5-pp-644.wav',
  'samples/drakqs-NS-C5-pp-882.wav',
  'samples/drakqs-NS-C6-pp-380.wav',
  'samples/drakqs-NS-C6-pp-671.wav',
  'samples/drakqs-NS-C7-f-1185.wav',
  'samples/drakqs-NS-C7-ff-1103.wav',
  'samples/drakqs-NS-C7-ff-582.wav',
  'samples/drakqs-NS-C7-ff-689.wav',
  'samples/drakqs-NS-C7-ff-693.wav',
  'samples/drakqs-NS-C7-ff-704.wav',
  'samples/drakqs-NS-C7-ff-806.wav',
  'samples/drakqs-NS-C7-ff-928.wav',
  'samples/drakqs-NS-C7-pp-612.wav',
  'samples/drakqs-NS-C7-pp-770.wav',
  'samples/drakqs-NS-C7-pp-773.wav',
  'samples/drakqs-NS-C7-pp-784.wav',
  'samples/drakqs-NS-C8-pp-686.wav',
  'samples/drakqs-NS-D%234-pp-661.wav',
  'samples/drakqs-NS-D%235-pp-839.wav',
  'samples/drakqs-NS-D%236-ff-1355.wav',
  'samples/drakqs-NS-D%236-ff-39.wav',
  'samples/drakqs-NS-D%236-pp-419.wav',
  'samples/drakqs-NS-D%236-pp-426.wav',
  'samples/drakqs-NS-D%236-pp-428.wav',
  'samples/drakqs-NS-D%236-pp-469.wav',
  'samples/drakqs-NS-D%236-pp-525.wav',
  'samples/drakqs-NS-D%236-pp-645.wav',
  'samples/drakqs-NS-D%236-pp-813.wav',
  'samples/drakqs-NS-D%237-ff-467.wav',
  'samples/drakqs-NS-D%237-ff-668.wav',
  'samples/drakqs-NS-D%237-ff-756.wav',
  'samples/drakqs-NS-D%237-ff-763.wav',
  'samples/drakqs-NS-D%237-pp-412.wav',
  'samples/drakqs-NS-D5-pp-666.wav',
  'samples/drakqs-NS-D6-pp-425.wav',
  'samples/drakqs-NS-D6-pp-646.wav',
  'samples/drakqs-NS-D6-pp-805.wav',
  'samples/drakqs-NS-D7-ff-514.wav',
  'samples/drakqs-NS-E6-ff-628.wav',
  'samples/drakqs-NS-E6-pp-279.wav',
  'samples/drakqs-NS-E6-pp-287.wav',
  'samples/drakqs-NS-E6-pp-424.wav',
  'samples/drakqs-NS-E6-pp-433.wav',
  'samples/drakqs-NS-E6-pp-631.wav',
  'samples/drakqs-NS-E6-pp-765.wav',
  'samples/drakqs-NS-E6-pp-812.wav',
  'samples/drakqs-NS-E6-pp-841.wav',
  'samples/drakqs-NS-E7-ff-292.wav',
  'samples/drakqs-NS-E7-ff-953.wav',
  'samples/drakqs-NS-E7-pp-421.wav',
  'samples/drakqs-NS-E7-pp-699.wav',
  'samples/drakqs-NS-F%234-ff-756.wav',
  'samples/drakqs-NS-F%234-pp-108.wav',
  'samples/drakqs-NS-F%235-ff-396.wav',
  'samples/drakqs-NS-F%235-ff-674.wav',
  'samples/drakqs-NS-F%236-ff-472.wav',
  'samples/drakqs-NS-F%236-ff-957.wav',
  'samples/drakqs-NS-F%236-pp-413.wav',
  'samples/drakqs-NS-F%236-pp-435.wav',
  'samples/drakqs-NS-F%236-pp-522.wav',
  'samples/drakqs-NS-F%236-pp-552.wav',
  'samples/drakqs-NS-F%237-ff-115.wav',
  'samples/drakqs-NS-F%237-ff-800.wav',
  'samples/drakqs-NS-F%237-pp-718.wav',
  'samples/drakqs-NS-F%237-pp-798.wav',
  'samples/drakqs-NS-F4-pp-257.wav',
  'samples/drakqs-NS-F6-ff-524.wav',
  'samples/drakqs-NS-F6-ff-653.wav',
  'samples/drakqs-NS-F6-ff-686.wav',
  'samples/drakqs-NS-F6-ff-834.wav',
  'samples/drakqs-NS-F6-ff-93.wav',
  'samples/drakqs-NS-F6-pp-147.wav',
  'samples/drakqs-NS-F6-pp-616.wav',
  'samples/drakqs-NS-F6-pp-716.wav',
  'samples/drakqs-NS-F7-ff-505.wav',
  'samples/drakqs-NS-F7-pp-622.wav',
  'samples/drakqs-NS-F7-pp-710.wav',
  'samples/drakqs-NS-F7-pp-819.wav',
  'samples/drakqs-NS-G%235-ff-1130.wav',
  'samples/drakqs-NS-G%235-pp-320.wav',
  'samples/drakqs-NS-G%236-f-879.wav',
  'samples/drakqs-NS-G%236-ff-319.wav',
  'samples/drakqs-NS-G%236-ff-614.wav',
  'samples/drakqs-NS-G%236-ff-687.wav',
  'samples/drakqs-NS-G%236-pp-271.wav',
  'samples/drakqs-NS-G%236-pp-427.wav',
  'samples/drakqs-NS-G%236-pp-846.wav',
  'samples/drakqs-NS-G%237-f-690.wav',
  'samples/drakqs-NS-G%237-ff-1000.wav',
  'samples/drakqs-NS-G%237-ff-1283.wav',
  'samples/drakqs-NS-G%237-pp-634.wav',
  'samples/drakqs-NS-G6-ff-324.wav',
  'samples/drakqs-NS-G6-ff-431.wav',
  'samples/drakqs-NS-G6-ff-450.wav',
  'samples/drakqs-NS-G6-ff-611.wav',
  'samples/drakqs-NS-G6-ff-635.wav',
  'samples/drakqs-NS-G6-pp-1032.wav',
  'samples/drakqs-NS-G6-pp-1058.wav',
  'samples/drakqs-NS-G6-pp-591.wav',
  'samples/drakqs-NS-G6-pp-791.wav',
  'samples/drakqs-NS-G6-pp-826.wav',
  'samples/drakqs-NS-G7-ff-1014.wav',
  'samples/drakqs-NS-G7-ff-1300.wav',
  'samples/drakqs-NS-G7-ff-1398.wav',
  'samples/drakqs-PRD-A%234-ff-636.wav',
  'samples/drakqs-PRD-A%234-pp-694.wav',
  'samples/drakqs-PRD-A%235-pp-310.wav',
  'samples/drakqs-PRD-A%236-ff-1402.wav',
  'samples/drakqs-PRD-A4-ff-445.wav',
  'samples/drakqs-PRD-A4-pp-391.wav',
  'samples/drakqs-PRD-A6-ff-1260.wav',
  'samples/drakqs-PRD-B4-pp-598.wav',
  'samples/drakqs-PRD-B5-pp-1367.wav',
  'samples/drakqs-PRD-B5-pp-631.wav',
  'samples/drakqs-PRD-B6-ff-303.wav',
  'samples/drakqs-PRD-B6-pp-1380.wav',
  'samples/drakqs-PRD-C7-ff-823.wav',
  'samples/drakqs-PRD-D%235-pp-656.wav',
  'samples/drakqs-PRD-D6-pp-1592.wav',
  'samples/drakqs-PRD-E5-ff-600.wav',
  'samples/drakqs-PRD-F%234-pp-617.wav',
  'samples/drakqs-PRD-F%235-ff-792.wav',
  'samples/drakqs-PRD-F%235-pp-282.wav',
  'samples/drakqs-PRD-F%235-pp-821.wav',
  'samples/drakqs-PRD-F5-ff-154.wav',
  'samples/drakqs-PRD-F5-ff-161.wav',
  'samples/drakqs-PRD-F5-ff-196.wav',
  'samples/drakqs-PRD-F6-pp-1349.wav',
  'samples/drakqs-PRD-F6-pp-55.wav',
  'samples/drakqs-PRD-G%234-ff-318.wav',
  'samples/drakqs-PRD-G%235-pp-1245.wav',
  'samples/drakqs-PRD-G3-ff-36.wav',
  'samples/drakqs-PRD-G3-pp-950.wav',
  'samples/drakqs-PRD-G5-pp-1419.wav',
];

// ─── State ────────────────────────────────────────────────────────────────────
let audioCtx    = null;
let device      = null;
let dryGain     = null;   // 40% dry (buffer direct)
let sampleBufs  = [];
let isPlaying   = false;
let blocks      = [];           // falling blocks (trigger + unhit gate)
let gameAreaH   = 0;
let hitLineY    = 0;
let animFrameId = null;

// Per-column polyphonic spawn timers
let nextSpawn = [0, 0, 0, 0];

// Generator phase state
let genPhaseIdx  = 5;    // index into GEN_PHASES (start at "normal mixed")
let genSpawnMult = 1.0;
let genGateProb  = 0.5;
let genPhaseEnd  = 0;    // timestamp when current phase expires

// Per-column gate state (one held gate per column max)
const gateBlock         = [null, null, null, null];  // held block object
const gateSource        = [null, null, null, null];  // looping AudioBufferSourceNode
const gateScoreInterval = [null, null, null, null];  // 1pt/sec interval while held

let score = 0;

// ─── DOM ──────────────────────────────────────────────────────────────────────
const cols       = [0,1,2,3].map(i => document.getElementById('col-' + i));
const buttons    = document.querySelectorAll('.btn');
const playBtn    = document.getElementById('play-btn');
const playIcon   = document.getElementById('play-icon');
const playLabel  = document.getElementById('play-label');
const hitLineEl  = document.getElementById('hit-line');
const hitLineMid = document.getElementById('hit-line-mid');
const controlsEl = document.getElementById('controls');
const scoreEl    = document.getElementById('score');

// ─── Generator phases ─────────────────────────────────────────────────────────
function pickNextPhase(ts) {
  let idx;
  do { idx = Math.floor(Math.random() * GEN_PHASES.length); } while (idx === genPhaseIdx);
  genPhaseIdx  = idx;
  const [mult, gp, minDur, maxDur] = GEN_PHASES[idx];
  genSpawnMult = mult;
  genGateProb  = gp;
  genPhaseEnd  = ts + minDur + Math.random() * (maxDur - minDur);
}

// ─── Score ────────────────────────────────────────────────────────────────────
function addScore(n) {
  score += n;
  scoreEl.textContent = score;
}

// ─── Layout ───────────────────────────────────────────────────────────────────
function applyLayout() {
  const controlsH = controlsEl.getBoundingClientRect().height || 88;
  gameAreaH = window.innerHeight - TRANSPORT_H - controlsH;
  hitLineY  = Math.round(gameAreaH * 0.75);

  cols.forEach(col => {
    col.style.top    = TRANSPORT_H + 'px';
    col.style.height = gameAreaH + 'px';
  });

  const lineTop = TRANSPORT_H + hitLineY;
  hitLineEl.style.top  = lineTop + 'px';
  hitLineMid.style.top = (lineTop - 5) + 'px';
}

// ─── Audio init ───────────────────────────────────────────────────────────────
async function initAudio() {
  const WACtx = window.AudioContext || window.webkitAudioContext;
  audioCtx = new WACtx();
  await audioCtx.resume();

  dryGain = audioCtx.createGain();
  dryGain.gain.value = 0.4;
  dryGain.connect(audioCtx.destination);

  // Try custom samples from IndexedDB first, fall back to built-in files
  let dbEntries = [];
  try { dbEntries = await dbGetAllSamples(); } catch { /* IndexedDB unavailable */ }

  if (dbEntries.length > 0) {
    const decoded = await Promise.all(
      dbEntries.map(async e => {
        try { return await audioCtx.decodeAudioData(e.data.slice(0)); }
        catch { return null; }
      })
    );
    sampleBufs = decoded.filter(Boolean);
    console.log(sampleBufs.length + ' custom samples loaded from storage');
  } else {
    const loaded = await Promise.all(
      SAMPLE_FILES.map(async url => {
        try {
          const res = await fetch(url);
          const ab  = await res.arrayBuffer();
          return audioCtx.decodeAudioData(ab);
        } catch (e) {
          console.warn('Sample load failed:', url);
          return null;
        }
      })
    );
    sampleBufs = loaded.filter(Boolean);
    console.log(sampleBufs.length + '/' + SAMPLE_FILES.length + ' built-in samples loaded');
  }

  // Load RNBO device
  try {
    const res     = await fetch('export/patch.export.json');
    const patcher = await res.json();

    if (!window.RNBO) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://c74-public.nyc3.digitaloceanspaces.com/rnbo/' +
                encodeURIComponent(patcher.desc.meta.rnboversion) + '/rnbo.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('RNBO load failed'));
        document.body.appendChild(s);
      });
    }

    const wetGain = audioCtx.createGain();
    wetGain.gain.value = 0.6;
    wetGain.connect(audioCtx.destination);
    device = await RNBO.createDevice({ context: audioCtx, patcher });
    device.node.connect(wetGain);
    console.log('RNBO device ready');
  } catch (e) {
    console.warn('RNBO unavailable:', e);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sendMessageToInport(dev, tag, values) {
  dev.scheduleEvent(new RNBO.MessageEvent(RNBO.TimeNow, tag, values));
}

// Signal chain: BufferSource → dryGain (0.4) → destination
//                           ↘ device.node (RNBO) → wetGain (0.6) → destination
function connectAudioSource(src) {
  if (device) {
    src.connect(dryGain);      // dry path: 40%
    src.connect(device.node);  // wet path: through RNBO → wetGain 60%
  } else {
    src.connect(audioCtx.destination);  // fallback: no device, full volume
  }
}

// ─── Trigger playback ─────────────────────────────────────────────────────────
function playRandomSample() {
  if (!audioCtx || sampleBufs.length === 0) return;
  const buf = sampleBufs[Math.floor(Math.random() * sampleBufs.length)];
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  connectAudioSource(src);
  src.start();
}

// ─── Gate playback ────────────────────────────────────────────────────────────
function startGateAudio(col) {
  if (!audioCtx || sampleBufs.length === 0) return;
  stopGateAudio(col);
  const buf = sampleBufs[Math.floor(Math.random() * sampleBufs.length)];
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.loop   = true;
  connectAudioSource(src);
  src.start();
  gateSource[col] = src;
}

function stopGateAudio(col) {
  if (!gateSource[col]) return;
  try { gateSource[col].stop(); } catch {}
  gateSource[col] = null;
}

// ─── RNBO transport ───────────────────────────────────────────────────────────
function rnboStart(val) {
  if (!device || !window.RNBO) return;
  sendMessageToInport(device, 'start', [val]);
  sendMessageToInport(device, 'style', [200, 288, 300]);
  sendMessageToInport(device, 'accelerometer', [0, 0, 0]);
}

// ─── Block spawning ───────────────────────────────────────────────────────────
function spawnBlock(col) {
  const isGate = Math.random() < genGateProb;
  // gate: random multiplier 2–16 × BLOCK_H; trigger: 1 × BLOCK_H
  const mult   = isGate ? (Math.floor(Math.random() * 15) + 2) : 1;
  const height = BLOCK_H * mult;

  const el = document.createElement('div');
  el.classList.add('block', isGate ? 'block-gate' : 'block-trigger');
  el.style.height = height + 'px';
  el.style.top    = -height + 'px';
  cols[col].appendChild(el);

  blocks.push({ el, col, y: -height, type: isGate ? 'gate' : 'trigger', height });
}

// ─── Game loop ────────────────────────────────────────────────────────────────
function gameLoop(ts) {
  if (!isPlaying) return;

  // Advance generator phase when its duration expires
  if (ts >= genPhaseEnd) pickNextPhase(ts);

  // Each column has its own independent spawn timer (±20% jitter)
  for (let col = 0; col < 4; col++) {
    if (ts >= nextSpawn[col]) {
      spawnBlock(col);
      nextSpawn[col] = ts + SPAWN_MS * genSpawnMult * (0.8 + Math.random() * 0.4);
    }
  }

  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    b.y += SPEED;
    b.el.style.top = b.y + 'px';
    if (b.y > gameAreaH) {
      b.el.remove();
      blocks.splice(i, 1);
    }
  }

  // Auto-release gate blocks once they've fully passed the hit zone
  for (let col = 0; col < 4; col++) {
    if (gateBlock[col] && gateBlock[col].y > hitLineY + HIT_WINDOW) {
      releaseGate(col);
    }
  }

  animFrameId = requestAnimationFrame(gameLoop);
}

// ─── Transport ────────────────────────────────────────────────────────────────
function startTransport() {
  isPlaying   = true;
  nextSpawn   = [0, 0, 0, 0];  // all columns spawn immediately on first frame
  genPhaseEnd = 0;              // force phase pick on first frame
  animFrameId = requestAnimationFrame(gameLoop);
  rnboStart(1);
  playIcon.textContent  = '■';
  playLabel.textContent = 'STOP';
  playBtn.classList.add('playing');
}

function stopTransport() {
  isPlaying = false;
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }

  blocks.forEach(b => b.el.remove());
  blocks = [];

  // Release all held gates
  for (let col = 0; col < 4; col++) {
    stopGateAudio(col);
    if (gateScoreInterval[col]) { clearInterval(gateScoreInterval[col]); gateScoreInterval[col] = null; }
    if (gateBlock[col]) { gateBlock[col].el.remove(); gateBlock[col] = null; }
  }

  score = 0;
  scoreEl.textContent = 0;
  rnboStart(0);
  playIcon.textContent  = '▶';
  playLabel.textContent = 'PLAY';
  playBtn.classList.remove('playing');
}

playBtn.addEventListener('click', () => {
  if (isPlaying) stopTransport(); else startTransport();
});

// ─── Hit detection ────────────────────────────────────────────────────────────
function checkHit(col) {
  // Scan from bottom (most recently passed) upward
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.col !== col) continue;

    // Block overlaps hit zone: bottom is below zone-top AND top is above zone-bottom
    if (b.y + b.height >= hitLineY - HIT_WINDOW && b.y <= hitLineY + HIT_WINDOW) {
      if (b.type === 'trigger') {
        blocks.splice(i, 1);
        b.el.classList.add('hit');
        b.el.addEventListener('animationend', () => b.el.remove(), { once: true });
        playRandomSample();
        addScore(2);
      } else if (!gateBlock[col]) {
        // Gate: keep falling, start looping audio until it exits the hit zone
        b.el.classList.add('held');
        gateBlock[col] = b;
        startGateAudio(col);
        gateScoreInterval[col] = setInterval(() => addScore(1), 1000);
      }
      return;
    }
  }
  // No block on hit line — silent
}

// ─── Gate release ─────────────────────────────────────────────────────────────
function releaseGate(col) {
  if (!gateBlock[col]) return;
  stopGateAudio(col);
  if (gateScoreInterval[col]) { clearInterval(gateScoreInterval[col]); gateScoreInterval[col] = null; }
  gateBlock[col].el.classList.remove('held');
  gateBlock[col] = null;
}

// ─── Control buttons ──────────────────────────────────────────────────────────
buttons.forEach(btn => {
  const col = parseInt(btn.dataset.col);

  const press = e => {
    e.preventDefault();
    btn.classList.add('active');
    checkHit(col);
  };
  const release = e => {
    e.preventDefault();
    btn.classList.remove('active');
    releaseGate(col);
  };

  btn.addEventListener('mousedown',  press);
  btn.addEventListener('touchstart', press,   { passive: false });
  btn.addEventListener('mouseup',    release);
  btn.addEventListener('mouseleave', release);
  btn.addEventListener('touchend',   release, { passive: false });
});

// ─── Keyboard triggers ────────────────────────────────────────────────────────
const KEY_MAP = { a: 0, s: 1, d: 2, f: 3 };

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  const col = KEY_MAP[e.key.toLowerCase()];
  if (col === undefined) return;
  buttons[col].classList.add('active');
  checkHit(col);
});

document.addEventListener('keyup', e => {
  const col = KEY_MAP[e.key.toLowerCase()];
  if (col === undefined) return;
  buttons[col].classList.remove('active');
  releaseGate(col);
});

// ─── Entry ────────────────────────────────────────────────────────────────────
document.getElementById('enter-button').addEventListener('click', async () => {
  document.getElementById('enter-overlay').style.display = 'none';
  await initAudio();
  applyLayout();
});

window.addEventListener('resize', applyLayout);
applyLayout();
