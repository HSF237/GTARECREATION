// Building geometry + facade material.
//   createFacadeMaterial(textures) -> MeshStandardMaterial (uniforms in material.userData.uniforms: uNight, uLitFrac)
//   buildBuildings(city, textures, facadeMat) -> { group, chunks:[Mesh], signMat, lightsMat, beacons:{mesh, update(t, night)} }
// Geometry attributes: position, normal, aUv (tile units), aLayer, color (tint), aSeed, aLit.
import * as THREE from 'three';
import { FACADES } from './citygen.js';
import { makeRng } from '../core/rng.js';

const L = (n) => FACADES[n].layer;
// per facade layer: window cells per tile (u,v), lit boost, intensity
const WIN_GRID = [
  [2, 2, 1, 1], [2, 2, 1, 1], [2, 2, 1, 1], [2, 2, 1, 1], [2, 2, 1, 1], [2, 2, 1, 1], [2, 2, 1, 1], [4, 2, 1, 1],
  [2, 1, 1.7, 1.4], [4, 1, 0.5, 0.5], [1, 1, 1.2, 1.1], [1, 1, 1.2, 1.1], [2, 1, 2.6, 0.45], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
];
const TILE_SZ = [[6, 8], [6, 8], [6, 8], [6, 7.2], [5, 7], [5, 7], [6, 6.4], [8, 7.2], [8, 4.5], [8, 12], [6, 3], [6, 3], [6, 3.2], [8, 8], [4, 4], [4, 4], [2.4, 2.4], [2.4, 2.4], [6, 2.6]];
export const FACADE_GLSL_PERTURB = `
vec3 fPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 dx = dFdx(surf_pos.xyz), dy = dFdy(surf_pos.xyz);
  float lx = length(dx), ly = length(dy);
  if (lx < 1e-7 || ly < 1e-7) return surf_norm;
  vec3 vSigmaX = dx / lx, vSigmaY = dy / ly;
  vec3 R1 = cross(vSigmaY, surf_norm); vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (clamp(dHdxy.x, -0.25, 0.25) * R1 + clamp(dHdxy.y, -0.25, 0.25) * R2);
  vec3 n = abs(fDet) * surf_norm - vGrad;
  float ln = length(n);
  return ln > 1e-6 ? n / ln : surf_norm;
}
float fHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

export function createFacadeMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const U = m.userData.uniforms = {
    tFacade: { value: tex.facade.albedo }, tFacadeMask: { value: tex.facade.mask }, uNight: { value: 0 }, uLitFrac: { value: 1 },
    uWinGrid: { value: WIN_GRID.map(a => new THREE.Vector4(...a)) }, uWet: { value: 0 },
    uTileSz: { value: TILE_SZ.map(a => new THREE.Vector2(...a)) },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aUv; attribute float aLayer; attribute float aSeed; attribute float aLit;
varying vec2 vFUv; flat varying float vLayer; flat varying float vSeed; flat varying float vLit; varying vec3 vFWorld; varying vec3 vFNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFUv = aUv; vLayer = aLayer; vSeed = aSeed; vLit = aLit;
vFWorld = (modelMatrix * vec4(transformed, 1.0)).xyz; vFNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform highp sampler2DArray tFacade; uniform highp sampler2DArray tFacadeMask; uniform float uNight; uniform float uLitFrac; uniform vec4 uWinGrid[19]; uniform vec2 uTileSz[19];
varying vec2 vFUv; flat varying float vLayer; flat varying float vSeed; flat varying float vLit; varying vec3 vFWorld; varying vec3 vFNormal;
vec4 fAlb; vec4 fMsk; vec3 fRoom; float fRoomOk;
${FACADE_GLSL_PERTURB}
// interior mapping: ray-march a virtual room box behind each window cell
vec3 roomColor(vec2 cellF, vec2 cellId, vec2 cm, vec3 Vw, vec3 Nw, float seed) {
  vec3 T = vec3(Nw.z, 0.0, -Nw.x);
  vec3 d = vec3(dot(Vw, T), Vw.y, dot(Vw, Nw));
  d.z = min(d.z, -0.05);
  vec3 p = vec3(cellF * cm, 0.0);
  float depthR = max(cm.x, 2.8) * 1.15;
  float tx = (d.x > 0.0 ? (cm.x - p.x) : -p.x) / (abs(d.x) < 1e-4 ? 1e-4 : d.x);
  float ty = (d.y > 0.0 ? (cm.y - p.y) : -p.y) / (abs(d.y) < 1e-4 ? 1e-4 : d.y);
  float tz = -depthR / d.z;
  tx = abs(tx); ty = abs(ty);
  float t = min(tx, min(ty, tz));
  vec3 h = p + d * t;
  float r = fHash(cellId + seed * 13.1);
  vec3 base = r < 0.55 ? vec3(1.0, 0.74, 0.48) : r < 0.85 ? vec3(0.96, 0.9, 0.8) : vec3(0.62, 0.76, 1.0);
  float depthF = clamp(-h.z / depthR, 0.0, 1.0);
  vec3 c;
  if (t == tz) {
    c = base * 0.8;
    float fx0 = fHash(cellId * 1.3 + seed) * 0.6, fw = 0.25 + fHash(cellId * 2.1 + seed) * 0.35;
    float u = h.x / cm.x;
    if (u > fx0 && u < fx0 + fw && h.y < cm.y * (0.25 + 0.2 * fHash(cellId * 3.7))) c *= 0.25;
    if (fHash(cellId * 5.3 + seed) > 0.6 && u > 0.2 && u < 0.45 && h.y > cm.y * 0.35 && h.y < cm.y * 0.6) c = mix(c, base * 1.6, 0.8);
  } else if (t == tx) c = base * (0.62 - 0.2 * depthF);
  else if (d.y < 0.0) c = base * vec3(0.5, 0.42, 0.36) * (0.8 - 0.3 * depthF);
  else c = base * (1.25 - 0.4 * depthF);
  return c * (1.0 - 0.35 * depthF);
}`)
      .replace('#include <map_fragment>', `fAlb = texture(tFacade, vec3(vFUv, vLayer)); fMsk = texture(tFacadeMask, vec3(vFUv, vLayer));
diffuseColor.rgb = fAlb.rgb;
fRoom = vec3(0.0); fRoomOk = 0.0;
{
  int li0 = int(vLayer + 0.5);
  vec4 wg0 = uWinGrid[li0];
  if (wg0.x > 0.0 && fMsk.r > 0.2 && abs(vFNormal.y) < 0.5) {
    vec2 cm = uTileSz[li0] / wg0.xy;
    vec2 cid = floor(vFUv * wg0.xy);
    vec3 Vw = normalize(vFWorld - cameraPosition);
    float dist = length(vFWorld - cameraPosition);
    fRoom = roomColor(fract(vFUv * wg0.xy), cid, cm, Vw, normalize(vFNormal), vSeed);
    fRoomOk = smoothstep(260.0, 90.0, dist);
    // daytime: faint interior depth behind the glass
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (0.55 + fRoom * 0.6), fMsk.r * fRoomOk * 0.8);
  }
}`)
      .replace('#include <color_fragment>', `diffuseColor.rgb *= mix(vColor.rgb, vec3(1.0), fMsk.r);`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = fAlb.a;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = fMsk.b;`)
      .replace('#include <normal_fragment_maps>', `{ vec2 dH = vec2(dFdx(fMsk.a), dFdy(fMsk.a)); normal = fPerturb(-vViewPosition, normal, dH * 1.2, faceDirection); }`)
      .replace('#include <emissivemap_fragment>', `{
  int li = int(vLayer + 0.5);
  vec4 wg = uWinGrid[li];
  if (wg.x > 0.0 && uNight > 0.01) {
    vec2 cell = floor(vFUv * wg.xy);
    float frac = clamp(vLit * uLitFrac * wg.z, 0.0, 0.96);
    float lit = step(fHash(cell + vSeed * 17.0), frac);
    float fw = fwidth(vFUv.x * wg.x) + fwidth(vFUv.y * wg.y);
    lit = mix(lit, frac, smoothstep(0.3, 1.2, fw));
    float t = fHash(cell.yx + vSeed * 3.1);
    vec3 lc = t < 0.6 ? vec3(1.0, 0.62, 0.32) : t < 0.87 ? vec3(1.0, 0.84, 0.62) : vec3(0.55, 0.72, 1.0);
    float inten = (0.45 + 0.9 * fHash(cell * 1.7 + vSeed)) * (0.3 + fMsk.g);
    vec3 glow = lc * inten;
    glow = mix(glow, fRoom * (0.6 + 0.7 * fMsk.g), fRoomOk);
    totalEmissiveRadiance += fMsk.r * lit * glow * uNight * 2.6 * wg.w;
  }
}`);
  };
  m.customProgramCacheKey = () => 'facade-v3';
  return m;
}

// ------------------------------------------------------------------ geometry buffer
class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.l = []; this.c = []; this.s = []; this.lit = []; }
  tri(a, b, c, n, ua, ub, uc, layer, col, seed, lit) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let k = 0; k < 3; k++) { this.n.push(n[0], n[1], n[2]); this.l.push(layer); this.c.push(col[0], col[1], col[2]); this.s.push(seed); this.lit.push(lit); }
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  quad(a, b, c, d, n, ua, ub, uc, ud, layer, col, seed, lit) { this.tri(a, b, c, n, ua, ub, uc, layer, col, seed, lit); this.tri(a, c, d, n, ua, uc, ud, layer, col, seed, lit); }
  get count() { return this.p.length / 3; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(this.l, 1));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(this.s, 1));
    g.setAttribute('aLit', new THREE.Float32BufferAttribute(this.lit, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** Vertical wall from A=(ax,az) to B=(bx,bz) (outward normal = right of A->B... computed), bands [{y0,y1,style}] */
function wall(buf, ax, az, bx, bz, y0, y1, style, col, seed, lit, vOff = 0) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.05 || y1 - y0 < 0.02) return;
  const F = FACADES[style];
  const nx = -(bz - az) / len, nz = (bx - ax) / len; // outward normal = (-dz, dx) for CCW ordering seen from outside
  const nt = Math.max(1, Math.round(len / F.tileW));
  const v0 = vOff / F.tileH, v1 = (vOff + y1 - y0) / F.tileH;
  buf.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [nx, 0, nz], [0, v0], [nt, v0], [nt, v1], [0, v1], F.layer, col, seed, lit);
}
function hquad(buf, x0, x1, z0, z1, y, style, col, seed, lit, down = false) {
  const F = FACADES[style];
  const u = (x) => x / F.tileW, v = (z) => z / F.tileH;
  if (!down) buf.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [u(x0), v(z1)], [u(x1), v(z1)], [u(x1), v(z0)], [u(x0), v(z0)], F.layer, col, seed, lit);
  else buf.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], [u(x0), v(z0)], [u(x1), v(z0)], [u(x1), v(z1)], [u(x0), v(z1)], F.layer, col, seed, lit);
}
/** Box with walls (CCW from outside) and top. */
function boxWalls(buf, x0, x1, z0, z1, y0, y1, style, col, seed, lit, topStyle = 'ROOF', vOff = 0) {
  // perimeter CCW when viewed from above with outward normals: north edge (z0) goes x1->x0 ... we choose ordering so normal computed = outward
  wall(buf, x1, z0, x0, z0, y0, y1, style, col, seed, lit, vOff); // north face normal (0,0,-1)
  wall(buf, x0, z1, x1, z1, y0, y1, style, col, seed, lit, vOff); // south
  wall(buf, x0, z0, x0, z1, y0, y1, style, col, seed, lit, vOff); // west normal (-1,0,0)
  wall(buf, x1, z1, x1, z0, y0, y1, style, col, seed, lit, vOff); // east
  if (topStyle) hquad(buf, x0, x1, z0, z1, y1, topStyle, col, seed, lit);
}

function partGeometry(buf, bl, p, rng, lights, beacons) {
  const col = bl.tint, seed = (bl.seed % 997) / 997, lit = bl.lit;
  const { x0, x1, z0, z1, y0, y1 } = p;
  const style = p.style;
  // walls with storefront band
  const bands = [];
  const sfH = FACADES.STOREFRONT.floorH;
  if (p.storefront && y1 - y0 > sfH + 0.5) { bands.push([y0, y0 + sfH, 'STOREFRONT', 0]); bands.push([y0 + sfH, y1, style, 0]); }
  else if (p.storefront) bands.push([y0, y1, 'STOREFRONT', 0]);
  else bands.push([y0, y1, style, 0]);
  const flat = p.roof === 'flat' || p.roof === 'sawtooth';
  const parapet = flat && !p.open && (y1 - y0) > 5.5 && bl.kind !== 'respray';
  for (const [a, b, st] of bands) {
    wall(buf, x1, z0, x0, z0, a, b, st, col, seed, lit);
    wall(buf, x0, z1, x1, z1, a, b, st, col, seed, lit);
    wall(buf, x0, z0, x0, z1, a, b, st, col, seed, lit);
    wall(buf, x1, z1, x1, z0, a, b, st, col, seed, lit);
  }
  if (p.open === 'roof') { hquad(buf, x0, x1, z0, z1, y1, 'ROOF', col, seed, 0); hquad(buf, x0, x1, z0, z1, y0, 'CONCRETE', col, seed, 0, true); return; }
  const gray = [1, 1, 1];
  if (flat) {
    if (parapet) {
      const ph = 0.9, t = 0.3;
      boxRing(buf, x0, x1, z0, z1, y1, y1 + ph, t, 'CONCRETE', mixCol(col, 0.5), seed);
      hquad(buf, x0 + t, x1 - t, z0 + t, z1 - t, y1, 'ROOF', gray, seed, 0);
    } else hquad(buf, x0, x1, z0, z1, y1, 'ROOF', gray, seed, 0);
  } else roof(buf, bl, p, col, seed, lit);
  // crowns
  if (p.crown) crown(buf, bl, p, rng, lights, beacons);
}
function mixCol(c, k) { return [c[0] * k + (1 - k), c[1] * k + (1 - k), c[2] * k + (1 - k)]; }
function boxRing(buf, x0, x1, z0, z1, ya, yb, t, style, col, seed) {
  // outer walls
  wall(buf, x1, z0, x0, z0, ya, yb, style, col, seed, 0); wall(buf, x0, z1, x1, z1, ya, yb, style, col, seed, 0);
  wall(buf, x0, z0, x0, z1, ya, yb, style, col, seed, 0); wall(buf, x1, z1, x1, z0, ya, yb, style, col, seed, 0);
  // inner walls (reversed)
  const ix0 = x0 + t, ix1 = x1 - t, iz0 = z0 + t, iz1 = z1 - t;
  wall(buf, ix0, iz0, ix1, iz0, ya, yb, style, col, seed, 0); wall(buf, ix1, iz1, ix0, iz1, ya, yb, style, col, seed, 0);
  wall(buf, ix0, iz1, ix0, iz0, ya, yb, style, col, seed, 0); wall(buf, ix1, iz0, ix1, iz1, ya, yb, style, col, seed, 0);
  // caps
  hquad(buf, x0, x1, z0, iz0, yb, style, col, seed, 0); hquad(buf, x0, x1, iz1, z1, yb, style, col, seed, 0);
  hquad(buf, x0, ix0, iz0, iz1, yb, style, col, seed, 0); hquad(buf, ix1, x1, iz0, iz1, yb, style, col, seed, 0);
}
function roof(buf, bl, p, col, seed, lit) {
  const { x0, x1, z0, z1, y1, roofH: rh } = p;
  const rs = bl.style === 'HOUSE_SIDING' ? 'SHINGLE' : 'ROOFTILE';
  const rc = bl.roofTint || [0.6, 0.35, 0.28];
  const F = FACADES[rs], o = 0.35;
  const ridgeX = p.ridge === 'x';
  // work in local coords: a = along ridge, b = across ridge
  const A0 = ridgeX ? x0 : z0, A1 = ridgeX ? x1 : z1, B0 = ridgeX ? z0 : x0, B1 = ridgeX ? z1 : x1;
  const half = (B1 - B0) / 2, Bm = (B0 + B1) / 2;
  const P = (a, y, b) => ridgeX ? [a, y, b] : [b, y, a];
  const drop = o * rh / half;
  const slopeLen = Math.hypot(half + o, rh + drop);
  const nY = (half) / Math.hypot(half, rh), nB = rh / Math.hypot(half, rh);
  const hip = p.roof === 'hip';
  const hipIn = hip ? Math.min(half, (A1 - A0) / 2 - 0.5) : 0;
  const ra0 = A0 + hipIn, ra1 = A1 - hipIn;
  // two main slopes
  for (const s of [-1, 1]) {
    const be = s < 0 ? B0 - o : B1 + o;
    const n = ridgeX ? [0, nY, s * nB] : [s * nB, nY, 0];
    const eA0 = A0 - o, eA1 = A1 + o;
    const q = [P(eA0, y1 - drop, be), P(eA1, y1 - drop, be), P(ra1, y1 + rh, Bm), P(ra0, y1 + rh, Bm)];
    const uv = [[eA0 / F.tileW, 0], [eA1 / F.tileW, 0], [ra1 / F.tileW, slopeLen / F.tileH], [ra0 / F.tileW, slopeLen / F.tileH]];
    // winding: ensure normal outward -> order depends on s and orientation
    const flip = (s > 0) !== ridgeX;
    if (!flip) buf.quad(q[0], q[1], q[2], q[3], n, uv[0], uv[1], uv[2], uv[3], F.layer, rc, seed, 0);
    else buf.quad(q[1], q[0], q[3], q[2], n, uv[1], uv[0], uv[3], uv[2], F.layer, rc, seed, 0);
  }
  // ends
  for (const s of [-1, 1]) {
    const aE = s < 0 ? A0 : A1;
    if (hip) {
      const ae = s < 0 ? A0 - o : A1 + o, ar = s < 0 ? ra0 : ra1;
      const hl = Math.hypot(hipIn + o, rh + drop);
      const nn = Math.hypot(hipIn, rh) || 1;
      const n = ridgeX ? [s * rh / nn, hipIn / nn, 0] : [0, hipIn / nn, s * rh / nn];
      const a = P(ae, y1 - drop, B0 - o), b = P(ae, y1 - drop, B1 + o), c = P(ar, y1 + rh, Bm);
      const ua = [(B0 - o) / F.tileW, 0], ub = [(B1 + o) / F.tileW, 0], uc = [Bm / F.tileW, hl / F.tileH];
      const flip = (s > 0) === ridgeX;
      if (flip) buf.tri(b, a, c, n, ub, ua, uc, F.layer, rc, seed, 0); else buf.tri(a, b, c, n, ua, ub, uc, F.layer, rc, seed, 0);
    } else {
      // gable wall triangle with wall style
      const W = FACADES[bl.style], n = ridgeX ? [s, 0, 0] : [0, 0, s];
      const a = P(aE, y1, B0), b = P(aE, y1, B1), c = P(aE, y1 + rh, Bm);
      const v0 = (y1 - p.y0) / W.tileH, v1 = (y1 + rh - p.y0) / W.tileH;
      const ua = [B0 / W.tileW, v0], ub = [B1 / W.tileW, v0], uc = [Bm / W.tileW, v1];
      const flip = (s > 0) === ridgeX;
      if (flip) buf.tri(b, a, c, n, ub, ua, uc, W.layer, col, seed, lit); else buf.tri(a, b, c, n, ua, ub, uc, W.layer, col, seed, lit);
    }
  }
  // chimney for some houses
  if ((bl.seed % 3) === 0) {
    const cx = ridgeX ? lerpN(A0, A1, 0.72) : lerpN(B0, B1, 0.3), cz = ridgeX ? lerpN(B0, B1, 0.3) : lerpN(A0, A1, 0.72);
    boxWalls(buf, cx - 0.4, cx + 0.4, cz - 0.4, cz + 0.4, y1, y1 + rh + 1.0, 'BRICK_RED', [1, 1, 1], seed, 0, 'CONCRETE');
  }
}
const lerpN = (a, b, t) => a + (b - a) * t;

function crown(buf, bl, p, rng, lights, beacons) {
  const { x0, x1, z0, z1, y1 } = p;
  const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const top = y1 + (p.roof === 'flat' ? 0 : 0);
  const gray = [1, 1, 1], seed = (bl.seed % 997) / 997;
  const addBeacon = (x, y, z) => beacons.push(x, y, z);
  switch (p.crown) {
    case 'mech': {
      const mw = W * rng.range(0.25, 0.45), md = D * rng.range(0.25, 0.45);
      const ox = rng.range(-0.2, 0.2) * W, oz = rng.range(-0.2, 0.2) * D;
      const h = rng.range(2.6, 4);
      boxWalls(buf, cx + ox - mw / 2, cx + ox + mw / 2, cz + oz - md / 2, cz + oz + md / 2, top, top + h, 'METAL', gray, seed, 0, 'ROOF');
      const n = rng.int(1, 4);
      for (let i = 0; i < n; i++) {
        const ax = rng.range(x0 + 1.5, x1 - 3), az = rng.range(z0 + 1.5, z1 - 3);
        if (Math.abs(ax - cx - ox) < mw / 2 + 2 && Math.abs(az - cz - oz) < md / 2 + 2) continue;
        boxWalls(buf, ax, ax + 1.6, az, az + 1.1, top, top + 1.1, 'METAL', gray, seed, 0, 'METAL');
      }
      if (bl.district === 'oldquarter' && rng.chance(0.4)) { // water tank
        const tx = rng.range(x0 + 3, x1 - 3), tz = rng.range(z0 + 3, z1 - 3);
        boxWalls(buf, tx - 1.4, tx + 1.4, tz - 1.4, tz + 1.4, top + 2.2, top + 5, 'WAREHOUSE', [0.55, 0.42, 0.3], seed, 0, 'ROOF');
        for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) boxWalls(buf, tx + lx * 1.1 - 0.1, tx + lx * 1.1 + 0.1, tz + lz * 1.1 - 0.1, tz + lz * 1.1 + 0.1, top, top + 2.2, 'METAL', [0.4, 0.4, 0.4], seed, 0, null);
      }
      break;
    }
    case 'spire': {
      boxWalls(buf, cx - W * 0.2, cx + W * 0.2, cz - D * 0.2, cz + D * 0.2, top, top + 5, 'METAL', gray, seed, 0, 'ROOF');
      const h = rng.range(14, 30);
      boxWalls(buf, cx - 0.35, cx + 0.35, cz - 0.35, cz + 0.35, top + 5, top + 5 + h, 'METAL', gray, seed, 0, 'METAL');
      addBeacon(cx, top + 5 + h + 0.3, cz);
      break;
    }
    case 'crown': {
      const ins = Math.min(W, D) * 0.1, h = rng.range(6, 10);
      boxWalls(buf, x0 + ins, x1 - ins, z0 + ins, z1 - ins, top, top + h, p.style, gray, seed, 0.2, 'ROOF');
      lights.ring(x0 + ins - 0.05, x1 - ins + 0.05, z0 + ins - 0.05, z1 - ins + 0.05, top + h - 0.6, top + h - 0.2, rng.pick([[0.3, 0.8, 1], [1, 0.4, 0.8], [1, 0.8, 0.4], [0.7, 1, 0.9]]));
      addBeacon(x0 + ins, top + h + 0.3, z0 + ins); addBeacon(x1 - ins, top + h + 0.3, z1 - ins);
      break;
    }
    case 'helipad': {
      const r = Math.min(W, D) * 0.36;
      boxWalls(buf, cx - r, cx + r, cz - r, cz + r, top, top + 0.5, 'CONCRETE', gray, seed, 0, 'CONCRETE');
      lights.ring(cx - r - 0.02, cx + r + 0.02, cz - r - 0.02, cz + r + 0.02, top + 0.3, top + 0.45, [0.4, 1, 0.5]);
      addBeacon(x0 + 0.5, top + 1.5, z0 + 0.5);
      break;
    }
    case 'solstice': {
      // tapering glass crown with lit rings and a mast
      let yy = top;
      for (let k = 0; k < 4; k++) {
        const s = 1 - k * 0.2, hx = W / 2 * s * 0.92, hz = D / 2 * s * 0.92;
        boxWalls(buf, cx - hx, cx + hx, cz - hz, cz + hz, yy, yy + 7, 'GLASS_SILVER', gray, seed, 0.9, 'ROOF');
        lights.ring(cx - hx - 0.06, cx + hx + 0.06, cz - hz - 0.06, cz + hz + 0.06, yy + 6.2, yy + 7, [1, 0.72, 0.35]);
        yy += 7;
      }
      boxWalls(buf, cx - 0.5, cx + 0.5, cz - 0.5, cz + 0.5, yy, yy + 26, 'METAL', gray, seed, 0, 'METAL');
      addBeacon(cx, yy + 26.4, cz);
      break;
    }
  }
  if (bl.h > 55 && p.crown !== 'spire' && p.crown !== 'solstice') { addBeacon(x0 + 0.4, y1 + 1.2, z0 + 0.4); addBeacon(x1 - 0.4, y1 + 1.2, z1 - 0.4); }
}

// emissive "light strip" geometry collector
class LightBuf {
  constructor() { this.p = []; this.c = []; }
  quad(a, b, c, d, col) { this.p.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) this.c.push(...col); }
  ring(x0, x1, z0, z1, ya, yb, col) {
    this.quad([x1, ya, z0], [x0, ya, z0], [x0, yb, z0], [x1, yb, z0], col);
    this.quad([x0, ya, z1], [x1, ya, z1], [x1, yb, z1], [x0, yb, z1], col);
    this.quad([x0, ya, z0], [x0, ya, z1], [x0, yb, z1], [x0, yb, z0], col);
    this.quad([x1, ya, z1], [x1, ya, z0], [x1, yb, z0], [x1, yb, z1], col);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Sign quads (atlas uv) on storefront facades. */
class SignBuf {
  constructor() { this.p = []; this.n = []; this.uv = []; }
  add(ax, az, bx, bz, y0, y1, n, u0, v0, u1, v1) {
    this.p.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
    for (let i = 0; i < 6; i++) this.n.push(n[0], 0, n[1]);
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

export function buildBuildings(city, textures, facadeMat, { chunk = 256 } = {}) {
  const rng = makeRng(city.seed + 5);
  const chunks = new Map();
  const get = (x, z) => {
    const k = Math.floor(x / chunk) + ',' + Math.floor(z / chunk);
    let c = chunks.get(k); if (!c) chunks.set(k, c = { buf: new Buf(), lights: new LightBuf(), signs: new SignBuf() });
    return c;
  };
  const beacons = [];
  const atlas = textures.signs;
  const specialSigns = [];
  for (const bl of city.buildings) {
    const c = get(bl.x, bl.z);
    for (const p of bl.parts) partGeometry(c.buf, bl, p, rng, c.lights, beacons);
    // storefront sign on the street-facing facade
    const low = bl.parts[0];
    if (low && low.storefront && !bl.sign && bl.kind !== 'tower' && bl.kind !== 'landmark') {
      const idx = rng.int(0, atlas.count - 1);
      const cu = (idx % atlas.cols) / atlas.cols, cv = 1 - (Math.floor(idx / atlas.cols) + 1) / atlas.rows;
      addFacadeSign(c.signs, low, bl.face, low.y0 + 3.5, low.y0 + 4.2, Math.min(7, faceLen(low, bl.face) * 0.6), cu + 0.004, cv + 0.004, cu + 1 / atlas.cols - 0.004, cv + 1 / atlas.rows - 0.004);
    }
    if (bl.sign) specialSigns.push(bl);
  }
  const group = new THREE.Group(); group.name = 'buildings';
  const lightsMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
  lightsMat.userData.base = 1;
  const signMat = new THREE.MeshStandardMaterial({ map: atlas.texture, emissiveMap: atlas.texture, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.5, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 });
  const meshes = [];
  let tris = 0;
  for (const [, c] of chunks) {
    if (c.buf.count) {
      const m = new THREE.Mesh(c.buf.geometry(), facadeMat); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); meshes.push(m);
      tris += c.buf.count / 3;
    }
    if (c.lights.p.length) { const m = new THREE.Mesh(c.lights.geometry(), lightsMat); m.matrixAutoUpdate = false; group.add(m); }
    if (c.signs.p.length) { const m = new THREE.Mesh(c.signs.geometry(), signMat); m.matrixAutoUpdate = false; m.receiveShadow = true; group.add(m); }
  }
  // special building signs (unique textures)
  const specialMats = [];
  for (const bl of specialSigns) {
    const low = bl.parts[0];
    const neon = bl.kind === 'club';
    const col = bl.kind === 'police' ? ['#0f2a4a', '#ffffff'] : bl.kind === 'hospital' ? ['#ffffff', '#c1121f'] : bl.kind === 'gunshop' ? ['#1c1c1c', '#f4a261'] : bl.kind === 'respray' ? ['#e63946', '#ffffff'] : bl.kind === 'club' ? [null, '#ff3df2'] : bl.kind === 'salvage' ? ['#2b2d42', '#ffd166'] : ['#0b3954', '#ffffff'];
    const tex = textures.makeTextSign(bl.sign.toUpperCase(), { bg: col[0], fg: col[1], neon, border: col[0] ? col[1] : null });
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.15, roughness: 0.5, transparent: !col[0], polygonOffset: true, polygonOffsetFactor: -2 });
    specialMats.push(mat);
    const sb = new SignBuf();
    const len = Math.min(faceLen(low, bl.face) * 0.85, bl.kind === 'club' ? 9 : 12);
    const y0 = bl.kind === 'respray' ? low.y1 - 1.8 : low.storefront ? low.y0 + 3.45 : Math.min(low.y1 - 1.5, low.y0 + 4.5);
    addFacadeSign(sb, low, bl.face, y0, y0 + len * 0.1875, len, 0, 0, 1, 1);
    const m = new THREE.Mesh(sb.geometry(), mat); m.matrixAutoUpdate = false; group.add(m);
  }
  // blinking aviation beacons
  const bGeo = new THREE.SphereGeometry(0.35, 8, 6);
  const bMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.1, 0.05) });
  const beaconMesh = new THREE.InstancedMesh(bGeo, bMat, Math.max(1, beacons.length / 3));
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < beacons.length / 3; i++) { mtx.makeTranslation(beacons[i * 3], beacons[i * 3 + 1], beacons[i * 3 + 2]); beaconMesh.setMatrixAt(i, mtx); }
  beaconMesh.count = beacons.length / 3; beaconMesh.frustumCulled = false;
  group.add(beaconMesh);
  return {
    group, meshes, lightsMat, signMat, specialMats, beaconMesh, tris, beaconCount: beacons.length / 3,
    update(time, night) {
      const blink = (Math.sin(time * 3.2) > 0.2 ? 1 : 0.08) * (0.25 + night * 0.9);
      bMat.color.setRGB(4 * blink, 0.12 * blink, 0.05 * blink);
      lightsMat.color.setScalar(0.35 + night * 2.8);
      signMat.emissiveIntensity = 0.08 + night * 1.6;
      for (const m of specialMats) m.emissiveIntensity = 0.12 + night * 2.2;
      facadeMat.userData.uniforms.uNight.value = night;
    },
  };
}
function faceLen(p, face) { return face === 'n' || face === 's' ? p.x1 - p.x0 : p.z1 - p.z0; }
function addFacadeSign(sb, p, face, y0, y1, len, u0, v0, u1, v1) {
  const off = 0.07;
  const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
  switch (face) {
    case 'n': sb.add(cx + len / 2, p.z0 - off, cx - len / 2, p.z0 - off, y0, y1, [0, -1], u0, v0, u1, v1); break;
    case 's': sb.add(cx - len / 2, p.z1 + off, cx + len / 2, p.z1 + off, y0, y1, [0, 1], u0, v0, u1, v1); break;
    case 'w': sb.add(p.x0 - off, cz - len / 2, p.x0 - off, cz + len / 2, y0, y1, [-1, 0], u0, v0, u1, v1); break;
    default: sb.add(p.x1 + off, cz + len / 2, p.x1 + off, cz - len / 2, y0, y1, [1, 0], u0, v0, u1, v1);
  }
}
