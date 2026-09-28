// City generator for Sol Harbor. generateCity({seed}) -> CityData (see ARCHITECTURE.md §4).
// Layout: road grid + hill roads (roads.js), district blocks with parcels/buildings, props, POIs,
// static colliders (collision.js) and map data for the UI.
import { makeRng, hash2 } from '../core/rng.js';
import { clamp, lerp } from '../core/math.js';
import { buildIsland, computeSurfaces, SURFACE, WATER_LEVEL } from './terrain.js';
import { CollisionWorld } from './collision.js';
import {
  ROAD_CLASSES, X_LINES, Z_LINES, LANE_W, buildGrid, buildHillRoads, mergeJoints, computeCuts, buildLanes,
  buildConnections, buildSignals, signalState, signalWait, pedCanCross, LaneIndex, routeLanes, dirFromNode, samplePath, cumulative,
} from './roads.js';
export { signalState, signalWait, pedCanCross, ROAD_CLASSES };

export const DISTRICT_NAMES = {
  downtown: 'Downtown', oldquarter: 'Old Quarter', palmshore: 'Palm Shore', linden: 'Linden Grove', crestline: 'Crestline Hills',
  ironworks: 'Ironworks', saltgate: 'Saltgate Docks', midtown: 'Midtown', beach: 'Palm Shore Beach', sea: 'Open Water',
};
/** Facade styles: texture layer + tile size (m) + floor height. Shared with textures.js / buildings.js. */
export const FACADES = {
  GLASS_BLUE: { layer: 0, tileW: 6, tileH: 8, floorH: 4 },
  GLASS_DARK: { layer: 1, tileW: 6, tileH: 8, floorH: 4 },
  GLASS_SILVER: { layer: 2, tileW: 6, tileH: 8, floorH: 4 },
  OFFICE_CONCRETE: { layer: 3, tileW: 6, tileH: 7.2, floorH: 3.6 },
  BRICK_RED: { layer: 4, tileW: 5, tileH: 7, floorH: 3.5 },
  BRICK_DARK: { layer: 5, tileW: 5, tileH: 7, floorH: 3.5 },
  STUCCO: { layer: 6, tileW: 6, tileH: 6.4, floorH: 3.2 },
  MODERN_WHITE: { layer: 7, tileW: 8, tileH: 7.2, floorH: 3.6 },
  STOREFRONT: { layer: 8, tileW: 8, tileH: 4.5, floorH: 4.5 },
  WAREHOUSE: { layer: 9, tileW: 8, tileH: 12, floorH: 12 },
  HOUSE_SIDING: { layer: 10, tileW: 6, tileH: 3, floorH: 3 },
  HOUSE_STUCCO: { layer: 11, tileW: 6, tileH: 3, floorH: 3 },
  PARKING: { layer: 12, tileW: 6, tileH: 3.2, floorH: 3.2 },
  ROOF: { layer: 13, tileW: 8, tileH: 8, floorH: 8 },
  CONCRETE: { layer: 14, tileW: 4, tileH: 4, floorH: 4 },
  METAL: { layer: 15, tileW: 4, tileH: 4, floorH: 4 },
  ROOFTILE: { layer: 16, tileW: 2.4, tileH: 2.4, floorH: 2.4 },
  SHINGLE: { layer: 17, tileW: 2.4, tileH: 2.4, floorH: 2.4 },
  CONTAINER: { layer: 18, tileW: 6, tileH: 2.6, floorH: 2.6 },
};
/** Ground surface ids for block tops / lots (texture array layers in textures.js). */
export const GROUND = { SIDEWALK: 0, CONCRETE: 1, PAVERS: 2, GRASS: 3, PARKING: 4, DIRT: 5, SAND: 6, GRAVEL: 7, WOOD: 8, ASPHALT: 9 };

const TOP = 0.15; // sidewalk/block top height
const SW = 5;     // sidewalk width

export function districtOf(x, z) {
  if (z < -660) return 'crestline';
  if (x < -915) return 'beach';
  if (x >= 400 && z >= 352) return 'saltgate';
  if (x >= 480) return 'ironworks';
  if (x < -780) return 'palmshore';
  if (x < -600 && z > -144) return 'palmshore';
  if (x < -240 && z < -144) return 'linden';
  if (x >= -120 && x < 480 && z >= -144 && z < 352) return 'downtown';
  if ((x >= -600 && x < -120 && z >= -144) || (x >= -120 && x < 60 && z >= 352)) return 'oldquarter';
  return 'midtown';
}

// ------------------------------------------------------------------------------------------
export function generateCity({ seed = 1337 } = {}) {
  const t0 = performance.now();
  const rng = makeRng(seed);
  const terrain = buildIsland(seed);
  const g = buildGrid();
  const hill = buildHillRoads(g, terrain);
  mergeJoints(g);
  computeCuts(g);
  buildLanes(g, terrain);
  buildConnections(g, terrain);
  buildSignals(g, rng);
  const laneIndex = new LaneIndex(g.lanes, g.connections);

  const city = {
    seed, terrain, roads: { nodes: g.nodes, edges: g.edges }, lanes: g.lanes, connections: g.connections,
    blocks: [], buildings: [], props: [], parking: [], ramps: [], overlays: [], pools: [], wires: [],
    sidewalks: { nodes: [], links: [], adj: [] }, areas: { beaches: [], parks: [], plazas: [], lots: [], port: [], quays: [], pier: null, hillPads: [] },
    districts: [], poi: {}, hill, grid: { xs: g.xs, zs: g.zs },
  };
  const C = { rng, city, g, terrain, hill, bid: 0 };

  buildBlocks(C);
  for (const b of city.blocks) layoutBlock(C, b);
  buildSpecialAreas(C);
  buildHillContent(C);
  buildStreetProps(C);
  buildParking(C);
  buildSidewalkGraph(C);
  buildRamps(C);
  buildPOIs(C);
  // terrain surfaces (hill roads asphalt)
  const hillPts = [hill.roadA.points, hill.roadB.points, hill.spur.points];
  computeSurfaces(terrain, seed, (x, z) => {
    for (const pts of hillPts) for (let i = 0; i < pts.length; i += 2) { const p = pts[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 < 36) return true; }
    return false;
  });
  const collision = new CollisionWorld(terrain);
  city.collision = collision;
  populateCollision(C);
  buildCollectibles(C);
  city.mapData = buildMapData(C);
  // helpers
  city.laneIndex = laneIndex;
  city.signalState = (node, edgeId, time) => signalState(typeof node === 'number' ? g.nodes[node] : node, edgeId, time);
  city.nearestLane = (x, z, filter, maxDist) => laneIndex.nearest(x, z, filter, maxDist);
  city.route = (from, to, opts) => routeLanes(g, laneIndex, { x: from[0] ?? from.x, z: from[1] ?? from.z }, { x: to[0] ?? to.x, z: to[1] ?? to.z }, opts);
  city.districtAt = (x, z) => { const id = x < -1030 || x > 1020 || z > 800 || z < -1400 ? 'sea' : districtOf(x, z); return { id, name: DISTRICT_NAMES[id] }; };
  city.roadAt = (x, z) => { const n = laneIndex.nearest(x, z, null, 14); if (!n) return null; const e = g.edges[n.lane.edge]; return n.dist < e.width / 2 + 2 ? e : null; };
  city.nearestSidewalkNode = (x, z) => nearestSW(city.sidewalks, x, z);
  city.genTime = performance.now() - t0;
  return city;
}

// ------------------------------------------------------------------------------------------ blocks
function rectPoly(r) { return [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]]; }
function inset(r, d) { return { x0: r.x0 + d, x1: r.x1 - d, z0: r.z0 + d, z1: r.z1 - d }; }
function newBlock(C, r, kind, extra = {}) {
  const b = { id: C.city.blocks.length, x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2,
    kind, top: kind === 'apron' ? 0 : TOP, sidewalk: SW, lots: [], district: districtOf((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2), special: null, ...extra };
  b.poly = rectPoly(b);
  C.city.blocks.push(b);
  return b;
}
const W_X = (i) => ROAD_CLASSES[X_LINES[i][1]].width, W_Z = (j) => ROAD_CLASSES[Z_LINES[j][1]].width;

function buildBlocks(C) {
  const { g } = C, xs = g.xs, zs = g.zs, nI = xs.length - 1, nJ = zs.length - 1;
  const parent = new Int32Array(nI * nJ).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const cell = (i, j) => j * nI + i;
  for (let i = 1; i < nI; i++) for (let j = 0; j < nJ; j++) if (!g.segX(i, j)) uni(cell(i - 1, j), cell(i, j));
  for (let j = 1; j < nJ; j++) for (let i = 0; i < nI; i++) if (!g.segZ(i, j)) uni(cell(i, j - 1), cell(i, j));
  const groups = new Map();
  for (let j = 0; j < nJ; j++) for (let i = 0; i < nI; i++) {
    const r = find(cell(i, j)); let gr = groups.get(r);
    if (!gr) groups.set(r, gr = { i0: i, i1: i, j0: j, j1: j });
    gr.i0 = Math.min(gr.i0, i); gr.i1 = Math.max(gr.i1, i); gr.j0 = Math.min(gr.j0, j); gr.j1 = Math.max(gr.j1, j);
  }
  for (const gr of groups.values()) {
    const r = { x0: xs[gr.i0] + W_X(gr.i0) / 2, x1: xs[gr.i1 + 1] - W_X(gr.i1 + 1) / 2, z0: zs[gr.j0] + W_Z(gr.j0) / 2, z1: zs[gr.j1 + 1] - W_Z(gr.j1 + 1) / 2 };
    newBlock(C, r, 'city', { cells: gr });
  }
  // boundary strips
  const north = zs[0] - W_Z(0) / 2, south = zs[nJ] + W_Z(nJ) / 2, west = xs[0] - W_X(0) / 2, east = xs[nI] + W_X(nI) / 2;
  newBlock(C, { x0: -915, x1: west, z0: -658, z1: 631 }, 'strip', { name: 'Shoreline Promenade', promenade: true });
  // north strip with gaps for hill roads (x = -60 and 540)
  newBlock(C, { x0: west, x1: -64.5, z0: -658, z1: north }, 'strip');
  newBlock(C, { x0: -55.5, x1: 535.5, z0: -658, z1: north }, 'strip');
  newBlock(C, { x0: 544.5, x1: 934, z0: -658, z1: north }, 'strip');
  newBlock(C, { x0: east, x1: 934, z0: north, z1: zs[nJ] - W_Z(nJ) / 2 }, 'strip', { name: 'Seawall Walk' });
  newBlock(C, { x0: west, x1: 400, z0: south, z1: 631 }, 'strip', { name: 'Bayfront Promenade', promenade: true });
  const apron = newBlock(C, { x0: 400, x1: 934, z0: south, z1: 792 }, 'apron', { district: 'saltgate' });
  C.city.areas.port.push(rectPoly(apron));
  // specials by location
  const at = (x, z) => C.city.blocks.find(b => b.kind === 'city' && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
  const mark = (x, z, special, kind) => { const b = at(x, z); if (b) { b.special = special; if (kind) b.kind = kind; } return b; };
  mark(-300, 228, 'castellPark', 'park');
  mark(120, 42, 'solstice');
  mark(-480, 414, 'lanternSquare', 'plaza');
  mark(240, -330, 'police1'); mark(-720, 290, 'police2');
  mark(-120, -330, 'hospital1'); mark(480, 166, 'hospital2');
  mark(-360, 414, 'gunshop1'); mark(720, -82, 'gunshop2');
  mark(-480, -82, 'respray1'); mark(600, 42, 'respray2');
  mark(-840, -82, 'safehouse');
  mark(660, -392, 'salvage');
  mark(-120, 414, 'club');
  mark(240, 166, 'plaza2', 'plaza');
}

// ------------------------------------------------------------------------------------------ parcels
function splitRange(a, b, wMin, wMax, rng) {
  const out = []; let s = a;
  while (b - s > wMax) { const w = rng.range(wMin, wMax); out.push([s, s + w]); s += w; }
  if (b - s < wMin && out.length) out[out.length - 1][1] = b; else out.push([s, b]);
  return out;
}
/** Perimeter parcels facing the 4 streets + a courtyard. */
function perimeterParcels(r, depth, wMin, wMax, rng) {
  const W = r.x1 - r.x0, D = r.z1 - r.z0, parcels = [];
  if (W < 2 * depth + 10 || D < 2 * depth + 10) {
    if (W >= D) for (const [a, b] of splitRange(r.x0, r.x1, wMin, wMax, rng)) parcels.push({ x0: a, x1: b, z0: r.z0, z1: r.z1, face: 'n' });
    else for (const [a, b] of splitRange(r.z0, r.z1, wMin, wMax, rng)) parcels.push({ x0: r.x0, x1: r.x1, z0: a, z1: b, face: 'w' });
    return { parcels, court: null };
  }
  for (const [a, b] of splitRange(r.x0, r.x1, wMin, wMax, rng)) parcels.push({ x0: a, x1: b, z0: r.z0, z1: r.z0 + depth, face: 'n' });
  for (const [a, b] of splitRange(r.x0, r.x1, wMin, wMax, rng)) parcels.push({ x0: a, x1: b, z0: r.z1 - depth, z1: r.z1, face: 's' });
  for (const [a, b] of splitRange(r.z0 + depth, r.z1 - depth, wMin, wMax, rng)) {
    parcels.push({ x0: r.x0, x1: r.x0 + depth, z0: a, z1: b, face: 'w' });
    parcels.push({ x0: r.x1 - depth, x1: r.x1, z0: a, z1: b, face: 'e' });
  }
  return { parcels, court: { x0: r.x0 + depth, x1: r.x1 - depth, z0: r.z0 + depth, z1: r.z1 - depth } };
}
function bsp(r, n, minSize, rng) {
  let list = [r];
  for (let k = 1; k < n; k++) {
    list.sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0));
    const p = list[0], W = p.x1 - p.x0, D = p.z1 - p.z0;
    if (Math.max(W, D) < minSize * 2) break;
    const f = rng.range(0.38, 0.62);
    list.shift();
    if (W >= D) { const x = p.x0 + W * f; list.push({ ...p, x1: x }, { ...p, x0: x }); }
    else { const z = p.z0 + D * f; list.push({ ...p, z1: z }, { ...p, z0: z }); }
  }
  return list;
}
function faceOf(p, block) {
  // nearest block edge
  const d = [['n', p.z0 - block.z0], ['s', block.z1 - p.z1], ['w', p.x0 - block.x0], ['e', block.x1 - p.x1]];
  d.sort((a, b) => a[1] - b[1]);
  return d[0][0];
}

const PASTELS = [[1, 0.8, 0.64], [0.7, 0.92, 0.8], [0.7, 0.84, 1], [1, 0.9, 0.58], [1, 0.72, 0.66], [0.86, 0.76, 1], [1, 1, 0.96], [0.98, 0.86, 0.74], [0.68, 0.94, 0.92], [1, 0.62, 0.52]];
const WAREHOUSE_TINTS = [[0.62, 0.68, 0.74], [0.72, 0.36, 0.28], [0.9, 0.86, 0.74], [0.42, 0.55, 0.45], [0.8, 0.8, 0.8], [0.35, 0.42, 0.55]];
const HOUSE_TINTS = [[1, 1, 1], [0.84, 0.9, 1], [0.84, 0.95, 0.86], [1, 0.95, 0.78], [0.86, 0.86, 0.86], [1, 0.9, 0.8], [0.95, 0.85, 0.75]];
const ROOF_TINTS = [[0.62, 0.3, 0.22], [0.35, 0.33, 0.33], [0.45, 0.3, 0.25], [0.3, 0.36, 0.42], [0.55, 0.45, 0.35]];
const jitter = (rng, c, a = 0.06) => c.map(v => clamp(v * (1 + rng.range(-a, a)), 0, 1.2));

function addBuilding(C, b, spec) {
  const { rng } = C;
  const bl = {
    id: C.city.buildings.length, kind: spec.kind || 'lowrise', district: b.district, style: spec.style, block: b.id,
    x: (spec.x0 + spec.x1) / 2, z: (spec.z0 + spec.z1) / 2, w: spec.x1 - spec.x0, d: spec.z1 - spec.z0, rot: 0,
    y: b.top, h: 0, parts: [], tint: spec.tint || [1, 1, 1], seed: rng.int(1, 1e6), storefront: !!spec.storefront,
    roofTint: spec.roofTint || [0.5, 0.5, 0.5], face: spec.face || 'n', lit: spec.lit ?? 0.55, sign: spec.sign || null, name: spec.name || null,
  };
  for (const p of spec.parts) {
    const part = { x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1, y0: p.y0 ?? b.top, y1: p.y1, style: p.style || spec.style, roof: p.roof || 'flat',
      roofH: p.roofH || 0, ridge: p.ridge || ((p.x1 - p.x0) >= (p.z1 - p.z0) ? 'x' : 'z'), storefront: p.storefront ?? (spec.storefront && (p.y0 ?? b.top) <= b.top + 0.01),
      crown: p.crown || null, open: p.open || null };
    bl.parts.push(part);
    bl.h = Math.max(bl.h, part.y1 + part.roofH - b.top);
  }
  C.city.buildings.push(bl);
  return bl;
}
/** Wall height for a style given floors, with storefront ground floor. */
function heightFor(style, floors, storefront) {
  const F = FACADES[style];
  return storefront ? FACADES.STOREFRONT.floorH + Math.max(0, floors - 1) * F.floorH : floors * F.floorH;
}
function addProp(C, kind, x, z, o = {}) {
  const p = { kind, x, y: o.y ?? C.city.terrain.heightAt(x, z), z, rot: o.rot || 0, scale: o.scale || 1, variant: o.variant || 0,
    breakable: !!o.breakable, collider: -1, h: o.h, len: o.len, node: o.node, edge: o.edge, extra: o.extra };
  if (o.y == null && o.top != null) p.y = o.top;
  C.city.props.push(p);
  return p;
}
function doorPoint(bl, face, off = 1.6) {
  const x0 = bl.x - bl.w / 2, x1 = bl.x + bl.w / 2, z0 = bl.z - bl.d / 2, z1 = bl.z + bl.d / 2;
  switch (face) {
    case 'n': return { x: bl.x, z: z0 - off, yaw: 0 };          // facing +z toward the door
    case 's': return { x: bl.x, z: z1 + off, yaw: Math.PI };
    case 'w': return { x: x0 - off, z: bl.z, yaw: Math.PI / 2 };
    default: return { x: x1 + off, z: bl.z, yaw: -Math.PI / 2 };
  }
}

// ------------------------------------------------------------------------------------------ layouts
function layoutBlock(C, b) {
  if (b.kind === 'strip' || b.kind === 'apron') return;
  const inner = inset(b, SW);
  b.inner = inner;
  const S = b.special;
  if (S === 'castellPark') return layoutPark(C, b, inner);
  if (S === 'lanternSquare' || S === 'plaza2') return layoutPlaza(C, b, inner);
  if (S === 'solstice') return layoutSolstice(C, b, inner);
  if (S && SPECIALS[S]) return SPECIALS[S](C, b, inner);
  switch (b.district) {
    case 'downtown': return layoutDowntown(C, b, inner);
    case 'oldquarter': return layoutOldQuarter(C, b, inner);
    case 'palmshore': return layoutPalmShore(C, b, inner);
    case 'linden': return layoutSuburb(C, b, inner);
    case 'ironworks': return layoutIndustrial(C, b, inner);
    case 'saltgate': return layoutDockYard(C, b, inner);
    default: return layoutMidtown(C, b, inner);
  }
}
function lot(b, r, surface, extra = {}) { b.lots.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, surface, ...extra }); }

function makeTower(C, b, r, h, style, opts = {}) {
  const { rng } = C;
  const top = b.top;
  const podH = opts.podium ? FACADES.STOREFRONT.floorH + rng.int(1, 2) * 4 : 0;
  const parts = [];
  const W = r.x1 - r.x0, D = r.z1 - r.z0;
  let y = top;
  if (podH) { parts.push({ ...r, y0: top, y1: top + podH, style: 'OFFICE_CONCRETE', storefront: true }); y = top + podH; }
  const ins = podH ? Math.min(W, D) * rng.range(0.12, 0.22) : 0;
  let cur = inset(r, ins);
  const shaftH = h - (y - top);
  const tiers = h > 110 ? 3 : h > 60 ? 2 : 1;
  const floorH = FACADES[style].floorH;
  for (let t = 0; t < tiers; t++) {
    const frac = tiers === 1 ? 1 : t === 0 ? rng.range(0.5, 0.65) : t === 1 ? (tiers === 2 ? 1 : rng.range(0.3, 0.4)) : 1;
    let th = t === tiers - 1 ? top + h - y : Math.round(shaftH * frac / floorH) * floorH;
    th = Math.max(floorH * 2, Math.round(th / floorH) * floorH);
    parts.push({ ...cur, y0: y, y1: y + th, style, storefront: !podH && t === 0 });
    y += th;
    const cw = cur.x1 - cur.x0, cd = cur.z1 - cur.z0;
    const k = rng.range(0.08, 0.16);
    cur = { x0: cur.x0 + cw * k, x1: cur.x1 - cw * k, z0: cur.z0 + cd * k, z1: cur.z1 - cd * k };
  }
  const last = parts[parts.length - 1];
  last.crown = h > 70 ? (rng.chance(0.5) ? 'spire' : rng.chance(0.5) ? 'crown' : 'helipad') : 'mech';
  return addBuilding(C, b, { kind: 'tower', style, x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, parts, storefront: true, lit: 0.45, face: faceOf(r, b) });
}
function makeBox(C, b, r, floors, style, opts = {}) {
  const sf = opts.storefront ?? false;
  const h = heightFor(style, floors, sf);
  return addBuilding(C, b, { kind: opts.kind || (floors > 6 ? 'midrise' : 'lowrise'), style, x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1,
    parts: [{ ...r, y1: b.top + h, style, storefront: sf, crown: opts.crown || (floors > 3 ? 'mech' : null) }], storefront: sf, tint: opts.tint, face: opts.face || faceOf(r, b),
    lit: opts.lit, sign: opts.sign, name: opts.name });
}

function layoutDowntown(C, b, inner) {
  const { rng } = C;
  const dc = Math.hypot(b.cx - 120, b.cz - 42);
  const hMax = lerp(200, 64, clamp(dc / 420, 0, 1));
  const styles = ['GLASS_BLUE', 'GLASS_DARK', 'GLASS_SILVER', 'MODERN_WHITE', 'OFFICE_CONCRETE', 'GLASS_BLUE'];
  lot(b, inner, GROUND.PAVERS);
  const L = rng.next();
  if (L < 0.3) {
    makeTower(C, b, inset(inner, 1), hMax * rng.range(0.7, 1), rng.pick(styles), { podium: true });
  } else {
    const parts = bsp(inner, L < 0.75 ? 2 : 3, 28, rng);
    for (const p of parts) {
      const r = inset(p, rng.range(1.5, 4));
      if (rng.chance(0.65)) makeTower(C, b, r, hMax * rng.range(0.45, 0.95), rng.pick(styles), { podium: rng.chance(0.4) });
      else makeBox(C, b, r, rng.int(6, 14), rng.pick(['OFFICE_CONCRETE', 'MODERN_WHITE', 'GLASS_DARK']), { storefront: true });
    }
  }
}
function layoutSolstice(C, b, inner) {
  lot(b, inner, GROUND.PAVERS);
  const cx = (inner.x0 + inner.x1) / 2, cz = (inner.z0 + inner.z1) / 2;
  const r = { x0: cx - 19, x1: cx + 19, z0: cz - 19, z1: cz + 19 };
  const top = b.top, parts = [];
  parts.push({ x0: cx - 26, x1: cx + 26, z0: cz - 22, z1: cz + 22, y0: top, y1: top + 12.5, style: 'GLASS_DARK', storefront: true });
  let y = top + 12.5;
  const tiers = [[19, 19, 128], [16, 16, 64], [12.5, 12.5, 32]];
  for (const [hx, hz, th] of tiers) { parts.push({ x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz, y0: y, y1: y + th, style: 'GLASS_SILVER' }); y += th; }
  parts[parts.length - 1].crown = 'solstice';
  const bl = addBuilding(C, b, { kind: 'landmark', style: 'GLASS_SILVER', ...r, parts, storefront: true, lit: 0.6, name: 'Solstice Tower' });
  bl.landmark = true;
  // plaza props
  addProp(C, 'fountain', cx, inner.z1 - 14, { top: b.top, scale: 1.2 });
  for (let i = 0; i < 6; i++) { const x = inner.x0 + 10 + i * (inner.x1 - inner.x0 - 20) / 5; addProp(C, 'planter', x, inner.z1 - 4, { top: b.top, breakable: false }); }
  C.city.poi.solstice = { x: cx, y: b.top, z: cz + 24, yaw: Math.PI };
}
function layoutOldQuarter(C, b, inner) {
  const { rng } = C;
  const { parcels, court } = perimeterParcels(inner, rng.range(15, 20), 9, 20, rng);
  const styles = ['BRICK_RED', 'BRICK_DARK', 'BRICK_RED', 'STUCCO', 'OFFICE_CONCRETE'];
  for (const p of parcels) {
    lot(b, p, GROUND.CONCRETE);
    const style = rng.pick(styles);
    const floors = rng.int(2, 6);
    const back = rng.range(0, 3);
    const r = { ...p };
    if (p.face === 'n') r.z1 -= back; else if (p.face === 's') r.z0 += back; else if (p.face === 'w') r.x1 -= back; else r.x0 += back;
    makeBox(C, b, r, floors, style, { storefront: rng.chance(0.85), tint: style === 'STUCCO' ? rng.pick(PASTELS) : jitter(rng, [1, 1, 1], 0.1), face: p.face });
  }
  if (court) {
    if (rng.chance(0.5)) lot(b, court, GROUND.PARKING, { stalls: true });
    else lot(b, court, GROUND.CONCRETE);
    if (court.x1 - court.x0 > 12) {
      addProp(C, 'dumpster', court.x0 + 3, court.z0 + 3, { top: b.top, rot: rng.range(0, 6.28), breakable: false });
      if (rng.chance(0.5)) addProp(C, 'tree', (court.x0 + court.x1) / 2, (court.z0 + court.z1) / 2, { top: b.top, variant: rng.int(0, 2), scale: rng.range(0.8, 1.1) });
    }
  }
}
function layoutMidtown(C, b, inner) {
  const { rng } = C;
  const parts = bsp(inner, rng.int(2, 4), 24, rng);
  for (const p of parts) {
    const r = rng.next();
    if (r < 0.16) { lot(b, p, GROUND.PARKING, { stalls: true }); continue; }
    lot(b, p, rng.chance(0.3) ? GROUND.PAVERS : GROUND.CONCRETE);
    const q = inset(p, rng.range(1, 4));
    if (r < 0.26) makeBox(C, b, q, rng.int(3, 5), 'PARKING', { kind: 'garage', lit: 0.2 });
    else if (r < 0.8) makeBox(C, b, q, rng.int(3, 12), rng.pick(['OFFICE_CONCRETE', 'MODERN_WHITE', 'GLASS_DARK', 'GLASS_BLUE', 'BRICK_DARK']), { storefront: rng.chance(0.6) });
    else makeBox(C, b, q, rng.int(1, 2), rng.pick(['BRICK_RED', 'STUCCO', 'MODERN_WHITE']), { storefront: true, tint: rng.pick(PASTELS) });
  }
  // occasional rooftop billboard
  const last = C.city.buildings[C.city.buildings.length - 1];
  if (last && last.block === b.id && last.h < 30 && last.w > 14 && rng.chance(0.35)) {
    addProp(C, 'billboard', last.x, last.z, { top: last.y + last.h, rot: faceYaw(last.face), variant: rng.int(0, 9), extra: { roof: true } });
  }
}
function faceYaw(face) { return face === 'n' ? Math.PI : face === 's' ? 0 : face === 'w' ? -Math.PI / 2 : Math.PI / 2; }
function layoutPalmShore(C, b, inner) {
  const { rng } = C;
  if (b.x0 < -880) { // beachfront hotels, facing west
    const parts = bsp(inner, rng.int(2, 3), 30, rng);
    for (const p of parts) {
      lot(b, p, GROUND.PAVERS);
      const q = inset(p, rng.range(3, 6));
      const floors = rng.int(4, 13);
      makeBox(C, b, q, floors, rng.chance(0.75) ? 'STUCCO' : 'MODERN_WHITE', { kind: 'hotel', storefront: true, tint: rng.pick(PASTELS), face: 'w', lit: 0.6 });
      // pool deck
      if (p.x1 - q.x1 > 5 || rng.chance(0.4)) C.city.pools.push({ x: (q.x1 + p.x1) / 2 + 0.5, z: (p.z0 + p.z1) / 2, w: Math.max(3, Math.min(8, p.x1 - q.x1 - 2)), d: Math.min(12, (p.z1 - p.z0) * 0.5), y: b.top });
    }
    return;
  }
  const { parcels, court } = perimeterParcels(inner, rng.range(14, 18), 11, 20, rng);
  for (const p of parcels) {
    lot(b, p, GROUND.CONCRETE);
    const q = { ...p };
    makeBox(C, b, q, rng.int(2, 5), rng.chance(0.7) ? 'STUCCO' : 'MODERN_WHITE', { storefront: rng.chance(0.7), tint: rng.pick(PASTELS), face: p.face });
  }
  if (court) {
    lot(b, court, rng.chance(0.5) ? GROUND.GRASS : GROUND.PAVERS);
    const cx = (court.x0 + court.x1) / 2, cz = (court.z0 + court.z1) / 2;
    addProp(C, 'palm', cx, cz, { top: b.top, scale: rng.range(0.8, 1.1), variant: rng.int(0, 2) });
  }
}
function layoutSuburb(C, b, inner) {
  const { rng } = C;
  const minDim = Math.min(inner.x1 - inner.x0, inner.z1 - inner.z0);
  const depth = Math.min(34, minDim / 2);
  const { parcels, court } = perimeterParcels(inner, depth, 19, 26, rng);
  for (const p of parcels) {
    lot(b, p, GROUND.GRASS);
    const f = p.face;
    const along = (f === 'n' || f === 's') ? p.x1 - p.x0 : p.z1 - p.z0;
    const deep = (f === 'n' || f === 's') ? p.z1 - p.z0 : p.x1 - p.x0;
    if (along < 14 || deep < 18) continue;
    const hw = rng.range(9, Math.min(13, along - 5)), hd = rng.range(8, Math.min(12, deep - 9));
    const setback = rng.range(5.5, 7.5);
    const drive = rng.chance(0.5) ? 1 : -1; // driveway side
    const a0 = (f === 'n' || f === 's') ? p.x0 : p.z0;
    const aC = a0 + along / 2 - drive * 2.2;
    const floors = rng.chance(0.35) ? 2 : 1;
    const style = rng.chance(0.55) ? 'HOUSE_SIDING' : 'HOUSE_STUCCO';
    let r;
    if (f === 'n') r = { x0: aC - hw / 2, x1: aC + hw / 2, z0: p.z0 + setback, z1: p.z0 + setback + hd };
    else if (f === 's') r = { x0: aC - hw / 2, x1: aC + hw / 2, z0: p.z1 - setback - hd, z1: p.z1 - setback };
    else if (f === 'w') r = { x0: p.x0 + setback, x1: p.x0 + setback + hd, z0: aC - hw / 2, z1: aC + hw / 2 };
    else r = { x0: p.x1 - setback - hd, x1: p.x1 - setback, z0: aC - hw / 2, z1: aC + hw / 2 };
    const h = floors * 3;
    const bl = addBuilding(C, b, { kind: 'house', style, ...r, face: f, tint: rng.pick(HOUSE_TINTS), roofTint: rng.pick(ROOF_TINTS), lit: 0.7,
      parts: [{ ...r, y1: b.top + h, roof: rng.chance(0.75) ? 'gable' : 'hip', roofH: rng.range(2, 3), ridge: (f === 'n' || f === 's') ? 'x' : 'z' }] });
    // driveway from sidewalk to the side of the house
    const dW = 3.2, dPos = aC + drive * (hw / 2 + dW / 2 + 0.4);
    let dr;
    if (f === 'n') dr = { x0: dPos - dW / 2, x1: dPos + dW / 2, z0: p.z0, z1: p.z0 + setback + hd * 0.7 };
    else if (f === 's') dr = { x0: dPos - dW / 2, x1: dPos + dW / 2, z0: p.z1 - setback - hd * 0.7, z1: p.z1 };
    else if (f === 'w') dr = { x0: p.x0, x1: p.x0 + setback + hd * 0.7, z0: dPos - dW / 2, z1: dPos + dW / 2 };
    else dr = { x0: p.x1 - setback - hd * 0.7, x1: p.x1, z0: dPos - dW / 2, z1: dPos + dW / 2 };
    if (dr.x0 > p.x0 - 0.1 && dr.x1 < p.x1 + 0.1 && dr.z0 > p.z0 - 0.1 && dr.z1 < p.z1 + 0.1) {
      C.city.overlays.push({ ...dr, y: b.top, surface: GROUND.CONCRETE });
      const yaw = f === 'n' ? Math.PI : f === 's' ? 0 : f === 'w' ? -Math.PI / 2 : Math.PI / 2; // car nose toward the street? park nose-in: facing house
      const px = (dr.x0 + dr.x1) / 2, pz = (dr.z0 + dr.z1) / 2;
      C.city.parking.push({ x: px, y: b.top, z: pz, yaw: yaw + Math.PI, kind: 'driveway', district: b.district });
      (b.driveways || (b.driveways = [])).push({ face: f, a: (f === 'n' || f === 's') ? dPos : dPos, w: dW + 1 });
      // mailbox
      const mb = f === 'n' ? [dPos + drive * 2.4, p.z0 + 0.8] : f === 's' ? [dPos + drive * 2.4, p.z1 - 0.8] : f === 'w' ? [p.x0 + 0.8, dPos + drive * 2.4] : [p.x1 - 0.8, dPos + drive * 2.4];
      addProp(C, 'mailbox', mb[0], mb[1], { top: b.top, rot: faceYaw(f), breakable: true, variant: rng.int(0, 2) });
    }
    // backyard: pool, trees, fence
    const backDepth = deep - setback - hd;
    if (backDepth > 7 && rng.chance(0.3)) {
      const bz = f === 'n' ? p.z1 - backDepth / 2 : f === 's' ? p.z0 + backDepth / 2 : null;
      const bx = f === 'w' ? p.x1 - backDepth / 2 : f === 'e' ? p.x0 + backDepth / 2 : null;
      const pw = Math.min(8, along * 0.4), pd = Math.min(4.5, backDepth - 3);
      if (bz != null) C.city.pools.push({ x: aC, z: bz, w: pw, d: pd, y: b.top });
      else C.city.pools.push({ x: bx, z: aC, w: pd, d: pw, y: b.top });
    } else if (backDepth > 5) {
      const tx = f === 'w' ? p.x1 - 3 : f === 'e' ? p.x0 + 3 : aC + rng.range(-4, 4);
      const tz = f === 'n' ? p.z1 - 3 : f === 's' ? p.z0 + 3 : aC + rng.range(-4, 4);
      addProp(C, 'tree', tx, tz, { top: b.top, variant: rng.int(0, 2), scale: rng.range(0.8, 1.15) });
    }
    // front yard tree
    if (rng.chance(0.55)) {
      const s = aC - drive * (hw / 2 - 1), off = setback / 2;
      const [tx, tz] = f === 'n' ? [s, p.z0 + off] : f === 's' ? [s, p.z1 - off] : f === 'w' ? [p.x0 + off, s] : [p.x1 - off, s];
      addProp(C, rng.chance(0.3) ? 'bush' : 'tree', tx, tz, { top: b.top, variant: rng.int(0, 2), scale: rng.range(0.7, 1) });
    }
    // back fence (between lot and court / opposite lot)
    const fy = b.top;
    if (f === 'n') addFence(C, p.x0, p.z1 - 0.2, p.x1, p.z1 - 0.2, 'wood', fy);
    else if (f === 's') addFence(C, p.x0, p.z0 + 0.2, p.x1, p.z0 + 0.2, 'wood', fy);
    else if (f === 'w') addFence(C, p.x1 - 0.2, p.z0, p.x1 - 0.2, p.z1, 'wood', fy);
    else addFence(C, p.x0 + 0.2, p.z0, p.x0 + 0.2, p.z1, 'wood', fy);
  }
  if (court && court.x1 - court.x0 > 6 && court.z1 - court.z0 > 6) {
    lot(b, court, GROUND.GRASS);
    const n = Math.floor((court.x1 - court.x0) * (court.z1 - court.z0) / 350);
    for (let i = 0; i < n; i++) addProp(C, 'tree', rng.range(court.x0 + 2, court.x1 - 2), rng.range(court.z0 + 2, court.z1 - 2), { top: b.top, variant: rng.int(0, 2), scale: rng.range(0.8, 1.2) });
  }
}
function addFence(C, x0, z0, x1, z1, variant, y) {
  const len = Math.hypot(x1 - x0, z1 - z0); if (len < 1) return;
  const rot = Math.atan2(x1 - x0, z1 - z0);
  C.city.props.push({ kind: 'fence', x: (x0 + x1) / 2, y, z: (z0 + z1) / 2, rot, scale: 1, len, variant: variant === 'chain' ? 1 : variant === 'iron' ? 2 : 0, breakable: false, collider: -1, h: variant === 'chain' ? 2.4 : 1.6 });
}
function layoutIndustrial(C, b, inner) {
  const { rng } = C;
  const parts = bsp(inner, rng.int(1, 3), 40, rng);
  for (const p of parts) {
    lot(b, p, rng.chance(0.7) ? GROUND.CONCRETE : GROUND.GRAVEL);
    const W = p.x1 - p.x0, D = p.z1 - p.z0;
    const q = { x0: p.x0 + rng.range(3, 8), x1: p.x1 - rng.range(3, 12), z0: p.z0 + rng.range(3, 8), z1: p.z1 - rng.range(3, 12) };
    if (q.x1 - q.x0 < 12 || q.z1 - q.z0 < 12) continue;
    const factory = rng.chance(0.35);
    const h = factory ? rng.range(12, 18) : rng.range(8.5, 13);
    const bl = addBuilding(C, b, { kind: factory ? 'factory' : 'warehouse', style: 'WAREHOUSE', ...q, tint: rng.pick(WAREHOUSE_TINTS), face: faceOf(q, b), lit: 0.15,
      parts: [{ ...q, y1: b.top + h, roof: rng.chance(0.3) ? 'sawtooth' : 'flat' }] });
    if (factory) {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) addProp(C, 'chimney', q.x0 + 4 + i * 5, q.z0 + 4, { top: b.top, h: h + rng.range(10, 22) });
    }
    // yard clutter
    const nC = rng.int(1, 4);
    for (let i = 0; i < nC; i++) {
      const x = rng.chance(0.5) ? rng.range(p.x0 + 2, q.x0 - 1) : rng.range(q.x1 + 2, p.x1 - 2), z = rng.range(p.z0 + 3, p.z1 - 3);
      if (x > p.x0 + 1.5 && x < p.x1 - 1.5) addProp(C, rng.chance(0.5) ? 'container' : 'dumpster', x, z, { top: b.top, rot: rng.chance(0.5) ? 0 : Math.PI / 2, variant: rng.int(0, 5), extra: { stack: 1 } });
    }
    // chain-link fence on street sides with a gate gap
    fenceParcel(C, b, p, 'chain', rng);
  }
}
function fenceParcel(C, b, p, variant, rng) {
  const y = b.top, g0 = 0.35, g1 = 0.65;
  const sides = [['n', p.x0, p.z0 + 0.3, p.x1, p.z0 + 0.3], ['s', p.x0, p.z1 - 0.3, p.x1, p.z1 - 0.3], ['w', p.x0 + 0.3, p.z0, p.x0 + 0.3, p.z1], ['e', p.x1 - 0.3, p.z0, p.x1 - 0.3, p.z1]];
  for (const [f, x0, z0, x1, z1] of sides) {
    const onStreet = (f === 'n' && Math.abs(p.z0 - b.inner.z0) < 1) || (f === 's' && Math.abs(p.z1 - b.inner.z1) < 1) || (f === 'w' && Math.abs(p.x0 - b.inner.x0) < 1) || (f === 'e' && Math.abs(p.x1 - b.inner.x1) < 1);
    if (!onStreet) continue;
    const gate = rng.chance(0.8);
    if (gate) {
      addFence(C, x0, z0, lerp(x0, x1, g0), lerp(z0, z1, g0), variant, y);
      addFence(C, lerp(x0, x1, g1), lerp(z0, z1, g1), x1, z1, variant, y);
    } else addFence(C, x0, z0, x1, z1, variant, y);
  }
}
function layoutDockYard(C, b, inner) {
  const { rng } = C;
  lot(b, inner, GROUND.CONCRETE);
  const W = inner.x1 - inner.x0, D = inner.z1 - inner.z0;
  // warehouse on the north part
  const wh = { x0: inner.x0 + 6, x1: inner.x1 - 6, z0: inner.z0 + 6, z1: inner.z0 + Math.min(40, D * 0.35) };
  addBuilding(C, b, { kind: 'warehouse', style: 'WAREHOUSE', ...wh, tint: rng.pick(WAREHOUSE_TINTS), lit: 0.1, parts: [{ ...wh, y1: b.top + rng.range(10, 13) }] });
  // container rows
  for (let z = wh.z1 + 12; z < inner.z1 - 8; z += 9) {
    for (let x = inner.x0 + 10; x < inner.x1 - 10; x += 13.2) {
      if (rng.chance(0.2)) continue;
      addProp(C, 'container', x, z, { top: b.top, rot: Math.PI / 2, variant: rng.int(0, 7), extra: { stack: rng.int(1, 3) } });
    }
  }
  fenceParcel(C, b, inner, 'chain', rng);
}
function layoutPark(C, b, inner) {
  const { rng } = C;
  lot(b, inner, GROUND.GRASS);
  C.city.areas.parks.push(rectPoly(b));
  const cx = (inner.x0 + inner.x1) / 2, cz = (inner.z0 + inner.z1) / 2;
  // cross paths
  C.city.overlays.push({ x0: cx - 2.5, x1: cx + 2.5, z0: inner.z0, z1: inner.z1, y: b.top, surface: GROUND.PAVERS });
  C.city.overlays.push({ x0: inner.x0, x1: inner.x1, z0: cz - 2.5, z1: cz + 2.5, y: b.top, surface: GROUND.PAVERS });
  C.city.overlays.push({ x0: cx - 14, x1: cx + 14, z0: cz - 14, z1: cz + 14, y: b.top, surface: GROUND.PAVERS });
  addProp(C, 'fountain', cx, cz, { top: b.top, scale: 1.4 });
  b.parkPaths = { cx, cz };
  // trees avoiding paths
  const n = Math.floor((inner.x1 - inner.x0) * (inner.z1 - inner.z0) / 260);
  for (let i = 0; i < n; i++) {
    const x = rng.range(inner.x0 + 3, inner.x1 - 3), z = rng.range(inner.z0 + 3, inner.z1 - 3);
    if (Math.abs(x - cx) < 6 || Math.abs(z - cz) < 6 || (Math.abs(x - cx) < 18 && Math.abs(z - cz) < 18)) continue;
    if (Math.abs(x - cx) < 10 && z < cz - 40 && z > inner.z0 + 10) continue; // ramp corridor (north arm)
    addProp(C, rng.chance(0.15) ? 'palm' : rng.chance(0.2) ? 'bush' : 'tree', x, z, { top: b.top, variant: rng.int(0, 2), scale: rng.range(0.85, 1.3) });
  }
  for (let k = 0; k < 16; k++) { // benches along paths
    const s = rng.range(20, 100) * (rng.chance(0.5) ? 1 : -1);
    if (rng.chance(0.5)) addProp(C, 'bench', cx + 4, cz + s, { top: b.top, rot: -Math.PI / 2, breakable: true });
    else addProp(C, 'bench', cx + s, cz + 4, { top: b.top, rot: Math.PI, breakable: true });
  }
  for (let s = -100; s <= 100; s += 25) { // path lamps
    if (Math.abs(s) < 15) continue;
    addProp(C, 'parkLamp', cx - 3.5, cz + s, { top: b.top, breakable: true });
    addProp(C, 'parkLamp', cx + s, cz - 3.5, { top: b.top, breakable: true });
  }
}
function layoutPlaza(C, b, inner) {
  const { rng } = C;
  C.city.areas.plazas.push(rectPoly(b));
  const cx = (inner.x0 + inner.x1) / 2, cz = (inner.z0 + inner.z1) / 2;
  // buildings on two sides, plaza in the middle
  const W = inner.x1 - inner.x0;
  const west = { x0: inner.x0, x1: inner.x0 + 22, z0: inner.z0, z1: inner.z1 };
  const east = { x0: inner.x1 - 22, x1: inner.x1, z0: inner.z0, z1: inner.z1 };
  const sty = b.district === 'downtown' ? 'GLASS_BLUE' : 'BRICK_RED';
  for (const r of [west, east]) {
    lot(b, r, GROUND.CONCRETE);
    const parts = splitRange(r.z0, r.z1, 20, 34, rng);
    for (const [a, c] of parts) makeBox(C, b, { x0: r.x0, x1: r.x1, z0: a, z1: c }, b.district === 'downtown' ? rng.int(8, 16) : rng.int(3, 6), rng.chance(0.5) ? sty : 'STUCCO', { storefront: true, tint: rng.pick(PASTELS), face: r === west ? 'w' : 'e' });
  }
  const pz = { x0: west.x1, x1: east.x0, z0: inner.z0, z1: inner.z1 };
  lot(b, pz, GROUND.PAVERS);
  addProp(C, 'fountain', cx, cz, { top: b.top, scale: 1.1 });
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    addProp(C, 'tree', cx + Math.cos(a) * 18, cz + Math.sin(a) * 18, { top: b.top, variant: 1 });
    addProp(C, 'bench', cx + Math.cos(a) * 12, cz + Math.sin(a) * 12, { top: b.top, rot: -a + Math.PI / 2, breakable: true });
  }
  for (let x = pz.x0 + 4; x < pz.x1 - 3; x += 6) { addProp(C, 'bollard', x, pz.z0 + 1, { top: b.top }); addProp(C, 'bollard', x, pz.z1 - 1, { top: b.top }); }
  b.plaza = { cx, cz, r: pz };
}

// --- special blocks
const SPECIALS = {
  police1: (C, b, inner) => specialCivic(C, b, inner, 'police', 'Sol Harbor Police — Midtown Precinct'),
  police2: (C, b, inner) => specialCivic(C, b, inner, 'police', 'Sol Harbor Police — Shore Precinct'),
  hospital1: (C, b, inner) => specialCivic(C, b, inner, 'hospital', 'St. Marisa General'),
  hospital2: (C, b, inner) => specialCivic(C, b, inner, 'hospital', 'Harborview Medical'),
  gunshop1: (C, b, inner) => specialShopInBlock(C, b, inner, 'gunshop', 'Brass & Barrel'),
  gunshop2: (C, b, inner) => specialShopInBlock(C, b, inner, 'gunshop', 'Brass & Barrel'),
  respray1: (C, b, inner) => specialRespray(C, b, inner, 'Fresh Coat Auto Paint'),
  respray2: (C, b, inner) => specialRespray(C, b, inner, 'Fresh Coat Auto Paint'),
  club: (C, b, inner) => specialShopInBlock(C, b, inner, 'club', 'The Undertow'),
  safehouse: (C, b, inner) => specialSafehouse(C, b, inner),
  salvage: (C, b, inner) => specialSalvage(C, b, inner),
};
function mainFace(b) {
  // face toward the widest adjacent road (prefer avenues)
  return b.cz < -300 ? 's' : 'n';
}
function specialCivic(C, b, inner, kind, name) {
  const { rng } = C;
  const W = inner.x1 - inner.x0, D = inner.z1 - inner.z0;
  const face = 'n';
  const r = { x0: inner.x0 + 6, x1: inner.x1 - 6, z0: inner.z0 + 2, z1: inner.z0 + Math.min(34, D * 0.45) };
  lot(b, { ...inner, z1: r.z1 + 2 }, GROUND.PAVERS);
  const park = { x0: inner.x0, x1: inner.x1, z0: r.z1 + 2, z1: inner.z1 };
  lot(b, park, GROUND.PARKING, { stalls: true });
  const style = kind === 'police' ? 'OFFICE_CONCRETE' : 'MODERN_WHITE';
  const floors = kind === 'police' ? 3 : 6;
  const bl = makeBox(C, b, r, floors, style, { kind, storefront: false, face, name, sign: name, lit: 0.8, crown: kind === 'hospital' ? 'helipad' : 'mech' });
  const door = doorPoint(bl, 'n', 2.5);
  door.y = b.top;
  const arr = kind === 'police' ? (C.city.poi.policeStations || (C.city.poi.policeStations = [])) : (C.city.poi.hospitals || (C.city.poi.hospitals = []));
  // spawn point: in front facing away from the building (toward street)
  arr.push({ x: door.x, y: b.top, z: door.z, yaw: Math.PI, name, door });
  // parking rows in the lot
  const spots = [];
  for (let x = park.x0 + 4; x < park.x1 - 4; x += 3.2) spots.push({ x, y: b.top, z: park.z0 + 4, yaw: 0, kind: kind === 'police' ? 'police' : 'lot', district: b.district });
  for (let x = park.x0 + 4; x < park.x1 - 4; x += 3.2) if (park.z1 - park.z0 > 18) spots.push({ x, y: b.top, z: park.z1 - 4, yaw: Math.PI, kind: 'lot', district: b.district });
  C.city.parking.push(...spots);
  b.lotStalls = true;
}
function specialShopInBlock(C, b, inner, kind, name) {
  // generate old-quarter perimeter, then convert the middle north parcel into the special shop
  const before = C.city.buildings.length;
  if (b.district === 'ironworks') {
    lot(b, inner, GROUND.CONCRETE);
    const r = { x0: inner.x0 + 4, x1: inner.x0 + 26, z0: inner.z0 + 1, z1: inner.z0 + 18 };
    const bl = makeBox(C, b, r, 1, 'BRICK_DARK', { kind, storefront: true, face: 'n', name, sign: name, lit: 0.9 });
    const q = { x0: inner.x0 + 34, x1: inner.x1 - 6, z0: inner.z0 + 8, z1: inner.z1 - 8 };
    addBuilding(C, b, { kind: 'warehouse', style: 'WAREHOUSE', ...q, tint: [0.62, 0.68, 0.74], lit: 0.1, parts: [{ ...q, y1: b.top + 11 }] });
    registerShop(C, kind, bl, 'n', name);
    return;
  }
  layoutOldQuarter(C, b, inner);
  const cands = C.city.buildings.slice(before).filter(bl => bl.face === 'n');
  cands.sort((a, c) => Math.abs(a.x - b.cx) - Math.abs(c.x - b.cx));
  const bl = cands[0] || C.city.buildings[before];
  bl.kind = kind; bl.name = name; bl.sign = name; bl.storefront = true; bl.lit = 0.9;
  for (const p of bl.parts) p.storefront = p.y0 <= b.top + 0.01;
  registerShop(C, kind, bl, bl.face, name);
}
function registerShop(C, kind, bl, face, name) {
  const d = doorPoint(bl, face, 2.2);
  const poi = { x: d.x, y: 0.15, z: d.z, yaw: d.yaw + Math.PI, name, building: bl.id };
  if (kind === 'gunshop') (C.city.poi.gunShops || (C.city.poi.gunShops = [])).push(poi);
  else if (kind === 'club') C.city.poi.club = poi;
}
function specialRespray(C, b, inner, name) {
  const { rng } = C;
  lot(b, inner, GROUND.CONCRETE);
  // open-front garage facing north street
  const x0 = b.cx - 7, x1 = b.cx + 7, z0 = inner.z0 + 1, z1 = inner.z0 + 17, h = 6.5, t = 0.6;
  const top = b.top;
  const bl = addBuilding(C, b, { kind: 'respray', style: 'WAREHOUSE', x0, x1, z0, z1, tint: [0.85, 0.35, 0.2], face: 'n', name, sign: name, lit: 0.9,
    parts: [
      { x0, x1: x0 + t, z0, z1, y1: top + h }, { x0: x1 - t, x1, z0, z1, y1: top + h }, { x0, x1, z0: z1 - t, z1, y1: top + h },
      { x0, x1, z0, z1, y0: top + h - 0.8, y1: top + h, open: 'roof' },
    ] });
  bl.respray = true;
  (C.city.poi.resprays || (C.city.poi.resprays = [])).push({ x: b.cx, y: top, z: z0 - 6, yaw: Math.PI, name, door: { x: b.cx, z: (z0 + z1) / 2 + 1, r: 4.5 }, building: bl.id });
  // rest of block: small shops
  const rest = [{ x0: inner.x0, x1: x0 - 4, z0: inner.z0, z1: inner.z1 }, { x0: x1 + 4, x1: inner.x1, z0: inner.z0, z1: inner.z1 }];
  for (const r of rest) {
    if (r.x1 - r.x0 < 16) continue;
    for (const [a, c] of splitRange(r.z0 + 20, r.z1, 16, 26, rng)) makeBox(C, b, { x0: r.x0 + 2, x1: r.x1 - 2, z0: a + 1, z1: c - 1 }, rng.int(2, 4), rng.pick(['BRICK_RED', 'OFFICE_CONCRETE']), { storefront: true });
  }
}
function specialSafehouse(C, b, inner) {
  const { rng } = C;
  lot(b, inner, GROUND.PAVERS);
  const r = { x0: inner.x0 + 3, x1: inner.x0 + 30, z0: inner.z0 + 18, z1: inner.z1 - 18 };
  const bl = makeBox(C, b, r, 6, 'STUCCO', { kind: 'apartment', storefront: true, face: 'w', tint: [1, 0.86, 0.74], name: 'Casa Brisa Apartments', lit: 0.7 });
  const d = doorPoint(bl, 'w', 2.2);
  C.city.poi.safehouse = { x: d.x, y: b.top, z: d.z, yaw: -Math.PI / 2, name: 'Casa Brisa Apartments' };
  C.city.poi.playerStart = { x: d.x - 2.5, y: b.top, z: d.z, yaw: -Math.PI / 2 };
  C.city.pools.push({ x: (r.x1 + inner.x1) / 2 + 4, z: b.cz, w: 7, d: 14, y: b.top });
  const rest = { x0: r.x1 + 26, x1: inner.x1, z0: inner.z0, z1: inner.z1 };
  if (rest.x1 - rest.x0 > 18) makeBox(C, b, inset(rest, 2), rng.int(3, 6), 'MODERN_WHITE', { storefront: true, tint: rng.pick(PASTELS) });
  // safehouse garage spot on Shoreline Drive side (street parking handles it)
}
function specialSalvage(C, b, inner) {
  const { rng } = C;
  lot(b, inner, GROUND.GRAVEL);
  const off = { x0: inner.x0 + 6, x1: inner.x0 + 30, z0: inner.z1 - 22, z1: inner.z1 - 6 };
  const bl = makeBox(C, b, off, 2, 'BRICK_DARK', { kind: 'salvage', storefront: true, face: 's', name: 'Inez Auto Salvage', sign: 'INEZ AUTO SALVAGE', lit: 0.8 });
  const shed = { x0: inner.x0 + 40, x1: inner.x0 + 80, z0: inner.z1 - 30, z1: inner.z1 - 6 };
  addBuilding(C, b, { kind: 'garage', style: 'WAREHOUSE', ...shed, tint: [0.72, 0.36, 0.28], lit: 0.1, parts: [{ ...shed, y1: b.top + 9 }] });
  const d = doorPoint(bl, 'n', 2.2);
  C.city.poi.contacts = C.city.poi.contacts || {};
  C.city.poi.contacts.inez = { x: d.x, y: b.top, z: d.z, yaw: 0, name: 'Inez' };
  C.city.poi.salvageDrop = { x: (inner.x0 + inner.x1) / 2, y: b.top, z: inner.z1 - 44, r: 7 };
  // wreck piles
  for (let i = 0; i < 40; i++) {
    const x = rng.range(inner.x0 + 10, inner.x1 - 10), z = rng.range(inner.z0 + 10, inner.z1 - 60);
    addProp(C, 'wreck', x, z, { top: b.top, rot: rng.range(0, 6.28), variant: rng.int(0, 5), extra: { stack: rng.chance(0.3) ? 2 : 1 } });
  }
  addProp(C, 'crane', inner.x1 - 20, inner.z0 + 30, { top: b.top, variant: 1, rot: Math.PI / 2, extra: { small: true } });
  const fb = { ...inner };
  fenceParcel(C, b, fb, 'chain', makeRng(99));
}

// ------------------------------------------------------------------------------------------ special areas
function buildSpecialAreas(C) {
  const { city, rng, terrain } = C;
  // Beach polygon (between promenade and shoreline)
  const coast = terrain.coastline.filter(p => p[0] < -912 && p[1] > -700 && p[1] < 650);
  if (coast.length > 3) {
    coast.sort((a, b) => a[1] - b[1]);
    city.areas.beaches.push([[-915, coast[0][1]], ...coast, [-915, coast[coast.length - 1][1]]]);
  }
  // Sol Pier (deck at y=1.8) centered on z = 40
  const pier = { z: 40, x0: -1200, x1: -915, rampEnd: -937, y: 1.8, w: 12, endX: -1200, head: { x0: -1200, x1: -1168, z0: 22, z1: 58 } };
  city.areas.pier = pier;
  city.poi.pierEnd = { x: -1180, y: pier.y, z: 40, yaw: -Math.PI / 2 };
  addProp(C, 'lighthouse', -1190, 40, { y: pier.y, h: 22 });
  for (let x = -950; x > -1165; x -= 24) { addProp(C, 'pierLamp', x, 34.6, { y: pier.y }); addProp(C, 'pierLamp', x - 12, 45.4, { y: pier.y }); }
  for (let x = -960; x > -1150; x -= 40) addProp(C, 'bench', x, 44.6, { y: pier.y, rot: Math.PI });
  // Beach props: umbrellas, lifeguard towers, palms along the promenade
  for (let z = -600; z < 600; z += 34) {
    if (Math.abs(z - 40) < 26) continue;
    addProp(C, 'palm', -918 - rng.range(1, 3), z + rng.range(-4, 4), { variant: rng.int(0, 2), scale: rng.range(0.9, 1.2) });
  }
  for (const z of [-420, -140, 230, 470]) addProp(C, 'lifeguard', -975, z, { rot: -Math.PI / 2 });
  for (let i = 0; i < 220; i++) {
    const z = rng.range(-560, 590), x = rng.range(-975, -935);
    if (Math.abs(z - 40) < 30 || (z > 20 && z < 200 && x < -950 && x > -975)) continue; // pier + ramp corridor
    addProp(C, 'umbrella', x, z, { variant: rng.int(0, 5), breakable: true });
  }
  // South promenade palms + lamps, seawall
  for (let x = -880; x < 395; x += 22) { addProp(C, 'palm', x, 626, { top: TOP, variant: rng.int(0, 2), scale: rng.range(0.9, 1.15) }); }
  city.areas.quays.push({ a: [-846, 632], b: [400, 632], top: TOP }, { a: [400, 632], b: [400, 792], top: 0 }, { a: [400, 792], b: [934, 792], top: 0 }, { a: [934, 792], b: [934, -652], top: TOP });
  // Docks apron: cranes, container rows, office
  const ap = city.blocks.find(b => b.kind === 'apron');
  ap.lots.push({ x0: ap.x0, x1: ap.x1, z0: ap.z0, z1: ap.z1, surface: GROUND.CONCRETE });
  for (const x of [470, 600, 730, 860]) addProp(C, 'crane', x, 776, { y: 0, rot: 0, variant: 0 });
  for (let z = 668; z < 752; z += 10.5) for (let x = 520; x < 900; x += 13.4) {
    if (rng.chance(0.18) || (x > 600 && x < 700 && z > 690 && z < 712)) continue; // stunt corridor
    addProp(C, 'container', x, z, { y: 0, rot: Math.PI / 2, variant: rng.int(0, 7), extra: { stack: rng.int(1, 4) } });
  }
  const off = { x0: 430, x1: 462, z0: 628, z1: 648 };
  const bl = addBuilding(C, ap, { kind: 'office', style: 'OFFICE_CONCRETE', ...off, name: 'Saltgate Shipping', sign: 'SALTGATE SHIPPING', face: 'n', lit: 0.8, parts: [{ ...off, y0: 0, y1: 7.4 }] });
  bl.y = 0;
  const d = doorPoint(bl, 's', 2.2);
  city.poi.contacts = city.poi.contacts || {};
  city.poi.contacts.otis = { x: d.x, y: 0, z: d.z, yaw: Math.PI, name: 'Otis' };
  city.poi.courierDepot = { x: 480, y: 0, z: 660, yaw: Math.PI / 2 };
  // bollards along quay
  for (let x = 410; x < 930; x += 14) addProp(C, 'bollardQuay', x, 790, { y: 0 });
}

function buildHillContent(C) {
  const { city, rng, terrain } = C; const hill = C.hill;
  const lk = hill.lookout;
  city.poi.lookout = { x: lk.x - 10, y: lk.y, z: lk.z + 8, yaw: Math.PI };
  city.areas.hillPads.push({ x: lk.x - 12, z: lk.z, hx: 30, hz: 22, y: lk.y });
  for (let i = 0; i < 5; i++) addProp(C, 'bench', lk.x - 30 + i * 9, lk.z + 18, { y: lk.y, rot: 0 });
  addProp(C, 'binoculars', lk.x - 6, lk.z + 20, { y: lk.y });
  addProp(C, 'binoculars', lk.x - 22, lk.z + 20, { y: lk.y });
  // radio tower on the summit north of Ridgeback Road
  const tx = 300, tz = -1172;
  const ty = terrain.heightAt(tx, tz);
  terrain.flattenRect(tx, tz, 10, 10, ty, 10);
  city.poi.radioTower = { x: tx, y: ty, z: tz };
  addProp(C, 'radioTower', tx, tz, { y: ty, h: 64 });
  // mansions on pads beside the hill roads
  const place = (edge, frac, side) => {
    const pts = edge.points, cum = cumulative(pts), o = {};
    samplePath(pts, cum, cum[cum.length - 1] * frac, o);
    const rx = -o.dz * side, rz = o.dx * side;
    const cx = o.x + rx * 25, cz = o.z + rz * 25;
    const y = o.y + 0.4;
    const yaw = Math.atan2(o.dx, o.dz);
    terrain.flattenRect(cx, cz, 16, 13, y, 14, yaw);
    city.areas.hillPads.push({ x: cx, z: cz, hx: 16, hz: 13, y, rot: yaw });
    const b = newBlock(C, { x0: cx - 1, x1: cx + 1, z0: cz - 1, z1: cz + 1 }, 'pad', { top: y, district: 'crestline' });
    // mansion as axis aligned approximation (footprint 18x14)
    const r = { x0: cx - 9, x1: cx + 9, z0: cz - 7, z1: cz + 7 };
    const bl = addBuilding(C, b, { kind: 'mansion', style: rng.chance(0.5) ? 'MODERN_WHITE' : 'STUCCO', ...r, tint: rng.pick(PASTELS), lit: 0.8,
      parts: [{ ...r, y0: y, y1: y + 7.2 }, { x0: r.x0 + 3, x1: r.x1 - 5, z0: r.z0 + 2, z1: r.z1 - 2, y0: y + 7.2, y1: y + 10.8 }] });
    bl.y = y;
    city.pools.push({ x: cx + side * 0 + 11 * Math.sign(rx || 1) * 0, z: cz + 9.5, w: 8, d: 3.5, y });
    city.parking.push({ x: cx - 12, y, z: cz, yaw: 0, kind: 'driveway', district: 'crestline' });
  };
  place(hill.roadA, 0.42, 1); place(hill.roadA, 0.72, -1); place(hill.roadB, 0.2, 1); place(hill.roadB, 0.45, -1); place(hill.roadB, 0.72, 1);
  // vegetation on hills
  const sampler = makeRng(C.city.seed + 77);
  let placed = 0;
  for (let i = 0; i < 9000 && placed < 1500; i++) {
    const x = sampler.range(-1000, 980), z = sampler.range(-1360, -672);
    const h = terrain.heightAt(x, z);
    if (h < 1.2) continue;
    if (nearHillRoad(hill, x, z, 9)) continue;
    let onPad = false; for (const p of city.areas.hillPads) if (Math.abs(x - p.x) < p.hx + 4 && Math.abs(z - p.z) < p.hz + 4) onPad = true;
    if (onPad || Math.hypot(x - tx, z - tz) < 14) continue;
    const n = terrain.normalAt(x, z);
    if (n.y < 0.72) continue;
    const r = sampler.next();
    const kind = r < 0.45 ? 'pine' : r < 0.75 ? 'tree' : r < 0.93 ? 'bush' : 'rock';
    addProp(C, kind, x, z, { y: h - 0.1, variant: sampler.int(0, 2), scale: sampler.range(0.75, 1.35), rot: sampler.range(0, 6.28) });
    placed++;
  }
  // guard rails on outer side where the terrain drops
  for (const e of [hill.roadA, hill.roadB, hill.spur]) {
    const pts = e.points;
    for (let i = 4; i < pts.length - 4; i += 4) {
      const a = pts[i], b = pts[i + 4];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      for (const side of [1, -1]) {
        const rx = -dz / l * side, rz = dx / l * side;
        const ox = a.x + rx * 5.6, oz = a.z + rz * 5.6;
        const drop = a.y - terrain.heightAt(a.x + rx * 16, a.z + rz * 16);
        if (drop > 3 && a.z < -680) {
          C.city.props.push({ kind: 'guardrail', x: (ox + b.x + rx * 5.6) / 2, y: (a.y + b.y) / 2, z: (oz + b.z + rz * 5.6) / 2, rot: Math.atan2(dx, dz), len: l, scale: 1, variant: 0, breakable: false, collider: -1, y0: a.y, y1: b.y });
        }
      }
    }
  }
}
function nearHillRoad(hill, x, z, r) {
  for (const e of [hill.roadA, hill.roadB, hill.spur]) {
    const p = e.points;
    for (let i = 0; i < p.length; i += 2) if ((p[i].x - x) ** 2 + (p[i].z - z) ** 2 < (r + 3) ** 2) return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------ street props
function edgeAlongBlockSide(C, b, side) {
  // find road edge adjacent to this block side
  const { g } = C;
  const mid = side === 'n' ? [b.cx, b.z0 - 3] : side === 's' ? [b.cx, b.z1 + 3] : side === 'w' ? [b.x0 - 3, b.cz] : [b.x1 + 3, b.cz];
  let best = null, bd = 30;
  for (const e of g.edges) {
    if (e.cls === 'hill') continue;
    const p = e.points, a = p[0], c = p[p.length - 1];
    const horiz = Math.abs(a.z - c.z) < 1;
    if ((side === 'n' || side === 's') !== horiz) continue;
    if (horiz) { if (mid[0] < Math.min(a.x, c.x) || mid[0] > Math.max(a.x, c.x)) continue; const d = Math.abs(mid[1] - a.z); if (d < bd) { bd = d; best = e; } }
    else { if (mid[1] < Math.min(a.z, c.z) || mid[1] > Math.max(a.z, c.z)) continue; const d = Math.abs(mid[0] - a.x); if (d < bd) { bd = d; best = e; } }
  }
  return best;
}
function buildStreetProps(C) {
  const { city, rng, g } = C;
  for (const b of city.blocks) {
    if (b.kind === 'apron' || b.kind === 'pad') continue;
    const d = b.district;
    for (const side of ['n', 's', 'w', 'e']) {
      if (b.kind === 'strip') {
        // only the road-facing side(s)
        if (b.promenade && b.name === 'Shoreline Promenade' && side !== 'e') continue;
        if (b.promenade && b.name === 'Bayfront Promenade' && side !== 'n') continue;
        if (!b.promenade && b.z1 < -640 && side !== 's') continue;
        if (b.name === 'Seawall Walk' && side !== 'w') continue;
      }
      const e = edgeAlongBlockSide(C, b, side);
      if (!e) continue;
      const horiz = side === 'n' || side === 's';
      const a0 = horiz ? b.x0 : b.z0, a1 = horiz ? b.x1 : b.z1;
      const curb = side === 'n' ? b.z0 : side === 's' ? b.z1 : side === 'w' ? b.x0 : b.x1;
      const inward = side === 'n' || side === 'w' ? 1 : -1;
      const pos = (s, off) => horiz ? [s, curb + inward * off] : [curb + inward * off, s];
      const faceRoad = side === 'n' ? Math.PI : side === 's' ? 0 : side === 'w' ? -Math.PI / 2 : Math.PI / 2; // yaw pointing toward road
      const occ = [];
      const free = (s, r) => { for (const [c, rr] of occ) if (Math.abs(c - s) < r + rr) return false; return true; };
      const take = (s, r) => occ.push([s, r]);
      // driveways
      if (b.driveways) for (const dw of b.driveways) if (dw.face === side) take(dw.a, dw.w / 2 + 1);
      const lo = a0 + 8, hi = a1 - 8;
      if (hi - lo < 10) continue;
      // lamps
      const lampSp = 34;
      const nL = Math.max(1, Math.round((hi - lo) / lampSp));
      for (let i = 0; i <= nL; i++) {
        const s = lo + (hi - lo) * i / nL + ((side === 's' || side === 'e') ? lampSp / 2 : 0);
        if (s > hi) continue;
        const [x, z] = pos(s, 0.8);
        addProp(C, 'lamp', x, z, { top: TOP, rot: faceRoad, breakable: true, edge: e.id, variant: d === 'palmshore' || d === 'beach' ? 1 : 0 });
        take(s, 1.5);
      }
      if (b.kind === 'strip' && !b.promenade) continue;
      // trees / palms
      const palmy = d === 'palmshore' || b.promenade;
      const treeSp = palmy ? 16 : d === 'linden' ? 17 : d === 'downtown' ? 22 : d === 'ironworks' || d === 'saltgate' ? 0 : 24;
      if (treeSp) for (let s = lo + 4; s < hi; s += treeSp) {
        if (!free(s, 2.5)) continue;
        const [x, z] = pos(s, palmy ? 1.6 : 1.7);
        addProp(C, palmy ? 'palm' : 'tree', x, z, { top: TOP, variant: rng.int(0, 2), scale: rng.range(0.8, 1.1) * (palmy ? 1 : 0.85), extra: { pit: !palmy && d !== 'linden' } });
        take(s, 2);
      }
      // power poles (suburbs, one side)
      if (d === 'linden' && (side === 'n' || side === 'w')) {
        const group = city.wires.length; const poles = [];
        for (let s = lo; s <= hi; s += 36) {
          const [x, z] = pos(s, 0.5);
          const p = addProp(C, 'powerPole', x, z, { top: TOP, rot: faceRoad, breakable: false });
          poles.push(p);
        }
        if (poles.length > 1) city.wires.push(poles.map(p => ({ x: p.x, y: p.y, z: p.z, rot: p.rot })));
      }
      // hydrant
      if (b.kind !== 'strip' && rng.chance(0.7)) { const s = (lo + hi) / 2 + rng.range(-10, 10); if (free(s, 1.5)) { const [x, z] = pos(s, 0.6); addProp(C, 'hydrant', x, z, { top: TOP, breakable: true }); take(s, 1); } }
      // urban furniture
      if (d === 'downtown' || d === 'oldquarter' || d === 'midtown' || d === 'palmshore' || b.promenade) {
        const n = Math.floor((hi - lo) / 30);
        for (let k = 0; k < n; k++) {
          const s = rng.range(lo, hi);
          if (!free(s, 1.4)) continue;
          const r = rng.next();
          const kind = r < 0.35 ? 'trash' : r < 0.55 ? 'bench' : r < 0.75 ? 'newsbox' : 'planter';
          const [x, z] = pos(s, kind === 'bench' ? 2.8 : 1.0);
          addProp(C, kind, x, z, { top: TOP, rot: kind === 'bench' ? faceRoad + Math.PI : faceRoad, breakable: kind !== 'planter', variant: rng.int(0, 3) });
          take(s, 1.2);
        }
        if (e.parking) for (let s = lo + 3; s < hi; s += 12) { if (!free(s, 0.8)) continue; const [x, z] = pos(s, 0.45); addProp(C, 'meter', x, z, { top: TOP, rot: faceRoad, breakable: true }); take(s, 0.5); }
      }
      // bus stops on avenues/boulevards
      if ((e.cls === 'avenue' || e.cls === 'boulevard' || e.cls === 'coastal') && b.kind === 'city' && rng.chance(0.3)) {
        const s = (lo + hi) / 2;
        if (free(s, 5)) { const [x, z] = pos(s, 2.6); addProp(C, 'busStop', x, z, { top: TOP, rot: faceRoad + Math.PI, variant: rng.int(0, 9) }); take(s, 4.5); }
      }
    }
  }
  // traffic lights at signalized nodes
  const d = { x: 0, z: 0 };
  for (const n of g.nodes) {
    if (!n.signal) continue;
    for (const eid of n.edges) {
      const e = g.edges[eid];
      dirFromNode(e, n.id, d); // pointing away from node along edge; incoming traffic travels -d
      const cut = e.a === n.id ? e.cutA : e.cutB;
      const inX = -d.x, inZ = -d.z; // travel direction of incoming traffic
      const rx = -inZ, rz = inX;      // right of travel
      const x = n.x + d.x * (cut + 0.5) + rx * (e.width / 2 + 0.7), z = n.z + d.z * (cut + 0.5) + rz * (e.width / 2 + 0.7);
      const lanes = e.a === n.id ? e.lanesBack : e.lanesFwd;
      addProp(C, 'trafficLight', x, z, { top: TOP, rot: Math.atan2(inX, inZ), node: n.id, edge: eid, extra: { arm: e.median / 2 + lanes * LANE_W + 0.5, lanes, median: e.median } });
    }
  }
  // median palms on boulevards
  for (const e of g.edges) {
    if (e.cls !== 'boulevard') continue;
    const p = e.points, a = p[0], c = p[p.length - 1], L = e.length;
    const dx = (c.x - a.x) / L, dz = (c.z - a.z) / L;
    for (let s = e.cutA + 8; s < L - e.cutB - 6; s += 13) addProp(C, 'palm', a.x + dx * s, a.z + dz * s, { top: TOP, variant: rng.int(0, 2), scale: rng.range(0.95, 1.2), extra: { median: true } });
  }
  // roadside billboards in ironworks / along hill road bottom
  for (const b of city.blocks) {
    if (b.district !== 'ironworks' || b.kind !== 'city' || !rng.chance(0.4)) continue;
    addProp(C, 'billboard', b.x0 + 12, b.z0 + 8, { top: TOP, rot: Math.PI, variant: rng.int(0, 9) });
  }
}

// ------------------------------------------------------------------------------------------ parking
function buildParking(C) {
  const { city, g } = C;
  for (const e of g.edges) {
    if (!e.parking) continue;
    const p = e.points, a = p[0], c = p[p.length - 1], L = e.length;
    const dx = (c.x - a.x) / L, dz = (c.z - a.z) / L;
    const off = LANE_W + 1.25;
    for (let s = e.cutA + 7; s < L - e.cutB - 7; s += 6.2) {
      for (const side of [1, -1]) {
        // side 1: right of a->b travel, facing a->b ; side -1: right of b->a travel
        const tx = side * dx, tz = side * dz; const rx = -tz, rz = tx;
        const x = a.x + dx * s + rx * off, z = a.z + dz * s + rz * off;
        city.parking.push({ x, y: 0, z, yaw: Math.atan2(tx, tz), kind: 'street', district: districtOf(x, z), edge: e.id });
      }
    }
  }
  // surface lots with stalls
  for (const b of city.blocks) for (const l of b.lots) {
    if (!l.stalls) continue;
    city.areas.lots.push(rectPoly(l));
    const W = l.x1 - l.x0, D = l.z1 - l.z0;
    if (b.lotStalls) continue; // handled by special
    const alongX = W >= D;
    const rows = Math.floor((alongX ? D : W) / 11);
    for (let r = 0; r < rows; r++) {
      const c = (alongX ? l.z0 : l.x0) + 5.5 + r * 11;
      for (let s = (alongX ? l.x0 : l.z0) + 2; s < (alongX ? l.x1 : l.z1) - 2; s += 2.9) {
        const x = alongX ? s : c, z = alongX ? c : s;
        city.parking.push({ x, y: b.top, z, yaw: alongX ? (r % 2 ? 0 : Math.PI) : (r % 2 ? Math.PI / 2 : -Math.PI / 2), kind: 'lot', district: b.district });
      }
    }
  }
}

// ------------------------------------------------------------------------------------------ sidewalks graph
function buildSidewalkGraph(C) {
  const { city, g } = C;
  const SWG = city.sidewalks, keyMap = new Map();
  const K = (x, z) => Math.round(x * 2) + ',' + Math.round(z * 2);
  const node = (x, y, z) => { const k = K(x, z); let n = keyMap.get(k); if (n != null) return n; n = SWG.nodes.length; SWG.nodes.push({ id: n, x, y, z }); SWG.adj.push([]); keyMap.set(k, n); return n; };
  const link = (a, b, kind = 'walk', extra = {}) => { if (a === b) return; const id = SWG.links.length; SWG.links.push({ id, a, b, kind, ...extra }); SWG.adj[a].push(id); SWG.adj[b].push(id); };
  const ring = (r, y) => {
    const pts = [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]];
    let prev = null, first = null;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % 4];
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 22));
      for (let k = 0; k < n; k++) {
        const id = node(ax + (bx - ax) * k / n, y, az + (bz - az) * k / n);
        if (prev != null) link(prev, id); else first = id;
        prev = id;
      }
    }
    link(prev, first);
  };
  for (const b of city.blocks) {
    if (b.kind === 'apron' || b.kind === 'pad') continue;
    if (b.kind === 'strip') {
      const W = b.x1 - b.x0, D = b.z1 - b.z0;
      // walking line 2.5 m from the road side
      let ax, az, bx, bz;
      if (b.name === 'Shoreline Promenade') { ax = bx = b.x1 - 2.5; az = b.z0 + 2.5; bz = b.z1 - 2.5; }
      else if (b.name === 'Bayfront Promenade') { az = bz = b.z0 + 2.5; ax = b.x0 + 2.5; bx = b.x1 - 2.5; }
      else if (b.name === 'Seawall Walk') { ax = bx = b.x0 + 2.5; az = b.z0 + 2.5; bz = b.z1 - 2.5; }
      else { az = bz = b.z1 - 2.5; ax = b.x0 + 2.5; bx = b.x1 - 2.5; }
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 22));
      let prev = null;
      for (let k = 0; k <= n; k++) { const id = node(ax + (bx - ax) * k / n, TOP, az + (bz - az) * k / n); if (prev != null) link(prev, id); prev = id; }
      continue;
    }
    ring(inset(b, 2.5), b.top);
    if (b.kind === 'park' && b.parkPaths) {
      const { cx, cz } = b.parkPaths;
      const n1 = node(cx, b.top, b.z0 + 2.5), n2 = node(cx, b.top, b.z1 - 2.5), n3 = node(b.x0 + 2.5, b.top, cz), n4 = node(b.x1 - 2.5, b.top, cz), c = node(cx, b.top, cz);
      link(n1, c); link(c, n2); link(n3, c); link(c, n4);
    }
  }
  // crosswalks at grid junctions
  const d = { x: 0, z: 0 };
  for (const n of g.nodes) {
    if (!n.grid) continue;
    for (const eid of n.edges) {
      const e = g.edges[eid];
      if (e.cls === 'hill') {
        // crosswalk across the hill road mouth
      }
      dirFromNode(e, n.id, d);
      const ch = n.crossHalf[eid] || 0;
      if (ch <= 0) continue;
      const s = ch + 2.5, rx = -d.z, rz = d.x, hw = e.width / 2 + 2.5;
      const ax = n.x + d.x * s + rx * hw, az = n.z + d.z * s + rz * hw, bx = n.x + d.x * s - rx * hw, bz = n.z + d.z * s - rz * hw;
      const ka = keyMap.get(K(ax, az)), kb = keyMap.get(K(bx, bz));
      const na = ka != null ? ka : nearestSW(SWG, ax, az, 3.2), nb = kb != null ? kb : nearestSW(SWG, bx, bz, 3.2);
      if (na != null && nb != null && na !== nb) link(na, nb, 'crosswalk', { node: n.id, edge: eid, signal: !!n.signal });
    }
  }
  // pier + beach paths
  const pier = city.areas.pier;
  const p0 = nearestSW(SWG, -912.5, pier.z, 30);
  let prev = node(-926, 0.9, pier.z); if (p0 != null) link(p0, prev);
  for (let x = -940; x >= -1180; x -= 20) { const id = node(x, pier.y, pier.z); link(prev, id); prev = id; }
  // beach walk line along the sand
  prev = null;
  for (let z = -600; z <= 600; z += 25) {
    if (Math.abs(z - pier.z) < 12) continue;
    const x = -940 + Math.sin(z * 0.02) * 6;
    const id = node(x, C.city.terrain.heightAt(x, z), z);
    if (prev != null) link(prev, id); prev = id;
    if (((z + 600) / 25) % 4 === 0) { const pn = nearestSW(SWG, -912.5, z, 14); if (pn != null) link(pn, id); }
  }
  SWG.index = buildSWIndex(SWG);
}
function buildSWIndex(SWG) {
  const cell = 24, map = new Map();
  for (const n of SWG.nodes) { const k = Math.floor(n.x / cell) * 100003 + Math.floor(n.z / cell); let a = map.get(k); if (!a) map.set(k, a = []); a.push(n.id); }
  return { cell, map };
}
function nearestSW(SWG, x, z, maxD = 60) {
  let best = null, bd = maxD * maxD;
  if (SWG.index) {
    const { cell, map } = SWG.index, r = Math.ceil(maxD / cell);
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let ox = -r; ox <= r; ox++) for (let oz = -r; oz <= r; oz++) {
      const a = map.get((cx + ox) * 100003 + cz + oz); if (!a) continue;
      for (const id of a) { const n = SWG.nodes[id], d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = id; } }
    }
    return best;
  }
  for (const n of SWG.nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n.id; } }
  return best;
}

// ------------------------------------------------------------------------------------------ ramps
function buildRamps(C) {
  const { city, terrain } = C;
  const add = (x, z, yaw, len, width, height, landing, name, base) => {
    const y = base ?? terrain.heightAt(x, z);
    city.ramps.push({ id: city.ramps.length, x, y, z, yaw, length: len, width, height, landing, name });
    // clear props near the ramp and in the approach corridor
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    city.props = city.props.filter(p => {
      const dx = p.x - x, dz = p.z - z;
      const along = dx * fx + dz * fz, lat = Math.abs(-dx * fz + dz * fx);
      if (p.kind === 'container' || p.kind === 'fountain' || p.kind === 'lighthouse' || p.kind === 'crane') return true;
      return !(along > -90 && along < 45 && lat < width / 2 + 2.5);
    });
  };
  const pier = city.areas.pier;
  add(-962, 96, Math.PI, 11, 6, 3.2, { x: -962, z: 5, r: 18 }, 'Pier Leap');
  add(-300, 176, 0, 11, 6, 3.0, { x: -300, z: 270, r: 22 }, 'Fountain Flyer', TOP);
  add(610, 700, Math.PI / 2, 11, 6, 3.4, { x: 700, z: 700, r: 18 }, 'Box Hop', 0);
  // Harbor Boulevard plaza (plaza2) jump over the fountain
  const pl = city.blocks.find(b => b.special === 'plaza2');
  if (pl && pl.plaza) add(pl.plaza.cx, pl.plaza.r.z0 + 12, 0, 10, 5.5, 2.8, { x: pl.plaza.cx, z: pl.plaza.cz + 26, r: 16 }, 'Plaza Pop', TOP);
  const ls = city.blocks.find(b => b.special === 'lanternSquare');
  if (ls && ls.plaza) add(ls.plaza.cx, ls.plaza.r.z1 - 12, Math.PI, 10, 5.5, 2.8, { x: ls.plaza.cx, z: ls.plaza.cz - 26, r: 16 }, 'Lantern Launch', TOP);
  // beach north run
  add(-975, -300, Math.PI, 11, 6, 3.4, { x: -975, z: -372, r: 22 }, 'Sandblaster');
  // docks yard (block z 352..600, x 780..900) run south over containers is too tight; use apron west part
  add(430, 700, Math.PI / 2, 10, 6, 3.0, { x: 500, z: 700, r: 16 }, 'Quay Skip', 0);
  // hill: Crestline road switchback shortcut
  const A = C.hill.roadA.points, cum = cumulative(A), o = {};
  samplePath(A, cum, cum[cum.length - 1] * 0.555, o);
  const yaw = Math.atan2(o.dx, o.dz);
  add(o.x + (-o.dz) * 0, o.z, yaw, 10, 5.5, 2.4, { x: o.x + o.dx * 55, z: o.z + o.dz * 55, r: 24 }, 'Crestline Drop', o.y);
  city.ramps[city.ramps.length - 1].onRoad = true;
}

// ------------------------------------------------------------------------------------------ POIs
function buildPOIs(C) {
  const { city, g } = C;
  const P = city.poi;
  P.contacts = P.contacts || {};
  if (P.club) P.contacts.marisol = { ...P.club, name: 'Marisol' };
  // race starts
  const n = (x, z) => g.nodes.reduce((best, nd) => (Math.hypot(nd.x - x, nd.z - z) < Math.hypot(best.x - x, best.z - z) ? nd : best), g.nodes[0]);
  P.raceStarts = [
    { id: 'downtown', name: 'Glass Canyon Loop', x: 120, y: 0, z: -20 - 5.25, yaw: Math.PI / 2 },
    { id: 'coastal', name: 'Shoreline Sprint', x: -900 + 5.5, y: 0, z: 520, yaw: Math.PI },
    { id: 'hill', name: 'Crestline Climb', x: -60 + 2, y: 0, z: -600, yaw: Math.PI },
  ];
}

// ------------------------------------------------------------------------------------------ collision
function populateCollision(C) {
  const { city } = C;
  const W = city.collision;
  for (const b of city.blocks) {
    if (b.kind === 'apron') continue;
    if (b.kind === 'pad') continue;
    b.collider = W.addBox({ cx: b.cx, cz: b.cz, hx: (b.x1 - b.x0) / 2, hz: (b.z1 - b.z0) / 2, minY: -2, maxY: b.top, tag: 'curb', data: { surface: 'sidewalk', block: b.id } });
  }
  for (const bl of city.buildings) {
    bl.colliders = [];
    for (const p of bl.parts) {
      if (p.open === 'roof') { bl.colliders.push(W.addBox({ cx: (p.x0 + p.x1) / 2, cz: (p.z0 + p.z1) / 2, hx: (p.x1 - p.x0) / 2, hz: (p.z1 - p.z0) / 2, minY: p.y0, maxY: p.y1, tag: 'building', data: { building: bl.id, surface: 'concrete' } })); continue; }
      const top = p.y1 + (p.roof === 'gable' || p.roof === 'hip' ? p.roofH * 0.6 : 0);
      bl.colliders.push(W.addBox({ cx: (p.x0 + p.x1) / 2, cz: (p.z0 + p.z1) / 2, hx: (p.x1 - p.x0) / 2, hz: (p.z1 - p.z0) / 2, minY: p.y0 - 0.5, maxY: top, tag: 'building', data: { building: bl.id, surface: 'concrete' } }));
    }
  }
  const pier = city.areas.pier;
  if (pier) {
    const y = pier.y;
    W.addRamp({ cx: (pier.x1 + pier.rampEnd) / 2, cz: pier.z, hx: pier.w / 2, hz: (pier.x1 - pier.rampEnd) / 2, rot: -Math.PI / 2, y0: TOP, y1: y, base: -1, tag: 'pier', data: { surface: 'wood' } });
    W.addBox({ cx: (pier.rampEnd + pier.x0) / 2, cz: pier.z, hx: (pier.rampEnd - pier.x0) / 2, hz: pier.w / 2, minY: y - 0.5, maxY: y, tag: 'pier', data: { surface: 'wood' } });
    const h = pier.head;
    W.addBox({ cx: (h.x0 + h.x1) / 2, cz: (h.z0 + h.z1) / 2, hx: (h.x1 - h.x0) / 2, hz: (h.z1 - h.z0) / 2, minY: y - 0.5, maxY: y, tag: 'pier', data: { surface: 'wood' } });
    // railings
    const rail = (x0, z0, x1, z1) => { const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, len = Math.hypot(x1 - x0, z1 - z0); W.addBox({ cx, cz, hx: 0.08, hz: len / 2, rot: Math.atan2(x1 - x0, z1 - z0), minY: y, maxY: y + 1.1, tag: 'rail' }); };
    rail(pier.rampEnd, pier.z - pier.w / 2 + 0.1, h.x1, pier.z - pier.w / 2 + 0.1); rail(pier.rampEnd, pier.z + pier.w / 2 - 0.1, h.x1, pier.z + pier.w / 2 - 0.1);
    rail(h.x1, h.z0 + 0.1, h.x1, pier.z - pier.w / 2); rail(h.x1, pier.z + pier.w / 2, h.x1, h.z1 - 0.1);
    rail(h.x0 + 0.1, h.z0, h.x0 + 0.1, h.z1); rail(h.x0, h.z0 + 0.1, h.x1, h.z0 + 0.1); rail(h.x0, h.z1 - 0.1, h.x1, h.z1 - 0.1);
    for (let x = pier.rampEnd - 4; x > h.x0; x -= 8) for (const s of [-1, 1]) W.addCylinder({ x, z: pier.z + s * (pier.w / 2 - 0.5), r: 0.3, minY: -14, maxY: y - 0.5, tag: 'piling' });
  }
  for (const r of city.ramps) {
    const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw);
    r.collider = W.addRamp({ cx: r.x, cz: r.z, hx: r.width / 2, hz: r.length / 2, rot: r.yaw, y0: r.y, y1: r.y + r.height, base: r.y - 1, tag: 'ramp', data: { surface: 'wood', ramp: r.id } });
  }
  // props
  const cyl = { lamp: [0.14, 6], parkLamp: [0.1, 4], trafficLight: [0.18, 6], palm: [0.25, 6], tree: [0.3, 5], pine: [0.35, 6], hydrant: [0.22, 0.8], trash: [0.3, 1.0],
    powerPole: [0.16, 9], meter: [0.08, 1.3], bollard: [0.13, 0.9], bollardQuay: [0.25, 0.8], chimney: [1.2, 30], lighthouse: [3.2, 22], radioTower: [4, 64], pierLamp: [0.1, 4],
    mailbox: [0.25, 1.2], planter: [0.7, 0.8], fountain: [3.8, 2.2], umbrella: [0.06, 2.3], binoculars: [0.2, 1.3], rock: [1.2, 1.2] };
  const box = { bench: [0.9, 0.3, 0.9], newsbox: [0.3, 0.3, 1.1], busStop: [2.2, 0.8, 2.6], dumpster: [1.0, 0.8, 1.4], container: [1.22, 6.05, 2.6], billboard: [6, 0.3, 11],
    lifeguard: [1.3, 1.3, 3.8], wreck: [0.95, 2.2, 1.3], crane: [11, 3, 42] };
  for (let i = 0; i < city.props.length; i++) {
    const p = city.props[i], k = p.kind;
    let id = -1;
    if (k === 'fence') { id = W.addBox({ cx: p.x, cz: p.z, hx: 0.06, hz: p.len / 2, rot: p.rot, minY: p.y, maxY: p.y + (p.h || 1.6), tag: 'fence', data: { prop: i } }); }
    else if (k === 'guardrail') { id = W.addBox({ cx: p.x, cz: p.z, hx: 0.12, hz: p.len / 2 + 0.2, rot: p.rot, minY: Math.min(p.y0, p.y1) - 0.5, maxY: Math.max(p.y0, p.y1) + 0.8, tag: 'rail', data: { prop: i } }); }
    else if (cyl[k]) {
      const [r, h] = cyl[k];
      const s = p.scale || 1;
      const hh = p.h || h * s;
      if (k === 'fountain') id = W.addCylinder({ x: p.x, z: p.z, r: r * s, minY: p.y - 1, maxY: p.y + 0.7, tag: 'prop', data: { prop: i, surface: 'concrete' } });
      else id = W.addCylinder({ x: p.x, z: p.z, r: r * (k === 'rock' ? s : 1), minY: p.y - 0.5, maxY: p.y + hh, tag: p.breakable ? 'breakable' : 'prop', data: { prop: i } });
    } else if (box[k]) {
      let [hx, hz, h] = box[k];
      if (k === 'container') { h = 2.6 * ((p.extra && p.extra.stack) || 1); }
      if (k === 'wreck') h = 1.3 * ((p.extra && p.extra.stack) || 1);
      if (k === 'crane') {
        // two legs rows (crane spans along x=rot 0: legs at +-hx)
        if (p.extra && p.extra.small) { id = W.addCylinder({ x: p.x, z: p.z, r: 1.5, minY: p.y, maxY: p.y + 18, tag: 'prop', data: { prop: i } }); }
        else for (const sx of [-1, 1]) for (const sz of [-1, 1]) W.addBox({ cx: p.x + sx * 8, cz: p.z + sz * 9, hx: 0.8, hz: 0.8, minY: p.y, maxY: p.y + 40, tag: 'prop', data: { prop: i } });
        p.collider = id; continue;
      }
      const yOff = k === 'billboard' && p.extra && p.extra.roof ? 0 : 0;
      id = W.addBox({ cx: p.x, cz: p.z, hx, hz, rot: p.rot, minY: p.y - 0.3 + yOff, maxY: p.y + h, tag: p.breakable ? 'breakable' : (k === 'container' ? 'container' : 'prop'), data: { prop: i, surface: k === 'container' ? 'metal' : 'concrete' } });
      if (k === 'billboard') { W.setEnabled(id, true); }
    }
    p.collider = id;
  }
}

// ------------------------------------------------------------------------------------------ collectibles
function buildCollectibles(C) {
  const { city, rng, terrain } = C;
  const W = city.collision;
  const out = [];
  const tmp = [];
  const ok = (x, z, y) => {
    const n = W.collideCircle(x, z, 0.6, y + 0.3, y + 1.8, tmp);
    for (let i = 0; i < n; i++) if (tmp[i].tag !== 'curb') return false;
    return !terrain.isWater(x, z) || y > 0.5;
  };
  const add = (x, z, yOverride) => {
    const y = yOverride ?? W.groundHeight(x, z, 200, 0);
    if (ok(x, z, y)) { out.push({ x, y: y + 0.9, z }); return true; } return false;
  };
  add(-1188, 50, 1.8); add(-990, 40); add(city.poi.lookout.x - 20, city.poi.lookout.z + 10); add(city.poi.radioTower.x + 8, city.poi.radioTower.z + 6);
  add(-1000, -560); add(-992, 560);
  // courtyards and backyards per district
  const byD = {};
  for (const b of city.blocks) for (const l of b.lots) {
    if (b.kind !== 'city' && b.kind !== 'park') continue;
    (byD[b.district] || (byD[b.district] = [])).push({ b, l });
  }
  const quota = { downtown: 3, oldquarter: 4, palmshore: 3, linden: 4, midtown: 3, ironworks: 3, saltgate: 2 };
  for (const [d, q] of Object.entries(quota)) {
    const arr = byD[d] || []; let got = 0, tries = 0;
    while (got < q && tries++ < 400 && arr.length) {
      const { b, l } = arr[rng.int(0, arr.length - 1)];
      const x = rng.range(l.x0 + 1, l.x1 - 1), z = rng.range(l.z0 + 1, l.z1 - 1);
      if (out.some(o => Math.hypot(o.x - x, o.z - z) < 150)) continue;
      if (add(x, z)) got++;
    }
  }
  // hills
  let tries = 0;
  while (out.length < 30 && tries++ < 2000) {
    const x = rng.range(-900, 900), z = rng.range(-1250, -760);
    const h = terrain.heightAt(x, z); if (h < 2) continue;
    if (out.some(o => Math.hypot(o.x - x, o.z - z) < 160)) continue;
    add(x, z);
  }
  city.poi.collectibles = out.slice(0, 30);
}

// ------------------------------------------------------------------------------------------ map data
function buildMapData(C) {
  const { city, g, terrain } = C;
  const roads = g.edges.map(e => ({ pts: e.points.map(p => [p.x, p.z]), width: e.width, kind: e.cls, name: e.name }));
  const districts = [
    { id: 'palmshore', name: 'Palm Shore', kind: 'palmshore', poly: [[-1010, -640], [-780, -640], [-780, -144], [-600, -144], [-600, 632], [-1010, 632]] },
    { id: 'linden', name: 'Linden Grove', kind: 'linden', poly: [[-780, -640], [-240, -640], [-240, -144], [-780, -144]] },
    { id: 'oldquarter', name: 'Old Quarter', kind: 'oldquarter', poly: [[-600, -144], [-120, -144], [-120, 352], [60, 352], [60, 632], [-600, 632]] },
    { id: 'downtown', name: 'Downtown', kind: 'downtown', poly: [[-120, -144], [480, -144], [480, 352], [-120, 352]] },
    { id: 'midtown', name: 'Midtown', kind: 'midtown', poly: [[-240, -640], [480, -640], [480, -144], [-240, -144]] },
    { id: 'midtown2', name: 'Midtown', kind: 'midtown', poly: [[60, 352], [400, 352], [400, 632], [60, 632]] },
    { id: 'ironworks', name: 'Ironworks', kind: 'ironworks', poly: [[480, -652], [934, -652], [934, 352], [480, 352]] },
    { id: 'saltgate', name: 'Saltgate Docks', kind: 'saltgate', poly: [[400, 352], [934, 352], [934, 792], [400, 792]] },
    { id: 'crestline', name: 'Crestline Hills', kind: 'crestline', poly: [[-1040, -660], [1000, -660], [1000, -1390], [-1040, -1390]] },
  ];
  city.districts = districts;
  const labels = [
    { name: 'DOWNTOWN', x: 180, z: 100, size: 3 }, { name: 'OLD QUARTER', x: -360, z: 480, size: 2 }, { name: 'PALM SHORE', x: -760, z: 150, size: 2 },
    { name: 'LINDEN GROVE', x: -520, z: -400, size: 2 }, { name: 'MIDTOWN', x: 120, z: -400, size: 2 }, { name: 'IRONWORKS', x: 720, z: -150, size: 2 },
    { name: 'SALTGATE DOCKS', x: 680, z: 560, size: 2 }, { name: 'CRESTLINE HILLS', x: 150, z: -960, size: 3 },
    { name: 'Sol Pier', x: -1080, z: 70, size: 1 }, { name: 'Castell Park', x: -300, z: 228, size: 1 }, { name: 'Solstice Tower', x: 120, z: 70, size: 1 },
    { name: 'Crestline Lookout', x: city.poi.lookout.x, z: city.poi.lookout.z + 30, size: 1 }, { name: 'Palm Shore Beach', x: -965, z: -240, size: 1 },
  ];
  return {
    bounds: { minX: -1400, maxX: 1300, minZ: -1500, maxZ: 1000 },
    land: [terrain.coastline.map(p => [p[0], p[1]])],
    districts, parks: city.areas.parks, beaches: city.areas.beaches, plazas: city.areas.plazas, lots: city.areas.lots, port: city.areas.port,
    blocks: city.blocks.filter(b => b.kind !== 'pad').map(b => ({ poly: b.poly, kind: b.kind })),
    buildings: city.buildings.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, h: b.h, kind: b.kind })),
    roads, labels, pier: city.areas.pier, heightAt: (x, z) => terrain.heightAt(x, z), waterLevel: WATER_LEVEL,
  };
}
