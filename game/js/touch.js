// On-screen touch controls for phones / tablets.
// Shown only on coarse-pointer devices (or with ?touch=1 for testing).
(() => {
  const wantTouch =
    window.matchMedia('(pointer: coarse)').matches ||
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    new URLSearchParams(location.search).has('touch');
  if (!wantTouch) return;

  window.TOUCH_UI = true;

  const root = document.createElement('div');
  root.id = 'touch-controls';

  const dpad = document.createElement('div');
  dpad.className = 'tc-dpad';
  const btnEl = {};
  for (const [action, label, area] of [
    ['up', '▲', 'up'],
    ['left', '◀', 'left'],
    ['right', '▶', 'right'],
    ['down', '▼', 'down'],
  ]) {
    const b = document.createElement('div');
    b.className = 'tc-btn';
    b.style.gridArea = area;
    b.textContent = label;
    dpad.appendChild(b);
    btnEl[action] = b;
  }

  const actions = document.createElement('div');
  actions.className = 'tc-actions';
  for (const [action, label, area, cls] of [
    ['heal', 'BIND', 'heal', ''],
    ['dash', 'DASH', 'dash', ''],
    ['attack', 'ATK', 'attack', ''],
    ['jump', 'JUMP', 'jump', 'tc-btn-big'],
  ]) {
    const b = document.createElement('div');
    b.className = `tc-btn ${cls}`;
    b.dataset.action = action;
    b.style.gridArea = area;
    b.textContent = label;
    actions.appendChild(b);
    btnEl[action] = b;
  }

  root.appendChild(dpad);
  root.appendChild(actions);
  document.body.appendChild(root);

  // --- pointer tracking -----------------------------------------------
  // The d-pad is a virtual stick: direction comes from the touch position
  // relative to the pad centre, so there are no dead gaps between buttons
  // and diagonals (e.g. right + down for a moving pogo) work. Action
  // buttons latch on press and release on lift, so a thumb can drift
  // mid-jump without dropping the input.

  const held = new Map(); // pointerId -> { zone, action, set }
  let active = new Set();

  function dpadSet(x, y) {
    const rect = dpad.getBoundingClientRect();
    const dx = x - (rect.left + rect.width / 2);
    const dy = y - (rect.top + rect.height / 2);
    const set = new Set();
    if (Math.hypot(dx, dy) < rect.width * 0.09) return set;
    const oct = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
    if (oct === 7 || oct === 0 || oct === 1) set.add('right');
    if (oct === 1 || oct === 2 || oct === 3) set.add('down');
    if (oct === 3 || oct === 4 || oct === 5) set.add('left');
    if (oct === 5 || oct === 6 || oct === 7) set.add('up');
    return set;
  }

  function sync() {
    const union = new Set();
    for (const rec of held.values()) {
      if (rec.set) for (const a of rec.set) union.add(a);
      if (rec.action) union.add(rec.action);
    }
    for (const a of union) {
      if (!active.has(a)) {
        Input.simulateDown(a);
        btnEl[a].classList.add('tc-active');
      }
    }
    for (const a of active) {
      if (!union.has(a)) {
        Input.simulateUp(a);
        btnEl[a].classList.remove('tc-active');
      }
    }
    active = union;
  }

  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (dpad.contains(e.target)) {
      held.set(e.pointerId, { zone: 'dpad', set: dpadSet(e.clientX, e.clientY) });
    } else {
      const btn = e.target.closest('[data-action]');
      held.set(e.pointerId, { zone: 'btn', action: btn ? btn.dataset.action : null });
    }
    sync();
  });

  root.addEventListener('pointermove', (e) => {
    const rec = held.get(e.pointerId);
    if (!rec) return;
    if (rec.zone === 'dpad') {
      rec.set = dpadSet(e.clientX, e.clientY);
      sync();
    } else if (!rec.action) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const btn = el && el.closest ? el.closest('[data-action]') : null;
      if (btn) { rec.action = btn.dataset.action; sync(); }
    }
  });

  const release = (e) => {
    if (held.delete(e.pointerId)) sync();
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // tapping the game itself dismisses the title screen
  const canvas = document.getElementById('game');
  canvas.addEventListener('pointerdown', () => Input.anyPress());

  // --- kill iOS zoom gestures and the tap-delay they cause -------------
  // Safari ignores user-scalable=no, and while double-tap zoom is possible
  // it delays every tap to wait for a second one — that delay IS the input
  // latency. preventDefault on touchend (plus touch-action: none in CSS)
  // disables the gesture and with it the delay.
  for (const ev of ['touchstart', 'touchmove', 'touchend']) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }
  for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) {
    document.addEventListener(ev, (e) => e.preventDefault());
  }
})();
