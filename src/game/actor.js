// Actor: a character in the world (player, pedestrian, driver, cop). Shared on-foot physics, damage,
// ragdoll/get-up, and entering/exiting vehicles.
import * as THREE from 'three';
import { CharacterRig } from '../entities/character.js';
import { clamp, damp, dampAngle, wrapAngle, lerp } from '../core/math.js';
import { WEAPONS } from './combat.js';

const contacts = [];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const GRAV = 20;

/** Rig root position (model-local) for a seat. side +1 = driver (left), -1 = passenger. */
export function seatLocal(spec, side, k, out) {
  const pelvis = 0.52 * k;
  if (spec.box) return out.set(side * 0.45, spec.seat.y + 0.01 - pelvis, spec.seat.z);
  return out.set(side * 0.36, spec.clr + 0.4 - pelvis, spec.seat.z);
}
export function doorLocal(spec, side, out) { return out.set(side * (spec.W / 2 + 0.55), 0, spec.seat.z + (spec.box ? 0.25 : 0.1)); }

export class Actor {
  constructor(game, app, opts = {}) {
    this.game = game;
    this.rig = new CharacterRig(app);
    this.app = app; this.role = app.role;
    this.pos = this.rig.root.position;
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.rig.root.yaw = 0;
    this.isPlayer = !!opts.isPlayer; this.isCop = app.role === 'police' || app.role === 'swat';
    this.health = opts.health ?? 100; this.maxHealth = this.health; this.armor = opts.armor || 0;
    this.alive = true; this.grounded = true; this.swimming = false; this.inWaterDepth = 0;
    this.inVehicle = false; this.vehicle = null; this.seatSide = 1; this.exposedInVehicle = false;
    this.weapon = 'fists'; this.ammo = { fists: Infinity }; this.clip = { fists: Infinity };
    this.radius = 0.3;
    this.state = 'normal'; // normal | toDoor | entering | exiting | ragdoll | getUp | dead
    this.stateT = 0;
    this.anim = { speed: 0, localVel: { x: 0, z: 0 }, grounded: true, vy: 0, aim: false, aimPitch: 0, weapon: 'none', fire: false, punch: false, hit: false, mode: 'normal', wheel: 0, accel: 0, turnRate: 0 };
    this.fireCooldown = 0; this.reloadT = 0;
    this.lastAttacker = null; this.hitT = 0; this.deadT = 0;
    this.enter = null; // { vehicle, side, jack, from: Vector3 }
    this.id = Actor.nextId++;
    this.speedNow = 0; this.prevYaw = 0; this.fallStartY = 0;
    this.removed = false;
  }
  static nextId = 1;

  get chest() { return _v2.set(this.pos.x, this.pos.y + 1.35 * this.rig.k, this.pos.z); }
  get headPos() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.65 * this.rig.k, this.pos.z); }
  forwardX() { return Math.sin(this.yaw); }
  forwardZ() { return Math.cos(this.yaw); }
  hasWeapon(w) { return w === 'fists' || (this.ammo[w] || 0) + (this.clip[w] || 0) > 0 || this.owned?.has(w); }
  giveWeapon(w, ammo) {
    if (w === 'fists') return;
    const W = WEAPONS[w];
    if (!this.owned) this.owned = new Set();
    this.owned.add(w);
    if (this.clip[w] == null) { const c = Math.min(W.clip, ammo); this.clip[w] = c; ammo -= c; }
    this.ammo[w] = (this.ammo[w] || 0) + ammo;
  }

  /** Teleport on foot. */
  place(x, y, z, yaw = 0) {
    this.pos.set(x, y, z); this.yaw = yaw; this.rig.root.yaw = yaw; this.vel.set(0, 0, 0); this.grounded = true;
  }

  // ------------------------------------------------------------------ on-foot physics
  /** Move toward desired horizontal velocity (wvx, wvz). */
  physics(dt, wvx, wvz, jump = false, accel = 24, decel = accel * 1.7) {
    const W = this.game.world, col = W.collision, T = W.terrain, p = this.pos;
    // horizontal velocity: accelerate briskly, brake even harder (no sliding after input stops)
    const braking = wvx * wvx + wvz * wvz < this.vel.x * this.vel.x + this.vel.z * this.vel.z - 0.01;
    const k = this.grounded || this.swimming ? (braking ? decel : accel) : accel * 0.12;
    const ax = wvx - this.vel.x, az = wvz - this.vel.z, al = Math.hypot(ax, az), m = k * dt;
    if (al > m) { this.vel.x += ax / al * m; this.vel.z += az / al * m; } else { this.vel.x = wvx; this.vel.z = wvz; }
    // water
    const wl = T.waterLevel;
    const floor = col.groundHeight(p.x, p.z, p.y + 0.05, 0.55);
    this.inWaterDepth = wl - floor;
    const wasSwim = this.swimming;
    this.swimming = this.inWaterDepth > 1.35 && p.y < wl - 0.6;
    if (this.swimming && !wasSwim) { this.game.fx.particles.waterSplash(_v.set(p.x, wl, p.z), clamp(-this.vel.y / 8, 0.5, 1.6)); this.game.events.emit('splash', { actor: this, position: p.clone() }); }
    if (jump && this.grounded && !this.swimming) { this.vel.y = 5.4; this.grounded = false; this.fallStartY = p.y; this.game.events.emit('jump', { actor: this }); }
    // integrate horizontal with sub-steps for fast movement
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vel.x, this.vel.z) * dt / 0.25));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      let nx = p.x + this.vel.x * h, nz = p.z + this.vel.z * h;
      const n = col.collideCircle(nx, nz, this.radius, p.y + 0.56, p.y + 1.75, contacts);
      for (let i = 0; i < n; i++) {
        const c = contacts[i];
        nx += c.nx * c.depth; nz += c.nz * c.depth;
        const vn = this.vel.x * c.nx + this.vel.z * c.nz;
        if (vn < 0) { this.vel.x -= vn * c.nx; this.vel.z -= vn * c.nz; }
      }
      // vehicles as obstacles
      const pv = this.game.vehicles.pushActor(this, nx, nz);
      if (pv) { nx = pv.x; nz = pv.z; }
      // don't walk off into the void of map bounds
      p.x = clamp(nx, -1590, 1590); p.z = clamp(nz, -1690, 1290);
    }
    // vertical
    const g = col.groundHeight(p.x, p.z, p.y + (this.grounded ? 0 : 0.2), this.grounded ? 0.6 : 0);
    if (this.swimming) {
      const target = wl - 1.05 * this.rig.k;
      this.vel.y = 0; p.y = damp(p.y, Math.max(target, g), 6, dt); this.grounded = false;
      if (g > wl - 1.2) this.swimming = false;
    } else if (this.grounded) {
      if (g >= p.y - 0.65) { p.y = g > p.y ? damp(p.y, g, 25, dt) : g; this.vel.y = 0; }
      else { this.grounded = false; this.fallStartY = p.y; }
    }
    if (!this.grounded && !this.swimming) {
      this.vel.y -= GRAV * dt;
      p.y += this.vel.y * dt;
      const g2 = col.groundHeight(p.x, p.z, p.y + 0.3, 0);
      if (p.y <= g2) {
        const impact = -this.vel.y;
        p.y = g2; this.vel.y = 0; this.grounded = true;
        const fall = this.fallStartY - p.y;
        if (fall > 4.2 && impact > 9) {
          const dmg = (fall - 4) * 11;
          this.game.events.emit('land', { actor: this, hard: true });
          if (!this.isPlayer || !this.game.cheats?.god) this.takeDamage(dmg, { fall: true, dir: new THREE.Vector3(this.vel.x, 0, this.vel.z) });
          if (this.alive && fall > 7) this.knockdown(new THREE.Vector3(this.vel.x * 0.5, 1, this.vel.z * 0.5));
        } else if (impact > 3) this.game.events.emit('land', { actor: this, hard: false });
      }
      if (p.y < wl - 3 && !this.swimming) { this.swimming = true; }
    }
    this.speedNow = Math.hypot(this.vel.x, this.vel.z);
  }

  // ------------------------------------------------------------------ animation
  updateAnim(dt, o = {}) {
    const a = this.anim, r = this.rig;
    a.fire = !!o.fire; a.punch = !!o.punch; a.hit = this.hitT > 0.2;
    if (this.hitT > 0) this.hitT -= dt;
    a.aim = !!o.aim; a.aimPitch = o.aimPitch || 0;
    a.weapon = this.weapon === 'fists' ? (a.aim ? 'fists' : 'none') : this.weapon;
    a.grounded = this.grounded; a.vy = this.vel.y;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    a.localVel.z = this.vel.x * fx + this.vel.z * fz; a.localVel.x = this.vel.x * fz - this.vel.z * fx;
    a.speed = this.speedNow;
    a.turnRate = clamp(wrapAngle(this.yaw - this.prevYaw) / Math.max(dt, 1e-3), -4, 4); this.prevYaw = this.yaw;
    a.accel = o.accel || 0;
    let mode = o.mode || 'normal';
    if (this.state === 'dead') mode = 'dead';
    else if (this.inVehicle) mode = 'sit';
    else if (this.state === 'entering' || this.state === 'exiting') mode = this.state === 'entering' ? 'enterCar' : 'exitCar';
    else if (this.state === 'getUp') mode = 'getUp';
    else if (this.swimming) mode = 'swim';
    a.mode = mode;
    a.wheel = o.wheel || 0;
    a.worldVel = this.inVehicle && this.vehicle ? this.vehicle.vel : this.vel;
    a.talking = !!this.talking;
    // where to look: given by the caller, or a brief glance at the player when he comes close
    a.lookYaw = o.lookYaw != null ? o.lookYaw : null; a.lookPitch = o.lookPitch || 0;
    if (a.lookYaw == null && !this.isPlayer && mode === 'normal' && this.alive && this.game.player) {
      this._glanceCd = (this._glanceCd || 0) - dt;
      const P = this.game.player, dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, d2 = dx * dx + dz * dz;
      const rel = wrapAngle(Math.atan2(dx, dz) - this.yaw);
      if (!this._glanceT && this._glanceCd <= 0 && d2 < 36 && d2 > 0.3 && Math.abs(rel) < 1.7) { this._glanceT = 1.2 + Math.random() * 1.8; this._glanceCd = 5 + Math.random() * 7; }
      if (this._glanceT) {
        this._glanceT = Math.max(0, this._glanceT - dt);
        if (d2 < 64 && Math.abs(rel) < 1.9) { a.lookYaw = rel; a.lookPitch = Math.atan2(P.pos.y - this.pos.y, Math.sqrt(d2)) * 0.8; }
        if (this._glanceT === 0) this._glanceT = null;
      }
    }
    r.root.yaw = this.yaw;
    r.update(dt, a);
  }

  // ------------------------------------------------------------------ damage
  takeDamage(dmg, info = {}) {
    if (!this.alive) {
      if (this.rig.ragdoll && (info.dir || info.force)) this.rig.pushRagdoll(_v.copy(info.dir || new THREE.Vector3(0, 1, 0)).multiplyScalar(info.force || 2.5), info.point);
      return false;
    }
    if (this.invulnerable > 0) return false;
    if (this.isPlayer && this.game.cheats?.god) dmg = 0;
    let d = dmg;
    if (this.armor > 0 && !info.fall) { const a = Math.min(this.armor, d * 0.75); this.armor -= a; d -= a; }
    this.health -= d;
    this.hitT = 0.3;
    if (info.attacker) this.lastAttacker = info.attacker;
    this.game.events.emit('actorDamaged', { actor: this, amount: d, info });
    if (this.health <= 0) { this.die(info); return true; }
    if (!this.inVehicle && (info.explosion || (info.force && info.force > 6))) {
      const dir = info.dir ? info.dir.clone() : new THREE.Vector3(0, 1, 0);
      this.knockdown(dir.multiplyScalar(info.force || 6));
    }
    return false;
  }
  die(info = {}) {
    if (!this.alive) return;
    this.alive = false; this.health = 0; this.deadT = 0;
    if (this.inVehicle) {
      const v = this.vehicle;
      if (v && v.exploded) { this.leaveSeat(); this.rig.visible = false; this.state = 'dead'; this.game.events.emit('actorKilled', { actor: this, info }); return; }
      this.leaveSeat(true);
    }
    const dir = info.dir ? _v.copy(info.dir) : _v.set(0, 0, 0);
    const force = info.force || (info.melee ? 3 : info.explosion ? 10 : 2.2);
    const vel = new THREE.Vector3(this.vel.x, 0, this.vel.z).addScaledVector(dir, force);
    if (info.explosion) vel.y += 4;
    this.startRagdoll(vel);
    this.state = 'dead';
    this.game.events.emit('actorKilled', { actor: this, info });
  }
  startRagdoll(vel) {
    const col = this.game.world.collision;
    this.rig.startRagdoll(vel, {
      groundFn: (x, z, y) => col.groundHeight(x, z, y, 0.1),
      collideFn: (p, r) => { const n = col.collideCircle(p.x, p.z, r, p.y - 0.1, p.y + 0.1, contacts); for (let i = 0; i < n; i++) { p.x += contacts[i].nx * contacts[i].depth; p.z += contacts[i].nz * contacts[i].depth; } },
    });
  }
  knockdown(vel) {
    if (this.inVehicle || !this.alive) return;
    if (this.state === 'ragdoll') { this.rig.pushRagdoll(vel); this.stateT = 0; return; }
    this.cancelEnter();
    this.state = 'ragdoll'; this.stateT = 0;
    this.startRagdoll(vel.clone().add(_v.set(this.vel.x, 0, this.vel.z)));
  }
  /** Common per-frame state handling. Returns true if the actor is in a "busy" state (no free control). */
  updateState(dt) {
    this.stateT += dt;
    if (this.state === 'dead') {
      this.deadT += dt;
      if (this.rig.ragdoll && !this.rig.ragdollSettled) { const P = this.rig.rd.P[2]; this.pos.set(P.x, P.y - 0.9, P.z); }
      return true;
    }
    if (this.state === 'ragdoll') {
      const P = this.rig.rd ? this.rig.rd.P[2] : null;
      if (P) this.pos.set(P.x, P.y - 0.9, P.z);
      if ((this.rig.ragdollSettled && this.stateT > 1.2) || this.stateT > 6) {
        this.rig.stopRagdoll();
        this.yaw = this.rig.root.yaw; this.vel.set(0, 0, 0); this.grounded = true;
        this.pos.y = this.game.world.collision.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.8, 0.2);
        this.state = 'getUp'; this.stateT = 0;
      }
      return true;
    }
    if (this.state === 'getUp') { if (this.stateT > 1.0) { this.state = 'normal'; this.stateT = 0; } this.physics(dt, 0, 0); return true; }
    if (this.state === 'entering') { this._updateEntering(dt); return true; }
    if (this.state === 'exiting') { this._updateExiting(dt); return true; }
    if (this.inVehicle) { this.syncSeat(); return true; }
    return false;
  }

  // ------------------------------------------------------------------ vehicles
  /** Start walking to a vehicle door (side +1 driver, -1 passenger). */
  beginEnter(v, side = 1) {
    if (!v || v.exploded || this.inVehicle) return false;
    this.enter = { vehicle: v, side, t: 0, stuck: 0, lastD: 1e9 };
    this.state = 'toDoor'; this.stateT = 0;
    return true;
  }
  cancelEnter() { if (this.state === 'toDoor' || this.state === 'entering') { this.state = 'normal'; } this.enter = null; }
  doorWorld(v, side, out) { return v.localToWorld(doorLocal(v.spec, side, out), out); }
  /** Walk toward the door; returns true while walking. Uses physics at jog speed. */
  updateToDoor(dt, run = true) {
    const e = this.enter; if (!e) { this.state = 'normal'; return false; }
    const v = e.vehicle;
    if (v.exploded || (v.speed > 4 && !v.ai)) { this.cancelEnter(); return false; }
    const door = this.doorWorld(v, e.side, _v);
    const ddx = door.x - this.pos.x, ddz = door.z - this.pos.z, doorDist = Math.hypot(ddx, ddz);
    e.t += dt;
    if (doorDist < 0.55 || (doorDist < 1.3 && e.t > 1.5)) { this._startEntering(); return false; }
    // walk around the car body: head for a corner on the door side when the straight line crosses the car
    const S = v.spec, loc = v.worldToLocal(this.pos, _v2), side = e.side;
    const hw = S.W / 2 + 0.85, hl = S.L / 2 + 0.85;
    let tx, tz, key;
    if (loc.x * side > S.W / 2 - 0.05) { tx = door.x; tz = door.z; key = 0; }
    else {
      const zs = Math.abs(loc.z) > 0.05 ? Math.sign(loc.z) : 1;
      const lx = Math.abs(loc.z) > S.L / 2 + 0.3 ? side * hw : (Math.abs(loc.x) > 0.3 ? Math.sign(loc.x) * hw : side * hw);
      const w = v.localToWorld(_v2.set(lx, 0, zs * hl), _v2); tx = w.x; tz = w.z; key = lx > 0 ? 1 + (zs > 0 ? 0 : 1) : 3 + (zs > 0 ? 0 : 1);
    }
    if (key !== e.wp) { e.wp = key; e.lastD = 1e9; e.stuck = 0; }
    const dx = tx - this.pos.x, dz = tz - this.pos.z, dist = Math.max(Math.hypot(dx, dz), 1e-3);
    if (dist > e.lastD - 0.02) e.stuck += dt; else e.stuck = 0;
    e.lastD = Math.min(e.lastD, dist);
    if (e.stuck > 1.5 || e.t > 12) { this.cancelEnter(); return false; }
    const sp = run ? 4.6 : 2.2;
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 12, dt);
    const vx = dx / dist * sp, vz = dz / dist * sp;
    this.physics(dt, vx, vz);
    return true;
  }
  _startEntering() {
    const e = this.enter, v = e.vehicle;
    const occ = e.side === 1 ? v.driver : v.passenger;
    e.jack = occ && occ !== this ? occ : null;
    if (e.jack) {
      e.jack.leaveSeat(false, true);
      this.game.events.emit('carjack', { actor: this, victim: e.jack, vehicle: v });
    }
    if (e.side === 1) v.driver = this; else v.passenger = this;
    e.from = this.pos.clone(); e.fromYaw = this.yaw;
    this.state = 'entering'; this.stateT = 0;
    this.game.events.emit('doorOpen', { vehicle: v, actor: this });
  }
  _updateEntering(dt) {
    const e = this.enter, v = e.vehicle;
    const dur = e.jack ? 1.35 : 0.85;
    const t = clamp(this.stateT / dur, 0, 1);
    if (v.exploded) { this.state = 'normal'; this.enter = null; if (v.driver === this) v.driver = null; if (v.passenger === this) v.passenger = null; return; }
    const seat = v.localToWorld(seatLocal(v.spec, e.side, this.rig.k, _v), _v);
    const door = this.doorWorld(v, e.side, _v2);
    const k = t < 0.55 ? 0 : (t - 0.55) / 0.45;
    const from = t < 0.55 ? e.from.lerp(door, clamp(dt * 8, 0, 1)) : door;
    this.pos.copy(from).lerp(seat, k * k * (3 - 2 * k));
    this.yaw = dampAngle(this.yaw, v.yaw + (t < 0.4 ? -e.side * Math.PI / 2 : 0), 10, dt);
    if (t >= 1) {
      this.inVehicle = true; this.vehicle = v; this.seatSide = e.side; this.state = 'normal'; this.enter = null;
      this.vel.set(0, 0, 0);
      if (e.side === 1) { v.driver = this; if (v.mode === 'parked' || this.isPlayer) v.wake(); }
      this.game.events.emit('enteredVehicle', { actor: this, vehicle: v });
    }
  }
  /** Leave the seat. forced: thrown out (jacked); instant: no animation */
  leaveSeat(instant = false, jacked = false) {
    const v = this.vehicle || this.enter?.vehicle;
    if (!v) return;
    if (v.driver === this) v.driver = null;
    if (v.passenger === this) v.passenger = null;
    const side = this.seatSide || 1;
    this.inVehicle = false; this.vehicle = null;
    if (instant || jacked) {
      const d = this.doorWorld(v, side, _v);
      const g = this.game.world.collision.groundHeight(d.x, d.z, v.com.y + 1, 0.5);
      this.pos.set(d.x, g, d.z); this.yaw = v.yaw + side * Math.PI / 2;
      this.state = 'normal'; this.stateT = 0; this.grounded = true;
      if (jacked) this.knockdown(new THREE.Vector3(Math.sin(this.yaw) * 2.5, 1.2, Math.cos(this.yaw) * 2.5));
      this.game.events.emit('exitedVehicle', { actor: this, vehicle: v, jacked });
      return;
    }
  }
  /** Begin exiting animation (or bail out if moving fast). */
  beginExit() {
    const v = this.vehicle; if (!v) return;
    if (v.speed > 8) { // bail out
      const vel = v.vel.clone(); const side = this.seatSide;
      this.leaveSeat(true);
      this.knockdown(vel.multiplyScalar(0.75).add(new THREE.Vector3(0, 2, 0)));
      this.takeDamage(Math.min(40, v.speed * 1.2), { fall: true });
      this.game.events.emit('bailOut', { actor: this, vehicle: v, side });
      return;
    }
    this.exitInfo = { vehicle: v, side: this.seatSide };
    this.state = 'exiting'; this.stateT = 0;
    this.game.events.emit('doorOpen', { vehicle: v, actor: this });
  }
  _updateExiting(dt) {
    const ex = this.exitInfo, v = ex.vehicle;
    const t = clamp(this.stateT / 0.75, 0, 1);
    const seat = v.localToWorld(seatLocal(v.spec, ex.side, this.rig.k, _v), _v);
    const door = this.doorWorld(v, ex.side, _v2);
    const g = this.game.world.collision.groundHeight(door.x, door.z, v.com.y + 1, 0.5);
    door.y = g;
    this.pos.copy(seat).lerp(door, t * t * (3 - 2 * t));
    this.yaw = v.yaw + (t > 0.5 ? ex.side * Math.PI / 2 * 0.6 : 0);
    if (t >= 1) {
      if (v.driver === this) v.driver = null;
      if (v.passenger === this) v.passenger = null;
      this.inVehicle = false; this.vehicle = null; this.state = 'normal'; this.stateT = 0; this.grounded = true;
      this.vel.set(0, 0, 0);
      this.game.events.emit('exitedVehicle', { actor: this, vehicle: v });
    }
  }
  /** Keep the rig in the seat. */
  syncSeat() {
    const v = this.vehicle; if (!v) return;
    v.localToWorld(seatLocal(v.spec, this.seatSide, this.rig.k, _v), this.pos);
    this.yaw = v.yaw;
    this.vel.copy(v.vel);
    this.grounded = true; this.swimming = false;
    if (v.inWater && v.drowned > 2.5 && this.alive) { // car sinking: get out and swim
      this.leaveSeat(true);
      this.pos.y = this.game.world.terrain.waterLevel - 1;
      this.swimming = true;
    }
  }
  distanceTo(o) { return Math.hypot(o.x - this.pos.x, o.z - this.pos.z); }
}
