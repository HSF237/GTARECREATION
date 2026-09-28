// Road network: grid + winding hill roads, lanes, junction connections, signals, routing.
// Used by citygen.js. Conventions: x east, z south (north = -z), right-hand traffic.
// right(d) = (-d.z, d.x); lanes: index 0 next to the centerline/median.
import { clamp, lerp } from '../core/math.js';

export const LANE_W = 3.5;
export const ROAD_CLASSES = {
  street: { width: 12, lanes: 1, median: 0, side: 2.5, speed: 12.5, parking: true },
  avenue: { width: 16, lanes: 2, median: 0, side: 1.0, speed: 15.5 },
  boulevard: { width: 20, lanes: 2, median: 4, side: 1.0, speed: 16.5 },
  coastal: { width: 18, lanes: 2, median: 2, side: 1.5, speed: 17.5 },
  hill: { width: 9, lanes: 1, median: 0, side: 1.0, speed: 14 },
};

export const X_LINES = [
  [-900, 'coastal', 'Shoreline Drive'], [-780, 'street', 'Gull Street'], [-660, 'street', 'Coral Street'],
  [-540, 'avenue', 'Linden Avenue'], [-420, 'street', 'Fern Street'], [-300, 'street', 'Hollis Street'],
  [-180, 'avenue', 'Marlin Avenue'], [-60, 'boulevard', 'Sol Boulevard'], [60, 'street', 'Quay Street'],
  [180, 'avenue', 'Castell Avenue'], [300, 'street', 'Arbor Street'], [420, 'street', 'Vance Street'],
  [540, 'avenue', 'Foundry Avenue'], [660, 'street', 'Rivet Street'], [780, 'street', 'Anchor Street'],
  [900, 'street', 'Seawall Road'],
];
export const Z_LINES = [
  [-640, 'avenue', 'Crestline Avenue'], [-516, 'street', 'Maple Street'], [-392, 'street', 'Oak Street'],
  [-268, 'avenue', 'Palisade Avenue'], [-144, 'street', 'Tern Street'], [-20, 'boulevard', 'Harbor Boulevard'],
  [104, 'street', 'Bay Street'], [228, 'street', 'Market Street'], [352, 'avenue', 'Pelican Avenue'],
  [476, 'street', 'Lantern Street'], [600, 'avenue', 'Bayfront Road'],
];
// removed segments: [axis, linePos, from, to]
export const REMOVED = [
  ['x', -300, 104, 228], ['x', -300, 228, 352], ['z', 228, -420, -300], ['z', 228, -300, -180], // Castell Park
  ['x', 660, -516, -392], ['x', 660, -392, -268], ['z', -392, 540, 660], ['z', -392, 660, 780], // Ironworks superblock
  ['z', 476, 540, 660], ['z', 476, 660, 780], ['z', 476, 780, 900], // docks yards
];

export const HILL_A = [[-60, -640], [-60, -690], [-72, -742], [-140, -790], [-262, -812], [-345, -858], [-305, -915], [-185, -936], [-75, -962], [-42, -1012], [-98, -1052], [-130, -1080]];
export const HILL_B = [[-130, -1080], [-40, -1116], [80, -1140], [200, -1148], [300, -1120], [390, -1072], [480, -1032], [580, -992], [642, -930], [612, -860], [545, -805], [522, -744], [540, -692], [540, -640]];
export const LOOKOUT_END = [-216, -1086];

// ---------- polyline helpers ----------
export function cumulative(pts) {
  const c = new Float32Array(pts.length);
  for (let i = 1; i < pts.length; i++) c[i] = c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
  return c;
}
function cum2D(pts) {
  const c = new Float32Array(pts.length);
  for (let i = 1; i < pts.length; i++) c[i] = c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return c;
}
/** Sample position/tangent at arc length s along pts with cumulative lengths cum. */
export function samplePath(pts, cum, s, out) {
  const n = pts.length;
  if (s <= 0) { const a = pts[0], b = pts[1]; out.x = a.x; out.y = a.y; out.z = a.z; setDir(out, a, b); out.seg = 0; return out; }
  const L = cum[n - 1];
  if (s >= L) { const a = pts[n - 2], b = pts[n - 1]; out.x = b.x; out.y = b.y; out.z = b.z; setDir(out, a, b); out.seg = n - 2; return out; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const a = pts[lo], b = pts[lo + 1], seg = cum[lo + 1] - cum[lo] || 1e-6, t = (s - cum[lo]) / seg;
  out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.z = a.z + (b.z - a.z) * t;
  setDir(out, a, b); out.seg = lo;
  return out;
}
function setDir(out, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
  out.dx = dx / l; out.dz = dz / l; out.slope = dy / l;
}
function trim(pts, s0, s1, maxSeg = 1e9) {
  const cum = cum2D(pts), out = [], o = {};
  const add = (s) => { samplePath(pts, cum, s, o); out.push({ x: o.x, y: o.y, z: o.z }); };
  add(s0);
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 + 0.05 && cum[i] < s1 - 0.05) {
    const prev = out[out.length - 1];
    const d = Math.hypot(pts[i].x - prev.x, pts[i].z - prev.z);
    if (d > maxSeg) { const k = Math.ceil(d / maxSeg); for (let j = 1; j < k; j++) { const pc = prev; out.push({ x: pc.x + (pts[i].x - pc.x) * j / k, y: pc.y + (pts[i].y - pc.y) * j / k, z: pc.z + (pts[i].z - pc.z) * j / k }); } }
    out.push({ x: pts[i].x, y: pts[i].y, z: pts[i].z });
  }
  const last = out[out.length - 1];
  const e = {}; samplePath(pts, cum, s1, e);
  const d = Math.hypot(e.x - last.x, e.z - last.z);
  if (d > maxSeg) { const k = Math.ceil(d / maxSeg); for (let j = 1; j < k; j++) out.push({ x: last.x + (e.x - last.x) * j / k, y: last.y + (e.y - last.y) * j / k, z: last.z + (e.z - last.z) * j / k }); }
  out.push({ x: e.x, y: e.y, z: e.z });
  return out;
}
/** Offset polyline to the right of travel direction by `off` (negative = left). */
export function offsetPath(pts, off) {
  const n = pts.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    let k = 1;
    if (i > 0 && i < n - 1) { // miter length correction
      const p = pts[i - 1], c = pts[i], q = pts[i + 1];
      let ax = c.x - p.x, az = c.z - p.z, bx = q.x - c.x, bz = q.z - c.z;
      const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1; ax /= la; az /= la; bx /= lb; bz /= lb;
      const cosh = Math.max(0.5, (ax * dx + az * dz)); k = 1 / cosh;
    }
    out[i] = { x: pts[i].x - dz * off * k, y: pts[i].y, z: pts[i].z + dx * off * k };
  }
  return out;
}
function bezier(p0, p1, p2, p3, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y, z: a * p0.z + b * p1.z + c * p2.z + d * p3.z });
  }
  return out;
}
/** Centripetal-ish Catmull-Rom through 2D control points, sampled every `spacing` meters. */
export function catmull(ctrl, spacing = 3) {
  const P = ctrl.map(p => ({ x: p[0], z: p[1] }));
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z), n = Math.max(2, Math.ceil(len / spacing));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: 0, z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  const l = P[P.length - 1]; out.push({ x: l.x, y: 0, z: l.z });
  return out;
}

// ---------- graph ----------
function newNode(nodes, x, z, grid) { const n = { id: nodes.length, x, y: 0, z, kind: 'junction', grid, signal: null, edges: [] }; nodes.push(n); return n; }
function newEdge(edges, a, b, points, cls, name) {
  const C = ROAD_CLASSES[cls];
  const e = { id: edges.length, a: a.id, b: b.id, points, cls, kind: cls, name, width: C.width, lanesFwd: C.lanes, lanesBack: C.lanes,
    median: C.median, speed: C.speed, cutA: 0, cutB: 0, length: 0, parking: !!C.parking, lanes: [] };
  edges.push(e); a.edges.push(e.id); b.edges.push(e.id);
  return e;
}
export function dirFromNode(e, nodeId, out = { x: 0, z: 0 }) {
  const p = e.points, n = p.length;
  let a, b;
  if (e.a === nodeId) { a = p[0]; b = p[Math.min(1, n - 1)]; } else { a = p[n - 1]; b = p[n - 2]; }
  let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1;
  out.x = dx / l; out.z = dz / l; return out;
}
export function isRemoved(axis, line, from, to) {
  for (const r of REMOVED) if (r[0] === axis && r[1] === line && ((r[2] === from && r[3] === to) || (r[2] === to && r[3] === from))) return true;
  return false;
}

/** Build the grid graph. */
export function buildGrid() {
  const nodes = [], edges = [];
  const xs = X_LINES.map(l => l[0]), zs = Z_LINES.map(l => l[0]);
  const at = new Map(); // `${i},${j}` -> node
  const segX = (i, j) => !isRemoved('x', xs[i], zs[j], zs[j + 1]);  // x-line i between z j..j+1
  const segZ = (i, j) => !isRemoved('z', zs[j], xs[i], xs[i + 1]);  // z-line j between x i..i+1
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < zs.length; j++) {
    const has = (j > 0 && segX(i, j - 1)) || (j < zs.length - 1 && segX(i, j)) || (i > 0 && segZ(i - 1, j)) || (i < xs.length - 1 && segZ(i, j));
    if (has) at.set(i + ',' + j, newNode(nodes, xs[i], zs[j], true));
  }
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < zs.length - 1; j++) if (segX(i, j)) {
    const a = at.get(i + ',' + j), b = at.get(i + ',' + (j + 1));
    newEdge(edges, a, b, [{ x: a.x, y: 0, z: a.z }, { x: b.x, y: 0, z: b.z }], X_LINES[i][1], X_LINES[i][2]);
  }
  for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs.length - 1; i++) if (segZ(i, j)) {
    const a = at.get(i + ',' + j), b = at.get((i + 1) + ',' + j);
    newEdge(edges, a, b, [{ x: a.x, y: 0, z: a.z }, { x: b.x, y: 0, z: b.z }], Z_LINES[j][1], Z_LINES[j][2]);
  }
  return { nodes, edges, xs, zs, at, segX, segZ };
}

/** Grade-limited, smoothed elevation profile following terrain. Fixed start (and optional end) heights. */
function profile(pts, terrain, y0, y1, grade = 0.085) {
  const n = pts.length, cum = cum2D(pts), y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = Math.max(terrain.heightAt(pts[i].x, pts[i].z), 0.6);
  // pre-smooth natural terrain
  const sm = (arr, r) => { const o = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) { let s = 0, c = 0; for (let k = -r; k <= r; k++) { const j = i + k; if (j >= 0 && j < arr.length) { s += arr[j]; c++; } } o[i] = s / c; } return o; };
  let yy = sm(y, 8);
  const fixed = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (pts[i].z > -664) { yy[i] = 0; fixed[i] = 1; }
  yy[0] = y0; fixed[0] = 1; if (y1 != null) { yy[n - 1] = y1; fixed[n - 1] = 1; }
  const g2 = grade * 0.92;
  for (let i = 1; i < n; i++) { if (fixed[i]) continue; const ds = cum[i] - cum[i - 1]; yy[i] = clamp(yy[i], yy[i - 1] - g2 * ds, yy[i - 1] + g2 * ds); }
  for (let i = n - 2; i >= 0; i--) { if (fixed[i]) continue; const ds = cum[i + 1] - cum[i]; yy[i] = clamp(yy[i], yy[i + 1] - g2 * ds, yy[i + 1] + g2 * ds); }
  for (let pass = 0; pass < 3; pass++) { const f = sm(yy, 3); for (let i = 0; i < n; i++) if (fixed[i]) f[i] = yy[i]; yy = f; }
  for (let i = 1; i < n; i++) { if (fixed[i]) continue; const ds = cum[i] - cum[i - 1]; yy[i] = clamp(yy[i], yy[i - 1] - grade * ds, yy[i - 1] + grade * ds); }
  for (let i = n - 2; i >= 0; i--) { if (fixed[i]) continue; const ds = cum[i + 1] - cum[i]; yy[i] = clamp(yy[i], yy[i + 1] - grade * ds, yy[i + 1] + grade * ds); }
  for (let i = 0; i < n; i++) pts[i].y = yy[i];
  return pts;
}

/** Add hill roads to the graph and carve them (and pads) into the terrain. Returns hill info. */
export function buildHillRoads(g, terrain) {
  const nodeAt = (x, z) => g.nodes.find(n => Math.abs(n.x - x) < 1 && Math.abs(n.z - z) < 1);
  const n0 = nodeAt(-60, -640), n1 = nodeAt(540, -640);
  const pa = catmull(HILL_A, 3);
  // city part must stay at 0
  profile(pa, terrain, 0, null, 0.085);
  const L = { x: pa[pa.length - 1].x, y: pa[pa.length - 1].y, z: pa[pa.length - 1].z };
  const pb = catmull(HILL_B, 3);
  profile(pb, terrain, L.y, 0, 0.085);
  const pc = catmull([[L.x, L.z], [(L.x + LOOKOUT_END[0]) / 2, (L.z + LOOKOUT_END[1]) / 2 - 4], LOOKOUT_END], 3);
  for (const p of pc) p.y = L.y;
  // carve
  terrain.carvePath(pa, 4.5, 6, 24);
  terrain.carvePath(pb, 4.5, 6, 24);
  terrain.flattenRect(LOOKOUT_END[0] - 12, LOOKOUT_END[1], 30, 22, L.y, 18);
  terrain.carvePath(pc, 4.5, 6, 20);
  const nL = newNode(g.nodes, L.x, L.z, false); nL.y = L.y;
  const nE = newNode(g.nodes, LOOKOUT_END[0], LOOKOUT_END[1], false); nE.y = L.y; nE.kind = 'end';
  const eA = newEdge(g.edges, n0, nL, pa, 'hill', 'Crestline Road');
  const eB = newEdge(g.edges, nL, n1, pb, 'hill', 'Ridgeback Road');
  const eC = newEdge(g.edges, nL, nE, pc, 'hill', 'Lookout Loop');
  return { roadA: eA, roadB: eB, spur: eC, lookout: nE, junction: nL };
}

/** Merge degree-2 collinear nodes; re-index. */
export function mergeJoints(g) {
  let changed = true;
  const dead = new Set();
  while (changed) {
    changed = false;
    for (const n of g.nodes) {
      if (dead.has(n.id) || n.edges.length !== 2 || !n.grid) continue;
      const e1 = g.edges[n.edges[0]], e2 = g.edges[n.edges[1]];
      if (e1.cls !== e2.cls) continue;
      const d1 = dirFromNode(e1, n.id), d2 = dirFromNode(e2, n.id);
      if (d1.x * d2.x + d1.z * d2.z > -0.95) continue;
      // orient: e1 ends at n, e2 starts at n
      const p1 = e1.b === n.id ? e1.points : e1.points.slice().reverse();
      const aId = e1.b === n.id ? e1.a : e1.b;
      const p2 = e2.a === n.id ? e2.points : e2.points.slice().reverse();
      const bId = e2.a === n.id ? e2.b : e2.a;
      e1.points = p1.concat(p2.slice(1)); e1.a = aId; e1.b = bId;
      e2.dead = true;
      const nb = g.nodes[bId]; nb.edges = nb.edges.map(id => id === e2.id ? e1.id : id);
      n.edges = []; dead.add(n.id);
      changed = true;
    }
  }
  // re-index
  const nodes = g.nodes.filter(n => !dead.has(n.id)), edges = g.edges.filter(e => !e.dead);
  const nMap = new Map(), eMap = new Map();
  nodes.forEach((n, i) => nMap.set(n.id, i)); edges.forEach((e, i) => eMap.set(e.id, i));
  for (const n of nodes) { n.id = nMap.get(n.id); n.edges = n.edges.map(id => eMap.get(id)); }
  for (const e of edges) { e.id = eMap.get(e.id); e.a = nMap.get(e.a); e.b = nMap.get(e.b); }
  g.nodes = nodes; g.edges = edges;
  for (const n of nodes) if (n.edges.length === 1) n.kind = 'end';
}

/** Distances from node centers to stop lines. */
export function computeCuts(g) {
  const d1 = { x: 0, z: 0 }, d2 = { x: 0, z: 0 };
  for (const n of g.nodes) {
    for (const eid of n.edges) {
      const e = g.edges[eid];
      dirFromNode(e, n.id, d1);
      let cross = 0;
      for (const fid of n.edges) {
        if (fid === eid) continue;
        const f = g.edges[fid]; dirFromNode(f, n.id, d2);
        if (Math.abs(d1.x * d2.x + d1.z * d2.z) < 0.7) cross = Math.max(cross, f.width / 2);
      }
      let cut;
      if (n.kind === 'end') cut = 7;
      else if (!n.grid) cut = 9;
      else cut = cross > 0 ? cross + 5.5 : 0;
      n.crossHalf = n.crossHalf || {};
      n.crossHalf[eid] = cross;
      if (e.a === n.id) e.cutA = cut; else e.cutB = cut;
    }
  }
  for (const e of g.edges) e.length = cum2D(e.points)[e.points.length - 1];
}

/** Lanes: offset trimmed centerlines. terrainY(x,z) gives ground height for hill lanes. */
export function buildLanes(g, terrain) {
  const lanes = [];
  for (const e of g.edges) {
    const L = e.length;
    const tp = trim(e.points, e.cutA, L - e.cutB, e.cls === 'hill' ? 4 : 40);
    const mk = (fwd, i) => {
      const off = e.median / 2 + (i + 0.5) * LANE_W;
      let pts = offsetPath(tp, off * (fwd ? 1 : -1));
      if (!fwd) pts.reverse();
      for (const p of pts) p.y = e.cls === 'hill' ? terrain.heightAt(p.x, p.z) : 0;
      const cum = cumulative(pts);
      const lane = { id: lanes.length, edge: e.id, forward: fwd, index: i, points: pts, cum, length: cum[cum.length - 1],
        startNode: fwd ? e.a : e.b, endNode: fwd ? e.b : e.a, exits: [], entries: [], speed: e.speed, parkedOn: false };
      lanes.push(lane); e.lanes.push(lane.id);
      return lane;
    };
    for (let i = 0; i < e.lanesFwd; i++) mk(true, i);
    for (let i = 0; i < e.lanesBack; i++) mk(false, i);
  }
  g.lanes = lanes;
  return lanes;
}

export function buildConnections(g, terrain) {
  const conns = [];
  const lanesAtNode = (nid, incoming) => g.lanes.filter(l => (incoming ? l.endNode : l.startNode) === nid);
  for (const n of g.nodes) {
    const inc = lanesAtNode(n.id, true), out = lanesAtNode(n.id, false);
    for (const li of inc) {
      const pa = li.points, a = pa[pa.length - 1], ap = pa[pa.length - 2];
      let dix = a.x - ap.x, diz = a.z - ap.z; const l1 = Math.hypot(dix, diz) || 1; dix /= l1; diz /= l1;
      const eIn = g.edges[li.edge];
      const nIn = li.forward ? eIn.lanesFwd : eIn.lanesBack;
      for (const lo of out) {
        const uturn = lo.edge === li.edge;
        if (uturn && n.kind !== 'end') continue;
        const pb = lo.points, b = pb[0], bn = pb[1];
        let dox = bn.x - b.x, doz = bn.z - b.z; const l2 = Math.hypot(dox, doz) || 1; dox /= l2; doz /= l2;
        const eOut = g.edges[lo.edge];
        const nOut = lo.forward ? eOut.lanesFwd : eOut.lanesBack;
        let turn;
        if (uturn) turn = 'uturn';
        else {
          const dot = dix * dox + diz * doz, cr = dix * doz - diz * dox;
          turn = dot > 0.7 ? 'straight' : (cr > 0 ? 'right' : 'left');
        }
        let ok = false;
        if (turn === 'straight') ok = lo.index === Math.min(li.index, nOut - 1);
        else if (turn === 'right') ok = li.index === nIn - 1 && lo.index === nOut - 1;
        else if (turn === 'left') ok = li.index === 0 && lo.index === 0;
        else ok = li.index === lo.index;
        // non-grid nodes (hill junction): allow all turns from single lanes
        if (!n.grid && !uturn && nIn === 1 && nOut === 1) ok = true;
        // corners (2 perpendicular edges): every lane turns, index-preserving
        if (n.edges.length === 2 && !uturn && turn !== 'straight') ok = lo.index === Math.min(li.index, nOut - 1) || li.index === Math.min(lo.index, nIn - 1);
        if (!ok) continue;
        const dist = Math.hypot(b.x - a.x, b.z - a.z);
        let k = turn === 'straight' ? dist / 3 : turn === 'uturn' ? 14 : dist * 0.42;
        const p1 = { x: a.x + dix * k, y: a.y, z: a.z + diz * k };
        const p2 = turn === 'uturn' ? { x: b.x + dix * k, y: b.y, z: b.z + diz * k } : { x: b.x - dox * k, y: b.y, z: b.z - doz * k };
        const nseg = Math.max(2, Math.ceil((dist + (turn === 'uturn' ? 30 : 0)) / 1.5));
        const pts = bezier(a, p1, p2, b, nseg);
        for (const p of pts) p.y = n.grid ? 0 : terrain.heightAt(p.x, p.z);
        const cum = cumulative(pts);
        const c = { id: conns.length, node: n.id, from: li.id, to: lo.id, turn, points: pts, cum, length: cum[cum.length - 1], group: -1, inEdge: li.edge };
        conns.push(c); li.exits.push(c.id); lo.entries.push(c.id);
      }
    }
  }
  g.connections = conns;
  return conns;
}

export function buildSignals(g, rng) {
  const d = { x: 0, z: 0 };
  for (const n of g.nodes) {
    if (!n.grid || n.edges.length < 3) continue;
    const groupOf = {};
    const groups = [{ edges: [] }, { edges: [] }];
    for (const eid of n.edges) {
      dirFromNode(g.edges[eid], n.id, d);
      const gi = Math.abs(d.z) > Math.abs(d.x) ? 0 : 1;
      groupOf[eid] = gi; groups[gi].edges.push(eid);
    }
    const green = 12 + Math.floor(rng.next() * 5), yellow = 3, allRed = 1.5;
    n.signal = { green, yellow, allRed, cycle: 2 * (green + yellow + allRed), offset: rng.next() * 60, groups, groupOf };
  }
  for (const c of g.connections) {
    const n = g.nodes[c.node];
    if (n.signal) c.group = n.signal.groupOf[c.inEdge];
  }
}

/** 'green' | 'yellow' | 'red' for traffic entering node from edgeId. */
export function signalState(node, edgeId, time) {
  const s = node.signal;
  if (!s) return 'green';
  const gi = s.groupOf[edgeId];
  if (gi === undefined) return 'green';
  let t = (time + s.offset) % s.cycle; if (t < 0) t += s.cycle;
  const half = s.green + s.yellow + s.allRed;
  if (gi === 1) t = (t + half) % s.cycle;
  if (t < s.green) return 'green';
  if (t < s.green + s.yellow) return 'yellow';
  return 'red';
}
/** Seconds until this approach turns green (0 if green). */
export function signalWait(node, edgeId, time) {
  const s = node.signal; if (!s) return 0;
  const gi = s.groupOf[edgeId]; if (gi === undefined) return 0;
  let t = (time + s.offset) % s.cycle; if (t < 0) t += s.cycle;
  const half = s.green + s.yellow + s.allRed;
  if (gi === 1) t = (t + half) % s.cycle;
  return t < s.green ? 0 : s.cycle - t;
}
/** Pedestrians may cross edge `crossedEdgeId`'s road at node while that approach has red (with margins). */
export function pedCanCross(node, crossedEdgeId, time) {
  const s = node && node.signal;
  if (!s) return true;
  const gi = s.groupOf[crossedEdgeId]; if (gi === undefined) return true;
  let t = (time + s.offset) % s.cycle; if (t < 0) t += s.cycle;
  const half = s.green + s.yellow + s.allRed;
  if (gi === 1) t = (t + half) % s.cycle;
  // crossed road red during [green+yellow, cycle); allow in the other group's green window with margins
  return t > half + 0.5 && t < half + s.green - 2;
}

// ---------- spatial queries & routing ----------
export class LaneIndex {
  constructor(lanes, conns, cell = 32) {
    this.cell = cell; this.map = new Map(); this.lanes = lanes; this.conns = conns;
    const key = (x, z) => Math.floor(x / cell) * 100003 + Math.floor(z / cell);
    this.key = key;
    for (const l of lanes) {
      const p = l.points;
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.max(1, Math.ceil(len / (cell * 0.5)));
        const seen = new Set();
        for (let s = 0; s <= steps; s++) {
          const x = a.x + (b.x - a.x) * s / steps, z = a.z + (b.z - a.z) * s / steps;
          for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
            const k = key(x + ox * cell * 0.5, z + oz * cell * 0.5);
            if (seen.has(k)) continue; seen.add(k);
            let arr = this.map.get(k); if (!arr) this.map.set(k, arr = []);
            arr.push(l.id, i);
          }
        }
      }
    }
  }
  /** Nearest lane point. filter(lane) optional. Returns {lane, seg, t, s, dist, x, y, z, dx, dz} or null. */
  nearest(x, z, filter = null, maxDist = 64) {
    let best = null, bd = maxDist * maxDist;
    const cell = this.cell;
    const r = Math.ceil(maxDist / cell);
    for (let ox = -r; ox <= r; ox++) for (let oz = -r; oz <= r; oz++) {
      const arr = this.map.get(this.key(x + ox * cell, z + oz * cell)); if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) {
        const l = this.lanes[arr[k]], i = arr[k + 1];
        if (filter && !filter(l)) continue;
        const a = l.points[i], b = l.points[i + 1];
        const abx = b.x - a.x, abz = b.z - a.z, len2 = abx * abx + abz * abz || 1e-9;
        let t = ((x - a.x) * abx + (z - a.z) * abz) / len2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = a.x + abx * t, pz = a.z + abz * t, d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < bd) {
          bd = d; const len = Math.sqrt(len2);
          best = { lane: l, seg: i, t, s: l.cum[i] + (l.cum[i + 1] - l.cum[i]) * t, dist: 0, x: px, y: a.y + (b.y - a.y) * t, z: pz, dx: abx / len, dz: abz / len };
        }
      }
      if (best && ox === r && oz === r) break;
    }
    if (best) best.dist = Math.sqrt(bd);
    return best;
  }
}

class Heap {
  constructor() { this.a = []; }
  push(v, p) { const a = this.a; a.push([p, v]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top[1]; }
  get size() { return this.a.length; }
}

/**
 * A* over lanes with lane changes. from/to: {x,z}. opts.startLane/startS to start on a given lane.
 * Returns { points:[[x,z]], lanes:[ids], steps:[{lane, conn|-1}], length } or null.
 */
export function routeLanes(g, index, from, to, opts = {}) {
  const s0 = opts.startLane != null ? { lane: g.lanes[opts.startLane], s: opts.startS || 0 } : index.nearest(from.x, from.z, null, 150);
  const s1 = index.nearest(to.x, to.z, null, 400);
  if (!s0 || !s1) return null;
  const lanes = g.lanes, conns = g.connections, edges = g.edges;
  const target = s1.lane.id, vmax = 18;
  const H = (l) => { const p = l.points[l.points.length - 1]; return Math.hypot(p.x - s1.x, p.z - s1.z) / vmax; };
  const siblings = (l) => { const e = edges[l.edge], out = []; for (const lid of e.lanes) { const o = lanes[lid]; if (o.forward === l.forward && Math.abs(o.index - l.index) === 1) out.push(lid); } return out; };
  const gScore = new Map(), came = new Map(), heap = new Heap();
  const starts = [s0.lane.id];
  if (opts.startLane == null && opts.bothWays !== false) {
    const e = edges[s0.lane.edge];
    for (const lid of e.lanes) if (lanes[lid].forward !== s0.lane.forward && lanes[lid].index === 0) { starts.push(lid); break; }
  }
  for (const id of starts) {
    const l = lanes[id], rev = id !== s0.lane.id;
    const sOn = rev ? Math.max(0, l.length - s0.s) : s0.s;
    if (id === target && s1.s >= sOn) return finish([id], [], sOn, s1.s);
    const c = (l.length - sOn) / l.speed + (rev ? 8 : 0);
    gScore.set(id, c); heap.push(id, c + H(l)); came.set(id, { from: -1, conn: -1, sOn });
  }
  let found = -1, guard = 0;
  while (heap.size && guard++ < 40000) {
    const id = heap.pop();
    if (id === target) { found = id; break; }
    const gc = gScore.get(id), l = lanes[id];
    for (const cid of l.exits) {
      const c = conns[cid], nid = c.to, nl = lanes[nid];
      const ng = gc + c.length / 9 + (nid === target ? s1.s : nl.length) / nl.speed + (c.turn === 'uturn' ? 30 : c.turn === 'straight' ? 0 : 2);
      if (ng < (gScore.get(nid) ?? Infinity)) { gScore.set(nid, ng); came.set(nid, { from: id, conn: cid }); heap.push(nid, ng + (nid === target ? 0 : H(nl))); }
    }
    for (const nid of siblings(l)) {
      const ng = gc + 3;
      if (ng < (gScore.get(nid) ?? Infinity)) { gScore.set(nid, ng); came.set(nid, { from: id, conn: -2 }); heap.push(nid, ng + (nid === target ? 0 : H(lanes[nid]))); }
    }
  }
  if (found < 0) return null;
  const seqL = [], seqT = [];
  let cur = found;
  while (cur !== -1) { seqL.push(cur); const c = came.get(cur); seqT.push(c.conn); cur = c.from; }
  seqL.reverse(); seqT.reverse(); // seqT[k] = transition INTO seqL[k] (-1 for start)
  return finish(seqL, seqT.slice(1), came.get(seqL[0]).sOn, s1.s);

  function finish(seqL, trans, sStart, sEnd) {
    const pts = []; let length = 0;
    const push = (p) => { const q = pts[pts.length - 1]; if (q) length += Math.hypot(p.x - q[0], p.z - q[1]); if (!q || Math.abs(q[0] - p.x) + Math.abs(q[1] - p.z) > 0.3) pts.push([p.x, p.z]); };
    const o = {};
    let a = sStart;
    const steps = [];
    for (let k = 0; k < seqL.length; k++) {
      const l = lanes[seqL[k]];
      const next = k < trans.length ? trans[k] : null; // transition out of this lane
      let b = k === seqL.length - 1 ? sEnd : l.length;
      if (next === -2) b = Math.min(l.length, Math.max(a, (a + l.length) / 2));
      steps.push({ lane: l.id, from: a, to: b, conn: next != null && next >= 0 ? next : -1, laneChange: next === -2 });
      samplePath(l.points, l.cum, a, o); push(o);
      for (let i = 1; i < l.points.length - 1; i++) if (l.cum[i] > a && l.cum[i] < b) push(l.points[i]);
      samplePath(l.points, l.cum, b, o); push(o);
      if (next != null && next >= 0) { const c = conns[next]; for (let i = 1; i < c.points.length - 1; i++) push(c.points[i]); a = 0; }
      else if (next === -2) a = b;
    }
    return { points: pts, lanes: seqL, steps, length, startS: sStart, endS: sEnd };
  }
}
