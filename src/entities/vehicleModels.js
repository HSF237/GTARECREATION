// Procedural vehicle models (original designs). Local frame: +Z forward, +X = left side, +Y up; origin on the ground
// under the midpoint between the axles.
//   VEHICLE_SPECS[type] ; buildVehicle(type, { color, seed }) -> VehicleModel
//   VehicleModel: { root, body, wheels:[{x,y,z,r,w,front,left}], setLights({head,brake,reverse,indL,indR,siren,taxi,tail}), setDamage(0..1),
//                   dent(localPoint, strength), setBurnt(bool), setPaint(color), dispose() }
//   new WheelRenderer(scene, max) ; .begin() ; .push(matrix, radius, width, style) ; .end()
import * as THREE from 'three';
import { makeRng } from '../core/rng.js';
import { clamp, lerp } from '../core/math.js';

// geometry profile params: L W H wb fo(front overhang) r(wheel radius) ww(wheel width) clr(ground clearance)
// noseY hoodY beltY roofY deckY tailY  zWs zRoofF zRoofR zRw  (fractions of L from rear, 0..1)
export const VEHICLE_SPECS = {
  compact: { name: 'Pico', L: 3.9, W: 1.74, H: 1.48, wb: 2.45, r: 0.3, ww: 0.2, clr: 0.16, noseY: 0.62, hoodY: 0.88, beltY: 0.95, roofY: 1.48, deckY: 0.98, tailY: 0.9, zWs: 0.68, zRoofF: 0.58, zRoofR: 0.18, zRw: 0.06, mass: 1050, power: 7200, maxSpeed: 44, grip: 1.0, drive: 'fwd', seats: 2, engine: 'compact', class: 'car' },
  sedan: { name: 'Solace', L: 4.8, W: 1.84, H: 1.45, wb: 2.8, r: 0.33, ww: 0.22, clr: 0.17, noseY: 0.64, hoodY: 0.9, beltY: 0.96, roofY: 1.45, deckY: 0.98, tailY: 0.93, zWs: 0.66, zRoofF: 0.55, zRoofR: 0.3, zRw: 0.2, mass: 1450, power: 9000, maxSpeed: 52, grip: 1.0, drive: 'rwd', seats: 2, engine: 'sedan', class: 'car' },
  taxi: { name: 'Solace Cab', base: 'sedan', livery: 'taxi', mass: 1480, power: 8600, maxSpeed: 50, engine: 'sedan' },
  police: { name: 'Interceptor', base: 'sedan', livery: 'police', mass: 1600, power: 12500, maxSpeed: 60, grip: 1.1, engine: 'muscle' },
  sports: { name: 'Vento GT', L: 4.5, W: 1.94, H: 1.22, wb: 2.65, r: 0.34, ww: 0.26, clr: 0.12, noseY: 0.5, hoodY: 0.78, beltY: 0.82, roofY: 1.22, deckY: 0.86, tailY: 0.84, zWs: 0.6, zRoofF: 0.47, zRoofR: 0.3, zRw: 0.14, mass: 1350, power: 13500, maxSpeed: 66, grip: 1.2, drive: 'rwd', seats: 2, engine: 'sports', class: 'car', spoiler: true },
  super: { name: 'Zenith R', L: 4.6, W: 2.0, H: 1.12, wb: 2.7, r: 0.35, ww: 0.3, clr: 0.1, noseY: 0.42, hoodY: 0.66, beltY: 0.74, roofY: 1.12, deckY: 0.88, tailY: 0.9, zWs: 0.64, zRoofF: 0.5, zRoofR: 0.34, zRw: 0.22, mass: 1380, power: 17500, maxSpeed: 76, grip: 1.3, drive: 'awd', seats: 2, engine: 'super', class: 'car', spoiler: true, wedge: true },
  muscle: { name: 'Bruiser', L: 5.0, W: 1.9, H: 1.34, wb: 2.9, r: 0.35, ww: 0.28, clr: 0.15, noseY: 0.72, hoodY: 0.96, beltY: 0.98, roofY: 1.34, deckY: 1.0, tailY: 0.95, zWs: 0.62, zRoofF: 0.52, zRoofR: 0.32, zRw: 0.22, mass: 1600, power: 14000, maxSpeed: 62, grip: 0.95, drive: 'rwd', seats: 2, engine: 'muscle', class: 'car', scoop: true },
  suv: { name: 'Summit', L: 4.9, W: 1.98, H: 1.8, wb: 2.9, r: 0.4, ww: 0.26, clr: 0.24, noseY: 0.9, hoodY: 1.12, beltY: 1.18, roofY: 1.8, deckY: 1.2, tailY: 1.18, zWs: 0.7, zRoofF: 0.62, zRoofR: 0.06, zRw: 0.03, mass: 2100, power: 11000, maxSpeed: 50, grip: 0.95, drive: 'awd', seats: 2, engine: 'suv', class: 'car', rails: true },
  pickup: { name: 'Haulmark', L: 5.4, W: 2.0, H: 1.86, wb: 3.3, r: 0.41, ww: 0.27, clr: 0.26, noseY: 0.98, hoodY: 1.18, beltY: 1.2, roofY: 1.86, deckY: 1.16, tailY: 1.14, zWs: 0.74, zRoofF: 0.66, zRoofR: 0.45, zRw: 0.43, mass: 2200, power: 11500, maxSpeed: 50, grip: 0.9, drive: 'rwd', seats: 2, engine: 'suv', class: 'car', bed: true },
  van: { name: 'Pelican', box: true, L: 5.2, W: 2.0, H: 2.25, wb: 3.2, r: 0.38, ww: 0.24, clr: 0.2, mass: 2400, power: 9500, maxSpeed: 44, grip: 0.85, drive: 'rwd', seats: 2, engine: 'van', class: 'van', cabLen: 1.4 },
  bus: { name: 'Metro Liner', box: true, L: 11.5, W: 2.55, H: 3.1, wb: 6.2, r: 0.5, ww: 0.3, clr: 0.3, mass: 11000, power: 36000, maxSpeed: 30, grip: 0.8, drive: 'rwd', seats: 1, engine: 'bus', class: 'bus', livery: 'bus', cabLen: 0 },
  truck: { name: 'Box Hauler', box: true, L: 7.5, W: 2.4, H: 3.2, wb: 4.4, r: 0.48, ww: 0.3, clr: 0.3, mass: 6500, power: 24000, maxSpeed: 34, grip: 0.8, drive: 'rwd', seats: 2, engine: 'truck', class: 'truck', cabLen: 2.0, boxBody: true },
  swat: { name: 'Bulwark', box: true, L: 5.8, W: 2.3, H: 2.5, wb: 3.4, r: 0.45, ww: 0.3, clr: 0.28, mass: 4200, power: 16000, maxSpeed: 44, grip: 0.9, drive: 'awd', seats: 2, engine: 'truck', class: 'van', livery: 'swat', cabLen: 1.8, armored: true },
};
for (const [k, s] of Object.entries(VEHICLE_SPECS)) {
  if (s.base) { const b = VEHICLE_SPECS[s.base]; for (const key of Object.keys(b)) if (s[key] === undefined) s[key] = b[key]; }
  s.type = k;
  s.fo = s.fo ?? (s.L - s.wb) / 2 + (s.box ? 0.05 : 0.02);
  s.frontAxleZ = s.wb / 2; s.rearAxleZ = -s.wb / 2;
  s.track = s.W - s.ww - 0.12;
  s.comHeight = s.clr + (s.H - s.clr) * 0.35;
  s.seat = { x: s.box ? 0.5 : 0.36, y: s.box ? 0.9 : 0.36, z: s.box ? s.wb / 2 + 0.25 : -0.2 };
  s.halfExtents = [s.W / 2, s.H / 2, s.L / 2];
}
export const PAINT = [0xf2f2f2, 0x111214, 0xb8bdc2, 0x6c7178, 0x8b1a1a, 0x1c3f8a, 0x2f6b3e, 0xd9a520, 0xd35400, 0x117a8b, 0x5b2c6f, 0xe8e0c8, 0x7a1f2f, 0x2c3e50, 0xc0392b, 0x3b4a2f];

// ---------------------------------------------------------------- materials
const paintCache = new Map();
function paintMaterial(color, metallic = true) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: metallic ? 0.55 : 0.1, roughness: metallic ? 0.36 : 0.45, clearcoat: 1, clearcoatRoughness: 0.08 });
}
let GLASS, TRIM, BURNT, INTERIOR, PLATE_TEX;
function shared() {
  if (GLASS) return;
  GLASS = new THREE.MeshPhysicalMaterial({ color: 0x0c1116, metalness: 0.2, roughness: 0.04, transparent: true, opacity: 0.78, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3 });
  TRIM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
  TRIM.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aRM; varying vec2 vRM;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = aRM;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vRM;').replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;');
  };
  TRIM.customProgramCacheKey = () => 'vtrim';
  BURNT = new THREE.MeshStandardMaterial({ color: 0x1a1817, roughness: 0.95, metalness: 0.2 });
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#1b3a6b'; g.lineWidth = 6; g.strokeRect(4, 4, 248, 120);
  g.fillStyle = '#1b3a6b'; g.font = "bold 22px Arial"; g.textAlign = 'center'; g.fillText('SOL HARBOR', 128, 34);
  g.fillStyle = '#111'; g.font = "bold 54px 'Courier New', monospace"; g.fillText('SH 4K21', 128, 100);
  PLATE_TEX = new THREE.CanvasTexture(c); PLATE_TEX.colorSpace = THREE.SRGBColorSpace;
}
function lightsMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.1 });
  const U = m.userData.uniforms = { uL: { value: new Float32Array(10) } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uL = U.uL;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLG; flat varying float vLG;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLG = aLG;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uL[10]; flat varying float vLG;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += vColor.rgb * uL[int(vLG + 0.5)] * 6.0;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.35;');
  };
  m.customProgramCacheKey = () => 'vlights';
  return m;
}
// light groups
export const LG = { HEAD: 0, TAIL: 1, BRAKE: 2, REVERSE: 3, IND_L: 4, IND_R: 5, SIREN_R: 6, SIREN_B: 7, TAXI: 8, DRL: 9 };

// ---------------------------------------------------------------- geometry helpers
class GB { // generic geometry buffer with vertex colors, rough/metal, light group
  constructor() { this.p = []; this.n = []; this.c = []; this.rm = []; this.lg = []; this.uv = []; }
  addGeo(geo, m, color = 0xffffff, rough = 0.5, metal = 0, lg = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone(); if (m) g.applyMatrix4(m);
    const col = new THREE.Color(color), P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    for (let i = 0; i < P.count; i++) { this.p.push(P.getX(i), P.getY(i), P.getZ(i)); this.n.push(N.getX(i), N.getY(i), N.getZ(i)); this.c.push(col.r, col.g, col.b); this.rm.push(rough, metal); this.lg.push(lg); this.uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0); }
    return this;
  }
  box(w, h, d, x, y, z, color, rough, metal, lg, ry = 0, rx = 0, rz = 0) { return this.addGeo(new THREE.BoxGeometry(w, h, d), mtx(x, y, z, ry, rx, rz), color, rough, metal, lg); }
  cyl(rt, rb, h, seg, x, y, z, color, rough, metal, lg, ry = 0, rx = 0, rz = 0) { return this.addGeo(new THREE.CylinderGeometry(rt, rb, h, seg), mtx(x, y, z, ry, rx, rz), color, rough, metal, lg); }
  tris(pos, color, rough = 0.5, metal = 0) { // raw triangle positions, compute flat normals
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    return this.addGeo(g, null, color, rough, metal);
  }
  build(withRM = true, withLG = false, withUV = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (withRM) g.setAttribute('aRM', new THREE.Float32BufferAttribute(this.rm, 2));
    if (withLG) g.setAttribute('aLG', new THREE.Float32BufferAttribute(this.lg, 1));
    if (withUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}
const _e = new THREE.Euler(), _q = new THREE.Quaternion();
function mtx(x, y, z, ry = 0, rx = 0, rz = 0, s = 1) { _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(s, s, s)); }

/** Loft: stations [{z, yb, yt, hwb, hwt, rb, rt}] -> indexed geometry with smooth normals. */
function loft(stations, M = 9, capFront = true, capRear = true) {
  const pos = [], idx = [];
  const ring = [];
  for (const s of stations) {
    const pts = [];
    // half section from bottom center (x=0,yb) around the left side (x>0) to top center (x=0,yt)
    const h = s.yt - s.yb, rb = Math.min(s.rb ?? 0.1, h * 0.45, s.hwb * 0.9), rt = Math.min(s.rt ?? 0.15, h * 0.5, s.hwt * 0.9);
    const add = (x, y) => pts.push([x, y]);
    add(0, s.yb);
    add(s.hwb - rb, s.yb);
    for (let i = 1; i <= 3; i++) { const a = -Math.PI / 2 + i / 3 * Math.PI / 2; add(s.hwb - rb + Math.cos(a) * rb, s.yb + rb + Math.sin(a) * rb); }
    const nmid = M;
    for (let i = 1; i < nmid; i++) { const t = i / nmid; const bulge = Math.sin(t * Math.PI) * (s.bulge ?? 0.03); add(lerp(s.hwb, s.hwt, t) + bulge, lerp(s.yb + rb, s.yt - rt, t)); }
    for (let i = 0; i <= 3; i++) { const a = i / 3 * Math.PI / 2; add(s.hwt - rt + Math.cos(a) * rt, s.yt - rt + Math.sin(a) * rt); }
    add(0, s.yt + (s.crown ?? 0.02));
    // full ring: mirror to right side (x negative), ordered: right-bottom-center ... around
    const full = [];
    for (let i = pts.length - 1; i >= 0; i--) full.push([-pts[i][0], pts[i][1]]);
    for (let i = 1; i < pts.length - 1; i++) full.push([pts[i][0], pts[i][1]]);
    ring.push(full.map(([x, y]) => [x, y, s.z]));
  }
  const n = ring[0].length;
  for (const r of ring) for (const p of r) pos.push(p[0], p[1], p[2]);
  for (let s = 0; s < ring.length - 1; s++) for (let i = 0; i < n; i++) {
    const a = s * n + i, b = s * n + (i + 1) % n, c = (s + 1) * n + i, d = (s + 1) * n + (i + 1) % n;
    idx.push(a, b, c, b, d, c);
  }
  const addCap = (sIdx, flip) => {
    const base = pos.length / 3, r = ring[sIdx];
    let cx = 0, cy = 0; for (const p of r) { cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
    pos.push(cx, cy, r[0][2]);
    for (let i = 0; i < n; i++) { const a = sIdx * n + i, b = sIdx * n + (i + 1) % n; if (flip) idx.push(base, b, a); else idx.push(base, a, b); }
  };
  if (capRear) addCap(0, false);
  if (capFront) addCap(ring.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- car body
function carStations(S) {
  const L = S.L, zr = -L / 2 - (S.fo - (L - S.wb) / 2) + 0, z0 = -L / 2, z1 = L / 2;
  const at = (f) => z0 + f * L;
  const fz = S.wb / 2, rz = -S.wb / 2, R = S.r;
  const wheelY = R;
  const hw = S.W / 2;
  const plan = (z) => { const t = Math.abs(z) / (L / 2); return hw * Math.pow(1 - Math.pow(t, 6), 1 / 6) * (z > 0 ? 1 - 0.04 * t : 1 - 0.02 * t); };
  const top = (z) => {
    const f = (z - z0) / L;
    if (f >= S.zWs) { const t = (f - S.zWs) / (1 - S.zWs); return lerp(S.hoodY, S.noseY, Math.pow(t, 1.7)); }
    if (f <= S.zRw) { const t = f / Math.max(S.zRw, 0.01); return lerp(S.tailY, S.deckY, Math.pow(t, 0.5)); }
    const t = (f - S.zRw) / (S.zWs - S.zRw);
    return lerp(S.deckY, S.hoodY, t) * 0 + S.beltY + (t > 0.9 ? (S.hoodY - S.beltY) * (t - 0.9) / 0.1 : 0) + (t < 0.1 ? (S.deckY - S.beltY) * (0.1 - t) / 0.1 : 0);
  };
  const bottom = (z) => {
    let y = S.clr;
    for (const wz of [fz, rz]) {
      const d = Math.abs(z - wz), ar = R * 1.12;
      if (d < ar) y = Math.max(y, wheelY + Math.sqrt(ar * ar - d * d) * 0.98);
    }
    const t = Math.abs(z) / (L / 2);
    return y + (t > 0.85 ? (t - 0.85) * 1.2 : 0);
  };
  const zs = [];
  const N = 44;
  for (let i = 0; i <= N; i++) zs.push(z0 + L * (i / N));
  for (const wz of [fz, rz]) for (let k = -6; k <= 6; k++) zs.push(wz + k * R * 0.19);
  zs.sort((a, b) => a - b);
  const st = [];
  let last = -1e9;
  for (const z of zs) {
    if (z - last < 0.02) continue; last = z;
    const zz = clamp(z, z0 + 0.001, z1 - 0.001);
    const w = Math.max(0.2, plan(zz));
    const yt = top(zz), yb = Math.min(bottom(zz), yt - 0.12);
    st.push({ z: zz, yb, yt, hwb: w * 0.97, hwt: w * (S.wedge ? 0.9 : 0.93), rb: 0.1, rt: 0.16, bulge: 0.025 });
  }
  return st;
}
function greenhouse(S, inset = 0) {
  const L = S.L, z0 = -L / 2;
  const at = (f) => z0 + f * L;
  const zA = at(S.zRw), zB = at(S.zRoofR), zC = at(S.zRoofF), zD = at(S.zWs);
  const hwB = S.W / 2 * 0.9 - inset, hwT = S.W / 2 * 0.72 - inset;
  const st = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const z = lerp(zA, zD, i / N);
    let y;
    if (z < zB) y = lerp(S.beltY + 0.02, S.roofY, Math.pow((z - zA) / Math.max(zB - zA, 0.01), 0.7));
    else if (z > zC) y = lerp(S.roofY, S.beltY + 0.02, Math.pow((z - zC) / Math.max(zD - zC, 0.01), 1.1));
    else y = S.roofY + Math.sin((z - zB) / (zC - zB) * Math.PI) * 0.015;
    const yt = Math.max(y - inset, S.beltY + 0.06);
    st.push({ z, yb: S.beltY - 0.02, yt, hwb: hwB, hwt: Math.max(hwT * (0.6 + 0.4 * (yt - S.beltY) / (S.roofY - S.beltY)), 0.3), rb: 0.02, rt: 0.12, bulge: 0.01, crown: 0.01 });
  }
  return st;
}

// ---------------------------------------------------------------- build
const GEO_CACHE = {};
let PLATE_GEO = null;
export function buildVehicle(type, { color, seed = 1, metallic } = {}) {
  shared();
  const S = VEHICLE_SPECS[type];
  const rng = makeRng(seed);
  const col = color ?? (S.livery === 'police' ? 0x111214 : S.livery === 'taxi' ? 0xf2b705 : S.livery === 'swat' ? 0x1c1f24 : S.livery === 'bus' ? 0xf4f4f4 : rng.pick(PAINT));
  const paint = paintMaterial(col, metallic ?? rng.chance(0.6));
  const lightsMat = lightsMaterial();
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  let paintGeo, glassGeo, trimGeo, lightGeo;
  const cached = GEO_CACHE[type];
  if (cached) ({ paintGeo, glassGeo, trimGeo, lightGeo } = cached);
  else {
  const trim = new GB(), lights = new GB();
  const hw = S.W / 2;
  if (!S.box) {
    paintGeo = loft(carStations(S), 7);
    glassGeo = loft(greenhouse(S), 5, true, true);
    // roof panel (painted) over the glass, pillars
    const roofSt = greenhouse(S).filter(s => s.yt >= S.roofY - 0.04);
    if (roofSt.length > 1) {
      const rp = roofSt.map(s => ({ ...s, yb: s.yt - 0.05, yt: s.yt + 0.012, hwb: s.hwt + 0.01, hwt: s.hwt + 0.005, rb: 0.02, rt: 0.08 }));
      paintGeo = mergeIndexed([paintGeo, loft(rp, 3)]);
    }
    const gh = greenhouse(S);
    // pillars: A (front), B (middle), C (rear) as thin strips following greenhouse sections
    const pillar = (st, w) => { for (const side of [1, -1]) { for (let i = 0; i < st.length - 1; i++) { /* approximate with boxes */ } } };
    const zs = [gh[0], gh[Math.floor(gh.length * 0.5)], gh[gh.length - 1]];
    const L = S.L, z0 = -L / 2;
    const addPillar = (za, ya, zb, yb, hwA, hwB2, thick) => {
      for (const side of [1, -1]) {
        const a = new THREE.Vector3(side * hwA, ya, za), b = new THREE.Vector3(side * hwB2, yb, zb);
        const d = new THREE.Vector3().subVectors(b, a), len = d.length();
        const g = new THREE.BoxGeometry(thick, len, 0.09);
        const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1));
        paintGeo = mergeIndexed([paintGeo, g.applyMatrix4(m)]);
      }
    };
    const f2z = (f) => z0 + f * L;
    const gA = gh[gh.length - 1], gC = gh[0];
    const roofF = gh.reduce((b, s) => (s.yt >= S.roofY - 0.03 && s.z > b.z ? s : b), gh[0]);
    const roofR = gh.reduce((b, s) => (s.yt >= S.roofY - 0.03 && s.z < b.z ? s : b), gh[gh.length - 1]);
    addPillar(gA.z, S.beltY, roofF.z, S.roofY - 0.02, gA.hwb, roofF.hwt + 0.02, 0.07);
    addPillar(gC.z + 0.02, S.beltY, roofR.z, S.roofY - 0.02, gC.hwb, roofR.hwt + 0.02, 0.1);
    const bz = (roofF.z + roofR.z) / 2 - 0.1;
    addPillar(bz, S.beltY, bz - 0.04, S.roofY - 0.03, hw * 0.9, hw * 0.74, 0.08);
    // details
    const fz = S.L / 2, rz = -S.L / 2;
    // grille & lower intake
    trim.box(S.W * 0.42, 0.13, 0.05, 0, S.noseY - 0.12, fz - 0.03, 0x121314, 0.5, 0.4);
    trim.box(S.W * 0.6, 0.11, 0.06, 0, S.clr + 0.18, fz - 0.06, 0x0e0f10, 0.7, 0.1);
    trim.box(S.W * 0.44, 0.02, 0.055, 0, S.noseY - 0.05, fz - 0.025, 0xc8ccd0, 0.2, 1.0);
    // rear diffuser/bumper
    trim.box(S.W * 0.8, 0.14, 0.06, 0, S.clr + 0.16, rz + 0.04, 0x141516, 0.7, 0.1);
    // plates
    // mirrors
    for (const s of [1, -1]) {
      trim.box(0.16, 0.1, 0.1, s * (hw * 0.9 + 0.06), S.beltY + 0.08, gA.z - 0.12, col, 0.4, 0.5);
      trim.box(0.12, 0.08, 0.02, s * (hw * 0.9 + 0.07), S.beltY + 0.08, gA.z - 0.175, 0x8fa3b0, 0.05, 1.0);
      // door handles and seam lines
      trim.box(0.02, 0.03, 0.14, s * (hw * 0.985), S.beltY - 0.1, bz + 0.35, 0xb0b4b8, 0.3, 0.9);
      trim.box(0.012, S.beltY - S.clr - 0.25, 0.012, s * (hw * 0.99), (S.beltY + S.clr) / 2 + 0.05, bz + 0.02, 0x0a0a0a, 0.8, 0);
      trim.box(0.012, S.beltY - S.clr - 0.3, 0.012, s * (hw * 0.985), (S.beltY + S.clr) / 2 + 0.07, gA.z + 0.02, 0x0a0a0a, 0.8, 0);
      // side skirts
      trim.box(0.05, 0.08, S.wb - S.r * 2.4, s * (hw * 0.96), S.clr + 0.04, 0, 0x151617, 0.7, 0.1);
    }
    // lights (placed on the body surface using the plan-view width at that station)
    const planW = (z) => { const t = Math.min(0.999, Math.abs(z) / (S.L / 2)); return hw * Math.pow(1 - Math.pow(t, 6), 1 / 6) * 0.97; };
    const zh = fz - 0.16, zt = rz + 0.07;
    const xh = Math.min(hw * 0.66, planW(zh) - 0.2), xt = Math.min(hw * 0.66, planW(zt) - 0.22);
    for (const s of [1, -1]) {
      lights.box(0.32, 0.085, 0.2, s * xh, S.noseY + 0.0, zh, 0xfdf6e3, 0.1, 0.2, LG.HEAD, s * 0.3);
      lights.box(0.22, 0.025, 0.16, s * (xh - 0.02), S.noseY - 0.07, zh + 0.02, 0xffffff, 0.1, 0.2, LG.DRL, s * 0.3);
      lights.box(0.08, 0.05, 0.14, s * (xh + 0.14), S.noseY - 0.04, zh - 0.08, 0xffa200, 0.2, 0.2, s > 0 ? LG.IND_L : LG.IND_R, s * 0.6);
      lights.box(0.36, 0.085, 0.14, s * xt, S.tailY - 0.08, zt, 0xd4150f, 0.1, 0.2, LG.TAIL, -s * 0.2);
      lights.box(0.2, 0.05, 0.14, s * xt, S.tailY - 0.15, zt + 0.005, 0xff2222, 0.1, 0.2, LG.BRAKE, -s * 0.2);
      lights.box(0.1, 0.05, 0.14, s * (xt - 0.22), S.tailY - 0.15, zt + 0.01, 0xffffff, 0.1, 0.2, LG.REVERSE);
      lights.box(0.08, 0.05, 0.14, s * (xt + 0.12), S.tailY - 0.15, zt - 0.01, 0xffa200, 0.2, 0.2, s > 0 ? LG.IND_L : LG.IND_R);
    }
    // underbody closes the see-through wheel-arch tunnel
    trim.box(S.track - S.ww - 0.12, S.r * 1.2, S.L * 0.92, 0, S.clr + S.r * 0.6, 0, 0x0b0b0c, 0.9, 0);
    if (S.spoiler) { trim.box(S.W * 0.8, 0.04, 0.3, 0, S.deckY + 0.2, rz + 0.25, col, 0.4, 0.4); for (const s of [1, -1]) trim.box(0.04, 0.2, 0.12, s * S.W * 0.3, S.deckY + 0.1, rz + 0.25, 0x151617, 0.6, 0.2); }
    if (S.scoop) trim.box(0.5, 0.08, 0.6, 0, S.hoodY + 0.02, fz - 0.95, 0x151617, 0.6, 0.2);
    if (S.rails) for (const s of [1, -1]) trim.box(0.05, 0.05, (roofF.z - roofR.z) * 0.9, s * hw * 0.62, S.roofY + 0.05, (roofF.z + roofR.z) / 2, 0x2b2d30, 0.4, 0.6);
    if (S.bed) { // pickup bed walls
      const zA2 = -S.L / 2 + 0.05, zB2 = f2z(S.zRw) - 0.05;
      for (const s of [1, -1]) paintGeo = mergeIndexed([paintGeo, new THREE.BoxGeometry(0.06, 0.4, zB2 - zA2).translate(s * (hw - 0.06), S.deckY + 0.18, (zA2 + zB2) / 2)]);
      paintGeo = mergeIndexed([paintGeo, new THREE.BoxGeometry(S.W - 0.1, 0.4, 0.06).translate(0, S.deckY + 0.18, zA2 + 0.03)]);
      trim.box(S.W - 0.2, 0.02, zB2 - zA2 - 0.1, 0, S.deckY - 0.01, (zA2 + zB2) / 2, 0x1c1c1c, 0.8, 0);
    }
    // interior: seats + dash + wheel
    const sz = S.seat.z;
    for (const s of [1, -1]) { trim.box(0.5, 0.12, 0.5, s * 0.36, S.clr + 0.28, sz, 0x1b1b1d, 0.8, 0); trim.box(0.5, 0.62, 0.12, s * 0.36, S.clr + 0.6, sz - 0.28, 0x1b1b1d, 0.8, 0, 0, -0.15); }
    trim.box(S.W * 0.82, 0.18, 0.4, 0, S.beltY - 0.05, gA.z - 0.3, 0x141416, 0.7, 0);
    trim.addGeo(new THREE.TorusGeometry(0.17, 0.025, 6, 16), mtx(0.36, S.beltY + 0.02, gA.z - 0.55, 0, -0.35), 0x111111, 0.6, 0);
  } else {
    // box vehicles: cab + body
    const L = S.L, H = S.H, z0 = -L / 2, z1 = L / 2;
    const st = [];
    const cabF = z1, nose = S.cabLen ? 0.35 : 0.1;
    const N = 20;
    for (let i = 0; i <= N; i++) {
      const z = lerp(z0 + 0.001, z1 - 0.001, i / N);
      let yt = H;
      if (S.cabLen && S.boxBody) yt = z > z1 - S.cabLen ? H * 0.78 : H;
      const tf = (z - (z1 - nose)) / nose; if (tf > 0) yt = lerp(yt, yt - 0.4, tf * tf);
      let yb = S.clr;
      for (const wz of [S.wb / 2, -S.wb / 2]) { const d = Math.abs(z - wz), ar = S.r * 1.12; if (d < ar) yb = Math.max(yb, S.r + Math.sqrt(ar * ar - d * d) * 0.98); }
      st.push({ z, yb, yt, hwb: hw * 0.98, hwt: hw * 0.96, rb: 0.06, rt: 0.12, bulge: 0.01 });
    }
    paintGeo = loft(st, 4);
    // windows: glass boxes
    const gpos = [];
    const glassBoxes = [];
    if (S.type === 'bus') {
      for (const s of [1, -1]) glassBoxes.push([0.02, 1.0, L - 1.6, s * (hw + 0.005), H - 0.95, 0.2]);
      glassBoxes.push([S.W - 0.2, 1.3, 0.02, 0, H - 1.05, z1 + 0.005]);
    } else {
      const cz = z1 - (S.cabLen || 1.4) * 0.55, wy = (S.boxBody ? H * 0.78 : H) - 0.55;
      for (const s of [1, -1]) glassBoxes.push([0.02, 0.62, (S.cabLen || 1.4) * 0.7, s * (hw + 0.005), wy, cz]);
      glassBoxes.push([S.W - 0.3, 0.72, 0.02, 0, wy + 0.02, z1 - 0.08]);
      if (S.type === 'van') for (const s of [1, -1]) glassBoxes.push([0.02, 0.55, 1.2, s * (hw + 0.005), wy, cz - 1.6]);
    }
    glassGeo = mergeIndexed(glassBoxes.map(b => new THREE.BoxGeometry(b[0], b[1], b[2]).translate(b[3], b[4], b[5])));
    trim.box(S.W * 0.96, 0.3, 0.12, 0, S.clr + 0.2, z1 + 0.02, 0x1a1a1a, 0.7, 0.1);
    trim.box(S.W * 0.96, 0.3, 0.12, 0, S.clr + 0.2, z0 - 0.02, 0x1a1a1a, 0.7, 0.1);
    for (const s of [1, -1]) {
      lights.box(0.3, 0.15, 0.06, s * (hw * 0.72), S.clr + 0.55, z1 + 0.01, 0xfdf6e3, 0.1, 0.2, LG.HEAD);
      lights.box(0.1, 0.1, 0.06, s * (hw * 0.92), S.clr + 0.55, z1 + 0.01, 0xffa200, 0.2, 0.2, s > 0 ? LG.IND_L : LG.IND_R);
      lights.box(0.2, 0.3, 0.06, s * (hw * 0.86), S.clr + 0.6, z0 - 0.01, 0xd4150f, 0.1, 0.2, LG.TAIL);
      lights.box(0.2, 0.12, 0.065, s * (hw * 0.86), S.clr + 0.35, z0 - 0.015, 0xff2222, 0.1, 0.2, LG.BRAKE);
      trim.box(0.18, 0.12, 0.1, s * (hw + 0.1), H * 0.62, z1 - 0.3, 0x1a1a1a, 0.5, 0.3);
    }
    if (S.type === 'bus') { trim.box(S.W * 0.7, 0.28, 0.04, 0, H - 0.25, z1 + 0.01, 0x111111, 0.4, 0.2); lights.box(S.W * 0.6, 0.18, 0.02, 0, H - 0.25, z1 + 0.03, 0xffb000, 0.3, 0, LG.DRL); }
    if (S.armored) { for (const s of [1, -1]) trim.box(0.05, 0.9, L * 0.6, s * (hw + 0.03), S.clr + 0.8, -0.3, 0x2a2d31, 0.6, 0.5); trim.box(S.W * 1.02, 0.25, 0.25, 0, S.clr + 0.35, z1 + 0.12, 0x2a2d31, 0.6, 0.5); }
    for (const s of [1, -1]) trim.box(0.45, 0.1, 0.45, s * 0.45, S.seat.y - 0.1, S.seat.z, 0x1b1b1d, 0.8, 0);
    trim.box(S.track - S.ww - 0.12, S.r * 1.3, S.L * 0.94, 0, S.clr + S.r * 0.65, 0, 0x0b0b0c, 0.9, 0);
  }
  // liveries
  if (S.livery === 'police') {
    // white doors + roof lightbar
    for (const s of [1, -1]) trim.box(0.015, 0.36, 1.7, s * (hw * 1.0), S.beltY - 0.25, -0.05, 0xf4f4f4, 0.3, 0.1);
    trim.box(0.9, 0.08, 0.28, 0, S.roofY + 0.05, 0.05, 0x1a1a1a, 0.5, 0.3);
    lights.box(0.4, 0.1, 0.24, 0.23, S.roofY + 0.12, 0.05, 0xff2020, 0.2, 0.1, LG.SIREN_R);
    lights.box(0.4, 0.1, 0.24, -0.23, S.roofY + 0.12, 0.05, 0x2050ff, 0.2, 0.1, LG.SIREN_B);
    for (const s of [1, -1]) trim.box(0.06, 0.4, 0.06, s * 0.28, S.noseY - 0.12, S.L / 2 + 0.07, 0x151515, 0.6, 0.4); // push bar
    trim.box(0.7, 0.05, 0.06, 0, S.noseY + 0.02, S.L / 2 + 0.07, 0x151515, 0.6, 0.4); trim.box(0.7, 0.05, 0.06, 0, S.noseY - 0.24, S.L / 2 + 0.07, 0x151515, 0.6, 0.4);
    lights.box(0.12, 0.04, 0.03, 0.12, S.noseY - 0.1, S.L / 2 + 0.06, 0xff2020, 0.2, 0.1, LG.SIREN_R);
    lights.box(0.12, 0.04, 0.03, -0.12, S.noseY - 0.1, S.L / 2 + 0.06, 0x2050ff, 0.2, 0.1, LG.SIREN_B);
  }
  if (S.livery === 'swat') { lights.box(0.5, 0.1, 0.25, 0.3, S.H + 0.06, S.L / 2 - 0.6, 0xff2020, 0.2, 0.1, LG.SIREN_R); lights.box(0.5, 0.1, 0.25, -0.3, S.H + 0.06, S.L / 2 - 0.6, 0x2050ff, 0.2, 0.1, LG.SIREN_B); }
  if (S.livery === 'taxi') { trim.box(0.55, 0.16, 0.2, 0, S.roofY + 0.09, 0, 0x151515, 0.5, 0.2); lights.box(0.5, 0.12, 0.16, 0, S.roofY + 0.1, 0, 0xfff1b8, 0.2, 0, LG.TAXI); for (const s of [1, -1]) trim.box(0.012, 0.08, 3.0, s * hw * 1.0, S.beltY - 0.12, 0, 0x111111, 0.5, 0.1); }
  if (S.livery === 'bus') { for (const s of [1, -1]) { trim.box(0.012, 0.35, S.L - 0.8, s * (hw + 0.01), S.clr + 0.8, 0, 0xd35400, 0.4, 0.1); trim.box(0.012, 0.1, S.L - 0.8, s * (hw + 0.01), S.clr + 1.05, 0, 0x117a8b, 0.4, 0.1); } }
  trimGeo = trim.build(true, false); lightGeo = lights.build(false, true);
  GEO_CACHE[type] = { paintGeo, glassGeo, trimGeo, lightGeo };
  }
  // plates
  const plateGeo = PLATE_GEO || (PLATE_GEO = new THREE.PlaneGeometry(0.52, 0.12));
  const plateMat = new THREE.MeshStandardMaterial({ map: PLATE_TEX, roughness: 0.4, metalness: 0.3 });
  // meshes
  const paintMesh = new THREE.Mesh(paintGeo, paint); paintMesh.castShadow = true; paintMesh.receiveShadow = true;
  const glassMesh = new THREE.Mesh(glassGeo, GLASS); glassMesh.castShadow = false; glassMesh.renderOrder = 3;
  const trimMesh = new THREE.Mesh(trimGeo, TRIM); trimMesh.castShadow = true; trimMesh.receiveShadow = true;
  const lightMesh = new THREE.Mesh(lightGeo, lightsMat);
  body.add(paintMesh, glassMesh, trimMesh, lightMesh);
  const zf = S.L / 2 + (S.box ? 0.03 : 0.005), zb = -S.L / 2 - 0.005;
  const pf = new THREE.Mesh(plateGeo, plateMat); pf.position.set(0, S.clr + 0.3, zf + 0.01); body.add(pf);
  const pr = new THREE.Mesh(plateGeo, plateMat); pr.position.set(0, S.box ? S.clr + 0.5 : S.tailY - 0.3, zb); pr.rotation.y = Math.PI; body.add(pr);
  // wheels
  const wheels = [];
  for (const [z, front] of [[S.frontAxleZ, true], [S.rearAxleZ, false]]) for (const left of [true, false]) {
    wheels.push({ x: (left ? 1 : -1) * S.track / 2, y: S.r, z, r: S.r, w: S.ww, front, left, style: S.class === 'car' ? (S.type === 'sports' || S.type === 'super' ? 1 : S.type === 'police' || S.type === 'taxi' ? 2 : 0) : 3, spin: 0, steer: 0, compress: 0 });
  }
  // --- API
  const L = lightsMat.userData.uniforms.uL.value;
  let burnt = false;
  const model = {
    type, spec: S, root, body, wheels, paint, color: col, paintMesh, glassMesh, trimMesh, lightMesh,
    setLights(o) {
      if (burnt) { L.fill(0); return; }
      const night = o.night ?? 0;
      L[LG.HEAD] = o.head ? 1.3 : 0; L[LG.DRL] = 0.5 + (o.head ? 0.4 : 0); L[LG.TAIL] = o.head ? 0.35 : 0.08; L[LG.BRAKE] = o.brake ? 1 : 0; L[LG.REVERSE] = o.reverse ? 0.8 : 0;
      const blink = (o.time ?? 0) % 0.8 < 0.4;
      L[LG.IND_L] = (o.indL || o.hazard) && blink ? 1 : 0; L[LG.IND_R] = (o.indR || o.hazard) && blink ? 1 : 0;
      if (o.siren !== undefined && o.siren !== false) {
        const t = o.siren % 1;
        L[LG.SIREN_R] = (t < 0.25 || (t > 0.5 && t < 0.62)) ? 2.2 : 0.05; L[LG.SIREN_B] = (t > 0.25 && t < 0.5) || t > 0.75 ? 2.2 : 0.05;
      } else { L[LG.SIREN_R] = 0.03; L[LG.SIREN_B] = 0.03; }
      L[LG.TAXI] = o.taxi ? 1 : 0.1;
    },
    setDamage(d) { paint.roughness = lerp(0.36, 0.75, d); paint.clearcoat = lerp(1, 0.2, d); },
    dent(lp, strength = 0.1) {
      const g = paintMesh.geometry;
      if (!g.userData.cloned) { paintMesh.geometry = g.clone(); paintMesh.geometry.userData.cloned = true; }
      const pos = paintMesh.geometry.attributes.position, rad = 0.9;
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - lp.x, dy = pos.getY(i) - lp.y, dz = pos.getZ(i) - lp.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < rad) { const f = (1 - d / rad) * strength; pos.setXYZ(i, pos.getX(i) - Math.sign(pos.getX(i) - 0) * f * 0.4 * (Math.abs(lp.x) > S.W * 0.35 ? 1 : 0.3), pos.getY(i) - f * 0.25, pos.getZ(i) - Math.sign(lp.z) * f * (Math.abs(lp.z) > S.L * 0.35 ? 1 : 0.2)); }
      }
      pos.needsUpdate = true; paintMesh.geometry.computeVertexNormals();
    },
    setBurnt(b) { burnt = b; paintMesh.material = b ? BURNT : paint; glassMesh.visible = !b; if (b) L.fill(0); },
    setPaint(c) { paint.color.set(c); model.color = c; },
    dispose() { paint.dispose(); lightsMat.dispose(); plateMat.dispose(); if (paintMesh.geometry.userData.cloned) paintMesh.geometry.dispose(); },
  };
  model.setLights({});
  return model;
}
function mergeIndexed(list) {
  const geos = list.map(g => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (const g of geos) { if (!g.attributes.normal) g.computeVertexNormals(); pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const r = new THREE.BufferGeometry(); r.setAttribute('position', new THREE.BufferAttribute(pos, 3)); r.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); r.computeBoundingSphere();
  return r;
}

// ---------------------------------------------------------------- wheels (instanced for all vehicles)
function tireGeometry() {
  // unit tire: radius 1, width 1, axis along X
  const prof = [];
  const n = 8;
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + i / n * Math.PI; prof.push(new THREE.Vector2(0.78 + Math.cos(a) * 0.22, Math.sin(a) * 0.46)); }
  prof.unshift(new THREE.Vector2(0.72, -0.44)); prof.push(new THREE.Vector2(0.72, 0.44));
  const g = new THREE.LatheGeometry(prof, 24); g.rotateZ(Math.PI / 2); g.computeVertexNormals();
  return g;
}
function rimGeometry(style) {
  const parts = [];
  const disc = new THREE.CylinderGeometry(0.72, 0.72, 0.1, 24, 1); disc.rotateZ(Math.PI / 2); disc.translate(0.3, 0, 0);
  parts.push(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 12).rotateZ(Math.PI / 2).translate(0.32, 0, 0));
  const spokes = style === 1 ? 10 : style === 2 ? 6 : style === 3 ? 8 : 5;
  for (let i = 0; i < spokes; i++) {
    const a = i / spokes * Math.PI * 2;
    const s = new THREE.BoxGeometry(0.08, style === 1 ? 0.07 : 0.14, 0.62); s.translate(0.34, 0, 0.36); s.rotateX(a);
    parts.push(s);
  }
  const ring = new THREE.TorusGeometry(0.69, 0.05, 6, 24); ring.rotateY(Math.PI / 2); ring.translate(0.32, 0, 0);
  parts.push(ring);
  const back = new THREE.CylinderGeometry(0.62, 0.62, 0.05, 20); back.rotateZ(Math.PI / 2); back.translate(-0.05, 0, 0);
  parts.push(back);
  return mergeIndexed(parts);
}
export class WheelRenderer {
  constructor(scene, max = 256) {
    this.tire = new THREE.InstancedMesh(tireGeometry(), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85, metalness: 0 }), max);
    this.rims = [0, 1, 2, 3].map(s => new THREE.InstancedMesh(rimGeometry(s), new THREE.MeshStandardMaterial({ color: s === 2 ? 0x2a2a2a : s === 3 ? 0x777777 : 0xc9ccd0, roughness: 0.28, metalness: 0.95 }), max));
    for (const m of [this.tire, ...this.rims]) { m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.count = 0; scene.add(m); }
    this._m = new THREE.Matrix4(); this._s = new THREE.Matrix4();
  }
  begin() { this.tire.count = 0; for (const r of this.rims) r.count = 0; }
  /** matrix: wheel hub world matrix (axis along local X, left wheels mirrored by the caller via scale -1 on X) */
  push(matrix, radius, width, style, mirror) {
    this._s.makeScale(width * (mirror ? -1 : 1), radius, radius);
    this._m.multiplyMatrices(matrix, this._s);
    if (this.tire.count < this.tire.instanceMatrix.count) { this.tire.setMatrixAt(this.tire.count++, this._m); }
    const r = this.rims[style] || this.rims[0];
    if (r.count < r.instanceMatrix.count) r.setMatrixAt(r.count++, this._m);
  }
  end() { this.tire.instanceMatrix.needsUpdate = true; for (const r of this.rims) r.instanceMatrix.needsUpdate = true; }
}
