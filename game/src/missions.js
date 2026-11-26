// missions.js — the three sorties of Langit Nusantara: Sky Courier.
// Each mission has a different goal: fly rings against the clock, deliver
// cargo by landing on three island runways, or land the home runway in a
// storm on a nearly empty tank. Missions own their targets, scoring and
// win/lose conditions; the game loop only asks them what happened.

import { createSeededRng, rangeRandom } from './rng.js';
import { runwayStrip, terrainHeightAt } from './terrain.js';
import { clamp, landingScore } from './plane.js';

/** Points for flying cleanly through a ring. */
export const RING_POINTS = 500;
/** Points for each cargo delivery landing. */
export const DELIVERY_POINTS = 1000;
/** Time bonus paid per second under par in Ring Run. */
export const TIME_BONUS_PER_SECOND = 25;

/**
 * A floating ring target.
 * @typedef {Object} Ring
 * @property {{ x: number, y: number, z: number }} pos centre
 * @property {number} radius ring radius in metres
 * @property {boolean} passed true once flown through
 */

/**
 * A mission in play.
 * @typedef {Object} Mission
 * @property {string} id 'rings' | 'delivery' | 'storm'
 * @property {string} name display name
 * @property {string} brief one-line briefing shown on the HUD
 * @property {Ring[]} rings ring targets (rings mission)
 * @property {number} nextRing index of the next ring to fly
 * @property {number[]} deliveryOrder island indexes to visit (delivery)
 * @property {number} nextDelivery index into deliveryOrder
 * @property {number} elapsed seconds since takeoff
 * @property {number} score points earned so far
 * @property {number} fuelStart fuel percent at mission start
 * @property {boolean} storm true when the storm crosswind blows
 * @property {string} status 'flying' | 'complete' | 'failed'
 * @property {string} endReason why the mission ended, for the end screen
 */

export const MISSION_DEFS = [
  {
    id: 'rings',
    name: 'Ring Run',
    brief: 'Terbang melewati 6 ring secepat mungkin. Ring emas = target berikutnya.',
    fuelStart: 100,
    storm: false,
  },
  {
    id: 'delivery',
    name: 'Island Delivery',
    brief: 'Antar kargo ke 3 pulau — mendarat mulus di runway tiap pulau tujuan.',
    fuelStart: 100,
    storm: false,
  },
  {
    id: 'storm',
    name: 'Storm Landing',
    brief: 'Badai + tangki hampir kosong. Mendarat di runway Pulau Merdeka. Jangan panik.',
    fuelStart: 32,
    storm: true,
  },
];

/**
 * Start a mission: lay out its rings or delivery route from the seed.
 * @param {string} missionId one of the MISSION_DEFS ids
 * @param {{ islands: import('./terrain.js').Island[], seed: number, clouds: unknown[] }} world archipelago
 * @returns {Mission}
 */
export function startMission(missionId, world) {
  const def = MISSION_DEFS.find((m) => m.id === missionId) ?? MISSION_DEFS[0];
  const rng = createSeededRng(world.seed + missionId.length * 31 + 7);
  const mission = {
    id: def.id,
    name: def.name,
    brief: def.brief,
    rings: [],
    nextRing: 0,
    deliveryOrder: [],
    nextDelivery: 0,
    elapsed: 0,
    score: 0,
    fuelStart: def.fuelStart,
    storm: def.storm,
    status: 'flying',
    endReason: '',
  };
  if (def.id === 'rings') {
    // A gentle slalom around the home island: rings at varied heights.
    let angle = 0.4;
    for (let i = 0; i < 6; i++) {
      angle += rangeRandom(0.55, 0.95, rng);
      const dist = rangeRandom(320, 620, rng);
      mission.rings.push({
        pos: {
          x: Math.cos(angle) * dist,
          y: rangeRandom(55, 150, rng),
          z: Math.sin(angle) * dist,
        },
        radius: 26,
        passed: false,
      });
    }
  } else if (def.id === 'delivery') {
    // Three different outer islands, in a shuffled order.
    const outer = world.islands.slice(1);
    const order = outer.map((_, i) => i + 1);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    mission.deliveryOrder = order.slice(0, 3);
  }
  return mission;
}

/**
 * Distance from the plane to the next ring centre.
 * @param {Mission} mission mission in play
 * @param {{ x: number, y: number, z: number }} planePos plane position
 * @returns {number} metres, or -1 when there is no next ring
 */
export function distanceToNextRing(mission, planePos) {
  const ring = mission.rings[mission.nextRing];
  if (!ring) return -1;
  return Math.hypot(ring.pos.x - planePos.x, ring.pos.y - planePos.y, ring.pos.z - planePos.z);
}

/**
 * Did the plane just fly through the next ring? Rings count when the plane
 * passes within the ring's radius of its centre plane.
 * @param {Mission} mission mission in play
 * @param {{ x: number, y: number, z: number }} planePos plane position
 * @param {{ x: number, y: number, z: number }} prevPos position last frame
 * @returns {boolean} true on a fresh ring pass
 */
export function checkRingPass(mission, planePos, prevPos) {
  const ring = mission.rings[mission.nextRing];
  if (!ring || ring.passed) return false;
  const dNow = Math.hypot(ring.pos.x - planePos.x, ring.pos.y - planePos.y, ring.pos.z - planePos.z);
  const dPrev = Math.hypot(ring.pos.x - prevPos.x, ring.pos.y - prevPos.y, ring.pos.z - prevPos.z);
  // Crossing the ring plane: distance shrinks then grows, minimum inside radius.
  if (dNow < ring.radius && dPrev >= dNow) {
    ring.passed = true;
    mission.nextRing++;
    mission.score += RING_POINTS;
    if (mission.nextRing >= mission.rings.length) {
      const par = 150;
      const bonus = Math.max(0, Math.round((par - mission.elapsed) * TIME_BONUS_PER_SECOND));
      mission.score += bonus;
      mission.status = 'complete';
      mission.endReason = `Semua ring dilewati dalam ${mission.elapsed.toFixed(1)} detik. Bonus waktu +${bonus}.`;
    }
    return true;
  }
  return false;
}

/**
 * Which island the delivery mission wants next, if any.
 * @param {Mission} mission mission in play
 * @param {{ islands: import('./terrain.js').Island[] }} world archipelago
 * @returns {import('./terrain.js').Island | null}
 */
export function nextDeliveryIsland(mission, world) {
  const idx = mission.deliveryOrder[mission.nextDelivery];
  return idx === undefined ? null : world.islands[idx] ?? null;
}

/**
 * Handle a touchdown during a delivery or storm mission.
 * @param {Mission} mission mission in play
 * @param {import('./plane.js').PlaneState} plane plane at touchdown
 * @param {{ islands: import('./terrain.js').Island[], seed: number }} world archipelago
 * @param {number} centreOffset metres off the runway centreline
 * @returns {{ handled: boolean, message: string }} what happened
 */
export function handleTouchdown(mission, plane, world, centreOffset) {
  if (mission.id === 'delivery') {
    const target = nextDeliveryIsland(mission, world);
    if (!target) return { handled: false, message: '' };
    const strip = runwayStrip(target);
    const d = Math.hypot(plane.pos.x - strip.cx, plane.pos.z - strip.cz);
    if (d < strip.length * 0.7) {
      const pts = landingScore(plane, centreOffset) + DELIVERY_POINTS;
      mission.score += pts;
      mission.nextDelivery++;
      if (mission.nextDelivery >= mission.deliveryOrder.length) {
        mission.status = 'complete';
        mission.endReason = `Semua kargo terkirim ke ${mission.deliveryOrder.length} pulau.`;
        return { handled: true, message: `Kargo terkirim! +${pts} poin — MISI SELESAI` };
      }
      const next = nextDeliveryIsland(mission, world);
      return {
        handled: true,
        message: `Kargo terkirim di ${target.name}! +${pts} poin — lanjut ke ${next ? next.name : ''}`,
      };
    }
    return { handled: true, message: `Mendarat di ${target.name}? Bukan di sini — cek kompas.` };
  }
  if (mission.id === 'storm') {
    const home = world.islands[0];
    const strip = runwayStrip(home);
    const d = Math.hypot(plane.pos.x - strip.cx, plane.pos.z - strip.cz);
    if (d < strip.length * 0.7) {
      const pts = landingScore(plane, centreOffset) + Math.round(plane.fuel * 10);
      mission.score += pts;
      mission.status = 'complete';
      mission.endReason = `Mendarat di tengah badai dengan ${plane.fuel.toFixed(0)}% fuel tersisa.`;
      return { handled: true, message: `MENDARAT! +${pts} poin — badai dilewati` };
    }
    return { handled: true, message: 'Itu bukan runway utama — lepas landas lagi!' };
  }
  return { handled: false, message: '' };
}

/**
 * Off-runway ground contact in a mission that needs a runway landing.
 * @param {Mission} mission mission in play
 * @param {import('./plane.js').PlaneState} plane plane on the ground
 * @param {{ islands: import('./terrain.js').Island[], seed: number }} world archipelago
 * @returns {{ crashed: boolean, message: string }}
 */
export function handleRoughGround(mission, plane, world) {
  // Landing anywhere that is not a runway counts as a rough landing:
  // heavy damage if it was hard, otherwise just a warning.
  const ground = terrainHeightAt(plane.pos.x, plane.pos.z, world);
  const onAnyRunway = world.islands.some((island) => {
    const strip = runwayStrip(island);
    return Math.hypot(plane.pos.x - strip.cx, plane.pos.z - strip.cz) < strip.length * 0.7;
  });
  if (onAnyRunway) return { crashed: false, message: '' };
  void ground;
  if (plane.damage >= 100) return { crashed: true, message: 'Pesawat hancur di daratan.' };
  return { crashed: false, message: 'Mendarat kasar di luar runway — pesawat rusak!' };
}

/**
 * Tick mission timers and check failure conditions (fuel, damage).
 * @param {Mission} mission mission in play
 * @param {import('./plane.js').PlaneState} plane plane state
 * @param {number} dt seconds since last tick
 */
export function tickMission(mission, plane, dt) {
  if (mission.status !== 'flying') return;
  mission.elapsed += dt;
  if (plane.fuel <= 0 && !plane.onGround) {
    // Out of fuel mid-air: glide what you can, but the mission is lost
    // once the plane touches down anywhere but a runway.
    if (mission.id === 'storm' && plane.speed < 8) {
      mission.status = 'failed';
      mission.endReason = 'Fuel habis sebelum mencapai runway.';
    }
  }
  if (plane.damage >= 100) {
    mission.status = 'failed';
    mission.endReason = 'Pesawat rusak total.';
  }
  // Ring Run has a soft par time; running far over it just costs the bonus.
  void clamp;
}

/**
 * Short objective line for the HUD: what to do next, right now.
 * @param {Mission} mission mission in play
 * @param {{ islands: import('./terrain.js').Island[] }} world archipelago
 * @param {{ x: number, y: number, z: number }} planePos plane position
 * @returns {string}
 */
export function objectiveLine(mission, world, planePos) {
  if (mission.status === 'complete') return 'MISI SELESAI — tekan R untuk terbang lagi';
  if (mission.status === 'failed') return 'MISI GAGAL — tekan R untuk mencoba lagi';
  if (mission.id === 'rings') {
    const left = mission.rings.length - mission.nextRing;
    const d = distanceToNextRing(mission, planePos);
    return `Ring ${mission.nextRing + 1}/6 — ${left} tersisa${d > 0 ? ` — ${Math.round(d)}m` : ''}`;
  }
  if (mission.id === 'delivery') {
    const target = nextDeliveryIsland(mission, world);
    if (!target) return 'Semua kargo terkirim!';
    const d = Math.hypot(target.x - planePos.x, target.z - planePos.z);
    return `Antar kargo ke ${target.name} — ${Math.round(d)}m — ${mission.nextDelivery + 1}/3`;
  }
  return 'Mendarat di runway Pulau Merdeka — fuel menipis, badai kencang!';
}
