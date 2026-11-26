// hud.js — the cockpit instruments of Sky Courier.
// A DOM panel for the numbers (altitude, speed, heading, throttle, fuel,
// damage, score, mission) plus an artificial horizon drawn on a small
// canvas, so the instruments look flown rather than drawn flat.

/**
 * Grab the HUD DOM nodes once.
 * @returns {{
 *   alt: HTMLElement, speed: HTMLElement, heading: HTMLElement,
 *   throttle: HTMLElement, fuel: HTMLElement, damage: HTMLElement,
 *   score: HTMLElement, mission: HTMLElement, objective: HTMLElement,
 *   message: HTMLElement, horizon: HTMLCanvasElement, wind: HTMLElement
 * }}
 */
export function bindHud() {
  const byId = (id) => document.getElementById(id);
  return {
    alt: byId('hud-alt'),
    speed: byId('hud-speed'),
    heading: byId('hud-heading'),
    throttle: byId('hud-throttle'),
    fuel: byId('hud-fuel'),
    damage: byId('hud-damage'),
    score: byId('hud-score'),
    mission: byId('hud-mission'),
    objective: byId('hud-objective'),
    message: byId('hud-message'),
    horizon: byId('hud-horizon'),
    wind: byId('hud-wind'),
  };
}

/**
 * Format a number with a fixed width for instrument readouts.
 * @param {number} v value
 * @param {number} decimals decimals to show
 * @returns {string}
 */
export function formatInstrument(v, decimals) {
  return v.toFixed(decimals);
}

/**
 * Update every HUD readout from the live game state.
 * @param {ReturnType<typeof bindHud>} hud bound HUD nodes
 * @param {import('./plane.js').PlaneState} plane plane state
 * @param {import('./missions.js').Mission} mission mission in play
 * @param {number} headingDeg compass heading in degrees
 * @param {string} compass compass point, e.g. "NE"
 * @param {{ speed: number }} wind wind state
 * @param {string} objectiveText current objective line
 */
export function updateHud(hud, plane, mission, headingDeg, compass, wind, objectiveText) {
  if (hud.alt) hud.alt.textContent = `${Math.max(0, Math.round(plane.pos.y))} m`;
  if (hud.speed) hud.speed.textContent = `${Math.round(plane.speed * 3.6)} km/h`;
  if (hud.heading) hud.heading.textContent = `${String(Math.round(headingDeg)).padStart(3, '0')}° ${compass}`;
  if (hud.throttle) hud.throttle.textContent = `${Math.round(plane.throttle * 100)}%`;
  if (hud.fuel) {
    hud.fuel.textContent = `${Math.round(plane.fuel)}%`;
    hud.fuel.classList.toggle('low', plane.fuel < 25);
  }
  if (hud.damage) {
    hud.damage.textContent = `${Math.round(plane.damage)}%`;
    hud.damage.classList.toggle('high', plane.damage > 50);
  }
  if (hud.score) hud.score.textContent = String(mission.score);
  if (hud.mission) hud.mission.textContent = mission.name;
  if (hud.objective) hud.objective.textContent = objectiveText;
  if (hud.wind) hud.wind.textContent = `Angin ${Math.round(wind.speed * 3.6)} km/h`;
  // Fuel and damage bars: width as a percentage, colour by state.
  const fuelBar = document.getElementById('bar-fuel');
  if (fuelBar) {
    fuelBar.style.width = `${Math.max(0, plane.fuel)}%`;
    fuelBar.classList.toggle('low', plane.fuel < 25);
  }
  const dmgBar = document.getElementById('bar-damage');
  if (dmgBar) {
    dmgBar.style.width = `${Math.max(0, plane.damage)}%`;
    dmgBar.classList.toggle('high', plane.damage > 50);
  }
  const thrBar = document.getElementById('bar-throttle');
  if (thrBar) thrBar.style.width = `${Math.round(plane.throttle * 100)}%`;
}

/**
 * Draw the artificial horizon: a round gauge that banks with the plane
 * and pitches with the nose, with a fixed aircraft symbol in the middle.
 * @param {HTMLCanvasElement} canvas 160x160 horizon canvas
 * @param {number} pitch plane pitch in radians
 * @param {number} roll plane roll in radians
 */
export function drawArtificialHorizon(canvas, pitch, roll) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = w / 2 - 4;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  // Sky and ground halves, rotated by roll and shifted by pitch.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-roll);
  const pitchPx = Math.max(-r, Math.min(r, pitch * 220));
  ctx.translate(0, pitchPx);
  ctx.fillStyle = '#3f8fd2';
  ctx.fillRect(-r * 2, -r * 2, r * 4, r * 2);
  ctx.fillStyle = '#8a6b46';
  ctx.fillRect(-r * 2, 0, r * 4, r * 2);
  // Horizon line and pitch ladder marks.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r * 2, 0);
  ctx.lineTo(r * 2, 0);
  ctx.stroke();
  ctx.lineWidth = 1;
  for (const off of [-34, -17, 17, 34]) {
    ctx.beginPath();
    ctx.moveTo(-14, off);
    ctx.lineTo(14, off);
    ctx.stroke();
  }
  ctx.restore();
  // Fixed aircraft symbol: wings and fuselage dot.
  ctx.strokeStyle = '#ffd94d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 34, cy);
  ctx.lineTo(cx + 34, cy);
  ctx.moveTo(cx, cy - 4);
  ctx.lineTo(cx, cy + 6);
  ctx.stroke();
  ctx.fillStyle = '#ffd94d';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Outer ring and tick marks.
  ctx.strokeStyle = '#e8f2f8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#e8f2f8';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - r + 12);
}

/**
 * Draw the compass strip: a scrolling tape of headings across the top.
 * @param {CanvasRenderingContext2D} ctx main canvas context
 * @param {number} headingDeg current heading in degrees
 * @param {number} width canvas width
 */
export function drawCompassStrip(ctx, headingDeg, width) {
  const y = 14;
  const centre = width / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(8, 24, 40, 0.55)';
  ctx.fillRect(centre - 190, 2, 380, 30);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.strokeRect(centre - 190, 2, 380, 30);
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  for (let d = -60; d <= 60; d += 15) {
    const deg = ((Math.round(headingDeg) + d) % 360 + 360) % 360;
    const x = centre + d * 2.6;
    const isCardinal = deg % 45 === 0;
    ctx.fillStyle = isCardinal ? '#ffd94d' : '#e8f2f8';
    ctx.fillText(isCardinal ? points[(deg / 45) % 8] : String(deg), x, y + 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(x, y + 10);
    ctx.lineTo(x, y + 14);
    ctx.stroke();
  }
  // Centre caret marking the current heading.
  ctx.fillStyle = '#ffd94d';
  ctx.beginPath();
  ctx.moveTo(centre - 7, 2);
  ctx.lineTo(centre + 7, 2);
  ctx.lineTo(centre, 12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Show a transient centre-screen message (ring passed, cargo delivered).
 * @param {ReturnType<typeof bindHud>} hud bound HUD nodes
 * @param {string} text message to show
 * @param {number} ms how long it stays visible
 */
export function flashMessage(hud, text, ms) {
  if (!hud.message) return;
  hud.message.textContent = text;
  hud.message.classList.add('show');
  window.clearTimeout(flashMessage.timer);
  flashMessage.timer = window.setTimeout(() => {
    hud.message.classList.remove('show');
  }, ms || 2600);
}
flashMessage.timer = 0;
