// terrain.js — the Nusantara archipelago: seeded islands, sea, mountains,
// runways and clouds. Everything is computed from the world seed, so the
// same seed always builds the same islands and the same screenshot.

import { createSeededRng, fractalNoise2D, rangeRandom } from './rng.js';

/** World half-size in metres; the playable sea spans [-WORLD_HALF, WORLD_HALF]. */
export const WORLD_HALF = 1500;
/** Sea level; terrain below this is underwater and drawn as sea. */
export const SEA_LEVEL = 0;

/**
 * One island: a raised bump with its own peak, beach ring and runway site.
 * @typedef {Object} Island
 * @property {number} x centre x
 * @property {number} z centre z
 * @property {number} radius footprint radius
 * @property {number} peak height of the summit
 * @property {string} name island name shown on the HUD
 * @property {number} runwayHeading heading of its runway strip
 */

/**
 * Build the archipelago for a seed.
 * @param {number} seed world seed
 * @returns {{ islands: Island[], clouds: Cloud[], seed: number }}
 */
export function buildArchipelago(seed) {
  const rng = createSeededRng(seed);
  const names = [
    'Pulau Kelapa', 'Pulau Angin', 'Pulau Karang', 'Pulau Bunga',
    'Pulau Ombak', 'Pulau Senja', 'Pulau Padi', 'Pulau Terumbu',
  ];
  const islands = [];
  // The home island is always at the origin: big, mountainous, main runway.
  islands.push({
    x: 0, z: 0, radius: 520, peak: 150, name: 'Pulau Merdeka', runwayHeading: 0,
  });
  // Six further islands placed around the home island, never overlapping it.
  const placed = [[0, 0, 620]];
  for (let i = 0; i < 6; i++) {
    let x = 0;
    let z = 0;
    let ok = false;
    for (let tries = 0; tries < 40 && !ok; tries++) {
      const angle = rng() * Math.PI * 2;
      const dist = rangeRandom(750, 1250, rng);
      x = Math.cos(angle) * dist;
      z = Math.sin(angle) * dist;
      const r = rangeRandom(190, 320, rng);
      ok = placed.every(([px, pz, pr]) => {
        const dx = px - x;
        const dz = pz - z;
        return Math.hypot(dx, dz) > pr + r + 90;
      });
      if (ok) {
        placed.push([x, z, r]);
        islands.push({
          x, z, radius: r, peak: rangeRandom(55, 120, rng),
          name: names[i % names.length], runwayHeading: rng() * Math.PI * 2,
        });
      }
    }
  }
  // Clouds drift above the sea between the islands.
  const clouds = [];
  for (let i = 0; i < 26; i++) {
    clouds.push({
      x: rangeRandom(-WORLD_HALF, WORLD_HALF, rng),
      y: rangeRandom(210, 330, rng),
      z: rangeRandom(-WORLD_HALF, WORLD_HALF, rng),
      size: rangeRandom(70, 170, rng),
      puffs: 3 + Math.floor(rng() * 3),
      drift: rangeRandom(1.5, 4, rng),
    });
  }
  return { islands, clouds, seed };
}

/**
 * Height of the terrain at world (x, z): island bumps plus fractal detail.
 * Returns metres above sea level; negative means open sea.
 * @param {number} x world x
 * @param {number} z world z
 * @param {{ islands: Island[], seed: number }} world archipelago
 * @returns {number} terrain height
 */
export function terrainHeightAt(x, z, world) {
  let h = -14;
  for (const island of world.islands) {
    const dx = x - island.x;
    const dz = z - island.z;
    const d = Math.hypot(dx, dz) / island.radius;
    if (d < 1.25) {
      // Smooth dome: 1 at the centre, 0 at the shore, with a rocky rim.
      const dome = Math.max(0, 1 - d * d);
      const rim = Math.exp(-Math.pow((d - 0.92) * 9, 2)) * 0.25;
      h = Math.max(h, island.peak * dome * dome + rim * island.peak * 0.4 + 2);
    }
  }
  // Rolling detail only on land; the sea floor stays flat and deep.
  if (h > -2) {
    const detail = fractalNoise2D(x * 0.004 + 7, z * 0.004 + 3, world.seed, 3);
    h += (detail - 0.5) * 16 * Math.min(1, Math.max(0, h / 40));
  }
  // Flatten the ground around every runway so landings are fair.
  for (const island of world.islands) {
    const r = runwayStrip(island);
    const dx = x - r.cx;
    const dz = z - r.cz;
    const along = dx * Math.cos(r.heading) + dz * Math.sin(r.heading);
    const across = -dx * Math.sin(r.heading) + dz * Math.cos(r.heading);
    if (Math.abs(along) < r.length / 2 + 24 && Math.abs(across) < r.width / 2 + 24) {
      h = 4;
    }
  }
  return h;
}

/**
 * The runway strip of an island: centre, heading, length and width.
 * The home island's runway points north; others follow their own heading.
 * @param {Island} island island that owns the runway
 * @returns {{ cx: number, cz: number, heading: number, length: number, width: number }}
 */
export function runwayStrip(island) {
  const forward = island.runwayHeading;
  const off = island.radius * 0.34;
  return {
    cx: island.x + Math.cos(forward) * off,
    cz: island.z + Math.sin(forward) * off,
    heading: forward,
    length: 210,
    width: 26,
  };
}

/**
 * Corners of a runway strip in world space, in order.
 * @param {{ cx: number, cz: number, heading: number, length: number, width: number }} strip
 * @returns {{ x: number, z: number }[]} four corners
 */
export function runwayCorners(strip) {
  const fx = Math.cos(strip.heading);
  const fz = Math.sin(strip.heading);
  const rx = -fz;
  const rz = fx;
  const hl = strip.length / 2;
  const hw = strip.width / 2;
  return [
    { x: strip.cx - fx * hl - rx * hw, z: strip.cz - fz * hl - rz * hw },
    { x: strip.cx + fx * hl - rx * hw, z: strip.cz + fz * hl - rz * hw },
    { x: strip.cx + fx * hl + rx * hw, z: strip.cz + fz * hl + rz * hw },
    { x: strip.cx - fx * hl + rx * hw, z: strip.cz - fz * hl + rz * hw },
  ];
}

/**
 * Colour for a terrain height, as an rgb string: sand, grass, jungle, rock, snow.
 * @param {number} h terrain height in metres
 * @param {number} shade 0..1 brightness multiplier from sun angle
 * @returns {string} css colour
 */
export function terrainColourForHeight(h, shade) {
  let r;
  let g;
  let b;
  if (h < 3) { r = 226; g = 205; b = 150; }          // beach sand
  else if (h < 26) { r = 104; g = 168; b = 84; }    // low grass
  else if (h < 70) { r = 58; g = 138; b = 74; }     // jungle green
  else if (h < 115) { r = 122; g = 108; b = 92; }   // bare rock
  else { r = 238; g = 240; b = 244; }               // mountain snow
  const s = 0.55 + 0.45 * shade;
  return `rgb(${Math.round(r * s)},${Math.round(g * s)},${Math.round(b * s)})`;
}

/**
 * Colour of the sea at a given depth shimmer, as an rgb string.
 * @param {number} shimmer 0..1 wave shimmer
 * @returns {string} css colour
 */
export function seaColour(shimmer) {
  const r = 18 + shimmer * 14;
  const g = 116 + shimmer * 30;
  const b = 168 + shimmer * 40;
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

/**
 * Wind for a mission: direction and strength in metres per second.
 * Storm missions use a strong crosswind; calm missions a light breeze.
 * @param {number} seed world seed
 * @param {boolean} storm true for the storm mission
 * @returns {{ dir: number, speed: number }} wind direction (radians) and speed
 */
export function windForMission(seed, storm) {
  const rng = createSeededRng(seed + 77);
  return {
    dir: rng() * Math.PI * 2,
    speed: storm ? rangeRandom(9, 14, rng) : rangeRandom(1.5, 4, rng),
  };
}
