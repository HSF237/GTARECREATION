// Procedural vegetation models (palms, broadleaf trees, pines, bushes) for instanced rendering with wind sway.
//   buildVegetationModels(textures, quality) -> { palm:[{geometry, material}], tree:[...], pine:[...], bush:[...], materials:[...] }
import * as THREE from 'three';
import { makeRng } from '../core/rng.js';

function swayMaterial(params, strength = 1, leaf = false) {
  const m = new THREE.MeshStandardMaterial(params);
  const U = m.userData.uniforms = { uTime: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying float vVar;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#else
vec3 ip = vec3(0.0);
#endif
float ph = ip.x * 0.37 + ip.z * 0.21;
vVar = fract(sin(ph * 12.9898) * 43758.5453);
float hh = max(transformed.y - 1.0, 0.0);
float sw = (sin(uTime * 1.25 + ph) * 0.022 + sin(uTime * 2.9 + ph * 1.7) * 0.008) * hh * ${strength.toFixed(2)};
${leaf ? 'sw += sin(uTime * 6.0 + ph * 3.0 + transformed.x * 2.0 + transformed.z * 1.7) * 0.03 * min(hh, 1.0);' : ''}
transformed.x += sw; transformed.z += sw * 0.7;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vVar;')
      .replace('#include <map_fragment>', `#include <map_fragment>
${leaf ? 'diffuseColor.rgb *= vec3(0.86 + 0.28 * vVar, 0.9 + 0.2 * vVar, 0.85 + 0.15 * (1.0 - vVar));' : ''}`);
  };
  m.customProgramCacheKey = () => 'sway' + strength + leaf;
  return m;
}

function merge(list) { // list of {geo, group}
  const groups = [[], []];
  for (const it of list) groups[it.g].push(it.geo.index ? it.geo.toNonIndexed() : it.geo);
  const out = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'uv'];
  const data = { position: [], normal: [], uv: [] };
  let start = 0;
  for (let gi = 0; gi < 2; gi++) {
    let count = 0;
    for (const g of groups[gi]) { for (const a of attrs) data[a].push(...g.attributes[a].array); count += g.attributes.position.count; }
    out.addGroup(start, count, gi); start += count;
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
  out.computeBoundingSphere();
  return out;
}
function tube(path, radii, seg = 8, vScale = 1) {
  // path: [Vector3], radii: [r]
  const pos = [], nor = [], uv = [], idx = [];
  const up = new THREE.Vector3(0, 1, 0), t = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i], q = path[Math.min(path.length - 1, i + 1)], o = path[Math.max(0, i - 1)];
    t.subVectors(q, o).normalize();
    a.crossVectors(t, Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize(); b.crossVectors(t, a).normalize();
    if (i > 0) v += p.distanceTo(path[i - 1]) * vScale;
    for (let k = 0; k <= seg; k++) {
      const ang = k / seg * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
      const nx = a.x * c + b.x * s, ny = a.y * c + b.y * s, nz = a.z * c + b.z * s;
      pos.push(p.x + nx * radii[i], p.y + ny * radii[i], p.z + nz * radii[i]); nor.push(nx, ny, nz); uv.push(k / seg * 2, v);
    }
  }
  for (let i = 0; i < path.length - 1; i++) for (let k = 0; k < seg; k++) {
    const r0 = i * (seg + 1) + k, r1 = r0 + seg + 1;
    idx.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function palmGeo(rng, H) {
  const parts = [];
  const lean = rng.range(0.4, 1.6), dir = rng.range(0, Math.PI * 2);
  const path = [], radii = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    path.push(new THREE.Vector3(Math.cos(dir) * lean * t * t, H * t, Math.sin(dir) * lean * t * t));
    radii.push((0.27 - 0.1 * t) * (1 + 0.06 * Math.sin(i * 2.7)));
  }
  parts.push({ geo: tube(path, radii, 8, 1.6), g: 0 });
  const top = path[N];
  const bulb = new THREE.SphereGeometry(0.32, 8, 6); bulb.translate(top.x, top.y + 0.05, top.z);
  parts.push({ geo: bulb, g: 0 });
  // fronds
  const nf = 16;
  for (let f = 0; f < nf; f++) {
    const a = f / nf * Math.PI * 2 + rng.range(-0.15, 0.15);
    const L = rng.range(3.6, 4.9), K = 8, w = rng.range(0.7, 0.9);
    const pitch0 = rng.range(0.35, 0.75), droop = rng.range(1.4, 2.1);
    const ca = Math.cos(a), sa = Math.sin(a), rx = -sa, rz = ca;
    const pos = [], nor = [], uv = [], idx = [];
    let px = top.x, py = top.y, pz = top.z;
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      if (k > 0) { const pitch = pitch0 - droop * t * t; const st = L / K; px += ca * Math.cos(pitch) * st; py += Math.sin(pitch) * st; pz += sa * Math.cos(pitch) * st; }
      const ww = w * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.08)), fold = ww * 0.35;
      pos.push(px + rx * ww, py - fold, pz + rz * ww, px - rx * ww, py - fold, pz - rz * ww);
      const ny = 0.8, nh = 0.6;
      nor.push(ca * nh, ny, sa * nh, ca * nh, ny, sa * nh);
      uv.push(t, 0.02, t, 0.98);
    }
    for (let k = 0; k < K; k++) { const i = k * 2; idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    parts.push({ geo: g, g: 1 });
  }
  return merge(parts);
}
function blob(r, x, y, z, cx, cy, cz, uvScale = 1.6, detail = 0) {
  const g = new THREE.IcosahedronGeometry(r, detail).toNonIndexed();
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const wx = p.getX(i) + x, wy = p.getY(i) + y, wz = p.getZ(i) + z;
    p.setXYZ(i, wx, wy, wz);
    const dx = wx - cx, dy = wy - cy, dz = wz - cz, l = Math.hypot(dx, dy, dz) || 1;
    n.setXYZ(i, dx / l, dy / l + 0.15, dz / l);
    uv.setXY(i, uv.getX(i) * uvScale * 2, uv.getY(i) * uvScale);
  }
  return g;
}
function treeGeo(rng, H, spread) {
  const parts = [];
  const path = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, H * 0.35, 0), new THREE.Vector3(-0.05, H * 0.6, 0.05)];
  parts.push({ geo: tube(path, [0.22, 0.17, 0.12], 7, 1), g: 0 });
  const cy = H * 0.72;
  for (let b = 0; b < 3; b++) {
    const a = b * 2.1 + rng.range(-0.3, 0.3);
    const bp = [new THREE.Vector3(0, H * 0.45, 0), new THREE.Vector3(Math.cos(a) * spread * 0.55, H * 0.68, Math.sin(a) * spread * 0.55)];
    parts.push({ geo: tube(bp, [0.1, 0.05], 5, 1), g: 0 });
  }
  const nb = 9;
  for (let i = 0; i < nb; i++) {
    const a = rng.range(0, Math.PI * 2), rr = i === 0 ? 0 : rng.range(spread * 0.4, spread * 0.85);
    const r = i === 0 ? spread * 0.85 : rng.range(spread * 0.45, spread * 0.7);
    parts.push({ geo: blob(r, Math.cos(a) * rr, cy + rng.range(-0.5, 0.9) + (i === 0 ? 0.4 : 0), Math.sin(a) * rr, 0, cy, 0), g: 1 });
  }
  return merge(parts);
}
function pineGeo(rng, H) {
  const parts = [];
  parts.push({ geo: tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, H, 0)], [0.25, 0.08], 6, 1), g: 0 });
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers, r = (1 - t * 0.8) * H * 0.26, h = H * 0.3;
    const g = new THREE.ConeGeometry(r, h, 9, 1, true).toNonIndexed();
    const y = H * 0.22 + t * H * 0.66;
    g.translate(0, y + h / 2, 0);
    const n = g.attributes.normal, p = g.attributes.position, uv = g.attributes.uv;
    for (let k = 0; k < n.count; k++) { const x = p.getX(k), z = p.getZ(k), l = Math.hypot(x, z) || 1; n.setXYZ(k, x / l * 0.8, 0.6, z / l * 0.8); uv.setXY(k, uv.getX(k) * 3, uv.getY(k) * 1.5); }
    parts.push({ geo: g, g: 1 });
  }
  return merge(parts);
}
function bushGeo(rng) {
  const parts = [{ geo: new THREE.CylinderGeometry(0.05, 0.06, 0.3, 4).translate(0, 0.15, 0), g: 0 }];
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, 6.28), rr = i ? rng.range(0.3, 0.6) : 0;
    parts.push({ geo: blob(rng.range(0.55, 0.85), Math.cos(a) * rr, 0.55 + rng.range(-0.1, 0.25), Math.sin(a) * rr, 0, 0.4, 0, 1.2, 0), g: 1 });
  }
  return merge(parts);
}

export function buildVegetationModels(textures, quality) {
  const rng = makeRng(777);
  const bark = swayMaterial({ map: textures.bark, roughness: 0.92, metalness: 0 }, 0.6, false);
  const palmBark = swayMaterial({ map: textures.palmBark, roughness: 0.9 }, 0.6, false);
  const palmLeaf = swayMaterial({ map: textures.leaves.palm, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.7, color: 0xffffe0 }, 0.6, true);
  const broadLeaf = swayMaterial({ map: textures.leaves.broad, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, color: 0xd8ecb0 }, 0.5, true);
  const pineLeaf = swayMaterial({ map: textures.leaves.pine, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9, color: 0xc8dcc0 }, 0.35, true);
  const bushLeaf = swayMaterial({ map: textures.leaves.broad, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, color: 0xc0d8a0 }, 0.3, true);
  const palm = [0, 1, 2].map(i => ({ geometry: palmGeo(rng, [9, 11, 7.5][i]), material: [palmBark, palmLeaf] }));
  const tree = [0, 1, 2].map(i => ({ geometry: treeGeo(rng, [6, 7.5, 5][i], [2.4, 2.9, 2.0][i]), material: [bark, broadLeaf] }));
  const pine = [0, 1].map(i => ({ geometry: pineGeo(rng, [10, 13][i]), material: [bark, pineLeaf] }));
  const bush = [0, 1].map(() => ({ geometry: bushGeo(rng), material: [bark, bushLeaf] }));
  return { palm, tree, pine, bush, materials: [bark, palmBark, palmLeaf, broadLeaf, pineLeaf, bushLeaf] };
}
