// ─── Default params (must match app.js defaults) ──────────────────────────────
const DEFAULTS = { speed: 2.5, spawnMs: 2100, hitWindow: 30 };
const PARAM_KEY = 'noise-params';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadParams() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(PARAM_KEY) || '{}')); }
  catch { return { ...DEFAULTS }; }
}

function saveParams(p) {
  localStorage.setItem(PARAM_KEY, JSON.stringify(p));
}

function fmtSize(bytes) {
  return bytes < 1024 * 1024
    ? (bytes / 1024).toFixed(0) + ' KB'
    : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── DOM refs ──────────────────────────────────────────────────────────────────
const folderInput  = document.getElementById('folder-input');
const uploadBtn    = document.getElementById('upload-btn');
const uploadStatus = document.getElementById('upload-status');
const sampleList   = document.getElementById('sample-list');
const clearBtn     = document.getElementById('clear-btn');

const speedSlider     = document.getElementById('speed');
const spawnSlider     = document.getElementById('spawn-ms');
const hitSlider       = document.getElementById('hit-window');
const speedVal        = document.getElementById('speed-val');
const spawnVal        = document.getElementById('spawn-ms-val');
const hitVal          = document.getElementById('hit-window-val');
const resetBtn        = document.getElementById('reset-btn');

// ─── Param controls ───────────────────────────────────────────────────────────
function initParams() {
  const p = loadParams();

  speedSlider.value = p.speed;
  spawnSlider.value = p.spawnMs;
  hitSlider.value   = p.hitWindow;

  speedVal.textContent = p.speed;
  spawnVal.textContent = p.spawnMs + ' ms';
  hitVal.textContent   = p.hitWindow + ' px';
}

function bindSlider(slider, display, format, key) {
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    display.textContent = format(v);
    const p = loadParams();
    p[key] = v;
    saveParams(p);
  });
}

bindSlider(speedSlider, speedVal,  v => v,         'speed');
bindSlider(spawnSlider, spawnVal,  v => v + ' ms', 'spawnMs');
bindSlider(hitSlider,   hitVal,    v => v + ' px', 'hitWindow');

resetBtn.addEventListener('click', () => {
  saveParams({ ...DEFAULTS });
  initParams();
});

// ─── Sample list display ───────────────────────────────────────────────────────
async function refreshSampleList() {
  sampleList.innerHTML = '';
  let entries;
  try { entries = await dbGetAllSamples(); } catch { entries = []; }

  if (entries.length === 0) {
    sampleList.innerHTML = '<p class="list-empty">No custom samples — using built-in set.</p>';
    clearBtn.style.display = 'none';
    return;
  }

  clearBtn.style.display = '';
  uploadStatus.textContent = entries.length + ' file' + (entries.length !== 1 ? 's' : '') + ' stored';

  entries.forEach(e => {
    const row = document.createElement('div');
    row.className = 'sample-row';
    row.innerHTML =
      '<span class="sample-name">' + e.name + '</span>' +
      '<span class="sample-size">' + fmtSize(e.data.byteLength) + '</span>';
    sampleList.appendChild(row);
  });
}

// ─── Folder / file upload ─────────────────────────────────────────────────────
const AUDIO_EXTS = /\.(wav|aif|aiff|mp3|ogg|flac)$/i;

uploadBtn.addEventListener('click', () => folderInput.click());

folderInput.addEventListener('change', async () => {
  const files = Array.from(folderInput.files).filter(f => AUDIO_EXTS.test(f.name));
  if (files.length === 0) {
    uploadStatus.textContent = 'No audio files found.';
    return;
  }

  uploadStatus.textContent = 'Loading ' + files.length + ' files…';
  uploadBtn.disabled = true;

  try {
    const entries = await Promise.all(
      files.map(async f => ({ name: f.name, data: await f.arrayBuffer() }))
    );
    await dbSaveSamples(entries);
    uploadStatus.textContent = '';
    await refreshSampleList();
  } catch (e) {
    uploadStatus.textContent = 'Error: ' + e.message;
  } finally {
    uploadBtn.disabled = false;
    folderInput.value  = '';
  }
});

// ─── Clear samples ─────────────────────────────────────────────────────────────
clearBtn.addEventListener('click', async () => {
  await dbClearSamples();
  await refreshSampleList();
});

// ─── Init ─────────────────────────────────────────────────────────────────────
initParams();
refreshSampleList();
