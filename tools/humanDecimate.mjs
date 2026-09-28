// Node-only: simplify a built human mesh per part (body / head / hands) with meshoptimizer, keeping every
// border fixed (material seams and patch edges), then reorder for the vertex cache and compact.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { MeshoptSimplifier, MeshoptEncoder } = require('meshoptimizer');
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;

// [ratio, relative error] per part for each LOD; overlays use `ov`
const PLAN = {
  0: { 0: [0.26, 0.0011], 1: [0.4, 0.00035], 2: [0.4, 0.0005] },
  1: { 0: [0.45, 0.0028] },
  2: { 0: [0.55, 0.005] },
  ov0: { 0: [0.3, 0.0012] },
  ov1: { 0: [0.5, 0.003] },
};

export function decimateHuman(g, spec) {
  const P = g.attributes.position.array, I = g.index.array, part = g.userData.triPart;
  const plan = spec.only ? PLAN['ov' + (spec.lod ?? 0)] || PLAN.ov1 : PLAN[spec.lod ?? 0] || PLAN[2];
  const out = [];
  for (const [pid, [ratio, err]] of Object.entries(plan)) {
    const sub = [];
    for (let f = 0; f < part.length; f++) if (part[f] === +pid) sub.push(I[f * 3], I[f * 3 + 1], I[f * 3 + 2]);
    if (!sub.length) continue;
    const idx = new Uint32Array(sub);
    const target = Math.max(3, Math.floor(idx.length * ratio / 3) * 3);
    const [res] = MeshoptSimplifier.simplify(idx, P, 3, target, err, ['LockBorder', 'Sparse']);
    for (const v of res) out.push(v);
  }
  // parts the plan does not mention stay as they are
  const planned = new Set(Object.keys(plan).map(Number));
  for (let f = 0; f < part.length; f++) if (!planned.has(part[f])) out.push(I[f * 3], I[f * 3 + 1], I[f * 3 + 2]);
  // vertex cache + fetch order, then compact every attribute
  const idx = new Uint32Array(out);
  const [remap, unique] = MeshoptEncoder.reorderMesh(idx, true, false);
  const pick = (arr, n) => { const o = new arr.constructor(unique * n); for (let v = 0; v < remap.length; v++) { const r = remap[v]; if (r !== 0xffffffff) for (let c = 0; c < n; c++) o[r * n + c] = arr[v * n + c]; } return o; };
  const A = g.attributes;
  return {
    index: { array: idx }, // reorderMesh rewrote it in place
    attributes: {
      position: { array: pick(A.position.array, 3) }, normal: { array: pick(A.normal.array, 3) }, aSkin: { array: pick(A.aSkin.array, 4) }, aW: { array: pick(A.aW.array, 4) },
      aRegion: { array: pick(A.aRegion.array, 1) }, aSway: { array: pick(A.aSway.array, 1) }, aAO: { array: pick(A.aAO.array, 1) },
    },
    tris: idx.length / 3, verts: unique,
  };
}
