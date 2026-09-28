// Hostile crews for missions: guard a spot, get alerted by the player or gunfire, then fight with
// cover-less strafing, bursts and flanking. They can also ride in cars and bail out to fight.
import * as THREE from 'three';
import { randomAppearance, WEAPON_LEN } from '../entities/character.js';
import { makeRng } from '../core/rng.js';
import { clamp, dampAngle } from '../core/math.js';
import { Actor } from './actor.js';
import { fireWeapon } from './combat.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _md = new THREE.Vector3();
const LOS_IGNORE = new Set(['breakable', 'prop', 'fence', 'rail', 'curb', 'piling']);

export class Hostiles {
  constructor(game) {
    this.game = game; this.list = []; this.rng = makeRng(666);
    game.events.on('gunshot', (e) => { if (e.shooter && e.shooter.isPlayer) for (const h of this.list) if (h.a.alive && h.a.pos.distanceTo(e.position) < 60) this.alert(h); });
    game.events.on('actorDamaged', (e) => { const h = this.list.find(q => q.a === e.actor); if (h) { this.alert(h); for (const o of this.list) if (o.group === h.group) this.alert(o); } });
  }
  *actors() { for (const h of this.list) if (!h.a.removed) yield h.a; }
  spawn(x, y, z, o = {}) {
    const app = randomAppearance(this.rng, { role: o.role || 'gang' });
    if (o.colors) Object.assign(app, o.colors);
    const a = new Actor(this.game, app, { health: o.health ?? 100, armor: o.armor || 0 });
    a.isHostile = true; a.weapon = o.weapon || 'pistol'; a.clip[a.weapon] = 999; a.ammo[a.weapon] = 999;
    const g = this.game.city.collision.groundHeight(x, z, y + 1, 0.6);
    a.place(x, g, z, o.yaw ?? this.rng.next() * 6.28);
    const h = { a, state: o.alert ? 'engage' : 'guard', home: new THREE.Vector3(x, g, z), group: o.group || 'default', fireT: 1 + this.rng.next(), burst: 0, strafe: this.rng.next() < 0.5 ? 1 : -1, t: 0, accuracy: o.accuracy ?? 0.7, range: o.range ?? 40, vehicle: null };
    this.list.push(h);
    return h;
  }
  /** Seat a hostile in a vehicle (they bail out and fight when the player is close). */
  seat(h, v, side) { const a = h.a; a.inVehicle = true; a.vehicle = v; a.seatSide = side; if (side === 1) v.driver = a; else v.passenger = a; a.syncSeat(); h.vehicle = v; }
  alert(h) { if (h.state === 'guard') { h.state = 'engage'; h.fireT = 0.6 + this.rng.next() * 0.8; } }
  alive(group) { return this.list.filter(h => h.a.alive && (!group || h.group === group)).length; }
  update(dt) {
    const game = this.game, P = game.player;
    const pp = P.inVehicle && P.vehicle ? P.vehicle.com : P.pos;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i], a = h.a;
      if (a.removed) { this.list.splice(i, 1); continue; }
      if (!a.alive) { h.dead = (h.dead || 0) + dt; a.updateState(dt); a.updateAnim(dt); if (h.dead > 40 && a.pos.distanceTo(pp) > 80) { a.removed = true; } continue; }
      if (a.inVehicle) {
        a.syncSeat(); a.updateAnim(dt, { mode: 'sit' });
        const v = a.vehicle;
        if ((h.state === 'engage' && a.pos.distanceTo(pp) < 30 && v.speed < 5) || v.exploded || v.health < 300 || v.burning > 0) { a.leaveSeat(true); h.vehicle = null; this.alert(h); }
        continue;
      }
      if (a.updateState(dt)) { a.updateAnim(dt); continue; }
      const dx = pp.x - a.pos.x, dz = pp.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
      let vx = 0, vz = 0, aim = false, fire = false;
      if (h.state === 'guard') {
        // idle near home, look around; notice the player when close
        h.t += dt;
        if (d < 22 || (d < 38 && this._los(a.pos, pp))) { if (P.alive) this.alert(h); }
        const hx = h.home.x - a.pos.x, hz = h.home.z - a.pos.z, hd = Math.hypot(hx, hz);
        if (hd > 2) { vx = hx / hd * 1.3; vz = hz / hd * 1.3; a.yaw = dampAngle(a.yaw, Math.atan2(hx, hz), 5, dt); }
        else a.yaw += Math.sin(h.t * 0.4 + i) * dt * 0.3;
      } else if (P.alive) {
        const see = d < 12 || this._los(a.pos, pp);
        a.yaw = dampAngle(a.yaw, Math.atan2(dx, dz), 10, dt);
        const want = a.weapon === 'shotgun' ? 7 : a.weapon === 'pistol' ? 12 : 17;
        if (!see || d > want + 10) { const sp = d > 25 ? 5.4 : 4; vx = dx / d * sp; vz = dz / d * sp; }
        else if (d < want - 5) { vx = -dx / d * 2.4; vz = -dz / d * 2.4; }
        else { vx = -dz / d * 1.8 * h.strafe; vz = dx / d * 1.8 * h.strafe; h.t += dt; if (h.t > 2 + this.rng.next()) { h.t = 0; h.strafe *= -1; } }
        aim = see && d < h.range;
        if (aim) {
          h.fireT -= dt;
          if (h.fireT <= 0) {
            fire = true;
            const W = a.weapon;
            a.rig.muzzle(_m, _md, WEAPON_LEN[W] || 0.25);
            _o.set(a.pos.x, a.pos.y + 1.5, a.pos.z);
            _d.set(pp.x - _o.x, (P.inVehicle ? pp.y + 1 : pp.y + 1.2) - _o.y, pp.z - _o.z).normalize();
            fireWeapon(game, a, W, _o, _d, _m, clamp(h.accuracy + 0.3 - d / 50 - P.speedNow * 0.03, 0.15, 1));
            h.burst++;
            const n = W === 'pistol' ? 3 : W === 'shotgun' ? 1 : 5;
            if (h.burst >= n) { h.burst = 0; h.fireT = 1 + this.rng.next() * 1.4; } else h.fireT = W === 'pistol' ? 0.4 : 0.12;
          }
        }
      }
      a.physics(dt, vx, vz);
      if (a.pos.distanceTo(game.camera.camera.position) < 140) { a.rig.visible = true; a.updateAnim(dt, { aim, fire }); } else a.rig.visible = false;
    }
  }
  _los(a, b) { return this.game.city.collision.lineOfSight(a.x, a.y + 1.6, a.z, b.x, b.y + 1.3, b.z, LOS_IGNORE); }
  clear(group) {
    for (const h of this.list) if (!group || h.group === group) { h.a.removed = true; if (h.a.inVehicle) h.a.leaveSeat(true); }
    this.list = this.list.filter(h => !h.a.removed);
  }
}
