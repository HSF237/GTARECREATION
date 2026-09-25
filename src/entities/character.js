// Characters: procedural rig + animation + verlet ragdoll + instanced rendering.
//   const app = randomAppearance(rng, { role })           // 'civilian'|'beach'|'business'|'worker'|'police'|'swat'|'gang'|'player'
//   const rig = new CharacterRig(app)                      // rig.root: {position: Vector3, yaw}
//   rig.update(dt, state)  state: { speed, localVel:{x,z}, grounded, vy, aim, aimPitch, weapon, fire, punch, mode, turnRate }
//   rig.startRagdoll(vel, { groundFn(x,z,y)->h, collideFn(p, r) }) ; rig.ragdoll ; rig.ragdollSettled ; rig.stopRagdoll()
//   rig.getHitSpheres(out) -> count ; rig.handWorld(out, right=true) ; rig.muzzle(outPos, outDir)
//   const crowd = new CrowdRenderer(scene, max) ; crowd.render(rigs) each frame
import * as THREE from 'three';
import { clamp, lerp, damp, TAU } from '../core/math.js';

// ---------------------------------------------------------------- skeleton
// joints: 0 root,1 pelvis,2 torso,3 head,4 uArmL,5 fArmL,6 handL,7 uArmR,8 fArmR,9 handR,10 thighL,11 shinL,12 footL,13 thighR,14 shinR,15 footR
export const J = { ROOT: 0, PELVIS: 1, TORSO: 2, HEAD: 3, UARM_L: 4, FARM_L: 5, HAND_L: 6, UARM_R: 7, FARM_R: 8, HAND_R: 9, THIGH_L: 10, SHIN_L: 11, FOOT_L: 12, THIGH_R: 13, SHIN_R: 14, FOOT_R: 15 };
export const PARENT = [-1, 0, 1, 2, 2, 4, 5, 2, 7, 8, 1, 10, 11, 1, 13, 14];
export const NJ = 16;

const SKIN = [0xf1c7a7, 0xe0ac8a, 0xc68863, 0xa86b45, 0x8a5433, 0x6b3f25, 0x4e2c19, 0xffdbc4];
const HAIR = [0x1b120c, 0x2c1b10, 0x4a3020, 0x6b4a2b, 0xa3824f, 0xd9c08a, 0x777777, 0xe8e2d0, 0x8a2f1a];
const SHIRTS = [0xffffff, 0x1f2a44, 0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0x8e44ad, 0x34495e, 0xe67e22, 0x16a085, 0xecf0f1, 0x7f8c8d, 0xff6f91, 0x5dade2, 0x222222, 0xd35400, 0x96c3eb];
const PANTS = [0x2c3e50, 0x1f3a5f, 0x3b3b3b, 0x5d4c3a, 0xb8a88a, 0x222222, 0x4a5a6a, 0x7f8c8d, 0x6c3f2a];
const SHOES = [0xffffff, 0x111111, 0x5a3a22, 0x333333, 0xc0392b, 0x2e86c1, 0x999999];

/** Appearance: colors + proportions + style flags */
export function randomAppearance(rng, { role = 'civilian' } = {}) {
  const fem = role === 'police' || role === 'swat' || role === 'worker' ? rng.chance(0.25) : rng.chance(0.5);
  const a = {
    role, fem, height: rng.range(fem ? 1.58 : 1.68, fem ? 1.78 : 1.92), build: rng.range(0.9, 1.18),
    skin: rng.pick(SKIN), hairColor: rng.pick(HAIR), hair: fem ? rng.pick([2, 3, 4, 1, 5]) : rng.pick([0, 1, 1, 6, 5, 0, 7]),
    shirt: rng.pick(SHIRTS), pants: rng.pick(PANTS), shoes: rng.pick(SHOES), sleeves: rng.pick([0, 1, 1, 2]), shorts: rng.chance(0.2), hat: 0, vest: 0,
    jacket: 0, beard: !fem && rng.chance(0.25),
  };
  if (role === 'beach') { a.shorts = true; a.sleeves = rng.chance(0.5) ? 2 : 1; a.shirt = rng.chance(0.4) ? a.skin : rng.pick([0xff6f91, 0x2e86c1, 0xf1c40f, 0x1abc9c, 0xffffff, 0xe74c3c]); a.shoes = a.skin; a.pants = rng.pick([0x2e86c1, 0xe74c3c, 0x1abc9c, 0xf39c12, 0x222222]); }
  if (role === 'business') { a.shirt = rng.pick([0x1f2a44, 0x222222, 0x3b3b3b, 0x4a4a55]); a.pants = a.shirt; a.shoes = 0x111111; a.sleeves = 0; a.shorts = false; a.tie = true; }
  if (role === 'worker') { a.shirt = rng.pick([0xf39c12, 0xd4e157]); a.pants = 0x1f3a5f; a.hat = 2; a.shoes = 0x5a3a22; a.shorts = false; }
  if (role === 'police') { a.shirt = 0x1b2a41; a.pants = 0x16213a; a.shoes = 0x111111; a.hat = 1; a.sleeves = 1; a.shorts = false; a.badge = true; }
  if (role === 'swat') { a.shirt = 0x1c1c1c; a.pants = 0x222222; a.shoes = 0x111111; a.hat = 3; a.vest = 1; a.sleeves = 0; a.shorts = false; a.build = 1.15; }
  if (role === 'gang') { a.shirt = rng.pick([0x6c3483, 0x7b241c, 0x1c1c1c]); a.pants = rng.pick([0x222222, 0x1f3a5f]); a.hat = rng.chance(0.4) ? 4 : 0; a.shorts = false; }
  if (role === 'player') { // Remy Castillo: olive bomber over white tee, dark jeans, white sneakers
    a.fem = false; a.height = 1.8; a.build = 1.05; a.skin = 0xc68863; a.hair = 6; a.hairColor = 0x1b120c; a.shirt = 0xf4f4f4; a.jacket = 0x4d5a3a;
    a.pants = 0x1f2a3a; a.shoes = 0xf2f2f2; a.sleeves = 0; a.shorts = false; a.beard = true;
  }
  return a;
}

// ---------------------------------------------------------------- rig
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1);
const _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _sc = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);

// helper (skinning-only) bones derived from the main skeleton every frame
export const H = { SPINE: 16, NECK: 17, CLAV_L: 18, CLAV_R: 19, TOE_L: 20, TOE_R: 21, JAW: 22 };
export const NB = 23; // bones used for skinning (16 main + 7 helpers)

/** Rest-pose joint offsets (parent space). Anatomical proportions for a 1.80 m adult; k scales height, w scales width. */
export function rigOffsets(k = 1, w = 1, fem = false) {
  const off = [];
  const sh = (fem ? 0.158 : 0.176) * w, hip = (fem ? 0.094 : 0.088) * w;
  off[J.ROOT] = [0, 0, 0]; off[J.PELVIS] = [0, 0.97 * k, 0]; off[J.TORSO] = [0, 0.08 * k, 0]; off[J.HEAD] = [0, 0.49 * k, 0];
  off[J.UARM_L] = [sh * k, 0.405 * k, -0.01 * k]; off[J.FARM_L] = [0, -0.29 * k, 0]; off[J.HAND_L] = [0, -0.26 * k, 0];
  off[J.UARM_R] = [-sh * k, 0.405 * k, -0.01 * k]; off[J.FARM_R] = [0, -0.29 * k, 0]; off[J.HAND_R] = [0, -0.26 * k, 0];
  off[J.THIGH_L] = [hip * k, -0.06 * k, 0]; off[J.SHIN_L] = [0, -0.43 * k, 0]; off[J.FOOT_L] = [0, -0.41 * k, 0];
  off[J.THIGH_R] = [-hip * k, -0.06 * k, 0]; off[J.SHIN_R] = [0, -0.43 * k, 0]; off[J.FOOT_R] = [0, -0.41 * k, 0];
  return off;
}
/** Bind pose used to build skinned meshes: a relaxed A-pose. Returns joint local rotations [x,y,z]. */
export function bindRotations() {
  const r = []; for (let i = 0; i < NJ; i++) r.push([0, 0, 0]);
  r[J.UARM_L][2] = 0.3; r[J.UARM_R][2] = -0.3; // relaxed A-pose close to how arms hang
  r[J.THIGH_L][2] = 0.035; r[J.THIGH_R][2] = -0.035;
  r[J.FOOT_L][2] = -0.035; r[J.FOOT_R][2] = 0.035;
  return r;
}
const _hq = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()], _hp = new THREE.Vector3(), _hs = new THREE.Vector3(), _hm = new THREE.Matrix4(), _hm2 = new THREE.Matrix4();
function slerpBone(out, A, B, t, posFrom) {
  A.decompose(_hp, _hq[0], _hs); B.decompose(_hp, _hq[1], _hs);
  _hq[2].copy(_hq[0]).slerp(_hq[1], t);
  _hp.setFromMatrixPosition(posFrom);
  return out.compose(_hp, _hq[2], _s);
}
/** Fill helper bone matrices W[16..22] from the main skeleton (works for animated, ragdoll and bind poses). */
export function computeHelpers(W, k, toeL = 0, toeR = 0, jaw = 0) {
  slerpBone(W[H.SPINE], W[J.PELVIS], W[J.TORSO], 0.5, W[J.TORSO]);
  slerpBone(W[H.NECK], W[J.TORSO], W[J.HEAD], 0.5, W[J.HEAD]);
  slerpBone(W[H.CLAV_L], W[J.TORSO], W[J.UARM_L], 0.3, W[J.UARM_L]);
  slerpBone(W[H.CLAV_R], W[J.TORSO], W[J.UARM_R], 0.3, W[J.UARM_R]);
  _hm.makeRotationX(-toeL); _hm.setPosition(0, -0.05 * k, 0.1 * k); W[H.TOE_L].multiplyMatrices(W[J.FOOT_L], _hm);
  _hm.makeRotationX(-toeR); _hm.setPosition(0, -0.05 * k, 0.1 * k); W[H.TOE_R].multiplyMatrices(W[J.FOOT_R], _hm);
  _hm.makeRotationX(jaw); _hm.setPosition(0, 0.105 * k, -0.004 * k); W[H.JAW].multiplyMatrices(W[J.HEAD], _hm);
}
/** World matrices (NB) of the bind pose for a rig of the given proportions, root at origin. */
export function bindPose(k = 1, w = 1, fem = false) {
  const off = rigOffsets(k, w, fem), rot = bindRotations(), W = [];
  for (let i = 0; i < NB; i++) W.push(new THREE.Matrix4());
  for (const i of FK_ORDER) {
    if (i === 0) { W[0].identity(); continue; }
    const o = off[i], r = rot[i];
    _e.set(r[0], r[1], r[2], 'YXZ'); _q.setFromEuler(_e);
    _m.compose(_v.set(o[0], o[1], o[2]), _q, _s);
    W[i].multiplyMatrices(W[PARENT[i]], _m);
  }
  computeHelpers(W, k);
  return W;
}
const FK_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

// Gait curves (degrees) over one cycle c in [0,1), c = 0 at heel strike of this leg. Positive hip = flexion (leg forward),
// positive knee = flexion, positive ankle = dorsiflexion (toes up), toe = toe bend at push-off.
const WALK = {
  hip: [[0, 24], [0.12, 20], [0.3, 5], [0.5, -10], [0.6, -8], [0.72, 12], [0.85, 27], [0.95, 25]],
  knee: [[0, 4], [0.12, 17], [0.3, 7], [0.45, 6], [0.6, 38], [0.72, 60], [0.85, 32], [0.96, 5]],
  ankle: [[0, 2], [0.08, -6], [0.3, 6], [0.48, 10], [0.62, -16], [0.72, -4], [0.85, 2], [0.95, 2]],
  toe: [[0, 0], [0.4, 0], [0.55, 28], [0.64, 12], [0.7, 0]],
};
const RUN = {
  hip: [[0, 32], [0.12, 22], [0.33, -12], [0.45, -6], [0.62, 28], [0.8, 46], [0.93, 38]],
  knee: [[0, 22], [0.14, 40], [0.33, 18], [0.5, 70], [0.66, 112], [0.82, 70], [0.95, 28]],
  ankle: [[0, 6], [0.14, 16], [0.33, -24], [0.48, -8], [0.7, 4], [0.9, 8]],
  toe: [[0, 0], [0.2, 0], [0.3, 30], [0.4, 0]],
};
function curve(tab, c) {
  // periodic cosine-smoothed interpolation
  const n = tab.length;
  for (let i = 0; i < n; i++) {
    const a = tab[i], b = tab[(i + 1) % n], c0 = a[0], c1 = i + 1 < n ? b[0] : b[0] + 1;
    let cc = c; if (cc < c0) cc += 1;
    if (cc >= c0 && cc <= c1) { const t = (cc - c0) / (c1 - c0 || 1), s = (1 - Math.cos(t * Math.PI)) * 0.5; return a[1] + (b[1] - a[1]) * s; }
  }
  return tab[0][1];
}
const RAD = Math.PI / 180;
const GRIP = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(-0.008, -0.078, 0.012);

export class CharacterRig {
  constructor(appearance) {
    this.app = appearance;
    const k = appearance.height / 1.8, w = appearance.build;
    this.k = k; this.w = w; this.fem = !!appearance.fem;
    this.root = { position: new THREE.Vector3(), yaw: 0 };
    this.off = rigOffsets(k, w, this.fem);
    this.rot = []; for (let i = 0; i < NJ; i++) this.rot.push([0, 0, 0]); // local euler (x,y,z)
    this.world = []; for (let i = 0; i < NB; i++) this.world.push(new THREE.Matrix4());
    this.pelvisOffset = new THREE.Vector3();
    // animation state
    this.phase = Math.random(); this.walkW = 0; this.runW = 0; this.moveW = 0; this.aimW = 0; this.sitW = 0; this.airW = 0; this.swimW = 0; this.cowerW = 0; this.handsUpW = 0;
    this.recoil = 0; this.punchT = 0; this.punchSide = 0; this.reloadT = 0; this.flinch = 0; this.time = Math.random() * 10;
    this.lean = 0; this.bank = 0; this.getUpT = 0; this.phoneW = 0; this.waveW = 0; this.enterT = 0;
    // idle weight shifting and small life signs
    this.shift = 0; this.shiftTarget = 0; this.shiftT = 2 + Math.random() * 4; this.look = 0; this.lookTarget = 0; this.lookT = 3;
    this.lookDir = 0; this.lookPitchV = 0; // directed look (camera direction for the player, nearby people for pedestrians)
    this.toe = [0, 0]; this.jaw = 0; this.talk = 0;
    this.blink = 0; this.blinkT = 1 + Math.random() * 4; this.gaze = new THREE.Vector2(); this.gazeTarget = new THREE.Vector2(); this.gazeT = 0.5;
    this.sway = new THREE.Vector3(); this.swayV = new THREE.Vector3(); this._lastVel = new THREE.Vector3();
    // micro-expressions (brow raise/knit, smile, squint) drift toward targets that change every few seconds
    this.expr = { brow: 0, smile: 0, squint: 0 }; this._exT = { brow: 0, smile: 0, squint: 0 }; this.exprT = Math.random() * 3; this.mood = Math.random() * 0.25;
    // ragdoll
    this.ragdoll = false; this.ragdollSettled = false; this.rd = null;
    this.visible = true;
    this.update(0, {});
  }
  _fk() {
    const R = this.root, W = this.world;
    _q.setFromAxisAngle(UP, R.yaw);
    W[0].compose(R.position, _q, _s);
    for (let i = 1; i < NJ; i++) {
      const o = this.off[i], r = this.rot[i];
      _e.set(r[0], r[1], r[2], 'YXZ'); _q.setFromEuler(_e);
      if (i === J.PELVIS) _v.set(o[0] + this.pelvisOffset.x, o[1] + this.pelvisOffset.y, o[2] + this.pelvisOffset.z); else _v.set(o[0], o[1], o[2]);
      _m.compose(_v, _q, _s);
      W[i].multiplyMatrices(W[PARENT[i]], _m);
    }
    computeHelpers(W, this.k, this.toe[0], this.toe[1], this.jaw);
  }
  /** Joint world position. */
  jointPos(i, out) { return out.setFromMatrixPosition(this.world[i]); }
  _face(dt, st) {
    // blinking, eye saccades, breathing-driven jaw and talking
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinkT = 2 + Math.random() * 4.5; this._blinkRun = 0; if (Math.random() < 0.15) this.blinkT = 0.25; }
    if (this._blinkRun != null) { this._blinkRun += dt; const t = this._blinkRun / 0.16; this.blink = t < 1 ? Math.sin(t * Math.PI) : 0; if (t >= 1) this._blinkRun = null; }
    this.gazeT -= dt;
    if (this.gazeT <= 0) { this.gazeT = 0.4 + Math.random() * 2.2; this.gazeTarget.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.25); }
    // the eyes lead the head when the look target moves
    const lead = st.lookYaw != null ? clamp((st.lookYaw - this.lookDir) * 0.8, -0.45, 0.45) : 0;
    const gx = clamp(this.gazeTarget.x * (st.lookYaw != null ? 0.3 : 1) + lead, -0.5, 0.5);
    const g = 1 - Math.exp(-dt * 30); this.gaze.x += (gx - this.gaze.x) * g; this.gaze.y += (this.gazeTarget.y - this.gaze.y) * g;
    this.talk = damp(this.talk, st.talking ? 1 : 0, 8, dt);
    const speech = this.talk > 0.01 ? (0.5 + 0.5 * Math.sin(this.time * 17)) * (0.5 + 0.5 * Math.sin(this.time * 5.3 + 1)) : 0;
    this.jaw = 0.02 + this.talk * speech * 0.2 + (st.mode === 'dead' ? 0.25 : 0);
    // expressions: brief brow flicks and smiles while talking, a knitted brow and squint when aiming or scared
    this.exprT -= dt;
    const T = this._exT, tense = st.aim || st.mode === 'cower' || st.mode === 'handsUp';
    if (this.exprT <= 0) {
      this.exprT = (this.talk > 0.5 ? 0.6 : 2.5) + Math.random() * (this.talk > 0.5 ? 1.2 : 5);
      T.brow = this.talk > 0.5 ? (Math.random() < 0.5 ? 0.5 + Math.random() * 0.5 : -0.2) : (Math.random() < 0.25 ? 0.4 : 0);
      T.smile = this.talk > 0.5 ? Math.random() * 0.6 : this.mood + (Math.random() < 0.15 ? 0.3 : 0);
      T.squint = Math.random() < 0.2 ? 0.3 : 0;
    }
    const tb = tense ? -0.7 : T.brow, ts = tense ? 0 : T.smile, tq = st.aim ? 0.7 : (st.speed || 0) > 5 ? 0.35 : T.squint;
    const ke = 1 - Math.exp(-dt * 7);
    this.expr.brow += (tb - this.expr.brow) * ke; this.expr.smile += (ts - this.expr.smile) * ke; this.expr.squint += (tq - this.expr.squint) * ke;
    if (st.mode === 'dead') { this.expr.brow = 0; this.expr.smile = 0; this.expr.squint = 0; }
  }
  update(dt, st) {
    this.time += dt;
    this._face(dt, st);
    if (this.ragdoll) { this._ragdollStep(dt); return; }
    const mode = st.mode || 'normal';
    const speed = st.speed || 0;
    const r = this.rot;
    for (let i = 0; i < NJ; i++) { r[i][0] = 0; r[i][1] = 0; r[i][2] = 0; }
    // --- blend weights
    const ground = mode === 'normal';
    // turning on the spot: the feet step round instead of the body pivoting on planted soles
    const turnStep = ground && speed < 0.5 ? clamp((Math.abs(st.turnRate || 0) - 0.7) / 2.2, 0, 1) : 0;
    const gs = Math.max(speed, turnStep * 1.1);
    const tMove = ground ? clamp(gs / 0.9, 0, 1) : 0;
    const tRun = ground ? clamp((speed - 2.6) / 2.2, 0, 1) : 0;
    const kW = 1 - Math.exp(-14 * dt);
    this.moveW += (tMove - this.moveW) * kW; this.runW += (tRun - this.runW) * kW;
    this.walkW = this.moveW;
    this.aimW += ((st.aim ? 1 : 0) - this.aimW) * (1 - Math.exp(-14 * dt));
    this.sitW += ((mode === 'sit' ? 1 : 0) - this.sitW) * (1 - Math.exp(-8 * dt));
    this.airW += ((st.grounded === false && mode === 'normal' ? 1 : 0) - this.airW) * (1 - Math.exp(-10 * dt));
    this.swimW += ((mode === 'swim' ? 1 : 0) - this.swimW) * (1 - Math.exp(-5 * dt));
    this.cowerW += ((mode === 'cower' ? 1 : 0) - this.cowerW) * (1 - Math.exp(-6 * dt));
    this.handsUpW += ((mode === 'handsUp' ? 1 : 0) - this.handsUpW) * (1 - Math.exp(-6 * dt));
    this.phoneW += ((mode === 'phone' ? 1 : 0) - this.phoneW) * (1 - Math.exp(-4 * dt));
    this.waveW += ((mode === 'wave' ? 1 : 0) - this.waveW) * (1 - Math.exp(-6 * dt));
    if (st.fire) this.recoil = 1;
    this.recoil = Math.max(0, this.recoil - dt * 9);
    if (st.punch) { this.punchT = 0.001; this.punchSide ^= 1; }
    if (this.punchT > 0) { this.punchT += dt; if (this.punchT > 0.35) this.punchT = 0; }
    if (st.hit) this.flinch = 1;
    this.flinch = Math.max(0, this.flinch - dt * 4);
    if (mode === 'getUp') this.getUpT = Math.min(1, this.getUpT + dt * 1.1); else this.getUpT = 0;
    const M = this.moveW, Rn = this.runW, k = this.k;
    const lv = st.localVel || { x: 0, z: speed };
    // --- gait timing: cadence follows real speed, so feet never slide
    const steps = lerp(1.25 + 0.45 * gs, 2.3 + 0.15 * speed, Rn); // steps per second
    const dir = lv.z < -0.25 ? -1 : 1; // backpedalling plays the cycle in reverse
    if (gs > 0.05) this.phase = (this.phase + dir * steps * 0.5 * dt + 1) % 1;
    const legScale = clamp(gs / 1.4, 0.3, 1.15) * (1 - Rn) + Rn;
    const legs = [this.phase, (this.phase + 0.5) % 1];
    const breath = Math.sin(this.time * 1.7);
    // idle weight shifts
    this.shiftT -= dt;
    if (this.shiftT <= 0) { this.shiftT = 3.5 + Math.random() * 5; this.shiftTarget = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.25) this.shiftTarget = 0; }
    this.shift = damp(this.shift, this.shiftTarget * (1 - M), 1.6, dt);
    this.lookT -= dt;
    if (this.lookT <= 0) { this.lookT = 2 + Math.random() * 5; this.lookTarget = Math.random() < 0.6 ? 0 : (Math.random() - 0.5) * 1.1; }
    this.look = damp(this.look, this.lookTarget * (1 - M), 2.5, dt);
    let hipSum = 0;
    for (let s = 0; s < 2; s++) {
      const c = legs[s];
      const th = s ? J.THIGH_R : J.THIGH_L, sh = th + 1, ft = th + 2;
      const hip = lerp(curve(WALK.hip, c) * legScale, curve(RUN.hip, c), Rn) * RAD;
      const knee = lerp(curve(WALK.knee, c) * lerp(0.55, 1, legScale), curve(RUN.knee, c), Rn) * RAD;
      const ank = lerp(curve(WALK.ankle, c) * legScale, curve(RUN.ankle, c), Rn) * RAD;
      const toe = lerp(curve(WALK.toe, c), curve(RUN.toe, c), Rn) * RAD;
      // idle stance: the unloaded leg relaxes its knee
      const side = s ? -1 : 1, unload = Math.max(0, -this.shift * side);
      r[th][0] = -hip * M * dir - unload * 0.08;
      r[sh][0] = knee * M + unload * 0.22 + 0.03;
      r[ft][0] = -ank * M - unload * 0.12;
      r[th][2] = side * (0.02 + 0.03 * unload);
      this.toe[s] = toe * M;
      hipSum += hip * (s ? -1 : 1);
    }
    // --- pelvis: bob, sway toward the stance leg, rotation and list
    const cw = TAU * this.phase;
    const bobWalk = -0.022 * Math.cos(2 * cw) * legScale, bobRun = 0.035 * Math.cos(2 * cw - 0.8);
    const bob = lerp(bobWalk, bobRun, Rn) * M;
    const lat = Math.sin(cw) * 0.022 * M * (1 - Rn * 0.6);
    this.pelvisOffset.set(lat + this.shift * 0.028, bob - 0.012 * M - 0.035 * Rn + breath * 0.002 - Math.abs(this.shift) * 0.008, 0);
    r[J.PELVIS][1] = Math.sin(cw) * lerp(0.08, 0.13, Rn) * M + this.shift * 0.05;
    r[J.PELVIS][2] = -Math.sin(cw) * 0.05 * M * (1 - Rn * 0.5) - this.shift * 0.045;
    r[J.PELVIS][0] = 0.03 * M + 0.05 * Rn;
    // --- torso: counter-rotation, lean into acceleration and turns, breathing
    this.lean = damp(this.lean, clamp((st.accel || 0) * 0.025, -0.18, 0.22), 5, dt);
    this.bank = damp(this.bank, clamp((st.turnRate || 0) * speed * -0.02, -0.25, 0.25), 5, dt);
    r[J.TORSO][0] = lerp(0.04, 0.16, Rn) * M + this.lean + breath * 0.012 - r[J.PELVIS][0] * 0.6;
    r[J.TORSO][1] = -r[J.PELVIS][1] * 1.35;
    r[J.TORSO][2] = -r[J.PELVIS][2] * 0.8 + this.bank;
    // head stays level and looks ahead (or glances around when idle)
    r[J.HEAD][0] = -(r[J.TORSO][0] + r[J.PELVIS][0]) * 0.85 + breath * -0.006;
    const hasLook = st.lookYaw != null;
    this.lookDir = damp(this.lookDir, hasLook ? clamp(st.lookYaw, -1.15, 1.15) : 0, 3.5, dt);
    this.lookPitchV = damp(this.lookPitchV, hasLook ? clamp(st.lookPitch || 0, -0.5, 0.45) : 0, 3.5, dt);
    r[J.HEAD][1] = -(r[J.TORSO][1] + r[J.PELVIS][1]) * 0.9 + this.look + this.lookDir * 0.68;
    r[J.TORSO][1] += this.lookDir * 0.22;
    r[J.HEAD][0] -= this.lookPitchV * 0.55;
    r[J.HEAD][2] = -(r[J.TORSO][2] + r[J.PELVIS][2]) * 0.7;
    // --- arms swing opposite the legs, elbows bend more when running
    const armAmp = lerp(0.32 * legScale, 0.75, Rn) * M * clamp(speed / Math.max(gs, 0.05), 0.15, 1);
    const aL = -Math.sin(cw) * armAmp * dir, aR = Math.sin(cw) * armAmp * dir;
    r[J.UARM_L][0] = aL + 0.04; r[J.UARM_R][0] = aR + 0.04;
    r[J.UARM_L][2] = 0.06 + 0.08 * Rn + breath * 0.004; r[J.UARM_R][2] = -0.06 - 0.08 * Rn - breath * 0.004;
    r[J.UARM_L][1] = 0.1 * Rn; r[J.UARM_R][1] = -0.1 * Rn;
    const elbow = lerp(0.18 + 0.12 * M, 1.45, Rn);
    r[J.FARM_L][0] = -elbow - Math.max(0, -aL) * 0.35; r[J.FARM_R][0] = -elbow - Math.max(0, -aR) * 0.35;
    r[J.FARM_L][1] = -0.25; r[J.FARM_R][1] = 0.25; // palms turn in
    r[J.HAND_L][0] = -0.1; r[J.HAND_R][0] = -0.1;
    // strafing while aiming: hips turn toward the direction of travel, torso keeps facing the aim
    if (this.aimW > 0.01 && speed > 0.3) {
      const side = clamp(lv.x / Math.max(0.5, speed), -1, 1) * (lv.z < -0.25 ? -1 : 1);
      r[J.PELVIS][1] += side * 0.75 * this.aimW; r[J.TORSO][1] -= side * 0.6 * this.aimW;
    }
    // --- air
    if (this.airW > 0.01) {
      const a = this.airW, up = (st.vy || 0) > 0 ? 1 : 0.5;
      r[J.THIGH_L][0] = lerp(r[J.THIGH_L][0], -0.7 * up, a); r[J.THIGH_R][0] = lerp(r[J.THIGH_R][0], -0.25, a);
      r[J.SHIN_L][0] = lerp(r[J.SHIN_L][0], 1.2, a); r[J.SHIN_R][0] = lerp(r[J.SHIN_R][0], 0.55, a);
      r[J.UARM_L][2] = lerp(r[J.UARM_L][2], 0.7, a); r[J.UARM_R][2] = lerp(r[J.UARM_R][2], -0.7, a);
      r[J.UARM_L][0] = lerp(r[J.UARM_L][0], -0.5, a); r[J.UARM_R][0] = lerp(r[J.UARM_R][0], -0.5, a);
    }
    // --- aiming / weapons
    const wpn = st.weapon || 'none';
    if (this.aimW > 0.01 && wpn !== 'none') {
      const a = this.aimW, pitch = clamp(st.aimPitch || 0, -1.2, 1.2), rec = this.recoil * (wpn === 'shotgun' ? 0.35 : wpn === 'pistol' ? 0.25 : 0.12);
      const twoH = wpn !== 'pistol';
      r[J.UARM_R][0] = lerp(r[J.UARM_R][0], -1.5 - pitch - rec, a); r[J.UARM_R][2] = lerp(r[J.UARM_R][2], twoH ? 0.12 : 0.05, a); r[J.UARM_R][1] = lerp(r[J.UARM_R][1], twoH ? 0.2 : 0, a);
      r[J.FARM_R][0] = lerp(r[J.FARM_R][0], twoH ? -0.25 : -0.05, a); r[J.FARM_R][1] = lerp(r[J.FARM_R][1], 0, a); r[J.HAND_R][0] = lerp(r[J.HAND_R][0], 0, a);
      r[J.UARM_L][0] = lerp(r[J.UARM_L][0], twoH ? -1.35 - pitch - rec : -1.25 - pitch * 0.8, a);
      r[J.UARM_L][2] = lerp(r[J.UARM_L][2], twoH ? -0.55 : -0.35, a); r[J.UARM_L][1] = lerp(r[J.UARM_L][1], twoH ? 0.3 : 0.2, a);
      r[J.FARM_L][0] = lerp(r[J.FARM_L][0], twoH ? -0.6 : -0.3, a);
      r[J.TORSO][1] += (twoH ? -0.35 : -0.1) * a; r[J.HEAD][1] += (twoH ? 0.3 : 0.1) * a; r[J.HEAD][0] = lerp(r[J.HEAD][0], pitch * 0.5, a);
      r[J.TORSO][0] = lerp(r[J.TORSO][0], 0.05 + pitch * 0.25, a);
    } else if (wpn !== 'none' && wpn !== 'fists') {
      // carry pose: weapon lowered
      r[J.FARM_R][0] -= 0.4; r[J.UARM_R][0] = r[J.UARM_R][0] * 0.4 - 0.15;
      if (wpn !== 'pistol') { r[J.UARM_L][0] = -0.55; r[J.UARM_L][2] = -0.35; r[J.FARM_L][0] = -1.2; }
    }
    // punch
    if (this.punchT > 0) {
      const t = this.punchT / 0.35, ext = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
      const arm = this.punchSide ? J.UARM_R : J.UARM_L, fa = arm + 1;
      r[arm][0] = lerp(-0.9, -1.55, ext); r[fa][0] = lerp(-1.6, -0.1, ext);
      r[J.TORSO][1] += (this.punchSide ? -0.45 : 0.45) * ext;
    } else if (wpn === 'fists' && this.aimW > 0.3) { // guard
      for (const [a2, f2, sgn] of [[J.UARM_L, J.FARM_L, 1], [J.UARM_R, J.FARM_R, -1]]) { r[a2][0] = -0.9; r[a2][2] = 0.2 * sgn; r[f2][0] = -1.7; }
    }
    // --- special modes
    if (this.sitW > 0.01) {
      const a = this.sitW;
      for (const th of [J.THIGH_L, J.THIGH_R]) { r[th][0] = lerp(r[th][0], -1.45, a); r[th + 1][0] = lerp(r[th + 1][0], 1.35, a); r[th + 2][0] = lerp(r[th + 2][0], -0.2, a); }
      this.pelvisOffset.y = lerp(this.pelvisOffset.y, -0.45 * k, a); this.pelvisOffset.x *= 1 - a;
      r[J.PELVIS][1] *= 1 - a; r[J.PELVIS][2] *= 1 - a;
      r[J.TORSO][0] = lerp(r[J.TORSO][0], -0.2, a);
      if (!st.aim) {
        const wheel = st.wheel || 0;
        r[J.UARM_L][0] = lerp(r[J.UARM_L][0], -0.95 + wheel * 0.25, a); r[J.UARM_R][0] = lerp(r[J.UARM_R][0], -0.95 - wheel * 0.25, a);
        r[J.UARM_L][2] = lerp(r[J.UARM_L][2], -0.1, a); r[J.UARM_R][2] = lerp(r[J.UARM_R][2], 0.1, a);
        r[J.FARM_L][0] = lerp(r[J.FARM_L][0], -0.7, a); r[J.FARM_R][0] = lerp(r[J.FARM_R][0], -0.7, a);
      }
    }
    if (this.swimW > 0.01) {
      const a = this.swimW, t = this.time * 3.2;
      r[J.TORSO][0] = lerp(r[J.TORSO][0], 1.3, a);
      r[J.UARM_L][0] = lerp(r[J.UARM_L][0], -1.6 - Math.sin(t) * 1.5, a); r[J.UARM_R][0] = lerp(r[J.UARM_R][0], -1.6 + Math.sin(t) * 1.5, a);
      r[J.THIGH_L][0] = lerp(r[J.THIGH_L][0], Math.sin(t * 2) * 0.3 - 0.1, a); r[J.THIGH_R][0] = lerp(r[J.THIGH_R][0], -Math.sin(t * 2) * 0.3 - 0.1, a);
      r[J.HEAD][0] = lerp(r[J.HEAD][0], -1.0, a);
      this.pelvisOffset.y = lerp(this.pelvisOffset.y, -0.9 * k, a);
    }
    if (this.cowerW > 0.01) {
      const a = this.cowerW;
      for (const th of [J.THIGH_L, J.THIGH_R]) { r[th][0] = lerp(r[th][0], -1.9, a); r[th + 1][0] = lerp(r[th + 1][0], 2.2, a); r[th + 2][0] = lerp(r[th + 2][0], -0.3, a); }
      this.pelvisOffset.y = lerp(this.pelvisOffset.y, -0.55 * k, a);
      r[J.TORSO][0] = lerp(r[J.TORSO][0], 0.7, a);
      for (const [ua, fa, sg] of [[J.UARM_L, J.FARM_L, 1], [J.UARM_R, J.FARM_R, -1]]) { r[ua][0] = lerp(r[ua][0], -2.4, a); r[ua][2] = lerp(r[ua][2], 0.5 * sg, a); r[fa][0] = lerp(r[fa][0], -2.0, a); }
    }
    if (this.handsUpW > 0.01) { const a = this.handsUpW; r[J.UARM_L][0] = lerp(r[J.UARM_L][0], -2.9, a); r[J.UARM_R][0] = lerp(r[J.UARM_R][0], -2.9, a); r[J.UARM_L][2] = lerp(r[J.UARM_L][2], 0.4, a); r[J.UARM_R][2] = lerp(r[J.UARM_R][2], -0.4, a); r[J.FARM_L][0] = lerp(r[J.FARM_L][0], -0.6, a); r[J.FARM_R][0] = lerp(r[J.FARM_R][0], -0.6, a); }
    if (this.phoneW > 0.01) { const a = this.phoneW; r[J.UARM_R][0] = lerp(r[J.UARM_R][0], -0.4, a); r[J.UARM_R][2] = lerp(r[J.UARM_R][2], 0.5, a); r[J.FARM_R][0] = lerp(r[J.FARM_R][0], -2.4, a); r[J.HEAD][0] += 0.25 * a; }
    if (this.waveW > 0.01) { const a = this.waveW; r[J.UARM_R][0] = lerp(r[J.UARM_R][0], -2.7, a); r[J.UARM_R][2] = lerp(r[J.UARM_R][2], -0.3 + Math.sin(this.time * 9) * 0.3, a); r[J.FARM_R][0] = lerp(r[J.FARM_R][0], -0.4, a); }
    if (mode === 'enterCar' || mode === 'exitCar') { r[J.TORSO][0] += 0.35; r[J.UARM_L][0] = -1.2; r[J.FARM_L][0] = -0.3; }
    if (this.flinch > 0) { r[J.TORSO][0] -= this.flinch * 0.25; r[J.HEAD][0] -= this.flinch * 0.3; }
    if (mode === 'dead') { this.pelvisOffset.y = -0.8; r[J.TORSO][0] = 1.5; }
    if (mode === 'getUp') {
      const t = this.getUpT, a = 1 - t;
      for (const th of [J.THIGH_L, J.THIGH_R]) { r[th][0] = lerp(r[th][0], -1.7, a); r[th + 1][0] = lerp(r[th + 1][0], 2.0, a); }
      r[J.TORSO][0] = lerp(r[J.TORSO][0], 1.1, a);
      this.pelvisOffset.y = lerp(this.pelvisOffset.y, -0.75 * k, a);
      r[J.UARM_L][0] = lerp(r[J.UARM_L][0], -0.5, a); r[J.UARM_R][0] = lerp(r[J.UARM_R][0], -0.5, a);
    }
    this._secondary(dt, st);
    this._fk();
  }
  /** Spring for jacket hems and long hair, driven by the character's acceleration (world space). */
  _secondary(dt, st) {
    if (dt <= 0) return;
    const v = st.worldVel; if (!v) return;
    const ax = (v.x - this._lastVel.x) / dt, az = (v.z - this._lastVel.z) / dt; this._lastVel.set(v.x, 0, v.z);
    const s = this.sway, sv = this.swayV;
    const kS = 90, dmp = 9;
    sv.x += (-kS * s.x - dmp * sv.x - clamp(ax, -40, 40) * 0.35 - v.x * 0.9) * dt;
    sv.z += (-kS * s.z - dmp * sv.z - clamp(az, -40, 40) * 0.35 - v.z * 0.9) * dt;
    sv.y += (-kS * s.y - dmp * sv.y) * dt;
    s.addScaledVector(sv, dt);
    s.x = clamp(s.x, -0.08, 0.08); s.z = clamp(s.z, -0.08, 0.08);
  }

  // ------------------------------------------------ ragdoll
  // particles: 0 head,1 chest,2 pelvis,3 shL,4 elL,5 haL,6 shR,7 elR,8 haR,9 hipL,10 knL,11 ftL,12 hipR,13 knR,14 ftR
  startRagdoll(vel, opts = {}) {
    const P = [], map = [J.HEAD, J.HEAD, J.PELVIS, J.UARM_L, J.FARM_L, J.HAND_L, J.UARM_R, J.FARM_R, J.HAND_R, J.THIGH_L, J.SHIN_L, J.FOOT_L, J.THIGH_R, J.SHIN_R, J.FOOT_R];
    for (let i = 0; i < 15; i++) {
      const p = new THREE.Vector3().setFromMatrixPosition(this.world[map[i]]);
      if (i === 0) p.y += 0.2 * this.k;
      if (i === 1) p.y -= 0.02;
      P.push(p);
    }
    const prev = P.map((p, i) => {
      const spin = (i === 0 || i === 1 || i === 3 || i === 6) ? 1.25 : 0.85;
      return p.clone().addScaledVector(vel, -(1 / 60) * spin).add(new THREE.Vector3((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.02));
    });
    const C = [[0, 1], [1, 2], [1, 3], [1, 6], [3, 6], [3, 4], [4, 5], [6, 7], [7, 8], [2, 9], [2, 12], [9, 12], [9, 10], [10, 11], [12, 13], [13, 14], [3, 9], [6, 12], [3, 12], [6, 9], [0, 3], [0, 6]];
    const L = C.map(([a, b]) => P[a].distanceTo(P[b]));
    const R = [0.12, 0.13, 0.13, 0.07, 0.05, 0.05, 0.07, 0.05, 0.05, 0.08, 0.06, 0.06, 0.08, 0.06, 0.06];
    this.rd = { P, prev, C, L, R, groundFn: opts.groundFn, collideFn: opts.collideFn, still: 0, t: 0 };
    this.ragdoll = true; this.ragdollSettled = false;
    this.side = new THREE.Vector3();
  }
  stopRagdoll() {
    if (!this.rd) { this.ragdoll = false; return; }
    const P = this.rd.P;
    this.root.position.set(P[2].x, this.rd.groundFn ? this.rd.groundFn(P[2].x, P[2].z, P[2].y + 0.5) : P[2].y - 0.9, P[2].z);
    const fx = P[1].x - P[2].x, fz = P[1].z - P[2].z;
    this.root.yaw = Math.atan2(fx, fz) + (P[1].y > 0 ? 0 : 0);
    this.ragdoll = false; this.rd = null;
    this.getUpT = 0;
  }
  _ragdollStep(dt) {
    const rd = this.rd; if (!rd) return;
    const steps = 2, h = Math.min(dt, 1 / 30) / steps;
    rd.t += dt;
    let energy = 0;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < 15; i++) {
        const p = rd.P[i], q = rd.prev[i];
        const vx = (p.x - q.x) * 0.995, vy = (p.y - q.y) * 0.995, vz = (p.z - q.z) * 0.995;
        q.copy(p);
        p.x += vx; p.y += vy - 9.81 * h * h; p.z += vz;
        energy += vx * vx + vy * vy + vz * vz;
      }
      for (let it = 0; it < 5; it++) {
        for (let c = 0; c < rd.C.length; c++) {
          const [a, b] = rd.C[c], pa = rd.P[a], pb = rd.P[b];
          const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (d - rd.L[c]) / d * 0.5;
          pa.x += dx * diff; pa.y += dy * diff; pa.z += dz * diff; pb.x -= dx * diff; pb.y -= dy * diff; pb.z -= dz * diff;
        }
        // ground + walls
        for (let i = 0; i < 15; i++) {
          const p = rd.P[i], r = rd.R[i];
          const g = rd.groundFn ? rd.groundFn(p.x, p.z, p.y + 0.3) : 0;
          if (p.y < g + r) {
            p.y = g + r;
            const q = rd.prev[i];
            q.x = p.x - (p.x - q.x) * 0.55; q.z = p.z - (p.z - q.z) * 0.55;
            if (q.y < p.y) q.y = p.y + (p.y - q.y) * 0.15;
          }
          if (rd.collideFn && (i === 1 || i === 2 || i === 0 || i === 11 || i === 14)) rd.collideFn(p, r + 0.05);
        }
      }
    }
    if (energy / steps < 0.00002 * 15) rd.still += dt; else rd.still = 0;
    if (rd.still > 0.8 || rd.t > 12) this.ragdollSettled = true;
    this._ragdollPose();
    computeHelpers(this.world, this.k, 0, 0, this.jaw);
  }
  /** Build joint world matrices from ragdoll particles. */
  _ragdollPose() {
    const P = this.rd.P, W = this.world;
    const up = _v.subVectors(P[1], P[2]).normalize();
    const side = this.side.subVectors(P[3], P[6]); side.addScaledVector(up, -side.dot(up)).normalize();
    const fwd = _v2.crossVectors(side, up).normalize();
    const basis = (m, x, y, z, pos) => { m.makeBasis(x, y, z); m.setPosition(pos); };
    const tmpY = new THREE.Vector3(), tmpX = new THREE.Vector3(), tmpZ = new THREE.Vector3();
    // root at pelvis ground projection, keep for culling
    this.root.position.set(P[2].x, P[2].y - 0.9, P[2].z);
    W[0].makeTranslation(this.root.position.x, this.root.position.y, this.root.position.z);
    basis(W[J.PELVIS], side, up, fwd, P[2]);
    basis(W[J.TORSO], side, up, fwd, tmpY.copy(P[2]).addScaledVector(up, 0.08 * this.k));
    const hu = tmpZ.subVectors(P[0], P[1]).normalize();
    const hx = tmpX.copy(side).addScaledVector(hu, -side.dot(hu)).normalize();
    basis(W[J.HEAD], hx, hu, new THREE.Vector3().crossVectors(hx, hu), P[1]);
    const limb = (j, a, b, sideRef) => {
      const y = tmpY.subVectors(P[a], P[b]).normalize(); // bone points from child to parent -> -Y along bone
      const x = tmpX.copy(sideRef).addScaledVector(y, -sideRef.dot(y));
      if (x.lengthSq() < 1e-6) x.set(1, 0, 0); x.normalize();
      const z = tmpZ.crossVectors(x, y);
      basis(W[j], x, y, z, P[a]);
    };
    limb(J.UARM_L, 3, 4, side); limb(J.FARM_L, 4, 5, side); limb(J.HAND_L, 5, 5, side); W[J.HAND_L].copy(W[J.FARM_L]).setPosition(P[5]);
    limb(J.UARM_R, 6, 7, side); limb(J.FARM_R, 7, 8, side); W[J.HAND_R].copy(W[J.FARM_R]).setPosition(P[8]);
    limb(J.THIGH_L, 9, 10, side); limb(J.SHIN_L, 10, 11, side); W[J.FOOT_L].copy(W[J.SHIN_L]).setPosition(P[11]);
    limb(J.THIGH_R, 12, 13, side); limb(J.SHIN_R, 13, 14, side); W[J.FOOT_R].copy(W[J.SHIN_R]).setPosition(P[14]);
  }
  /** Apply an impulse to the ragdoll (m/s) near a point. */
  pushRagdoll(vel, point = null) {
    if (!this.rd) return;
    for (let i = 0; i < 15; i++) {
      const p = this.rd.P[i]; let w = 1;
      if (point) { const d = p.distanceTo(point); w = clamp(1.5 - d, 0.3, 1.5); }
      this.rd.prev[i].addScaledVector(vel, -(1 / 60) * w);
    }
    this.rd.still = 0; this.ragdollSettled = false;
  }
  /** Hit spheres in world space: out[i] = {x,y,z,r,part}. */
  getHitSpheres(out) {
    const W = this.world, k = this.k;
    const set = (i, j, oy, r, part) => { const o = out[i] || (out[i] = { x: 0, y: 0, z: 0, r: 0, part: '' }); _v.set(0, oy, 0).applyMatrix4(W[j]); o.x = _v.x; o.y = _v.y; o.z = _v.z; o.r = r; o.part = part; };
    set(0, J.HEAD, 0.14 * k, 0.13, 'head');
    set(1, J.TORSO, 0.3 * k, 0.2 * this.w, 'torso');
    set(2, J.TORSO, 0.08 * k, 0.18 * this.w, 'torso');
    set(3, J.PELVIS, 0, 0.17 * this.w, 'pelvis');
    set(4, J.UARM_L, -0.14 * k, 0.07, 'arm'); set(5, J.UARM_R, -0.14 * k, 0.07, 'arm');
    set(6, J.FARM_L, -0.12 * k, 0.06, 'arm'); set(7, J.FARM_R, -0.12 * k, 0.06, 'arm');
    set(8, J.THIGH_L, -0.2 * k, 0.1, 'leg'); set(9, J.THIGH_R, -0.2 * k, 0.1, 'leg');
    set(10, J.SHIN_L, -0.22 * k, 0.07, 'leg'); set(11, J.SHIN_R, -0.22 * k, 0.07, 'leg');
    return 12;
  }
  handWorld(out, right = true) { return out.setFromMatrixPosition(this.world[right ? J.HAND_R : J.HAND_L]); }
  /** Weapon muzzle position/direction (world) for the given weapon length. */
  muzzle(outPos, outDir, len = 0.25) {
    const m = this.gripMatrix(_m);
    outPos.set(0, 0, len).applyMatrix4(m);
    outDir.set(0, 0, 1).transformDirection(m);
    return outPos;
  }
  /** Weapon grip frame in the right hand: barrel (+z) along the fingers, sights (+y) toward the thumb side. */
  gripMatrix(out) { return out.multiplyMatrices(this.world[J.HAND_R], GRIP); }
}

// ---------------------------------------------------------------- geometry for body parts (joint local space)
function lathe(profile, seg, sz = 1, sx = 1) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, seg);
  g.scale(sx, 1, sz);
  g.computeVertexNormals();
  return g;
}
function capsule(r0, r1, len, seg = 10) {
  // tapered capsule from y=0 down to y=-len
  const prof = [];
  const n = 5;
  for (let i = 0; i <= n; i++) { const a = Math.PI / 2 * (1 - i / n); prof.push([Math.cos(a) * r0 * 0.999 + 0.0001, Math.sin(a) * r0]); }
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 * (i / n); prof.push([Math.cos(a) * r1 + 0.0001, -len + Math.sin(a) * r1]); }
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), seg);
  g.computeVertexNormals();
  return g;
}
function ellipsoid(rx, ry, rz, ox = 0, oy = 0, oz = 0, ws = 14, hs = 10) {
  const g = new THREE.SphereGeometry(1, ws, hs); g.scale(rx, ry, rz); g.translate(ox, oy, oz); return g;
}
function mergeGeos(list) {
  const out = [];
  for (const g of list) out.push(g.index ? g.toNonIndexed() : g);
  let n = 0; for (const g of out) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of out) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const r = new THREE.BufferGeometry(); r.setAttribute('position', new THREE.BufferAttribute(pos, 3)); r.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  r.computeBoundingSphere();
  return r;
}
/** Part definitions: joint, geometry (unit person 1.8m), color slot. */
function buildParts() {
  const P = {};
  P.pelvis = { j: J.PELVIS, geo: mergeGeos([ellipsoid(0.165, 0.12, 0.11, 0, -0.02, 0)]), slot: 'pants' };
  P.torso = { j: J.TORSO, geo: lathe([[0.001, -0.02], [0.14, -0.01], [0.15, 0.1], [0.165, 0.24], [0.18, 0.36], [0.17, 0.44], [0.12, 0.5], [0.001, 0.51]], 16, 0.62), slot: 'shirt' };
  P.jacket = { j: J.TORSO, geo: lathe([[0.001, -0.05], [0.155, -0.04], [0.162, 0.1], [0.175, 0.24], [0.19, 0.36], [0.182, 0.45], [0.13, 0.505], [0.001, 0.515]], 16, 0.66), slot: 'jacket' };
  P.vest = { j: J.TORSO, geo: lathe([[0.001, 0.02], [0.17, 0.03], [0.18, 0.2], [0.195, 0.4], [0.14, 0.47], [0.001, 0.48]], 12, 0.72), slot: 'vest' };
  P.tie = { j: J.TORSO, geo: new THREE.BoxGeometry(0.045, 0.3, 0.02).translate(0, 0.3, 0.115), slot: 'tie' };
  P.neck = { j: J.HEAD, geo: capsule(0.05, 0.055, 0.08, 8).translate(0, 0.08, 0), slot: 'skin' };
  P.head = { j: J.HEAD, geo: mergeGeos([ellipsoid(0.095, 0.118, 0.108, 0, 0.16, 0.005), ellipsoid(0.065, 0.045, 0.06, 0, 0.085, 0.035), ellipsoid(0.018, 0.028, 0.02, 0, 0.15, 0.108), ellipsoid(0.014, 0.03, 0.022, 0.094, 0.155, 0), ellipsoid(0.014, 0.03, 0.022, -0.094, 0.155, 0)]), slot: 'skin' };
  P.eyes = { j: J.HEAD, geo: mergeGeos([ellipsoid(0.013, 0.009, 0.006, 0.035, 0.172, 0.101, 8, 6), ellipsoid(0.013, 0.009, 0.006, -0.035, 0.172, 0.101, 8, 6)]), slot: 'eyes' };
  P.brows = { j: J.HEAD, geo: mergeGeos([new THREE.BoxGeometry(0.035, 0.008, 0.01).translate(0.035, 0.19, 0.1), new THREE.BoxGeometry(0.035, 0.008, 0.01).translate(-0.035, 0.19, 0.1)]), slot: 'hair' };
  P.beard = { j: J.HEAD, geo: ellipsoid(0.085, 0.07, 0.085, 0, 0.1, 0.03), slot: 'hair' };
  // hair styles
  const cap = (rx, ry, rz, oy, oz, cut = 0.45) => { const g = new THREE.SphereGeometry(1, 14, 10, 0, TAU, 0, Math.PI * cut); g.scale(rx, ry, rz); g.translate(0, oy, oz); return g; };
  P.hair0 = { j: J.HEAD, geo: cap(0.1, 0.12, 0.112, 0.165, -0.005, 0.42), slot: 'hair' }; // short
  P.hair1 = { j: J.HEAD, geo: mergeGeos([cap(0.104, 0.13, 0.116, 0.16, -0.008, 0.5), ellipsoid(0.1, 0.06, 0.05, 0, 0.12, -0.075)]), slot: 'hair' }; // medium
  P.hair2 = { j: J.HEAD, geo: mergeGeos([cap(0.105, 0.13, 0.117, 0.16, -0.008, 0.52), ellipsoid(0.1, 0.16, 0.06, 0, 0.06, -0.07)]), slot: 'hair' }; // long
  P.hair3 = { j: J.HEAD, geo: mergeGeos([cap(0.104, 0.13, 0.116, 0.16, -0.008, 0.5), capsule(0.035, 0.02, 0.2, 8).rotateX(0.4).translate(0, 0.2, -0.12)]), slot: 'hair' }; // ponytail
  P.hair4 = { j: J.HEAD, geo: mergeGeos([cap(0.104, 0.13, 0.116, 0.16, -0.008, 0.5), ellipsoid(0.055, 0.05, 0.05, 0, 0.27, -0.06)]), slot: 'hair' }; // bun
  P.hair5 = { j: J.HEAD, geo: cap(0.13, 0.15, 0.13, 0.17, -0.01, 0.5), slot: 'hair' }; // curly volume
  P.hair6 = { j: J.HEAD, geo: mergeGeos([cap(0.101, 0.115, 0.113, 0.17, 0, 0.36)]), slot: 'hair' }; // fade
  // hats
  P.hat1 = { j: J.HEAD, geo: mergeGeos([cap(0.108, 0.07, 0.118, 0.2, 0, 0.5), new THREE.CylinderGeometry(0.11, 0.11, 0.015, 16).translate(0, 0.205, 0.045).scale(1, 1, 1)]), slot: 'hat' }; // police cap
  P.hat2 = { j: J.HEAD, geo: mergeGeos([cap(0.118, 0.1, 0.13, 0.19, 0, 0.5), new THREE.CylinderGeometry(0.15, 0.15, 0.012, 16).translate(0, 0.19, 0)]), slot: 'hat' }; // hard hat
  P.hat3 = { j: J.HEAD, geo: mergeGeos([cap(0.12, 0.13, 0.13, 0.16, 0, 0.56)]), slot: 'hat' }; // helmet
  P.hat4 = { j: J.HEAD, geo: mergeGeos([cap(0.106, 0.09, 0.116, 0.19, 0, 0.5), new THREE.BoxGeometry(0.14, 0.012, 0.09).translate(0, 0.195, 0.12)]), slot: 'hat' }; // cap
  const k = 1;
  P.uarmL = { j: J.UARM_L, geo: capsule(0.058, 0.048, 0.28 * k), slot: 'sleeveU' };
  P.uarmR = { j: J.UARM_R, geo: capsule(0.058, 0.048, 0.28 * k), slot: 'sleeveU' };
  P.farmL = { j: J.FARM_L, geo: capsule(0.046, 0.036, 0.25 * k), slot: 'sleeveF' };
  P.farmR = { j: J.FARM_R, geo: capsule(0.046, 0.036, 0.25 * k), slot: 'sleeveF' };
  const hand = () => mergeGeos([new THREE.BoxGeometry(0.075, 0.09, 0.03).translate(0, -0.05, 0), new THREE.BoxGeometry(0.07, 0.05, 0.028).translate(0, -0.11, 0.004), ellipsoid(0.014, 0.035, 0.014, 0.038, -0.05, 0.012, 6, 5)]);
  P.handL = { j: J.HAND_L, geo: hand(), slot: 'skin' };
  P.handR = { j: J.HAND_R, geo: hand(), slot: 'skin' };
  P.thighL = { j: J.THIGH_L, geo: capsule(0.082, 0.062, 0.44), slot: 'pants' };
  P.thighR = { j: J.THIGH_R, geo: capsule(0.082, 0.062, 0.44), slot: 'pants' };
  P.shinL = { j: J.SHIN_L, geo: capsule(0.058, 0.044, 0.43), slot: 'shin' };
  P.shinR = { j: J.SHIN_R, geo: capsule(0.058, 0.044, 0.43), slot: 'shin' };
  const foot = () => mergeGeos([ellipsoid(0.05, 0.04, 0.12, 0, -0.035, 0.05), new THREE.BoxGeometry(0.095, 0.025, 0.25).translate(0, -0.065, 0.05)]);
  P.footL = { j: J.FOOT_L, geo: foot(), slot: 'shoes' };
  P.footR = { j: J.FOOT_R, geo: foot(), slot: 'shoes' };
  return P;
}
let PARTS = null;
export function getParts() { if (!PARTS) PARTS = buildParts(); return PARTS; }

/** Which parts and colors a rig uses. Returns [[partName, color]] */
function partList(a) {
  const c = new THREE.Color();
  const skin = a.skin;
  const L = [];
  const shirtCol = a.jacket || a.shirt;
  const sleeveU = a.sleeves === 2 ? skin : (a.jacket || a.shirt);
  const sleeveF = a.sleeves === 0 ? (a.jacket || a.shirt) : skin;
  L.push(['pelvis', a.pants], [a.jacket ? 'jacket' : 'torso', shirtCol], ['neck', skin], ['head', skin], ['eyes', 0x1a1a1a], ['brows', a.hairColor]);
  if (a.jacket) L.push(['torso', a.shirt]);
  if (a.vest) L.push(['vest', 0x2b2b2b]);
  if (a.tie) L.push(['tie', 0x8b1e2d]);
  if (a.beard) L.push(['beard', a.hairColor]);
  if (a.hat) L.push(['hat' + a.hat, a.hat === 1 ? 0x121c2c : a.hat === 2 ? 0xf1c40f : a.hat === 3 ? 0x1c1c1c : a.shirt]);
  else if (a.hair !== 7) L.push(['hair' + a.hair, a.hairColor]);
  L.push(['uarmL', sleeveU], ['uarmR', sleeveU], ['farmL', sleeveF], ['farmR', sleeveF], ['handL', a.role === 'swat' ? 0x111111 : skin], ['handR', a.role === 'swat' ? 0x111111 : skin]);
  L.push(['thighL', a.pants], ['thighR', a.pants], ['shinL', a.shorts ? skin : a.pants], ['shinR', a.shorts ? skin : a.pants], ['footL', a.shoes], ['footR', a.shoes]);
  return L;
}

// ---------------------------------------------------------------- instanced renderer for all characters
export class CrowdRenderer {
  constructor(scene, max = 128) {
    this.max = max;
    const parts = getParts();
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.0 });
    this.skinMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.0 });
    this.mat.envMapIntensity = 1.7; this.skinMat.envMapIntensity = 1.7;
    // soft fill so characters never read as black silhouettes when backlit
    this.fill = { value: 0.08 };
    for (const m of [this.mat, this.skinMat]) {
      m.onBeforeCompile = (sh) => { sh.uniforms.uFill = this.fill; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uFill;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uFill;'); };
      m.customProgramCacheKey = () => 'crowdfill';
    }
    this.meshes = {};
    this.shadowMeshes = {};
    const skinParts = new Set(['head', 'neck', 'handL', 'handR']);
    for (const [name, p] of Object.entries(parts)) {
      const m = new THREE.InstancedMesh(p.geo, skinParts.has(name) ? this.skinMat : this.mat, max);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true;
      m.name = 'char_' + name;
      scene.add(m);
      this.meshes[name] = m;
      if (name !== 'eyes' && name !== 'brows' && name !== 'tie') {
        const sm = new THREE.InstancedMesh(p.geo, this.mat, max);
        sm.count = 0; sm.frustumCulled = false; sm.castShadow = true; sm.layers.set(1);
        scene.add(sm); this.shadowMeshes[name] = sm;
      }
    }
    this._m = new THREE.Matrix4(); this._c = new THREE.Color();
  }
  /** Render all visible rigs. rigs: array of CharacterRig; shadowFocus: Vector3 to limit shadow casters. */
  render(rigs, cameraPos = null, maxDist = 180, shadowFocus = null) {
    const parts = getParts();
    for (const k in this.meshes) this.meshes[k].count = 0;
    for (const k in this.shadowMeshes) this.shadowMeshes[k].count = 0;
    const md2 = maxDist * maxDist;
    for (const rig of rigs) {
      if (!rig.visible) continue;
      const rp = rig.root.position;
      if (cameraPos) { const dx = rp.x - cameraPos.x, dz = rp.z - cameraPos.z; if (dx * dx + dz * dz > md2) continue; }
      const castShadow = !shadowFocus || (Math.abs(rp.x - shadowFocus.x) < 60 && Math.abs(rp.z - shadowFocus.z) < 60);
      if (!rig._parts) rig._parts = partList(rig.app).map(([n, col]) => [n, new THREE.Color(col)]);
      const k = rig.k, w = rig.w;
      for (const [name, col] of rig._parts) {
        const m = this.meshes[name]; if (!m || m.count >= this.max) continue;
        const p = parts[name];
        // scale: parts modelled for 1.8m; width by build
        const wide = name === 'torso' || name === 'jacket' || name === 'vest' || name === 'pelvis';
        this._m.makeScale(k * (wide ? w : 1 + (w - 1) * 0.5), k, k * (wide ? w : 1 + (w - 1) * 0.5));
        this._m.premultiply(rig.world[p.j]);
        m.setMatrixAt(m.count, this._m);
        m.instanceColor.setXYZ(m.count, col.r, col.g, col.b);
        m.count++;
        if (castShadow) { const sm = this.shadowMeshes[name]; if (sm && sm.count < this.max) { sm.setMatrixAt(sm.count, this._m); sm.count++; } }
      }
    }
    for (const k in this.meshes) { const m = this.meshes[k]; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    for (const k in this.shadowMeshes) this.shadowMeshes[k].instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- weapons
import { PB } from '../world/props.js';
export const WEAPON_LEN = { pistol: 0.2, smg: 0.34, shotgun: 0.62, rifle: 0.68 };
export function buildWeaponGeometry(type) {
  const b = new PB(), D = 0x1c1d1f, P = 0x2b2d30, W = 0x6b4a2b, M = 0x44474b;
  // local: grip at origin, barrel along +z, top toward +y... hand frame: fingers down -y; weapon forward +z
  if (type === 'pistol') {
    b.box(0.032, 0.035, 0.19, 0, 0.0, 0.08, D, 0.35, 0.8).box(0.03, 0.1, 0.045, 0, -0.06, 0.0, P, 0.6, 0.2).box(0.028, 0.02, 0.05, 0, -0.02, 0.05, P, 0.6, 0.2);
  } else if (type === 'smg') {
    b.box(0.045, 0.07, 0.3, 0, 0.0, 0.1, D, 0.4, 0.7).box(0.035, 0.12, 0.04, 0, -0.07, 0.0, P, 0.6, 0.2).box(0.03, 0.14, 0.035, 0, -0.08, 0.12, M, 0.5, 0.6);
    b.cyl(0.012, 0.012, 0.12, 8, 0, 0.0, 0.3, D, 0.3, 0.8, 0, 0, Math.PI / 2).box(0.03, 0.04, 0.16, 0, 0.01, -0.12, P, 0.6, 0.2);
  } else if (type === 'shotgun') {
    b.cyl(0.018, 0.018, 0.62, 10, 0, 0.02, 0.3, D, 0.35, 0.8, 0, 0, Math.PI / 2).cyl(0.02, 0.02, 0.35, 10, 0, -0.02, 0.3, W, 0.6, 0.1, 0, 0, Math.PI / 2);
    b.box(0.045, 0.07, 0.2, 0, 0.0, 0.0, D, 0.4, 0.7).box(0.04, 0.12, 0.3, 0, -0.03, -0.22, W, 0.6, 0.1, 0, 0.3);
  } else {
    b.box(0.045, 0.08, 0.42, 0, 0.0, 0.12, D, 0.4, 0.7).cyl(0.012, 0.012, 0.22, 8, 0, 0.01, 0.43, D, 0.3, 0.8, 0, 0, Math.PI / 2);
    b.box(0.035, 0.11, 0.045, 0, -0.07, 0.0, P, 0.6, 0.2).box(0.03, 0.16, 0.05, 0, -0.09, 0.14, M, 0.5, 0.6).box(0.04, 0.1, 0.24, 0, -0.02, -0.2, P, 0.6, 0.2);
    b.box(0.03, 0.04, 0.12, 0, 0.065, 0.1, D, 0.4, 0.6);
  }
  return b.build();
}
