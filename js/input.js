// Keyboard input with held / just-pressed states and action mapping.
const Input = (() => {
  const ACTIONS = {
    left:   ['ArrowLeft', 'KeyA'],
    right:  ['ArrowRight', 'KeyD'],
    up:     ['ArrowUp', 'KeyW'],
    down:   ['ArrowDown', 'KeyS'],
    jump:   ['KeyZ', 'Space'],
    attack: ['KeyX', 'KeyJ'],
    dash:   ['KeyC', 'KeyK'],
    heal:   ['KeyV', 'KeyL'],
  };

  const gameKeys = new Set(Object.values(ACTIONS).flat());
  const down = new Set();
  const justPressed = new Set();
  let anyKey = false;

  window.addEventListener('keydown', (e) => {
    if (gameKeys.has(e.code)) e.preventDefault();
    if (!e.repeat) {
      justPressed.add(e.code);
      anyKey = true;
    }
    down.add(e.code);
  });

  window.addEventListener('keyup', (e) => {
    down.delete(e.code);
  });

  window.addEventListener('blur', () => {
    down.clear();
  });

  // programmatic input, used by the on-screen touch controls
  function simulateDown(action) {
    const code = ACTIONS[action][0];
    if (!down.has(code)) {
      justPressed.add(code);
      anyKey = true;
    }
    down.add(code);
  }

  function simulateUp(action) {
    down.delete(ACTIONS[action][0]);
  }

  function heldAction(action) {
    return ACTIONS[action].some((code) => down.has(code));
  }

  function pressedAction(action) {
    return ACTIONS[action].some((code) => justPressed.has(code));
  }

  return {
    held: heldAction,
    pressed: pressedAction,
    anyKeyPressed: () => anyKey,
    anyPress: () => { anyKey = true; },
    simulateDown,
    simulateUp,
    // horizontal input axis: -1, 0 or 1
    axis: () => (heldAction('right') ? 1 : 0) - (heldAction('left') ? 1 : 0),
    // call once at the end of every frame
    endFrame: () => {
      justPressed.clear();
      anyKey = false;
    },
  };
})();
