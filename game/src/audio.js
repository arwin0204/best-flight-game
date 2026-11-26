// audio.js — synthesised sound for Sky Courier, WebAudio only.
// No audio files: the engine is two detuned oscillators through a low-pass
// filter, rings chime with a short arpeggio, landings thud, crashes rumble.
// Audio starts only after the first user gesture (browser policy).

/**
 * The sound engine: owns one AudioContext and its nodes.
 * @typedef {Object} SoundEngine
 * @property {AudioContext | null} ctx audio context, null until unlocked
 * @property {OscillatorNode | null} engineOsc main engine tone
 * @property {OscillatorNode | null} engineOsc2 second engine tone, detuned
 * @property {GainNode | null} engineGain engine volume
 * @property {BiquadFilterNode | null} engineFilter engine low-pass
 * @property {boolean} muted true when the player pressed M
 */

/**
 * Create a sound engine. Nothing sounds until unlock() runs on a gesture.
 * @returns {SoundEngine}
 */
export function createSoundEngine() {
  return {
    ctx: null,
    engineOsc: null,
    engineOsc2: null,
    engineGain: null,
    engineFilter: null,
    muted: false,
  };
}

/**
 * Unlock audio after a user gesture; safe to call repeatedly.
 * @param {SoundEngine} engine engine to unlock
 */
export function unlockAudio(engine) {
  if (engine.ctx) {
    if (engine.ctx.state === 'suspended') void engine.ctx.resume();
    return;
  }
  try {
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    engine.ctx = ctx;
    // Engine drone: sawtooth + square, one octave apart, low-passed.
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 55;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 110;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc1.start();
    osc2.start();
    engine.engineOsc = osc1;
    engine.engineOsc2 = osc2;
    engine.engineGain = gain;
    engine.engineFilter = filter;
  } catch {
    engine.ctx = null; // Audio unavailable: the game stays silent, never crashes.
  }
}

/**
 * Update the engine drone from throttle and speed; call every frame.
 * @param {SoundEngine} engine engine to update
 * @param {number} throttle 0..1
 * @param {number} speed metres per second
 * @param {boolean} flying true while the game is in the playing state
 */
export function updateEngineSound(engine, throttle, speed, flying) {
  if (!engine.ctx || !engine.engineGain || !engine.engineOsc || !engine.engineOsc2 || !engine.engineFilter) return;
  if (engine.muted) {
    engine.engineGain.gain.setTargetAtTime(0, engine.ctx.currentTime, 0.05);
    return;
  }
  const t = engine.ctx.currentTime;
  const target = flying ? 0.045 + throttle * 0.075 + Math.min(0.03, speed * 0.0004) : 0;
  engine.engineGain.gain.setTargetAtTime(target, t, 0.12);
  const freq = 48 + throttle * 72 + speed * 0.35;
  engine.engineOsc.frequency.setTargetAtTime(freq, t, 0.1);
  engine.engineOsc2.frequency.setTargetAtTime(freq * 2.02, t, 0.1);
  engine.engineFilter.frequency.setTargetAtTime(320 + throttle * 900, t, 0.15);
}

/**
 * Play a short tone with an exponential decay envelope.
 * @param {SoundEngine} engine engine to play through
 * @param {number} freqHz tone frequency
 * @param {number} duration seconds
 * @param {number} volume 0..1
 * @param {string} type oscillator type
 * @param {number} delay seconds to wait before starting
 */
export function playTone(engine, freqHz, duration, volume, type, delay) {
  if (!engine.ctx || engine.muted) return;
  try {
    const t0 = engine.ctx.currentTime + (delay || 0);
    const osc = engine.ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freqHz;
    const gain = engine.ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(engine.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  } catch {
    // A failed blip must never break the game loop.
  }
}

/** Ring chime: a bright three-note arpeggio. */
export function playRingChime(engine) {
  playTone(engine, 660, 0.35, 0.22, 'sine', 0);
  playTone(engine, 880, 0.4, 0.22, 'sine', 0.09);
  playTone(engine, 1320, 0.5, 0.18, 'sine', 0.18);
}

/** Landing thud: a low, soft bump. */
export function playLandingThud(engine) {
  playTone(engine, 90, 0.3, 0.4, 'sine', 0);
  playTone(engine, 55, 0.45, 0.35, 'triangle', 0.02);
}

/** Crash rumble: descending noise-like low tones. */
export function playCrashSound(engine) {
  playTone(engine, 160, 0.5, 0.4, 'sawtooth', 0);
  playTone(engine, 70, 0.9, 0.45, 'sawtooth', 0.08);
  playTone(engine, 42, 1.2, 0.4, 'triangle', 0.15);
}

/** Mission-complete fanfare: four rising notes. */
export function playMissionComplete(engine) {
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => playTone(engine, f, 0.5, 0.2, 'triangle', i * 0.12));
}

/** Warning beep when fuel runs low or damage is high. */
export function playWarningBeep(engine) {
  playTone(engine, 1150, 0.12, 0.14, 'square', 0);
  playTone(engine, 1150, 0.12, 0.14, 'square', 0.18);
}

/**
 * Toggle mute; returns the new muted state.
 * @param {SoundEngine} engine engine to mute/unmute
 * @returns {boolean} true when now muted
 */
export function toggleMute(engine) {
  engine.muted = !engine.muted;
  return engine.muted;
}
