// project.js — chase camera and software 3D-to-2D projection.
// No engine, no library: a plain pinhole camera built from yaw, pitch and
// roll, projecting world points onto the canvas. Everything the renderer
// draws goes through projectPoint() here.

/**
 * A 3D point.
 * @typedef {{ x: number, y: number, z: number }} Vec3
 */

/** Field of view of the chase camera, in radians. */
export const CAMERA_FOV = (62 * Math.PI) / 180;

/**
 * Build a camera from the plane's position and attitude.
 * The camera sits behind and above the plane and looks ahead along its
 * heading, rolling gently with the wings so turns feel banked.
 * @param {{ x: number, y: number, z: number }} planePos plane position
 * @param {number} heading plane heading in radians (0 = +z, turns clockwise)
 * @param {number} pitch plane pitch in radians (positive = nose up)
 * @param {number} roll plane roll in radians (positive = right wing down)
 * @param {number} distance how far behind the plane the camera sits
 * @param {number} height how far above the plane the camera sits
 * @returns {{ pos: Vec3, forward: Vec3, right: Vec3, up: Vec3, focal: number }}
 */
export function makeChaseCamera(planePos, heading, pitch, roll, distance, height) {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  // Camera position: behind the plane along its heading, lifted up.
  const pos = {
    x: planePos.x - fx * distance,
    y: planePos.y + height - Math.sin(pitch) * distance * 0.4,
    z: planePos.z - fz * distance,
  };
  // Look target: ahead of the plane, slightly below its nose line.
  const target = {
    x: planePos.x + fx * 60,
    y: planePos.y + Math.sin(pitch) * 30 - 2,
    z: planePos.z + fz * 60,
  };
  const forward = normalize3({
    x: target.x - pos.x,
    y: target.y - pos.y,
    z: target.z - pos.z,
  });
  // Right vector from world-up, then the true up, then roll the frame.
  const worldUp = { x: 0, y: 1, z: 0 };
  let right = normalize3(cross3(forward, worldUp));
  let up = cross3(right, forward);
  // Apply the plane's roll (damped) around the forward axis.
  const cr = Math.cos(roll * 0.55);
  const sr = Math.sin(roll * 0.55);
  const rolledRight = {
    x: right.x * cr + up.x * sr,
    y: right.y * cr + up.y * sr,
    z: right.z * cr + up.z * sr,
  };
  const rolledUp = {
    x: up.x * cr - right.x * sr,
    y: up.y * cr - right.y * sr,
    z: up.z * cr - right.z * sr,
  };
  right = rolledRight;
  up = rolledUp;
  return { pos, forward, right, up, focal: 1 };
}

/**
 * A photo camera for the landing shot: parked off to one side of the plane
 * so the runway strip, the sea and the island all read in one frame.
 * @param {Vec3} planePos plane position
 * @param {number} heading plane heading in radians
 * @param {number} side metres to the side of the plane (positive = left)
 * @param {number} ahead metres ahead of the plane along its heading
 * @param {number} height metres above the plane
 * @returns {{ pos: Vec3, forward: Vec3, right: Vec3, up: Vec3, focal: number }}
 */
export function makePhotoCamera(planePos, heading, side, ahead, height) {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const worldUp = { x: 0, y: 1, z: 0 };
  const sideDir = normalize3(cross3({ x: fx, y: 0, z: fz }, worldUp));
  const pos = {
    x: planePos.x + sideDir.x * side + fx * ahead,
    y: planePos.y + height,
    z: planePos.z + sideDir.z * side + fz * ahead,
  };
  const target = { x: planePos.x + fx * 12, y: planePos.y + 2, z: planePos.z + fz * 12 };
  const forward = normalize3({ x: target.x - pos.x, y: target.y - pos.y, z: target.z - pos.z });
  const right = normalize3(cross3(forward, worldUp));
  const up = cross3(right, forward);
  return { pos, forward, right, up, focal: 1 };
}

/** Normalise a vector to unit length (zero vector stays zero). */
export function normalize3(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Cross product of two vectors. */
export function cross3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Dot product of two vectors. */
export function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Project a world point to screen space.
 * @param {Vec3} p world point
 * @param {{ pos: Vec3, forward: Vec3, right: Vec3, up: Vec3 }} camera
 * @param {number} width canvas width in pixels
 * @param {number} height canvas height in pixels
 * @returns {{ x: number, y: number, depth: number, visible: boolean }}
 */
export function projectPoint(p, camera, width, height) {
  const rel = { x: p.x - camera.pos.x, y: p.y - camera.pos.y, z: p.z - camera.pos.z };
  const cx = dot3(rel, camera.right);
  const cy = dot3(rel, camera.up);
  const cz = dot3(rel, camera.forward);
  const focal = (height / 2) / Math.tan(CAMERA_FOV / 2);
  if (cz < 2) return { x: 0, y: 0, depth: cz, visible: false };
  return {
    x: width / 2 + (cx / cz) * focal,
    y: height / 2 - (cy / cz) * focal,
    depth: cz,
    visible: true,
  };
}

/**
 * Is a world point roughly in front of the camera (worth drawing)?
 * @param {Vec3} p world point
 * @param {{ pos: Vec3, forward: Vec3 }} camera
 * @returns {boolean}
 */
export function isInFront(p, camera) {
  return dot3({ x: p.x - camera.pos.x, y: p.y - camera.pos.y, z: p.z - camera.pos.z }, camera.forward) > 2;
}

/**
 * Distance from the camera to a world point.
 * @param {Vec3} p world point
 * @param {{ pos: Vec3 }} camera
 * @returns {number} metres
 */
export function distanceToCamera(p, camera) {
  return Math.hypot(p.x - camera.pos.x, p.y - camera.pos.y, p.z - camera.pos.z);
}

/**
 * Horizon line for the current camera: the screen y of the sea horizon and
 * how far the nose points above it. Used to split sky from sea.
 * @param {{ forward: Vec3, up: Vec3 }} camera
 * @param {number} height canvas height
 * @returns {{ horizonY: number, pitchUp: number }}
 */
export function horizonLine(camera, height) {
  const focal = (height / 2) / Math.tan(CAMERA_FOV / 2);
  const pitchUp = Math.asin(Math.max(-1, Math.min(1, camera.forward.y)));
  return { horizonY: height / 2 - Math.tan(pitchUp) * focal, pitchUp };
}

/**
 * Heading (compass degrees, 0 = north) from a heading angle.
 * @param {number} heading radians, 0 = +z (north on our map)
 * @returns {number} degrees 0..359
 */
export function headingDegrees(heading) {
  const deg = (heading * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/**
 * Compass point name for a heading in degrees.
 * @param {number} deg 0..359
 * @returns {string} e.g. "N", "NE", "E"
 */
export function compassPoint(deg) {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round(deg / 45) % 8];
}
