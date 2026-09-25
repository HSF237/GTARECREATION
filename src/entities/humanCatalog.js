// The cast of baked human meshes: the player, the three contacts, generic crowd bases and the
// accessory overlays the crowd mixes and matches (all original designs).
const M = { fem: false, k: 1, w: 1, muscle: 0.45, fat: 0.25, hair: 'short', outfit: { top: 'tee', pants: 'jeans' }, shoe: 'sneaker' };
const F = { fem: true, k: 0.94, w: 0.95, muscle: 0.3, fat: 0.25, hair: 'short', outfit: { top: 'tee', pants: 'jeans' }, shoe: 'sneaker' };
const suit = { top: 'tee', vneck: true, tuck: true, jacket: 'blazer', jacketOpen: true, pants: 'slacks', belt: true };

const NPC = [{ lod: 0, hBody: 0.013, hHead: 0.0046, hHand: 0.0042 }, { lod: 1 }, { lod: 2 }];
const HERO = [{ lod: 0 }, { lod: 1 }, { lod: 2 }];
const CONTACT = [{ lod: 0, hBody: 0.0105, hHead: 0.0038, hHand: 0.0034 }, { lod: 1 }, { lod: 2 }];
const OV = [{ lod: 0 }, { lod: 1 }];

const hats = { cap: { only: 'hat', hat: 'cap' }, police: { only: 'hat', hat: 'police' }, hard: { only: 'hat', hat: 'hard' }, helmet: { only: 'hat', hat: 'helmet' }, vest: { only: 'vest' } };

export const CATALOG = {
  player: {
    spec: { fem: false, k: 1, w: 1.05, muscle: 0.7, hair: 'fade', beard: 'full', outfit: { top: 'tee', jacket: 'bomber', jacketOpen: true, pants: 'jeans', belt: true }, shoe: 'sneaker' },
    lods: HERO, lodDist: [30, 90], shadowLod: 1,
  },
  M: { spec: M, lods: NPC, lodDist: [7, 26], shadowLod: 2, overlays: { ...hats, curly: { only: 'hair', hair: 'curly' } } },
  F: { spec: F, lods: NPC, lodDist: [7, 26], shadowLod: 2, overlays: { ...hats, long: { only: 'hair', hair: 'long' }, ponytail: { only: 'hair', hair: 'ponytail' }, bun: { only: 'hair', hair: 'bun' }, curly: { only: 'hair', hair: 'curly' } } },
  Msuit: { spec: { ...M, outfit: suit, shoe: 'dress' }, lods: NPC, lodDist: [7, 26], shadowLod: 2, overlaysFrom: 'M' },
  Fsuit: { spec: { ...F, outfit: { ...suit, belt: false }, shoe: 'dress' }, lods: NPC, lodDist: [7, 26], shadowLod: 2, overlaysFrom: 'F' },
  // mission contacts (proportions match their rigs exactly)
  inez: {
    spec: { fem: true, k: 1.72 / 1.8, w: 0.98, muscle: 0.35, fat: 0.2, hair: 'ponytail', outfit: { top: 'tee', jacket: 'leather', jacketOpen: true, pants: 'jeans' }, shoe: 'boot' },
    lods: CONTACT, lodDist: [12, 30], shadowLod: 2,
  },
  otis: {
    spec: { fem: false, k: 1.9 / 1.8, w: 1.16, muscle: 0.8, fat: 0.4, hair: 'short', beard: 'full', hat: 'cap', outfit: { top: 'tee', pants: 'slacks', belt: true }, shoe: 'boot' },
    lods: CONTACT, lodDist: [12, 30], shadowLod: 2,
  },
  marisol: {
    spec: { fem: true, k: 1.68 / 1.8, w: 0.95, muscle: 0.3, fat: 0.2, hair: 'bun', outfit: { ...suit, belt: false }, shoe: 'dress' },
    lods: CONTACT, lodDist: [12, 30], shadowLod: 2,
  },
};

/** Flat list of every geometry to bake: { id, model, kind: 'lod'|'ov', name, lod, spec }. */
export function bakeList() {
  const out = [];
  for (const [key, m] of Object.entries(CATALOG)) {
    m.lods.forEach((l, i) => out.push({ id: `${key}/lod${i}`, model: key, kind: 'lod', lod: i, spec: { ...m.spec, ...l } }));
    for (const [name, patch] of Object.entries(m.overlays || {})) OV.forEach((l, i) => out.push({ id: `${key}/${name}${i}`, model: key, kind: 'ov', name, lod: i, spec: { ...m.spec, ...patch, ...l } }));
  }
  return out;
}
