// rng.js — seeded random numbers for Langit Nusantara: Sky Courier.
// Every random choice in the world (island shapes, cloud placement, ring
// layout) comes from here, so the same ?seed= builds the same archipelago.
// mulberry32 is a tiny, well-known seeded PRNG; the helpers below are ours.

/**
 * Create a mulberry32 generator from an integer seed.
 * @param {number} seed any integer; non-integers are folded in.
 * @returns {() => number} a function returning [0, 1).
 */
export function createSeededRng(seed) {
  let a = seed >>> 0;
  if (a === 0) a = 0x9e3779b9;
  return function nextRandom() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash a pair of integer coordinates into a stable [0, 1) value.
 * Used for value-noise terrain so the heightfield needs no stored grid.
 * @param {number} x integer grid x
 * @param {number} z integer grid z
 * @param {number} seed world seed
 * @returns {number} pseudo-random value in [0, 1)
 */
export function hashGridPoint(x, z, seed) {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothstep easing for interpolating grid values. */
export function smoothstep(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Seeded 2D value noise: bilinear interpolation of hashed grid corners.
 * @param {number} x world x in noise cells
 * @param {number} z world z in noise cells
 * @param {number} seed world seed
 * @returns {number} noise in [0, 1)
 */
export function valueNoise2D(x, z, seed) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const a = hashGridPoint(xi, zi, seed);
  const b = hashGridPoint(xi + 1, zi, seed);
  const c = hashGridPoint(xi, zi + 1, seed);
  const d = hashGridPoint(xi + 1, zi + 1, seed);
  const u = smoothstep(xf);
  const v = smoothstep(zf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Fractal noise: several octaves of value noise summed.
 * @param {number} x world x in noise cells
 * @param {number} z world z in noise cells
 * @param {number} seed world seed
 * @param {number} octaves how many layers to add
 * @returns {number} roughly [0, 1)
 */
export function fractalNoise2D(x, z, seed, octaves) {
  let total = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    total += valueNoise2D(x * frequency, z * frequency, seed + o * 101) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return total / norm;
}

/**
 * Pick a random element from an array using the given rng.
 * @template T
 * @param {T[]} list candidates
 * @param {() => number} rng seeded generator
 * @returns {T} one element
 */
export function pickFrom(list, rng) {
  return list[Math.floor(rng() * list.length) % list.length];
}

/**
 * Random number in [min, max) from the given rng.
 * @param {number} min lower bound
 * @param {number} max upper bound (exclusive)
 * @param {() => number} rng seeded generator
 * @returns {number}
 */
export function rangeRandom(min, max, rng) {
  return min + rng() * (max - min);
}

/**
 * Random integer in [min, max] inclusive from the given rng.
 * @param {number} min lower bound
 * @param {number} max upper bound (inclusive)
 * @param {() => number} rng seeded generator
 * @returns {number}
 */
export function intRandom(min, max, rng) {
  return min + Math.floor(rng() * (max - min + 1));
}
