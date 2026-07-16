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
    // horizontal input axis: -1, 0 or 1
    axis: () => (heldAction('right') ? 1 : 0) - (heldAction('left') ? 1 : 0),
    // call once at the end of every frame
    endFrame: () => {
      justPressed.clear();
      anyKey = false;
    },
  };
})();
