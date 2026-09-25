// Compact binary codec for baked human meshes (shared by the node bake tool and the game).
// Per geometry: quantized positions (16-bit, delta + zigzag varint), skin bone ids and weights (bytes),
// region / sway / AO (bytes) and triangle indices (high-watermark varint on a cache-ordered mesh).
// Normals are rebuilt at load, welded across material seams so shading stays continuous.
// The whole bundle is deflated once, then base64'd into the page.

class Writer {
  constructor(n = 1 << 20) { this.b = new Uint8Array(n); this.n = 0; }
  need(k) { if (this.n + k > this.b.length) { let m = this.b.length * 2; while (m < this.n + k) m *= 2; const nb = new Uint8Array(m); nb.set(this.b.subarray(0, this.n)); this.b = nb; } }
  u8(v) { this.need(1); this.b[this.n++] = v; }
  bytes(a) { this.need(a.length); this.b.set(a, this.n); this.n += a.length; }
  u32(v) { this.need(4); new DataView(this.b.buffer).setUint32(this.n, v, true); this.n += 4; }
  f32(v) { this.need(4); new DataView(this.b.buffer).setFloat32(this.n, v, true); this.n += 4; }
  vu(v) { this.need(5); while (v >= 0x80) { this.b[this.n++] = (v & 0x7f) | 0x80; v >>>= 7; } this.b[this.n++] = v; }
  vs(v) { this.vu(v >= 0 ? v * 2 : -v * 2 - 1); }
  out() { return this.b.slice(0, this.n); }
}
class Reader {
  constructor(b, o = 0) { this.b = b; this.o = o; this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  u32() { const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.o, true); this.o += 4; return v; }
  vu() { let v = 0, s = 0, c; do { c = this.b[this.o++]; v += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return v; }
  vs() { const v = this.vu(); return v % 2 ? -(v + 1) / 2 : v / 2; }
  bytes(n) { const a = this.b.subarray(this.o, this.o + n); this.o += n; return a; }
}
/** Encode a built human geometry (attributes: position, normal, aSkin, aW, aRegion, aSway, aAO; index). */
export function encodeGeometry(g) {
  const w = new Writer();
  const P = g.attributes.position.array, SI = g.attributes.aSkin.array, SW = g.attributes.aW.array;
  const RG = g.attributes.aRegion.array, SY = g.attributes.aSway.array, AO = g.attributes.aAO.array, IX = g.index.array;
  const nv = P.length / 3, ni = IX.length;
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < nv; i++) for (let a = 0; a < 3; a++) { const v = P[i * 3 + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
  const rg = mx.map((v, a) => Math.max(1e-6, v - mn[a]));
  w.u32(nv); w.u32(ni); for (let a = 0; a < 3; a++) w.f32(mn[a]); for (let a = 0; a < 3; a++) w.f32(rg[a]);
  let p0 = 0, p1 = 0, p2 = 0;
  for (let i = 0; i < nv; i++) {
    const q0 = Math.round((P[i * 3] - mn[0]) / rg[0] * 65535), q1 = Math.round((P[i * 3 + 1] - mn[1]) / rg[1] * 65535), q2 = Math.round((P[i * 3 + 2] - mn[2]) / rg[2] * 65535);
    w.vs(q0 - p0); w.vs(q1 - p1); w.vs(q2 - p2); p0 = q0; p1 = q1; p2 = q2;
  }
  const sk = new Uint8Array(nv * 4), sw = new Uint8Array(nv * 4);
  for (let i = 0; i < nv; i++) {
    let sum = 0, big = 0, bi = 0;
    for (let j = 0; j < 4; j++) { sk[i * 4 + j] = SI[i * 4 + j]; const q = Math.round(SW[i * 4 + j] * 255); sw[i * 4 + j] = q; sum += q; if (q > big) { big = q; bi = j; } }
    sw[i * 4 + bi] += 255 - sum; // exact partition of unity
  }
  w.bytes(sk); w.bytes(sw);
  const rgn = new Uint8Array(nv), swy = new Uint8Array(nv), ao = new Uint8Array(nv);
  for (let i = 0; i < nv; i++) { rgn[i] = RG[i]; swy[i] = Math.round(Math.min(1, Math.max(0, SY[i])) * 255); ao[i] = Math.round(Math.min(1, Math.max(0, AO[i])) * 255); }
  w.bytes(rgn); w.bytes(swy); w.bytes(ao);
  let next = 0; for (let i = 0; i < ni; i++) { const v = IX[i]; if (v === next) { w.vu(0); next++; } else w.vs(next - v); }
  return w.out();
}

/** Decode one geometry from `bytes` at `offset`. Returns plain typed arrays for BufferGeometry attributes. */
export function decodeGeometry(bytes, offset = 0) {
  const r = new Reader(bytes, offset);
  const nv = r.u32(), ni = r.u32();
  const mn = [r.f32(), r.f32(), r.f32()], rg = [r.f32(), r.f32(), r.f32()];
  const position = new Float32Array(nv * 3), weld = new Int32Array(nv), first = new Map();
  let p0 = 0, p1 = 0, p2 = 0;
  for (let i = 0; i < nv; i++) {
    p0 += r.vs(); p1 += r.vs(); p2 += r.vs();
    position[i * 3] = mn[0] + p0 / 65535 * rg[0]; position[i * 3 + 1] = mn[1] + p1 / 65535 * rg[1]; position[i * 3 + 2] = mn[2] + p2 / 65535 * rg[2];
    const key = (p0 * 65536 + p1) * 65536 + p2; const f = first.get(key);
    if (f === undefined) { first.set(key, i); weld[i] = i; } else weld[i] = f;
  }
  const aSkin = new Uint8Array(r.bytes(nv * 4)), aW = new Uint8Array(r.bytes(nv * 4));
  const aRegion = new Uint8Array(r.bytes(nv)), aSway = new Uint8Array(r.bytes(nv)), aAO = new Uint8Array(r.bytes(nv));
  const index = nv < 65536 ? new Uint16Array(ni) : new Uint32Array(ni);
  let next = 0; for (let i = 0; i < ni; i++) { const d = r.vs(); if (d === 0) index[i] = next++; else index[i] = next - d; }
  // smooth normals: area-weighted face normals accumulated on welded positions
  const acc = new Float32Array(nv * 3);
  for (let t = 0; t < ni; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const ax = position[a * 3], ay = position[a * 3 + 1], az = position[a * 3 + 2];
    const e1x = position[b * 3] - ax, e1y = position[b * 3 + 1] - ay, e1z = position[b * 3 + 2] - az;
    const e2x = position[c * 3] - ax, e2y = position[c * 3 + 1] - ay, e2z = position[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [weld[a], weld[b], weld[c]]) { acc[v * 3] += nx; acc[v * 3 + 1] += ny; acc[v * 3 + 2] += nz; }
  }
  const normal = new Int16Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const wv = weld[i]; const x = acc[wv * 3], y = acc[wv * 3 + 1], z = acc[wv * 3 + 2]; const l = Math.hypot(x, y, z) || 1;
    normal[i * 3] = Math.round(x / l * 32767); normal[i * 3 + 1] = Math.round(y / l * 32767); normal[i * 3 + 2] = Math.round(z / l * 32767);
  }
  return { nv, ni, position, normal, aSkin, aW, aRegion, aSway, aAO, index, end: r.o };
}
