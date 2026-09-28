// Street furniture & structures: procedural models, instanced rendering with distance culling,
// traffic-light bulbs driven by signal state, lamp light pools at night, power line wires.
//   const props = new PropSystem(scene, city, textures, facadeMat, quality)
//   props.update(dt, { time, night, camera }) ; props.breakProp(i) -> {kind, matrix} | null
import * as THREE from 'three';
import { signalState } from './roads.js';
import { FACADES } from './citygen.js';
import { buildVegetationModels } from './vegetation.js';

// ---------------------------------------------------------------- builder
export class PB {
  constructor() { this.parts = []; }
  add(geo, m, color, rough = 0.6, metal = 0, emit = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3), rm = new Float32Array(n * 3);
    const col = new THREE.Color(color);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; rm[i * 3] = rough; rm[i * 3 + 1] = metal; rm[i * 3 + 2] = emit; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setAttribute('aRM', new THREE.BufferAttribute(rm, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    this.parts.push(g);
    return this;
  }
  box(w, h, d, x, y, z, color, rough, metal, emit, ry = 0, rx = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), M(x, y, z, ry, rx, rz), color, rough, metal, emit);
  }
  cyl(rt, rb, h, seg, x, y, z, color, rough, metal, emit, ry = 0, rx = 0, rz = 0, open = false) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), M(x, y, z, ry, rx, rz), color, rough, metal, emit);
  }
  sphere(r, x, y, z, color, rough, metal, emit, ws = 10, hs = 8, sx = 1, sy = 1, sz = 1) {
    return this.add(new THREE.SphereGeometry(r, ws, hs), M(x, y, z, 0, 0, 0, sx, sy, sz), color, rough, metal, emit);
  }
  build() {
    const pos = [], nor = [], col = [], rm = [], uv = [];
    for (const g of this.parts) {
      pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
      col.push(...g.attributes.color.array); rm.push(...g.attributes.aRM.array); uv.push(...g.attributes.uv.array);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aRM', new THREE.Float32BufferAttribute(rm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export function M(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

/** Shared material for vertex-colored props: aRM = (roughness, metalness, emissive strength). */
export function createPropMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const U = m.userData.uniforms = { uNight: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRM; varying vec3 vRM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = aRM;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRM; uniform float uNight;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += vColor.rgb * vRM.z * (0.06 + uNight * 5.0);');
  };
  m.customProgramCacheKey = () => 'prop-v1';
  return m;
}

// ---------------------------------------------------------------- models
const METAL_DARK = 0x3a3d40, METAL = 0x8c9196, WOOD = 0x8a6a4a, CONC = 0xb8b3aa;
const LAMP_LIGHT = 0xffc88a;
function lampModel(v) {
  const b = new PB();
  if (v === 1) { // decorative seafront lamp
    b.cyl(0.07, 0.11, 4.4, 10, 0, 2.2, 0, 0x25302c, 0.5, 0.6).cyl(0.16, 0.16, 0.3, 10, 0, 0.15, 0, 0x25302c, 0.5, 0.6);
    b.cyl(0.03, 0.03, 1.2, 6, 0, 4.4, 0, 0x25302c, 0.5, 0.6, 0, 0, 0, Math.PI / 2);
    for (const s of [-1, 1]) { b.sphere(0.24, s * 0.62, 4.25, 0, LAMP_LIGHT, 0.2, 0, 1.1); b.cyl(0.12, 0.08, 0.12, 8, s * 0.62, 4.52, 0, 0x25302c, 0.5, 0.6); }
    return b.build();
  }
  b.cyl(0.085, 0.13, 7.6, 10, 0, 3.8, 0, METAL, 0.45, 0.8).cyl(0.2, 0.22, 0.5, 10, 0, 0.25, 0, METAL, 0.5, 0.7);
  b.cyl(0.05, 0.06, 2.4, 6, 0, 7.6, 1.15, METAL, 0.45, 0.8, 0, 0, Math.PI / 2 - 0.1);
  b.box(0.42, 0.18, 1.0, 0, 7.62, 2.35, 0x55595e, 0.4, 0.7);
  b.box(0.3, 0.04, 0.78, 0, 7.51, 2.38, LAMP_LIGHT, 0.2, 0, 1.4);
  return b.build();
}
function simpleLampPost(h = 3.6) {
  const b = new PB();
  b.cyl(0.05, 0.08, h, 8, 0, h / 2, 0, 0x2a2e30, 0.5, 0.6);
  b.sphere(0.2, 0, h + 0.15, 0, LAMP_LIGHT, 0.2, 0, 1.2);
  b.cyl(0.14, 0.1, 0.1, 8, 0, h + 0.38, 0, 0x2a2e30, 0.5, 0.6);
  return b.build();
}
function hydrantModel() {
  const b = new PB(), c = 0xc0392b;
  b.cyl(0.13, 0.15, 0.55, 12, 0, 0.3, 0, c, 0.45, 0.2).sphere(0.13, 0, 0.6, 0, c, 0.45, 0.2, 0, 12, 6, 1, 0.7, 1);
  b.cyl(0.05, 0.05, 0.4, 8, 0, 0.42, 0, 0xd4a017, 0.4, 0.4, 0, 0, Math.PI / 2).cyl(0.17, 0.17, 0.06, 12, 0, 0.05, 0, c, 0.5, 0.2);
  return b.build();
}
function trashModel() {
  const b = new PB();
  b.cyl(0.28, 0.26, 0.9, 14, 0, 0.45, 0, 0x2f4f3a, 0.6, 0.3).cyl(0.3, 0.3, 0.08, 14, 0, 0.94, 0, 0x2a2a2a, 0.5, 0.4);
  return b.build();
}
function benchModel() {
  const b = new PB();
  for (let i = 0; i < 4; i++) b.box(1.8, 0.04, 0.1, 0, 0.45, -0.15 + i * 0.12, WOOD, 0.7);
  for (let i = 0; i < 3; i++) b.box(1.8, 0.1, 0.035, 0, 0.62 + i * 0.13, 0.25, WOOD, 0.7, 0, 0, 0, -0.2);
  for (const s of [-0.75, 0.75]) { b.box(0.06, 0.45, 0.5, s, 0.22, 0.05, 0x222222, 0.5, 0.6); b.box(0.06, 0.5, 0.06, s, 0.65, 0.28, 0x222222, 0.5, 0.6); }
  return b.build();
}
function newsboxModel() { const b = new PB(); b.box(0.5, 0.75, 0.45, 0, 0.72, 0, 0xffffff, 0.5, 0.1).box(0.52, 0.35, 0.47, 0, 0.18, 0, 0x333333, 0.6, 0.2).box(0.4, 0.3, 0.02, 0, 0.85, 0.235, 0x9ab, 0.1, 0.1); return b.build(); }
function meterModel() { const b = new PB(); b.cyl(0.035, 0.035, 1.15, 6, 0, 0.58, 0, 0x555555, 0.5, 0.6).box(0.18, 0.28, 0.12, 0, 1.25, 0, 0x6b7b8c, 0.4, 0.6).box(0.12, 0.08, 0.01, 0, 1.3, 0.065, 0x223344, 0.1, 0.2, 0.3); return b.build(); }
function mailboxModel() { const b = new PB(); b.box(0.08, 1.0, 0.08, 0, 0.5, 0, 0x6b5438, 0.8).box(0.22, 0.24, 0.48, 0, 1.08, 0, 0x2c3e50, 0.5, 0.4).box(0.03, 0.12, 0.1, 0.13, 1.14, -0.12, 0xc0392b, 0.5, 0.3); return b.build(); }
function bollardModel() { const b = new PB(); b.cyl(0.11, 0.13, 0.9, 10, 0, 0.45, 0, 0x2b2b2b, 0.5, 0.5).cyl(0.115, 0.115, 0.1, 10, 0, 0.78, 0, 0xdddddd, 0.3, 0.2, 0.2); return b.build(); }
function quayBollardModel() { const b = new PB(); b.cyl(0.22, 0.25, 0.5, 12, 0, 0.25, 0, 0x1b1b1b, 0.6, 0.6).cyl(0.34, 0.2, 0.12, 12, 0, 0.55, 0, 0x1b1b1b, 0.6, 0.6); return b.build(); }
function planterModel() { const b = new PB(); b.box(1.4, 0.7, 1.4, 0, 0.35, 0, CONC, 0.9).sphere(0.62, 0, 0.9, 0, 0x3f6a2a, 0.9, 0, 0, 8, 6, 1, 0.6, 1); return b.build(); }
function dumpsterModel() { const b = new PB(); b.box(1.9, 1.2, 1.3, 0, 0.7, 0, 0x2e5b8a, 0.6, 0.4).box(1.95, 0.08, 1.35, 0, 1.33, -0.02, 0x1f1f1f, 0.6, 0.2, 0, 0, -0.08); for (const x of [-0.8, 0.8]) for (const z of [-0.5, 0.5]) b.cyl(0.08, 0.08, 0.1, 8, x, 0.08, z, 0x111111, 0.8, 0, 0, 0, Math.PI / 2); return b.build(); }
function busStopModel() {
  const b = new PB();
  b.box(4.2, 0.08, 1.7, 0, 2.6, 0, 0x7f8c8d, 0.4, 0.7);
  for (const x of [-2, 2]) b.box(0.08, 2.6, 0.08, x, 1.3, -0.75, 0x55595e, 0.4, 0.8);
  b.box(4.0, 2.0, 0.03, 0, 1.4, -0.78, 0xbfd9e8, 0.05, 0.1);
  b.box(0.03, 2.0, 1.2, 2, 1.4, -0.15, 0x223040, 0.3, 0.1, 0.8);
  b.box(2.4, 0.06, 0.4, -0.4, 0.5, -0.5, 0x444444, 0.5, 0.6);
  return b.build();
}
function umbrellaModel() {
  const b = new PB();
  b.cyl(0.025, 0.025, 2.4, 6, 0, 1.2, 0, 0xeeeeee, 0.4, 0.3);
  b.add(new THREE.ConeGeometry(1.4, 0.55, 12, 1, true), M(0, 2.25, 0), 0xffffff, 0.7, 0);
  b.add(new THREE.ConeGeometry(1.4, 0.55, 12, 1, true), M(0, 2.249, 0, 0, Math.PI), 0xdddddd, 0.7, 0);
  b.box(1.6, 0.02, 0.8, 0.9, 0.02, 0.6, 0xffffff, 0.9, 0); // towel
  return b.build();
}
function lifeguardModel() {
  const b = new PB();
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.box(0.12, 2.2, 0.12, x, 1.1, z, 0xf2f2f2, 0.6);
  b.box(2.4, 0.12, 2.4, 0, 2.2, 0, 0xe8d8b8, 0.8).box(2.2, 1.4, 2.0, 0, 2.95, 0, 0x5dade2, 0.6).box(2.6, 0.12, 2.5, 0, 3.72, 0, 0xe74c3c, 0.6);
  b.box(1.4, 0.6, 0.05, 0, 3.1, -1.01, 0x223344, 0.1, 0.2);
  b.box(0.8, 0.05, 2.6, 0, 1.1, 1.9, 0xf2f2f2, 0.6, 0, 0, 0, 0.9);
  return b.build();
}
function powerPoleModel() {
  const b = new PB();
  b.cyl(0.12, 0.16, 9.5, 8, 0, 4.75, 0, 0x5b4a3a, 0.9).box(2.2, 0.12, 0.12, 0, 8.8, 0, 0x5b4a3a, 0.9);
  for (const x of [-0.95, 0, 0.95]) b.cyl(0.05, 0.05, 0.25, 6, x, 9.0, 0, 0x8fa6a0, 0.3, 0.1);
  b.cyl(0.25, 0.25, 0.7, 10, 0.3, 7.6, 0.25, 0x7f8c8d, 0.5, 0.5);
  return b.build();
}
function chimneyModel() { const b = new PB(); b.cyl(0.9, 1.2, 1, 16, 0, 0.5, 0, 0x8b4a3a, 0.9); b.cyl(0.95, 0.95, 0.04, 16, 0, 0.9, 0, 0xdddddd, 0.6); return b.build(); } // scaled in y
function fountainModel() {
  const b = new PB();
  b.cyl(3.6, 3.8, 0.6, 32, 0, 0.3, 0, 0xd8d2c6, 0.7).cyl(3.3, 3.3, 0.02, 32, 0, 0.52, 0, 0x2a7f9a, 0.05, 0.2, 0.1);
  b.cyl(0.4, 0.6, 1.6, 12, 0, 1.2, 0, 0xd8d2c6, 0.7).cyl(1.2, 0.8, 0.3, 16, 0, 2.0, 0, 0xd8d2c6, 0.7).cyl(1.05, 1.05, 0.02, 16, 0, 2.16, 0, 0x2a7f9a, 0.05, 0.2, 0.1);
  return b.build();
}
function lighthouseModel() {
  const b = new PB();
  for (let i = 0; i < 6; i++) { const y = i * 3, r0 = 2.6 - i * 0.22, r1 = 2.6 - (i + 1) * 0.22; b.cyl(r1, r0, 3, 20, 0, y + 1.5, 0, i % 2 ? 0xc0392b : 0xf4f4f4, 0.6); }
  b.cyl(1.9, 1.9, 0.3, 20, 0, 18.1, 0, 0x2b2b2b, 0.5, 0.6).cyl(1.1, 1.1, 2.2, 16, 0, 19.3, 0, 0xfff1c4, 0.1, 0, 2.2).add(new THREE.ConeGeometry(1.4, 1.4, 16), M(0, 21.1, 0), 0x2b2b2b, 0.5, 0.6);
  return b.build();
}
function radioTowerModel(h = 64) {
  const b = new PB(), r = 3.2;
  const legs = [0, 2.094, 4.188].map(a => [Math.cos(a), Math.sin(a)]);
  const seg = 12;
  for (let i = 0; i < seg; i++) {
    const y0 = i * h / seg, y1 = (i + 1) * h / seg, s0 = r * (1 - 0.75 * y0 / h), s1 = r * (1 - 0.75 * y1 / h);
    const col = (i % 2) ? 0xc0392b : 0xf0f0f0;
    for (let k = 0; k < 3; k++) {
      const [ax, az] = legs[k], [bx, bz] = legs[(k + 1) % 3];
      const p0 = new THREE.Vector3(ax * s0, y0, az * s0), p1 = new THREE.Vector3(ax * s1, y1, az * s1);
      strut(b, p0, p1, 0.12, col);
      strut(b, new THREE.Vector3(ax * s0, y0, az * s0), new THREE.Vector3(bx * s1, y1, bz * s1), 0.05, 0xb0b0b0);
      strut(b, new THREE.Vector3(ax * s1, y1, az * s1), new THREE.Vector3(bx * s1, y1, bz * s1), 0.05, 0xb0b0b0);
    }
  }
  b.cyl(0.1, 0.1, 10, 6, 0, h + 5, 0, 0xf0f0f0, 0.5, 0.5);
  b.box(3, 2.4, 3, 5, 1.2, 5, 0x9aa0a6, 0.7, 0.3);
  return b.build();
}
function strut(b, p0, p1, r, col) {
  const d = new THREE.Vector3().subVectors(p1, p0), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, 5, 1, true);
  const m = new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1));
  b.add(g, m, col, 0.6, 0.5);
}
function craneModel() {
  const b = new PB(), O = 0xe67e22, D = 0x34495e;
  for (const x of [-8, 8]) for (const z of [-9, 9]) b.box(1.2, 36, 1.2, x, 18, z, O, 0.6, 0.4);
  for (const x of [-8, 8]) { b.box(1.4, 1.6, 20, x, 36, 0, O, 0.6, 0.4); b.box(1.4, 1.2, 20, x, 12, 0, O, 0.6, 0.4); }
  b.box(18, 2.2, 2.2, 0, 38, 0, O, 0.6, 0.4);
  b.box(2.6, 2.2, 70, 0, 41, 15, O, 0.6, 0.4); // boom out over water (+z)
  b.box(5, 4, 5, 0, 44, -6, D, 0.5, 0.3).box(3, 2.4, 2.6, 0, 38.5, 22, D, 0.4, 0.3);
  for (const s of [-1, 1]) strut(b, new THREE.Vector3(s * 1.2, 46, -6), new THREE.Vector3(s * 1.2, 42, 45), 0.15, D);
  for (const x of [-8, 8]) for (const z of [-9, 9]) b.box(1.8, 0.8, 2.2, x, 0.4, z, D, 0.6, 0.5);
  return b.build();
}
function smallCraneModel() {
  const b = new PB(), Y = 0xf1c40f;
  b.box(2.5, 3, 4, 0, 1.6, 0, Y, 0.6, 0.3).cyl(0.6, 0.6, 1, 10, 0, 3.4, 0, 0x333333, 0.6, 0.5);
  strut(b, new THREE.Vector3(0, 3.8, 0), new THREE.Vector3(0, 16, 9), 0.35, Y);
  b.box(0.1, 6, 0.1, 0, 13, 9, 0x222222, 0.5, 0.6).cyl(0.9, 0.9, 0.3, 12, 0, 10, 9, 0x555555, 0.5, 0.8);
  return b.build();
}
function wreckModel() {
  const b = new PB(), c = 0x8a5a44;
  b.box(1.8, 0.9, 4.2, 0, 0.55, 0, c, 0.9, 0.3, 0, 0, 0, 0.05).box(1.5, 0.45, 2.0, 0, 1.2, -0.2, 0x6d4c3d, 0.9, 0.3, 0, 0.1, 0, -0.06);
  b.box(1.4, 0.35, 1.6, 0, 1.2, -0.2, 0x1c1c1c, 0.3, 0.2);
  return b.build();
}
function binocularsModel() { const b = new PB(); b.cyl(0.06, 0.06, 1.1, 8, 0, 0.55, 0, 0x2c3e50, 0.4, 0.7).box(0.4, 0.22, 0.3, 0, 1.2, 0, 0x16a085, 0.4, 0.6).cyl(0.07, 0.07, 0.25, 8, -0.1, 1.25, 0.2, 0x111111, 0.3, 0.6, 0, 0, Math.PI / 2).cyl(0.07, 0.07, 0.25, 8, 0.1, 1.25, 0.2, 0x111111, 0.3, 0.6, 0, 0, Math.PI / 2); return b.build(); }
function rockModel() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.25 * Math.sin(x * 3.1 + z * 2.3) + 0.15 * Math.sin(y * 5.7); p.setXYZ(i, x * k * 1.3, Math.max(-0.3, y * k * 0.7), z * k); }
  g.computeVertexNormals();
  const b = new PB(); b.add(g, null, 0x8a857c, 0.9, 0); return b.build();
}
function guardrailModel() { // unit length along z
  const b = new PB();
  b.box(0.08, 0.32, 1.0, 0, 0.62, 0, 0xb8bcc0, 0.35, 0.8);
  b.box(0.1, 0.75, 0.1, 0.05, 0.38, 0, 0x7f8386, 0.5, 0.6);
  return b.build();
}
function fenceWoodModel() { const b = new PB(); b.box(0.04, 1.5, 1.0, 0, 0.75, 0, 0xc8b8a0, 0.9); b.box(0.08, 0.08, 1.0, 0.03, 1.2, 0, 0xb8a890, 0.9); return b.build(); }
function fenceChainModel() { const b = new PB(); b.box(0.02, 2.2, 1.0, 0, 1.1, 0, 0x9aa0a6, 0.5, 0.7); return b.build(); }
function fenceRailModel() { const b = new PB(); b.box(0.06, 0.06, 1.0, 0, 2.3, 0, 0x7a7f84, 0.5, 0.7).box(0.06, 0.06, 1.0, 0, 0.05, 0, 0x7a7f84, 0.5, 0.7); return b.build(); }
function trafficPoleModel() { const b = new PB(); b.cyl(0.12, 0.15, 6.4, 10, 0, 3.2, 0, 0x3b3f42, 0.45, 0.7).box(0.35, 0.9, 0.25, 0, 3.0, -0.2, 0x2a2a2a, 0.6, 0.3); return b.build(); }
function trafficArmModel() { const b = new PB(); b.box(1, 0.16, 0.16, 0.5, 6.1, 0, 0x3b3f42, 0.45, 0.7); return b.build(); } // unit length along +x
function signalHeadModel() { const b = new PB(); b.box(0.36, 1.05, 0.28, 0, 0, 0, 0x1d1f20, 0.6, 0.2); b.box(0.5, 1.2, 0.03, 0, 0, 0.16, 0x111111, 0.7, 0.1); for (let i = 0; i < 3; i++) b.box(0.26, 0.05, 0.14, 0, 0.3 - i * 0.32 + 0.13, -0.2, 0x1d1f20, 0.6, 0.2); return b.build(); }

// ---------------------------------------------------------------- instance pool with distance culling
export class InstancePool {
  constructor(scene, geometry, material, items, { maxDist = 400, cell = 64, castShadow = false, receiveShadow = true, colors = null, name = '', shadowDist = 150 } = {}) {
    this.items = items; this.maxDist = maxDist; this.cell = cell;
    const n = Math.max(1, items.length);
    this.mesh = new THREE.InstancedMesh(geometry, material, n);
    this.mesh.name = name;
    this.mesh.castShadow = false; this.mesh.receiveShadow = receiveShadow; this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    if (castShadow) { // shadow-only proxy (layer 1 is rendered by the sun's shadow camera only)
      this.shadowDist = Math.min(shadowDist, maxDist);
      this.shadow = new THREE.InstancedMesh(geometry, material, n);
      this.shadow.castShadow = true; this.shadow.receiveShadow = false; this.shadow.frustumCulled = false; this.shadow.count = 0;
      this.shadow.layers.set(1);
      scene.add(this.shadow);
    }
    this.mat = new Float32Array(n * 16);
    this.hidden = new Uint8Array(n);
    this.colors = colors;
    if (colors) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const m = new THREE.Matrix4();
    items.forEach((it, i) => { (it.matrix || m.copy(M(it.x, it.y, it.z, it.rot || 0, 0, 0, it.sx ?? it.scale ?? 1, it.sy ?? it.scale ?? 1, it.sz ?? it.scale ?? 1))).toArray(this.mat, i * 16); });
    this.grid = new Map();
    items.forEach((it, i) => { const k = Math.floor(it.x / cell) * 100003 + Math.floor(it.z / cell); let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(i); });
    this.lastX = 1e9; this.lastZ = 1e9;
    scene.add(this.mesh);
  }
  hide(i) { this.hidden[i] = 1; this.lastX = 1e9; }
  show(i) { this.hidden[i] = 0; this.lastX = 1e9; }
  update(cx, cz, force = false) {
    if (!force && Math.abs(cx - this.lastX) + Math.abs(cz - this.lastZ) < this.cell * 0.35) return;
    this.lastX = cx; this.lastZ = cz;
    const arr = this.mesh.instanceMatrix.array, col = this.colors && this.mesh.instanceColor.array;
    const r = Math.ceil(this.maxDist / this.cell), gx = Math.floor(cx / this.cell), gz = Math.floor(cz / this.cell), d2 = this.maxDist * this.maxDist;
    let n = 0;
    for (let ox = -r; ox <= r; ox++) for (let oz = -r; oz <= r; oz++) {
      const a = this.grid.get((gx + ox) * 100003 + gz + oz); if (!a) continue;
      for (const i of a) {
        if (this.hidden[i]) continue;
        const it = this.items[i], dx = it.x - cx, dz = it.z - cz;
        if (dx * dx + dz * dz > d2) continue;
        arr.set(this.mat.subarray(i * 16, i * 16 + 16), n * 16);
        if (col) { col[n * 3] = this.colors[i * 3]; col[n * 3 + 1] = this.colors[i * 3 + 1]; col[n * 3 + 2] = this.colors[i * 3 + 2]; }
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (col) this.mesh.instanceColor.needsUpdate = true;
    if (this.shadow) {
      const sa = this.shadow.instanceMatrix.array, sd2 = this.shadowDist * this.shadowDist; let k = 0;
      const rs = Math.ceil(this.shadowDist / this.cell);
      for (let ox = -rs; ox <= rs; ox++) for (let oz = -rs; oz <= rs; oz++) {
        const a = this.grid.get((gx + ox) * 100003 + gz + oz); if (!a) continue;
        for (const i of a) { if (this.hidden[i]) continue; const it = this.items[i], dx = it.x - cx, dz = it.z - cz; if (dx * dx + dz * dz > sd2) continue; sa.set(this.mat.subarray(i * 16, i * 16 + 16), k * 16); k++; }
      }
      this.shadow.count = k; this.shadow.instanceMatrix.needsUpdate = true;
    }
  }
}

const NEWS_COLORS = [0x2e86c1, 0xc0392b, 0xf1c40f, 0x27ae60, 0xffffff];
const UMB_COLORS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x1abc9c, 0xffffff, 0xff6f91];
const CONTAINER_COLORS = [0xb03a2e, 0x1f618d, 0x117864, 0xb9770e, 0x6c3483, 0x7b7d7d, 0xd35400, 0x2e4053];

export class PropSystem {
  constructor(scene, city, textures, facadeMat, quality = 'medium') {
    this.city = city; this.scene = scene;
    this.mat = createPropMaterial();
    this.pools = []; this.byKind = new Map();
    const far = quality === 'low' ? 0.6 : quality === 'medium' ? 0.8 : 1;
    const groups = new Map();
    city.props.forEach((p, i) => { p.index = i; let a = groups.get(p.kind); if (!a) groups.set(p.kind, a = []); a.push(p); });
    const add = (kind, geo, list, opts = {}) => {
      if (!list || !list.length) return;
      const items = list.map(p => ({ x: p.x, y: p.y, z: p.z, rot: p.rot, scale: p.scale, sx: opts.sx ? opts.sx(p) : undefined, sy: opts.sy ? opts.sy(p) : undefined, sz: opts.sz ? opts.sz(p) : undefined, prop: p.index }));
      let colors = null;
      if (opts.color) { colors = new Float32Array(list.length * 3); const c = new THREE.Color(); list.forEach((p, i) => { c.set(opts.color(p)); colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }); }
      const pool = new InstancePool(scene, geo, opts.material || this.mat, items, { maxDist: (opts.dist || 300) * far, castShadow: !!opts.shadow, colors, name: kind });
      pool.kind = kind;
      this.pools.push(pool);
      list.forEach((p, i) => { p._pool = pool; p._pi = i; });
      return pool;
    };
    const G = (k) => groups.get(k) || [];
    add('lamp0', lampModel(0), G('lamp').filter(p => !p.variant), { dist: 420, shadow: true });
    add('lamp1', lampModel(1), G('lamp').filter(p => p.variant === 1), { dist: 380, shadow: true });
    add('parkLamp', simpleLampPost(3.6), G('parkLamp'), { dist: 250 });
    add('pierLamp', simpleLampPost(3.2), G('pierLamp'), { dist: 300 });
    add('hydrant', hydrantModel(), G('hydrant'), { dist: 140 });
    add('trash', trashModel(), G('trash'), { dist: 150 });
    add('bench', benchModel(), G('bench'), { dist: 150 });
    add('newsbox', newsboxModel(), G('newsbox'), { dist: 120, color: p => NEWS_COLORS[p.variant % NEWS_COLORS.length] });
    add('meter', meterModel(), G('meter'), { dist: 110 });
    add('mailbox', mailboxModel(), G('mailbox'), { dist: 120 });
    add('bollard', bollardModel(), G('bollard'), { dist: 120 });
    add('bollardQuay', quayBollardModel(), G('bollardQuay'), { dist: 150 });
    add('planter', planterModel(), G('planter'), { dist: 180 });
    add('dumpster', dumpsterModel(), G('dumpster'), { dist: 180, shadow: true });
    add('busStop', busStopModel(), G('busStop'), { dist: 250, shadow: true });
    add('umbrella', umbrellaModel(), G('umbrella'), { dist: 260, color: p => UMB_COLORS[p.variant % UMB_COLORS.length], shadow: true });
    add('lifeguard', lifeguardModel(), G('lifeguard'), { dist: 500, shadow: true });
    add('powerPole', powerPoleModel(), G('powerPole'), { dist: 350, shadow: true });
    add('chimney', chimneyModel(), G('chimney'), { dist: 1500, sy: p => p.h, shadow: true });
    add('fountain', fountainModel(), G('fountain'), { dist: 500 });
    add('lighthouse', lighthouseModel(), G('lighthouse'), { dist: 3000, shadow: true });
    add('radioTower', radioTowerModel(64), G('radioTower'), { dist: 4000 });
    add('crane', craneModel(), G('crane').filter(p => !(p.extra && p.extra.small)), { dist: 3000, shadow: true });
    add('smallCrane', smallCraneModel(), G('crane').filter(p => p.extra && p.extra.small), { dist: 800, shadow: true });
    add('binoculars', binocularsModel(), G('binoculars'), { dist: 120 });
    add('rock', rockModel(), G('rock'), { dist: 500, shadow: true, color: () => 0xffffff });
    add('guardrail', guardrailModel(), G('guardrail'), { dist: 350, sz: p => p.len + 0.3 });
    const fences = G('fence');
    add('fenceWood', fenceWoodModel(), fences.filter(p => p.variant === 0), { dist: 220, sz: p => p.len });
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.7, transparent: true, opacity: 0.35, depthWrite: false });
    add('fenceChain', fenceChainModel(), fences.filter(p => p.variant === 1), { dist: 220, sz: p => p.len, material: chainMat });
    add('fenceRail', fenceRailModel(), fences.filter(p => p.variant === 1), { dist: 260, sz: p => p.len });
    // wrecks: stack (second level offset)
    const wrecks = G('wreck'), wl = [];
    for (const p of wrecks) { wl.push(p); if (p.extra && p.extra.stack > 1) wl.push({ ...p, y: p.y + 1.25, rot: p.rot + 0.4, index: -1 }); }
    add('wreck', wreckModel(), wl, { dist: 400, shadow: true, color: p => [0x8a5a44, 0x5d6d7e, 0x7b241c, 0x1e8449, 0x9c640c, 0x566573][p.variant % 6] });
    // containers with the facade material (CONTAINER layer), stacked
    const cItems = [], cCols = [];
    const cc = new THREE.Color();
    for (const p of G('container')) {
      const stack = (p.extra && p.extra.stack) || 1;
      for (let k = 0; k < stack; k++) {
        cItems.push({ x: p.x, y: p.y + k * 2.6, z: p.z, rot: p.rot + (k % 2 ? 0 : 0), scale: 1, prop: p.index });
        cc.set(CONTAINER_COLORS[(p.variant + k * 3) % CONTAINER_COLORS.length]); cCols.push(cc.r, cc.g, cc.b);
      }
    }
    if (cItems.length) {
      const pool = new InstancePool(scene, containerGeometry(), facadeMat, cItems, { maxDist: 700 * far, castShadow: true, colors: new Float32Array(cCols), name: 'container' });
      this.pools.push(pool);
    }
    // vegetation
    const veg = buildVegetationModels(textures, quality);
    this.vegMats = veg.materials;
    const vAdd = (kind, list, models, dist) => {
      for (let v = 0; v < models.length; v++) {
        const l = list.filter(p => (p.variant || 0) % models.length === v);
        if (!l.length) continue;
        const pool = new InstancePool(scene, models[v].geometry, models[v].material, l.map(p => ({ x: p.x, y: p.y, z: p.z, rot: p.rot || (p.x * 13.7 + p.z * 7.1), scale: p.scale || 1, prop: p.index })), { maxDist: dist * far, castShadow: true, name: kind });
        pool.kind = kind; this.pools.push(pool);
        l.forEach((p, i) => { p._pool = pool; p._pi = i; });
      }
    };
    vAdd('palm', G('palm'), veg.palm, 520);
    vAdd('tree', G('tree'), veg.tree, 420);
    vAdd('pine', G('pine'), veg.pine, 800);
    vAdd('bush', G('bush'), veg.bush, 200);
    // traffic lights (not culled): poles, arms, heads, bulbs
    this.buildTrafficLights(scene, G('trafficLight'));
    // billboards (individual meshes)
    this.buildBillboards(scene, G('billboard'), textures);
    // lamp light pools
    this.buildLightPools(scene, G('lamp'), G('parkLamp').concat(G('pierLamp')));
    // power lines
    this.buildWires(scene, city.wires);
    this.lastCam = null;
  }
  buildTrafficLights(scene, list) {
    this.tl = list;
    const pole = trafficPoleModel(), arm = trafficArmModel(), head = signalHeadModel();
    const heads = [], arms = [];
    for (const p of list) {
      const ex = p.extra || { arm: 5, lanes: 1, median: 0 };
      arms.push({ x: p.x, y: p.y, z: p.z, rot: p.rot, sx: ex.arm + 0.3, sy: 1, sz: 1 });
      p.heads = [];
      const e = this.city.roads.edges[p.edge];
      const hw = e.width / 2 + 0.7;
      for (let i = 0; i < ex.lanes; i++) {
        const lx = hw - (ex.median / 2 + (i + 0.5) * 3.5);
        const c = Math.cos(p.rot), s = Math.sin(p.rot);
        heads.push({ x: p.x + c * lx, y: p.y + 5.45, z: p.z - s * lx, rot: p.rot, prop: p.index });
        p.heads.push(heads.length - 1);
      }
    }
    this.tlPole = new InstancePool(scene, pole, this.mat, list.map(p => ({ x: p.x, y: p.y, z: p.z, rot: p.rot })), { maxDist: 1e5, castShadow: true });
    this.tlArm = new InstancePool(scene, arm, this.mat, arms, { maxDist: 1e5, castShadow: true });
    this.tlHead = new InstancePool(scene, head, this.mat, heads, { maxDist: 1e5, castShadow: true });
    this.tlPole.update(0, 0, true); this.tlArm.update(0, 0, true); this.tlHead.update(0, 0, true);
    // bulbs: 3 per head, facing oncoming (-z local)
    const n = heads.length * 3;
    const bulbGeo = new THREE.CircleGeometry(0.12, 12); bulbGeo.rotateY(Math.PI);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, Math.max(1, n));
    this.bulbs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
    this.bulbs.frustumCulled = false;
    const m = new THREE.Matrix4();
    heads.forEach((h, i) => { for (let k = 0; k < 3; k++) { const c = Math.cos(h.rot), s = Math.sin(h.rot); const lz = -0.15; m.copy(M(h.x + s * lz, h.y + 0.32 - k * 0.32, h.z + c * lz, h.rot)); this.bulbs.setMatrixAt(i * 3 + k, m); } });
    this.bulbs.count = n;
    scene.add(this.bulbs);
    this.tlState = new Int8Array(list.length).fill(-1);
  }
  updateSignals(time, night) {
    const col = this.bulbs.instanceColor.array;
    const glow = 3.2 + night * 3;
    const on = [[glow, 0.08 * glow, 0.03 * glow], [glow, 0.55 * glow, 0.05 * glow], [0.1 * glow, glow, 0.45 * glow]];
    const off = [[0.09, 0.02, 0.02], [0.09, 0.07, 0.02], [0.02, 0.08, 0.05]];
    let changed = this._nightChanged;
    for (let i = 0; i < this.tl.length; i++) {
      const p = this.tl[i];
      const st = signalState(this.city.roads.nodes[p.node], p.edge, time);
      const s = st === 'red' ? 0 : st === 'yellow' ? 1 : 2;
      if (s === this.tlState[i] && !this._nightChanged) continue;
      this.tlState[i] = s; changed = true;
      for (const h of p.heads) for (let k = 0; k < 3; k++) { const c = (k === s) ? on[k] : off[k]; col.set(c, (h * 3 + k) * 3); }
    }
    this._nightChanged = false;
    if (changed) this.bulbs.instanceColor.needsUpdate = true;
  }
  buildBillboards(scene, list, textures) {
    const tex = textures.billboards;
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.55 });
    this.billboardMat = faceMat;
    const frame = new PB();
    frame.box(0.35, 11, 0.35, -3, 5.5, 0, 0x5d6166, 0.5, 0.7).box(0.35, 11, 0.35, 3, 5.5, 0, 0x5d6166, 0.5, 0.7);
    frame.box(12.4, 5.4, 0.3, 0, 11.2, 0.1, 0x3b3f42, 0.5, 0.6).box(12, 0.12, 0.8, 0, 8.4, -0.35, 0x5d6166, 0.5, 0.7);
    for (const x of [-4, 0, 4]) frame.box(0.4, 0.2, 0.6, x, 14.1, -0.5, 0x2b2b2b, 0.5, 0.6).box(0.25, 0.1, 0.2, x, 14.0, -0.8, 0xfff0d0, 0.2, 0, 1.2);
    const frameGeo = frame.build();
    const g = new THREE.Group();
    for (const p of list) {
      const v = p.variant % 10, cu = (v % 2) / 2, cv = 1 - (Math.floor(v / 2) + 1) / 5;
      const pg = new THREE.PlaneGeometry(12, 4.8);
      const uv = pg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, cu + uv.getX(i) * 0.5, cv + uv.getY(i) * 0.2);
      pg.translate(0, 11.2, -0.07); pg.rotateY(Math.PI);
      const face = new THREE.Mesh(pg, faceMat);
      const fr = new THREE.Mesh(frameGeo, this.mat); fr.castShadow = true;
      const grp = new THREE.Group(); grp.add(fr, face);
      const roof = p.extra && p.extra.roof;
      grp.position.set(p.x, p.y - (roof ? 5.5 : 0), p.z); grp.rotation.y = p.rot;
      if (roof) grp.scale.setScalar(0.8);
      g.add(grp);
    }
    scene.add(g);
  }
  buildLightPools(scene, lamps, small) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d');
    const gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    this.poolMat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffb870, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -6 });
    const items = [];
    for (const p of lamps) {
      const c2 = Math.cos(p.rot), s2 = Math.sin(p.rot), off = p.variant === 1 ? 0 : 2.3;
      const x = p.x + s2 * off, z = p.z + c2 * off;
      items.push({ x, y: (p.variant === 1 ? p.y : 0.03), z, rot: 0, sx: p.variant === 1 ? 9 : 13, sy: 1, sz: p.variant === 1 ? 9 : 13 });
    }
    for (const p of small) items.push({ x: p.x, y: p.y + 0.02, z: p.z, rot: 0, sx: 8, sy: 1, sz: 8 });
    this.lightPools = new InstancePool(scene, geo, this.poolMat, items, { maxDist: 380, receiveShadow: false });
    this.lightPools.mesh.renderOrder = 2;
  }
  buildWires(scene, wires) {
    const pos = [];
    for (const poles of wires) {
      for (let i = 0; i < poles.length - 1; i++) {
        const a = poles[i], b = poles[i + 1];
        for (const off of [-0.95, 0, 0.95]) {
          const ca = Math.cos(a.rot), sa = Math.sin(a.rot);
          const ax = a.x + ca * off, az = a.z - sa * off, bx = b.x + ca * off, bz = b.z - sa * off;
          const n = 8;
          for (let k = 0; k < n; k++) {
            const t0 = k / n, t1 = (k + 1) / n, sag = (t) => -1.1 * 4 * t * (1 - t);
            pos.push(ax + (bx - ax) * t0, a.y + 9.1 + sag(t0), az + (bz - az) * t0, ax + (bx - ax) * t1, a.y + 9.1 + sag(t1), az + (bz - az) * t1);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.8 }));
    l.frustumCulled = false; scene.add(l);
  }
  /** Hide a breakable prop; returns its world matrix for debris. */
  breakProp(i) {
    const p = this.city.props[i];
    if (!p || p.broken) return null;
    p.broken = true;
    if (p.collider >= 0) this.city.collision.setEnabled(p.collider, false);
    if (p._pool) p._pool.hide(p._pi);
    return { kind: p.kind, x: p.x, y: p.y, z: p.z, rot: p.rot, variant: p.variant };
  }
  restoreProp(i) {
    const p = this.city.props[i];
    if (!p || !p.broken) return;
    p.broken = false;
    if (p.collider >= 0) this.city.collision.setEnabled(p.collider, true);
    if (p._pool) p._pool.show(p._pi);
  }
  /** Standalone mesh for a knocked-over prop. */
  createDebris(kind, variant = 0) {
    const geo = kind === 'lamp' ? lampModel(variant) : kind === 'hydrant' ? hydrantModel() : kind === 'trash' ? trashModel() : kind === 'bench' ? benchModel() : kind === 'newsbox' ? newsboxModel() : kind === 'meter' ? meterModel() : kind === 'mailbox' ? mailboxModel() : kind === 'umbrella' ? umbrellaModel() : kind === 'parkLamp' ? simpleLampPost(3.6) : kind === 'dumpster' ? dumpsterModel() : null;
    if (!geo) return null;
    const m = new THREE.Mesh(geo, this.mat); m.castShadow = true;
    return m;
  }
  update(dt, { time, night, camera }) {
    const cx = camera.position.x, cz = camera.position.z;
    for (const p of this.pools) p.update(cx, cz);
    this.lightPools.update(cx, cz);
    if (Math.abs(night - (this._lastNight ?? -1)) > 0.02) { this._nightChanged = true; this._lastNight = night; }
    this.updateSignals(time, night);
    this.mat.userData.uniforms.uNight.value = night;
    this.poolMat.opacity = night * 0.55;
    this.lightPools.mesh.visible = night > 0.03;
    this.billboardMat.emissiveIntensity = 0.05 + night * 1.2;
    for (const m of this.vegMats) if (m.userData.uniforms) m.userData.uniforms.uTime.value = time;
  }
}
function containerGeometry() {
  // 12.2 x 2.6 x 2.44 box with facade attributes (CONTAINER layer), along local x
  const L = 12.2, H = 2.59, W = 2.44, layer = FACADES.CONTAINER.layer;
  const p = [], n = [], uv = [], l = [], c = [], s = [], lit = [];
  const quad = (a, b, cc, d, nn, u0, u1, v0, v1) => {
    for (const [v, t] of [[a, [u0, v0]], [b, [u1, v0]], [cc, [u1, v1]], [a, [u0, v0]], [cc, [u1, v1]], [d, [u0, v1]]]) { p.push(...v); n.push(...nn); uv.push(...t); l.push(layer); c.push(1, 1, 1); s.push(0); lit.push(0); }
  };
  const x0 = -L / 2, x1 = L / 2, z0 = -W / 2, z1 = W / 2;
  quad([x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0], [0, 0, -1], 0, 2, 0, 1);
  quad([x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1], [0, 0, 1], 0, 2, 0, 1);
  quad([x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0], [-1, 0, 0], 0, 0.4, 0, 1);
  quad([x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1], [1, 0, 0], 0, 0.4, 0, 1);
  quad([x0, H, z1], [x1, H, z1], [x1, H, z0], [x0, H, z0], [0, 1, 0], 0, 2, 0, 0.9);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aLayer', new THREE.Float32BufferAttribute(l, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); g.setAttribute('aSeed', new THREE.Float32BufferAttribute(s, 1)); g.setAttribute('aLit', new THREE.Float32BufferAttribute(lit, 1));
  g.computeBoundingSphere();
  return g;
}
