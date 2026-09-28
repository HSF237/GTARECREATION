// Weapons, hitscan shooting, melee, explosions and damage routing (all original weapon names).
import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { WEAPON_LEN } from '../entities/character.js';

export const WEAPONS = {
  fists: { id: 'fists', name: 'Fists', slot: 0, damage: 14, range: 1.5, rate: 2.6, melee: true },
  pistol: { id: 'pistol', name: 'Harbor 9', slot: 1, damage: 28, rate: 4.5, clip: 12, spread: 0.01, range: 100, sound: 'pistol', price: 450, ammoPrice: 60, ammoPack: 36 },
  smg: { id: 'smg', name: 'Vex SMG', slot: 2, damage: 18, rate: 12, clip: 30, spread: 0.028, range: 80, auto: true, sound: 'smg', price: 1500, ammoPrice: 120, ammoPack: 90 },
  shotgun: { id: 'shotgun', name: 'Breaker 12', slot: 3, damage: 15, pellets: 9, rate: 1.4, clip: 8, spread: 0.075, range: 40, sound: 'shotgun', price: 1900, ammoPrice: 100, ammoPack: 24 },
  rifle: { id: 'rifle', name: 'Kestrel AR', slot: 4, damage: 32, rate: 8.5, clip: 30, spread: 0.014, range: 160, auto: true, sound: 'rifle', price: 3400, ammoPrice: 160, ammoPack: 90 },
};
export const WEAPON_ORDER = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _l = new THREE.Vector3(), _ld = new THREE.Vector3();
const spheres = [];

/** Ray vs sphere; returns t or -1 */
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz, c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c; if (disc < 0) return -1;
  const s = Math.sqrt(disc); let t = -b - s; if (t < 0) t = -b + s; return t;
}
/** Ray vs vehicle OBB; returns t or -1 */
export function rayVehicle(v, o, d, maxT) {
  _q.copy(v.quat).invert();
  _l.copy(o).sub(v.com).applyQuaternion(_q); _ld.copy(d).applyQuaternion(_q);
  const S = v.spec, cy = S.comHeight;
  const mn = [-S.W / 2, -cy + S.clr, -S.L / 2], mx = [S.W / 2, S.H - cy, S.L / 2];
  let t0 = 0, t1 = maxT;
  const oo = [_l.x, _l.y, _l.z], dd = [_ld.x, _ld.y, _ld.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dd[a]) < 1e-8) { if (oo[a] < mn[a] || oo[a] > mx[a]) return -1; continue; }
    let ta = (mn[a] - oo[a]) / dd[a], tb = (mx[a] - oo[a]) / dd[a];
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return -1;
  }
  return t0;
}

/**
 * Trace a bullet. game provides: collision, actors (array with rig, alive, id), vehicles (array).
 * ignore: actor or vehicle to skip. Returns { t, point, normal, actor, part, vehicle, surface }
 */
export function traceShot(game, origin, dir, range, ignore, ignoreVehicle) {
  let best = range, res = { t: range, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), actor: null, part: null, vehicle: null, surface: 'concrete' };
  const hit = game.world.collision.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range, { water: true });
  if (hit) { best = hit.t; res.surface = hit.tag === 'water' ? 'water' : hit.tag === 'terrain' ? game.world.terrain.surfaceAt(hit.x, hit.z) : hit.tag === 'container' ? 'metal' : hit.tag === 'pier' ? 'wood' : 'concrete'; res.normal.set(hit.nx, hit.ny, hit.nz); }
  for (const v of game.vehicles.list) {
    if (v === ignoreVehicle || v.exploded && false) continue;
    const dx = v.com.x - origin.x, dz = v.com.z - origin.z;
    if (dx * dx + dz * dz > (best + 8) * (best + 8)) continue;
    const t = rayVehicle(v, origin, dir, best);
    if (t >= 0 && t < best) { best = t; res.vehicle = v; res.actor = null; res.surface = 'vehicle'; res.normal.copy(dir).negate(); }
  }
  if (game.extraTargets) for (const v of game.extraTargets) {
    if (!v.active || v.exploded || v === ignoreVehicle) continue;
    const t = rayVehicle(v, origin, dir, best);
    if (t >= 0 && t < best) { best = t; res.vehicle = v; res.actor = null; res.surface = 'metal'; res.normal.copy(dir).negate(); }
  }
  for (const a of game.actors()) {
    if (a === ignore || !a.rig || a.removed || a.inVehicle && !a.exposedInVehicle) continue;
    const rp = a.rig.root.position;
    const dx = rp.x - origin.x, dz = rp.z - origin.z;
    // quick reject: distance from ray
    const along = dx * dir.x + dz * dir.z; if (along < -2 || along > best + 2) continue;
    const px = origin.x + dir.x * along - rp.x, pz = origin.z + dir.z * along - rp.z;
    if (px * px + pz * pz > 4) continue;
    const n = a.rig.getHitSpheres(spheres);
    for (let i = 0; i < n; i++) {
      const s = spheres[i];
      const t = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, s.x, s.y, s.z, s.r);
      if (t >= 0 && t < best) { best = t; res.actor = a; res.part = s.part; res.vehicle = null; res.surface = 'flesh'; res.normal.copy(dir).negate(); }
    }
  }
  res.t = best; res.point.copy(origin).addScaledVector(dir, best);
  res.hitSomething = best < range;
  return res;
}

const PART_MULT = { head: 3.2, torso: 1, pelvis: 0.9, arm: 0.6, leg: 0.65 };
/**
 * Fire a weapon. shooter: actor. aimOrigin/aimDir: the aim ray (camera for the player). muzzle: world muzzle pos.
 */
export function fireWeapon(game, shooter, weapon, aimOrigin, aimDir, muzzle, accuracy = 1) {
  const W = WEAPONS[weapon];
  const pellets = W.pellets || 1;
  const fx = game.fx;
  let anyHit = false, killed = false;
  for (let k = 0; k < pellets; k++) {
    const spread = W.spread / Math.max(0.2, accuracy);
    _d.copy(aimDir);
    _d.x += (Math.random() - 0.5) * 2 * spread; _d.y += (Math.random() - 0.5) * 2 * spread; _d.z += (Math.random() - 0.5) * 2 * spread; _d.normalize();
    // find target along the aim ray, then trace from the muzzle toward it (avoids shooting through cover near the shooter)
    const aimHit = traceShot(game, aimOrigin, _d, W.range, shooter, shooter.vehicle);
    const target = aimHit.point;
    _o.copy(muzzle);
    const md = _p.subVectors(target, _o); const ml = md.length(); md.divideScalar(ml || 1);
    const hit = ml > 0.5 ? traceShot(game, _o, md, ml + 0.2, shooter, shooter.vehicle) : aimHit;
    if (k === 0 || Math.random() < 0.3) fx.particles.tracer(_o, hit.point);
    if (hit.hitSomething) {
      anyHit = true;
      if (hit.actor) {
        const dmg = W.damage * (PART_MULT[hit.part] || 1) * (shooter.isPlayer ? 1 : 0.55);
        const died = hit.actor.takeDamage(dmg, { dir: md.clone(), point: hit.point.clone(), part: hit.part, attacker: shooter, weapon });
        if (died) killed = true;
        fx.particles.impact(hit.point, hit.normal, 'flesh');
      } else if (hit.vehicle) {
        hit.vehicle.damage(W.damage * 0.9, hit.point, 'bullet', shooter);
        fx.particles.impact(hit.point, hit.normal, 'metal');
        game.events.emit('bulletHitVehicle', { vehicle: hit.vehicle, shooter });
      } else {
        fx.particles.impact(hit.point, hit.normal, hit.surface);
        if (hit.surface !== 'water') fx.decals.bulletHole(hit.point, hit.normal);
      }
    }
  }
  fx.particles.muzzleFlash(muzzle, aimDir, weapon === 'shotgun' ? 1.5 : weapon === 'pistol' ? 0.8 : 1);
  game.events.emit('gunshot', { shooter, weapon, position: muzzle.clone() });
  return { hit: anyHit, killed };
}

/** Melee punch in front of the attacker. */
export function melee(game, attacker, pos, yaw, damage = 14) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let best = null, bd = 1.7;
  for (const a of game.actors()) {
    if (a === attacker || !a.alive || a.inVehicle) continue;
    const rp = a.rig.root.position, dx = rp.x - pos.x, dz = rp.z - pos.z, d = Math.hypot(dx, dz);
    if (d > bd || Math.abs(rp.y - pos.y) > 1.2) continue;
    if ((dx * fx + dz * fz) / (d || 1) < 0.35) continue;
    best = a; bd = d;
  }
  if (best) {
    const died = best.takeDamage(damage, { dir: new THREE.Vector3(fx, 0.2, fz), point: best.rig.root.position.clone().setY(best.rig.root.position.y + 1.4), part: 'torso', attacker, weapon: 'fists', melee: true });
    game.events.emit('punchHit', { attacker, target: best, died });
    return best;
  }
  return null;
}

/** Explosion: damage/knock actors, damage/push vehicles, break props. */
export function explode(game, pos, radius = 8, attacker = null, source = null) {
  const fx = game.fx;
  fx.particles.explosion(pos, radius / 8);
  const gh = game.world.collision.groundHeight(pos.x, pos.z, pos.y + 1, 2);
  fx.decals.scorch(new THREE.Vector3(pos.x, gh, pos.z), radius * 0.45);
  game.camera.shake(clamp(1.6 - pos.distanceTo(game.camera.camera.position) / 60, 0, 1.4));
  for (const a of game.actors()) {
    if (!a.rig) continue;
    const rp = a.rig.root.position;
    const d = Math.hypot(rp.x - pos.x, rp.y + 1 - pos.y, rp.z - pos.z);
    if (d > radius * 1.3) continue;
    const k = 1 - d / (radius * 1.3);
    const dir = new THREE.Vector3(rp.x - pos.x, 0, rp.z - pos.z).normalize(); dir.y = 0.6;
    if (a.inVehicle && a.vehicle && a.vehicle !== source) continue;
    a.takeDamage(160 * k * k + 10, { dir, explosion: true, force: 14 * k + 3, attacker, point: pos.clone() });
  }
  for (const v of game.vehicles.list) {
    if (v === source) continue;
    const d = v.com.distanceTo(pos);
    if (d > radius * 1.4) continue;
    const k = 1 - d / (radius * 1.4);
    v.wake();
    const dir = new THREE.Vector3().subVectors(v.com, pos).normalize();
    v.vel.addScaledVector(dir, 9 * k); v.vel.y += 5 * k;
    v.angVel.x += (Math.random() - 0.5) * 3 * k; v.angVel.z += (Math.random() - 0.5) * 3 * k;
    v.damage(900 * k * k, v.com, 'explosion', attacker);
  }
  game.world.breakPropsInRadius(pos, radius * 0.6);
  game.events.emit('explosionFx', { position: pos, radius, attacker });
}
