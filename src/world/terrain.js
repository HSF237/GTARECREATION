// Terrain: heightmap + surface grid for the island of Sol Harbor.
//   const t = buildIsland(seed)            -> Terrain (coast, beaches, hills; city area flat at 0)
//   t.heightAt(x,z) / t.normalAt(x,z,out) / t.surfaceAt(x,z) / t.surfaceIdAt(x,z) / t.isWater(x,z)
//   t.carvePath(points[{x,y,z}], halfWidth, flat, blend)  - flatten terrain to a road profile
//   t.flattenRect(cx, cz, hx, hz, y, blend)
//   t.grid = { originX, originZ, cell, nx, nz, heights, surface }
import { fbm2, ridged2, simplex2 } from '../core/rng.js';
import { clamp, smoothstep, lerp } from '../core/math.js';

export const WATER_LEVEL = -1.5;
export const SURFACE = { WATER: 0, ASPHALT: 1, SIDEWALK: 2, GRASS: 3, DIRT: 4, SAND: 5, ROCK: 6, WOOD: 7, CONCRETE: 8 };
export const SURFACE_NAMES = ['water', 'asphalt', 'sidewalk', 'grass', 'dirt', 'sand', 'rock', 'wood', 'concrete'];

// City flat regions (y = 0).
export const CITY_RECTS = [
  { x0: -916, x1: 934, z0: -658, z1: 632 },
  { x0: 396, x1: 934, z0: 600, z1: 792 },
];

// Island outline, counter-clockwise-ish; third value = natural coast (gets noise) vs seawall/quay.
const COAST = [
  [-846, 632, 0], [400, 632, 0], [400, 792, 0], [934, 792, 0], [934, -652, 0],
  [972, -740, 1], [1015, -870, 1], [995, -1030, 1], [905, -1185, 1], [765, -1295, 1], [565, -1352, 1],
  [300, -1378, 1], [60, -1362, 1], [-200, -1388, 1], [-460, -1352, 1], [-700, -1292, 1], [-880, -1182, 1],
  [-985, -1022, 1], [-1032, -862, 1], [-1024, -700, 1], [-1010, -500, 1], [-1004, -300, 1], [-1014, -100, 1],
  [-1000, 100, 1], [-1008, 300, 1], [-995, 500, 1], [-952, 612, 1], [-892, 652, 1],
];

export class Terrain {
  constructor({ originX = -1600, originZ = -1700, cell = 4, nx = 801, nz = 751 } = {}) {
    this.originX = originX; this.originZ = originZ; this.cell = cell; this.nx = nx; this.nz = nz;
    this.heights = new Float32Array(nx * nz);
    this.surface = new Uint8Array(nx * nz);
    this.coastDist = new Float32Array(nx * nz); // signed distance to coast (m), + inland
    this.waterLevel = WATER_LEVEL;
    this.grid = { originX, originZ, cell, nx, nz, heights: this.heights, surface: this.surface };
    this.maxX = originX + (nx - 1) * cell; this.maxZ = originZ + (nz - 1) * cell;
  }
  /** Bilinear height. */
  heightAt(x, z) {
    let fx = (x - this.originX) / this.cell, fz = (z - this.originZ) / this.cell;
    if (fx < 0) fx = 0; else if (fx > this.nx - 1.001) fx = this.nx - 1.001;
    if (fz < 0) fz = 0; else if (fz > this.nz - 1.001) fz = this.nz - 1.001;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz;
    const i = iz * this.nx + ix, h = this.heights, n = this.nx;
    const a = h[i], b = h[i + 1], c = h[i + n], d = h[i + n + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
  normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
    const e = this.cell;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    let nx = hl - hr, ny = 2 * e, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }
  _idx(x, z) {
    const ix = clamp(Math.round((x - this.originX) / this.cell), 0, this.nx - 1);
    const iz = clamp(Math.round((z - this.originZ) / this.cell), 0, this.nz - 1);
    return iz * this.nx + ix;
  }
  surfaceIdAt(x, z) { return this.surface[this._idx(x, z)]; }
  surfaceAt(x, z) { return SURFACE_NAMES[this.surface[this._idx(x, z)]]; }
  coastDistanceAt(x, z) { return this.coastDist[this._idx(x, z)]; }
  isWater(x, z) { return this.heightAt(x, z) < WATER_LEVEL - 0.05; }

  /**
   * Flatten terrain along a path to the path's y. points: [{x,y,z}] densely sampled (<= 4 m apart).
   * Within halfWidth+flat: exactly path y. Blend back to natural terrain over `blend` meters.
   */
  carvePath(points, halfWidth, flat = 6, blend = 20) {
    const R = halfWidth + flat + blend;
    const { nx, nz, cell, originX, originZ, heights } = this;
    // segment hash
    const B = 32, segs = new Map();
    const key = (bx, bz) => bx * 4096 + bz;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const bx0 = Math.floor((Math.min(a.x, b.x) - R) / B), bx1 = Math.floor((Math.max(a.x, b.x) + R) / B);
      const bz0 = Math.floor((Math.min(a.z, b.z) - R) / B), bz1 = Math.floor((Math.max(a.z, b.z) + R) / B);
      for (let bx = bx0; bx <= bx1; bx++) for (let bz = bz0; bz <= bz1; bz++) {
        const k = key(bx, bz); let l = segs.get(k); if (!l) segs.set(k, l = []); l.push(i);
      }
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const ix0 = Math.max(0, Math.floor((minX - R - originX) / cell)), ix1 = Math.min(nx - 1, Math.ceil((maxX + R - originX) / cell));
    const iz0 = Math.max(0, Math.floor((minZ - R - originZ) / cell)), iz1 = Math.min(nz - 1, Math.ceil((maxZ + R - originZ) / cell));
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = originZ + iz * cell;
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = originX + ix * cell;
        const l = segs.get(key(Math.floor(x / B), Math.floor(z / B)));
        if (!l) continue;
        let best = Infinity, by = 0;
        for (let k = 0; k < l.length; k++) {
          const i = l[k], a = points[i], b = points[i + 1];
          const abx = b.x - a.x, abz = b.z - a.z, len2 = abx * abx + abz * abz || 1e-9;
          let t = ((x - a.x) * abx + (z - a.z) * abz) / len2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = a.x + abx * t, pz = a.z + abz * t;
          const d = (x - px) * (x - px) + (z - pz) * (z - pz);
          if (d < best) { best = d; by = a.y + (b.y - a.y) * t; }
        }
        if (best > R * R) continue;
        const d = Math.sqrt(best);
        const w = smoothstep(halfWidth + flat, R, d);
        const idx = iz * nx + ix;
        heights[idx] = by + (heights[idx] - by) * w;
      }
    }
  }
  /** Flatten a rotated rectangle to height y, blending over `blend` meters. */
  flattenRect(cx, cz, hx, hz, y, blend = 15, rot = 0) {
    const { nx, nz, cell, originX, originZ, heights } = this;
    const R = Math.hypot(hx, hz) + blend;
    const c = Math.cos(rot), s = Math.sin(rot);
    const ix0 = Math.max(0, Math.floor((cx - R - originX) / cell)), ix1 = Math.min(nx - 1, Math.ceil((cx + R - originX) / cell));
    const iz0 = Math.max(0, Math.floor((cz - R - originZ) / cell)), iz1 = Math.min(nz - 1, Math.ceil((cz + R - originZ) / cell));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const dx = originX + ix * cell - cx, dz = originZ + iz * cell - cz;
      const lx = Math.abs(dx * c - dz * s), lz = Math.abs(dx * s + dz * c);
      const ox = Math.max(0, lx - hx), oz = Math.max(0, lz - hz);
      const d = Math.hypot(ox, oz);
      if (d > blend) continue;
      const w = smoothstep(0, blend, d), idx = iz * nx + ix;
      heights[idx] = y + (heights[idx] - y) * w;
    }
  }
}

/** Densified coastline polygon with noisy natural edges. */
export function buildCoastline(seed) {
  const out = [];
  const n = COAST.length;
  for (let i = 0; i < n; i++) {
    const a = COAST[i], b = COAST[(i + 1) % n];
    const natural = a[2] && b[2];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = natural ? Math.max(1, Math.ceil(len / 12)) : 1;
    const nxv = (b[1] - a[1]) / len, nzv = -(b[0] - a[0]) / len;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      let x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      if (natural && (s > 0 || COAST[(i - 1 + n) % n][2])) {
        const off = fbm2(x / 210, z / 210, { octaves: 4, seed: seed + 3 }) * 34 + simplex2(x / 55, z / 55, seed + 9) * 5;
        x += nxv * off; z += nzv * off;
      }
      out.push([x, z]);
    }
  }
  return out;
}

export function inCityRect(x, z, margin = 0) {
  for (const r of CITY_RECTS) if (x >= r.x0 - margin && x <= r.x1 + margin && z >= r.z0 - margin && z <= r.z1 + margin) return true;
  return false;
}

/** Build the base island terrain (before road carving). */
export function buildIsland(seed = 1337) {
  const T = new Terrain();
  const { nx, nz, cell, originX, originZ, heights, coastDist } = T;
  const poly = buildCoastline(seed);
  T.coastline = poly;
  // --- inside mask via scanline crossings
  const inside = new Uint8Array(nx * nz);
  const xs = [];
  for (let iz = 0; iz < nz; iz++) {
    const z = originZ + iz * cell + 1e-3;
    xs.length = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const zi = poly[i][1], zj = poly[j][1];
      if ((zi > z) !== (zj > z)) xs.push(poly[i][0] + (z - zi) / (zj - zi) * (poly[j][0] - poly[i][0]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil((xs[k] - originX) / cell)), b = Math.min(nx - 1, Math.floor((xs[k + 1] - originX) / cell));
      for (let ix = a; ix <= b; ix++) inside[iz * nx + ix] = 1;
    }
  }
  // --- chamfer distance transform (distance to other class), in cells
  const INF = 1e9, dIn = new Float32Array(nx * nz), dOut = new Float32Array(nx * nz);
  for (let i = 0; i < nx * nz; i++) { dIn[i] = inside[i] ? INF : 0; dOut[i] = inside[i] ? 0 : INF; }
  const chamfer = (d) => {
    const a = 1, b = Math.SQRT2;
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix; let v = d[i]; if (v === 0) continue;
      if (ix > 0) v = Math.min(v, d[i - 1] + a);
      if (iz > 0) { v = Math.min(v, d[i - nx] + a); if (ix > 0) v = Math.min(v, d[i - nx - 1] + b); if (ix < nx - 1) v = Math.min(v, d[i - nx + 1] + b); }
      d[i] = v;
    }
    for (let iz = nz - 1; iz >= 0; iz--) for (let ix = nx - 1; ix >= 0; ix--) {
      const i = iz * nx + ix; let v = d[i]; if (v === 0) continue;
      if (ix < nx - 1) v = Math.min(v, d[i + 1] + a);
      if (iz < nz - 1) { v = Math.min(v, d[i + nx] + a); if (ix < nx - 1) v = Math.min(v, d[i + nx + 1] + b); if (ix > 0) v = Math.min(v, d[i + nx - 1] + b); }
      d[i] = v;
    }
  };
  chamfer(dIn); chamfer(dOut);
  // exact distances near the coast (segment buckets)
  const B = 32, buckets = new Map(), key = (bx, bz) => bx * 4096 + bz;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const bx0 = Math.floor(Math.min(a[0], b[0]) / B) - 1, bx1 = Math.floor(Math.max(a[0], b[0]) / B) + 1;
    const bz0 = Math.floor(Math.min(a[1], b[1]) / B) - 1, bz1 = Math.floor(Math.max(a[1], b[1]) / B) + 1;
    for (let bx = bx0; bx <= bx1; bx++) for (let bz = bz0; bz <= bz1; bz++) { const k = key(bx, bz); let l = buckets.get(k); if (!l) buckets.set(k, l = []); l.push(i); }
  }
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const i = iz * nx + ix;
    const dc = (inside[i] ? dIn[i] : dOut[i]) * cell;
    let d = dc;
    if (dc < 26) {
      const x = originX + ix * cell, z = originZ + iz * cell;
      const l = buckets.get(key(Math.floor(x / B), Math.floor(z / B)));
      if (l) {
        let best = Infinity;
        for (const si of l) {
          const a = poly[si], b = poly[(si + 1) % poly.length];
          const abx = b[0] - a[0], abz = b[1] - a[1], len2 = abx * abx + abz * abz || 1e-9;
          let t = ((x - a[0]) * abx + (z - a[1]) * abz) / len2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = a[0] + abx * t - x, pz = a[1] + abz * t - z;
          best = Math.min(best, px * px + pz * pz);
        }
        d = Math.sqrt(best);
      }
    }
    coastDist[i] = inside[i] ? d : -d;
  }
  // --- heights
  for (let iz = 0; iz < nz; iz++) {
    const z = originZ + iz * cell;
    for (let ix = 0; ix < nx; ix++) {
      const x = originX + ix * cell, i = iz * nx + ix, d = coastDist[i];
      const seawall = (z > 580 && x > -870) || (x > 890 && z > -660);
      let h;
      if (d >= 0) {
        // hills north of the city
        const t = smoothstep(-662, -830, z);
        let hill = 0;
        if (t > 0) {
          hill = t * (52 + 40 * fbm2(x / 430, z / 430, { octaves: 4, seed: seed + 11 }))
            + t * 34 * ridged2(x / 270 + 3.1, z / 270, { octaves: 4, seed: seed + 17 })
            + t * 6 * fbm2(x / 60, z / 60, { octaves: 3, seed: seed + 23 });
          hill = Math.max(0, hill);
        }
        if (seawall) h = 0;
        else {
          // natural coast: beach profile and coastal taper of hills
          const beach = -1.5 + 1.62 * (1 - Math.exp(-d / 34));
          const northRock = smoothstep(-760, -900, z); // rocky coves in the north
          h = hill * smoothstep(0, 150 - 60 * northRock, d) + Math.min(beach, 0.05) + northRock * 0.8 * smoothstep(0, 30, d);
        }
      } else {
        const ad = -d;
        if (seawall) h = -9 - ad * 0.02 + fbm2(x / 90, z / 90, { octaves: 2, seed }) * 1.0;
        else {
          const rocky = smoothstep(-720, -900, z);
          const beachDepth = -1.5 - 12.5 * Math.pow(smoothstep(0, 290, ad), 1.25);
          const rockDepth = -1.5 - 12.5 * smoothstep(0, 110, ad);
          h = lerp(beachDepth, rockDepth, rocky) + fbm2(x / 70, z / 70, { octaves: 2, seed: seed + 5 }) * 0.35 * smoothstep(0, 40, ad);
        }
      }
      if (inCityRect(x, z)) h = 0;
      heights[i] = h;
    }
  }
  return T;
}

/** Assign surface codes after roads/carving (city flat areas -> asphalt/concrete, beach sand, hills grass/rock). */
export function computeSurfaces(T, seed, isRoadFn) {
  const { nx, nz, cell, originX, originZ, heights, surface, coastDist } = T;
  const n = { x: 0, y: 1, z: 0 };
  for (let iz = 0; iz < nz; iz++) {
    const z = originZ + iz * cell;
    for (let ix = 0; ix < nx; ix++) {
      const x = originX + ix * cell, i = iz * nx + ix, h = heights[i];
      let s;
      if (h < WATER_LEVEL - 0.3 && coastDist[i] < 0) s = SURFACE.SAND; // seabed
      else if (inCityRect(x, z, -1)) s = (x > 396 && z > 604) ? SURFACE.CONCRETE : SURFACE.ASPHALT;
      else if (isRoadFn && isRoadFn(x, z)) s = SURFACE.ASPHALT;
      else {
        T.normalAt(x, z, n);
        const d = coastDist[i];
        if (h < 1.2 && d < 140 && z > -900) s = SURFACE.SAND;
        else if (n.y < 0.8) s = SURFACE.ROCK;
        else if (n.y < 0.9 && fbm2(x / 40, z / 40, { octaves: 2, seed }) > 0) s = SURFACE.DIRT;
        else s = SURFACE.GRASS;
        if (h < 2.5 && d < 30 && z < -760) s = SURFACE.ROCK;
      }
      surface[i] = s;
    }
  }
}
