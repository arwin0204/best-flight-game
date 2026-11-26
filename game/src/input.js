// input.js — keyboard and mouse input for Sky Courier.
// Keyboard flies the plane (W/S pitch, A/D bank, Shift/Ctrl throttle,
// Space airbrake, P pause, M mute, R restart, 1/2/3 pick a mission).
// Mouse clicks the title-screen mission rows and drags to trim the nose.

/**
 * Live input state, updated by listeners and read by the game loop.
 * @typedef {Object} InputState
 * @property {Set<string>} keys currently held keys, by code
 * @property {number} trim pitch trim from mouse drag, -1..1
 * @property {{ x: number, y: number } | null} dragStart drag origin, if dragging
 * @property {boolean} clicked true for one frame after a click
 * @property {number} clickX last click x in canvas pixels
 * @property {number} clickY last click y in canvas pixels
 * @property {boolean} anyKey true for one frame after any key press
 * @property {string} lastKey code of the most recent key press
 */

/**
 * Create fresh input state and attach listeners to the window and canvas.
 * @param {HTMLCanvasElement} canvas game canvas (for mouse coordinates)
 * @returns {InputState}
 */
export function createInput(canvas) {
  const input = {
    keys: new Set(),
    trim: 0,
    dragStart: null,
    clicked: false,
    clickX: 0,
    clickY: 0,
    anyKey: false,
    lastKey: '',
  };
  window.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
      event.preventDefault();
    }
    if (!event.repeat) {
      input.anyKey = true;
      input.lastKey = event.code;
    }
    input.keys.add(event.code);
  });
  window.addEventListener('keyup', (event) => {
    input.keys.delete(event.code);
  });
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.dragStart = null;
  });
  canvas.addEventListener('mousedown', (event) => {
    const rect = canvas.getBoundingClientRect();
    input.dragStart = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    input.clicked = true;
    input.clickX = event.clientX - rect.left;
    input.clickY = event.clientY - rect.top;
  });
  window.addEventListener('mousemove', (event) => {
    if (!input.dragStart) return;
    const rect = canvas.getBoundingClientRect();
    const dy = event.clientY - rect.top - input.dragStart.y;
    // Dragging up trims nose-down, dragging down trims nose-up.
    input.trim = clampNumber(-dy / 220, -1, 1);
  });
  window.addEventListener('mouseup', () => {
    input.dragStart = null;
  });
  // Touch: one finger drag trims, tap counts as a click.
  canvas.addEventListener('touchstart', (event) => {
    event.preventDefault();
    const touch = event.touches[0];
    const rect = canvas.getBoundingClientRect();
    input.dragStart = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    input.clicked = true;
    input.clickX = touch.clientX - rect.left;
    input.clickY = touch.clientY - rect.top;
  }, { passive: false });
  canvas.addEventListener('touchmove', (event) => {
    event.preventDefault();
    if (!input.dragStart) return;
    const touch = event.touches[0];
    const rect = canvas.getBoundingClientRect();
    const dy = touch.clientY - rect.top - input.dragStart.y;
    input.trim = clampNumber(-dy / 220, -1, 1);
  }, { passive: false });
  canvas.addEventListener('touchend', () => {
    input.dragStart = null;
  });
  return input;
}

/**
 * Read the current flight controls from held keys.
 * @param {InputState} input live input state
 * @returns {import('./plane.js').FlightControls}
 */
export function readFlightControls(input) {
  const keys = input.keys;
  const pitchUp = keys.has('KeyW') || keys.has('ArrowUp');
  const pitchDown = keys.has('KeyS') || keys.has('ArrowDown');
  const rollLeft = keys.has('KeyA') || keys.has('ArrowLeft');
  const rollRight = keys.has('KeyD') || keys.has('ArrowRight');
  const throttleUp = keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('Equal') || keys.has('NumpadAdd');
  const throttleDown = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('Minus') || keys.has('NumpadSubtract');
  return {
    pitchInput: (pitchUp ? 1 : 0) - (pitchDown ? 1 : 0),
    rollInput: (rollRight ? 1 : 0) - (rollLeft ? 1 : 0),
    throttleDelta: (throttleUp ? 1 : 0) - (throttleDown ? 1 : 0),
    airbrake: keys.has('Space'),
    trim: input.trim,
  };
}

/** Was a key pressed since the last check (consumes the flag)? */
export function consumeKeyPress(input, code) {
  if (input.anyKey && input.lastKey === code) {
    input.anyKey = false;
    return true;
  }
  return false;
}

/** Was any key pressed since the last check (consumes the flag)? */
export function consumeAnyKey(input) {
  if (input.anyKey) {
    input.anyKey = false;
    return true;
  }
  return false;
}

/** Was the canvas clicked since the last check (consumes the flag)? */
export function consumeClick(input) {
  if (input.clicked) {
    input.clicked = false;
    return { x: input.clickX, y: input.clickY };
  }
  return null;
}

/** Clear one-frame flags at the end of a game-loop tick. */
export function endFrameInput(input) {
  input.anyKey = false;
  input.clicked = false;
}

/** Clamp a number into [min, max]. */
export function clampNumber(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
