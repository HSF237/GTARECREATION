// Small math helpers shared across modules. Avoid allocations in hot paths.
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const remap = (v, a, b, c, d) => c + (d - c) * clamp01((v - a) / (b - a));
export const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const sign = (v) => (v < 0 ? -1 : 1);
/** Frame-rate independent exponential smoothing. rate ~ 1/seconds to reach ~63%. */
export const damp = (current, target, rate, dt) => target + (current - target) * Math.exp(-rate * dt);
/** Wrap angle to [-PI, PI] */
export const wrapAngle = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
/** Shortest signed difference b - a in [-PI, PI] */
export const angleDiff = (a, b) => wrapAngle(b - a);
export const dampAngle = (current, target, rate, dt) => current + angleDiff(current, target) * (1 - Math.exp(-rate * dt));
/** Move value toward target by at most maxDelta */
export const approach = (v, target, maxDelta) => (v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target));
/** yaw (rotation.y) that faces direction (dx, dz); models face +Z */
export const yawFromDir = (dx, dz) => Math.atan2(dx, dz);
export const dist2D = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

/** Closest point on segment AB to P (2D, x/z). Returns t in [0,1]. */
export function closestTOnSegment2D(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  if (len2 < 1e-9) return 0;
  return clamp01(((px - ax) * abx + (pz - az) * abz) / len2);
}

/** Point in polygon (2D). poly: [[x,z], ...] */
export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
