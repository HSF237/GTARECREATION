// Heat (wanted) system and Sol Harbor Police response: patrol cars in pursuit, officers on foot who
// arrest or open fire, a helicopter with a searchlight, search areas and evasion. Original design.
import * as THREE from 'three';
import { randomAppearance } from '../entities/character.js';
import { makeRng } from '../core/rng.js';
import { clamp, damp, dampAngle, wrapAngle, lerp } from '../core/math.js';
import { Actor } from './actor.js';
import { AIDriver } from './driver.js';
import { fireWeapon, explode } from './combat.js';
import { WEAPON_LEN } from '../entities/character.js';

const THRESH = [0, 1, 4, 9, 16, 26];
const CARS_FOR = [0, 1, 2, 3, 4, 5];
const _v = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _md = new THREE.Vector3(), _sph = new THREE.Sphere();
const LOS_IGNORE = new Set(['breakable', 'prop', 'fence', 'rail', 'curb', 'piling']);

export class HeatSystem {
  constructor(game) {
    this.game = game; this.level = 0; this.points = 0; this.rng = makeRng(911);
    this.units = []; this.foot = []; this.heli = null;
    this.lastSeen = new THREE.Vector3(); this.unseenT = 0; this.seen = false; this.flash = 0;
    this.reports = []; this.shotWindow = 0; this.spawnT = 0; this.arrestT = 0;
    this.frustum = new THREE.Frustum(); this._pm = new THREE.Matrix4();
    const ev = game.events;
    ev.on('gunshot', (e) => { if (e.shooter && e.shooter.isPlayer && this.shotWindow <= 0) { this.shotWindow = 8; this.crime(e.position, 1, 'shots'); } });
    ev.on('actorDamaged', (e) => {
      const a = e.actor, att = e.info && e.info.attacker;
      if (!att || !att.isPlayer || a.isPlayer) return;
      if (a.isCop) { this.crime(a.pos, this.level >= 3 ? 1 : 3, 'assaultCop', true); this.lastSeen.copy(att.pos); }
      else if (!a.__assaulted) { a.__assaulted = true; this.crime(a.pos, 1, 'assault'); }
    });
    ev.on('actorKilled', (e) => {
      const a = e.actor, info = e.info || {}, att = info.attacker || (info.vehicleHit && info.vehicleHit.driver);
      if (!att || !att.isPlayer || a.isPlayer) return;
      if (a.isCop) this.crime(a.pos, 4, 'killCop', true);
      else this.crime(a.pos, 3, 'murder');
      game.player.stats.kills++;
    });
    ev.on('pedHit', (e) => { if (e.vehicle.driver && e.vehicle.driver.isPlayer && !e.actor.isCop) this.crime(e.actor.pos, 1, 'hitPed'); });
    ev.on('carjack', (e) => { if (e.actor.isPlayer) this.crime(e.vehicle.com, e.vehicle.type === 'police' ? 4 : 1, e.vehicle.type === 'police' ? 'stealCop' : 'carjack'); });
    ev.on('enteredVehicle', (e) => { if (e.actor.isPlayer && (e.vehicle.type === 'police' || e.vehicle.type === 'swat') && !e.vehicle.playerOwned) this.crime(e.vehicle.com, 3, 'stealCop'); });
    ev.on('vehicleCrash', (e) => {
      const p = game.player.vehicle; if (!p) return;
      const other = e.a === p ? e.b : e.b === p ? e.a : null;
      if (other && (other.type === 'police' || other.type === 'swat') && e.impact > 4) this.crime(other.com, 2, 'damageCop', true);
    });
    ev.on('bulletHitVehicle', (e) => { if (e.shooter && e.shooter.isPlayer && (e.vehicle.type === 'police' || e.vehicle.type === 'swat')) this.crime(e.vehicle.com, 2, 'damageCop', true); });
    ev.on('explosionFx', (e) => { if (e.attacker && e.attacker.isPlayer) this.crime(e.position, 3, 'explosion'); });
    this._initHeli();
  }

  // ------------------------------------------------------------------ crimes & witnesses
  crime(pos, pts, kind, copWitness = false) {
    const game = this.game;
    if (game.cheats.noHeat || game.missions?.suppressHeat) return;
    // witnessed by police?
    let cop = copWitness;
    if (!cop) for (const a of this.copActors()) { if (!a.alive) continue; const d = a.pos.distanceTo(pos); if (d < 70 && (d < 20 || this._los(a.pos, pos))) { cop = true; break; } }
    if (!cop && this.level > 0 && this.seen) cop = true;
    if (cop) { this.addPoints(pts); this.lastSeen.copy(game.player.pos); return; }
    // civilian witnesses report after a delay (unless they don't survive)
    const wit = [];
    if (game.peds) for (const p of game.peds.peds) { const a = p.a; if (a.alive && a.pos.distanceTo(pos) < 45) wit.push(a); }
    if (game.traffic) for (const d of game.traffic.drivers()) if (d.alive && d.vehicle && d.vehicle.com.distanceTo(pos) < 35) wit.push(d);
    if (wit.length) this.reports.push({ t: 3.5 + this.rng.next() * 2, pts, witnesses: wit, pos: pos.clone() });
  }
  addPoints(p) {
    this.points = Math.max(this.points, THRESH[this.level]) + p;
    let L = 0; for (let i = 1; i <= 5; i++) if (this.points >= THRESH[i]) L = i;
    L = Math.min(L, this.game.maxHeat ?? 5);
    if (L > this.level) {
      const was = this.level; this.level = L;
      this.game.events.emit('heatChanged', { level: L, was });
      if (was === 0) this.game.hud.note(`<b style="color:#ff5e62">HEAT ${'▲'.repeat(L)}</b> · Sol Harbor Police are responding`);
      this.seen = true; this.unseenT = 0; this.lastSeen.copy(this.game.player.pos);
    }
  }
  clear(msg = true) {
    if (this.level > 0 && msg) { this.game.hud.note('<b>Heat lost.</b> The police called off the search.'); this.game.events.emit('heatLost', {}); }
    this.level = 0; this.points = 0; this.unseenT = 0; this.reports.length = 0;
    this.game.events.emit('heatChanged', { level: 0 });
  }
  *copActors() {
    for (const u of this.units) { if (u.driver) yield u.driver; if (u.passenger) yield u.passenger; }
    for (const f of this.foot) yield f.a;
  }
  *actors() { for (const a of this.copActors()) if (!a.removed) yield a; }
  _los(a, b) { return this.game.city.collision.lineOfSight(a.x, a.y + 1.6, a.z, b.x, b.y + 1.3, b.z, LOS_IGNORE); }
  _visible(x, y, z, r = 4) { _sph.center.set(x, y + 1, z); _sph.radius = r; return this.frustum.intersectsSphere(_sph); }

  // ------------------------------------------------------------------ spawning units
  _spawnUnit(swat = false) {
    const game = this.game, city = game.city, rng = this.rng, P = game.player;
    const pp = P.inVehicle && P.vehicle ? P.vehicle.com : P.pos;
    for (let tries = 0; tries < 6; tries++) {
      const ang = rng.next() * Math.PI * 2, dist = 110 + rng.next() * 80;
      const n = city.nearestLane(pp.x + Math.cos(ang) * dist, pp.z + Math.sin(ang) * dist, null, 40);
      if (!n) continue;
      if (this._visible(n.x, n.y, n.z) && (n.x - pp.x) ** 2 + (n.z - pp.z) ** 2 < 150 * 150) continue;
      let clear = true; for (const v of game.vehicles.list) if ((v.com.x - n.x) ** 2 + (v.com.z - n.z) ** 2 < 49) { clear = false; break; }
      if (!clear) continue;
      const v = game.vehicles.spawn(swat ? 'swat' : 'police', n.x, n.y, n.z, Math.atan2(n.dx, n.dz), { seed: (rng.next() * 1e6) | 0 });
      v.wake(); v.lights.siren = true; v.keep = true; v.policeUnit = true;
      const u = { v, ai: new AIDriver(game, v, { maxSpeed: v.spec.maxSpeed * 0.82, aggressive: 0.7 }), state: 'pursue', t: 0, exitT: 0, swat };
      u.driver = this._makeCop(swat); this._seat(u.driver, v, 1);
      if (this.level >= 2 || swat) { u.passenger = this._makeCop(swat); this._seat(u.passenger, v, -1); }
      this.units.push(u);
      return u;
    }
    return null;
  }
  _makeCop(swat) {
    const a = new Actor(this.game, randomAppearance(this.rng, { role: swat ? 'swat' : 'police' }), { health: swat ? 140 : 100, armor: swat ? 50 : 0 });
    a.isCop = true;
    a.weapon = swat ? 'smg' : (this.level >= 5 ? 'rifle' : 'pistol'); a.clip[a.weapon] = 999; a.ammo[a.weapon] = 999;
    return a;
  }
  _seat(a, v, side) { a.inVehicle = true; a.vehicle = v; a.seatSide = side; if (side === 1) v.driver = a; else v.passenger = a; a.syncSeat(); }
  /** Turn nearby patrolling traffic police cars into pursuit units. */
  _recruitTraffic() {
    const tr = this.game.traffic; if (!tr) return;
    for (const c of [...tr.cars]) {
      if (c.v.type !== 'police' || c.v.com.distanceTo(this.game.focus) > 180) continue;
      const v = c.v, d = c.driver;
      const i = tr.cars.indexOf(c); if (i >= 0) tr.cars.splice(i, 1);
      v.ai = null; v.wake(); v.lights.siren = true; v.keep = true; v.policeUnit = true; v.lights.indL = v.lights.indR = false;
      d.isCop = true; d.weapon = 'pistol'; d.clip.pistol = 999; d.ammo.pistol = 999;
      this.units.push({ v, ai: new AIDriver(this.game, v, { maxSpeed: v.spec.maxSpeed * 0.82, aggressive: 0.7 }), state: 'pursue', t: 0, exitT: 0, driver: d });
    }
  }

  // ------------------------------------------------------------------ helicopter
  _initHeli() {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x1b2a41, roughness: 0.4, metalness: 0.5 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.6, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.8 });
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1.3, 20, 14), body); hull.scale.set(1, 0.95, 2.0); hull.position.y = 1.3; g.add(hull);
    const stripe = new THREE.Mesh(new THREE.SphereGeometry(1.31, 20, 6, 0, Math.PI * 2, 1.35, 0.35), white); stripe.scale.set(1, 0.95, 2.0); stripe.position.y = 1.3; g.add(stripe);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 10, 0, Math.PI * 2, 0, 1.3), glass); canopy.scale.set(1.05, 0.9, 1.3); canopy.position.set(0, 1.55, 1.1); canopy.rotation.x = 0.5; g.add(canopy);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 5.2, 10), body); boom.rotation.x = Math.PI / 2; boom.position.set(0, 1.55, -4.2); g.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.8), body); fin.position.set(0, 2.1, -6.6); g.add(fin);
    const hstab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.5), body); hstab.position.set(0, 1.6, -6.0); g.add(hstab);
    for (const s of [1, -1]) {
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6), dark); skid.rotation.x = Math.PI / 2; skid.position.set(s * 0.95, 0.05, 0.2); g.add(skid);
      for (const z of [-0.6, 1.0]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6), dark); st.position.set(s * 0.85, 0.3, z); st.rotation.z = s * 0.35; g.add(st); }
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.5, 8), dark); mast.position.y = 2.55; g.add(mast);
    const rotor = new THREE.Group(); rotor.position.y = 2.8;
    const bladeGeo = new THREE.BoxGeometry(0.28, 0.04, 10.5);
    const b1 = new THREE.Mesh(bladeGeo, dark), b2 = new THREE.Mesh(bladeGeo, dark); b2.rotation.y = Math.PI / 2; rotor.add(b1, b2);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(5.3, 32), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.12, depthWrite: false })); disc.rotation.x = -Math.PI / 2; rotor.add(disc);
    g.add(rotor);
    const tail = new THREE.Group(); tail.position.set(0.2, 2.1, -6.7);
    const tb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.5, 0.14), dark); tail.add(tb); g.add(tail);
    // searchlight: always in the scene (intensity 0 when off) so the light count never changes
    const spot = new THREE.SpotLight(0xeef4ff, 0, 160, 0.16, 0.5, 1.2); spot.position.set(0, 0.6, 1.8); g.add(spot); g.add(spot.target);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(7, 60, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    cone.visible = false; this.game.scene.add(cone);
    g.traverse(o => { if (o.isMesh) o.castShadow = o !== disc; });
    g.visible = false; this.game.scene.add(g);
    this.heli = {
      group: g, rotor, tail, spot, cone, active: false, health: 1600, exploded: false, falling: false,
      com: new THREE.Vector3(0, -500, 0), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), angVel: new THREE.Vector3(), yaw: 0, orbit: 0, fireT: 3, mode: 'dynamic',
      spec: { W: 2.6, H: 3.0, L: 8.0, comHeight: 1.4, clr: 0, name: 'Police Helicopter' },
      wake() {}, damage: (amt, p, cause, att) => this._heliDamage(amt, att), type: 'heli',
    };
    this.game.extraTargets = [this.heli];
  }
  _heliDamage(amt, att) {
    const h = this.heli; if (!h.active || h.exploded) return;
    h.health -= amt;
    if (att && att.isPlayer) { this.addPoints(1); }
    if (h.health <= 0 && !h.falling) { h.falling = true; h.angVel.set(0, 2.5, 0); this.game.fx.particles.explosion(h.com, 0.6); this.game.events.emit('explosionFx', { position: h.com.clone(), radius: 4, attacker: att }); }
  }
  _heliUpdate(dt) {
    const h = this.heli, game = this.game, P = game.player;
    const want = this.level >= 3 && !h.exploded;
    if (!h.active && want && this.heliCooldown <= 0) {
      const pp = P.pos; const a = this.rng.next() * 6.28;
      h.com.set(pp.x + Math.cos(a) * 260, pp.y + 90, pp.z + Math.sin(a) * 260); h.vel.set(0, 0, 0); h.health = 1600; h.falling = false; h.exploded = false;
      h.active = true; h.group.visible = true; h.quat.identity();
      game.events.emit('heliArrive', {});
    }
    if (!h.active) { this.heliCooldown = Math.max(0, (this.heliCooldown || 0) - dt); return; }
    h.rotor.rotation.y += dt * 38; h.tail.rotation.x += dt * 60;
    const pp = P.inVehicle && P.vehicle ? P.vehicle.com : P.pos;
    if (h.falling) {
      h.vel.y -= 9.8 * dt; h.com.addScaledVector(h.vel, dt); h.yaw += h.angVel.y * dt;
      if (Math.random() < 0.8) game.fx.particles.smoke(h.com, 1.2, true);
      if (Math.random() < 0.5) game.fx.particles.fire(h.com, 1);
      const g = game.city.collision.groundHeight(h.com.x, h.com.z, h.com.y + 2, 1);
      if (h.com.y < g + 1 || h.com.y < game.city.terrain.waterLevel) {
        h.exploded = true; h.active = false; h.group.visible = false; h.cone.visible = false; h.spot.intensity = 0;
        explode(game, h.com.clone(), 10, P, null);
        game.events.emit('explosion', { position: h.com.clone(), radius: 10, source: null, attacker: P, heli: true });
        this.heliCooldown = 45;
      }
    } else {
      // orbit the last known position (or the player while seen)
      const tgt = this.seen ? pp : this.lastSeen;
      h.orbit += dt * 0.22;
      const r = this.seen ? 38 : 70;
      const tx = tgt.x + Math.cos(h.orbit) * r, tz = tgt.z + Math.sin(h.orbit) * r;
      const ground = Math.max(game.city.collision.groundHeight(h.com.x, h.com.z), game.city.collision.groundHeight(tx, tz), game.city.terrain.waterLevel);
      const ty = Math.max(ground + 36, tgt.y + 40);
      const leaving = this.level < 3;
      const dx = (leaving ? h.com.x + (h.com.x - pp.x) : tx) - h.com.x, dy = (leaving ? h.com.y + 40 : ty) - h.com.y, dz = (leaving ? h.com.z + (h.com.z - pp.z) : tz) - h.com.z;
      const maxV = 32;
      _v.set(dx, dy, dz); const l = _v.length(); if (l > 0.1) _v.multiplyScalar(Math.min(maxV, l * 0.8) / l);
      const ax = (_v.x - h.vel.x), az = (_v.z - h.vel.z);
      h.vel.x = damp(h.vel.x, _v.x, 1.2, dt); h.vel.y = damp(h.vel.y, _v.y, 1.5, dt); h.vel.z = damp(h.vel.z, _v.z, 1.2, dt);
      h.com.addScaledVector(h.vel, dt);
      h.yaw = dampAngle(h.yaw, Math.atan2(pp.x - h.com.x, pp.z - h.com.z), 1.2, dt);
      h.tiltX = damp(h.tiltX || 0, clamp(ax * 0.03, -0.3, 0.3), 2, dt); h.tiltZ = damp(h.tiltZ || 0, clamp(-az * 0.03, -0.3, 0.3), 2, dt);
      if (leaving && (h.com.distanceTo(pp) > 330)) { h.active = false; h.group.visible = false; h.cone.visible = false; h.spot.intensity = 0; }
      // gunner at heat 4+
      if (this.level >= 4 && this.seen && P.alive) {
        h.fireT -= dt;
        if (h.fireT <= 0) {
          h.fireT = 0.14; h.burst = (h.burst || 0) + 1; if (h.burst > 6) { h.burst = 0; h.fireT = 2.2; }
          _o.copy(h.com).setY(h.com.y - 1); _d.set(pp.x - _o.x, pp.y + 1.2 - _o.y, pp.z - _o.z).normalize();
          const fakeShooter = { isPlayer: false, isCop: true, vehicle: null, rig: null };
          fireWeapon(game, fakeShooter, 'rifle', _o, _d, _o, 0.35 + (P.inVehicle ? 0.1 : 0.3) - Math.min(0.2, P.speedNow * 0.02));
        }
      }
    }
    const night = game.env.nightFactor;
    h.group.position.copy(h.com); h.group.rotation.set(h.tiltX || 0, h.yaw, h.tiltZ || 0, 'YXZ');
    h.quat.copy(h.group.quaternion);
    h.spot.intensity = h.active && night > 0.3 && !h.falling ? 900 * night : 0;
    h.spot.target.position.set(0, -40, 12); h.spot.target.updateMatrixWorld();
    // the cone points from the heli to the ground spot near the player
    if (h.spot.intensity > 0) {
      const tgt = this.seen ? pp : this.lastSeen;
      const from = h.com, to = _v.set(tgt.x, tgt.y, tgt.z), len = from.distanceTo(to);
      h.cone.visible = true; h.cone.position.lerpVectors(from, to, 0.5); h.cone.scale.set(1, len / 60, 1);
      h.cone.lookAt(to); h.cone.rotateX(Math.PI / 2);
      h.spot.target.position.copy(h.group.worldToLocal(to.clone()));
      h.spot.target.updateMatrixWorld();
    } else h.cone.visible = false;
  }

  // ------------------------------------------------------------------ main update
  update(dt) {
    const game = this.game, P = game.player;
    const cam = game.camera.camera;
    this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this._pm);
    this.shotWindow -= dt;
    // delayed civilian reports
    for (let i = this.reports.length - 1; i >= 0; i--) {
      const r = this.reports[i]; r.t -= dt;
      if (r.t <= 0) { this.reports.splice(i, 1); if (r.witnesses.some(a => a.alive && !a.removed)) { this.addPoints(r.pts); this.lastSeen.copy(r.pos); } }
    }
    const pp = P.inVehicle && P.vehicle ? P.vehicle.com : P.pos;
    if (this.level > 0) {
      // who can see the player?
      this.seen = false;
      for (const a of this.copActors()) {
        if (!a.alive) continue;
        const src = a.inVehicle && a.vehicle ? a.vehicle.com : a.pos;
        const d = src.distanceTo(pp);
        if (d < 18 || (d < 80 && this._los(src, pp))) { this.seen = true; break; }
      }
      const h = this.heli;
      if (!this.seen && h.active && !h.falling && Math.hypot(h.com.x - pp.x, h.com.z - pp.z) < 110 && this.game.city.collision.lineOfSight(h.com.x, h.com.y - 1, h.com.z, pp.x, pp.y + 1.5, pp.z, LOS_IGNORE)) this.seen = true;
      if (this.seen) { this.unseenT = 0; this.lastSeen.copy(pp); }
      else {
        this.unseenT += dt;
        const R = this.searchRadius();
        const outside = Math.hypot(pp.x - this.lastSeen.x, pp.z - this.lastSeen.z) > R;
        if ((outside && this.unseenT > 5) || this.unseenT > 12 + this.level * 5) this.clear();
      }
      // keep the right number of units around
      this._recruitTraffic();
      const want = CARS_FOR[this.level];
      this.spawnT -= dt;
      const active = this.units.filter(u => !u.v.exploded && u.state !== 'leave').length;
      if (this.spawnT <= 0 && active < want) { this.spawnT = 2.5; this._spawnUnit(this.level >= 4 && this.units.filter(u => u.swat).length < 1); }
    }
    this.flash = this.level > 0 && !this.seen ? (this.flash + dt) % 1 : 0;
    // units
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (this._updateUnit(u, dt)) this.units.splice(i, 1);
    }
    for (let i = this.foot.length - 1; i >= 0; i--) {
      const f = this.foot[i];
      if (this._updateFoot(f, dt)) this.foot.splice(i, 1);
    }
    this._heliUpdate(dt);
    // arrest countdown display
    if (this.arrestT > 0 && !this.arresting) this.arrestT = Math.max(0, this.arrestT - dt * 0.5);
    this.arresting = false;
  }
  searchRadius() { return 70 + this.level * 35; }
  _updateUnit(u, dt) {
    const game = this.game, P = game.player, v = u.v;
    const pp = P.inVehicle && P.vehicle ? P.vehicle.com : P.pos;
    const d = v.com.distanceTo(pp);
    // driver dead or gone?
    const drv = u.driver;
    if (!drv || !drv.alive || drv.vehicle !== v) {
      v.controls.throttle = 0; v.controls.brake = 1; v.lights.siren = false;
      if (u.passenger && u.passenger.inVehicle && u.passenger.alive) { this._exitCop(u.passenger, u); u.passenger = null; }
      if (drv && drv.inVehicle && drv.alive && drv.vehicle === v) this._exitCop(drv, u);
      v.keep = false; v.policeUnit = false;
      return true;
    }
    if (v.exploded || v.health < 250 || v.inWater) { // abandon wreck
      this._exitCop(drv, u); if (u.passenger) this._exitCop(u.passenger, u);
      v.keep = false; return true;
    }
    for (const a of [u.driver, u.passenger]) if (a && a.inVehicle) { a.syncSeat(); if (a.rig.visible = v.model.root.visible && d < 90) a.updateAnim(dt, { mode: 'sit' }); }
    if (this.level === 0) {
      // leave: drive away, despawn when out of view
      u.state = 'leave'; v.lights.siren = false;
      v.controls.throttle = 0.5; v.controls.brake = 0; v.controls.steer = 0;
      if (d > 120 && !this._visible(v.com.x, v.com.y, v.com.z)) { this._despawnUnit(u); return true; }
      if (d > 260) { this._despawnUnit(u); return true; }
      return false;
    }
    u.state = 'pursue'; v.lights.siren = true;
    const target = this.seen ? pp : this.lastSeen;
    const tv = P.inVehicle && P.vehicle ? P.vehicle.vel : P.vel;
    const onFoot = !P.inVehicle;
    // officers get out when the suspect is on foot nearby (or the car is stuck close by)
    if (onFoot && d < 26 && v.speed < 4 && this.seen) {
      u.exitT += dt;
      if (u.exitT > 0.4) { this._exitCop(u.driver, u); if (u.passenger) { this._exitCop(u.passenger, u); u.passenger = null; } v.keep = true; v.controls.throttle = 0; v.controls.brake = 1; v.controls.handbrake = true; u.parked = true; return true; }
    } else u.exitT = 0;
    if (d > 420 && !this._visible(v.com.x, v.com.y, v.com.z)) { this._despawnUnit(u); return true; }
    const ram = !onFoot && this.level >= 2 && d < 30 ? P.vehicle : null;
    u.ai.update(dt, target, this.seen ? tv : null, { ram, directDist: 55, minSpeed: onFoot ? 0 : 10 });
    if (onFoot && d < 14) { v.controls.throttle = 0; v.controls.brake = 1; }
    return false;
  }
  _despawnUnit(u) {
    for (const a of [u.driver, u.passenger]) if (a) { a.removed = true; }
    this.game.vehicles.remove(u.v);
  }
  _exitCop(a, u) {
    if (!a.alive) return;
    a.leaveSeat(true);
    this.foot.push({ a, unit: u, state: 'engage', t: 0, burst: 0, fireT: 0.8 + this.rng.next(), strafe: this.rng.next() < 0.5 ? 1 : -1, car: u.v });
  }
  _updateFoot(f, dt) {
    const game = this.game, a = f.a, P = game.player;
    if (a.removed) return true;
    if (!a.alive) { f.dead = (f.dead || 0) + dt; a.updateState(dt); a.updateAnim(dt); if (f.dead > 25 && a.pos.distanceTo(P.pos) > 60) { a.removed = true; return true; } return false; }
    if (a.updateState(dt)) { a.updateAnim(dt); return false; }
    const pp = P.inVehicle && P.vehicle ? P.vehicle.com : P.pos;
    const dx = pp.x - a.pos.x, dz = pp.z - a.pos.z, d = Math.hypot(dx, dz);
    let vx = 0, vz = 0, aim = false, fire = false;
    const near = a.pos.distanceTo(game.camera.camera.position) < 130;
    a.rig.visible = near;
    if (this.level === 0 || !P.alive) {
      // go back to the car and leave, or just walk off and despawn when unseen
      if (d > 70 || !this._visible(a.pos.x, a.pos.y, a.pos.z)) { a.removed = true; return true; }
      a.updateAnim(dt, {}); a.physics(dt, -dx / d * 1.4, -dz / d * 1.4); a.yaw = dampAngle(a.yaw, Math.atan2(-dx, -dz), 6, dt);
      return false;
    }
    if (d > 300) { a.removed = true; return true; }
    // suspect drove off: return to the car if it's close, otherwise chase on foot
    if (P.inVehicle && f.car && !f.car.exploded && f.car.driver == null && a.pos.distanceTo(f.car.com) < 30 && d > 25) {
      if (a.state !== 'toDoor') { a.beginEnter(f.car, 1); }
      a.updateToDoor(dt, true); a.updateAnim(dt);
      if (a.inVehicle) { const u = { v: f.car, ai: new AIDriver(game, f.car, { maxSpeed: f.car.spec.maxSpeed * 0.82, aggressive: 0.7 }), state: 'pursue', t: 0, exitT: 0, driver: a }; f.car.keep = true; this.units.push(u); return true; }
      return false;
    }
    const see = this.seen && (d < 15 || this._los(a.pos, pp));
    a.yaw = dampAngle(a.yaw, Math.atan2(dx, dz), see ? 12 : 6, dt);
    if (this.level <= 1 && !P.inVehicle) {
      // arrest attempt
      if (d > 1.4) { const sp = d > 6 ? 5.5 : 3.2; vx = dx / d * sp; vz = dz / d * sp; }
      else { this.arresting = true; this.arrestT += dt; if (this.arrestT > 1.6 && P.speedNow < 3.5) { this.arrestT = 0; game.arrestPlayer(); } }
    } else {
      // engage: keep a working distance, strafe, and shoot in bursts
      const want = a.weapon === 'pistol' ? 11 : 16;
      if (!see || d > want + 8) { const sp = d > 25 ? 5.6 : 4.2; vx = dx / d * sp; vz = dz / d * sp; }
      else if (d < want - 5) { vx = -dx / d * 2.2; vz = -dz / d * 2.2; }
      else { vx = -dz / d * 1.6 * f.strafe; vz = dx / d * 1.6 * f.strafe; f.t += dt; if (f.t > 2.5) { f.t = 0; f.strafe *= -1; } }
      aim = see && d < 60;
      if (aim) {
        f.fireT -= dt;
        if (f.fireT <= 0) {
          const W = a.weapon;
          fire = true;
          a.rig.muzzle(_m, _md, WEAPON_LEN[W] || 0.25);
          _o.set(a.pos.x, a.pos.y + 1.5, a.pos.z);
          const tgtY = P.inVehicle ? pp.y + 1.0 : pp.y + 1.2;
          _d.set(pp.x - _o.x, tgtY - _o.y, pp.z - _o.z).normalize();
          const acc = clamp(1.1 - d / 45 - P.speedNow * 0.035 + (this.level >= 4 ? 0.2 : 0), 0.18, 1);
          fireWeapon(game, a, W, _o, _d, _m, acc);
          f.burst++;
          const rate = W === 'pistol' ? 0.45 : 0.11;
          if (f.burst >= (W === 'pistol' ? 3 : 6)) { f.burst = 0; f.fireT = 1.2 + this.rng.next() * 1.2; } else f.fireT = rate;
        }
      }
    }
    a.physics(dt, vx, vz);
    if (near) a.updateAnim(dt, { aim, aimPitch: 0, fire });
    return false;
  }
  clearAll() {
    for (const u of this.units) this._despawnUnit(u);
    this.units.length = 0;
    for (const f of this.foot) f.a.removed = true;
    this.foot.length = 0;
    const h = this.heli; h.active = false; h.group.visible = false; h.cone.visible = false; h.spot.intensity = 0;
    this.clear(false);
  }
}
