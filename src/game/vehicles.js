// Vehicle manager: spawning, parked-car population, physics sub-stepping, vehicle/vehicle and
// vehicle/pedestrian collisions, prop smashing + debris, and per-vehicle effects (skids, smoke, fire, lights).
import * as THREE from 'three';
import { Vehicle, collideVehicles } from '../entities/vehicle.js';
import { WheelRenderer } from '../entities/vehicleModels.js';
import { makeRng, hash2 } from '../core/rng.js';
import { clamp } from '../core/math.js';

const DISTRICT_TYPES = {
  downtown: ['sedan', 'sedan', 'compact', 'suv', 'sports', 'taxi', 'sedan', 'muscle', 'suv'],
  midtown: ['sedan', 'compact', 'suv', 'sedan', 'pickup', 'van', 'taxi', 'compact'],
  midtown2: ['sedan', 'compact', 'suv', 'sedan', 'pickup', 'van', 'taxi'],
  oldquarter: ['compact', 'sedan', 'van', 'compact', 'muscle', 'pickup', 'sedan'],
  palmshore: ['sports', 'compact', 'sedan', 'muscle', 'suv', 'super', 'compact', 'sports'],
  linden: ['suv', 'sedan', 'compact', 'sedan', 'pickup', 'sports', 'suv'],
  ironworks: ['pickup', 'van', 'truck', 'pickup', 'sedan', 'van', 'muscle'],
  saltgate: ['van', 'truck', 'pickup', 'pickup', 'compact', 'van'],
  crestline: ['suv', 'sports', 'super', 'sedan', 'suv', 'muscle', 'sports'],
};
export function typeForDistrict(district, rng) {
  const l = DISTRICT_TYPES[district] || DISTRICT_TYPES.midtown;
  return l[Math.floor(rng.next() * l.length)];
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class VehicleManager {
  constructor(game) {
    this.game = game; this.list = [];
    this.wheels = new WheelRenderer(game.scene, 640);
    this.rng = makeRng(4242);
    this.parkT = 0; this.parked = new Map(); this.usedSpots = new Set();
    this.debris = []; this.brokenProps = [];
    this.maxParked = game.quality === 'low' ? 26 : 44;
    // parking spatial buckets
    this.cell = 64; this.buckets = new Map();
    const P = game.city.parking;
    for (let i = 0; i < P.length; i++) { const k = this._key(P[i].x, P[i].z); let a = this.buckets.get(k); if (!a) this.buckets.set(k, a = []); a.push(i); }
    const ev = game.events;
    ev.on('propHit', (e) => this._propHit(e));
    ev.on('vehicleImpact', (e) => { if (e.vehicle.driver && e.vehicle.driver.isPlayer && e.speed > 6) game.camera.shake(clamp(e.speed / 25, 0.1, 0.8)); if (e.speed > 5) game.fx.particles.sparks(e.point, Math.min(20, e.speed | 0)); });
  }
  _key(x, z) { return Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell); }
  spawn(type, x, y, z, yaw, opts = {}) {
    const v = new Vehicle(this.game.world, type, opts);
    v.place(x, y, z, yaw);
    v.sync();
    this.list.push(v);
    return v;
  }
  remove(v) {
    const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1);
    if (v.parkIndex != null) this.parked.delete(v.parkIndex);
    for (let k = 0; k < 4; k++) this.game.fx.decals.skidEnd(v.id * 4 + k);
    v.dispose(); v.removed = true;
  }
  /** Is a vehicle in use by anything the game cares about? */
  _keep(v) {
    const p = this.game.player;
    return v.driver || v.passenger || v === p.lastVehicle || v.keep || v.ai || (p.enter && p.enter.vehicle === v);
  }

  // ------------------------------------------------------------------ parked cars
  populateParked(focus, force = false) {
    const c = this.cell, R = 150, R2 = R * R;
    const P = this.game.city.parking;
    const cam = this.game.camera.camera;
    // despawn far parked cars
    for (const [idx, v] of this.parked) {
      const dx = v.com.x - focus.x, dz = v.com.z - focus.z;
      if (dx * dx + dz * dz > 230 * 230 && !this._keep(v)) { this.remove(v); }
    }
    for (const idx of [...this.usedSpots]) { const s = P[idx]; if ((s.x - focus.x) ** 2 + (s.z - focus.z) ** 2 > 260 * 260) this.usedSpots.delete(idx); }
    if (this.parked.size >= this.maxParked) return;
    const cand = [];
    for (let ox = -3; ox <= 3; ox++) for (let oz = -3; oz <= 3; oz++) {
      const a = this.buckets.get((Math.floor(focus.x / c) + ox) * 100003 + Math.floor(focus.z / c) + oz); if (!a) continue;
      for (const i of a) {
        if (this.parked.has(i) || this.usedSpots.has(i)) continue;
        const s = P[i], d2 = (s.x - focus.x) ** 2 + (s.z - focus.z) ** 2;
        if (d2 > R2) continue;
        const occ = hash2(Math.round(s.x * 3), Math.round(s.z * 3)) ;
        if (occ > (s.kind === 'street' ? 0.38 : s.kind === 'lot' ? 0.5 : s.kind === 'police' ? 0.9 : 0.6)) continue;
        if (!force && d2 < 70 * 70) { // avoid popping in right in front of the camera
          _v.set(s.x - cam.position.x, 0, s.z - cam.position.z); const fw = cam.getWorldDirection(_v2);
          if (_v.x * fw.x + _v.z * fw.z > 0) continue;
        }
        cand.push([d2, i]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    let budget = force ? 60 : 3;
    for (const [, i] of cand) {
      if (this.parked.size >= this.maxParked || budget-- <= 0) break;
      const s = P[i];
      // don't spawn inside another vehicle
      let blocked = false;
      for (const v of this.list) if ((v.com.x - s.x) ** 2 + (v.com.z - s.z) ** 2 < 16) { blocked = true; break; }
      if (blocked) { this.usedSpots.add(i); continue; }
      const rng = makeRng(i * 7919 + 13);
      const type = s.kind === 'police' ? 'police' : typeForDistrict(s.district, rng);
      const v = this.spawn(type, s.x, s.y, s.z, s.yaw, { seed: i * 31 + 7 });
      v.parkIndex = i; v.mode = 'parked';
      this.parked.set(i, v);
    }
  }

  // ------------------------------------------------------------------ collisions with actors
  /** Push an actor's proposed position (nx,nz) out of vehicles. Returns {x,z} or null. */
  pushActor(actor, nx, nz) {
    let moved = null; const r = actor.radius + 0.05;
    for (const v of this.list) {
      if (v === actor.vehicle || v.exploded && false) continue;
      const dx = nx - v.com.x, dz = nz - v.com.z;
      const S = v.spec, rr = S.L / 2 + 1;
      if (dx * dx + dz * dz > rr * rr) continue;
      const oy = v.com.y - S.comHeight;
      if (actor.pos.y > oy + S.H - 0.2 || actor.pos.y + 1.7 < oy) continue;
      const yaw = v.yaw, ca = Math.cos(yaw), sa = Math.sin(yaw);
      const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
      const hx = S.W / 2 + r, hz = S.L / 2 + r;
      if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) continue;
      const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
      let ox = 0, oz = 0;
      if (px < pz) ox = Math.sign(lx) * px; else oz = Math.sign(lz) * pz;
      // local -> world: x = ca*lx + sa*lz ; z = -sa*lx + ca*lz
      nx += ca * ox + sa * oz; nz += -sa * ox + ca * oz;
      moved = moved || {}; moved.x = nx; moved.z = nz;
    }
    return moved;
  }
  _hitActors(v) {
    const sp = v.speed; if (sp < 2.5) return;
    const S = v.spec;
    for (const a of this.game.actors()) {
      if (a.inVehicle || a.state === 'entering' || a.state === 'exiting' || a.removed) continue;
      const dx = a.pos.x - v.com.x, dz = a.pos.z - v.com.z, rr = S.L / 2 + 1.2;
      if (dx * dx + dz * dz > rr * rr) continue;
      const oy = v.com.y - S.comHeight;
      if (a.pos.y > oy + S.H || a.pos.y + 1.7 < oy - 0.2) continue;
      const yaw = v.yaw, ca = Math.cos(yaw), sa = Math.sin(yaw);
      const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
      if (Math.abs(lx) > S.W / 2 + 0.45 || Math.abs(lz) > S.L / 2 + 0.45) continue;
      const d = Math.hypot(dx, dz) || 1;
      const closing = (v.vel.x * dx + v.vel.z * dz) / d - (a.vel.x * dx + a.vel.z * dz) / d;
      if (closing < 2.2 || (a.hitCooldown || 0) > 0) continue;
      a.hitCooldown = 0.6;
      const k = closing;
      const dmg = Math.pow(Math.max(0, k - 2), 1.55) * 2.2;
      const dir = new THREE.Vector3(v.vel.x, 0, v.vel.z).normalize();
      const died = a.takeDamage(dmg, { dir, force: k * 0.9 + 1, attacker: v.driver, vehicleHit: v, point: a.chest.clone() });
      if (!died && a.alive) a.knockdown(new THREE.Vector3(v.vel.x * 0.85, 2 + k * 0.12, v.vel.z * 0.85));
      else if (a.rig.ragdoll) a.rig.pushRagdoll(new THREE.Vector3(v.vel.x * 0.85, 2 + k * 0.12, v.vel.z * 0.85));
      if (v.mode === 'dynamic') v.vel.multiplyScalar(0.96);
      this.game.events.emit('pedHit', { vehicle: v, actor: a, speed: k, died });
    }
  }

  // ------------------------------------------------------------------ props
  _propHit(e) {
    const c = e.contact, v = e.vehicle;
    const idx = c.data && c.data.prop;
    if (idx == null) return;
    const cr = this.game.cityRenderer;
    const info = cr.breakProp(idx);
    if (!info) return;
    this.brokenProps.push({ idx, t: 0 });
    v.vel.multiplyScalar(info.kind === 'lamp' ? 0.82 : 0.93);
    const fx = this.game.fx.particles;
    const p = _v.set(info.x, info.y + 0.5, info.z);
    if (info.kind === 'hydrant') this.game.fountains = (this.game.fountains || []).concat([{ x: info.x, y: info.y, z: info.z, t: 10 }]);
    if (info.kind === 'lamp' || info.kind === 'parkLamp' || info.kind === 'meter') fx.sparks(p, 12);
    if (info.kind === 'trash' || info.kind === 'newsbox') fx.dust(p, 1, [0.5, 0.5, 0.45]);
    const m = cr.createDebris(info.kind, info.variant);
    if (m) {
      m.position.set(info.x, info.y, info.z); m.rotation.y = info.rot;
      this.game.scene.add(m);
      const vel = new THREE.Vector3(v.vel.x * 0.9 + (Math.random() - 0.5) * 2, 2.5 + v.speed * 0.12, v.vel.z * 0.9 + (Math.random() - 0.5) * 2);
      const tall = info.kind === 'lamp' || info.kind === 'parkLamp';
      const ang = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6);
      if (tall) { vel.multiplyScalar(0.25); vel.y = 0.5; const d = new THREE.Vector3(v.vel.x, 0, v.vel.z).normalize(); ang.set(d.z * 2.4, 0, -d.x * 2.4); }
      this.debris.push({ mesh: m, vel, ang, t: 0, tall, rest: false });
      if (this.debris.length > 24) { const o = this.debris.shift(); this.game.scene.remove(o.mesh); }
    }
    this.game.events.emit('propBroken', { kind: info.kind, position: p.clone(), vehicle: v });
  }
  breakPropsInRadius(pos, r) {
    const props = this.game.city.props;
    const col = this.game.city.collision;
    for (let i = 0; i < props.length; i++) {
      const p = props[i]; if (!p.breakable || p.broken) continue;
      if ((p.x - pos.x) ** 2 + (p.z - pos.z) ** 2 > r * r) continue;
      const fake = { vel: new THREE.Vector3(p.x - pos.x, 3, p.z - pos.z).normalize().multiplyScalar(8), speed: 8 };
      this._propHit({ vehicle: fake, contact: { data: { prop: i } } });
    }
  }
  _updateDebris(dt) {
    const col = this.game.city.collision;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]; d.t += dt;
      if (!d.rest) {
        d.vel.y -= 9.8 * dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        _e.set(d.ang.x * dt, d.ang.y * dt, d.ang.z * dt); _q.setFromEuler(_e); d.mesh.quaternion.premultiply(_q);
        const g = col.groundHeight(d.mesh.position.x, d.mesh.position.z, d.mesh.position.y + 0.5, 0.2);
        if (d.mesh.position.y < g + 0.05) {
          d.mesh.position.y = g + 0.05;
          d.vel.y = Math.abs(d.vel.y) * 0.25; d.vel.x *= 0.6; d.vel.z *= 0.6; d.ang.multiplyScalar(0.55);
          if (d.tall) { d.ang.multiplyScalar(0.3); }
          if (d.vel.lengthSq() < 0.3 && d.ang.lengthSq() < 0.3) d.rest = true;
        }
        if (d.tall) { // lamp posts fall over and lie flat
          const up = _v.set(0, 1, 0).applyQuaternion(d.mesh.quaternion);
          if (up.y < 0.08) { d.ang.set(0, 0, 0); d.rest = d.mesh.position.y <= g + 0.1; }
        }
      }
      if (d.t > 40) { this.game.scene.remove(d.mesh); this.debris.splice(i, 1); }
    }
    // restore broken props when far away
    const f = this.game.focus;
    for (let i = this.brokenProps.length - 1; i >= 0; i--) {
      const b = this.brokenProps[i]; b.t += dt;
      const p = this.game.city.props[b.idx];
      if (b.t > 45 && (p.x - f.x) ** 2 + (p.z - f.z) ** 2 > 200 * 200) { this.game.cityRenderer.restoreProp(b.idx); this.brokenProps.splice(i, 1); }
    }
    if (this.game.fountains) {
      for (const h of this.game.fountains) { h.t -= dt; if (Math.random() < 0.7) this.game.fx.particles.hydrant(_v.set(h.x, h.y + 0.4, h.z)); }
      this.game.fountains = this.game.fountains.filter(h => h.t > 0);
    }
  }

  // ------------------------------------------------------------------ main update
  update(dt) {
    const game = this.game, focus = game.focus, fx = game.fx;
    this.parkT -= dt;
    if (this.parkT <= 0) { this.parkT = 0.4; this.populateParked(focus); }
    // physics sub-steps
    const list = this.list;
    const sub = clamp(Math.ceil(dt * 120), 1, 8), h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < list.length; i++) if (list[i].mode === 'dynamic') list[i].step(h);
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (a.mode !== 'dynamic' && b.mode !== 'dynamic') continue;
          const imp = collideVehicles(a, b);
          if (imp > 3) this._crash(a, b, imp);
        }
      }
    }
    const night = game.env.nightFactor, time = game.time;
    const cam = game.camera.camera.position;
    this.wheels.begin();
    for (let i = list.length - 1; i >= 0; i--) {
      const v = list[i];
      v.updateTimers(dt);
      // remove wrecks far away / sunk vehicles
      if ((v.exploded || v.drowned > 20) && !v.driver && (v.com.x - focus.x) ** 2 + (v.com.z - focus.z) ** 2 > 160 * 160 && v !== game.player.lastVehicle) { this.remove(v); continue; }
      if (v.com.y < game.world.terrain.waterLevel - 30) { if (!v.driver) { this.remove(v); continue; } }
      const d2 = (v.com.x - cam.x) ** 2 + (v.com.z - cam.z) ** 2;
      const vis = d2 < 520 * 520;
      v.model.root.visible = vis;
      if (v.mode !== 'parked' || v._needsSync !== false) { v.sync(dt, vis ? this.wheels : null); v._needsSync = v.mode !== 'parked'; }
      else if (vis) v.sync(dt, this.wheels);
      if (v.mode !== 'parked') this._hitActors(v);
      if (d2 < 170 * 170) this._effects(v, dt, night, time);
      else if (v._lightsKey !== 0) { v.model.setLights({ head: false }); v._lightsKey = 0; }
      v.hitCooldown = Math.max(0, (v.hitCooldown || 0) - dt);
    }
    this.wheels.end();
    this._updateDebris(dt);
    for (const a of game.actors()) if (a.hitCooldown > 0) a.hitCooldown -= dt;
  }
  _crash(a, b, imp) {
    const mA = a.mass, mB = b.mass;
    const base = Math.pow(Math.max(0, imp - 4), 1.4) * 3.5, dA = base * 2 * (mB / (mA + mB)), dB = base * 2 * (mA / (mA + mB));
    const p = _v.addVectors(a.com, b.com).multiplyScalar(0.5);
    a.damage(dA, p, 'crash', b.driver); b.damage(dB, p, 'crash', a.driver);
    if (imp > 6) this.game.fx.particles.sparks(p, Math.min(24, imp | 0));
    this.game.events.emit('vehicleCrash', { a, b, impact: imp, position: p.clone() });
    const pl = this.game.player;
    if ((a.driver === pl || b.driver === pl) && imp > 5) this.game.camera.shake(clamp(imp / 20, 0.15, 1));
    if (a.ai) a.ai.crashed = (a.ai.crashed || 0) + imp; if (b.ai) b.ai.crashed = (b.ai.crashed || 0) + imp;
  }
  _effects(v, dt, night, time) {
    const fx = this.game.fx, S = v.spec;
    const moving = v.mode !== 'parked';
    // skids + tire smoke
    if (moving && v.mode === 'dynamic') {
      for (let k = 0; k < 4; k++) {
        const w = v.wheelState[k], key = v.id * 4 + k;
        const slip = w.contact ? Math.max(w.slip, v.controls.handbrake && !w.front && v.speed > 3 ? 0.7 : 0) : 0;
        if (slip > 0.3 && v.speed > 2.5 && (w.surface === 'asphalt' || w.surface === 'concrete' || w.surface === 'sidewalk')) {
          fx.decals.skid(key, w.px, w.py, w.pz, clamp(slip, 0.3, 1), S.ww * 0.95);
          if (slip > 0.55 && Math.random() < 0.6) fx.particles.tireSmoke(_v.set(w.px, w.py + 0.2, w.pz), clamp(slip, 0.4, 1.2));
        } else {
          fx.decals.skidEnd(key);
          if (w.contact && v.speed > 6 && (w.surface === 'sand' || w.surface === 'dirt' || w.surface === 'grass') && Math.random() < 0.35) fx.particles.dust(_v.set(w.px, w.py + 0.15, w.pz), 0.8, w.surface === 'grass' ? [0.35, 0.33, 0.22] : [0.72, 0.64, 0.5]);
        }
      }
    }
    // damage smoke / fire
    if (v.health < 450 && !v.exploded) {
      const hood = v.localToWorld(_v.set(0, S.box ? S.H * 0.5 : S.hoodY + 0.1, S.L / 2 - 0.8), _v);
      if (Math.random() < (v.health < 250 ? 0.8 : 0.3)) fx.particles.smoke(hood, v.health < 250 ? 1.2 : 0.6, v.health < 250);
      if (v.burning > 0 && Math.random() < 0.9) fx.particles.fire(hood, 0.9);
    }
    if (v.exploded && Math.random() < 0.3) fx.particles.smoke(_v.copy(v.com).setY(v.com.y + 0.8), 1.1, true);
    if (v.inWater && v.speed > 2 && Math.random() < 0.5) fx.particles.waterSplash(_v.set(v.com.x, this.game.world.terrain.waterLevel, v.com.z), 0.6);
    // lights
    const drv = v.driver || v.ai;
    const head = !!drv && (night > 0.35 || this.game.weather.rain > 0.3) !== !!v.lightsOverride;
    const brake = drv && (v.controls.brake > 0.1 && v.fwdSpeed > 0.5 || (v.ai && v.ai.braking));
    const reverse = drv && v.gear === -1;
    const siren = v.lights.siren ? (v.lights.sirenPhase = (v.lights.sirenPhase + dt * 1.6) % 1) : undefined;
    const key = (head ? 1 : 0) | (brake ? 2 : 0) | (reverse ? 4 : 0) | (siren !== undefined ? 8 : 0) | (v.lights.hazard || v.lights.indL || v.lights.indR ? 16 : 0) | (v.type === 'taxi' && v.lights.taxi ? 32 : 0) | 64;
    if (key !== v._lightsKey || siren !== undefined || (key & 16)) {
      v.model.setLights({ head, brake, reverse, siren, time, indL: v.lights.indL, indR: v.lights.indR, hazard: v.lights.hazard, taxi: v.type === 'taxi' && v.lights.taxi, night });
      v._lightsKey = key;
    }
  }
  /** Nearest vehicle to a point (optionally filtered). */
  nearest(x, z, maxD = 20, filter = null) {
    let best = null, bd = maxD * maxD;
    for (const v of this.list) { if (filter && !filter(v)) continue; const d = (v.com.x - x) ** 2 + (v.com.z - z) ** 2; if (d < bd) { bd = d; best = v; } }
    return best;
  }
}
