// Ground rendering: terrain (splat), block platforms/lots/curbs, overlays, lane markings, medians, hill roads,
// pier, seawalls, pools, stunt ramps.
//   buildGround(city, textures, opts) -> { group, groundMat, terrainMat, markMat, update(env) }
import * as THREE from 'three';
import { GROUND } from './citygen.js';
import { GROUND_TILE } from '../gfx/textures.js';
import { FACADE_GLSL_PERTURB } from './buildings.js';
import { SURFACE, WATER_LEVEL } from './terrain.js';
import { LANE_W, cumulative } from './roads.js';

const GL = { SIDEWALK: 0, CONCRETE: 1, PAVERS: 2, GRASS: 3, PARKING: 4, DIRT: 5, SAND: 6, GRAVEL: 7, WOOD: 8, ASPHALT: 9, ROCK: 10, DRYGRASS: 11 };

// ------------------------------------------------------------------ materials
function groundCommon(U) {
  return `
uniform highp sampler2DArray tGround; uniform highp sampler2DArray tGroundH; uniform sampler2D tNoise;
uniform float uTile[14]; uniform float uWet; uniform float uWaterLevel;
varying vec3 vGWorld;
vec4 gAlb; float gH; float gPaved;
${FACADE_GLSL_PERTURB}
void gLayer(float layer, float w, vec2 xz) {
  if (w < 0.003) return;
  vec2 uv = xz / uTile[int(layer + 0.5)];
  gAlb += texture(tGround, vec3(uv, layer)) * w;
  gH += texture(tGroundH, vec3(uv, layer)).r * w;
}`;
}
function patchGround(m, U, terrain) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vGWorld; ${terrain ? '' : 'attribute float aGround; attribute vec2 aUv; varying float vGL; varying vec2 vGUv;'}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz; ${terrain ? '' : 'vGL = aGround; vGUv = aUv;'}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${groundCommon(U)}
${terrain ? 'uniform sampler2D tSplat; uniform vec4 uSplat;' : 'varying float vGL; varying vec2 vGUv;'}`)
      .replace('#include <map_fragment>', terrain ? `
gAlb = vec4(0.0); gH = 0.0;
vec2 xz = vGWorld.xz;
vec4 sp = texture(tSplat, (xz - uSplat.xy) * uSplat.zw);
float tot = sp.r + sp.g + sp.b + sp.a;
gPaved = clamp(1.0 - tot, 0.0, 1.0);
vec4 nz = texture(tNoise, xz * 0.0021);
float dry = smoothstep(0.38, 0.7, nz.r) * 0.85;
gLayer(6.0, sp.r, xz);
gLayer(3.0, sp.g * (1.0 - dry), xz);
gLayer(11.0, sp.g * dry, xz);
gLayer(10.0, sp.b, xz * 0.9);
gLayer(5.0, sp.a, xz);
gLayer(9.0, gPaved, xz);
float macro = texture(tNoise, xz * 0.0009).g;
gAlb.rgb *= 0.82 + 0.36 * macro;
float depth = uWaterLevel - vGWorld.y;
if (depth > 0.0) gAlb.rgb *= mix(vec3(1.0), vec3(0.42, 0.66, 0.66), clamp(depth / 5.0, 0.0, 1.0));
diffuseColor.rgb = gAlb.rgb;` : `
gAlb = vec4(0.0); gH = 0.0; gPaved = 1.0;
gLayer(vGL, 1.0, vGUv);
float macro = texture(tNoise, vGWorld.xz * 0.0011).g;
gAlb.rgb *= 0.88 + 0.24 * macro;
if (vGL > 2.5 && vGL < 3.5) gPaved = 0.0;
diffuseColor.rgb = gAlb.rgb;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(gAlb.a, 0.08, uWet * gPaved * 0.85);
diffuseColor.rgb *= 1.0 - uWet * 0.38 * gPaved;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = 0.0;`)
      .replace('#include <normal_fragment_maps>', `{ vec2 dH = vec2(dFdx(gH), dFdy(gH)); normal = fPerturb(-vViewPosition, normal, dH * 1.6, faceDirection); }`);
  };
}
export function createGroundMaterials(tex, terrain) {
  const U = {
    tGround: { value: tex.ground.albedo }, tGroundH: { value: tex.ground.height }, tNoise: { value: tex.noise },
    uTile: { value: GROUND_TILE.slice() }, uWet: { value: 0 }, uWaterLevel: { value: WATER_LEVEL },
  };
  const ground = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  ground.envMapIntensity = 1.0;
  patchGround(ground, U, false); ground.customProgramCacheKey = () => 'ground-v1';
  const overlay = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  overlay.envMapIntensity = 1.0;
  patchGround(overlay, U, false); overlay.customProgramCacheKey = () => 'ground-v1o';
  // terrain splat
  const { nx, nz, originX, originZ, cell, surface } = terrain;
  const sd = new Uint8Array(nx * nz * 4);
  for (let i = 0; i < nx * nz; i++) {
    const s = surface[i], p = i * 4;
    if (s === SURFACE.SAND || s === SURFACE.WATER) sd[p] = 255;
    else if (s === SURFACE.GRASS) sd[p + 1] = 255;
    else if (s === SURFACE.ROCK) sd[p + 2] = 255;
    else if (s === SURFACE.DIRT) sd[p + 3] = 255;
  }
  const st = new THREE.DataTexture(sd, nx, nz, THREE.RGBAFormat);
  st.magFilter = THREE.LinearFilter; st.minFilter = THREE.LinearFilter; st.needsUpdate = true;
  const TU = { ...U, tSplat: { value: st }, uSplat: { value: new THREE.Vector4(originX - cell / 2, originZ - cell / 2, 1 / (cell * nx), 1 / (cell * nz)) } };
  const terr = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  patchGround(terr, TU, true); terr.customProgramCacheKey = () => 'terrain-v1';
  return { ground, overlay, terrain: terr, uniforms: U, splat: st };
}

// ------------------------------------------------------------------ geometry buffers
class GBuf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.l = []; this.c = []; }
  quad(a, b, c, d, n, uva, uvb, uvc, uvd, layer, col = [1, 1, 1]) {
    for (const [v, t] of [[a, uva], [b, uvb], [c, uvc], [a, uva], [c, uvc], [d, uvd]]) {
      this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(t[0], t[1]); this.l.push(layer); this.c.push(col[0], col[1], col[2]);
    }
  }
  /** horizontal rect at y (world-space uv) */
  rect(x0, x1, z0, z1, y, layer, col) { this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [x0, z1], [x1, z1], [x1, z0], [x0, z0], layer, col); }
  /** vertical face from A to B (outward normal = (-dz, dx)) between y0,y1 */
  wall(ax, az, bx, bz, y0, y1, layer, col) {
    const len = Math.hypot(bx - ax, bz - az); if (len < 1e-3) return;
    const nx = -(bz - az) / len, nz = (bx - ax) / len, u0 = ax * nz * 0 + (ax + az) * 0;
    this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [nx, 0, nz], [0, y0], [len, y0], [len, y1], [0, y1], layer, col);
  }
  box(x0, x1, z0, z1, y0, y1, layer, col, topLayer = layer) {
    this.wall(x1, z0, x0, z0, y0, y1, layer, col); this.wall(x0, z1, x1, z1, y0, y1, layer, col);
    this.wall(x0, z0, x0, z1, y0, y1, layer, col); this.wall(x1, z1, x1, z0, y0, y1, layer, col);
    this.rect(x0, x1, z0, z1, y1, topLayer, col);
  }
  get empty() { return this.p.length === 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aGround', new THREE.Float32BufferAttribute(this.l, 1));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}
class MBuf { // markings: position + color
  constructor() { this.p = []; this.c = []; }
  quad(a, b, c, d, col) { this.p.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) this.c.push(col[0], col[1], col[2]); }
  /** rect in road-local frame: origin o, dir d (unit xz), right r; s0..s1 along, l0..l1 lateral, at height y */
  seg(ox, oz, dx, dz, s0, s1, l0, l1, y, col) {
    const rx = -dz, rz = dx;
    const P = (s, l) => [ox + dx * s + rx * l, y, oz + dz * s + rz * l];
    this.quad(P(s0, l1), P(s1, l1), P(s1, l0), P(s0, l0), col);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    const n = new Float32Array(this.p.length); for (let i = 1; i < n.length; i += 3) n[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const WHITE = [0.86, 0.86, 0.84], YELLOW = [0.95, 0.72, 0.16];

// ------------------------------------------------------------------ builders
function buildTerrain(city, mats, group) {
  const T = city.terrain, { nx, nz, cell, originX, originZ, heights } = T;
  const CH = 50; // cells per chunk
  let tris = 0;
  for (let cz = 0; cz < nz - 1; cz += CH) for (let cx = 0; cx < nx - 1; cx += CH) {
    const ex = Math.min(cx + CH, nx - 1), ez = Math.min(cz + CH, nz - 1);
    let mn = Infinity, mx = -Infinity;
    for (let iz = cz; iz <= ez; iz++) for (let ix = cx; ix <= ex; ix++) { const h = heights[iz * nx + ix]; if (h < mn) mn = h; if (h > mx) mx = h; }
    if (mx < -9) continue; // deep sea: hidden by water
    const flat = mx - mn < 0.001;
    const step = flat ? Math.max(ex - cx, ez - cz) : 1;
    const w = flat ? 1 : ex - cx, d = flat ? 1 : ez - cz;
    const vx = w + 1, vz = d + 1;
    const pos = new Float32Array(vx * vz * 3), nor = new Float32Array(vx * vz * 3);
    const nrm = { x: 0, y: 1, z: 0 };
    for (let j = 0; j < vz; j++) for (let i = 0; i < vx; i++) {
      const ix = flat ? (i ? ex : cx) : cx + i, iz = flat ? (j ? ez : cz) : cz + j;
      const x = originX + ix * cell, z = originZ + iz * cell, h = heights[iz * nx + ix];
      const k = (j * vx + i) * 3;
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
      T.normalAt(x, z, nrm); nor[k] = nrm.x; nor[k + 1] = nrm.y; nor[k + 2] = nrm.z;
    }
    const idx = [];
    for (let j = 0; j < vz - 1; j++) for (let i = 0; i < vx - 1; i++) {
      const a = j * vx + i, b = a + 1, c = a + vx, e = c + 1;
      idx.push(a, c, b, b, c, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats.terrain);
    m.receiveShadow = true; m.castShadow = !flat && mx > 5; m.matrixAutoUpdate = false;
    group.add(m); tris += idx.length / 3;
  }
  return tris;
}

function chunker(size = 256) {
  const map = new Map();
  return {
    get(x, z, make) { const k = Math.floor(x / size) + ',' + Math.floor(z / size); let c = map.get(k); if (!c) map.set(k, c = make()); return c; },
    values() { return map.values(); },
  };
}

function buildBlocks(city, mats, group) {
  const ch = chunker(), och = chunker();
  const CURB = [0.84, 0.83, 0.8];
  for (const b of city.blocks) {
    if (b.kind === 'pad') continue;
    const buf = ch.get(b.cx, b.cz, () => new GBuf()).valueOf();
    const y = b.top, SW = 5, cw = 0.3;
    if (b.kind === 'apron') {
      const ob = och.get(b.cx, b.cz, () => new GBuf());
      ob.rect(b.x0, b.x1, b.z0, b.z1, 0.03, GL.CONCRETE);
      continue;
    }
    // curb faces
    buf.wall(b.x1, b.z0, b.x0, b.z0, -0.3, y, GL.CONCRETE, CURB); buf.wall(b.x0, b.z1, b.x1, b.z1, -0.3, y, GL.CONCRETE, CURB);
    buf.wall(b.x0, b.z0, b.x0, b.z1, -0.3, y, GL.CONCRETE, CURB); buf.wall(b.x1, b.z1, b.x1, b.z0, -0.3, y, GL.CONCRETE, CURB);
    // curb stone ring
    buf.rect(b.x0, b.x1, b.z0, b.z0 + cw, y, GL.CONCRETE, CURB); buf.rect(b.x0, b.x1, b.z1 - cw, b.z1, y, GL.CONCRETE, CURB);
    buf.rect(b.x0, b.x0 + cw, b.z0 + cw, b.z1 - cw, y, GL.CONCRETE, CURB); buf.rect(b.x1 - cw, b.x1, b.z0 + cw, b.z1 - cw, y, GL.CONCRETE, CURB);
    const ix0 = b.x0 + cw, ix1 = b.x1 - cw, iz0 = b.z0 + cw, iz1 = b.z1 - cw;
    if (b.kind === 'strip') {
      buf.rect(ix0, ix1, iz0, iz1, y, b.promenade ? GL.PAVERS : GL.SIDEWALK);
      continue;
    }
    // sidewalk ring
    const s = SW;
    buf.rect(ix0, ix1, iz0, b.z0 + s, y, GL.SIDEWALK); buf.rect(ix0, ix1, b.z1 - s, iz1, y, GL.SIDEWALK);
    buf.rect(ix0, b.x0 + s, b.z0 + s, b.z1 - s, y, GL.SIDEWALK); buf.rect(b.x1 - s, ix1, b.z0 + s, b.z1 - s, y, GL.SIDEWALK);
    // lots
    const inner = { x0: b.x0 + s, x1: b.x1 - s, z0: b.z0 + s, z1: b.z1 - s };
    if (!b.lots.length) buf.rect(inner.x0, inner.x1, inner.z0, inner.z1, y, GL.CONCRETE);
    for (const l of b.lots) buf.rect(l.x0, l.x1, l.z0, l.z1, y, l.surface);
  }
  for (const o of city.overlays) och.get((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2, () => new GBuf()).rect(o.x0, o.x1, o.z0, o.z1, o.y + 0.01, o.surface);
  // boulevard / coastal medians
  for (const e of city.roads.edges) {
    if (!e.median || e.cls === 'hill') continue;
    const p = e.points, a = p[0], c = p[p.length - 1], L = e.length;
    const dx = (c.x - a.x) / L, dz = (c.z - a.z) / L;
    const s0 = e.cutA, s1 = L - e.cutB, hw = e.median / 2;
    const x0 = Math.min(a.x + dx * s0, a.x + dx * s1) - Math.abs(dz) * hw, x1 = Math.max(a.x + dx * s0, a.x + dx * s1) + Math.abs(dz) * hw;
    const z0 = Math.min(a.z + dz * s0, a.z + dz * s1) - Math.abs(dx) * hw, z1 = Math.max(a.z + dz * s0, a.z + dz * s1) + Math.abs(dx) * hw;
    const buf = ch.get((x0 + x1) / 2, (z0 + z1) / 2, () => new GBuf());
    buf.box(x0, x1, z0, z1, -0.3, 0.15, GL.CONCRETE, CURB, e.cls === 'boulevard' ? GL.GRASS : GL.PAVERS);
    e.medianRect = { x0, x1, z0, z1 };
  }
  let n = 0;
  for (const buf of ch.values()) { if (buf.empty) continue; const m = new THREE.Mesh(buf.geometry(), mats.ground); m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); n++; }
  for (const buf of och.values()) { if (buf.empty) continue; const m = new THREE.Mesh(buf.geometry(), mats.overlay); m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); }
  return n;
}

function buildMarkings(city, markMat, group) {
  const ch = chunker();
  const Y = 0.012;
  const nodes = city.roads.nodes;
  for (const e of city.roads.edges) {
    const buf = ch.get((e.points[0].x + e.points[e.points.length - 1].x) / 2, (e.points[0].z + e.points[e.points.length - 1].z) / 2, () => new MBuf());
    if (e.cls === 'hill') { hillMarkings(city, e, buf); continue; }
    const p = e.points, a = p[0], c = p[p.length - 1], L = e.length;
    const dx = (c.x - a.x) / L, dz = (c.z - a.z) / L;
    const s0 = e.cutA, s1 = L - e.cutB, hm = e.median / 2, nl = e.lanesFwd;
    const dash = (lat, w, col, on = 3, off = 6) => { for (let s = s0 + 1; s < s1 - 1; s += on + off) buf.seg(a.x, a.z, dx, dz, s, Math.min(s + on, s1 - 1), lat - w / 2, lat + w / 2, Y, col); };
    const solid = (lat, w, col) => buf.seg(a.x, a.z, dx, dz, s0, s1, lat - w / 2, lat + w / 2, Y, col);
    if (e.cls === 'street') { dash(0, 0.12, YELLOW, 3, 5); solid(LANE_W + 0.1, 0.1, WHITE); solid(-LANE_W - 0.1, 0.1, WHITE); }
    else if (e.cls === 'avenue') { solid(-0.12, 0.1, YELLOW); solid(0.12, 0.1, YELLOW); dash(LANE_W, 0.12, WHITE); dash(-LANE_W, 0.12, WHITE); solid(2 * LANE_W + 0.1, 0.12, WHITE); solid(-2 * LANE_W - 0.1, 0.12, WHITE); }
    else { // boulevard, coastal (raised median)
      solid(hm + 0.2, 0.12, YELLOW); solid(-hm - 0.2, 0.12, YELLOW);
      dash(hm + LANE_W, 0.12, WHITE); dash(-hm - LANE_W, 0.12, WHITE);
      solid(hm + 2 * LANE_W + 0.1, 0.12, WHITE); solid(-hm - 2 * LANE_W - 0.1, 0.12, WHITE);
    }
    // stop lines + crosswalks at both ends
    for (const end of [0, 1]) {
      const n = nodes[end ? e.b : e.a];
      if (!n.grid) continue;
      const cut = end ? e.cutB : e.cutA;
      const ch2 = n.crossHalf ? n.crossHalf[e.id] || 0 : 0;
      if (ch2 <= 0) continue;
      // along-coordinate measured from a: node at s=0 (end 0) or s=L (end 1)
      const sAt = (d) => end ? L - d : d;
      if (n.signal) {
        const sa = sAt(cut), sb = sAt(cut - 0.5);
        const [l0, l1] = end ? [hm + 0.15, hm + nl * LANE_W] : [-hm - nl * LANE_W, -hm - 0.15];
        buf.seg(a.x, a.z, dx, dz, Math.min(sa, sb), Math.max(sa, sb), l0, l1, Y, WHITE);
      }
      const hw = e.width / 2 - 0.4;
      const ca = sAt(ch2 + 0.6), cb = sAt(ch2 + 4.4);
      for (let l = -hw; l < hw - 0.3; l += 1.1) buf.seg(a.x, a.z, dx, dz, Math.min(ca, cb), Math.max(ca, cb), l, l + 0.55, Y + 0.001, WHITE);
    }
  }
  // parking lot stalls
  for (const b of city.blocks) for (const l of b.lots) {
    if (!l.stalls) continue;
    const buf = ch.get((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2, () => new MBuf());
    const W = l.x1 - l.x0, D = l.z1 - l.z0, alongX = W >= D;
    const rows = Math.floor((alongX ? D : W) / 11);
    for (let r = 0; r < rows; r++) {
      const c0 = (alongX ? l.z0 : l.x0) + 1 + r * 11;
      for (let s = (alongX ? l.x0 : l.z0) + 0.55; s < (alongX ? l.x1 : l.z1) - 1; s += 2.9) {
        if (alongX) buf.seg(s, c0, 0, 1, 0, 9, -0.05, 0.05, b.top + 0.012, WHITE);
        else buf.seg(c0, s, 1, 0, 0, 9, -0.05, 0.05, b.top + 0.012, WHITE);
      }
    }
  }
  for (const buf of ch.values()) { if (!buf.p.length) continue; const m = new THREE.Mesh(buf.geometry(), markMat); m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); }
}
function stripAlong(pts, T, off0, off1, yOff, pushQuad, dashOn = 0, dashOff = 0) {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const side = (i, off) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const x = pts[i].x - dz * off, z = pts[i].z + dx * off;
    return [x, T.heightAt(x, z) + yOff, z];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    if (dashOn) { const ph = (cum[i] % (dashOn + dashOff)); if (ph > dashOn) continue; }
    pushQuad(side(i, off1), side(i + 1, off1), side(i + 1, off0), side(i, off0));
  }
}
function hillMarkings(city, e, buf) {
  const T = city.terrain, pts = e.points;
  const q = (col) => (a, b, c, d) => buf.quad(a, b, c, d, col);
  stripAlong(pts, T, -0.08, 0.08, 0.06, q(YELLOW), 3, 5);
  stripAlong(pts, T, 3.9, 4.05, 0.06, q(WHITE));
  stripAlong(pts, T, -4.05, -3.9, 0.06, q(WHITE));
}
function buildHillRoads(city, mats, group) {
  const T = city.terrain, buf = new GBuf();
  for (const e of [city.hill.roadA, city.hill.roadB, city.hill.spur]) {
    const pts = e.points;
    const push = (layer, col) => (a, b, c, d) => buf.quad(a, b, c, d, [0, 1, 0], [a[0], a[2]], [b[0], b[2]], [c[0], c[2]], [d[0], d[2]], layer, col);
    stripAlong(pts, T, -4.6, 4.6, 0.04, push(GL.ASPHALT));
    stripAlong(pts, T, 4.6, 6.2, 0.02, push(GL.GRAVEL, [0.9, 0.88, 0.84]));
    stripAlong(pts, T, -6.2, -4.6, 0.02, push(GL.GRAVEL, [0.9, 0.88, 0.84]));
  }
  // lookout pad
  const lk = city.hill.lookout;
  const pad = city.areas.hillPads[0];
  if (pad) buf.rect(pad.x - pad.hx + 4, pad.x + pad.hx - 4, pad.z - pad.hz + 4, pad.z + pad.hz - 4, pad.y + 0.05, GL.PARKING);
  // fix normals for sloped strips: recompute from triangles
  const g = buf.geometry();
  const pos = g.attributes.position.array, nor = g.attributes.normal.array;
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2], bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5], cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const l = Math.hypot(nx, ny, nz) || 1; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (let k = 0; k < 3; k++) { nor[i + k * 3] = nx / l; nor[i + k * 3 + 1] = ny / l; nor[i + k * 3 + 2] = nz / l; }
  }
  const m = new THREE.Mesh(g, mats.overlay); m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m);
}

function buildPierAndShore(city, mats, group) {
  const buf = new GBuf(), P = city.areas.pier, y = P.y;
  const W = [0.95, 0.9, 0.85], DARK = [0.55, 0.5, 0.45];
  if (P) {
    // ramp deck (sloped)
    const z0 = P.z - P.w / 2, z1 = P.z + P.w / 2;
    const rx0 = P.rampEnd, rx1 = P.x1;
    buf.quad([rx0, y, z1], [rx1, 0.15, z1], [rx1, 0.15, z0], [rx0, y, z0], [-(y - 0.15) / (rx1 - rx0), 1, 0], [rx0, z1], [rx1, z1], [rx1, z0], [rx0, z0], GL.WOOD, W);
    buf.wall(rx1, z0, rx0, z0, -0.5, 0.15, GL.WOOD, DARK); buf.wall(rx0, z1, rx1, z1, -0.5, 0.15, GL.WOOD, DARK);
    // deck + head
    buf.box(P.x0 + 32, rx0, z0, z1, y - 0.45, y, GL.WOOD, W);
    const h = P.head; buf.box(h.x0, h.x1, h.z0, h.z1, y - 0.45, y, GL.WOOD, W);
    // pilings & railings
    for (let x = rx0 - 4; x > h.x0; x -= 8) for (const s of [-1, 1]) {
      const zz = P.z + s * (P.w / 2 - 0.5);
      buf.box(x - 0.3, x + 0.3, zz - 0.3, zz + 0.3, -13, y - 0.45, GL.WOOD, [0.5, 0.42, 0.35]);
    }
    const rail = (x0, z0_, x1, z1_) => {
      const len = Math.hypot(x1 - x0, z1_ - z0_), n = Math.max(1, Math.round(len / 2.5));
      for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, z = z0_ + (z1_ - z0_) * i / n; buf.box(x - 0.07, x + 0.07, z - 0.07, z + 0.07, y, y + 1.1, GL.WOOD, [1, 1, 1]); }
      const dx = (x1 - x0) / len, dz = (z1_ - z0_) / len, rx = -dz * 0.05, rz = dx * 0.05;
      for (const hh of [0.55, 1.05]) {
        buf.quad([x0 - rx, y + hh, z0_ - rz], [x1 - rx, y + hh, z1_ - rz], [x1 - rx, y + hh + 0.08, z1_ - rz], [x0 - rx, y + hh + 0.08, z0_ - rz], [-dz, 0, dx], [0, 0], [len, 0], [len, 0.1], [0, 0.1], GL.WOOD, [1, 1, 1]);
        buf.quad([x1 + rx, y + hh, z1_ + rz], [x0 + rx, y + hh, z0_ + rz], [x0 + rx, y + hh + 0.08, z0_ + rz], [x1 + rx, y + hh + 0.08, z1_ + rz], [dz, 0, -dx], [0, 0], [len, 0], [len, 0.1], [0, 0.1], GL.WOOD, [1, 1, 1]);
      }
    };
    rail(rx0, z0 + 0.1, h.x1, z0 + 0.1); rail(rx0, z1 - 0.1, h.x1, z1 - 0.1);
    rail(h.x1, h.z0 + 0.1, h.x1, z0); rail(h.x1, z1, h.x1, h.z1 - 0.1); rail(h.x0 + 0.1, h.z0, h.x0 + 0.1, h.z1);
    rail(h.x0, h.z0 + 0.1, h.x1, h.z0 + 0.1); rail(h.x0, h.z1 - 0.1, h.x1, h.z1 - 0.1);
  }
  // seawalls / quays
  const T = city.terrain;
  for (const q of city.areas.quays) {
    const [ax, az] = q.a, [bx, bz] = q.b, len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    // outward normal (-dz, dx) must point to water
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const toWater = T.heightAt(mx - dz * 6, mz + dx * 6) < T.heightAt(mx + dz * 6, mz - dx * 6);
    const [sx, sz, ex, ez] = toWater ? [ax, az, bx, bz] : [bx, bz, ax, az];
    const top = q.top;
    buf.wall(sx, sz, ex, ez, -11, top, GL.CONCRETE, [0.72, 0.72, 0.7]);
    // dark wet band
    const ndx = -(ez - sz) / len, ndz = (ex - sx) / len;
    buf.wall(sx + ndx * 0.02, sz + ndz * 0.02, ex + ndx * 0.02, ez + ndz * 0.02, -11, WATER_LEVEL + 0.5, GL.CONCRETE, [0.34, 0.36, 0.33]);
  }
  // pools
  for (const pl of city.pools) {
    const x0 = pl.x - pl.w / 2, x1 = pl.x + pl.w / 2, z0 = pl.z - pl.d / 2, z1 = pl.z + pl.d / 2;
    buf.box(x0 - 0.45, x1 + 0.45, z0 - 0.45, z0, pl.y, pl.y + 0.08, GL.CONCRETE, [1, 1, 1]);
    buf.box(x0 - 0.45, x1 + 0.45, z1, z1 + 0.45, pl.y, pl.y + 0.08, GL.CONCRETE, [1, 1, 1]);
    buf.box(x0 - 0.45, x0, z0, z1, pl.y, pl.y + 0.08, GL.CONCRETE, [1, 1, 1]);
    buf.box(x1, x1 + 0.45, z0, z1, pl.y, pl.y + 0.08, GL.CONCRETE, [1, 1, 1]);
  }
  const m = new THREE.Mesh(buf.geometry(), mats.ground); m.receiveShadow = true; m.castShadow = true; m.matrixAutoUpdate = false; group.add(m);
  // pool water
  const pw = [];
  for (const pl of city.pools) pw.push(pl);
  if (pw.length) {
    const pos = [];
    for (const pl of pw) { const x0 = pl.x - pl.w / 2, x1 = pl.x + pl.w / 2, z0 = pl.z - pl.d / 2, z1 = pl.z + pl.d / 2, yy = pl.y + 0.04; pos.push(x0, yy, z1, x1, yy, z1, x1, yy, z0, x0, yy, z1, x1, yy, z0, x0, yy, z0); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1fa9c9, roughness: 0.12, metalness: 0.1, emissive: 0x053a4a, emissiveIntensity: 0.6, polygonOffset: true, polygonOffsetFactor: -3 });
    const pm = new THREE.Mesh(g, mat); pm.matrixAutoUpdate = false; group.add(pm);
  }
}

function rampTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2c230'; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#161616';
  for (let x = -256; x < 512; x += 64) { ctx.beginPath(); ctx.moveTo(x, 256); ctx.lineTo(x + 32, 256); ctx.lineTo(x + 160, 0); ctx.lineTo(x + 128, 0); ctx.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function plateTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const ctx = c.getContext('2d');
  ctx.fillStyle = '#8b8e91'; ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) for (let x = (y / 32) % 2 * 16; x < 256; x += 32) { ctx.save(); ctx.translate(x + 8, y + 16); ctx.rotate(0.7); ctx.fillStyle = '#b3b6b9'; ctx.fillRect(-10, -2.5, 20, 5); ctx.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function buildRamps(city, group) {
  const side = new THREE.MeshStandardMaterial({ map: rampTexture(), roughness: 0.6, metalness: 0.2 });
  const top = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.45, metalness: 0.7 });
  for (const r of city.ramps) {
    const hw = r.width / 2, hl = r.length / 2, H = r.height;
    const g = new THREE.BufferGeometry();
    // local: z from -hl (low, y=0) to +hl (high, y=H)
    const P = [
      [-hw, 0, -hl], [hw, 0, -hl], [hw, H, hl], [-hw, H, hl], // top slope
      [-hw, 0, -hl], [-hw, H, hl], [-hw, 0, hl],              // left side
      [hw, 0, -hl], [hw, 0, hl], [hw, H, hl],                 // right side
      [-hw, 0, hl], [-hw, H, hl], [hw, H, hl], [hw, 0, hl],   // back
    ];
    const pos = [], uv = [], groups = [];
    const push = (i, u, v) => { pos.push(...P[i]); uv.push(u, v); };
    // top (two tris)
    push(0, 0, 0); push(1, 1, 0); push(2, 1, 3); push(0, 0, 0); push(2, 1, 3); push(3, 0, 3);
    // left side (normal -x): order so CCW from -x
    push(4, 0, 0); push(6, 1, 0); push(5, 1, 0.5);
    push(7, 0, 0); push(9, 1, 0.5); push(8, 1, 0);
    // back (normal +z)
    push(13, 0, 0); push(12, 0, 0.5); push(11, 1, 0.5); push(13, 0, 0); push(11, 1, 0.5); push(10, 1, 0);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.addGroup(0, 6, 0); g.addGroup(6, 12, 1);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, [top, side]);
    m.position.set(r.x, r.y, r.z); m.rotation.y = r.yaw; m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
}

export function buildGround(city, textures) {
  const group = new THREE.Group(); group.name = 'ground';
  const mats = createGroundMaterials(textures, city.terrain);
  const markMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  markMat.onBeforeCompile = (sh) => {
    sh.uniforms.tNoise = { value: textures.noise }; sh.uniforms.uWet = mats.uniforms.uWet;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvMW = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tNoise; uniform float uWet; varying vec3 vMW;')
      .replace('#include <color_fragment>', `#include <color_fragment>
float wear = texture(tNoise, vMW.xz * 0.35).r * 0.6 + texture(tNoise, vMW.xz * 0.05).g * 0.6;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2), smoothstep(0.55, 0.95, wear) * 0.7);
diffuseColor.rgb *= 1.0 - uWet * 0.3;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.15, uWet * 0.8);');
  };
  markMat.customProgramCacheKey = () => 'marks-v1';
  const terrainTris = buildTerrain(city, mats, group);
  buildBlocks(city, mats, group);
  buildMarkings(city, markMat, group);
  buildHillRoads(city, mats, group);
  buildPierAndShore(city, mats, group);
  buildRamps(city, group);
  return {
    group, mats, markMat, terrainTris,
    update(env) { mats.uniforms.uWet.value = env.wetness || 0; },
  };
}
