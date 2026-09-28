// Procedural textures (canvas + pixel noise). Everything is generated at load; no image files.
//   createTextures(renderer, quality) -> {
//     facade: { albedo: DataArrayTexture(RGBA: sRGB color, A=roughness), mask: DataArrayTexture(R=window, G=interior, B=metal, A=height), count, size },
//     ground: { albedo: DataArrayTexture(RGBA color+rough), height: DataArrayTexture(R), layers:{NAME:i}, tile:[m per repeat] },
//     leaves: { palm, broad, pine } CanvasTextures (alpha), bark, billboards (atlas CanvasTexture, 2x5), signs(text)->CanvasTexture,
//     noise: DataTexture (tileable RGBA noise), water normals are made in water.js }
import * as THREE from 'three';
import { makeRng, tileFbm } from '../core/rng.js';
import { clamp } from '../core/math.js';

export const GROUND_LAYERS = ['SIDEWALK', 'CONCRETE', 'PAVERS', 'GRASS', 'PARKING', 'DIRT', 'SAND', 'GRAVEL', 'WOOD', 'ASPHALT', 'ROCK', 'DRYGRASS', 'ROOFTILE', 'SHINGLE'];
export const GROUND_TILE = [3, 4, 2.4, 5, 7, 5, 6, 3, 3.6, 9, 7, 5, 2.4, 2.4];
const FACADE_COUNT = 19;

// ---------------------------------------------------------------- noise helpers
function makeNoiseTile(n, seed, period = 8, octaves = 5, gain = 0.5) {
  const a = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) a[y * n + x] = tileFbm(x / n, y / n, { period, octaves, gain, seed });
  let mn = 1, mx = 0; for (const v of a) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - mn) / (mx - mn || 1);
  return { n, a };
}
function sampleN(t, u, v) { // u,v in texels of the noise tile (wrapping), bilinear
  const n = t.n;
  let x = u % n; if (x < 0) x += n; let y = v % n; if (y < 0) y += n;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
  const a = t.a[y0 * n + x0], b = t.a[y0 * n + x1], c = t.a[y1 * n + x0], d = t.a[y1 * n + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
let N1, N2, N3;
function initNoise() {
  if (N1) return;
  N1 = makeNoiseTile(128, 11, 4, 5, 0.55);
  N2 = makeNoiseTile(128, 23, 8, 4, 0.5);
  N3 = makeNoiseTile(64, 37, 16, 2, 0.5);
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// ---------------------------------------------------------------- facade layers
// Each painter draws into two canvases: color (ctx) and mask (mctx: R window, G interior, B metal, A height).
// Coordinates in meters; helper converts (m) -> px with v up.
function facadePainter(S, tileW, tileH, ctx, mctx) {
  const sx = S / tileW, sy = S / tileH;
  const R = (x, y, w, h) => [x * sx, S - (y + h) * sy, w * sx, h * sy]; // y from bottom
  return {
    sx, sy,
    rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(...R(x, y, w, h)); },
    mask(x, y, w, h, r, g, b, a) { mctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`; mctx.fillRect(...R(x, y, w, h)); },
    both(x, y, w, h, color, r, g, b, a) { this.rect(x, y, w, h, color); this.mask(x, y, w, h, r, g, b, a); },
  };
}
function rgb(r, g, b) { return `rgb(${r | 0},${g | 0},${b | 0})`; }

function paintFacade(i, S, rng) {
  const c = canvas(S, S), m = canvas(S, S);
  const ctx = c.getContext('2d'), mctx = m.getContext('2d', { willReadFrequently: true });
  // default mask: opaque wall, not metal, height mid
  mctx.fillStyle = 'rgba(0,0,0,0.5)'; mctx.fillRect(0, 0, S, S);
  if (i === 16 || i === 17) { // roof tiles/shingles reuse ground painters
    const g = paintGround(i === 16 ? 12 : 13, S, rng), md = new Uint8ClampedArray(S * S * 4);
    for (let p = 0; p < S * S * 4; p += 4) { md[p] = 0; md[p + 1] = 0; md[p + 2] = 0; md[p + 3] = g.height[p]; }
    return { color: g.color, mask: md };
  }
  const T = [[6, 8], [6, 8], [6, 8], [6, 7.2], [5, 7], [5, 7], [6, 6.4], [8, 7.2], [8, 4.5], [8, 12], [6, 3], [6, 3], [6, 3.2], [8, 8], [4, 4], [4, 4], [2.4, 2.4], [2.4, 2.4], [6, 2.6]][i];
  const P = facadePainter(S, T[0], T[1], ctx, mctx);
  // roughness is written into the color alpha later from `roughMap` canvas: we encode via separate pass
  const rough = canvas(S, S), rctx = rough.getContext('2d', { willReadFrequently: true });
  const RR = (x, y, w, h, v) => { rctx.fillStyle = rgb(v, v, v); rctx.fillRect(x * P.sx, S - (y + h) * P.sy, w * P.sx, h * P.sy); };
  const glassPane = (x, y, w, h, base, metal, rv) => {
    // glass with subtle vertical gradient + interior variation in mask G
    const g = ctx.createLinearGradient(0, S - (y + h) * P.sy, 0, S - y * P.sy);
    g.addColorStop(0, rgb(base[0] * 1.25, base[1] * 1.25, base[2] * 1.2)); g.addColorStop(1, rgb(base[0] * 0.8, base[1] * 0.8, base[2] * 0.85));
    ctx.fillStyle = g; ctx.fillRect(x * P.sx, S - (y + h) * P.sy, w * P.sx, h * P.sy);
    const interior = 120 + rng.int(0, 135);
    P.mask(x, y, w, h, 255, interior, metal, 90);
    RR(x, y, w, h, Math.max(rv, 30));
    // blinds on some panes (show in G when lit)
    if (rng.chance(0.35)) { const bh = h * rng.range(0.2, 0.7); P.mask(x, y + h - bh, w, bh, 255, 40 + rng.int(0, 60), metal, 90); }
  };
  switch (i) {
    case 0: case 1: case 2: { // curtain walls
      const glass = i === 0 ? [28, 58, 78] : i === 1 ? [18, 20, 24] : [70, 86, 92];
      const span = i === 0 ? '#1f2c3a' : i === 1 ? '#141416' : '#3d4a4f';
      const mull = i === 1 ? '#2a2b2d' : '#9aa3aa';
      const metal = i === 1 ? 120 : 160;
      P.rect(0, 0, 6, 8, span); RR(0, 0, 6, 8, 70); P.mask(0, 0, 6, 8, 0, 0, 100, 128);
      for (let f = 0; f < 2; f++) for (let b = 0; b < 2; b++) {
        const x = b * 3, y = f * 4;
        const spH = i === 1 ? 1.2 : 0.9;
        glassPane(x + 0.06, y + spH, 2.88, 4 - spH - 0.06, glass, metal, i === 2 ? 12 : 16);
        if (i !== 1) { P.rect(x + 1.47, y + spH, 0.06, 4 - spH, mull); P.mask(x + 1.47, y + spH, 0.06, 4 - spH, 0, 0, 230, 180); }
      }
      for (let b = 0; b <= 2; b++) { P.rect(b * 3 - 0.07, 0, 0.14, 8, mull); P.mask(b * 3 - 0.07, 0, 0.14, 8, 0, 0, 230, 200); RR(b * 3 - 0.07, 0, 0.14, 8, 90); }
      for (let f = 0; f <= 2; f++) { P.rect(0, f * 4 - 0.05, 6, 0.1, mull); P.mask(0, f * 4 - 0.05, 6, 0.1, 0, 0, 230, 200); }
      break;
    }
    case 3: { // office concrete, punched windows
      P.rect(0, 0, 6, 7.2, '#c4bdb1'); RR(0, 0, 6, 7.2, 215);
      for (let f = 0; f < 2; f++) {
        P.rect(0, f * 3.6, 6, 0.35, '#b0a99d'); P.mask(0, f * 3.6, 6, 0.35, 0, 0, 0, 170);
        for (let b = 0; b < 2; b++) {
          const x = b * 3 + 0.55, y = f * 3.6 + 0.95;
          P.rect(x - 0.08, y - 0.12, 1.9 + 0.16, 2.0 + 0.2, '#6f6b66'); P.mask(x - 0.08, y - 0.12, 2.06, 2.2, 0, 0, 60, 60);
          glassPane(x, y, 1.9, 2.0, [34, 40, 46], 60, 20);
          P.rect(x + 0.93, y, 0.05, 2.0, '#5a5752');
        }
      }
      break;
    }
    case 4: case 5: { // brick
      const base = i === 4 ? [150, 70, 52] : [96, 66, 54];
      P.rect(0, 0, 5, 7, i === 4 ? '#b8ab98' : '#8a7f72'); RR(0, 0, 5, 7, 225);
      const bw = 0.24, bh = 0.075;
      for (let row = 0; row * bh < 7; row++) {
        const off = (row % 2) * bw / 2;
        for (let x = -off; x < 5; x += bw) {
          const k = 0.8 + rng.next() * 0.35;
          ctx.fillStyle = rgb(base[0] * k, base[1] * k, base[2] * k);
          ctx.fillRect(x * P.sx + 1, S - (row + 1) * bh * P.sy + 1, bw * P.sx - 1.5, bh * P.sy - 1.2);
        }
      }
      for (let r = 0; r * 0.075 < 7; r++) { mctx.fillStyle = 'rgba(0,0,0,0.35)'; mctx.fillRect(0, S - r * 0.075 * P.sy, S, 1); }
      for (let f = 0; f < 2; f++) for (let b = 0; b < 2; b++) {
        const x = b * 2.5 + 0.7, y = f * 3.5 + 0.9, w = 1.1, h = 1.95;
        P.rect(x - 0.12, y - 0.14, w + 0.24, 0.14, '#d8d0c0'); P.mask(x - 0.12, y - 0.14, w + 0.24, 0.14, 0, 0, 0, 200); // sill
        P.rect(x - 0.1, y + h, w + 0.2, 0.22, i === 4 ? '#cfc4b0' : '#6d5e50'); // lintel
        P.rect(x - 0.06, y - 0.02, w + 0.12, h + 0.04, '#ece8df'); P.mask(x - 0.06, y - 0.02, w + 0.12, h + 0.04, 0, 0, 0, 60);
        glassPane(x, y, w, h, [30, 34, 38], 30, 18);
        P.rect(x, y + h * 0.55, w, 0.05, '#ece8df'); P.rect(x + w / 2 - 0.025, y, 0.05, h, '#ece8df');
        if (i === 5) { ctx.fillStyle = '#6d5e50'; ctx.beginPath(); ctx.ellipse((x + w / 2) * P.sx, S - (y + h + 0.05) * P.sy, (w / 2 + 0.12) * P.sx, 0.3 * P.sy, 0, Math.PI, 0); ctx.fill(); }
      }
      break;
    }
    case 6: { // stucco with balconies (light, tinted by vertex color)
      P.rect(0, 0, 6, 6.4, '#ece6dc'); RR(0, 0, 6, 6.4, 230);
      for (let f = 0; f < 2; f++) for (let b = 0; b < 2; b++) {
        const x = b * 3 + 0.8, y = f * 3.2 + 0.55, w = 1.4, h = 2.1;
        P.rect(x - 0.1, y - 0.1, w + 0.2, h + 0.2, '#f7f4ee'); P.mask(x - 0.1, y - 0.1, w + 0.2, h + 0.2, 0, 0, 0, 170);
        glassPane(x, y, w, h, [40, 52, 60], 40, 18);
        P.rect(x + w / 2 - 0.03, y, 0.06, h, '#f7f4ee');
        // balcony slab + railing
        P.rect(x - 0.5, y - 0.3, w + 1, 0.18, '#d9d2c6'); P.mask(x - 0.5, y - 0.3, w + 1, 0.18, 0, 0, 0, 230);
        for (let k = 0; k <= 12; k++) { P.rect(x - 0.45 + k * (w + 0.9) / 12, y - 0.12, 0.03, 1.0, '#39424a'); P.mask(x - 0.45 + k * (w + 0.9) / 12, y - 0.12, 0.03, 1.0, 0, 0, 200, 220); }
        P.rect(x - 0.5, y + 0.86, w + 1, 0.06, '#39424a'); P.mask(x - 0.5, y + 0.86, w + 1, 0.06, 0, 0, 200, 230);
      }
      break;
    }
    case 7: { // modern white ribbon windows
      P.rect(0, 0, 8, 7.2, '#eeeeec'); RR(0, 0, 8, 7.2, 150);
      for (let f = 0; f < 2; f++) {
        glassPane(0, f * 3.6 + 1.1, 8, 1.7, [26, 34, 42], 90, 10);
        for (let k = 0; k < 4; k++) { P.rect(k * 2 - 0.03, f * 3.6 + 1.1, 0.06, 1.7, '#cfd3d6'); P.mask(k * 2 - 0.03, f * 3.6 + 1.1, 0.06, 1.7, 0, 0, 200, 150); }
        P.rect(0, f * 3.6, 8, 0.03, '#d4d4d2');
      }
      for (let k = 0; k < 4; k++) P.rect(k * 2, 0, 0.02, 7.2, '#dcdcda');
      break;
    }
    case 8: { // storefront
      P.rect(0, 0, 8, 4.5, '#3a3633'); RR(0, 0, 8, 4.5, 140);
      for (let b = 0; b < 2; b++) {
        const x = b * 4 + 0.35, w = 3.3;
        P.rect(x - 0.08, 0.3, w + 0.16, 3.0, '#23211f'); P.mask(x - 0.08, 0.3, w + 0.16, 3.0, 0, 0, 180, 80);
        const g = ctx.createLinearGradient(0, S - 3.2 * P.sy, 0, S - 0.4 * P.sy);
        g.addColorStop(0, '#4a4f52'); g.addColorStop(1, '#2a2d30');
        ctx.fillStyle = g; ctx.fillRect(x * P.sx, S - 3.2 * P.sy, w * P.sx, 2.8 * P.sy);
        P.mask(x, 0.4, w, 2.8, 255, 255, 60, 90); RR(x, 0.4, w, 2.8, 14);
        // shelves silhouettes in interior channel
        for (let k = 0; k < 3; k++) P.mask(x + 0.2, 0.9 + k * 0.7, w - 0.4, 0.08, 255, 150, 60, 90);
        if (b === 1) { P.rect(x + w - 1.1, 0.35, 1.0, 2.5, '#1b1b1b'); P.mask(x + w - 1.1, 0.35, 1.0, 2.5, 255, 200, 40, 70); P.rect(x + w - 0.65, 0.35, 0.05, 2.5, '#888'); }
        P.rect(x, 0.3, w, 0.1, '#777'); // kick plate
      }
      // sign band
      P.rect(0, 3.45, 8, 0.8, '#26292c'); P.mask(0, 3.45, 8, 0.8, 0, 0, 120, 200);
      P.rect(0, 3.4, 8, 0.05, '#aab'); P.rect(0, 4.25, 8, 0.25, '#4a4643');
      for (let b = 0; b <= 2; b++) { P.rect(b * 4 - 0.18, 0, 0.36, 4.5, '#5a5550'); P.mask(b * 4 - 0.18, 0, 0.36, 4.5, 0, 0, 0, 200); }
      break;
    }
    case 9: { // corrugated metal warehouse
      P.rect(0, 0, 8, 12, '#b9bcbf'); RR(0, 0, 8, 12, 120);
      for (let x = 0; x < 8; x += 0.2) {
        const g = ctx.createLinearGradient(x * P.sx, 0, (x + 0.2) * P.sx, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.18)'); g.addColorStop(0.5, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.18)');
        ctx.fillStyle = g; ctx.fillRect(x * P.sx, 0, 0.2 * P.sx, S);
        const hg = mctx.createLinearGradient(x * P.sx, 0, (x + 0.2) * P.sx, 0);
        hg.addColorStop(0, 'rgba(0,0,140,0.2)'); hg.addColorStop(0.5, 'rgba(0,0,140,0.8)'); hg.addColorStop(1, 'rgba(0,0,140,0.2)');
        mctx.fillStyle = hg; mctx.fillRect(x * P.sx, 0, 0.2 * P.sx, S);
      }
      glassPane(0.3, 9.2, 7.4, 1.2, [60, 70, 76], 60, 40);
      for (let k = 0; k < 4; k++) P.rect(0.3 + k * 1.85, 9.2, 0.06, 1.2, '#666');
      P.rect(0, 0, 8, 0.6, '#77746f'); P.mask(0, 0, 8, 0.6, 0, 0, 0, 180); // concrete plinth
      P.rect(0, 11.6, 8, 0.4, '#8c8f92');
      break;
    }
    case 10: case 11: { // houses
      if (i === 10) { P.rect(0, 0, 6, 3, '#e9e6e0'); RR(0, 0, 6, 3, 200); for (let y = 0; y < 3; y += 0.2) { P.rect(0, y, 6, 0.025, 'rgba(0,0,0,0.22)'); P.mask(0, y, 6, 0.03, 0, 0, 0, 40); } }
      else { P.rect(0, 0, 6, 3, '#ebe3d6'); RR(0, 0, 6, 3, 235); }
      const x = 2.3, y = 0.95, w = 1.4, h = 1.35;
      P.rect(x - 0.12, y - 0.12, w + 0.24, h + 0.24, '#fbfbf8'); P.mask(x - 0.12, y - 0.12, w + 0.24, h + 0.24, 0, 0, 0, 200);
      glassPane(x, y, w, h, [36, 44, 50], 30, 18);
      P.rect(x + w / 2 - 0.03, y, 0.06, h, '#fbfbf8'); P.rect(x, y + h / 2 - 0.03, w, 0.06, '#fbfbf8');
      if (i === 11) { P.rect(x - 0.62, y - 0.05, 0.45, h + 0.1, '#4d6b5a'); P.rect(x + w + 0.17, y - 0.05, 0.45, h + 0.1, '#4d6b5a'); }
      P.rect(0, 0, 6, 0.25, '#8a857c');
      break;
    }
    case 12: { // parking garage
      P.rect(0, 0, 6, 3.2, '#b7b2a8'); RR(0, 0, 6, 3.2, 230);
      P.rect(0, 1.25, 6, 1.95, '#121314'); P.mask(0, 1.25, 6, 1.95, 255, 70, 0, 20); RR(0, 1.25, 6, 1.95, 250);
      P.rect(0, 0.2, 6, 1.05, '#c9c3b8');
      for (let k = 0; k < 2; k++) { P.rect(k * 3 - 0.2, 0, 0.4, 3.2, '#aaa49a'); P.mask(k * 3 - 0.2, 0, 0.4, 3.2, 0, 0, 0, 200); }
      break;
    }
    case 13: { // flat roof membrane
      P.rect(0, 0, 8, 8, '#8d8a85'); RR(0, 0, 8, 8, 235);
      for (let k = 0; k < 4; k++) { P.rect(k * 2, 0, 0.04, 8, 'rgba(0,0,0,0.2)'); }
      break;
    }
    case 14: { P.rect(0, 0, 4, 4, '#b5b0a6'); RR(0, 0, 4, 4, 225); P.rect(0, 1.99, 4, 0.03, 'rgba(0,0,0,0.25)'); P.rect(1.99, 0, 0.03, 4, 'rgba(0,0,0,0.15)'); break; }
    case 15: { P.rect(0, 0, 4, 4, '#9ea4a8'); RR(0, 0, 4, 4, 110); P.mask(0, 0, 4, 4, 0, 0, 200, 128); for (let k = 0; k < 4; k++) P.rect(k, 0, 0.03, 4, 'rgba(0,0,0,0.3)'); break; }
    case 18: { // shipping container: ribbed steel, rails top/bottom (tinted by instance color)
      P.rect(0, 0, 6, 2.6, '#d8d8d8'); RR(0, 0, 6, 2.6, 150); P.mask(0, 0, 6, 2.6, 0, 0, 90, 128);
      for (let x = 0; x < 6; x += 0.3) {
        const g = ctx.createLinearGradient(x * P.sx, 0, (x + 0.3) * P.sx, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(0.3, 'rgba(255,255,255,0.15)'); g.addColorStop(0.7, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.22)');
        ctx.fillStyle = g; ctx.fillRect(x * P.sx, 0, 0.3 * P.sx, S);
        const hg = mctx.createLinearGradient(x * P.sx, 0, (x + 0.3) * P.sx, 0);
        hg.addColorStop(0, 'rgba(0,0,90,0.1)'); hg.addColorStop(0.4, 'rgba(0,0,90,0.9)'); hg.addColorStop(1, 'rgba(0,0,90,0.1)');
        mctx.fillStyle = hg; mctx.fillRect(x * P.sx, 0, 0.3 * P.sx, S);
      }
      P.rect(0, 0, 6, 0.16, '#8a8a8a'); P.rect(0, 2.44, 6, 0.16, '#8a8a8a'); P.mask(0, 0, 6, 0.16, 0, 0, 120, 200); P.mask(0, 2.44, 6, 0.16, 0, 0, 120, 200);
      break;
    }
  }
  // pixel pass: grime/noise into color, roughness into alpha
  const cd = ctx.getImageData(0, 0, S, S), md = mctx.getImageData(0, 0, S, S), rd = rctx.getImageData(0, 0, S, S);
  const grime = [0.12, 0.08, 0.1, 0.22, 0.25, 0.22, 0.16, 0.08, 0.2, 0.28, 0.12, 0.14, 0.3, 0.35, 0.3, 0.2][i];
  const k = 128 / S;
  for (let y = 0; y < S; y++) {
    const streak = (y / S); // top of texture = higher on the building; grime streaks downward from sills
    for (let x = 0; x < S; x++) {
      const p = (y * S + x) * 4;
      const n1 = sampleN(N1, x * k * 2, y * k * 2), n2 = sampleN(N2, x * k, y * k * 0.25);
      const win = md.data[p] / 255;
      const g = 1 - grime * ((n1 - 0.5) * 0.9 + (n2 - 0.5) * 0.9 + 0.2) * (1 - win * 0.8);
      cd.data[p] = clamp(cd.data[p] * g, 0, 255); cd.data[p + 1] = clamp(cd.data[p + 1] * g, 0, 255); cd.data[p + 2] = clamp(cd.data[p + 2] * g, 0, 255);
      cd.data[p + 3] = clamp(rd.data[p] + (n1 - 0.5) * 30 * (1 - win), 0, 255);
      md.data[p + 3] = clamp(md.data[p + 3] + (n1 - 0.5) * 40, 0, 255);
    }
  }
  return { color: cd.data, mask: md.data };
}

function makeArray(S, count, fill, srgb) {
  const data = new Uint8Array(S * S * 4 * count);
  for (let i = 0; i < count; i++) data.set(fill(i), S * S * 4 * i);
  const t = new THREE.DataArrayTexture(data, S, S, count);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- ground layers
function paintGround(i, S, rng) {
  const c = canvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  const hC = canvas(S, S), hctx = hC.getContext('2d', { willReadFrequently: true });
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
  const tile = GROUND_TILE[i], ppm = S / tile;
  let base = [128, 128, 128], rough = 200, noiseAmt = 0.15, speck = 0, grass = false;
  const fill = (col) => { ctx.fillStyle = col; ctx.fillRect(0, 0, S, S); };
  switch (GROUND_LAYERS[i]) {
    case 'SIDEWALK': {
      fill('#b9b5ac'); base = null; rough = 215; noiseAmt = 0.12;
      const slab = 1.5 * ppm;
      for (let y = 0; y < S; y += slab) for (let x = 0; x < S; x += slab) {
        const k = 0.94 + rng.next() * 0.1; ctx.fillStyle = rgb(185 * k, 181 * k, 172 * k); ctx.fillRect(x + 1, y + 1, slab - 2, slab - 2);
      }
      ctx.fillStyle = 'rgba(60,58,54,0.55)'; hctx.fillStyle = '#404040';
      for (let p = 0; p < S; p += slab) { ctx.fillRect(p - 1, 0, 2, S); ctx.fillRect(0, p - 1, S, 2); hctx.fillRect(p - 1, 0, 2, S); hctx.fillRect(0, p - 1, S, 2); }
      break;
    }
    case 'CONCRETE': fill('#aca79d'); rough = 225; noiseAmt = 0.18; ctx.fillStyle = 'rgba(40,40,40,0.35)'; hctx.fillStyle = '#505050'; ctx.fillRect(0, 0, S, 2); ctx.fillRect(0, 0, 2, S); hctx.fillRect(0, 0, S, 2); hctx.fillRect(0, 0, 2, S); break;
    case 'PAVERS': {
      fill('#6e6660'); rough = 210; noiseAmt = 0.1;
      const bw = 0.2 * ppm, bh = 0.1 * ppm;
      for (let y = 0, r = 0; y < S; y += bh, r++) for (let x = -(r % 2) * bw / 2; x < S; x += bw) {
        const k = 0.85 + rng.next() * 0.25, t = rng.next();
        const col = t < 0.5 ? [176, 150, 128] : t < 0.8 ? [160, 138, 122] : [190, 172, 150];
        ctx.fillStyle = rgb(col[0] * k, col[1] * k, col[2] * k); ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
        hctx.fillStyle = '#a0a0a0'; hctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      }
      break;
    }
    case 'GRASS': fill('#4f6b2c'); rough = 245; noiseAmt = 0.3; grass = true; break;
    case 'DRYGRASS': fill('#9a8a52'); rough = 245; noiseAmt = 0.3; grass = true; break;
    case 'PARKING': fill('#4a4a4b'); rough = 225; noiseAmt = 0.12; speck = 0.4; break;
    case 'ASPHALT': fill('#454546'); rough = 225; noiseAmt = 0.14; speck = 0.5; break;
    case 'DIRT': fill('#7b6448'); rough = 240; noiseAmt = 0.25; speck = 0.2; break;
    case 'SAND': fill('#d7c49a'); rough = 240; noiseAmt = 0.1; speck = 0.25; break;
    case 'GRAVEL': fill('#8b857b'); rough = 240; noiseAmt = 0.2; speck = 1; break;
    case 'ROCK': fill('#7d7872'); rough = 220; noiseAmt = 0.35; break;
    case 'WOOD': {
      fill('#6b4d33'); rough = 200; noiseAmt = 0.15;
      const pw = 0.3 * ppm;
      for (let x = 0; x < S; x += pw) { const k = 0.8 + rng.next() * 0.35; ctx.fillStyle = rgb(128 * k, 94 * k, 64 * k); ctx.fillRect(x + 1, 0, pw - 2, S); hctx.fillStyle = '#b0b0b0'; hctx.fillRect(x + 1, 0, pw - 2, S); }
      break;
    }
    case 'ROOFTILE': {
      fill('#8f4a33'); rough = 200; noiseAmt = 0.12;
      const tw = 0.3 * ppm, th = 0.35 * ppm;
      for (let y = 0, r = 0; y < S; y += th, r++) for (let x = -(r % 2) * tw / 2; x < S; x += tw) {
        const k = 0.85 + rng.next() * 0.25;
        const g = ctx.createLinearGradient(0, y, 0, y + th); g.addColorStop(0, rgb(170 * k, 90 * k, 62 * k)); g.addColorStop(1, rgb(110 * k, 56 * k, 40 * k));
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x + tw / 2, y + th * 0.55, tw / 2, th * 0.6, 0, 0, Math.PI * 2); ctx.fill();
        const hg = hctx.createLinearGradient(0, y, 0, y + th); hg.addColorStop(0, '#e0e0e0'); hg.addColorStop(1, '#303030');
        hctx.fillStyle = hg; hctx.fillRect(x, y, tw, th);
      }
      break;
    }
    case 'SHINGLE': {
      fill('#4a4a4c'); rough = 230; noiseAmt = 0.15;
      const tw = 0.35 * ppm, th = 0.2 * ppm;
      for (let y = 0, r = 0; y < S; y += th, r++) for (let x = -(r % 2) * tw / 2; x < S; x += tw) {
        const k = 0.8 + rng.next() * 0.35; ctx.fillStyle = rgb(80 * k, 80 * k, 84 * k); ctx.fillRect(x + 1, y, tw - 2, th - 1);
        hctx.fillStyle = '#b0b0b0'; hctx.fillRect(x + 1, y, tw - 2, th - 1); hctx.fillStyle = '#303030'; hctx.fillRect(x, y + th - 2, tw, 2);
      }
      break;
    }
  }
  const cd = ctx.getImageData(0, 0, S, S), hd = hctx.getImageData(0, 0, S, S);
  const k = 128 / S, name = GROUND_LAYERS[i];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const p = (y * S + x) * 4;
    const n1 = sampleN(N1, x * k * 4, y * k * 4), n2 = sampleN(N2, x * k, y * k), n3 = sampleN(N3, x * k * 16, y * k * 16);
    let f = 1 + (n1 - 0.5) * noiseAmt * 1.6 + (n2 - 0.5) * noiseAmt;
    let r = cd.data[p] * f, g = cd.data[p + 1] * f, b = cd.data[p + 2] * f;
    let h = hd.data[p] + (n1 - 0.5) * 60 + (n3 - 0.5) * 50;
    if (speck) { const s = n3 > 0.72 ? 1.25 : n3 < 0.25 ? 0.8 : 1; const q = 1 + (s - 1) * speck; r *= q; g *= q; b *= q; h += (s - 1) * (name === 'GRAVEL' ? 30 : 120) * speck; }
    if (grass) { // blades: high-frequency variation + yellow/brown patches
      const bl = sampleN(N3, x * k * 40, y * k * 12);
      const q = 0.75 + bl * 0.5; r *= q * (1 + (n2 - 0.5) * 0.5); g *= q; b *= q * 0.95;
      h = 100 + bl * 120;
    }
    if (name === 'ROCK') { const cr = sampleN(N3, x * k * 8, y * k * 8); h = 60 + n1 * 150 + cr * 40; const q = 0.7 + n1 * 0.55; r *= q; g *= q; b *= q; }
    if (name === 'SAND') { const rip = Math.sin((x * 0.09 + n2 * 40)) * 0.5 + 0.5; h = 110 + rip * 40 + n1 * 40; }
    if (name === 'ASPHALT' || name === 'PARKING') { // cracks & patches
      if (n2 > 0.72) { r *= 0.85; g *= 0.85; b *= 0.86; }
      const crack = Math.abs(sampleN(N1, x * k * 2 + 33, y * k * 2 + 71) - 0.5); if (crack < 0.006) { r *= 0.55; g *= 0.55; b *= 0.55; h -= 60; }
    }
    cd.data[p] = clamp(r, 0, 255); cd.data[p + 1] = clamp(g, 0, 255); cd.data[p + 2] = clamp(b, 0, 255);
    cd.data[p + 3] = clamp(rough + (n1 - 0.5) * 30, 0, 255);
    hd.data[p] = clamp(h, 0, 255); hd.data[p + 1] = hd.data[p + 2] = hd.data[p]; hd.data[p + 3] = 255;
  }
  return { color: cd.data, height: hd.data };
}

// ---------------------------------------------------------------- foliage
function leafTexture(kind, S, rng) {
  const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  if (kind === 'palm') {
    // frond: central rib with leaflets, drawn horizontally (u along frond)
    ctx.strokeStyle = '#6b6a3a'; ctx.lineWidth = S * 0.012; ctx.beginPath(); ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2); ctx.stroke();
    for (let i = 0; i < 70; i++) {
      const u = 0.03 + i / 72, len = S * 0.46 * Math.sin(Math.PI * Math.min(1, u * 1.05)) * (0.85 + rng.next() * 0.3);
      for (const s of [-1, 1]) {
        const x0 = u * S, y0 = S / 2, x1 = x0 + len * 0.45, y1 = y0 + s * len;
        const k = 0.75 + rng.next() * 0.4;
        ctx.strokeStyle = rgb(62 * k, 104 * k, 38 * k); ctx.lineWidth = S * 0.011;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + len * 0.1, y0 + s * len * 0.6, x1, y1); ctx.stroke();
      }
    }
  } else if (kind === 'broad' || kind === 'pine') {
    const n = kind === 'broad' ? 260 : 420;
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2, r = Math.sqrt(rng.next()) * S * 0.46;
      const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
      const k = 0.6 + rng.next() * 0.55 - (r / S) * 0.3;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rng.next() * 6.28);
      if (kind === 'broad') { ctx.fillStyle = rgb(58 * k, 92 * k, 36 * k); ctx.beginPath(); ctx.ellipse(0, 0, S * 0.028, S * 0.016, 0, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.strokeStyle = rgb(34 * k, 62 * k, 40 * k); ctx.lineWidth = S * 0.006; ctx.beginPath(); ctx.moveTo(-S * 0.03, 0); ctx.lineTo(S * 0.03, 0); ctx.stroke(); }
      ctx.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function palmBarkTexture(S, rng) {
  const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#8b7a62'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) { const x = rng.next() * S, k = 0.75 + rng.next() * 0.4; ctx.fillStyle = rgb(120 * k, 104 * k, 84 * k); ctx.fillRect(x, 0, 1 + rng.next() * 2, S); }
  for (let r = 0; r < 4; r++) {
    const y = r * S / 4;
    const g = ctx.createLinearGradient(0, y, 0, y + S / 4);
    g.addColorStop(0, 'rgba(40,30,20,0.55)'); g.addColorStop(0.18, 'rgba(60,50,35,0.1)'); g.addColorStop(0.8, 'rgba(255,240,220,0.08)'); g.addColorStop(1, 'rgba(40,30,20,0.4)');
    ctx.fillStyle = g; ctx.fillRect(0, y, S, S / 4);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function barkTexture(S, rng) {
  const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#6a5a48'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 160; i++) { const x = rng.next() * S, k = 0.6 + rng.next() * 0.6; ctx.fillStyle = rgb(90 * k, 76 * k, 60 * k); ctx.fillRect(x, 0, 1 + rng.next() * 3, S); }
  for (let y = 0; y < S; y += S / 16) { ctx.fillStyle = 'rgba(40,30,20,0.35)'; ctx.fillRect(0, y, S, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// ---------------------------------------------------------------- billboards & signs (original invented brands)
export const ADS = [
  { brand: 'KOLA KAI', line: 'Coconut cold brew. Wake the tide.', bg: ['#0e6f73', '#16a39b'], fg: '#fff6e0', accent: '#ffcf4a', shape: 'wave' },
  { brand: 'DRIFTLINE', line: 'Surf & skate since the last sunset', bg: ['#f25c3a', '#f7a541'], fg: '#1d1b2f', accent: '#fff', shape: 'sun' },
  { brand: 'PULSAR MOBILE', line: 'Five bars on every beach.', bg: ['#1b1440', '#4b2a8a'], fg: '#f2f0ff', accent: '#39e6c9', shape: 'rings' },
  { brand: 'HARBORFIRST BANK', line: 'Your money, anchored.', bg: ['#e9ecef', '#cfd8dc'], fg: '#0d2b45', accent: '#c9a227', shape: 'anchor' },
  { brand: 'NOODLE NOVA', line: 'Late night. Big bowls. No regrets.', bg: ['#1a1a1a', '#3a0f14'], fg: '#ff5a4e', accent: '#ffd166', shape: 'bowl' },
  { brand: 'VELOCE MOTORS', line: 'Zero to seaside in 4.1', bg: ['#0b0b0c', '#2d3035'], fg: '#e8e8e8', accent: '#ff3b30', shape: 'stripe' },
  { brand: 'SOLBLOCK SPF 50', line: 'Burn the rubber, not your skin.', bg: ['#ffd23f', '#ff9f1c'], fg: '#2b2d42', accent: '#ffffff', shape: 'sun' },
  { brand: 'TIDE 101.3 FM', line: 'Synth-soaked nights on the coast', bg: ['#10002b', '#e0007a'], fg: '#ffffff', accent: '#00e5ff', shape: 'grid' },
  { brand: 'CRESTVIEW ESTATES', line: 'Hillside living. Ocean views.', bg: ['#2d6a4f', '#95d5b2'], fg: '#fdfcdc', accent: '#fec89a', shape: 'hills' },
  { brand: 'GULL & GRILL', line: 'Fish tacos worth fighting birds for', bg: ['#fef6e4', '#f3d2c1'], fg: '#172c66', accent: '#f582ae', shape: 'wave' },
];
function drawAd(ctx, x, y, w, h, ad, rng) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, ad.bg[0]); g.addColorStop(1, ad.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.globalAlpha = 0.9; ctx.strokeStyle = ad.accent; ctx.fillStyle = ad.accent; ctx.lineWidth = h * 0.03;
  const cx = x + w * 0.8, cy = y + h * 0.5;
  switch (ad.shape) {
    case 'wave': for (let k = 0; k < 4; k++) { ctx.beginPath(); for (let i = 0; i <= 40; i++) { const px = x + w * 0.55 + i / 40 * w * 0.45, py = y + h * (0.55 + k * 0.1) + Math.sin(i / 40 * 12 + k) * h * 0.04; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); } break;
    case 'sun': ctx.beginPath(); ctx.arc(cx, y + h * 0.62, h * 0.32, Math.PI, 0); ctx.fill(); for (let k = 0; k < 5; k++) ctx.fillRect(x + w * 0.6, y + h * (0.66 + k * 0.07), w * 0.4, h * 0.025); break;
    case 'rings': for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.arc(cx, cy, h * 0.1 * k, 0, Math.PI * 2); ctx.stroke(); } break;
    case 'anchor': ctx.lineWidth = h * 0.05; ctx.beginPath(); ctx.moveTo(cx, y + h * 0.2); ctx.lineTo(cx, y + h * 0.8); ctx.moveTo(cx - h * 0.2, y + h * 0.35); ctx.lineTo(cx + h * 0.2, y + h * 0.35); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, y + h * 0.55, h * 0.25, 0.2, Math.PI - 0.2); ctx.stroke(); break;
    case 'bowl': ctx.beginPath(); ctx.arc(cx, cy, h * 0.28, 0, Math.PI); ctx.fill(); ctx.lineWidth = h * 0.02; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(cx - h * 0.1 + k * h * 0.1, cy - h * 0.05); ctx.bezierCurveTo(cx - h * 0.2 + k * h * 0.1, cy - h * 0.2, cx + k * h * 0.1, cy - h * 0.25, cx - h * 0.1 + k * h * 0.1, cy - h * 0.4); ctx.stroke(); } break;
    case 'stripe': ctx.beginPath(); ctx.moveTo(x + w * 0.5, y + h); ctx.lineTo(x + w * 0.7, y); ctx.lineTo(x + w * 0.78, y); ctx.lineTo(x + w * 0.58, y + h); ctx.fill(); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(x + w * 0.62, y + h); ctx.lineTo(x + w * 0.82, y); ctx.lineTo(x + w * 0.86, y); ctx.lineTo(x + w * 0.66, y + h); ctx.fill(); break;
    case 'grid': ctx.lineWidth = h * 0.01; for (let k = 0; k < 10; k++) { ctx.beginPath(); ctx.moveTo(x + w * 0.5, y + h * 0.55 + k * k * h * 0.005); ctx.lineTo(x + w, y + h * 0.55 + k * k * h * 0.005); ctx.stroke(); } ctx.beginPath(); ctx.arc(cx, y + h * 0.45, h * 0.18, Math.PI, 0); ctx.fill(); break;
    case 'hills': ctx.beginPath(); ctx.moveTo(x + w * 0.5, y + h); ctx.quadraticCurveTo(x + w * 0.7, y + h * 0.3, x + w * 0.85, y + h * 0.65); ctx.quadraticCurveTo(x + w * 0.95, y + h * 0.45, x + w, y + h * 0.6); ctx.lineTo(x + w, y + h); ctx.fill(); break;
  }
  ctx.restore();
  ctx.fillStyle = ad.fg; ctx.textBaseline = 'alphabetic';
  let fs = h * 0.26; ctx.font = `900 ${fs}px Impact, 'Arial Black', sans-serif`;
  while (ctx.measureText(ad.brand).width > w * 0.58 && fs > 8) { fs *= 0.92; ctx.font = `900 ${fs}px Impact, 'Arial Black', sans-serif`; }
  ctx.fillText(ad.brand, x + w * 0.05, y + h * 0.5);
  let fs2 = h * 0.085; ctx.font = `600 ${fs2}px 'Trebuchet MS', Arial, sans-serif`;
  while (ctx.measureText(ad.line).width > w * 0.55 && fs2 > 6) { fs2 *= 0.93; ctx.font = `600 ${fs2}px 'Trebuchet MS', Arial, sans-serif`; }
  ctx.fillText(ad.line, x + w * 0.05, y + h * 0.7);
  ctx.fillStyle = ad.accent; ctx.fillRect(x + w * 0.05, y + h * 0.78, w * 0.12, h * 0.025);
}
export function makeBillboardAtlas(S, rng) {
  // 2 columns x 5 rows, each cell aspect 2.5:1
  const W = S * 2, H = S * 2, c = canvas(W, H), ctx = c.getContext('2d');
  const cw = W / 2, ch = H / 5;
  ADS.forEach((ad, i) => drawAd(ctx, (i % 2) * cw + 2, Math.floor(i / 2) * ch + 2, cw - 4, ch - 4, ad, rng));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
export const SHOP_SIGNS = ['NOODLE BAR', 'LAUNDRY', 'PHARMACY', 'PAWN', 'DINER', 'BAKERY', 'TATTOO', 'GYM', 'LIQUOR', 'PIZZA', 'BARBER', 'CAFE', 'SURF SHOP', 'TACOS', 'BOOKS', 'VINYL', 'NAILS', 'PHONE FIX', 'DELI', 'SUSHI', 'THRIFT', 'FLOWERS', 'HARDWARE', 'ARCADE'];
/** Atlas of small shop signs (4 cols x 8 rows); returns {texture, count}. Colors vary; emissive-friendly. */
export function makeSignAtlas(S, rng, extra = []) {
  const W = S * 2, H = S * 2, c = canvas(W, H), ctx = c.getContext('2d');
  const cols = 4, rows = 8, cw = W / cols, ch = H / rows;
  const names = SHOP_SIGNS.concat(extra).slice(0, cols * rows);
  const pal = [['#1b1b1b', '#ffd166'], ['#0b3954', '#e0ff4f'], ['#6a040f', '#fff'], ['#ffffff', '#d62828'], ['#14213d', '#fca311'], ['#2d6a4f', '#f1faee'], ['#240046', '#ff4ecd'], ['#003049', '#34f5c5'], ['#f1faee', '#1d3557']];
  names.forEach((n, i) => {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    const [bg, fg] = pal[(i * 7 + 3) % pal.length];
    ctx.fillStyle = bg; ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
    ctx.strokeStyle = fg; ctx.lineWidth = 3; ctx.strokeRect(x + 8, y + 8, cw - 16, ch - 16);
    let fs = ch * 0.5; const fonts = ["900 %px 'Arial Black', sans-serif", "700 %px Georgia, serif", "800 %px 'Trebuchet MS', sans-serif", "700 %px 'Courier New', monospace"];
    const f = fonts[i % fonts.length];
    ctx.font = f.replace('%', fs); while (ctx.measureText(n).width > cw * 0.84 && fs > 6) { fs *= 0.92; ctx.font = f.replace('%', fs); }
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n, x + cw / 2, y + ch / 2 + 2);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { texture: t, count: names.length, cols, rows, names };
}
/** Single text sign texture (for special buildings / neon). */
export function makeTextSign(text, { w = 1024, h = 192, bg = '#141414', fg = '#ffffff', font = "900 %px 'Arial Black', sans-serif", border = null, neon = false } = {}) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); } else ctx.clearRect(0, 0, w, h);
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = h * 0.05; ctx.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12); }
  let fs = h * 0.62; ctx.font = font.replace('%', fs);
  while (ctx.measureText(text).width > w * 0.9 && fs > 8) { fs *= 0.94; ctx.font = font.replace('%', fs); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (neon) { ctx.shadowColor = fg; ctx.shadowBlur = h * 0.15; }
  ctx.fillStyle = fg; ctx.fillText(text, w / 2, h / 2 + h * 0.04);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- main
export function createTextures(renderer, quality = 'medium') {
  const t0 = performance.now();
  initNoise();
  const rng = makeRng(4242);
  const FS = quality === 'low' ? 256 : quality === 'medium' ? 512 : 512;
  const GS = quality === 'low' ? 256 : 512;
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const facades = [];
  for (let i = 0; i < FACADE_COUNT; i++) facades.push(paintFacade(i, FS, rng));
  const fAlb = makeArray(FS, FACADE_COUNT, i => facades[i].color, true);
  const fMask = makeArray(FS, FACADE_COUNT, i => facades[i].mask, false);
  fAlb.anisotropy = fMask.anisotropy = maxAniso;
  const grounds = [];
  for (let i = 0; i < GROUND_LAYERS.length; i++) grounds.push(paintGround(i, GS, rng));
  const gAlb = makeArray(GS, GROUND_LAYERS.length, i => grounds[i].color, true);
  const gH = makeArray(GS, GROUND_LAYERS.length, i => grounds[i].height, false);
  gAlb.anisotropy = gH.anisotropy = maxAniso;
  const layers = {}; GROUND_LAYERS.forEach((n, i) => layers[n] = i);
  const LS = quality === 'low' ? 256 : 512;
  const out = {
    facade: { albedo: fAlb, mask: fMask, count: FACADE_COUNT, size: FS },
    ground: { albedo: gAlb, height: gH, layers, tile: GROUND_TILE, size: GS },
    leaves: { palm: leafTexture('palm', LS, rng), broad: leafTexture('broad', LS, rng), pine: leafTexture('pine', LS, rng) },
    bark: barkTexture(256, rng),
    palmBark: palmBarkTexture(256, rng),
    billboards: makeBillboardAtlas(quality === 'low' ? 512 : 1024, rng),
    signs: makeSignAtlas(512, rng),
    makeTextSign,
    time: 0,
  };
  // noise texture for shaders (RGBA of 4 independent tileable noises)
  const NS = 128, nd = new Uint8Array(NS * NS * 4);
  for (let y = 0; y < NS; y++) for (let x = 0; x < NS; x++) {
    const p = (y * NS + x) * 4;
    nd[p] = sampleN(N1, x, y) * 255; nd[p + 1] = sampleN(N2, x, y) * 255; nd[p + 2] = sampleN(N3, x / 2, y / 2) * 255; nd[p + 3] = sampleN(N1, x * 2 + 17, y * 2 + 5) * 255;
  }
  const nt = new THREE.DataTexture(nd, NS, NS, THREE.RGBAFormat);
  nt.wrapS = nt.wrapT = THREE.RepeatWrapping; nt.minFilter = THREE.LinearMipmapLinearFilter; nt.magFilter = THREE.LinearFilter; nt.generateMipmaps = true; nt.needsUpdate = true;
  out.noise = nt;
  out.time = performance.now() - t0;
  return out;
}
