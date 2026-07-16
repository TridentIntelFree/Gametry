// On-screen touch controls for phones / tablets.
// Shown only on coarse-pointer devices (or with ?touch=1 for testing).
(() => {
  const wantTouch =
    window.matchMedia('(pointer: coarse)').matches ||
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    new URLSearchParams(location.search).has('touch');
  if (!wantTouch) return;

  const root = document.createElement('div');
  root.id = 'touch-controls';

  const dpad = document.createElement('div');
  dpad.className = 'tc-dpad';
  for (const [action, label, area] of [
    ['up', '▲', 'up'],
    ['left', '◀', 'left'],
    ['right', '▶', 'right'],
    ['down', '▼', 'down'],
  ]) {
    const b = document.createElement('div');
    b.className = 'tc-btn';
    b.dataset.action = action;
    b.style.gridArea = area;
    b.textContent = label;
    dpad.appendChild(b);
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
  }

  root.appendChild(dpad);
  root.appendChild(actions);
  document.body.appendChild(root);

  // pointerId -> currently held action (supports multi-touch and
  // sliding a thumb across the d-pad without lifting it)
  const held = new Map();

  function buttonAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest('.tc-btn') : null;
  }

  function press(pointerId, btn) {
    const action = btn ? btn.dataset.action : null;
    const prev = held.get(pointerId);
    if (prev === action) return;
    if (prev) {
      Input.simulateUp(prev);
      const prevBtn = root.querySelector(`[data-action="${prev}"]`);
      if (prevBtn) prevBtn.classList.remove('tc-active');
    }
    if (action) {
      Input.simulateDown(action);
      btn.classList.add('tc-active');
      held.set(pointerId, action);
    } else {
      held.delete(pointerId);
    }
  }

  function release(pointerId) {
    press(pointerId, null);
  }

  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    press(e.pointerId, buttonAt(e.clientX, e.clientY));
  });
  root.addEventListener('pointermove', (e) => {
    if (held.has(e.pointerId)) press(e.pointerId, buttonAt(e.clientX, e.clientY));
  });
  root.addEventListener('pointerup', (e) => release(e.pointerId));
  root.addEventListener('pointercancel', (e) => release(e.pointerId));
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // tapping the game itself dismisses the title screen
  const canvas = document.getElementById('game');
  canvas.addEventListener('pointerdown', () => Input.anyPress());

  // stop iOS rubber-band scrolling / double-tap zoom on the play area
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
})();
