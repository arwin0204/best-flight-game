// render.js — every pixel of Sky Courier, drawn by hand on canvas 2D.
// Sky gradient and sun, sea, the terrain mesh (projected quads, painter's
// order), runway strips, floating rings, drifting clouds, and the little
// courier prop plane itself, drawn as vector shapes from behind.

import { projectPoint, horizonLine, isInFront, distanceToCamera } from './project.js';
import { terrainHeightAt, terrainColourForHeight, seaColour, runwayStrip, runwayCorners, WORLD_HALF } from './terrain.js';
import { headingDegrees } from './project.js';

/** Terrain mesh step in metres; 30 cells across the world. */
const MESH_STEP = 46;
/** How far ahead terrain cells are drawn, in metres. */
const MESH_RANGE = 1500;

/**
 * Draw the whole frame: sky, sea, terrain, rings, runway, clouds, plane,
 * and the state overlays (title, pause, mission end).
 * @param {CanvasRenderingContext2D} ctx main canvas context
 * @param {number} width canvas width
 * @param {number} height canvas height
 * @param {object} scene everything the frame needs
 * @param {import('./project.js').Vec3} scene.planePos plane position
 * @param {number} scene.heading plane heading
 * @param {number} scene.pitch plane pitch
 * @param {number} scene.roll plane roll
 * @param {import('./project.js').Vec3} scene.cameraPos camera position
 * @param {object} scene.camera chase camera (from project.js)
 * @param {{ islands: import('./terrain.js').Island[], clouds: object[], seed: number }} scene.world archipelago
 * @param {import('./missions.js').Mission | null} scene.mission mission in play
 * @param {import('./plane.js').PlaneState} scene.plane plane state
 * @param {number} scene.time seconds since the game started (for waves)
 * @param {string} scene.state 'title' | 'playing' | 'paused' | 'complete' | 'crashed' | 'failed'
 * @param {number} scene.selectedMission index of the highlighted mission row
 */
export function renderFrame(ctx, width, height, scene) {
  drawSky(ctx, width, height, scene.camera);
  drawSea(ctx, width, height, scene.camera, scene.time);
  drawSun(ctx, width, height, scene.camera);
  drawTerrainMesh(ctx, width, height, scene.camera, scene.world, scene.planePos);
  drawClouds(ctx, width, height, scene.camera, scene.world, scene.time);
  drawRunways(ctx, width, height, scene.camera, scene.world, scene.planePos);
  if (scene.mission) drawRings(ctx, width, height, scene.camera, scene.mission);
  drawPlaneSprite(ctx, width, height, scene.plane, scene.state);
  if (scene.state === 'title') drawTitleScreen(ctx, width, height, scene.selectedMission, scene.time);
  else if (scene.state === 'paused') drawPauseScreen(ctx, width, height);
  else if (scene.state === 'complete' || scene.state === 'crashed' || scene.state === 'failed') {
    drawEndScreen(ctx, width, height, scene.state, scene.mission);
  }
}

/**
 * Sky: vertical gradient from deep blue overhead to warm haze at the horizon.
 * @param {CanvasRenderingContext2D} ctx canvas context
 * @param {number} width canvas width
 * @param {number} height canvas height
 * @param {object} camera chase camera
 */
export function drawSky(ctx, width, height, camera) {
  const horizon = horizonLine(camera, height);
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#1c5fa8');
  grad.addColorStop(0.45, '#5aa3dd');
  grad.addColorStop(0.62, '#bcd9ee');
  grad.addColorStop(0.7, '#ffe9c4');
  grad.addColorStop(1, '#0e6f8f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  // A soft glow band hugging the horizon.
  ctx.fillStyle = 'rgba(255, 233, 196, 0.35)';
  ctx.fillRect(0, Math.max(0, horizon.horizonY - 26), width, 52);
}

/**
 * Sea: the lower half below the horizon, with moving wave shimmer bands.
 * @param {CanvasRenderingContext2D} ctx canvas context
 * @param {number} width canvas width
 * @param {number} height canvas height
 * @param {object} camera chase camera
 * @param {number} time seconds since start
 */
export function drawSea(ctx, width, height, camera, time) {
  const horizon = horizonLine(camera, height);
  const y0 = Math.max(0, Math.min(height, horizon.horizonY));
  const grad = ctx.createLinearGradient(0, y0, 0, height);
  grad.addColorStop(0, '#2f9bc4');
  grad.addColorStop(0.4, '#14749f');
  grad.addColorStop(1, '#0a4a6e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, y0, width, height - y0);
  // Wave shimmer: a few translucent horizontal bands drifting with time.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y0, width, height - y0);
  ctx.clip();
  for (let i = 0; i < 9; i++) {
    const bandY = y0 + ((i * 67 + time * 14) % Math.max(1, height - y0));
    const alpha = 0.05 + 0.04 * Math.sin(time * 0.8 + i * 1.7);
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0, alpha).toFixed(3)})`;
    ctx.fillRect(0, bandY, width, 2);
  }
  ctx.restore();
}

/**
 * The sun: a bright disc with a halo, fixed in the sky ahead-left.
 * @param {CanvasRenderingContext2D} ctx canvas context
 * @param {number} width canvas width
 * @param {number} height canvas height
 * @param {object} camera chase camera
 */
export function drawSun(ctx, width, height, camera) {
  // Sun direction in world space: high ahead-left of the home island.
  const sunWorld = { x: -900, y: 620, z: 1200 };
  const p = projectPoint(sunWorld, camera, width, height);
  if (!p.visible) return;
  const halo = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 90);
  halo.addColorStop(0, 'rgba(255, 246, 200, 0.95)');
  halo.addColorStop(0.25, 'rgba(255, 226, 140, 0.55)');
  halo.addColorStop(1, 'rgba(255, 226, 140, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff7d6';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The terrain mesh: project a grid of quads over the world, colour each by
 * height, and draw far-to-near so nearer land overlaps farther land.
 * @param {CanvasRenderingContext2D} ctx canvas context
 * @param {number} width canvas width
 * @param {number} height canvas height
 * @param {object} camera chase camera
 * @param {{ islands: import('./terrain.js').Island[], seed: number }} world archipelago
 * @param {import('./project.js').Vec3} planePos plane position (mesh centre)
 */
export function drawTerrainMesh(ctx, width, height, camera, world, planePos) {
  const cells = [];
  const half = MESH_RANGE / 2;
  const startX = Math.floor((planePos.x - half) / MESH_STEP) * MESH_STEP;
  const startZ = Math.floor((planePos.z - half) / MESH_STEP) * MESH_STEP;
  const count = Math.ceil(MESH_RANGE / MESH_STEP);
  for (let ix = 0; ix < count; ix++) {
    for (let iz = 0; iz < count; iz++) {
      const x0 = startX + ix * MESH_STEP;
      const z0 = startZ + iz * MESH_STEP;
      if (Math.abs(x0) > WORLD_HALF + 200 || Math.abs(z0) > WORLD_HALF + 200) continue;
      const cx = x0 + MESH_STEP / 2;
      const cz = z0 + MESH_STEP / 2;
      const h = terrainHeightAt(cx, cz, world);
      if (h <= 0.5) continue; // open sea is already drawn
      const corners = [
        { x: x0, y: terrainHeightAt(x0, z0, world), z: z0 },
        { x: x0 + MESH_STEP, y: terrainHeightAt(x0 + MESH_STEP, z0, world), z: z0 },
        { x: x0 + MESH_STEP, y: terrainHeightAt(x0 + MESH_STEP, z0 + MESH_STEP, world), z: z0 + MESH_STEP },
        { x: x0, y: terrainHeightAt(x0, z0 + MESH_STEP, world), z: z0 + MESH_STEP },
      ];
      const projected = corners.map((c) => projectPoint(c, camera, width, height));
      if (projected.some((p) => !p.visible)) continue;
      const depth = distanceToCamera({ x: cx, y: h, z: cz }, camera);
      // Sun shading: slopes facing the sun are brighter.
      const slope = (corners[1].y - corners[0].y) / MESH_STEP;
      const shade = 0.75 + Math.max(-0.25, Math.min(0.25, slope * 0.9));
      cells.push({ projected, depth, colour: terrainColourForHeight(h, shade), h });
    }
  }
  cells.sort((a, b) => b.depth - a.depth);
  for (const cell of cells) {
    ctx.fillStyle = cell.colour;
    ctx.beginPath();
    ctx.moveTo(cell.projected[0].x, cell.projected[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(cell.projected[i].x, cell.projected[i].y);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Clouds: soft white puff clusters drifting slowly with the wind.
 * @param {CanvasRenderingContext2D} ctx canvas context
 * @param {number} width canvas width
 * @param {number} height canvas height
 * @param {object} camera chase camera
 * @param {{ clouds: object[] }} world archipelago
 * @param {number} time seconds since start
 */
export function drawClouds(ctx, width, height, camera, world, time) {
  for (const cloud of world.clouds) {
    const driftX = cloud.x + time * cloud.drift;
    const wrappedX = ((driftX + WORLD_HALF) % (WORLD_HALF * 2)) - WORLD_HALF;
    const centre = { x: wrappedX, y: cloud.y, z: cloud.z };
    if (!isInFront(centre, camera)) continue;
    const p = projectPoint(centre, camera, width, height);
    if (!p.visible) continue;
    const scale = Math.max(0.15, 900 / Math.max(60, p.depth));
    const size = cloud.size * scale;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    for (let i = 0; i < cloud.puffs; i++) {
      const ox = (i - cloud.puffs / 2) * size * 0.55;
      const oy = Math.sin(i * 2.3) * size * 0.12;
      ctx.beginPath();
      ctx.ellipse(p.x + ox, p.y + oy, size * 0.55, size * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Runway strips: dark asphalt with white centre dashes, threshold bars and
 * a windsock pole, drawn on the flattened island ground.
 * @param {CanvasRenderingContext2D} ctx canvas context
 * @param {number} width canvas width
 * @param {number} height canvas height
 * @param {object} camera chase camera
 * @param {{ islands: import('./terrain.js').Island[], seed: number }} world archipelago
 * @param {import('./project.js').Vec3} planePos plane position
 */
export function drawRunways(ctx, width, height, camera, world, planePos) {
  const strips = world.islands.map((island) => ({ island, strip: runwayStrip(island) }));
  strips.sort((a, b) => {
    const da = Math.hypot(a.strip.cx - planePos.x, a.strip.cz - planePos.z);
    const db = Math.hypot(b.strip.cx - planePos.x, b.strip.cz - planePos.z);
    return db - da;
  });
  for (const { island, strip } of strips) {
    const corners = runwayCorners(strip).map((c) => ({
      x: c.x, y: terrainHeightAt(c.x, c.z, world) + 0.8, z: c.z,
    }));
    const projected = corners.map((c) => projectPoint(c, camera, width, height));
    if (projected.some((p) => !p.visible)) continue;
    // Asphalt.
    ctx.fillStyle = '#3a3f46';
    ctx.beginPath();
    ctx.moveTo(projected[0].x, projected[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(projected[i].x, projected[i].y);
    ctx.closePath();
    ctx.fill();
    // Edge lines.
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(projected[0].x, projected[0].y);
    ctx.lineTo(projected[1].x, projected[1].y);
    ctx.moveTo(projected[3].x, projected[3].y);
    ctx.lineTo(projected[2].x, projected[2].y);
    ctx.stroke();
    // Centre dashes: interpolate along the strip.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    for (let t = 0.12; t < 0.95; t += 0.14) {
      const a = lerpCorner(corners[0], corners[1], t);
      const b = lerpCorner(corners[0], corners[1], Math.min(0.97, t + 0.06));
      const pa = projectPoint(a, camera, width, height);
      const pb = projectPoint(b, camera, width, height);
      if (!pa.visible || !pb.visible) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    // Island name tag floating above the runway.
    const labelPos = projectPoint({ x: strip.cx, y: 26, z: strip.cz }, camera, width, height);
    if (labelPos.visible && labelPos.depth < 900) {
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      const label = island.name;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(8,24,40,0.6)';
      ctx.fillRect(labelPos.x - tw / 2 - 8, labelPos.y - 12, tw + 16, 22);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, labelPos.x, labelPos.y + 4);
    }
  }
}

/** Linear interpolation between two world points. */
function lerpCorner(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * Floating target rings: the next ring glows gold, later rings cyan,
 * passed rings fade to a soft green tick.
 * @param {CanvasRenderingContext2D} ctx canvas context
 * @param {number} width canvas width
 * @param {number} height canvas height
 * @param {object} camera chase camera
 * @param {import('./missions.js').Mission} mission mission in play
 */
export function drawRings(ctx, width, height, camera, mission) {
  if (!mission.rings || mission.rings.length === 0) return;
  mission.rings.forEach((ring, index) => {
    const centre = projectPoint(ring.pos, camera, width, height);
    if (!centre.visible) return;
    const radiusPx = (ring.radius / Math.max(20, centre.depth)) * (height / 2) / Math.tan((62 * Math.PI) / 180 / 2);
    if (radiusPx < 3 || radiusPx > 900) return;
    const isNext = index === mission.nextRing;
    const colour = ring.passed ? '#7ee787' : isNext ? '#ffd94d' : '#4dd8ff';
    ctx.strokeStyle = colour;
    ctx.lineWidth = isNext ? 6 : 4;
    ctx.globalAlpha = ring.passed ? 0.45 : 0.95;
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
    // Inner glow ring for the next target.
    if (isNext) {
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radiusPx, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Number label in the middle of the next ring.
    if (isNext) {
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = colour;
      ctx.fillText(String(index + 1), centre.x, centre.y + 7);
    }
  });
}

/**
 * The courier plane, drawn from behind in screen space: red-and-cream
 * fuselage, wings, tail and a spinning propeller disc.
 * @param {CanvasRenderingContext2D} ctx canvas context
 * @param {number} width canvas width
 * @param {number} height canvas height
 * @param {import('./plane.js').PlaneState} plane plane state
 * @param {string} state game state
 */
export function drawPlaneSprite(ctx, width, height, plane, state) {
  if (state === 'title') return;
  const cx = width / 2;
  const cy = height * 0.62;
  const bank = plane.roll * 42;
  const pitchShift = -plane.pitch * 60;
  const size = 1;
  ctx.save();
  ctx.translate(cx, cy + pitchShift);
  ctx.rotate(plane.roll * 0.35);
  ctx.scale(size, size);
  // Shadow on the ground far below is skipped: the plane is the focus.
  // Wings: wide cream wings with red tips.
  ctx.fillStyle = '#f2ead8';
  ctx.beginPath();
  ctx.moveTo(-118, 6);
  ctx.quadraticCurveTo(-70, -14, -18, -4);
  ctx.lineTo(18, -4);
  ctx.quadraticCurveTo(70, -14, 118, 6);
  ctx.quadraticCurveTo(70, 12, 18, 8);
  ctx.lineTo(-18, 8);
  ctx.quadraticCurveTo(-70, 12, -118, 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.moveTo(-118, 6);
  ctx.quadraticCurveTo(-96, -6, -84, -4);
  ctx.lineTo(-84, 8);
  ctx.quadraticCurveTo(-96, 10, -118, 6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(118, 6);
  ctx.quadraticCurveTo(96, -6, 84, -4);
  ctx.lineTo(84, 8);
  ctx.quadraticCurveTo(96, 10, 118, 6);
  ctx.closePath();
  ctx.fill();
  // Tailplane.
  ctx.fillStyle = '#d64533';
  ctx.beginPath();
  ctx.moveTo(-46, -38);
  ctx.lineTo(-14, -46);
  ctx.lineTo(14, -46);
  ctx.lineTo(46, -38);
  ctx.lineTo(14, -30);
  ctx.lineTo(-14, -30);
  ctx.closePath();
  ctx.fill();
  // Fuselage: tapered body, red nose stripe, cream cabin.
  ctx.fillStyle = '#e8e0cc';
  ctx.beginPath();
  ctx.moveTo(-16, -48);
  ctx.quadraticCurveTo(-20, -10, -14, 26);
  ctx.quadraticCurveTo(0, 34, 14, 26);
  ctx.quadraticCurveTo(20, -10, 16, -48);
  ctx.quadraticCurveTo(0, -56, -16, -48);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.moveTo(-16, -48);
  ctx.quadraticCurveTo(-18, -30, -16, -14);
  ctx.lineTo(16, -14);
  ctx.quadraticCurveTo(18, -30, 16, -48);
  ctx.quadraticCurveTo(0, -56, -16, -48);
  ctx.closePath();
  ctx.fill();
  // Cockpit windows.
  ctx.fillStyle = '#17324a';
  ctx.beginPath();
  ctx.ellipse(0, -34, 10, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // Propeller: spinning disc + blades, angle from the flight model.
  const prop = plane.propAngle;
  ctx.save();
  ctx.translate(0, -52);
  ctx.rotate(prop);
  ctx.fillStyle = 'rgba(40,40,40,0.55)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, 5, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#2c2c2c';
  ctx.beginPath();
  ctx.arc(0, -52, 5, 0, Math.PI * 2);
  ctx.fill();
  // Wingtip navigation lights.
  ctx.fillStyle = '#ff4d4d';
  ctx.beginPath();
  ctx.arc(-118, 6, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4dff88';
  ctx.beginPath();
  ctx.arc(118, 6, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  void bank;
}

/**
 * Title screen: game name, island tagline, three mission rows, controls.
 * @param {CanvasRenderingContext2D} ctx canvas context
 * @param {number} width canvas width
 * @param {number} height canvas height
 * @param {number} selected index of the highlighted mission
 * @param {number} time seconds since start (for the pulsing prompt)
 */
export function drawTitleScreen(ctx, width, height, selected, time) {
  ctx.fillStyle = 'rgba(6, 20, 36, 0.42)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd94d';
  ctx.font = 'bold 54px sans-serif';
  ctx.fillText('LANGIT NUSANTARA', width / 2, height * 0.22);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('— Sky Courier —', width / 2, height * 0.22 + 38);
  ctx.font = '17px sans-serif';
  ctx.fillStyle = '#d7ecfa';
  ctx.fillText('Terbang di atas kepulauan tropis: lewati ring, antar kargo, mendarat di tengah badai.', width / 2, height * 0.22 + 70);
  const rows = [
    { key: '1', name: 'Ring Run', desc: '6 ring secepat mungkin' },
    { key: '2', name: 'Island Delivery', desc: 'Kargo ke 3 pulau' },
    { key: '3', name: 'Storm Landing', desc: 'Badai, fuel menipis' },
  ];
  const rowY0 = height * 0.42;
  rows.forEach((row, i) => {
    const y = rowY0 + i * 64;
    const active = i === selected;
    ctx.fillStyle = active ? 'rgba(255, 217, 77, 0.92)' : 'rgba(10, 34, 56, 0.75)';
    roundRect(ctx, width / 2 - 260, y - 24, 520, 48, 10);
    ctx.fill();
    ctx.fillStyle = active ? '#14202e' : '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${row.key} · ${row.name}`, width / 2 - 240, y + 1);
    ctx.font = '15px sans-serif';
    ctx.fillStyle = active ? '#3a2f10' : '#bcd6e8';
    ctx.textAlign = 'right';
    ctx.fillText(row.desc, width / 2 + 240, y + 1);
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '15px sans-serif';
  ctx.fillText('W/S pitch · A/D belok · Shift/Ctrl throttle · Spasi rem udara · P jeda · M suara', width / 2, height * 0.42 + 3 * 64 + 22);
  const pulse = 0.55 + 0.45 * Math.sin(time * 3);
  ctx.fillStyle = `rgba(255, 217, 77, ${pulse.toFixed(2)})`;
  ctx.font = 'bold 19px sans-serif';
  ctx.fillText('Pilih misi (1/2/3 atau klik), lalu tekan ENTER untuk terbang', width / 2, height * 0.42 + 3 * 64 + 52);
}

/**
 * Pause overlay.
 * @param {CanvasRenderingContext2D} ctx canvas context
 * @param {number} width canvas width
 * @param {number} height canvas height
 */
export function drawPauseScreen(ctx, width, height) {
  ctx.fillStyle = 'rgba(6, 20, 36, 0.6)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText('JEDA', width / 2, height / 2 - 10);
  ctx.font = '17px sans-serif';
  ctx.fillText('Tekan P untuk lanjut · R untuk mulai ulang · M untuk suara', width / 2, height / 2 + 28);
}

/**
 * Mission end overlay: complete (gold), crashed or failed (red).
 * @param {CanvasRenderingContext2D} ctx canvas context
 * @param {number} width canvas width
 * @param {number} height canvas height
 * @param {string} state 'complete' | 'crashed' | 'failed'
 * @param {import('./missions.js').Mission | null} mission mission in play
 */
export function drawEndScreen(ctx, width, height, state, mission) {
  ctx.fillStyle = 'rgba(6, 20, 36, 0.5)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  const title = state === 'complete' ? 'MISI SELESAI!' : state === 'crashed' ? 'PESAWAT JATUH!' : 'MISI GAGAL';
  ctx.fillStyle = state === 'complete' ? '#ffd94d' : '#ff7a6b';
  ctx.font = 'bold 48px sans-serif';
  ctx.fillText(title, width / 2, height * 0.30);
  ctx.fillStyle = '#ffffff';
  ctx.font = '19px sans-serif';
  if (mission) {
    ctx.fillText(mission.endReason || mission.brief, width / 2, height * 0.30 + 36);
    ctx.fillText(`Skor: ${mission.score} poin · Waktu: ${mission.elapsed.toFixed(1)} detik`, width / 2, height * 0.30 + 68);
  }
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#d7ecfa';
  ctx.fillText('Tekan R untuk terbang lagi · Esc untuk kembali ke menu', width / 2, height * 0.30 + 102);
}

/** Rounded-rectangle path helper. */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { headingDegrees };
