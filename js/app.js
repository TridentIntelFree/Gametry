// Lumen — app wiring: camera, pipeline, motion, UI.

import { Camera } from './camera.js';
import { Pipeline } from './pipeline.js';
import { Stabilizer, MARGIN } from './motion.js';
import { MODES, applyMode } from './modes.js';

const $ = (id) => document.getElementById(id);

const el = {
  view: $('view'), gate: $('gate'), begin: $('begin'), gateError: $('gate-error'),
  top: $('top'), bottom: $('bottom'), readout: $('readout'), hint: $('hint'),
  modes: $('modes'), lenses: $('lenses'), guides: $('guides'),
  zoom: $('zoom'), zoomval: $('zoomval'), shutter: $('shutter'),
  histogram: $('histogram'), statRes: $('stat-res'), statFps: $('stat-fps'),
  statGain: $('stat-gain'), sliders: $('sliders'), diag: $('diag'),
  diagBody: $('diag-body'), diagClose: $('diag-close'),
  btnStab: $('btn-stab'), btnPeak: $('btn-peak'), btnGrid: $('btn-grid'),
  btnHist: $('btn-hist'), btnTorch: $('btn-torch'), btnDiag: $('btn-diag'),
  btnTune: $('btn-tune'), btnFlip: $('btn-flip'),
};

const camera = new Camera();
const stabilizer = new Stabilizer();
let pipeline = null;
let running = false;
let currentMode = 'auto';
let userZoom = 1;
let front = false;
let torchOn = false;
let hintTimer = 0;

const hctx = el.histogram.getContext('2d');

// --------------------------------------------------------------- start ---

el.begin.addEventListener('click', async () => {
  el.begin.disabled = true;
  el.begin.textContent = 'Starting…';
  el.gateError.hidden = true;
  try {
    await start();
  } catch (err) {
    el.gateError.textContent = describeError(err);
    el.gateError.hidden = false;
    el.begin.disabled = false;
    el.begin.textContent = 'Try again';
  }
});

function describeError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError') {
    return 'Camera permission was denied. Open Settings → Safari → Camera and allow access, then reload.';
  }
  if (name === 'NotFoundError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') {
    return 'The camera is busy — close other apps or tabs using it and try again.';
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    return 'Camera access needs a secure (https) connection.';
  }
  return err?.message || 'Could not start the camera.';
}

async function start() {
  await camera.start(1);

  pipeline = new Pipeline(el.view);
  // Ask for motion permission in the same gesture; declining just disables it.
  await stabilizer.requestPermission();

  buildModes();
  buildLenses();
  applyPreset('auto');
  syncSliders();
  resizeCanvas();

  el.gate.hidden = true;
  el.top.hidden = false;
  el.bottom.hidden = false;
  el.readout.hidden = false;
  if (camera.capabilities.hasTorch) el.btnTorch.hidden = false;

  running = true;
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- UI ---

function buildModes() {
  el.modes.innerHTML = '';
  for (const [key, mode] of Object.entries(MODES)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = mode.name;
    b.dataset.mode = key;
    b.addEventListener('click', () => applyPreset(key));
    el.modes.appendChild(b);
  }
}

function buildLenses() {
  el.lenses.innerHTML = '';
  if (camera.lenses.length < 2) return;
  for (const lens of camera.lenses) {
    const b = document.createElement('button');
    b.className = 'lens';
    b.textContent = lens.label;
    b.title = lens.name;
    b.dataset.factor = String(lens.factor);
    b.addEventListener('click', () => selectLens(lens));
    el.lenses.appendChild(b);
  }
  markLens();
}

function markLens() {
  const active = camera.lenses.find((l) => l.deviceId === camera.currentId);
  for (const b of el.lenses.children) {
    b.classList.toggle('on', !!active && b.dataset.factor === String(active.factor));
  }
}

async function selectLens(lens) {
  if (lens.deviceId === camera.currentId) return;
  try {
    await camera.open(lens.deviceId, 'environment');
    front = false;
    pipeline.state.mirror = false;
    pipeline.reset();
    markLens();
    el.btnTorch.hidden = !camera.capabilities.hasTorch;
    showHint(`${lens.name}`);
  } catch (err) {
    showHint('Could not switch lens');
  }
}

function applyPreset(key) {
  const mode = applyMode(pipeline, key);
  if (!mode) return;
  currentMode = key;

  for (const b of el.modes.children) b.classList.toggle('on', b.dataset.mode === key);

  // Macro wants the ultra-wide, which focuses closest.
  if (mode.lensFactor != null && camera.lenses.length > 1) {
    const lens = camera.lenses.find((l) => l.factor === mode.lensFactor);
    if (lens && lens.deviceId !== camera.currentId) selectLens(lens);
  }
  if (mode.zoom != null) {
    userZoom = mode.zoom;
    el.zoom.value = String(userZoom);
  }

  el.btnPeak.setAttribute('aria-pressed', pipeline.state.peak > 0 ? 'true' : 'false');
  syncSliders();
  showHint(mode.hint, 4200);
}

function syncSliders() {
  const s = pipeline.state;
  $('sl-gain').value = String(s.gain);
  $('sl-gamma').value = String(s.gamma);
  $('sl-contrast').value = String(s.contrast);
  $('sl-denoise').value = String(s.denoise);
  $('sl-sharp').value = String(s.sharpen);
  $('sl-sat').value = String(s.saturation);
}

function bindSlider(id, key) {
  $(id).addEventListener('input', (e) => {
    pipeline.state[key] = parseFloat(e.target.value);
  });
}
bindSlider('sl-gain', 'gain');
bindSlider('sl-gamma', 'gamma');
bindSlider('sl-contrast', 'contrast');
bindSlider('sl-denoise', 'denoise');
bindSlider('sl-sharp', 'sharpen');
bindSlider('sl-sat', 'saturation');

el.zoom.addEventListener('input', (e) => {
  setZoom(parseFloat(e.target.value));
});

function setZoom(z) {
  userZoom = Math.max(1, Math.min(8, z));
  el.zoom.value = String(userZoom);
  el.zoomval.textContent = `${userZoom.toFixed(1)}×`;
  // Prefer sensor zoom where the browser offers it; the shader covers the rest.
  camera.setNativeZoom(userZoom).catch(() => {});
}

// pinch to zoom on the viewfinder
let pinchStart = null;
el.view.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) pinchStart = { d: touchDist(e.touches), z: userZoom };
}, { passive: true });
el.view.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && pinchStart) {
    const ratio = touchDist(e.touches) / pinchStart.d;
    setZoom(pinchStart.z * ratio);
  }
}, { passive: true });
el.view.addEventListener('touchend', () => { pinchStart = null; }, { passive: true });

function touchDist(t) {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}

// toggles
el.btnStab.addEventListener('click', async () => {
  if (!stabilizer.granted) {
    const ok = await stabilizer.requestPermission();
    if (!ok) {
      showHint('Motion access denied — enable it in Settings → Safari → Motion & Orientation', 5000);
      return;
    }
  }
  stabilizer.enabled = !stabilizer.enabled;
  stabilizer.reset();
  el.btnStab.setAttribute('aria-pressed', String(stabilizer.enabled));
  showHint(stabilizer.enabled
    ? 'Stabiliser on — the frame crops slightly to leave room to correct'
    : 'Stabiliser off');
});

el.btnPeak.addEventListener('click', () => {
  const on = pipeline.state.peak > 0;
  pipeline.state.peak = on ? 0 : 0.18;
  el.btnPeak.setAttribute('aria-pressed', String(!on));
});

el.btnGrid.addEventListener('click', () => {
  el.guides.hidden = !el.guides.hidden;
  el.btnGrid.setAttribute('aria-pressed', String(!el.guides.hidden));
});

el.btnHist.addEventListener('click', () => {
  el.readout.hidden = !el.readout.hidden;
  el.btnHist.setAttribute('aria-pressed', String(!el.readout.hidden));
});

el.btnTorch.addEventListener('click', async () => {
  torchOn = !torchOn;
  const ok = await camera.setTorch(torchOn);
  if (!ok) { torchOn = false; showHint('Torch is not controllable here'); }
  el.btnTorch.setAttribute('aria-pressed', String(torchOn));
});

el.btnTune.addEventListener('click', () => {
  el.sliders.hidden = !el.sliders.hidden;
  el.btnTune.classList.toggle('on', !el.sliders.hidden);
});

el.btnFlip.addEventListener('click', async () => {
  try {
    front = !front;
    if (front) await camera.switchToFront();
    else {
      const lens = camera.pickLens(1);
      await camera.open(lens ? lens.deviceId : null, 'environment');
    }
    pipeline.state.mirror = front;
    pipeline.reset();
    markLens();
  } catch {
    showHint('Could not switch camera');
  }
});

el.btnDiag.addEventListener('click', showDiagnostics);
el.diagClose.addEventListener('click', () => { el.diag.hidden = true; });

// ------------------------------------------------------------ capture ---

el.shutter.addEventListener('click', async () => {
  if (!pipeline || el.shutter.classList.contains('busy')) return;
  el.shutter.classList.add('busy');
  try {
    const blob = await pipeline.capture();
    if (!blob) throw new Error('capture failed');
    const file = new File([blob], `lumen-${stamp()}.png`, { type: 'image/png' });

    // Share sheet is the only reliable route into the iOS photo library.
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      showHint('Saved');
    }
  } catch (err) {
    if (err?.name !== 'AbortError') showHint('Could not save image');
  } finally {
    el.shutter.classList.remove('busy');
  }
});

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// -------------------------------------------------------- diagnostics ---

function showDiagnostics() {
  const caps = camera.capabilities;
  const cc = caps.capabilities || {};
  const st = caps.settings || {};
  const gl = pipeline.core.gl;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');

  const yn = (v) => `<span class="${v ? 'yes' : 'no'}">${v ? 'yes' : 'no'}</span>`;
  const rows = [
    ['Resolution', st.width ? `${st.width} × ${st.height}` : `${camera.width} × ${camera.height}`],
    ['Frame rate', st.frameRate ? `${Math.round(st.frameRate)} fps` : '—'],
    ['Lenses found', camera.lenses.length
      ? camera.lenses.map((l) => l.label).join('  ')
      : '1 (labels unavailable)'],
    ['Sensor zoom', yn(caps.hasZoom) + (cc.zoom ? ` (${cc.zoom.min}–${cc.zoom.max})` : '')],
    ['Torch', yn(caps.hasTorch)],
    ['Manual focus', yn(caps.hasFocus)],
    ['Manual ISO', yn(caps.hasISO)],
    ['Manual shutter', yn(caps.hasExposureTime)],
    ['Motion sensor', yn(stabilizer.available && stabilizer.granted)],
    ['16-bit processing', yn(pipeline.core.floatLinear)],
    ['GPU', dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)],
    ['Processing size', `${pipeline.width} × ${pipeline.height}`],
    ['LiDAR / depth', '<span class="no">not exposed to web apps</span>'],
    ['RAW capture', '<span class="no">not exposed to web apps</span>'],
  ];

  el.diagBody.innerHTML = rows
    .map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`)
    .join('');
  el.diag.hidden = false;
}

// --------------------------------------------------------------- loop ---

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (el.view.width !== w || el.view.height !== h) {
    el.view.width = w;
    el.view.height = h;
  }
}
window.addEventListener('resize', resizeCanvas);
window.visualViewport?.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 250));

let last = performance.now();
let fpsAvg = 60;

function loop(now) {
  if (!running) return;
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  fpsAvg += (1 / Math.max(dt, 0.001) - fpsAvg) * 0.05;

  resizeCanvas();

  // Stabilising needs spare pixels around the frame, so force a minimum crop.
  const motion = stabilizer.update(dt);
  const floor = stabilizer.enabled && stabilizer.granted ? MARGIN : 1;
  pipeline.state.zoom = Math.max(userZoom, floor);

  const t0 = performance.now();
  try {
    pipeline.render(camera, motion, dt);
  } catch (err) {
    running = false;
    el.gate.hidden = false;
    el.gateError.textContent = `Rendering stopped: ${err.message}`;
    el.gateError.hidden = false;
    el.begin.textContent = 'Restart';
    el.begin.disabled = false;
    return;
  }
  pipeline.observeFrameTime(performance.now() - t0);

  if (!el.readout.hidden) drawReadout();
  requestAnimationFrame(loop);
}

function drawReadout() {
  const w = el.histogram.width, h = el.histogram.height;
  hctx.clearRect(0, 0, w, h);
  const hist = pipeline.histogram;
  let peak = 1;
  for (let i = 0; i < hist.length; i++) peak = Math.max(peak, hist[i]);
  const bw = w / hist.length;
  hctx.fillStyle = 'rgba(160,210,255,0.75)';
  for (let i = 0; i < hist.length; i++) {
    // log scale: linear hides everything but the dominant tone
    const v = Math.log1p(hist[i]) / Math.log1p(peak);
    const bh = v * (h - 2);
    hctx.fillRect(i * bw, h - bh, Math.max(1, bw - 0.5), bh);
  }

  el.statRes.textContent = `${pipeline.width}×${pipeline.height}`;
  el.statFps.textContent = `${Math.round(fpsAvg)}fps`;
  el.statGain.textContent = `${(pipeline.autoGain * pipeline.state.gain).toFixed(1)}×`;
}

function showHint(text, ms = 2600) {
  el.hint.textContent = text;
  el.hint.hidden = false;
  el.hint.style.opacity = '1';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    el.hint.style.opacity = '0';
    setTimeout(() => { el.hint.hidden = true; }, 400);
  }, ms);
}

// Releasing the camera when backgrounded keeps iOS from killing the stream.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    running = false;
  } else if (pipeline && camera.stream) {
    running = true;
    last = performance.now();
    pipeline.reset();
    requestAnimationFrame(loop);
  }
});
