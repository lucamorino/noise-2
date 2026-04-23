// ─── Constants ────────────────────────────────────────────────────────────────
const TRANSPORT_H = 52;
const BLOCK_H     = 52;

// Mutable params — loaded from localStorage, editable via settings page
const _p     = JSON.parse(localStorage.getItem('noise-params') || '{}');
let SPEED      = _p.speed      ?? 2.5;
let SPAWN_MS   = _p.spawnMs    ?? 1100;
let HIT_WINDOW = _p.hitWindow  ?? 30;

const SAMPLE_FILES = [
  'samples/drakqs-NS-A%235-ff-75.wav',
  'samples/drakqs-NS-A%235-pp-826.wav',
  'samples/drakqs-NS-A%236-pp-206.wav',
  'samples/drakqs-NS-A%237-ff-1039.wav',
  'samples/drakqs-NS-A6-ff-1025.wav',
  'samples/drakqs-NS-A6-ff-663.wav',
  'samples/drakqs-NS-A7-ff-518.wav',
  'samples/drakqs-NS-B5-f-654.wav',
  'samples/drakqs-NS-B6-f-1225.wav',
  'samples/drakqs-NS-B7-pp-721.wav'
];

// ─── State ────────────────────────────────────────────────────────────────────
let audioCtx    = null;
let device      = null;
let sampleBufs  = [];
let isPlaying   = false;
let blocks      = [];
let gameAreaH   = 0;
let hitLineY    = 0;
let lastSpawn   = 0;
let animFrameId = null;

// ─── DOM ──────────────────────────────────────────────────────────────────────
const cols       = [0,1,2,3].map(i => document.getElementById('col-' + i));
const buttons    = document.querySelectorAll('.btn');
const playBtn    = document.getElementById('play-btn');
const playIcon   = document.getElementById('play-icon');
const playLabel  = document.getElementById('play-label');
const hitLineEl  = document.getElementById('hit-line');
const hitLineMid = document.getElementById('hit-line-mid');
const controlsEl = document.getElementById('controls');

// ─── Layout ───────────────────────────────────────────────────────────────────
function applyLayout() {
  // Read actual controls height (includes iOS safe-area padding from CSS)
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

    const out = audioCtx.createGain();
    out.connect(audioCtx.destination);
    device = await RNBO.createDevice({ context: audioCtx, patcher });
    device.node.connect(out);
    console.log('RNBO device ready');
  } catch (e) {
    console.warn('RNBO unavailable:', e);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sendMessageToInport(dev, tag, values) {
  dev.scheduleEvent(new RNBO.MessageEvent(RNBO.TimeNow, tag, values));
}

// ─── Sample playback ──────────────────────────────────────────────────────────
// Signal chain: BufferSource → device.node (RNBO audio input) → gain → destination
function playRandomSample() {
  if (!audioCtx || sampleBufs.length === 0) return;
  const buf = sampleBufs[Math.floor(Math.random() * sampleBufs.length)];
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(device ? device.node : audioCtx.destination);
  src.start();
}

// ─── RNBO transport ───────────────────────────────────────────────────────────
function rnboStart(val) {
  if (!device || !window.RNBO) return;
  sendMessageToInport(device, 'start', [val]);
  sendMessageToInport(device, 'style', [200, 288, 300]);
  sendMessageToInport(device, 'accelerometer', [0, 0, 0]);
}

// ─── Game loop ────────────────────────────────────────────────────────────────
function spawnBlock() {
  const col = Math.floor(Math.random() * 4);
  const el  = document.createElement('div');
  el.classList.add('block');
  el.style.top = -BLOCK_H + 'px';
  cols[col].appendChild(el);
  blocks.push({ el, col, y: -BLOCK_H });
}

function gameLoop(ts) {
  if (!isPlaying) return;

  if (ts - lastSpawn > SPAWN_MS) {
    spawnBlock();
    lastSpawn = ts;
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

  animFrameId = requestAnimationFrame(gameLoop);
}

// ─── Transport ────────────────────────────────────────────────────────────────
function startTransport() {
  isPlaying   = true;
  lastSpawn   = 0;
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
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.col !== col) continue;
    if (b.y + BLOCK_H >= hitLineY - HIT_WINDOW && b.y <= hitLineY + HIT_WINDOW) {
      blocks.splice(i, 1);
      b.el.classList.add('hit');
      b.el.addEventListener('animationend', () => b.el.remove(), { once: true });
      playRandomSample();
      return;
    }
  }
  // No block on hit line — silent
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
});

// ─── Entry ────────────────────────────────────────────────────────────────────
document.getElementById('enter-button').addEventListener('click', async () => {
  document.getElementById('enter-overlay').style.display = 'none';
  await initAudio();
  applyLayout();
});

window.addEventListener('resize', applyLayout);
applyLayout();
