// Loads the baked human meshes: base64 -> inflate -> decode -> BufferGeometry, grouped per model with
// LOD chains and accessory overlays, ready for HumanRenderer.addModel().
import * as THREE from 'three';
import { inflateSync } from 'fflate';
import { HUMANS_MANIFEST, HUMANS_DATA } from '../generated/humans.bin.js';
import { decodeGeometry } from './humanCodec.js';
import { CATALOG } from './humanCatalog.js';
import { bindPose } from './character.js';

function fromBase64(s) {
  const bin = atob(s), n = bin.length, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Returns { key: { lods: [BufferGeometry], lodDist, shadowLod, overlays: { name: [BufferGeometry] } } }. */
export function loadHumanModels() {
  const t0 = performance.now();
  const raw = inflateSync(fromBase64(HUMANS_DATA));
  const binds = new Map();
  const bindFor = (sp) => {
    const key = `${sp.k}|${sp.w}|${!!sp.fem}`;
    let b = binds.get(key);
    if (!b) { const W = bindPose(sp.k ?? 1, sp.w ?? 1, !!sp.fem); b = { W, inv: W.map(m => m.clone().invert()) }; binds.set(key, b); }
    return b;
  };
  const models = {};
  let tris = 0;
  for (const e of HUMANS_MANIFEST) {
    const cat = CATALOG[e.model];
    const d = decodeGeometry(raw, e.offset);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3, true));
    g.setAttribute('aSkin', new THREE.BufferAttribute(d.aSkin, 4));
    g.setAttribute('aW', new THREE.BufferAttribute(d.aW, 4, true));
    g.setAttribute('aRegion', new THREE.BufferAttribute(d.aRegion, 1));
    g.setAttribute('aSway', new THREE.BufferAttribute(d.aSway, 1, true));
    g.setAttribute('aAO', new THREE.BufferAttribute(d.aAO, 1, true));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    const spec = cat.spec, b = bindFor(spec);
    g.userData = { spec, bind: b.W, inv: b.inv, tris: d.ni / 3, verts: d.nv };
    tris += d.ni / 3;
    const m = models[e.model] || (models[e.model] = { lods: [], lodDist: cat.lodDist, shadowLod: cat.shadowLod, overlays: {} });
    if (e.kind === 'lod') m.lods[e.lod] = g;
    else (m.overlays[e.name] || (m.overlays[e.name] = []))[e.lod] = g;
  }
  for (const [key, cat] of Object.entries(CATALOG)) if (cat.overlaysFrom && models[key] && models[cat.overlaysFrom]) models[key].overlays = models[cat.overlaysFrom].overlays;
  console.log(`[humans] ${HUMANS_MANIFEST.length} meshes, ${Math.round(tris / 1000)}k tris decoded in ${Math.round(performance.now() - t0)} ms`);
  return models;
}
