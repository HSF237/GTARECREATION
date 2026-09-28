// Player controller: Remy Castillo (original character). On-foot movement, weapons, driving, drive-bys.
import * as THREE from 'three';
import { Actor } from './actor.js';
import { randomAppearance } from '../entities/character.js';
import { makeRng } from '../core/rng.js';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math.js';
import { WEAPONS, WEAPON_ORDER, fireWeapon, melee } from './combat.js';
import { WEAPON_LEN } from '../entities/character.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _md = new THREE.Vector3(), _t = new THREE.Vector3();

export class Player extends Actor {
  constructor(game) {
    super(game, randomAppearance(makeRng(7), { role: 'player' }), { isPlayer: true, health: 200 });
    this.name = 'Remy Castillo';
    this.cash = 350; this.maxArmor = 100;
    this.stamina = 1; this.aiming = false; this.aimPitch = 0;
    this.lastVehicle = null; this.controlEnabled = true;
    this.owned = new Set();
    this.stats = { kills: 0, distanceDriven: 0, jumps: 0, shots: 0, hits: 0, crashes: 0 };
    this.invulnerable = 0;
  }

  /** Main per-frame control. */
  control(dt, input, cam) {
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    const game = this.game;
    if (this.state === 'dead') { this.updateState(dt); this.updateAnim(dt); return; }
    const ctl = this.controlEnabled && !game.paused;
    // weapon selection
    if (ctl) this._weaponSelect(input);
    if (this.state === 'toDoor') {
      if (ctl && (Math.abs(input.axis('moveX')) + Math.abs(input.axis('moveY')) > 0.5 && this.enter && this.enter.t > 0.25)) this.cancelEnter();
      else { this.updateToDoor(dt, true); this.updateAnim(dt); return; }
    }
    const busy = this.updateState(dt);
    if (this.inVehicle && this.state === 'normal') { this._drive(dt, input, cam, ctl); this.updateAnim(dt, { mode: 'sit', wheel: this.vehicle ? -this.vehicle.steer * 1.5 : 0, aim: this.aiming, aimPitch: this.aimPitch, fire: this._fired }); this._fired = false; return; }
    if (busy) { this.updateAnim(dt); return; }
    this._onFoot(dt, input, cam, ctl);
  }

  _weaponSelect(input) {
    for (let i = 0; i < 5; i++) if (input.pressed('weapon' + (i + 1))) this.selectWeapon(WEAPON_ORDER[i]);
    if (input.wheel && !this.inVehicle) {
      const owned = WEAPON_ORDER.filter(w => this.hasWeapon(w));
      let i = owned.indexOf(this.weapon); if (i < 0) i = 0;
      i = (i + (input.wheel > 0 ? 1 : -1) + owned.length) % owned.length;
      this.selectWeapon(owned[i]);
    }
    if (input.pressed('reload')) this.startReload();
  }
  selectWeapon(w) {
    if (!this.hasWeapon(w) || this.weapon === w) return;
    this.weapon = w; this.reloadT = 0; this.fireCooldown = 0.25;
    this.game.events.emit('weaponSwitch', { actor: this, weapon: w });
  }
  hasWeapon(w) { return w === 'fists' || this.owned.has(w); }
  startReload() {
    const w = this.weapon, W = WEAPONS[w];
    if (W.melee || this.reloadT > 0 || (this.ammo[w] || 0) <= 0 || this.clip[w] >= W.clip) return;
    this.reloadT = w === 'shotgun' ? 1.6 : w === 'rifle' ? 1.5 : 1.2;
    this.game.events.emit('reload', { actor: this, weapon: w });
  }
  _finishReload() {
    const w = this.weapon, W = WEAPONS[w];
    const need = W.clip - this.clip[w], take = Math.min(need, this.ammo[w] || 0);
    this.clip[w] += take; this.ammo[w] -= take;
  }
  /** Fire logic. Returns true if a shot/punch happened. */
  _tryFire(dt, want, pressed, aimOrigin, aimDir, accuracy) {
    const w = this.weapon, W = WEAPONS[w];
    this.fireCooldown -= dt;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { this.reloadT = 0; this._finishReload(); } return false; }
    const trigger = W.auto ? want : pressed;
    if (!trigger || this.fireCooldown > 0) return false;
    if (W.melee) {
      this.fireCooldown = 1 / W.rate;
      melee(this.game, this, this.pos, this.yaw, W.damage * 1.4);
      this.game.events.emit('punch', { actor: this });
      return 'punch';
    }
    if ((this.clip[w] || 0) <= 0) {
      if ((this.ammo[w] || 0) > 0) this.startReload(); else { this.game.events.emit('dryFire', { actor: this }); this.fireCooldown = 0.35; }
      return false;
    }
    this.clip[w]--; this.fireCooldown = 1 / W.rate;
    const muzzle = this.inVehicle ? this._vehicleMuzzle(aimDir) : this.rig.muzzle(_m, _md, WEAPON_LEN[w] || 0.25);
    const res = fireWeapon(this.game, this, w, aimOrigin, aimDir, muzzle, accuracy);
    this.stats.shots++; if (res.hit) this.stats.hits++;
    this.game.camera.shake(w === 'shotgun' ? 0.35 : w === 'rifle' ? 0.14 : w === 'smg' ? 0.08 : 0.12);
    this.game.camera.recoil = (this.game.camera.recoil || 0) + (w === 'shotgun' ? 0.035 : w === 'pistol' ? 0.014 : 0.008);
    if (this.clip[w] === 0 && (this.ammo[w] || 0) > 0) this.startReload();
    return true;
  }
  _vehicleMuzzle(dir) {
    const v = this.vehicle;
    const p = v.localToWorld(_t.set(0.55 * this.seatSide, v.spec.box ? v.spec.seat.y + 0.7 : v.spec.beltY + 0.25, v.spec.seat.z + 0.2), _m);
    return p.addScaledVector(dir, 0.6);
  }
  /** Aim ray from camera, pushed forward to the player's depth so we never hit things behind them. */
  _aimRay(cam) {
    cam.aimRay(_o, _d);
    const c = this.chest;
    const along = Math.max(0, (c.x - _o.x) * _d.x + (c.y - _o.y) * _d.y + (c.z - _o.z) * _d.z);
    _o.addScaledVector(_d, along);
    return _d;
  }

  _onFoot(dt, input, cam, ctl) {
    const mx = ctl ? input.axis('moveX') : 0, my = ctl ? input.axis('moveY') : 0;
    const cy = cam.yaw;
    const fx = Math.sin(cy), fz = Math.cos(cy);
    let wx = fx * my - fz * mx, wz = fz * my + fx * mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const W = WEAPONS[this.weapon];
    this.aiming = ctl && input.down('aim') && !this.swimming;
    const firing = ctl && input.down('fire') && !this.swimming;
    const sprint = ctl && input.down('sprint') && !this.aiming && wl > 0.2;
    const walk = ctl && input.down('walk');
    // stamina
    if (sprint) this.stamina = Math.max(0, this.stamina - dt * 0.12); else this.stamina = Math.min(1, this.stamina + dt * 0.2);
    let speed = walk ? 1.7 : this.aiming ? (W.melee ? 3.2 : 2.4) : sprint ? (this.stamina > 0.02 ? 7.2 : 5.2) : 4.4;
    if (this.swimming) speed = sprint ? 3.0 : 2.0;
    const combatFacing = this.aiming || (firing && !W.melee) || this._faceAimT > 0;
    this._faceAimT = Math.max(0, (this._faceAimT || 0) - dt);
    if (firing && !W.melee) this._faceAimT = 0.6;
    if (combatFacing) this.yaw = dampAngle(this.yaw, cy, 18, dt);
    else if (wl > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(wx, wz), this.swimming ? 4 : 12, dt);
    const jump = ctl && input.pressed('jump') && !this.aiming;
    this.physics(dt, wx * speed, wz * speed, jump, 40, 110); // brisk start, near-instant stop: motion tracks the key 1:1
    // aim pitch from camera
    this.aimPitch = damp(this.aimPitch, -this.game.camera.pitch + 0.08, 20, dt);
    // shooting / punching
    let fired = false, punched = false;
    if (!this.swimming) {
      const dir = this._aimRay(cam);
      const r = this._tryFire(dt, firing, ctl && input.pressed('fire'), _o, dir, this.aiming ? 1 : 0.55);
      if (r === 'punch') punched = true; else if (r) fired = true;
    }
    // enter vehicle
    if (ctl && input.pressed('enter')) this.tryEnterNearest();
    // head follows where the camera looks (not when the camera is round the front, and not while aiming)
    const aimed = this.aiming || (firing && !W.melee) || this._faceAimT > 0;
    const off = wrapAngle(cy - this.yaw);
    const look = !aimed && Math.abs(off) < 2.0 ? { lookYaw: off * 0.85, lookPitch: clamp(-this.game.camera.pitch * 0.6 + 0.05, -0.4, 0.35) } : {};
    this.updateAnim(dt, { aim: aimed, aimPitch: this.aimPitch, fire: fired, punch: punched, ...look });
  }
  tryEnterNearest() {
    let best = null, bd = 5.5, side = 1;
    for (const v of this.game.vehicles.list) {
      if (v.exploded || v.spec.class === 'heli') continue;
      const dx = v.com.x - this.pos.x, dz = v.com.z - this.pos.z;
      if (dx * dx + dz * dz > 100) continue;
      if (Math.abs(v.com.y - this.pos.y) > 3) continue;
      for (const s of [1, -1]) {
        if (s === -1 && v.driver) continue;
        const d = this.doorWorld(v, s, _t); const dd = Math.hypot(d.x - this.pos.x, d.z - this.pos.z) + (s === -1 ? 0.8 : 0);
        if (dd < bd) { bd = dd; best = v; side = s; }
      }
    }
    if (!best) return false;
    // passenger door: slide over to the driver seat (enter via passenger side, sit on driver side)
    if (best.ai) best.ai.hold = 3;
    this.beginEnter(best, side);
    if (side === -1) this.enter.slide = true;
    return true;
  }
  _startEntering() {
    super._startEntering();
  }
  _updateEntering(dt) {
    super._updateEntering(dt);
    if (this.inVehicle && this.seatSide === -1 && !this.vehicle.driver) { // slide across
      this.vehicle.passenger = null; this.vehicle.driver = this; this.seatSide = 1; this.vehicle.wake();
    }
  }

  _drive(dt, input, cam, ctl) {
    const v = this.vehicle;
    this.lastVehicle = v;
    if (this.seatSide !== 1) { // passenger: only exit
      if (ctl && input.pressed('enter')) this.beginExit();
      return;
    }
    const c = v.controls;
    if (ctl) {
      c.throttle = input.axis('throttle'); c.brake = input.axis('brake'); c.steer = input.axis('steer'); c.handbrake = input.down('handbrake');
      v.horn = input.down('horn');
      if (input.pressed('camera')) cam.vehicleCamIndex++;
      if (input.pressed('enter')) { c.throttle = 0; c.brake = 0; c.handbrake = true; this.beginExit(); }
      if (input.pressed('lights')) v.lightsOverride = !v.lightsOverride;
    } else { c.throttle = 0; c.brake = 1; c.steer = 0; c.handbrake = true; v.horn = false; }
    if (v.mode !== 'dynamic') v.wake();
    // unflip assist
    if ((v.flipTimer || 0) > 2.5) {
      const o = v.origin(_t); const yaw = v.yaw;
      v.place(o.x, this.game.world.collision.groundHeight(o.x, o.z, o.y + 2, 1) + 0.4, o.z, yaw);
      v.mode = 'dynamic'; v.flipTimer = 0;
    }
    // drive-by
    const W = WEAPONS[this.weapon];
    this.aiming = ctl && input.down('aim') && !W.melee && (this.weapon === 'pistol' || this.weapon === 'smg');
    if (this.aiming) {
      const dir = this._aimRay(cam);
      if (this._tryFire(dt, input.down('fire'), input.pressed('fire'), _o, dir, 0.7)) this._fired = true;
    } else if (this.reloadT > 0) this._tryFire(dt, false, false, _o, _d, 1);
    this.stats.distanceDriven += v.speed * dt;
  }

  heal(amount) { this.health = Math.min(this.maxHealth, this.health + amount); }
  addArmor(amount) { this.armor = Math.min(this.maxArmor, this.armor + amount); }
  addCash(n) { this.cash = Math.max(0, Math.round(this.cash + n)); this.game.events.emit('cash', { amount: n, total: this.cash }); }
  respawn(x, y, z, yaw) {
    if (this.rig.ragdoll) this.rig.stopRagdoll();
    this.alive = true; this.health = this.maxHealth; this.state = 'normal'; this.stateT = 0; this.deadT = 0;
    this.inVehicle = false; this.vehicle = null; this.enter = null; this.rig.visible = true;
    this.place(x, y, z, yaw); this.invulnerable = 3;
  }
}
