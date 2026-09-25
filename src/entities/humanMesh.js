// Procedural human mesh: an anatomical body sculpted from signed-distance primitives placed in the
// bones' local frames (bind A-pose), layered clothing/hair shells, polygonized with surface nets
// (fine grids for head and hands), then skinned to the rig's 23 bones with smooth joint blends.
//   const g = buildHumanGeometry({ fem, k, w, outfit, hair, beard, lod })
// Geometry attributes: position (bind pose), normal, aSkin (uvec4 bone ids as float4), aW (weights),
// aRegion (region code), aSway (secondary-motion weight). All original work.
import * as THREE from 'three';
import { J, H, NB, bindPose } from './character.js';

// ---------------------------------------------------------------- regions
export const R = {
  SKIN: 0, LIPS: 1, EYE: 2, HAIR: 3, BEARD: 4, BROW: 5,
  TOP: 6, VNECK: 7, SLEEVE_U: 8, FOREARM: 9, HAND: 10,
  PELVIS: 11, THIGH: 12, SHIN: 13, SHOE: 14, SOLE: 15,
  HAT: 16, VEST: 17, TIE: 18, HAIR_LONG: 19,
  SHIRT: 20, JACKET: 21, RIB: 22, BELT: 23, NAIL: 24, MOUTH: 25, LACE: 26,
};

// smoothing groups for clothing: 0 core (pelvis, torso, head, legs), 1 left arm, 2 right arm
const GROUP = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 0, 0, 0, 0, 0, 0];

// ---------------------------------------------------------------- math helpers
const smin = (a, b, k) => { if (k <= 0) return a < b ? a : b; const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
function sdEll(x, y, z, rx, ry, rz) {
  const k0 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  const k1 = Math.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2);
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}
function sdRoundCone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const xx = pax * l2 - bax * y, xy = pay * l2 - bay * y, xz = paz * l2 - baz * y;
  const x2 = xx * xx + xy * xy + xz * xz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
function sdRoundBox(x, y, z, hx, hy, hz, r) {
  const qx = Math.abs(x) - hx + r, qy = Math.abs(y) - hy + r, qz = Math.abs(z) - hz + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}
// cheap smooth value noise (for cloth folds)
function hash3(x, y, z) { let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), ux), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), ux), uy),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), ux), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), ux), uy), uz) * 2 - 1;
}

// ---------------------------------------------------------------- primitive DSL (bone-local coordinates)
// E: ellipsoid, S: sphere, C: round cone (tapered capsule), X: rounded box. opts: { k blend, z zone, sub, det(ail), s:[sx,sy,sz] scale, rx/ry/rz rotation }
function E(cx, cy, cz, rx, ry, rz, o = {}) { return { t: 0, c: [cx, cy, cz], r: [rx, ry, rz], ...o }; }
function S(cx, cy, cz, r, o = {}) { return { t: 0, c: [cx, cy, cz], r: [r, r, r], ...o }; }
function C(ax, ay, az, bx, by, bz, ra, rb, o = {}) { return { t: 1, a: [ax, ay, az], b: [bx, by, bz], ra, rb: rb ?? ra, ...o }; }
function X(cx, cy, cz, hx, hy, hz, rr, o = {}) { return { t: 2, c: [cx, cy, cz], h: [hx, hy, hz], rr, ...o }; }
function mirrorPrim(p) {
  const q = { ...p };
  if (p.c) q.c = [-p.c[0], p.c[1], p.c[2]];
  if (p.a) { q.a = [-p.a[0], p.a[1], p.a[2]]; q.b = [-p.b[0], p.b[1], p.b[2]]; }
  if (p.ry) q.ry = -p.ry; if (p.rz) q.rz = -p.rz;
  return q;
}
function primBound(p) {
  // local bounding sphere
  if (p.t === 1) { const cx = (p.a[0] + p.b[0]) / 2, cy = (p.a[1] + p.b[1]) / 2, cz = (p.a[2] + p.b[2]) / 2; const l = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]); return [cx, cy, cz, l / 2 + Math.max(p.ra, p.rb) * (p.s ? 1 / Math.min(...p.s) : 1)]; }
  if (p.t === 2) return [p.c[0], p.c[1], p.c[2], Math.hypot(p.h[0], p.h[1], p.h[2])];
  return [p.c[0], p.c[1], p.c[2], Math.max(...p.r)];
}
function evalPrim(p, x, y, z) {
  let s = 1;
  if (p.m) { // local rotation about the primitive center
    const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2], m = p.m;
    x = p.c[0] + m[0] * dx + m[1] * dy + m[2] * dz; y = p.c[1] + m[3] * dx + m[4] * dy + m[5] * dz; z = p.c[2] + m[6] * dx + m[7] * dy + m[8] * dz;
  }
  if (p.s) { const o = p.t === 1 ? p.a : p.c; x = o[0] + (x - o[0]) / p.s[0]; y = o[1] + (y - o[1]) / p.s[1]; z = o[2] + (z - o[2]) / p.s[2]; s = Math.min(p.s[0], p.s[1], p.s[2]); }
  let d;
  if (p.t === 0) d = sdEll(x - p.c[0], y - p.c[1], z - p.c[2], p.r[0], p.r[1], p.r[2]);
  else if (p.t === 1) d = sdRoundCone(x, y, z, p.a[0], p.a[1], p.a[2], p.b[0], p.b[1], p.b[2], p.ra, p.rb);
  else d = sdRoundBox(x - p.c[0], y - p.c[1], z - p.c[2], p.h[0], p.h[1], p.h[2], p.rr);
  return d * s;
}
function prepPrim(p) {
  if (p.rx || p.ry || p.rz) { const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(p.rx || 0, p.ry || 0, p.rz || 0, 'YXZ')).invert().elements; p.m = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]; }
  p.k = p.k ?? 0.02; p.bs = primBound(p);
  return p;
}

// ---------------------------------------------------------------- anatomy
/** Body primitives grouped by bone. Returns { [bone]: prim[] } (left side only for limbs; mirrored later). */
function anatomy(sp) {
  const f = sp.fem, mu = sp.muscle ?? (f ? 0.3 : 0.45), fat = sp.fat ?? 0.2;
  const P = {};
  const add = (b, ...ps) => { (P[b] || (P[b] = [])).push(...ps); };
  // pelvis (origin: pelvis center)
  const hw = f ? 0.158 : 0.148;
  add(J.PELVIS,
    E(0, -0.02, -0.006, hw, 0.115, f ? 0.118 : 0.108, { z: 'pelvis' }),
    E(0.064, -0.075, -0.058, f ? 0.085 : 0.078, f ? 0.097 : 0.092, f ? 0.078 : 0.07, { z: 'pelvis', k: 0.03 }),
    E(-0.064, -0.075, -0.058, f ? 0.085 : 0.078, f ? 0.097 : 0.092, f ? 0.078 : 0.07, { z: 'pelvis', k: 0.03 }),
    E(0, 0.03, 0.016 + fat * 0.015, 0.128, 0.09, 0.078 + fat * 0.02, { z: 'pelvis' }),
    E(0, -0.105, 0.01, 0.07, 0.05, 0.07, { z: 'pelvis' }),
  );
  // torso (origin: lower spine). A fit adult: chest ahead of a flat abdomen, broad shoulder girdle, sloping trapezius.
  const cw = f ? 0.135 : 0.148, cd = f ? 0.098 : 0.104;
  add(J.TORSO,
    E(0, 0.075, 0.0 + fat * 0.014, f ? 0.124 : 0.13, 0.12, 0.09 + fat * 0.022, { z: 'torso' }),
    E(0, 0.245, 0.004, cw, 0.165, cd, { z: 'torso' }),
    E(0, 0.28, -0.035, f ? 0.138 : 0.148, 0.14, 0.085, { z: 'torso' }),
    C(-(f ? 0.14 : 0.152), 0.372, -0.014, f ? 0.14 : 0.152, 0.372, -0.014, f ? 0.04 : 0.045, f ? 0.04 : 0.045, { z: 'torso', k: 0.035 }),
    C(0.02, 0.45, -0.02, f ? 0.14 : 0.158, 0.398, -0.016, 0.033, 0.024, { z: 'torso', k: 0.026 }),
    C(-0.02, 0.45, -0.02, f ? -0.14 : -0.158, 0.398, -0.016, 0.033, 0.024, { z: 'torso', k: 0.026 }),
    C(0, 0.5, -0.03, 0.11, 0.43, -0.022, 0.027, 0.02, { z: 'torso', k: 0.025 }),
    C(0, 0.5, -0.03, -0.11, 0.43, -0.022, 0.027, 0.02, { z: 'torso', k: 0.025 }),
    C(0, 0.41, -0.008, 0, 0.53, -0.004, f ? 0.052 : 0.064, f ? 0.05 : 0.06, { z: 'neck', k: 0.03 }),
  );
  if (f) add(J.TORSO, E(0.068, 0.255, 0.075, 0.062, 0.058, 0.055, { z: 'torso', k: 0.03, det: 1 }), E(-0.068, 0.255, 0.075, 0.062, 0.058, 0.055, { z: 'torso', k: 0.03, det: 1 }));
  else add(J.TORSO,
    E(0.062, 0.3, 0.06, 0.072, 0.055, 0.042 + mu * 0.008, { z: 'torso', k: 0.025, det: 1 }), E(-0.062, 0.3, 0.06, 0.072, 0.055, 0.042 + mu * 0.008, { z: 'torso', k: 0.025, det: 1 }),
    E(0.04, 0.13, 0.068, 0.034, 0.06, 0.028, { z: 'torso', k: 0.03, det: 1 }), E(-0.04, 0.13, 0.068, 0.034, 0.06, 0.028, { z: 'torso', k: 0.03, det: 1 }),
    E(0.112, 0.22, -0.03, 0.05, 0.12, 0.066, { z: 'torso', k: 0.04 }), E(-0.112, 0.22, -0.03, 0.05, 0.12, 0.066, { z: 'torso', k: 0.04 }));
  // upper arm (origin: shoulder joint, bone along -y) left side
  const aS = f ? 0.86 : 0.95 + mu * 0.1;
  add(J.UARM_L,
    C(0, -0.032, 0, 0, -0.29, 0, 0.043 * aS, 0.036 * aS, { z: 'uarm' }), // starts below the joint: no ball-shaped cap above the shoulder line
    E(0.004, -0.06, 0.0, 0.045 * aS, 0.066, 0.048 * aS, { z: 'uarm', k: 0.025 }),
    E(0, -0.15, 0.017, 0.035 * aS, 0.078, 0.036 * aS, { z: 'uarm', k: 0.025, det: 1 }),
    E(0, -0.13, -0.017, 0.038 * aS, 0.085, 0.037 * aS, { z: 'uarm', k: 0.025, det: 1 }),
  );
  add(J.FARM_L,
    C(0, 0.01, 0, 0, -0.245, 0, 0.037 * aS, 0.025, { z: 'farm', s: [0.82, 1, 1.06] }),
    E(0.005, -0.07, 0.005, 0.038 * aS, 0.082, 0.04 * aS, { z: 'farm', k: 0.03, det: 1 }),
    S(0, 0.004, -0.03, 0.022, { z: 'farm', k: 0.02, det: 1 }),
  );
  // thigh (origin: hip joint, bone along -y)
  const lS = f ? 1.0 : 0.96 + mu * 0.06;
  add(J.THIGH_L,
    C(0, 0.02, 0, 0, -0.43, 0, 0.079 * lS, 0.052, { z: 'thigh' }),
    E(0.0, -0.17, 0.028, 0.062 * lS, 0.16, 0.052 * lS, { z: 'thigh', k: 0.03, det: 1 }),
    E(-0.02, -0.34, 0.028, 0.038, 0.062, 0.036, { z: 'thigh', k: 0.03, det: 1 }),
    E(0.0, -0.2, -0.028, 0.058 * lS, 0.15, 0.05 * lS, { z: 'thigh', k: 0.03, det: 1 }),
    E(0.024, -0.035, -0.012, f ? 0.078 : 0.06, 0.08, 0.068, { z: 'thigh', k: 0.04 }),
  );
  add(J.SHIN_L,
    C(0, 0.01, 0, 0, -0.39, 0, 0.05, 0.033, { z: 'shin' }),
    E(0, 0.0, 0.042, 0.033, 0.036, 0.022, { z: 'shin', k: 0.02, det: 1 }),
    E(0.006, -0.12, -0.035, 0.05, 0.1, 0.046, { z: 'shin', k: 0.03, det: 1 }),
    E(-0.012, -0.14, -0.03, 0.042, 0.09, 0.04, { z: 'shin', k: 0.03, det: 1 }),
    S(0.028, -0.39, 0.0, 0.018, { z: 'shin', k: 0.015, det: 1 }), S(-0.024, -0.385, 0.005, 0.017, { z: 'shin', k: 0.015, det: 1 }),
  );
  return P;
}

/** Hairline height (head frame) by angle around the head: forehead, temples, above the ears, nape. Mirrored in the shader. */
export function hairLine(a) { return a < 0.5 ? 0.222 - a * 0.03 : a < 1.2 ? 0.207 - (a - 0.5) * 0.1 : a < 2.0 ? 0.137 - (a - 1.2) * 0.02 : 0.121 - (a - 2.0) * 0.03; }

/** Lip ellipsoids [cx, cy, cz, rx, ry, rz] (head frame): cupid's-bow upper lip halves and a fuller lower lip. */
export function LIPS(f) {
  const u = f ? 1.14 : 1, l = f ? 1.12 : 1;
  return [
    [0.0066, 0.0892, 0.0962, 0.0098, 0.0042 * u, 0.0058 * u], [-0.0066, 0.0892, 0.0962, 0.0098, 0.0042 * u, 0.0058 * u],
    [0.0168, 0.0879, 0.0932, 0.0092, 0.0035 * u, 0.0052 * u], [-0.0168, 0.0879, 0.0932, 0.0092, 0.0035 * u, 0.0052 * u],
    [0, 0.0806, 0.0946, 0.0188, 0.0052 * l, 0.0066 * l],
  ];
}
const LIPS_M = LIPS(false), LIPS_F = LIPS(true);
function lipDist(hx, hy, hz, f) { let d = 1e9; for (const L of (f ? LIPS_F : LIPS_M)) d = Math.min(d, sdEll(hx - L[0], hy - L[1], hz - L[2], L[3], L[4], L[5])); return d; }

/** Head (origin: neck base; face toward +z). Detailed features for a fine grid. */
function head(sp) {
  const f = sp.fem, L = [];
  const s = f ? 0.95 : 1;
  const add = (...p) => L.push(...p);
  // neck & skull
  add(C(0, -0.03, -0.012, 0, 0.1, -0.014, f ? 0.051 : 0.058, f ? 0.047 : 0.052, { z: 'neck', k: 0.02 }));
  add(C(0.05, 0.112, -0.028, 0.012, 0.0, 0.034, 0.015, 0.013, { z: 'neck', k: 0.015, det: 1 }), C(-0.05, 0.112, -0.028, -0.012, 0.0, 0.034, 0.015, 0.013, { z: 'neck', k: 0.015, det: 1 }));
  add(E(0, 0.178, -0.014, 0.075 * s, 0.092 * s, 0.097 * s, { z: 'skull', k: 0.015 }));
  add(E(0, 0.193, 0.027, 0.068 * s, 0.066 * s, 0.066 * s, { z: 'skull', k: 0.02 }));
  // temples (slight hollows)
  add(E(0.071, 0.163, 0.05, 0.012, 0.02, 0.018, { sub: 1, k: 0.012 }), E(-0.071, 0.163, 0.05, 0.012, 0.02, 0.018, { sub: 1, k: 0.012 }));
  // face mass, cheeks & jaw
  add(E(0, 0.124, 0.036, 0.06 * s, 0.06 * s, 0.062, { z: 'face', k: 0.02 }));
  add(E(0.041, 0.114, 0.063, 0.024, 0.026, 0.018, { z: 'face', k: 0.018 }), E(-0.041, 0.114, 0.063, 0.024, 0.026, 0.018, { z: 'face', k: 0.018 }));
  const jw = f ? 0.042 : 0.048;
  add(C(jw, f ? 0.097 : 0.094, -0.008, f ? 0.016 : 0.017, f ? 0.061 : 0.058, 0.068, f ? 0.0105 : 0.014, f ? 0.012 : 0.013, { z: 'face', k: 0.018 }), C(-jw, f ? 0.097 : 0.094, -0.008, f ? -0.016 : -0.017, f ? 0.061 : 0.058, 0.068, f ? 0.0105 : 0.014, f ? 0.012 : 0.013, { z: 'face', k: 0.018 }));
  add(E(0, f ? 0.058 : 0.055, 0.073, f ? 0.016 : 0.021, f ? 0.016 : 0.018, 0.016, { z: 'face', k: 0.014 }));
  add(E(0.043, f ? 0.1 : 0.093, 0.058, 0.02, 0.024, 0.02, { z: 'face', k: 0.02 }), E(-0.043, f ? 0.1 : 0.093, 0.058, 0.02, 0.024, 0.02, { z: 'face', k: 0.02 }));
  // cheekbones, brow ridge
  add(E(0.047, 0.138, 0.057, 0.02, 0.012, 0.019, { z: 'face', k: 0.014 }), E(-0.047, 0.138, 0.057, 0.02, 0.012, 0.019, { z: 'face', k: 0.014 }));
  add(C(-0.045, 0.168, 0.081, 0, 0.171, 0.09, f ? 0.007 : 0.0095, f ? 0.006 : 0.0085, { z: 'face', k: 0.012 }), C(0.045, 0.168, 0.081, 0, 0.171, 0.09, f ? 0.007 : 0.0095, f ? 0.006 : 0.0085, { z: 'face', k: 0.012 }));
  // eyes: almond lid openings (the eyeballs are their own layer, set back inside the lids)
  const ex = 0.0315, ey = 0.151, oy = ey - 0.0006, oh = f ? 0.0051 : 0.0048;
  for (const sx of [1, -1]) {
    add(E(sx * ex, oy, 0.0945, 0.0142, oh, 0.0105, { sub: 1, k: 0.0035 }));
    add(C(sx * (ex - 0.013), oy + oh + 0.0009, 0.0925, sx * (ex + 0.012), oy + oh + 0.0006, 0.0905, 0.0026, 0.0024, { z: 'face', k: 0.0028, det: 1 })); // upper lid rim
    add(C(sx * (ex - 0.012), oy - oh - 0.0007, 0.0925, sx * (ex + 0.011), oy - oh - 0.0004, 0.0905, 0.0021, 0.0019, { z: 'face', k: 0.0028, det: 1 })); // lower lid rim
    add(C(sx * (ex - 0.013), oy + oh + 0.0055, 0.09, sx * (ex + 0.014), oy + oh + 0.005, 0.0875, 0.0015, 0.0015, { sub: 1, k: 0.0022 })); // lid crease
    add(E(sx * (ex + 0.002), ey - 0.0128, 0.0885, 0.012, 0.0032, 0.0048, { z: 'face', k: 0.008, det: 1 })); // under-eye fullness
  }
  // nose
  const ns = f ? 0.88 : 1;
  add(C(0, 0.162, 0.09, 0, 0.124, 0.112 + 0.004 * ns, 0.0074 * ns, 0.0094 * ns, { z: 'face', k: 0.01 }));
  add(S(0, 0.1165, 0.1165 + 0.003 * ns, 0.0104 * ns, { z: 'face', k: 0.007 }));
  add(S(0.0118 * ns, 0.1095, 0.1045, 0.0079 * ns, { z: 'face', k: 0.007 }), S(-0.0118 * ns, 0.1095, 0.1045, 0.0079 * ns, { z: 'face', k: 0.007 }));
  add(E(0, 0.1055, 0.1105, 0.0072, 0.0045, 0.0065, { z: 'face', k: 0.005 }));
  add(E(0.0068, 0.1037, 0.111, 0.0034, 0.0023, 0.0042, { sub: 1, k: 0.0025 }), E(-0.0068, 0.1037, 0.111, 0.0034, 0.0023, 0.0042, { sub: 1, k: 0.0025 }));
  // mouth: muzzle, lips, slit, philtrum, groove under the lower lip
  add(E(0, 0.089, 0.08, 0.029, 0.025, 0.02, { z: 'face', k: 0.014 }));
  for (const L2 of LIPS(f)) add(E(L2[0], L2[1], L2[2], L2[3], L2[4], L2[5], { z: 'lips', k: 0.0042 }));
  add(E(0, 0.0848, 0.0985, 0.0228, 0.00095, 0.0105, { sub: 1, k: 0.0016, z: 'mouth' })); // lips' contact line
  add(S(0.0238, 0.0849, 0.0905, 0.0018, { sub: 1, k: 0.002 }), S(-0.0238, 0.0849, 0.0905, 0.0018, { sub: 1, k: 0.002 })); // mouth corners
  add(C(0, 0.1, 0.1, 0, 0.093, 0.101, 0.0022, 0.0022, { sub: 1, k: 0.003 })); // philtrum
  add(C(-0.013, 0.0708, 0.0925, 0.013, 0.0708, 0.0925, 0.0038, 0.0038, { sub: 1, k: 0.006 }));
  // ears
  for (const sx of [1, -1]) {
    add(E(sx * 0.076, 0.146, -0.009, 0.0105, 0.029, 0.018, { z: 'ear', k: 0.006, rx: 0.15, rz: sx * 0.08 }));
    add(E(sx * 0.0835, 0.142, -0.005, 0.005, 0.0135, 0.009, { sub: 1, k: 0.003 }));
    add(S(sx * 0.077, 0.12, -0.004, 0.008, { z: 'ear', k: 0.006 }));
  }
  if (!f) add(E(0, 0.038, 0.046, 0.01, 0.013, 0.01, { z: 'neck', k: 0.012, det: 1 }));
  return L;
}

/** Left hand in the hand's local frame (origin at the wrist, fingers along -y, palm facing -x, thumb toward +z). */
function hand(sp) {
  const f = sp.fem, s = f ? 0.9 : 1, L = [];
  const add = (...p) => L.push(...p);
  add(C(0, 0.03, 0, 0, -0.012, 0, 0.02 * s, 0.021 * s, { z: 'hand', s: [0.7, 1, 1.2] }));
  add(X(0.001, -0.053 * s, 0.001, 0.0125 * s, 0.043 * s, 0.037 * s, 0.011 * s, { z: 'hand', k: 0.012 }));
  add(E(-0.007, -0.04 * s, 0.024 * s, 0.015 * s, 0.028 * s, 0.019 * s, { z: 'hand', k: 0.012 }));
  add(E(-0.005, -0.062 * s, -0.026 * s, 0.012 * s, 0.034 * s, 0.013 * s, { z: 'hand', k: 0.012 }));
  // fingers: [z, base y, lengths p/m/d, radius]
  const F = [[0.028, -0.098, 0.042, 0.025, 0.021, 0.0092], [0.0095, -0.101, 0.046, 0.028, 0.022, 0.0094], [-0.0095, -0.098, 0.043, 0.027, 0.021, 0.009], [-0.027, -0.091, 0.034, 0.02, 0.018, 0.0078]];
  const curl = sp.fist ? [1.2, 1.4, 0.9] : [0.28, 0.42, 0.26];
  F.forEach(([z0, y0, lp, lm, ld, rad], i) => {
    let px = 0.002, py = y0 * s, pz = z0 * s, ang = 0;
    const spread = (i - 1.5) * 0.045;
    const segs = [lp, lm, ld];
    for (let j = 0; j < 3; j++) {
      ang += curl[j];
      const l = segs[j] * s;
      const dx = -Math.sin(ang) * l, dy = -Math.cos(ang) * l, dz = Math.sin(spread) * l * 0.6;
      const r0 = rad * s * (1 - j * 0.1), r1 = rad * s * (0.93 - j * 0.1);
      add(C(px, py, pz, px + dx, py + dy, pz + dz, r0, r1, { z: j === 2 ? 'fingertip' : 'hand', k: j === 0 ? 0.006 : 0.004, s: [0.92, 1, 1] }));
      px += dx; py += dy; pz += dz;
    }
    add(S(0.009 * s, (y0 + 0.002) * s, z0 * s, 0.0085 * s, { z: 'hand', k: 0.008, det: 1 }));
  });
  // thumb
  const T = [[-0.006, -0.028, 0.027], [-0.017, -0.058, 0.047], [-0.024, -0.083, 0.057], [-0.028, -0.101, 0.061]];
  const tr = [0.0125, 0.0112, 0.01, 0.0085];
  for (let j = 0; j < 3; j++) { const a = T[j], b = T[j + 1]; add(C(a[0], a[1] * s, a[2] * s, b[0], b[1] * s, b[2] * s, tr[j] * s, tr[j + 1] * s, { z: j === 2 ? 'fingertip' : 'hand', k: 0.008 })); }
  return L;
}

/** Sneaker / shoe in the foot frame (origin at the ankle, toes toward +z). */
function shoe(sp) {
  const L = [], f = sp.fem, s = f ? 0.92 : 1;
  const add = (...p) => L.push(...p);
  const style = sp.shoe || 'sneaker';
  const soleH = style === 'dress' ? 0.009 : 0.014;
  add(X(0, -0.058, 0.048 * s, 0.047 * s, soleH, 0.132 * s, 0.009, { z: 'sole', k: 0.004 }));
  add(E(0, -0.028, 0.058 * s, 0.047 * s, 0.043, 0.122 * s, { z: 'shoe', k: 0.015 }));
  add(E(0, -0.03, -0.055, 0.044 * s, 0.048, 0.048, { z: 'shoe', k: 0.015 }));
  add(E(0, -0.036, 0.14 * s, 0.046 * s, 0.031, 0.062 * s, { z: 'shoe', k: 0.012 }));
  if (style !== 'dress') add(C(0, -0.005, -0.012, 0, 0.035, -0.018, 0.045, 0.043, { z: 'shoe', k: 0.012 }));
  else add(C(0, -0.01, -0.01, 0, 0.018, -0.012, 0.043, 0.041, { z: 'shoe', k: 0.012 }));
  // laces / tongue ridge
  if (style === 'sneaker') add(C(0, 0.004, 0.035, 0, -0.03, 0.105, 0.012, 0.01, { z: 'lace', k: 0.008, det: 1 }));
  return L;
}


// ---------------------------------------------------------------- accessories (separate overlay meshes)
const sdEll2 = (x, z, rx, rz) => (Math.hypot(x / rx, z / rz) - 1) * Math.min(rx, rz);
/** Hat or long-hair SDF in head-local units (k = 1). sp.only: 'hat' (sp.hat: cap|police|hard|helmet) or 'hair' (sp.hair: long|ponytail|bun|curly). */
function accessory(sp, hx, hy, hz) {
  const s = sp.fem ? 0.95 : 1;
  const a = Math.abs(Math.atan2(hx, hz));
  if (sp.only === 'hat') {
    if (sp.hat === 'cap') {
      const crown = sdEll(hx, hy - 0.18 * s, hz + 0.012, 0.093 * s, 0.109 * s, 0.115 * s);
      let d = smax(crown, (0.2 - 0.038 * (a / Math.PI)) * s - hy, 0.003);
      const vy = hy - (0.198 * s - 1.6 * hx * hx - 0.14 * (hz - 0.1));
      const visor = smax(Math.abs(vy) - 0.0032, sdEll2(hx, hz - 0.128, 0.076, 0.058), 0.002);
      d = Math.min(d, visor);
      d = Math.min(d, Math.hypot(hx, hy - 0.289 * s, hz + 0.012) - 0.0055);
      return d;
    }
    if (sp.hat === 'police') {
      const band = smax(sdEll2(hx, hz + 0.008, 0.095 * s, 0.117 * s), Math.abs(hy - 0.198 * s) - 0.026, 0.003);
      const crown = smax(sdEll(hx, hy - 0.236 * s, hz + 0.004, 0.106 * s, 0.048, 0.128 * s), 0.214 * s - hy, 0.004);
      let d = smin(band, crown, 0.01);
      const vy = hy - (0.178 * s - 0.4 * Math.max(0, hz - 0.095));
      d = Math.min(d, smax(Math.abs(vy) - 0.003, sdEll2(hx, hz - 0.118, 0.072, 0.045), 0.002));
      return d;
    }
    if (sp.hat === 'hard') {
      const dome = smax(sdEll(hx, hy - 0.182 * s, hz + 0.004, 0.107 * s, 0.107 * s, 0.127 * s), 0.176 * s - hy, 0.004);
      const brim = smax(Math.abs(hy - 0.181 * s) - 0.0035, sdEll2(hx, hz + 0.004 - Math.max(0, hz) * 0.25, 0.13, 0.152), 0.002);
      const ridge = sdRoundCone(hx, hy, hz, 0, 0.284 * s, -0.09, 0, 0.286 * s, 0.085, 0.011, 0.011);
      return Math.min(smin(dome, ridge, 0.01), brim);
    }
    // helmet
    const dome = sdEll(hx, hy - 0.172 * s, hz + 0.008, 0.109 * s, 0.119 * s, 0.129 * s);
    const low = (a < 0.7 ? 0.182 : 0.182 - (a - 0.7) * 0.05) * s;
    return smax(dome, low - hy, 0.005);
  }
  // long hair styles over the close-cropped base
  const st = sp.hair;
  if (st === 'long') {
    // voluminous crown, a fall down the back and side curtains framing the face
    const crown = sdEll(hx, hy - 0.178 * s, hz + 0.012, 0.094 * s, 0.11 * s, 0.116 * s);
    const fall = sdEll(hx, hy - 0.03, hz + 0.07, 0.102, 0.2, 0.052);
    const sides = Math.min(sdEll(hx - 0.074, hy - 0.08, hz + 0.004, 0.03, 0.12, 0.07), sdEll(hx + 0.074, hy - 0.08, hz + 0.004, 0.03, 0.12, 0.07));
    let lh = smin(smin(crown, fall, 0.04), sides, 0.03);
    lh = smax(lh, hz - 0.05 - Math.max(0, hy - 0.16) * 0.3, 0.008); // the face stays clear, a soft fringe at the top
    lh = smax(lh, -0.16 - hy, 0.02);
    return lh + vnoise(hx * 120, hy * 40, hz * 120) * 0.003;
  }
  if (st === 'ponytail') {
    const tail = sdRoundCone(hx, hy, hz, 0, 0.17, -0.112, 0, -0.03, -0.152, 0.029, 0.012);
    const tie = sdRoundCone(hx, hy, hz, 0, 0.162, -0.118, 0, 0.145, -0.124, 0.02, 0.02);
    return Math.min(tail + vnoise(hx * 150, hy * 30, hz * 150) * 0.002, tie);
  }
  if (st === 'bun') {
    const bun = sdEll(hx, hy - 0.262 * s, hz + 0.075, 0.05, 0.046, 0.048);
    return bun + vnoise(hx * 160, hy * 160, hz * 160) * 0.0015;
  }
  // curly volume
  let c = sdEll(hx, hy - 0.186 * s, hz + 0.01, 0.101 * s, 0.119 * s, 0.121 * s) + vnoise(hx * 90, hy * 90, hz * 90) * 0.006;
  c = smax(c, hz - 0.07 - Math.max(0, hy - 0.17) * 0.5, 0.012);
  c = smax(c, 0.128 - hy + Math.max(0, -hz) * 0.35, 0.01);
  return c;
}

// ---------------------------------------------------------------- the model
class Model {
  constructor(sp) {
    this.sp = sp;
    const k = sp.k ?? 1, w = sp.w ?? 1;
    this.k = k;
    this.W = bindPose(k, w, !!sp.fem);
    this.inv = this.W.map(m => new THREE.Matrix4().copy(m).invert());
    // bone -> list of prims (bone-local, scaled by k)
    const A = anatomy(sp), groups = [];
    const scaleP = (p) => { const q = { ...p }; const sc = (v) => v.map(x => x * k); if (q.c) q.c = sc(q.c); if (q.a) { q.a = sc(q.a); q.b = sc(q.b); } if (q.r) q.r = sc(q.r); if (q.h) q.h = sc(q.h); if (q.ra != null) { q.ra *= k; q.rb *= k; } if (q.rr != null) q.rr *= k; q.k = (q.k ?? 0.02) * k; return q; };
    const put = (bone, list) => { for (const p of list) groups.push({ bone, p: prepPrim(scaleP(p)) }); };
    put(J.PELVIS, A[J.PELVIS]); put(J.TORSO, A[J.TORSO]);
    for (const [bL, bR] of [[J.UARM_L, J.UARM_R], [J.FARM_L, J.FARM_R], [J.THIGH_L, J.THIGH_R], [J.SHIN_L, J.SHIN_R]]) { put(bL, A[bL]); put(bR, A[bL].map(mirrorPrim)); }
    put(J.HEAD, head(sp));
    const hd = hand(sp); put(J.HAND_L, hd); put(J.HAND_R, hd.map(mirrorPrim));
    const sh = shoe(sp); this.shoePrims = [];
    for (const [b, list] of [[J.FOOT_L, sh], [J.FOOT_R, sh.map(mirrorPrim)]]) for (const p of list) this.shoePrims.push({ bone: b, p: prepPrim(scaleP(p)) });
    this.bodyPrims = groups;
    // pre-compute world-space bounding spheres
    const v = new THREE.Vector3();
    for (const g of [...groups, ...this.shoePrims]) { v.set(g.p.bs[0], g.p.bs[1], g.p.bs[2]).applyMatrix4(this.W[g.bone]); g.wb = [v.x, v.y, v.z, g.p.bs[3]]; }
    this.eyes = [];
    for (const sx of [1, -1]) { v.set(sx * 0.0315 * k, 0.151 * k, 0.0795 * k).applyMatrix4(this.W[J.HEAD]); this.eyes.push([v.x, v.y, v.z, 0.012 * k]); }
    this.L = new Float64Array(NB * 3); this._bonesDone = new Int32Array(NB); this._stamp = 0;
    // uniform grid of candidate primitives per cell (world bind space)
    const all = groups;
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const g of all) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], g.wb[a] - g.wb[3]); mx[a] = Math.max(mx[a], g.wb[a] + g.wb[3]); }
    const cs = this.cs = 0.05 * k; this.gmin = mn.map(v => v - 0.3 * k);
    this.gn = mx.map((v, a) => Math.ceil((v + 0.3 * k - this.gmin[a]) / cs) + 1);
    this.cells = new Array(this.gn[0] * this.gn[1] * this.gn[2]);
    const reach = 0.08 * k; // margin: blend radius + a few cm of "influence"
    for (const g of all) {
      const r = g.wb[3] + (g.p.k || 0) * 2.5 + reach;
      const i0 = Math.max(0, Math.floor((g.wb[0] - r - this.gmin[0]) / cs)), i1 = Math.min(this.gn[0] - 1, Math.floor((g.wb[0] + r - this.gmin[0]) / cs));
      const j0 = Math.max(0, Math.floor((g.wb[1] - r - this.gmin[1]) / cs)), j1 = Math.min(this.gn[1] - 1, Math.floor((g.wb[1] + r - this.gmin[1]) / cs));
      const k0 = Math.max(0, Math.floor((g.wb[2] - r - this.gmin[2]) / cs)), k1 = Math.min(this.gn[2] - 1, Math.floor((g.wb[2] + r - this.gmin[2]) / cs));
      for (let kk = k0; kk <= k1; kk++) for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) { const c = (kk * this.gn[1] + jj) * this.gn[0] + ii; (this.cells[c] || (this.cells[c] = [])).push(g); }
    }
    for (let c = 0; c < this.cells.length; c++) if (this.cells[c]) this.cells[c].sort((a, b) => (a.p.sub ? 1 : 0) - (b.p.sub ? 1 : 0));
    this.empty = [];
    // bone axes for "which body part owns this point" (used by clothing coverage)
    this.axes = [];
    const ax = (b, len, rad, dir = -1) => { const a = new THREE.Vector3().setFromMatrixPosition(this.W[b]); const e = new THREE.Vector3(0, dir * len * k, 0).applyMatrix4(this.W[b]); this.axes.push({ b, a, e, rad: rad * k }); };
    ax(J.PELVIS, 0.1, 0.14); ax(J.TORSO, 0.44, 0.13, 1); ax(J.HEAD, 0.27, 0.095, 1);
    ax(J.UARM_L, 0.29, 0.05); ax(J.UARM_R, 0.29, 0.05); ax(J.FARM_L, 0.26, 0.04); ax(J.FARM_R, 0.26, 0.04); ax(J.HAND_L, 0.17, 0.03); ax(J.HAND_R, 0.17, 0.03);
    ax(J.THIGH_L, 0.43, 0.07); ax(J.THIGH_R, 0.43, 0.07); ax(J.SHIN_L, 0.41, 0.045); ax(J.SHIN_R, 0.41, 0.045); ax(J.FOOT_L, 0.07, 0.05); ax(J.FOOT_R, 0.07, 0.05);
    this.outfit = sp.outfit || { top: 'tee', pants: 'jeans' };
  }
  /** Transform p into bone b's local frame (cached per sample). */
  loc(b, x, y, z) {
    if (this._bonesDone[b] !== this._stamp) {
      const e = this.inv[b].elements, o = b * 3;
      this.L[o] = e[0] * x + e[4] * y + e[8] * z + e[12]; this.L[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; this.L[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      this._bonesDone[b] = this._stamp;
    }
    return b * 3;
  }
  cellList(x, y, z) {
    const i = Math.floor((x - this.gmin[0]) / this.cs), j = Math.floor((y - this.gmin[1]) / this.cs), kk = Math.floor((z - this.gmin[2]) / this.cs);
    if (i < 0 || j < 0 || kk < 0 || i >= this.gn[0] || j >= this.gn[1] || kk >= this.gn[2]) return this.empty;
    return this.cells[(kk * this.gn[1] + j) * this.gn[0] + i] || this.empty;
  }
  /** Which body part owns a point (nearest bone axis, radius-normalized). */
  owner(x, y, z) {
    let best = null, bd = 1e9;
    for (const A of this.axes) {
      const ax = A.a.x, ay = A.a.y, az = A.a.z, bx = A.e.x - ax, by = A.e.y - ay, bz = A.e.z - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / (bx * bx + by * by + bz * bz)));
      const d = Math.hypot(x - ax - bx * t, y - ay - by * t, z - az - bz * t) - A.rad;
      if (d < bd) { bd = d; best = A.b; }
    }
    return best;
  }
  /** Skin surface SDF. smooth=true skips small muscle detail and blends wider (used under clothes). Records the nearest primitive.
   *  In smooth mode arms and the core blend separately, so clothing never webs the armpits; they only merge softly over the shoulders. */
  body(x, y, z, smooth = false, track = false) {
    let d = 1e9, best = null, bestD = 1e9;
    const list = this.cellList(x, y, z);
    if (!list.length) { if (track) this.nearest = null; return 0.3 * this.k; }
    let g0 = 1e9, g1 = 1e9, g2 = 1e9;
    const kMul = this._kMul || 2.5;
    for (const g of list) {
      const p = g.p;
      if (p.sub) break;
      if (smooth && p.det) continue;
      const grp = smooth ? GROUP[g.bone] : 0;
      const dc = smooth ? (grp === 0 ? g0 : grp === 1 ? g1 : g2) : d;
      const wb = g.wb, dx = x - wb[0], dy = y - wb[1], dz = z - wb[2];
      const lb = Math.sqrt(dx * dx + dy * dy + dz * dz) - wb[3];
      if (lb > dc + p.k * 2.5 && lb > 0.02) continue;
      const o = this.loc(g.bone, x, y, z), L = this.L;
      const di = evalPrim(p, L[o], L[o + 1], L[o + 2]);
      if (!smooth) d = smin(d, di, p.k);
      else if (grp === 0) g0 = smin(g0, di, p.k * kMul); else if (grp === 1) g1 = smin(g1, di, p.k * kMul); else g2 = smin(g2, di, p.k * kMul);
      if (track && di < bestD) { bestD = di; best = g; }
    }
    if (smooth) {
      // arm/core blend: soft over the shoulder cap, tight below the armpit
      const T = this.loc(J.TORSO, x, y, z), ty = this.L[T + 1] / this.k;
      const kb = (0.008 + 0.016 * Math.min(1, Math.max(0, (ty - 0.33) / 0.07))) * this.k;
      d = this._coreOnly ? g0 : smin(smin(g0, g1, kb), g2, kb);
    }
    if (!smooth) for (const g of list) {
      const p = g.p; if (!p.sub) continue;
      const wb = g.wb, dx = x - wb[0], dy = y - wb[1], dz = z - wb[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) - wb[3] > p.k) continue;
      const o = this.loc(g.bone, x, y, z), L = this.L;
      const di = evalPrim(p, L[o], L[o + 1], L[o + 2]);
      d = smax(d, -di, p.k);
      if (track && -di > bestD - 0.002 && p.z) { best = g; }
    }
    if (track) this.nearest = best;
    return d;
  }
  shoes(x, y, z, track = false) {
    let d = 1e9, best = null, bestD = 1e9;
    for (const g of this.shoePrims) {
      const p = g.p, wb = g.wb, dx = x - wb[0], dy = y - wb[1], dz = z - wb[2];
      const lb = Math.sqrt(dx * dx + dy * dy + dz * dz) - wb[3];
      if (lb > d + p.k && lb > 0.02) continue;
      const o = this.loc(g.bone, x, y, z), L = this.L;
      const di = evalPrim(p, L[o], L[o + 1], L[o + 2]);
      d = smin(d, di, p.k);
      if (track && di < bestD) { bestD = di; best = g; }
    }
    this.nearestShoe = best;
    return d;
  }
  eyesD(x, y, z) { let d = 1e9; for (const e of this.eyes) d = Math.min(d, Math.hypot(x - e[0], y - e[1], z - e[2]) - e[3]); return d; }

  /**
   * All layers at a point: returns final distance and fills this.layer with the winning layer's region.
   */
  sample(x, y, z, track = false) {
    if (this.sp.only) return this.sampleOnly(x, y, z, track);
    this._stamp++;
    const sp = this.sp, k = this.k, of = this.outfit;
    const L = this.L;
    const bd = this.body(x, y, z, false, track);
    let d = bd, reg = -1;
    const lay = (dl, r) => { if (dl < d) { d = dl; reg = r; } };
    // shoes (replace bare feet)
    const sd = this.shoes(x, y, z, track);
    lay(sd, R.SHOE);
    // eyes
    lay(this.eyesD(x, y, z), R.EYE);
    // clothing shells from the smoothed body
    const needCloth = of.top || of.pants;
    let smooth = bd;
    // garments bridge small hollows but never float more than a few millimetres off the skin (no webs under the chin)
    if (needCloth && bd < 0.06 * k) { this._stamp++; smooth = Math.max(Math.min(this.body(x, y, z, true, false), bd), bd - 0.007 * k); }
    const own = needCloth || sp.vest ? this.owner(x, y, z) : -1;
    const T = this.loc(J.TORSO, x, y, z), tx = L[T], ty = L[T + 1], tz = L[T + 2];
    const Pv = this.loc(J.PELVIS, x, y, z), py = L[Pv + 1];
    // --- pants (pelvis + legs down to the ankles)
    let pBase = 1e9; // un-cut pants surface (outer layers stay outside it)
    const legOwner = own === J.PELVIS || own === J.THIGH_L || own === J.THIGH_R || own === J.SHIN_L || own === J.SHIN_R;
    if (of.pants && bd < 0.06 * k && (legOwner || own === J.TORSO)) {
      const th = (of.pants === 'jeans' ? 0.007 : 0.006) * k;
      const waist = py - 0.075 * k; // >0 above the waistband
      let cover = waist, folds = 0;
      if (own === J.SHIN_L || own === J.SHIN_R) {
        const o = this.loc(own, x, y, z), ny = L[o + 1];
        cover = Math.max(waist, -(ny + 0.384 * k));
        if (ny < -0.3 * k) folds = Math.sin(ny * 160 / k) * 0.0022 * k * Math.min(1, (-0.3 * k - ny) / (0.05 * k)); // bunching at the hem
      }
      folds += vnoise(x * 24 / k, y * 11 / k, z * 24 / k) * 0.0011 * k;
      pBase = smooth - th + folds;
      const pd = smax(pBase, cover, 0.003 * k);
      if (pd < d) { d = pd; reg = R.PELVIS; }
      // belt
      if (of.belt) { const bl = smax(smooth - th - 0.0025 * k, Math.abs(py - 0.06 * k) - 0.017 * k, 0.002 * k); lay(bl, R.BELT); }
    }
    // --- top: t-shirt (short sleeves) and optional jacket shell
    // the head owns the upper neck: the neck-hole cut (not the owner switch) ends the garment there, so the field stays continuous
    const upper = own === J.TORSO || own === J.PELVIS || own === J.HEAD || own === J.UARM_L || own === J.UARM_R || own === J.FARM_L || own === J.FARM_R;
    if (of.top && bd < 0.07 * k && upper) {
      const isArm = own === J.UARM_L || own === J.UARM_R, isFore = own === J.FARM_L || own === J.FARM_R;
      const ab = isArm ? own : isFore ? own - 1 : (tx > 0 ? J.UARM_L : J.UARM_R);
      const arm = this.loc(ab, x, y, z), fa = this.loc(ab + 1, x, y, z);
      // torso coverage: above the hem, outside the neck hole
      const hem = -(py + (of.tuck ? 0.02 : -0.03) * k);
      const radial = Math.hypot(tx, tz + 0.004 * k);
      // crew neckline as a height cut (dips at the front): it crosses the neck steeply, so the edge stays clean
      const front = Math.max(0, (tz + 0.004 * k) / Math.max(radial, 1e-6));
      let neckV = ty - (0.445 - 0.03 * front * front) * k;
      if (of.vneck && tz > 0.02 * k) neckV = Math.max(neckV, -(Math.abs(tx) - Math.max(0, ty - 0.33 * k) * 0.45));
      const sleeveLen = of.top === 'longtee' ? 0.3 : 0.13;
      let cover;
      if (isArm) cover = -(L[arm + 1] + sleeveLen * k);
      else if (isFore) cover = of.top === 'longtee' ? -(L[fa + 1] + 0.235 * k) : 1;
      else cover = Math.max(hem, neckV);
      const tth = 0.0045 * k + vnoise(x * 26 / k, y * 12 / k, z * 26 / k) * 0.0009 * k;
      let smoothJ = smooth;
      if (of.jacket && bd < 0.05 * k) { this._stamp++; this._kMul = 2.1; smoothJ = Math.max(this.body(x, y, z, true, false), bd - 0.006 * k); this._kMul = 2.5; }
      const tBase = Math.min(Math.min(smooth, bd + (of.jacket ? 0.004 : 0.0015) * k) - tth, bd - 0.001 * k, pBase - 0.0015 * k);
      const td = smax(tBase, cover, 0.003 * k);
      if (td < d) { d = td; reg = R.TOP; }
      if (of.jacket) {
        const jth = (of.jacket === 'bomber' ? (isArm || isFore ? 0.0085 : 0.0095) : of.jacket === 'blazer' ? 0.0075 : 0.0088) * k;
        const jhem = -(py + (of.jacket === 'blazer' ? 0.1 : 0.035) * k);
        // slanted neckline (higher at the back) that also keeps clear of the neck itself: no shelf across the shoulders
        const jneck = Math.max(ty - (0.47 - 0.035 * front * front) * k, 0.072 * k - radial);
        let jc;
        if (isArm) jc = -1; else if (isFore) jc = -(L[fa + 1] + 0.232 * k); else jc = Math.max(jhem, jneck);
        // front opening (open zipper / lapels) — wedge in front of the chest
        const open = of.jacketOpen && !isArm && !isFore && tz > 0.03 * k ? (Math.abs(tx) - (0.02 + Math.max(0, ty / k - 0.1) * 0.12) * k) : 1;
        const jcov = Math.max(jc, -open);
        // folds: elbow creases + soft noise
        const elb = 0; // elbow creases are painted in the shader (geometric ripples alias on the grid)
        const jn = vnoise(x * 24 / k, y * 12 / k, z * 24 / k) * 0.0018 * k + elb;
        const jBase = Math.min(Math.min(smoothJ, bd + (isArm || isFore ? 0.016 : 0.009) * k) - jth + jn, tBase - 0.0022 * k, pBase - 0.0022 * k); // thick fabric hides muscle definition (sleeves are plain tubes)
        const jd = smax(jBase, jcov, 0.004 * k);
        if (jd < d) {
          d = jd;
          // ribbed bands: cuffs, waistband, collar
          const ribC = -L[fa + 1] > 0.2 * k, ribW = py < (of.jacket === 'bomber' ? 0.02 : -1) * k, ribN = ty > 0.43 * k && radial < 0.095 * k && of.jacket === 'bomber';
          reg = (of.jacket === 'bomber' && (ribC || ribW || ribN)) ? R.RIB : R.JACKET;
        }
        // ribbed stand-up collar around the neck opening (open at the front)
        if (of.jacket === 'bomber' && own !== J.UARM_L && own !== J.UARM_R && own !== J.FARM_L && own !== J.FARM_R) {
          const ring = Math.max(radial - 0.089 * k, 0.073 * k - radial);
          const col = smax(ring, Math.abs(ty - 0.45 * k) - 0.025 * k, 0.004 * k);
          const front = tz > 0.0 * k ? (of.jacketOpen ? 0.062 : 0.03) * k - Math.abs(tx) : -1;
          lay(Math.max(col, front), R.RIB);
        }
      }
    }
    // --- hair & beard (head frame)
    const hh = this.loc(J.HEAD, x, y, z), hx = L[hh] / k, hy = L[hh + 1] / k, hz = L[hh + 2] / k;
    if (Math.abs(hx) < 0.14 && hy > 0.0 && hy < 0.32 && hz > -0.16 && hz < 0.16) {
      const style = sp.hair || 'short';
      if (style !== 'bald') {
        // scalp shell following the skull
        const sk = sdEll(hx, hy - 0.178, hz + 0.014, 0.076 * (sp.fem ? 0.95 : 1), 0.092 * (sp.fem ? 0.95 : 1), 0.098 * (sp.fem ? 0.95 : 1));
        const fr = sdEll(hx, hy - 0.192, hz - 0.028, 0.069, 0.066, 0.066);
        const skull = smin(sk, fr, 0.02);
        const ang = Math.atan2(hx, hz); // 0 front, ±pi back
        const a = Math.abs(ang);
        // hairline height by direction (front forehead -> temples -> above ears -> nape)
        let line = hairLine(a);
        if (style === 'fade') line += a > 0.9 && a < 2.4 ? 0.0 : 0;
        const top = Math.max(0, Math.min(1, (hy - 0.19) / 0.06));
        const thick = style === 'buzz' ? 0.0025 : style === 'fade' ? (a > 0.9 ? 0.003 + Math.max(0, hy - 0.2) * 0.12 : 0.009 + 0.004 * top) : style === 'curly' ? 0.02 : (a > 1.3 ? 0.008 : 0.0095) + 0.011 * top + (a < 0.6 ? 0.003 : 0);
        const cover = line - hy + (Math.abs(hx) > 0.068 && hy < 0.16 && hz > -0.035 && hz < 0.02 ? 0.05 : 0); // keep ears clear
        const n = vnoise(hx * 180, hy * 90, hz * 180) * (style === 'curly' ? 0.004 : 0.0015) * Math.min(1, thick / 0.009);
        const tl = Math.max(0, Math.min(1, (hy - line) / 0.022)), taper = tl * tl * (3 - 2 * tl);
        const hd = smax(skull - thick * taper + n * taper, cover, 0.004);
        lay(hd * k, R.HAIR);
      }
      if (sp.beard) {
        // trimmed beard over jaw, chin and upper lip; clear of the cheeks and the lips
        const ax = Math.abs(hx);
        const ct = Math.max(0, Math.min(1, (ax - 0.026) / 0.04));
        const cheek = hy - (0.097 + Math.max(0, ax - 0.026) * 0.95 - Math.sin(ct * Math.PI) * 0.006); // above the curved line from the mouth corners to the sideburns
        const back = -(hz + 0.004) + Math.max(0, 0.06 - hy) * 0.0; // stop behind the jaw angle
        const under = -(hy - (0.034 + Math.max(0, 0.03 - hz) * 0.5)); // under-jaw edge on the neck
        const lips = 0.0016 - lipDist(hx, hy, hz, !!sp.fem);
        const sideburn = ax > 0.064 && hy > 0.1 ? Math.max(cheek, hy - 0.15, -(hz - 0.006)) : cheek;
        const stache = ax < 0.03 && hy > 0.094 && hy < 0.1065 && hz > 0.08 ? -1 : 1;
        const beardCov = Math.max(Math.min(ax > 0.06 ? sideburn : cheek, stache * 0.01), back, under, lips);
        const edge = Math.min(1, -beardCov / 0.008);
        const e2 = Math.max(0, Math.min(1, edge)), es = e2 * e2 * (3 - 2 * e2);
        const bt = ((sp.beard === 'full' ? 0.0036 : 0.0012) * es + vnoise(hx * 400, hy * 400, hz * 400) * 0.0005 * es);
        lay(smax(bd - bt * k, beardCov * k, 0.002 * k), R.BEARD);
      }
    }
    // --- long hair styles and hats (same shapes as the crowd overlays)
    if (Math.abs(hx) < 0.2 && hy > -0.2 && hy < 0.36 && Math.abs(hz) < 0.26) {
      const st = sp.hair || 'short';
      if (st === 'long' || st === 'ponytail' || st === 'bun' || st === 'curly') lay(accessory({ fem: sp.fem, only: 'hair', hair: st }, hx, hy, hz) * k, R.HAIR_LONG);
      if (sp.hat) lay(accessory({ fem: sp.fem, only: 'hat', hat: sp.hat }, hx, hy, hz) * k, R.HAT);
    }
    // --- vest (police/swat) over the torso
    if (sp.vest && bd < 0.08 * k && (own === J.TORSO || own === J.PELVIS || own === J.HEAD)) {
      const vcov = Math.max(-(py - 0.02 * k), ty - 0.44 * k);
      lay(smax(smooth - 0.028 * k, vcov, 0.006 * k), R.VEST);
    }
    this.layer = reg;
    return d;
  }
}

Model.prototype.sampleOnly = function (x, y, z, track) {
  this._stamp++;
  const sp = this.sp, k = this.k, L = this.L;
  if (sp.only === 'vest') {
    const bd = this.body(x, y, z, false, track);
    this.layer = R.VEST;
    if (bd > 0.1 * k) return bd - 0.028 * k;
    this._stamp++; this._coreOnly = true;
    const core = this.body(x, y, z, true, false);
    this._coreOnly = false;
    const T = this.loc(J.TORSO, x, y, z), ty = L[T + 1];
    const Pv = this.loc(J.PELVIS, x, y, z), py = L[Pv + 1];
    const vcov = Math.max(-(py - 0.02 * k), ty - 0.44 * k);
    return smax(Math.min(core - 0.028 * k, bd - 0.012 * k), vcov, 0.006 * k);
  }
  const hh = this.loc(J.HEAD, x, y, z), hx = L[hh] / k, hy = L[hh + 1] / k, hz = L[hh + 2] / k;
  if (track) this.nearest = null;
  this.layer = sp.only === 'hat' ? R.HAT : R.HAIR_LONG;
  return accessory(sp, hx, hy, hz) * k;
};

// ---------------------------------------------------------------- surface nets
/**
 * Polygonize fn over a box in a local frame (M: local->world). keep(x,y,z world) optional extra SDF (max).
 * Returns { pos: number[], idx: number[] } in world (bind) space.
 */
function surfaceNets(fn, M, min, max, h, coarse = 4) {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1, ny = Math.ceil((max[1] - min[1]) / h) + 1, nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const N = nx * ny * nz;
  const val = new Float32Array(N);
  const e = M.elements;
  const W = (lx, ly, lz, out) => { out[0] = e[0] * lx + e[4] * ly + e[8] * lz + e[12]; out[1] = e[1] * lx + e[5] * ly + e[9] * lz + e[13]; out[2] = e[2] * lx + e[6] * ly + e[10] * lz + e[14]; return out; };
  const tmp = [0, 0, 0];
  const at = (i, j, k) => { W(min[0] + i * h, min[1] + j * h, min[2] + k * h, tmp); return fn(tmp[0], tmp[1], tmp[2]); };
  // coarse pass: skip blocks far from the surface
  const C = coarse, reach = C * h * 1.8;
  let evals = 0;
  for (let bk = 0; bk < nz; bk += C) for (let bj = 0; bj < ny; bj += C) for (let bi = 0; bi < nx; bi += C) {
    const ci = Math.min(bi + C / 2, nx - 1), cj = Math.min(bj + C / 2, ny - 1), ck = Math.min(bk + C / 2, nz - 1);
    const dc = at(ci, cj, ck); evals++;
    const i1 = Math.min(bi + C, nx), j1 = Math.min(bj + C, ny), k1 = Math.min(bk + C, nz);
    if (Math.abs(dc) > reach) { for (let k = bk; k < k1; k++) for (let j = bj; j < j1; j++) { const o = (k * ny + j) * nx; for (let i = bi; i < i1; i++) val[o + i] = dc; } continue; }
    for (let k = bk; k < k1; k++) for (let j = bj; j < j1; j++) { const o = (k * ny + j) * nx; for (let i = bi; i < i1; i++) { val[o + i] = at(i, j, k); evals++; } }
  }
  // vertices: one per cell with a sign change, at the mean of edge crossings
  const cell = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos = [];
  const cidx = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8), cp = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const v = val[((k + cp[c][2]) * ny + j + cp[c][1]) * nx + i + cp[c][0]]; cv[c] = v; if (v < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      const va = cv[a], vb = cv[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += cp[a][0] + (cp[b][0] - cp[a][0]) * t; sy += cp[a][1] + (cp[b][1] - cp[a][1]) * t; sz += cp[a][2] + (cp[b][2] - cp[a][2]) * t; n++;
    }
    cell[cidx(i, j, k)] = pos.length / 3;
    W(min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h, tmp);
    pos.push(tmp[0], tmp[1], tmp[2]);
  }
  // faces: for each grid edge with a sign change, a quad of the 4 cells around it
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v0 = val[(k * ny + j) * nx + i], v1 = val[(k * ny + j) * nx + i + 1]; if ((v0 < 0) === (v1 < 0)) continue;
    quad(cell[cidx(i, j - 1, k - 1)], cell[cidx(i, j, k - 1)], cell[cidx(i, j, k)], cell[cidx(i, j - 1, k)], v0 < 0);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = val[(k * ny + j) * nx + i], v1 = val[(k * ny + j + 1) * nx + i]; if ((v0 < 0) === (v1 < 0)) continue;
    quad(cell[cidx(i - 1, j, k - 1)], cell[cidx(i - 1, j, k)], cell[cidx(i, j, k)], cell[cidx(i, j, k - 1)], v0 < 0);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = val[(k * ny + j) * nx + i], v1 = val[((k + 1) * ny + j) * nx + i]; if ((v0 < 0) === (v1 < 0)) continue;
    quad(cell[cidx(i - 1, j - 1, k)], cell[cidx(i, j - 1, k)], cell[cidx(i, j, k)], cell[cidx(i - 1, j, k)], v0 < 0);
  }
  return { pos, idx, evals };
}

// ---------------------------------------------------------------- skin weights
const ZONE_BONE = { pelvis: J.PELVIS, torso: J.TORSO, neck: J.HEAD, skull: J.HEAD, face: J.HEAD, lips: J.HEAD, ear: J.HEAD, mouth: J.HEAD, uarm: 'arm', farm: 'farm', hand: 'hand', fingertip: 'hand', thigh: 'thigh', shin: 'shin', shoe: 'foot', sole: 'foot', lace: 'foot' };
function jointBlend(W, parent, child, r, p, dirLocal = [0, -1, 0]) {
  // returns s in [0,1]: 0 = parent side, 1 = child side, measured along the child bone direction
  const jp = new THREE.Vector3().setFromMatrixPosition(W[child]);
  const d = new THREE.Vector3(...dirLocal).transformDirection(W[child]);
  const t = (p.x - jp.x) * d.x + (p.y - jp.y) * d.y + (p.z - jp.z) * d.z;
  const u = Math.min(1, Math.max(0, (t / r + 1) * 0.5));
  return u * u * (3 - 2 * u);
}
function addW(map, b, w) { if (w > 1e-4) map.set(b, (map.get(b) || 0) + w); }

// ---------------------------------------------------------------- build
/**
 * spec: { fem, k, w, muscle, fat, hair: 'short'|'fade'|'buzz'|'long'|'ponytail'|'bun'|'curly'|'bald', beard: false|'stubble'|'full',
 *         outfit: { top: 'tee'|'longtee'|null, jacket: 'bomber'|'blazer'|'leather'|null, jacketOpen, vneck, tuck, pants: 'jeans'|'slacks'|null, belt },
 *         shoe: 'sneaker'|'boot'|'dress', hat: 'cap'|'hard'|null, vest, lod: 0|1|2, fine: head/hand grid resolution }
 */
export function buildHumanGeometry(spec) {
  const t0 = performance.now();
  const m = new Model(spec);
  const k = m.k, W = m.W;
  const lod = spec.lod ?? 0;
  const hBody = (spec.hBody ?? [0.009, 0.018, 0.032][lod]) * k;
  const hHead = (spec.hHead ?? [0.0032, 0, 0][lod]) * k, hHand = (spec.hHand ?? [0.0028, 0, 0][lod]) * k;
  const separate = lod === 0;
  const fn = (x, y, z) => m.sample(x, y, z);
  // cuts: head above the neck plane, hands below the wrist plane (in their own frames)
  const headCut = 0.035 * k, handCut = -0.012 * k, overlap = 0.03 * k;
  const localY = (b, x, y, z) => { const e = m.inv[b].elements; return e[1] * x + e[5] * y + e[9] * z + e[13]; };
  const localP = (b, x, y, z, out) => { const e = m.inv[b].elements; out[0] = e[0] * x + e[4] * y + e[8] * z + e[12]; out[1] = e[1] * x + e[5] * y + e[9] * z + e[13]; out[2] = e[2] * x + e[6] * y + e[10] * z + e[14]; return out; };
  const lp = [0, 0, 0];
  // removal boxes (local frames): the head above the neck cut, each hand beyond the wrist cut
  const headBox = (x, y, z) => { localP(J.HEAD, x, y, z, lp); return sdRoundBox(lp[0], lp[1] - (headCut + 0.2 * k), lp[2], 0.2 * k, 0.2 * k, 0.25 * k, 0); };
  const handBox = (b, x, y, z) => { localP(b, x, y, z, lp); return sdRoundBox(lp[0], lp[1] - (handCut - 0.15 * k), lp[2] - 0.01 * k, 0.08 * k, 0.15 * k, 0.1 * k, 0); };
  const bodyFn = separate ? (x, y, z) => {
    let d = fn(x, y, z);
    d = Math.max(d, -headBox(x, y, z), -handBox(J.HAND_L, x, y, z), -handBox(J.HAND_R, x, y, z));
    return d;
  } : fn;
  // body grid bounds (world)
  let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const g of [...m.bodyPrims, ...m.shoePrims]) { const b = g.wb; for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], b[a] - b[3]); max[a] = Math.max(max[a], b[a] + b[3]); } }
  for (let a = 0; a < 3; a++) { min[a] -= 0.05 * k; max[a] += 0.05 * k; }
  const I = new THREE.Matrix4();
  const parts = [];
  let evals = 0;
  let patchInfl = null; const vPartTmp = [];
  if (spec.only) {
    // accessory overlay: its own grid (head frame for hats and hair, bind space around the torso for vests)
    const h = (spec.hOv ?? (spec.only === 'vest' ? [0.009, 0.018, 0.024] : [0.005, 0.011, 0.016])[lod]) * k;
    const om = spec.only === 'vest'
      ? surfaceNets(fn, I, [-0.3 * k, 0.9 * k, -0.25 * k], [0.3 * k, 1.56 * k, 0.25 * k], h, 4)
      : surfaceNets(fn, W[J.HEAD], [-0.17 * k, -0.08 * k, -0.22 * k], [0.17 * k, 0.33 * k, 0.24 * k], h, 4);
    parts.push(om); evals += om.evals;
  } else {
    const bodyMesh = surfaceNets(bodyFn, I, min, max, hBody, lod === 0 ? 4 : 3);
    parts.push(bodyMesh);
    evals += bodyMesh.evals;
  }
  if (separate && !spec.only) {
    // fine patches sit 0.3 mm proud of the coarse body, but sink 1.5 mm under it toward their open edge,
    // so the edge itself is always buried and the two surfaces cross invisibly
    const infl = (t) => { const u = Math.max(0, Math.min(1, t / (overlap * 0.7))); return (-0.0015 + 0.0018 * u * u * (3 - 2 * u)) * k; };
    const headInfl = (x, y, z) => infl(localY(J.HEAD, x, y, z) - (headCut - overlap));
    const handInfl = (b, x, y, z) => infl((handCut + overlap) - localY(b, x, y, z));
    patchInfl = (v, x, y, z) => vPartTmp[v] === 1 ? headInfl(x, y, z) : vPartTmp[v] === 2 ? handInfl(J.HAND_L, x, y, z) : handInfl(J.HAND_R, x, y, z);
    // head grid in the head frame
    const hf = (x, y, z) => Math.max(fn(x, y, z) - headInfl(x, y, z), headCut - overlap - localY(J.HEAD, x, y, z));
    const hm = surfaceNets(hf, W[J.HEAD], [-0.125 * k, headCut - overlap - 0.01 * k, -0.15 * k], [0.125 * k, 0.33 * k, 0.16 * k], hHead, 4);
    parts.push(hm); evals += hm.evals;
    for (const hb of [J.HAND_L, J.HAND_R]) {
      const ff = (x, y, z) => Math.max(fn(x, y, z) - handInfl(hb, x, y, z), localY(hb, x, y, z) - (handCut + overlap));
      const mm = surfaceNets(ff, W[hb], [-0.05 * k, -0.21 * k, -0.065 * k], [0.05 * k, handCut + overlap + 0.01 * k, 0.085 * k], hHand, 4);
      parts.push(mm); evals += mm.evals;
    }
  }
  // merge
  let nv = 0, ni = 0; for (const p of parts) { nv += p.pos.length / 3; ni += p.idx.length; }
  const vPart = new Uint8Array(nv); { let o = 0; parts.forEach((p, i) => { vPart.fill(Math.min(i, 2), o, o + p.pos.length / 3); o += p.pos.length / 3; }); }
  let pos = new Float32Array(nv * 3); const index = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const p of parts) { pos.set(p.pos, ov * 3); for (let i = 0; i < p.idx.length; i++) index[oi + i] = p.idx[i] + ov; ov += p.pos.length / 3; oi += p.idx.length; }
  // project fine vertices onto their (tapered-inflation) surface for sharper features — head and hand patches only
  const eps = 0.0006 * k;
  if (separate && !spec.only) {
    let o = 0; parts.forEach((pt, i) => { const n = pt.pos.length / 3; for (let q = 0; q < n; q++) vPartTmp[o + q] = i; o += n; });
    const start = parts[0].pos.length / 3;
    for (let v = start; v < nv; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const f = (a, b, c) => fn(a, b, c) - patchInfl(v, a, b, c);
      const d = f(x, y, z);
      const gx = (f(x + eps, y, z) - f(x - eps, y, z)) / (2 * eps), gy = (f(x, y + eps, z) - f(x, y - eps, z)) / (2 * eps), gz = (f(x, y, z + eps) - f(x, y, z - eps)) / (2 * eps);
      const g2 = gx * gx + gy * gy + gz * gz;
      if (g2 > 0.09 && Math.abs(d) < hHead) { pos[v * 3] -= gx * d / g2; pos[v * 3 + 1] -= gy * d / g2; pos[v * 3 + 2] -= gz * d / g2; }
    }
  }
  // ---- per-point classification (region, bone, zone), shared by vertices and boundary bisection
  const tmpP = new THREE.Vector3();
  const classify = (x, y, z, out) => {
    m.sample(x, y, z, true);
    let reg = m.layer;
    const near = m.nearest;
    let zone = near && near.p.z ? near.p.z : 'torso', bone = near ? near.bone : J.TORSO;
    if (reg === R.SHOE) { const ns = m.nearestShoe; bone = ns ? ns.bone : bone; zone = ns && ns.p.z ? ns.p.z : 'shoe'; reg = zone === 'sole' ? R.SOLE : zone === 'lace' ? R.LACE : R.SHOE; }
    if (reg === R.EYE || reg === R.HAIR || reg === R.HAIR_LONG || reg === R.BEARD || reg === R.HAT) bone = J.HEAD;
    if (reg === -1) { // skin: zone decides colour region
      reg = zone === 'lips' ? R.LIPS : zone === 'mouth' ? R.MOUTH : zone === 'hand' ? R.HAND : zone === 'fingertip' ? R.HAND : zone === 'farm' ? R.FOREARM : R.SKIN;
      if (zone === 'fingertip') { // nails on the back of the distal segment
        const o = m.loc(bone, x, y, z), L = m.L; const side = bone === J.HAND_L ? 1 : -1;
        if (L[o] * side > 0.004 * k) reg = R.NAIL;
      }
      if (reg === R.LIPS || reg === R.MOUTH) reg = R.SKIN; // lips are painted per pixel in the head shader
    }
    if (reg === R.PELVIS) {
      const b = bone;
      reg = (b === J.SHIN_L || b === J.SHIN_R) ? R.SHIN : (b === J.THIGH_L || b === J.THIGH_R) ? R.THIGH : R.PELVIS;
      if (reg === R.PELVIS) { const o = m.loc(J.PELVIS, x, y, z); if (m.L[o + 1] < -0.05 * k) reg = R.THIGH; }
    }
    if (reg === R.TOP) {
      const b = bone;
      if (b === J.UARM_L || b === J.UARM_R || b === J.FARM_L || b === J.FARM_R) reg = R.SLEEVE_U;
      else { const o = m.loc(J.TORSO, x, y, z); const L = m.L; if (L[o + 2] > 0.03 * k && L[o + 1] > 0.3 * k && Math.abs(L[o]) < (0.03 + (L[o + 1] / k - 0.3) * 0.45) * k) reg = R.VNECK; }
    }
    // bone for clothing = nearest body bone
    if (ZONE_BONE[zone] === 'arm' || zone === 'uarm') bone = near.bone;
    out.reg = reg; out.bone = bone; out.zone = zone;
    return out;
  };
  // material class for boundary clipping (head skin, lips, beard and scalp hair share one class: the shader blends them per pixel)
  const HEADCLASS = new Set([R.SKIN, R.LIPS, R.MOUTH, R.BEARD, R.HAIR, R.BROW]);
  const cls = (reg) => HEADCLASS.has(reg) ? 100 : reg;
  const swayOf = (x, y, z, reg) => {
    if (reg === R.JACKET || reg === R.RIB) { const o = m.loc(J.PELVIS, x, y, z); return Math.max(0, Math.min(1, (0.06 * k - m.L[o + 1]) / (0.1 * k))) * 0.6; }
    if (reg === R.HAIR_LONG) { const o = m.loc(J.HEAD, x, y, z); return Math.max(0, Math.min(1, (0.15 * k - m.L[o + 1]) / (0.15 * k))); }
    return 0;
  };
  const map = new Map();
  const weights = (p, bone, reg, outI, outW, o4) => {
    map.clear();
    const Wt = (b, w) => addW(map, b, w);
    if (bone === J.HEAD) {
      // neck: torso -> neck -> head ; jaw
      const s = jointBlend(W, J.TORSO, J.HEAD, 0.045 * k, p, [0, 1, 0]);
      Wt(J.TORSO, (1 - s) * (1 - s)); Wt(H.NECK, 2 * s * (1 - s));
      let wh = s * s;
      const o = m.loc(J.HEAD, p.x, p.y, p.z), L = m.L, ly = L[o + 1] / k, lz = L[o + 2] / k, lx = L[o] / k;
      if (reg !== R.EYE && reg !== R.HAIR && reg !== R.HAIR_LONG && reg !== R.HAT && lz > 0.0 && ly < 0.086 && ly > 0.03 && Math.abs(lx) < 0.065) {
        const jw = Math.min(1, (0.086 - ly) / 0.012) * Math.min(1, lz / 0.03) * (1 - Math.min(1, Math.max(0, (Math.abs(lx) - 0.045) / 0.02)));
        Wt(H.JAW, wh * jw); wh *= 1 - jw;
      }
      Wt(J.HEAD, wh);
    } else if (bone === J.PELVIS || bone === J.TORSO) {
      const s = jointBlend(W, J.PELVIS, J.TORSO, 0.09 * k, p, [0, 1, 0]);
      let wp = (1 - s) * (1 - s), wsp = 2 * s * (1 - s), wt = s * s;
      // shoulders and neck from the torso
      if (wt > 0) {
        const sn = jointBlend(W, J.TORSO, J.HEAD, 0.04 * k, p, [0, 1, 0]);
        Wt(H.NECK, wt * sn * 0.6); Wt(J.HEAD, wt * sn * 0.4); wt *= 1 - sn;
        for (const [ua, cl] of [[J.UARM_L, H.CLAV_L], [J.UARM_R, H.CLAV_R]]) {
          const jp = tmpP.setFromMatrixPosition(W[ua]); const dd = p.distanceTo(jp);
          if (dd < 0.11 * k) { const f = (1 - dd / (0.11 * k)) ** 2 * 0.7; Wt(cl, wt * f); wt *= 1 - f; }
        }
      }
      // hips into the thighs
      for (const th of [J.THIGH_L, J.THIGH_R]) {
        const sameSide = th === J.THIGH_L ? p.x > 0 : p.x < 0;
        if (!sameSide) continue;
        const s2 = jointBlend(W, J.PELVIS, th, 0.07 * k, p);
        Wt(th, wp * s2); wp *= 1 - s2;
      }
      Wt(J.PELVIS, wp); Wt(H.SPINE, wsp); Wt(J.TORSO, wt);
    } else if (bone === J.UARM_L || bone === J.UARM_R) {
      // shoulder cap rides mostly on the clavicle helper (30% of the arm's swing), the arm is rigid below the deltoid
      const cl = bone === J.UARM_L ? H.CLAV_L : H.CLAV_R;
      const s0 = jointBlend(W, J.TORSO, bone, 0.05 * k, p);
      const wb = s0; Wt(J.TORSO, (1 - s0) * 0.2); Wt(cl, (1 - s0) * 0.8);
      const s1 = jointBlend(W, bone, bone + 1, 0.045 * k, p);
      Wt(bone + 1, wb * s1); Wt(bone, wb * (1 - s1));
    } else if (bone === J.FARM_L || bone === J.FARM_R) {
      const s0 = jointBlend(W, bone - 1, bone, 0.045 * k, p);
      Wt(bone - 1, 1 - s0);
      const s1 = jointBlend(W, bone, bone + 1, 0.03 * k, p);
      Wt(bone + 1, s0 * s1); Wt(bone, s0 * (1 - s1));
    } else if (bone === J.HAND_L || bone === J.HAND_R) {
      const s0 = jointBlend(W, bone - 1, bone, 0.025 * k, p);
      Wt(bone - 1, 1 - s0); Wt(bone, s0);
    } else if (bone === J.THIGH_L || bone === J.THIGH_R) {
      const s0 = jointBlend(W, J.PELVIS, bone, 0.07 * k, p);
      Wt(J.PELVIS, 1 - s0);
      const s1 = jointBlend(W, bone, bone + 1, 0.06 * k, p);
      Wt(bone + 1, s0 * s1); Wt(bone, s0 * (1 - s1));
    } else if (bone === J.SHIN_L || bone === J.SHIN_R) {
      const s0 = jointBlend(W, bone - 1, bone, 0.06 * k, p);
      Wt(bone - 1, 1 - s0);
      const s1 = jointBlend(W, bone, bone + 1, 0.04 * k, p);
      Wt(bone + 1, s0 * s1); Wt(bone, s0 * (1 - s1));
    } else if (bone === J.FOOT_L || bone === J.FOOT_R) {
      const s0 = jointBlend(W, bone - 1, bone, 0.035 * k, p);
      Wt(bone - 1, 1 - s0);
      const toe = bone === J.FOOT_L ? H.TOE_L : H.TOE_R;
      const s1 = jointBlend(W, bone, toe, 0.03 * k, p, [0, 0, 1]);
      Wt(toe, s0 * s1); Wt(bone, s0 * (1 - s1));
    } else Wt(bone, 1);
    // top 4, normalized
    const arr = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    let sum = 0; for (const [, w] of arr) sum += w;
    for (let i = 0; i < 4; i++) { const e = arr[i]; outI[o4 + i] = e ? e[0] : 0; outW[o4 + i] = e ? e[1] / sum : 0; }
  };
  // ---- vertices
  const C0 = { reg: 0, bone: 0, zone: '' };
  let region = new Float32Array(nv), sway = new Float32Array(nv), skI = new Float32Array(nv * 4), skW = new Float32Array(nv * 4);
  const p = new THREE.Vector3();
  for (let v = 0; v < nv; v++) {
    p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    classify(p.x, p.y, p.z, C0);
    region[v] = C0.reg;
    sway[v] = swayOf(p.x, p.y, p.z, C0.reg);
    weights(p, C0.bone, C0.reg, skI, skW, v * 4);
  }
  // smooth normals of the unclipped surface (clipped vertices interpolate them, so region seams never show in the shading)
  const g0 = new THREE.BufferGeometry();
  g0.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g0.setIndex(new THREE.BufferAttribute(index, 1)); g0.computeVertexNormals();
  let nrm = g0.attributes.normal.array;
  // ---- clip triangles along material boundaries: crossings found by bisection on each mixed edge
  const clip = spec.clip ?? true;
  let outIdx = index, nvOut = nv;
  let triPart = new Uint8Array(index.length / 3); for (let f = 0; f < triPart.length; f++) triPart[f] = vPart[index[f * 3]];
  if (clip) {
    const P2 = [], R2 = [], N2 = [], S2 = [], I2 = [], W2 = []; // appended vertices
    const edgeCache = new Map();
    const Cb = { reg: 0, bone: 0, zone: '' };
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pm = new THREE.Vector3();
    const regAt = (x, y, z) => cls(classify(x, y, z, Cb).reg);
    /** crossing on edge a-b (a in class ca). Returns { t, x,y,z, nx,ny,nz, i[4], w[4], sway } shared by both sides. */
    const crossing = (a, b) => {
      const key = a < b ? a * 4294967 + b : b * 4294967 + a;
      let c = edgeCache.get(key);
      if (c) return c;
      const lo = a < b ? a : b, hi = a < b ? b : a;
      pa.set(pos[lo * 3], pos[lo * 3 + 1], pos[lo * 3 + 2]); pb.set(pos[hi * 3], pos[hi * 3 + 1], pos[hi * 3 + 2]);
      const cl = cls(region[lo]);
      let t0 = 0, t1 = 1;
      for (let it = 0; it < 7; it++) { const tm = (t0 + t1) / 2; pm.lerpVectors(pa, pb, tm); if (regAt(pm.x, pm.y, pm.z) === cl) t0 = tm; else t1 = tm; }
      const t = (t0 + t1) / 2; pm.lerpVectors(pa, pb, t);
      const nx = nrm[lo * 3] * (1 - t) + nrm[hi * 3] * t, ny = nrm[lo * 3 + 1] * (1 - t) + nrm[hi * 3 + 1] * t, nz = nrm[lo * 3 + 2] * (1 - t) + nrm[hi * 3 + 2] * t;
      const nl = Math.hypot(nx, ny, nz) || 1;
      // weights from the dominant endpoint's classification at the crossing point
      classify(pm.x, pm.y, pm.z, Cb);
      const wi = [0, 0, 0, 0], ww = [0, 0, 0, 0];
      weights(pm, Cb.bone, Cb.reg, wi, ww, 0);
      c = { x: pm.x, y: pm.y, z: pm.z, nx: nx / nl, ny: ny / nl, nz: nz / nl, wi, ww, sway: sway[lo] * (1 - t) + sway[hi] * t, dup: new Map() };
      edgeCache.set(key, c);
      return c;
    };
    const vtx = (c, reg) => { // one duplicate of a crossing per region
      let id = c.dup.get(reg);
      if (id != null) return id;
      id = nv + R2.length;
      P2.push(c.x, c.y, c.z); N2.push(c.nx, c.ny, c.nz); R2.push(reg); S2.push(c.sway); I2.push(...c.wi); W2.push(...c.ww);
      c.dup.set(reg, id); return id;
    };
    const centroid = (a, b, c3, reg, cacheKey) => {
      const x = (pos[a * 3] + pos[b * 3] + pos[c3 * 3]) / 3, y = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c3 * 3 + 1]) / 3, z = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c3 * 3 + 2]) / 3;
      let c = edgeCache.get(cacheKey);
      if (!c) {
        let nx = nrm[a * 3] + nrm[b * 3] + nrm[c3 * 3], ny = nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c3 * 3 + 1], nz = nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c3 * 3 + 2]; const nl = Math.hypot(nx, ny, nz) || 1;
        pm.set(x, y, z); classify(x, y, z, Cb); const wi = [0, 0, 0, 0], ww = [0, 0, 0, 0]; weights(pm, Cb.bone, Cb.reg, wi, ww, 0);
        c = { x, y, z, nx: nx / nl, ny: ny / nl, nz: nz / nl, wi, ww, sway: (sway[a] + sway[b] + sway[c3]) / 3, dup: new Map() };
        edgeCache.set(cacheKey, c);
      }
      return vtx(c, reg);
    };
    const out = [], outPart = [];
    const ntri = index.length / 3;
    for (let f = 0; f < ntri; f++) {
      const a = index[f * 3], b = index[f * 3 + 1], c3 = index[f * 3 + 2];
      const ca = cls(region[a]), cb = cls(region[b]), cc = cls(region[c3]);
      const pp = vPart[a];
      if (ca === cb && cb === cc) { out.push(a, b, c3); outPart.push(pp); continue; }
      if (ca === cb || cb === cc || ca === cc) {
        // rotate so that (u, v) share a class and w is the odd one
        let u, v, w;
        if (ca === cb) { u = a; v = b; w = c3; } else if (cb === cc) { u = b; v = c3; w = a; } else { u = c3; v = a; w = b; }
        const m1 = crossing(v, w), m2 = crossing(w, u);
        const ru = region[u], rv = region[v], rw = region[w];
        const m1u = vtx(m1, ru === rv ? ru : rv), m2u = vtx(m2, ru);
        out.push(u, v, m1u, u, m1u, m2u);
        const m1w = vtx(m1, rw), m2w = vtx(m2, rw);
        out.push(m1w, w, m2w);
        outPart.push(pp, pp, pp);
      } else {
        // three materials: fan around the centroid
        const mab = crossing(a, b), mbc = crossing(b, c3), mca = crossing(c3, a);
        const ra = region[a], rb = region[b], rc = region[c3];
        const key = -(f + 1);
        const ga = centroid(a, b, c3, ra, key), gb = centroid(a, b, c3, rb, key), gc = centroid(a, b, c3, rc, key);
        out.push(a, vtx(mab, ra), ga, a, ga, vtx(mca, ra));
        out.push(b, vtx(mbc, rb), gb, b, gb, vtx(mab, rb));
        out.push(c3, vtx(mca, rc), gc, c3, gc, vtx(mbc, rc));
        for (let q = 0; q < 6; q++) outPart.push(pp);
      }
    }
    // append new vertices
    const add = R2.length;
    nvOut = nv + add;
    const grow = (arr, extra, n) => { const o = new Float32Array(arr.length + extra.length); o.set(arr); o.set(extra, arr.length); return o; };
    pos = grow(pos, P2); nrm = grow(nrm, N2); region = grow(region, R2); sway = grow(sway, S2); skI = grow(skI, I2); skW = grow(skW, W2);
    outIdx = new Uint32Array(out); triPart = new Uint8Array(outPart);
  }
  // ---- ambient occlusion from the distance field (short range exact, long range from a coarse cache)
  const ao = new Float32Array(nvOut);
  if (spec.ao !== false) {
    const base = spec.only ? new Model({ ...spec, only: undefined }) : null;
    const aoS = base ? (x, y, z) => Math.min(m.sample(x, y, z), base.sample(x, y, z)) : (x, y, z) => m.sample(x, y, z);
    const steps = [0.004, 0.009, 0.018, 0.035, 0.065].map(v => v * k);
    const wts = [0.9, 0.75, 0.55, 0.35, 0.22];
    const coarse = new Map(); const cq = 0.01 * k; // cached coarse lattice, sampled trilinearly
    const lat = (i, j, l) => { const key = ((i + 1024) * 2048 + (j + 1024)) * 2048 + (l + 1024); let v = coarse.get(key); if (v === undefined) { v = aoS(i * cq, j * cq, l * cq); coarse.set(key, v); } return v; };
    const sampleC = (x, y, z) => {
      const fx = x / cq, fy = y / cq, fz = z / cq, i = Math.floor(fx), j = Math.floor(fy), l = Math.floor(fz), u = fx - i, v = fy - j, w = fz - l;
      const c00 = lat(i, j, l) * (1 - u) + lat(i + 1, j, l) * u, c10 = lat(i, j + 1, l) * (1 - u) + lat(i + 1, j + 1, l) * u;
      const c01 = lat(i, j, l + 1) * (1 - u) + lat(i + 1, j, l + 1) * u, c11 = lat(i, j + 1, l + 1) * (1 - u) + lat(i + 1, j + 1, l + 1) * u;
      return (c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w;
    };
    for (let v = 0; v < nvOut; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
      let occ = 0;
      for (let i = 0; i < steps.length; i++) {
        const h = steps[i], qx = x + nx * h, qy = y + ny * h, qz = z + nz * h;
        const d = i < 2 ? aoS(qx, qy, qz) : sampleC(qx, qy, qz);
        occ += Math.max(0, h - d) / h * wts[i];
      }
      ao[v] = Math.max(0.25, 1 - occ * 0.55);
    }
  } else ao.fill(1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(outIdx, 1));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aSkin', new THREE.BufferAttribute(skI, 4));
  g.setAttribute('aW', new THREE.BufferAttribute(skW, 4));
  g.setAttribute('aRegion', new THREE.BufferAttribute(region, 1));
  g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  g.computeBoundingSphere();
  g.userData = { tris: outIdx.length / 3, verts: nvOut, ms: Math.round(performance.now() - t0), evals, spec, bind: W, inv: m.inv, triPart };
  return g;
}
/** Debug helper: probe layers along a ray in the head frame. */
export function debugProbe(spec, pts) {
  const m = new Model(spec);
  const out = [];
  const v = new THREE.Vector3();
  for (const [x, y, z] of pts) { v.set(x, y, z).applyMatrix4(m.W[J.HEAD]); const d = m.sample(v.x, v.y, v.z, true); out.push([x, y, z, +d.toFixed(4), m.layer, m.nearest && m.nearest.p.z]); }
  return out;
}

/** Debug: the layered model for a spec. */
export function __model(spec) { return new Model(spec); }
