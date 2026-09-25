// Seeded random numbers and noise. Shared by every module (textures, terrain, city layout, audio...).
// All functions are deterministic for a given seed.

/** Mulberry32 PRNG. Returns an object with helpers. */
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** float in [a, b) */
    range: (a, b) => a + (b - a) * next(),
    /** integer in [a, b] inclusive */
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    /** true with probability p */
    chance: (p) => next() < p,
    /** random element */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** weighted pick: items [{w, v}] or parallel arrays */
    weighted: (items) => {
      let total = 0;
      for (const it of items) total += it.w;
      let r = next() * total;
      for (const it of items) { r -= it.w; if (r <= 0) return it.v; }
      return items[items.length - 1].v;
    },
    /** gaussian-ish (sum of 3 uniforms), mean 0, sd ~0.5 */
    gauss: () => (next() + next() + next() - 1.5),
    shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; },
    get seed() { return s; },
  };
}

/** Integer hash -> [0,1). Good for per-cell/per-object randomness without state. */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function hash1(x, seed = 0) { return hash2(x, 0x9E37, seed); }
export function hash3(x, y, z, seed = 0) { return hash2(x, (y | 0) * 31337 + (z | 0), seed); }

/** String -> 32-bit seed */
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D value noise in [0,1], smooth (quintic). */
export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// --- 2D simplex noise (Stefan Gustavson, public domain), output ~[-1,1] ---
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const GRAD2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const permCache = new Map();
function perm(seed) {
  let p = permCache.get(seed);
  if (p) return p;
  const r = makeRng(seed * 7919 + 17);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); const t = base[i]; base[i] = base[j]; base[j] = t; }
  p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  permCache.set(seed, p);
  return p;
}
export function simplex2(xin, yin, seed = 0) {
  const p = perm(seed);
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t), y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) { const g = GRAD2[p[ii + p[jj]] & 7]; t0 *= t0; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) { const g = GRAD2[p[ii + i1 + p[jj + j1]] & 7]; t1 *= t1; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) { const g = GRAD2[p[ii + 1 + p[jj + 1]] & 7]; t2 *= t2; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2); }
  return 70 * (n0 + n1 + n2);
}

/** Fractal Brownian motion of simplex noise, output roughly [-1,1]. */
export function fbm2(x, y, { octaves = 5, lacunarity = 2, gain = 0.5, seed = 0 } = {}) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * simplex2(x * freq, y * freq, seed + o * 13);
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal (0..1), good for mountains/cracks. */
export function ridged2(x, y, { octaves = 5, lacunarity = 2, gain = 0.5, seed = 0 } = {}) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(simplex2(x * freq, y * freq, seed + o * 29));
    sum += amp * n * n; norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

/** Tileable 2D value noise on a period (for seamless textures). period in cells. */
export function tileNoise2(x, y, period, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const px = ((xi % period) + period) % period, py = ((yi % period) + period) % period;
  const px1 = (px + 1) % period, py1 = (py + 1) % period;
  const a = hash2(px, py, seed), b = hash2(px1, py, seed);
  const c = hash2(px, py1, seed), d = hash2(px1, py1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable fbm in [0,1]: x,y in [0,1) texture space, base period = cells at octave 0. */
export function tileFbm(x, y, { period = 8, octaves = 5, gain = 0.5, seed = 0 } = {}) {
  let amp = 1, sum = 0, norm = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    sum += amp * tileNoise2(x * p, y * p, p, seed + o * 101);
    norm += amp; amp *= gain; p *= 2;
  }
  return sum / norm;
}
