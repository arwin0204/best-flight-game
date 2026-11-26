// main.js — Langit Nusantara: Sky Courier.
// Game loop, state machine (title / playing / paused / complete / crashed /
// failed), mission wiring, screenshot modes (?shot=start|flight|landing)
// and the bridge between every module: input, plane, missions, render, HUD
// and sound. Seeded from ?seed= so screenshots reproduce exactly.

import { buildArchipelago, runwayStrip, terrainHeightAt, windForMission } from './terrain.js';
import { makeChaseCamera, makePhotoCamera, normalize3, cross3, headingDegrees, compassPoint } from './project.js';
import { createPlane, stepPlane, applyImpactDamage, isLandingGently, clamp } from './plane.js';
import {
  startMission, checkRingPass, handleTouchdown, handleRoughGround,
  tickMission, objectiveLine, nextDeliveryIsland, MISSION_DEFS,
} from './missions.js';
import { createSoundEngine, unlockAudio, updateEngineSound, playRingChime, playLandingThud, playCrashSound, playMissionComplete, playWarningBeep, toggleMute } from './audio.js';
import { bindHud, updateHud, drawArtificialHorizon, drawCompassStrip, flashMessage } from './hud.js';
import { createInput, readFlightControls, consumeKeyPress, consumeAnyKey, consumeClick, endFrameInput } from './input.js';
import { renderFrame } from './render.js';

/** Game states. */
const STATE_TITLE = 'title';
const STATE_PLAYING = 'playing';
const STATE_PAUSED = 'paused';
const STATE_COMPLETE = 'complete';
const STATE_CRASHED = 'crashed';
const STATE_FAILED = 'failed';

/** Mission ids in title-screen order. */
const MISSION_IDS = ['rings', 'delivery', 'storm'];

/**
 * Read a query parameter from the page URL.
 * @param {string} name parameter name
 * @returns {string | null}
 */
function queryParam(name) {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

/**
 * Boot the game: build the world from the seed, wire the canvas and HUD,
 * and start the frame loop. Screenshot modes pre-place the plane so a
 * single render already shows the intended scene.
 */
function bootSkyCourier() {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const seedText = queryParam('seed');
  const seed = seedText === null || seedText === '' ? 20261126 : (Number(seedText) >>> 0) || 20261126;
  const shot = queryParam('shot');
  const world = buildArchipelago(seed);
  const hud = bindHud();
  const input = createInput(canvas);
  const sound = createSoundEngine();

  const game = {
    state: STATE_TITLE,
    selectedMission: 0,
    mission: null,
    plane: null,
    wind: windForMission(seed, false),
    time: 0,
    lastTick: performance.now(),
    warnedLowFuel: false,
    warnedDamage: false,
    message: '',
  };

  /** Start (or restart) a mission from the title screen. */
  function launchMission(missionId) {
    const mission = startMission(missionId, world);
    game.mission = mission;
    game.wind = windForMission(seed, mission.storm);
    game.plane = createPlane(runwayStrip(world.islands[0]), mission.fuelStart);
    game.state = STATE_PLAYING;
    game.warnedLowFuel = false;
    game.warnedDamage = false;
    unlockAudio(sound);
    flashMessage(hud, mission.name, 2200);
  }

  /** Back to the title screen, plane parked on the home runway. */
  function goToTitle() {
    game.state = STATE_TITLE;
    game.mission = null;
    game.plane = createPlane(runwayStrip(world.islands[0]), 100);
    updateEngineSound(sound, 0, 0, false);
  }

  /** Set up a screenshot scene: pre-place the plane and state, then render. */
  function setupShotMode() {
    if (shot === 'start') {
      game.state = STATE_TITLE;
      game.plane = createPlane(runwayStrip(world.islands[0]), 100);
      game.mission = null;
      return;
    }
    if (shot === 'flight') {
      launchMission('rings');
      // Fly forward for a while so the shot shows a real mid-flight scene:
      // airborne, climbing, first ring ahead, runway behind.
      const plane = game.plane;
      plane.throttle = 0.85;
      for (let i = 0; i < 340; i++) {
        stepPlane(plane, { pitchInput: 0.25, rollInput: 0, throttleDelta: 0, airbrake: false, trim: 0 }, 1 / 60, game.wind, (x, z) => terrainHeightAt(x, z, world));
      }
      plane.pitch = 0.08;
      return;
    }
    if (shot === 'landing') {
      launchMission('delivery');
      const plane = game.plane;
      const home = runwayStrip(world.islands[0]);
      // Park the plane near the runway threshold so the strip stretches
      // ahead of it in the shot, runway dashes and all.
      const fx = Math.cos(home.heading);
      const fz = Math.sin(home.heading);
      const back = home.length / 2 - 40;
      plane.pos = { x: home.cx - fx * back, y: 4.6, z: home.cz - fz * back };
      plane.heading = home.heading;
      plane.speed = 0;
      plane.throttle = 0;
      plane.onGround = true;
      game.mission.status = 'complete';
      game.mission.score = 2450;
      game.mission.elapsed = 96.4;
      game.mission.endReason = 'Semua kargo terkirim ke 3 pulau. Mendarat mulus di Pulau Merdeka.';
      game.state = STATE_COMPLETE;
      return;
    }
  }

  /** Handle title-screen keys and clicks. */
  function updateTitle() {
    if (consumeKeyPress(input, 'Digit1') || consumeKeyPress(input, 'Numpad1')) game.selectedMission = 0;
    if (consumeKeyPress(input, 'Digit2') || consumeKeyPress(input, 'Numpad2')) game.selectedMission = 1;
    if (consumeKeyPress(input, 'Digit3') || consumeKeyPress(input, 'Numpad3')) game.selectedMission = 2;
    if (consumeKeyPress(input, 'ArrowUp')) game.selectedMission = (game.selectedMission + 2) % 3;
    if (consumeKeyPress(input, 'ArrowDown')) game.selectedMission = (game.selectedMission + 1) % 3;
    const click = consumeClick(input);
    if (click) {
      const rowY0 = canvas.height * 0.42;
      for (let i = 0; i < 3; i++) {
        const y = rowY0 + i * 64;
        if (Math.abs(click.x - canvas.width / 2) < 260 && Math.abs(click.y - (y - 24 + 24)) < 26) {
          game.selectedMission = i;
          launchMission(MISSION_IDS[i]);
          return;
        }
      }
    }
    if (consumeKeyPress(input, 'Enter') || consumeKeyPress(input, 'Space')) {
      launchMission(MISSION_IDS[game.selectedMission]);
    }
    if (consumeKeyPress(input, 'KeyM')) toggleMute(sound);
  }

  /** One playing tick: fly the plane, check rings, landings and failures. */
  function updatePlaying(dt) {
    const plane = game.plane;
    const mission = game.mission;
    const prevPos = { ...plane.pos };
    const wasOnGround = game.wasOnGround === true;
    const controls = readFlightControls(input);
    const result = stepPlane(plane, controls, dt, game.wind, (x, z) => terrainHeightAt(x, z, world));
    const justLanded = plane.onGround && !wasOnGround;
    game.wasOnGround = plane.onGround;

    // Ring passes.
    if (mission.id === 'rings' && checkRingPass(mission, plane.pos, prevPos)) {
      playRingChime(sound);
      flashMessage(hud, mission.nextRing >= mission.rings.length ? 'Ring terakhir! Misi selesai!' : `Ring ${mission.nextRing} dilewati! +500`, 2200);
      if (mission.status === 'complete') {
        playMissionComplete(sound);
        game.state = STATE_COMPLETE;
      }
    }

    // Ground contact: landing or crash. Only the touchdown frame counts,
    // so the message and points fire once per landing, not every frame.
    if (justLanded && plane.speed < 40) {
      const groundY = terrainHeightAt(plane.pos.x, plane.pos.z, world);
      const strip = nearestRunwayStrip(plane.pos, world);
      const centreOffset = strip ? Math.abs(offsetFromStrip(plane.pos, strip)) : 999;
      if (strip && centreOffset < strip.width / 2 + 8 && isLandingGently(plane, groundY)) {
        const outcome = handleTouchdown(mission, plane, world, centreOffset);
        if (outcome.handled) {
          playLandingThud(sound);
          flashMessage(hud, outcome.message, 3200);
          if (mission.status === 'complete') {
            playMissionComplete(sound);
            game.state = STATE_COMPLETE;
          }
        }
      } else if (plane.pos.y - groundY < 1.2 && plane.speed > 1) {
        const rough = handleRoughGround(mission, plane, world);
        if (rough.message) flashMessage(hud, rough.message, 2600);
      }
    }
    // Hard impacts damage the plane even without a landing.
    if (result.hitGround && result.impactSpeed > 3) {
      const wrecked = applyImpactDamage(plane, result.impactSpeed);
      if (result.impactSpeed > 8) playCrashSound(sound);
      if (wrecked) {
        playCrashSound(sound);
        mission.status = 'failed';
        mission.endReason = 'Pesawat hancur saat menghantam tanah.';
        game.state = STATE_CRASHED;
      }
    }

    // Fuel and damage warnings, once each.
    if (plane.fuel < 20 && !game.warnedLowFuel) {
      game.warnedLowFuel = true;
      playWarningBeep(sound);
      flashMessage(hud, 'PERINGATAN: fuel menipis!', 2600);
    }
    if (plane.damage > 60 && !game.warnedDamage) {
      game.warnedDamage = true;
      playWarningBeep(sound);
      flashMessage(hud, 'PERINGATAN: pesawat rusak parah!', 2600);
    }
    if (plane.fuel <= 0 && plane.speed < 6 && plane.onGround && mission.id !== 'delivery') {
      // Ran out of fuel on the ground far from any runway: mission over.
      const strip = nearestRunwayStrip(plane.pos, world);
      const far = !strip || Math.hypot(plane.pos.x - strip.cx, plane.pos.z - strip.cz) > strip.length;
      if (far && mission.status === 'flying') {
        mission.status = 'failed';
        mission.endReason = 'Fuel habis jauh dari runway.';
        game.state = STATE_FAILED;
      }
    }

    tickMission(mission, plane, dt);
    if (mission.status === 'failed' && game.state === STATE_PLAYING) {
      game.state = plane.damage >= 100 ? STATE_CRASHED : STATE_FAILED;
    }
    if (consumeKeyPress(input, 'KeyP') || consumeKeyPress(input, 'Escape')) {
      game.state = STATE_PAUSED;
    }
    if (consumeKeyPress(input, 'KeyR')) launchMission(mission.id);
    if (consumeKeyPress(input, 'KeyM')) toggleMute(sound);
    updateEngineSound(sound, plane.throttle, plane.speed, true);
  }

  /** Find the runway strip nearest to a position. */
  function nearestRunwayStrip(pos, world) {
    let best = null;
    let bestD = Infinity;
    for (const island of world.islands) {
      const strip = runwayStrip(island);
      const d = Math.hypot(pos.x - strip.cx, pos.z - strip.cz);
      if (d < bestD) {
        bestD = d;
        best = strip;
      }
    }
    return best;
  }

  /** Metres across the centreline of a strip (0 = dead centre). */
  function offsetFromStrip(pos, strip) {
    const dx = pos.x - strip.cx;
    const dz = pos.z - strip.cz;
    return -dx * Math.sin(strip.heading) + dz * Math.cos(strip.heading);
  }

  /** A scenic camera for the title screen: high above the home island,
   * looking level across the shore to the open sea, so the title sits
   * over sky, sea and island instead of a hillside. */
  function makeScenicCamera() {
    const pos = { x: -40, y: 170, z: -260 };
    const target = { x: 60, y: 60, z: 400 };
    const forward = normalize3({ x: target.x - pos.x, y: target.y - pos.y, z: target.z - pos.z });
    const right = normalize3(cross3(forward, { x: 0, y: 1, z: 0 }));
    const up = cross3(right, forward);
    return { pos, forward, right, up, focal: 1 };
  }

  /** Resize the canvas to its display size (device pixels capped at 1.5x). */
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(320, Math.round(rect.width * dpr));
    const h = Math.max(240, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  /** Render one frame for the current state. */
  function render() {
    const width = canvas.width;
    const height = canvas.height;
    const plane = game.plane ?? createPlane(runwayStrip(world.islands[0]), 100);
    // Camera framing per state: a high scenic view on the title screen, a
    // close chase cam while flying, a pulled-back view on the end screen,
    // and a side photo camera for the landing screenshot so the runway,
    // the plane and the sea all read in one frame.
    const isTitle = game.state === STATE_TITLE;
    const isFlying = game.state === STATE_PLAYING || game.state === STATE_PAUSED;
    const camDist = isTitle ? 120 : isFlying ? 30 : 42;
    const camHeight = isTitle ? 30 : isFlying ? 9 : 13;
    document.body.classList.toggle('in-title', isTitle);
    const camera = isTitle
      ? makeScenicCamera()
      : shot === 'landing' && game.state === STATE_COMPLETE
        ? makePhotoCamera(plane.pos, plane.heading, 42, 18, 16)
        : makeChaseCamera(plane.pos, plane.heading, plane.pitch, plane.roll, camDist, camHeight);
    renderFrame(ctx, width, height, {
      planePos: plane.pos,
      heading: plane.heading,
      pitch: plane.pitch,
      roll: plane.roll,
      cameraPos: camera.pos,
      camera,
      world,
      mission: game.mission,
      plane,
      time: game.time,
      state: game.state,
      selectedMission: game.selectedMission,
    });
    if (game.state !== STATE_TITLE) {
      const headingDeg = headingDegrees(plane.heading);
      drawCompassStrip(ctx, headingDeg, width);
      drawArtificialHorizon(hud.horizon, plane.pitch, plane.roll);
      const objective = game.mission ? objectiveLine(game.mission, world, plane.pos) : '';
      updateHud(hud, plane, game.mission ?? startMission('rings', world), headingDeg, compassPoint(headingDeg), game.wind, objective);
    }
  }

  /** The frame loop. */
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - game.lastTick) / 1000));
    game.lastTick = now;
    game.time += dt;
    resizeCanvas();
    if (game.state === STATE_TITLE) {
      updateTitle();
      unlockAudio(sound);
    } else if (game.state === STATE_PLAYING) {
      updatePlaying(dt);
    } else if (game.state === STATE_PAUSED) {
      if (consumeKeyPress(input, 'KeyP') || consumeKeyPress(input, 'Escape')) game.state = STATE_PLAYING;
      if (consumeKeyPress(input, 'KeyR')) launchMission(game.mission.id);
      if (consumeKeyPress(input, 'KeyM')) toggleMute(sound);
      updateEngineSound(sound, 0, 0, false);
    } else if (game.state === STATE_COMPLETE || game.state === STATE_CRASHED || game.state === STATE_FAILED) {
      if (consumeKeyPress(input, 'KeyR')) launchMission(game.mission.id);
      if (consumeKeyPress(input, 'Escape')) goToTitle();
      if (consumeAnyKey(input)) {
        // Any other key on the end screen restarts after a short beat.
      }
      updateEngineSound(sound, 0, 0, false);
    }
    render();
    endFrameInput(input);
    requestAnimationFrame(frame);
  }

  // Boot: title screen by default; screenshot modes pre-place the scene.
  // Guard against double boot: a module script runs before DOMContentLoaded,
  // so without the flag the game would start twice.
  game.plane = createPlane(runwayStrip(world.islands[0]), 100);
  if (shot) setupShotMode();
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  requestAnimationFrame(frame);
}

let bootedSkyCourier = false;
/** Start the game exactly once, whenever the document is ready. */
function bootSkyCourierOnce() {
  if (bootedSkyCourier) return;
  bootedSkyCourier = true;
  bootSkyCourier();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootSkyCourierOnce);
} else {
  bootSkyCourierOnce();
}
