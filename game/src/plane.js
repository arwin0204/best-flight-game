// plane.js — the flight model for the little Nusantara courier prop plane.
// Arcade, but honest: throttle sets target speed, pitch trades speed for
// altitude, banking turns the nose, lift needs airspeed, fuel burns with
// throttle, and hard contact with the ground costs damage.

/** Top speed at full throttle, metres per second. */
export const MAX_SPEED = 62;
/** Speed below which the wings stop lifting the plane. */
export const STALL_SPEED = 16;
/** Fuel burn per second at full throttle (percent of tank). */
export const FUEL_BURN_FULL = 1.35;
/** Fuel burn per second at idle. */
export const FUEL_BURN_IDLE = 0.12;
/** Damage taken per hard ground hit, scaled by impact speed. */
export const CRASH_DAMAGE_SCALE = 2.4;

/**
 * The plane's live state.
 * @typedef {Object} PlaneState
 * @property {{ x: number, y: number, z: number }} pos position in metres
 * @property {number} heading radians, 0 = +z (north)
 * @property {number} pitch radians, positive = nose up
 * @property {number} roll radians, positive = right wing down
 * @property {number} speed metres per second
 * @property {number} throttle 0..1
 * @property {number} fuel 0..100
 * @property {number} damage 0..100
 * @property {number} verticalSpeed metres per second, for landing judgement
 * @property {boolean} onGround true while resting on a runway
 * @property {number} propAngle spinning propeller angle for the render
 */

/**
 * Create a fresh plane on the home runway, nose pointing down the strip.
 * @param {{ cx: number, cz: number, heading: number }} strip home runway
 * @param {number} fuelStart starting fuel percent
 * @returns {PlaneState}
 */
export function createPlane(strip, fuelStart) {
  return {
    pos: { x: strip.cx, y: 4.2, z: strip.cz },
    heading: strip.heading,
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    fuel: fuelStart,
    damage: 0,
    verticalSpeed: 0,
    onGround: true,
    propAngle: 0,
  };
}

/**
 * Control inputs for one frame.
 * @typedef {Object} FlightControls
 * @property {number} pitchInput -1 (nose down) .. 1 (nose up)
 * @property {number} rollInput -1 (bank left) .. 1 (bank right)
 * @property {number} throttleDelta -1, 0 or 1 (throttle lever step)
 * @property {boolean} airbrake true while the brake key is held
 * @property {number} trim pitch trim from mouse drag, -1..1
 */

/**
 * Step the flight model forward by dt seconds.
 * @param {PlaneState} plane plane to update
 * @param {FlightControls} controls current inputs
 * @param {number} dt seconds since last step
 * @param {{ dir: number, speed: number }} wind wind to push against
 * @param {(x: number, z: number) => number} groundHeight terrain height lookup
 * @returns {{ hitGround: boolean, impactSpeed: number }} ground contact info
 */
export function stepPlane(plane, controls, dt, wind, groundHeight) {
  const prevY = plane.pos.y;
  // Throttle lever: Shift raises, Ctrl lowers; clamp to the lever range.
  plane.throttle = clamp(plane.throttle + controls.throttleDelta * dt * 0.55, 0, 1);
  plane.propAngle += (2 + plane.throttle * 38) * dt;

  // Fuel burns with throttle; an empty tank means the engine quits.
  const burn = FUEL_BURN_IDLE + (FUEL_BURN_FULL - FUEL_BURN_IDLE) * plane.throttle;
  plane.fuel = Math.max(0, plane.fuel - burn * dt);
  const engineOn = plane.fuel > 0;

  // Target speed follows throttle; the airbrake drags it down fast.
  const targetSpeed = engineOn ? plane.throttle * MAX_SPEED : 0;
  const accel = engineOn ? 9 : 3;
  if (plane.speed < targetSpeed) plane.speed = Math.min(targetSpeed, plane.speed + accel * dt);
  else plane.speed = Math.max(targetSpeed, plane.speed - (controls.airbrake ? 26 : 6) * dt);

  // Pitch: elevator authority grows with airspeed; trim nudges the nose.
  const authority = clamp(plane.speed / 28, 0.15, 1);
  const pitchTarget = clamp((controls.pitchInput + controls.trim * 0.5) * 0.42, -0.42, 0.42);
  plane.pitch += (pitchTarget - plane.pitch) * Math.min(1, authority * dt * 2.4);
  // On the ground the plane stays level until it has flying speed.
  if (plane.onGround && plane.speed < STALL_SPEED + 4) plane.pitch = 0;

  // Roll: banking turns the heading; the wings level out when released.
  const rollTarget = clamp(controls.rollInput * 0.85, -0.85, 0.85);
  plane.roll += (rollTarget - plane.roll) * Math.min(1, dt * 3.2);
  const turnRate = -plane.roll * clamp(plane.speed / MAX_SPEED, 0, 1) * 0.85;
  plane.heading += turnRate * dt;

  // Lift: climbing costs speed, diving gains it; below stall speed the
  // plane sinks no matter what the nose says.
  const climbRate = Math.sin(plane.pitch) * plane.speed;
  const liftFactor = clamp((plane.speed - STALL_SPEED * 0.6) / STALL_SPEED, 0, 1);
  const sinkRate = (1 - liftFactor) * 9;
  plane.verticalSpeed = climbRate - sinkRate + (plane.onGround ? 0 : 0);
  if (plane.onGround && plane.speed > STALL_SPEED + 2 && plane.pitch > 0.05) {
    plane.onGround = false; // liftoff
  }

  // Move: forward along heading and pitch, plus wind drift.
  const fx = Math.sin(plane.heading);
  const fz = Math.cos(plane.heading);
  const forwardSpeed = Math.cos(plane.pitch) * plane.speed;
  plane.pos.x += fx * forwardSpeed * dt + Math.cos(wind.dir) * wind.speed * dt * 0.35;
  plane.pos.z += fz * forwardSpeed * dt + Math.sin(wind.dir) * wind.speed * dt * 0.35;
  plane.pos.y += plane.verticalSpeed * dt;

  // Ground contact: the terrain is a hard floor.
  const ground = groundHeight(plane.pos.x, plane.pos.z);
  let hitGround = false;
  let impactSpeed = 0;
  if (plane.pos.y <= ground + 0.6) {
    hitGround = true;
    impactSpeed = Math.abs(plane.verticalSpeed);
    plane.pos.y = ground + 0.6;
    plane.verticalSpeed = 0;
    if (!plane.onGround) {
      plane.onGround = true;
      plane.pitch = 0;
      plane.roll *= 0.3;
    }
    // Rolling on the ground bleeds speed unless the throttle pushes on.
    if (plane.speed > 0 && plane.throttle < 0.25) plane.speed = Math.max(0, plane.speed - 14 * dt);
  } else {
    plane.onGround = false;
  }
  void prevY;
  return { hitGround, impactSpeed };
}

/**
 * Apply damage from a ground impact; returns true when the plane is wrecked.
 * @param {PlaneState} plane plane to damage
 * @param {number} impactSpeed vertical impact speed in m/s
 * @returns {boolean} true when damage reached 100
 */
export function applyImpactDamage(plane, impactSpeed) {
  if (impactSpeed < 3) return false;
  plane.damage = Math.min(100, plane.damage + (impactSpeed - 3) * CRASH_DAMAGE_SCALE);
  return plane.damage >= 100;
}

/**
 * Is the plane in a gentle landing state over a runway (slow, low, level)?
 * @param {PlaneState} plane plane to test
 * @param {number} groundY terrain height under the plane
 * @returns {boolean}
 */
export function isLandingGently(plane, groundY) {
  return (
    plane.onGround &&
    plane.pos.y - groundY < 2.5 &&
    plane.speed < 34 &&
    Math.abs(plane.verticalSpeed) < 4 &&
    Math.abs(plane.roll) < 0.35
  );
}

/**
 * Score for a landing: smooth, slow and centred earns more.
 * @param {PlaneState} plane plane at touchdown
 * @param {number} centreOffset metres off the runway centreline
 * @returns {number} landing points
 */
export function landingScore(plane, centreOffset) {
  const smooth = Math.max(0, 1 - Math.abs(plane.verticalSpeed) / 6);
  const slow = Math.max(0, 1 - plane.speed / 40);
  const centred = Math.max(0, 1 - centreOffset / 14);
  const intact = 1 - plane.damage / 100;
  return Math.round(400 + 600 * smooth * 0.6 + 300 * slow + 200 * centred + 300 * intact);
}

/** Clamp a number into [min, max]. */
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
