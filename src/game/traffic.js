// Traffic: AI cars that follow lanes on rails (kinematic) with car-following (IDM), traffic signals,
// turn indicators and reactions. When knocked off the rail they drive with real physics back to it.
import * as THREE from 'three';
import { samplePath } from '../world/roads.js';
import { randomAppearance } from '../entities/character.js';
import { makeRng } from '../core/rng.js';
import { clamp, wrapAngle, damp } from '../core/math.js';
import { Actor } from './actor.js';
import { typeForDistrict } from './vehicles.js';

const _s = { x: 0, y: 0, z: 0, dx: 0, dz: 1, slope: 0, seg: 0 };
const _f = new THREE.Vector3(), _v = new THREE.Vector3(), _sph = new THREE.Sphere();
const IDM = { a: 2.4, b: 3.8, s0: 2.6, T: 1.15 };

export class TrafficManager {
  constructor(game) {
    this.game = game; this.cars = []; this.rng = makeRng(99);
    this.spawnT = 0;
    const q = game.quality;
    this.maxCars = q === 'low' ? 16 : q === 'medium' ? 24 : 32;
    this.frustum = new THREE.Frustum(); this._pm = new THREE.Matrix4();
    this.occ = new Map();
    game.events.on('gunshot', (e) => this._alarm(e.position, 45, e.shooter));
    game.events.on('explosionFx', (e) => this._alarm(e.position, 80, e.attacker));
    game.events.on('pedHit', (e) => this._alarm(e.actor.pos, 30, e.vehicle.driver));
  }
  get count() { return this.cars.length; }
  _alarm(pos, r, source) {
    for (const c of this.cars) {
      if (!c.v || c.v.removed) continue;
      const d = Math.hypot(c.v.com.x - pos.x, c.v.com.z - pos.z);
      if (d < r) { c.panic = 10 + this.rng.next() * 8; if (d < r * 0.5 && this.rng.chance(0.3)) c.v.horn = true; }
    }
  }

  // ------------------------------------------------------------------ spawning
  _visible(x, y, z, r = 4) { _sph.center.set(x, y + 1, z); _sph.radius = r; return this.frustum.intersectsSphere(_sph); }
  populate() { for (let k = 0; k < this.maxCars * 5 && this.cars.length < this.maxCars * 0.85; k++) this._trySpawn(this.game.focus, true); }
  _trySpawn(focus, force) {
    const game = this.game, city = game.city, rng = this.rng;
    const ang = rng.next() * Math.PI * 2, dist = force ? 30 + rng.next() * 200 : 100 + rng.next() * 130;
    const x = focus.x + Math.cos(ang) * dist, z = focus.z + Math.sin(ang) * dist;
    const n = city.nearestLane(x, z, null, 30);
    if (!n) return false;
    const lane = n.lane;
    if (lane.length - n.s < 12 || n.s < 4) return false;
    const d2 = (n.x - focus.x) ** 2 + (n.z - focus.z) ** 2;
    if (d2 < 40 * 40) return false;
    if (!force && d2 < 170 * 170 && this._visible(n.x, n.y, n.z)) return false;
    // spacing
    for (const c of this.cars) if (c.seg === lane && Math.abs(c.s - n.s) < 18) return false;
    for (const v of game.vehicles.list) if ((v.com.x - n.x) ** 2 + (v.com.z - n.z) ** 2 < 100) return false;
    const e = city.roads.edges[lane.edge];
    const district = city.districtAt(n.x, n.z).id;
    let type = typeForDistrict(district, rng);
    if ((e.cls === 'avenue' || e.cls === 'boulevard') && rng.chance(0.05)) type = 'bus';
    else if (rng.chance(0.07)) type = 'taxi';
    else if ((district === 'ironworks' || district === 'saltgate') && rng.chance(0.2)) type = 'truck';
    if (e.cls === 'hill' && (type === 'bus' || type === 'truck')) type = 'suv';
    this.spawnCar(type, lane, n.s, lane.speed * (0.6 + rng.next() * 0.3));
    return true;
  }
  spawnCar(type, lane, s, speed = 8, opts = {}) {
    const game = this.game, rng = this.rng;
    samplePath(lane.points, lane.cum, s, _s);
    const v = game.vehicles.spawn(type, _s.x, _s.y, _s.z, Math.atan2(_s.dx, _s.dz), { seed: (rng.next() * 1e6) | 0 });
    const app = randomAppearance(rng, { role: type === 'bus' || type === 'truck' ? 'worker' : rng.chance(0.3) ? 'business' : 'civilian' });
    const drv = new Actor(game, app, { health: 100 });
    drv.inVehicle = true; drv.vehicle = v; drv.seatSide = 1; v.driver = drv; drv.isTrafficDriver = true;
    const c = { v, driver: drv, seg: lane, isConn: false, s, speed, next: null, panic: 0, hold: 0, off: false, offT: 0, stuck: 0, honkT: 0, style: 0.85 + rng.next() * 0.3, id: rng.next() };
    v.ai = c; v.lights.taxi = type === 'taxi';
    this._chooseNext(c);
    this.cars.push(c);
    this._place(c, 0);
    return c;
  }
  _chooseNext(c) {
    const lane = c.seg, exits = lane.exits;
    if (!exits.length) { c.next = null; return; }
    const conns = this.game.city.connections;
    let total = 0; const w = exits.map(id => { const t = conns[id].turn; const x = t === 'straight' ? 3 : t === 'uturn' ? 0.05 : 1; total += x; return x; });
    let r = this.rng.next() * total, pick = exits[0];
    for (let i = 0; i < exits.length; i++) { r -= w[i]; if (r <= 0) { pick = exits[i]; break; } }
    c.next = conns[pick];
    const t = c.next.turn;
    c.v.lights.indL = t === 'left' || t === 'uturn'; c.v.lights.indR = t === 'right';
  }
  _place(c, dt) {
    const seg = c.seg;
    samplePath(seg.points, seg.cum, c.s, _s);
    c.v.setKinematic(_s.x, _s.y, _s.z, Math.atan2(_s.dx, _s.dz), c.speed, dt, Math.atan(_s.slope || 0));
  }
  remove(c, keepVehicle = false) {
    const i = this.cars.indexOf(c); if (i >= 0) this.cars.splice(i, 1);
    if (c.v) c.v.ai = null;
    if (!keepVehicle && c.v && !c.v.removed) {
      if (c.v.driver === c.driver) c.v.driver = null;
      this.game.vehicles.remove(c.v);
    }
    if (c.driver && c.driver.inVehicle && !keepVehicle) c.driver.removed = true;
  }

  // ------------------------------------------------------------------ leader search
  _leaderGap(c) {
    // returns { gap, speed } of the closest thing ahead along the rail (cars, red lights)
    let gap = 1e9, lv = 0;
    const L = c.v.spec.L;
    const list = this.occ.get(c.seg);
    if (list) for (const o of list) { if (o === c) continue; const d = o.s - c.s; if (d > 0 && d - (L + o.v.spec.L) / 2 < gap) { gap = d - (L + o.v.spec.L) / 2; lv = o.speed; } }
    let base = c.seg.length - c.s;
    if (gap > 60 && !c.isConn && c.next) {
      // red light at the end of this lane
      const node = this.game.city.roads.nodes[c.next.node];
      if (node.signal && c.panic <= 0) {
        const st = this.game.city.signalState(node, c.seg.edge, this.game.time);
        const stopD = base - 1.2 - L / 2;
        const canStop = stopD > c.speed * c.speed / (2 * 4.5) - 1;
        if (st === 'red' || (st === 'yellow' && canStop)) { if (stopD < gap) { gap = Math.max(0.05, stopD); lv = 0; } }
      }
      const l2 = this.occ.get(c.next);
      if (l2) for (const o of l2) { const d = base + o.s - (L + o.v.spec.L) / 2; if (d < gap) { gap = d; lv = o.speed; } }
      const nl = this.game.city.lanes[c.next.to];
      const l3 = this.occ.get(nl);
      if (l3) for (const o of l3) { const d = base + c.next.length + o.s - (L + o.v.spec.L) / 2; if (d < gap) { gap = d; lv = o.speed; } }
    } else if (gap > 60 && c.isConn) {
      const nl = this.game.city.lanes[c.seg.to];
      const l3 = this.occ.get(nl);
      if (l3) for (const o of l3) { const d = base + o.s - (L + o.v.spec.L) / 2; if (d < gap) { gap = d; lv = o.speed; } }
    }
    return { gap, speed: lv };
  }
  /** Non-rail obstacles in front (player car, wrecks, pedestrians). */
  _obstacle(c) {
    const v = c.v, game = this.game;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), lx = fz, lz = -fx; // left vector
    const L = v.spec.L, W = v.spec.W;
    let gap = 1e9, sp = 0, who = null;
    for (const o of game.vehicles.list) {
      if (o === v || (o.ai && !o.ai.off && o.ai.seg)) continue;
      const dx = o.com.x - v.com.x, dz = o.com.z - v.com.z;
      const ahead = dx * fx + dz * fz; if (ahead < 0 || ahead > 32) continue;
      const lat = Math.abs(dx * lx + dz * lz);
      if (lat > W / 2 + o.spec.W / 2 + 0.4) continue;
      const g = ahead - L / 2 - o.spec.L / 2;
      if (g < gap) { gap = g; sp = Math.max(0, o.vel.x * fx + o.vel.z * fz); who = o; }
    }
    for (const a of game.actors()) {
      if (a.inVehicle || !a.alive && !a.rig.ragdoll) continue;
      const dx = a.pos.x - v.com.x, dz = a.pos.z - v.com.z;
      const ahead = dx * fx + dz * fz; if (ahead < 0 || ahead > 22) continue;
      if (Math.abs(dx * lx + dz * lz) > W / 2 + 0.9) continue;
      if (Math.abs(a.pos.y - v.com.y) > 2.5) continue;
      const g = ahead - L / 2 - 0.6;
      if (g < gap) { gap = g; sp = 0; who = a; }
    }
    return { gap, speed: sp, who };
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const game = this.game, focus = game.focus;
    const cam = game.camera.camera;
    this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this._pm);
    // occupancy
    this.occ.clear();
    for (const c of this.cars) if (!c.off) { let l = this.occ.get(c.seg); if (!l) this.occ.set(c.seg, l = []); l.push(c); }
    // population
    const night = game.env.nightFactor;
    const target = Math.round(this.maxCars * (1 - night * 0.35) * (game.heat && game.heat.level >= 3 ? 0.7 : 1));
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.25;
      for (let k = 0; k < 3 && this.cars.length < target; k++) this._trySpawn(focus, false);
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i], v = c.v;
      if (!v || v.removed) { this.remove(c, true); continue; }
      const d2 = (v.com.x - focus.x) ** 2 + (v.com.z - focus.z) ** 2;
      // player took this car / driver gone
      if (v.driver !== c.driver || !c.driver.alive || !c.driver.inVehicle) { this._release(c); continue; }
      if (d2 > 330 * 330 || (d2 > 240 * 240 && !this._visible(v.com.x, v.com.y, v.com.z, 6))) { this.remove(c); continue; }
      c.panic = Math.max(0, c.panic - dt); c.hold = Math.max(0, c.hold - dt);
      if (v.mode === 'dynamic' && !c.off) { c.off = true; c.offT = 0; }
      if (c.off) this._offRail(c, dt);
      else this._onRail(c, dt, d2);
      // driver rig: only animate when near the camera
      const near = (v.com.x - cam.position.x) ** 2 + (v.com.z - cam.position.z) ** 2 < 90 * 90;
      c.driver.rig.visible = near;
      if (near) { c.driver.syncSeat(); c.driver.updateAnim(dt, { mode: 'sit', wheel: v.lights.indL ? 0.4 : v.lights.indR ? -0.4 : 0 }); }
      else c.driver.pos.copy(v.com);
      // wrecked / flipped / on fire: bail out
      const up = _v.set(0, 1, 0).applyQuaternion(v.quat).y;
      if (v.health < 320 || v.burning > 0 || (up < 0.3 && v.speed < 2) || v.inWater) { this._bail(c, v.burning > 0 || v.health < 320 ? 'flee' : 'flee'); continue; }
      if (v.horn && (c.honkT -= dt) <= 0) { v.horn = false; }
    }
  }
  _onRail(c, dt, d2) {
    const v = c.v;
    let v0 = c.seg.speed ?? this.game.city.lanes[c.seg.to].speed;
    if (c.isConn) v0 = Math.min(v0, c.seg.turn === 'straight' ? v0 : c.seg.turn === 'uturn' ? 4 : 7.5);
    else if (c.next && c.next.turn !== 'straight' && c.seg.length - c.s < 25) v0 = Math.min(v0, 8 + (c.seg.length - c.s) * 0.35);
    v0 *= c.style * (c.panic > 0 ? 1.45 : 1);
    if (this.game.weather.rain > 0.4) v0 *= 0.85;
    const lead = this._leaderGap(c);
    const obs = d2 < 160 * 160 ? this._obstacle(c) : { gap: 1e9, speed: 0 };
    let gap = lead.gap, ls = lead.speed;
    if (obs.gap < gap) { gap = obs.gap; ls = obs.speed; }
    if (c.hold > 0) { gap = Math.min(gap, 0.2); ls = 0; }
    // IDM
    const sp = c.speed, dv = sp - ls;
    const sStar = IDM.s0 + Math.max(0, sp * IDM.T + sp * dv / (2 * Math.sqrt(IDM.a * IDM.b)));
    let acc = IDM.a * (1 - Math.pow(sp / Math.max(v0, 0.1), 4) - (gap < 1e8 ? (sStar / Math.max(gap, 0.1)) ** 2 : 0));
    acc = clamp(acc, -9, IDM.a * (c.panic > 0 ? 1.6 : 1));
    c.speed = Math.max(0, sp + acc * dt);
    if (gap < 0.3) c.speed = Math.min(c.speed, 0.2);
    v.ai.braking = acc < -1 || (c.speed < 0.5 && gap < 5);
    // blocked by something that isn't moving: honk
    if (obs.gap < 6 && c.speed < 0.5 && obs.who) { c.stuck += dt; if (c.stuck > 2.5 && c.honkT <= 0 && this.rng.chance(0.02)) { v.horn = true; c.honkT = 0.4 + this.rng.next() * 0.8; this.game.events.emit('horn', { vehicle: v }); } }
    else c.stuck = 0;
    // advance along rail
    c.s += c.speed * dt;
    let guard = 0;
    while (c.s > c.seg.length && guard++ < 4) {
      c.s -= c.seg.length;
      if (!c.isConn) {
        if (!c.next) { this.remove(c); return; }
        c.seg = c.next; c.isConn = true;
      } else {
        c.seg = this.game.city.lanes[c.seg.to]; c.isConn = false; v.lights.indL = v.lights.indR = false;
        this._chooseNext(c);
      }
    }
    this._place(c, dt);
  }
  /** Knocked off the rail: steer with physics toward the lane, then snap back on. */
  _offRail(c, dt) {
    const v = c.v, ctl = v.controls, city = this.game.city;
    c.offT += dt;
    if (c.offT < 1.2) { ctl.throttle = 0; ctl.brake = 1; ctl.steer = 0; ctl.handbrake = false; if (c.offT > 0.4 && this.rng.chance(0.03)) { v.horn = true; c.honkT = 0.5; } return; }
    // track the rail: project onto the current segment near the last s
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const n = city.nearestLane(v.com.x, v.com.z, (l) => { const p = l.points, a = p[0], b = p[p.length - 1]; const dx = b.x - a.x, dz = b.z - a.z, ll = Math.hypot(dx, dz) || 1; return (dx * fx + dz * fz) / ll > 0.2; }, 30);
    if (!n) { ctl.throttle = 0; ctl.brake = 1; if (c.offT > 8) this._bail(c, 'walk'); return; }
    if (n.lane !== c.seg) { c.seg = n.lane; c.isConn = false; this._chooseNext(c); }
    c.s = n.s;
    const look = 7 + v.speed * 0.7;
    samplePath(n.lane.points, n.lane.cum, Math.min(n.lane.length, n.s + look), _s);
    const ang = wrapAngle(Math.atan2(_s.x - v.com.x, _s.z - v.com.z) - v.yaw);
    ctl.steer = clamp(ang * 2.2, -1, 1);
    const want = Math.min(n.lane.speed * (c.panic > 0 ? 1.3 : 0.7), 12);
    const o = this._obstacle(c);
    const targetV = o.gap < 8 ? 0 : want;
    ctl.throttle = v.fwdSpeed < targetV ? clamp((targetV - v.fwdSpeed) * 0.4, 0.2, 1) : 0;
    ctl.brake = v.fwdSpeed > targetV + 1.5 ? 0.6 : 0; ctl.handbrake = false;
    if (v.fwdSpeed < 0.3 && c.offT > 3 && o.gap > 8) { c.stuck += dt; if (c.stuck > 3) { ctl.throttle = 0; ctl.brake = 1; } } // reversing out isn't worth it
    // re-rail when aligned and close
    const heading = Math.abs(wrapAngle(Math.atan2(n.dx, n.dz) - v.yaw));
    if (n.dist < 0.9 && heading < 0.14 && v.speed > 2 && c.offT > 2.5 && Math.abs(v.angVel.y) < 0.3) {
      c.off = false; c.speed = v.fwdSpeed; c.stuck = 0;
      ctl.throttle = 0; ctl.brake = 0; ctl.steer = 0;
      v.mode = 'kinematic';
      this._place(c, 0);
    }
    if (c.offT > 25) this._bail(c, 'walk');
  }
  /** Driver abandons the car. */
  _bail(c, mood = 'flee') {
    const d = c.driver, v = c.v;
    this.remove(c, true);
    v.ai = null; v.controls.throttle = 0; v.controls.brake = 1; v.lights.indL = v.lights.indR = false;
    if (d && d.alive && d.inVehicle) {
      d.leaveSeat(true);
      d.isTrafficDriver = false;
      if (this.game.peds) this.game.peds.adopt(d, mood, v.com);
    }
    if (v.mode !== 'dynamic') v.wake();
  }
  /** The player (or someone) took the car. */
  _release(c) {
    const i = this.cars.indexOf(c); if (i >= 0) this.cars.splice(i, 1);
    c.v.ai = null; c.v.lights.indL = c.v.lights.indR = false;
    if (c.v.mode === 'kinematic') { c.v.mode = 'dynamic'; }
    const d = c.driver;
    if (d && !d.inVehicle && d.alive && this.game.peds) this.game.peds.adopt(d, 'flee', c.v.com);
  }
  *drivers() { for (const c of this.cars) if (c.driver && !c.driver.removed) yield c.driver; }
  clear() { for (const c of [...this.cars]) this.remove(c); }
}
