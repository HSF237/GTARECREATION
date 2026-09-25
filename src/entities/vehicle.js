// Vehicle: rigid body with raycast suspension + arcade tire model, static-world collisions, damage, water.
//   const v = new Vehicle(world, type, { color, seed }) ; world = { collision, terrain, scene, events }
//   v.place(x, y, z, yaw) ; v.controls = { throttle(-1..1), brake(0..1), steer(-1..1 left+), handbrake(bool) }
//   v.mode: 'parked' (static until hit) | 'dynamic' | 'kinematic' (AI rail: call v.setKinematic(pos, yaw, speed, dt))
//   v.step(dt) (physics) ; v.sync() (render transforms) ; v.damage(amount, localPoint)
import * as THREE from 'three';
import { VEHICLE_SPECS, buildVehicle } from './vehicleModels.js';
import { clamp, lerp, damp } from '../core/math.js';

const G = 9.81;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _left = new THREE.Vector3();
const contacts = [];
const ginfo = { height: 0, nx: 0, ny: 1, nz: 0, surface: '', id: -1, x: 0, y: 1, z: 0 };

export class Vehicle {
  constructor(world, type, opts = {}) {
    this.world = world; this.type = type;
    const S = this.spec = VEHICLE_SPECS[type];
    this.model = buildVehicle(type, { color: opts.color, seed: opts.seed ?? Math.floor(Math.random() * 1e6) });
    world.scene.add(this.model.root);
    this.com = new THREE.Vector3(); this.quat = new THREE.Quaternion(); this.vel = new THREE.Vector3(); this.angVel = new THREE.Vector3();
    this.comLocal = new THREE.Vector3(0, S.comHeight, 0);
    this.mass = S.mass;
    const w = S.W, h = S.H * 0.8, l = S.L;
    this.inertia = new THREE.Vector3(this.mass / 12 * (h * h + l * l), this.mass / 12 * (w * w + l * l), this.mass / 12 * (w * w + h * h)).multiplyScalar(1.1);
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.mode = 'parked';
    this.health = S.class === 'bus' || S.class === 'truck' ? 1800 : S.livery === 'swat' ? 3000 : 1000;
    this.maxHealth = this.health;
    this.burning = 0; this.exploded = false; this.drowned = 0; this.inWater = false;
    this.steer = 0; this.speed = 0; this.fwdSpeed = 0; this.rpm = 800; this.gear = 1; this.airTime = 0; this.onGround = true;
    this.driver = null; this.passenger = null; this.ai = null; this.owner = null;
    this.sleep = 0; this.lastImpact = 0; this.impactCooldown = 0;
    this.suspTravel = S.class === 'car' ? 0.22 : 0.26;
    this.k = this.mass * G / (4 * 0.09);
    this.c = 2 * 0.42 * Math.sqrt(this.k * this.mass / 4);
    this.wheelState = this.model.wheels.map(wl => ({ ...wl, comp: 0, prevComp: 0, contact: false, spin: 0, steer: 0, slip: 0, surface: 'asphalt', load: 0, px: 0, py: 0, pz: 0 }));
    this.skid = 0; this.lights = { head: false, siren: false, sirenPhase: 0, indL: false, indR: false, hazard: false, taxi: false };
    this.alarm = 0; this.horn = false;
    this.id = Vehicle.nextId++;
    this.half = new THREE.Vector3(S.W / 2, S.H / 2, S.L / 2);
  }
  static nextId = 1;
  get position() { return this.model.root.position; }
  /** Place with the origin (ground under axle midpoint) at x,y,z. */
  place(x, y, z, yaw) {
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.com.set(x, y, z).add(_v.copy(this.comLocal).applyQuaternion(this.quat));
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    for (const w of this.wheelState) { w.comp = 0.09; w.prevComp = 0.09; }
    this.sync();
  }
  get yaw() { _fwd.set(0, 0, 1).applyQuaternion(this.quat); return Math.atan2(_fwd.x, _fwd.z); }
  forward(out) { return out.set(0, 0, 1).applyQuaternion(this.quat); }
  /** Origin (ground reference point) in world. */
  origin(out) { return out.copy(this.comLocal).applyQuaternion(this.quat).negate().add(this.com); }
  localToWorld(p, out) { return out.copy(p).sub(this.comLocal).applyQuaternion(this.quat).add(this.com); }
  worldToLocal(p, out) { _q.copy(this.quat).invert(); return out.copy(p).sub(this.com).applyQuaternion(_q).add(this.comLocal); }
  wake() { if (this.mode === 'parked' || this.mode === 'kinematic') this.mode = 'dynamic'; this.sleep = 0; }

  /** Kinematic update for AI rail driving. */
  setKinematic(x, y, z, yaw, speed, dt, pitch = 0) {
    this.mode = 'kinematic';
    const prev = _v2.copy(this.com);
    this.quat.setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
    this.com.set(x, y, z).add(_v.copy(this.comLocal).applyQuaternion(this.quat));
    if (dt > 0) this.vel.subVectors(this.com, prev).divideScalar(dt);
    if (this.vel.lengthSq() > 900) this.vel.setLength(30);
    this.angVel.set(0, 0, 0);
    this.fwdSpeed = speed; this.speed = Math.abs(speed);
    const S = this.spec;
    for (const w of this.wheelState) { w.spin += speed * dt / w.r; w.comp = 0.09; w.contact = true; }
  }

  step(dt) {
    if (this.mode !== 'dynamic') return;
    const S = this.spec, W = this.world, col = W.collision;
    const q = this.quat;
    _up.set(0, 1, 0).applyQuaternion(q); _fwd.set(0, 0, 1).applyQuaternion(q); _left.set(1, 0, 0).applyQuaternion(q);
    const F = _v3.set(0, -G * this.mass, 0);
    const T = new THREE.Vector3();
    const ctl = this.controls;
    const speedF = this.vel.dot(_fwd);
    this.fwdSpeed = speedF; this.speed = this.vel.length();
    // steering: speed sensitive
    const maxSteer = 0.62 / (1 + Math.abs(speedF) * 0.055);
    this.steer = damp(this.steer, clamp(ctl.steer, -1, 1) * maxSteer, 9, dt);
    // engine
    let throttle = clamp(ctl.throttle, -1, 1), brake = clamp(ctl.brake, 0, 1);
    if (this.drowned > 1.5 || this.health <= 0) { throttle = 0; }
    const reversing = brake > 0.1 && speedF < 1.0 && throttle <= 0.05;
    let drive = 0;
    if (reversing) { drive = -brake * S.power * 0.55 * (speedF > -9 ? 1 : 0); brake = 0; }
    else if (throttle > 0) drive = throttle * S.power * (1.25 - 0.45 * clamp(speedF / S.maxSpeed, 0, 1));
    else if (throttle < 0) { if (speedF > 1) brake = Math.max(brake, -throttle); else drive = throttle * S.power * 0.55; }
    const nDriven = S.drive === 'awd' ? 4 : 2;
    let contactsN = 0;
    const invQ = _q.copy(q).invert();
    for (let i = 0; i < 4; i++) {
      const w = this.wheelState[i];
      const mountLocal = _v.set(w.x, w.r + this.suspTravel - 0.09, w.z);
      const mount = this.localToWorld(mountLocal, new THREE.Vector3());
      const upY = Math.max(_up.y, 0.25);
      col.groundInfo(mount.x, mount.z, mount.y, 0.25, ginfo);
      const dist = (mount.y - ginfo.height) / upY;
      const maxLen = this.suspTravel + w.r;
      w.prevComp = w.comp;
      if (dist < maxLen && _up.y > 0.2) {
        w.contact = true; contactsN++;
        const comp = Math.min(maxLen - dist, this.suspTravel + 0.12);
        w.comp = comp;
        w.surface = ginfo.surface;
        const cp = mount.clone().addScaledVector(_up, -dist);
        w.px = cp.x; w.py = cp.y; w.pz = cp.z;
        let fs = this.k * comp + this.c * (comp - w.prevComp) / dt;
        if (comp > this.suspTravel) fs += this.k * 6 * (comp - this.suspTravel);
        fs = Math.max(0, fs);
        w.load = fs;
        const n = _v2.set(ginfo.nx, ginfo.ny, ginfo.nz);
        const fsV = n.clone().multiplyScalar(fs * 0.3).addScaledVector(_up, fs * 0.7);
        // tire frame
        const steerA = w.front ? this.steer : 0;
        w.steer = steerA;
        const wf = _fwd.clone().applyAxisAngle(_up, steerA);
        const fg = wf.addScaledVector(n, -wf.dot(n)).normalize();
        const lg = new THREE.Vector3().crossVectors(n, fg);
        const r = cp.clone().sub(this.com);
        const vp = new THREE.Vector3().crossVectors(this.angVel, r).add(this.vel);
        const vLong = vp.dot(fg), vLat = vp.dot(lg);
        const surfGrip = w.surface === 'grass' ? 0.72 : w.surface === 'sand' ? 0.6 : w.surface === 'dirt' ? 0.75 : w.surface === 'wood' ? 0.9 : 1;
        const wet = W.wetness ? 1 - W.wetness * 0.22 : 1;
        let mu = 1.25 * S.grip * surfGrip * wet;
        const rear = !w.front;
        const hb = ctl.handbrake && rear;
        let latMu = hb ? mu * 0.38 : mu;
        const mShare = this.mass / 4;
        let fLat = -vLat * mShare / dt * 0.55;
        let fLong = 0;
        const driven = S.drive === 'awd' || (S.drive === 'fwd' ? w.front : rear);
        if (driven && !hb) fLong += drive / nDriven;
        if (brake > 0) fLong += -Math.sign(vLong) * Math.min(brake * mu * fs * 1.1, Math.abs(vLong) * mShare / dt);
        if (hb) fLong += -Math.sign(vLong) * Math.min(mu * fs * 0.7, Math.abs(vLong) * mShare / dt);
        fLong += -vLong * 12; // rolling resistance
        const maxLat = latMu * fs, maxLong = mu * fs;
        w.slip = Math.max(0, Math.abs(fLat) / Math.max(maxLat, 1) - 1) + (Math.abs(fLong) > maxLong * 1.05 && Math.abs(vLong) > 2 ? 0.5 : 0);
        fLat = clamp(fLat, -maxLat, maxLat); fLong = clamp(fLong, -maxLong, maxLong);
        const tot = Math.hypot(fLat, fLong), lim = Math.max(maxLat, maxLong);
        if (tot > lim) { fLat *= lim / tot; fLong *= lim / tot; }
        const ft = fg.multiplyScalar(fLong).addScaledVector(lg, fLat).add(fsV);
        F.add(ft);
        T.add(new THREE.Vector3().crossVectors(r, ft));
        w.spin += (hb || (brake > 0.9 && Math.abs(vLong) < 20) ? 0 : vLong * dt / w.r);
        if (driven && throttle > 0.9 && Math.abs(vLong) < 6) w.spin += throttle * dt * 25; // burnout visual
      } else {
        w.contact = false; w.comp = Math.max(0, w.comp - dt * 1.5); w.load = 0; w.slip = 0;
        if (driven(S, w)) w.spin += throttle * dt * 20; else w.spin += 0;
      }
    }
    // anti-roll
    for (const [a, b] of [[0, 1], [2, 3]]) {
      const wa = this.wheelState[a], wb = this.wheelState[b];
      if (!wa.contact && !wb.contact) continue;
      const d = (wa.comp - wb.comp) * this.k * 0.6;
      const pa = this.localToWorld(new THREE.Vector3(wa.x, 0, wa.z), new THREE.Vector3()).sub(this.com);
      const pb = this.localToWorld(new THREE.Vector3(wb.x, 0, wb.z), new THREE.Vector3()).sub(this.com);
      T.add(new THREE.Vector3().crossVectors(pa, _up.clone().multiplyScalar(d))).add(new THREE.Vector3().crossVectors(pb, _up.clone().multiplyScalar(-d)));
    }
    this.onGround = contactsN > 0;
    this.airTime = this.onGround ? 0 : this.airTime + dt;
    // aero
    const sp = this.vel.length();
    const cd = S.power / (S.maxSpeed * S.maxSpeed);
    F.addScaledVector(this.vel, -cd * sp);
    if (this.onGround) F.addScaledVector(_up, -sp * sp * 0.6); // downforce
    // water
    const wl = W.terrain.waterLevel;
    const depth = wl - (this.com.y - S.comHeight * 0.5);
    this.inWater = depth > 0.2;
    if (depth > 0) {
      const sub = clamp(depth / (S.H * 0.8), 0, 1);
      F.y += this.mass * G * sub * (this.drowned < 4 ? 1.05 : 0.6);
      F.addScaledVector(this.vel, -this.mass * 1.6 * sub);
      this.angVel.multiplyScalar(1 - dt * 2 * sub);
      if (sub > 0.4) this.drowned += dt;
    }
    // integrate
    this.vel.addScaledVector(F, dt / this.mass);
    const tl = T.applyQuaternion(invQ);
    const wl2 = this.angVel.clone().applyQuaternion(invQ);
    wl2.x += tl.x / this.inertia.x * dt; wl2.y += tl.y / this.inertia.y * dt; wl2.z += tl.z / this.inertia.z * dt;
    // arcade stabilisation: damp roll/pitch in the air a bit, yaw damping when no input
    const airK = this.onGround ? 0.6 : 0.25;
    wl2.x *= 1 - dt * airK; wl2.z *= 1 - dt * airK; wl2.y *= 1 - dt * (this.onGround ? 0.5 : 0.2);
    this.angVel.copy(wl2.applyQuaternion(q));
    if (this.angVel.length() > 12) this.angVel.setLength(12);
    // self-righting assistance when stuck upside down / on side and slow
    if (_up.y < 0.35 && sp < 2 && this.driver && this.driver.isPlayer) this.flipTimer = (this.flipTimer || 0) + dt; else this.flipTimer = 0;
    this.com.addScaledVector(this.vel, dt);
    const wq = new THREE.Quaternion(this.angVel.x * dt * 0.5, this.angVel.y * dt * 0.5, this.angVel.z * dt * 0.5, 0).multiply(q);
    q.x += wq.x; q.y += wq.y; q.z += wq.z; q.w += wq.w; q.normalize();
    this._collideBody(dt);
    this._collideWorld(dt);
    // engine sim for audio/HUD
    const wheelSpeed = Math.abs(speedF);
    const ratios = [0, 3.4, 2.1, 1.45, 1.1, 0.85, 0.7];
    let g = 1; while (g < 6 && wheelSpeed > S.maxSpeed * [0, 0.18, 0.34, 0.52, 0.7, 0.86, 1][g]) g++;
    this.gear = reversing ? -1 : g;
    const targetRpm = 800 + wheelSpeed * ratios[Math.max(1, g)] * 95 + (throttle > 0 && !this.onGround ? 2500 : 0) + (throttle > 0.9 && wheelSpeed < 4 ? 3000 : 0);
    this.rpm = damp(this.rpm, clamp(targetRpm, 800, 7200), 8, dt);
    this.throttleOut = Math.max(0, throttle) + (reversing ? brake : 0);
    this.skid = 0;
    for (const w of this.wheelState) if (w.contact) this.skid = Math.max(this.skid, clamp(w.slip, 0, 1));
    if (ctl.handbrake && Math.abs(speedF) > 3) this.skid = Math.max(this.skid, 0.6);
    // sleep
    if (!this.driver && sp < 0.15 && this.angVel.length() < 0.1 && this.onGround) { this.sleep += dt; if (this.sleep > 2) { this.mode = 'parked'; this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); } } else this.sleep = 0;
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
  }
  /** Keep body corners above ground (flips, heavy landings). */
  _collideBody(dt) {
    const S = this.spec, col = this.world.collision;
    const hx = S.W / 2 * 0.95, hz = S.L / 2 * 0.95;
    const pts = [[hx, S.H * 0.95, hz], [-hx, S.H * 0.95, hz], [hx, S.H * 0.95, -hz], [-hx, S.H * 0.95, -hz], [hx, S.clr + 0.05, hz], [-hx, S.clr + 0.05, hz], [hx, S.clr + 0.05, -hz], [-hx, S.clr + 0.05, -hz]];
    for (const [x, y, z] of pts) {
      const p = this.localToWorld(_v.set(x, y, z), new THREE.Vector3());
      const gh = col.groundHeight(p.x, p.z, p.y + 0.3, 0.4);
      if (p.y < gh) {
        const pen = gh - p.y;
        this.com.y += pen * 0.8;
        const r = p.clone().sub(this.com);
        const vp = new THREE.Vector3().crossVectors(this.angVel, r).add(this.vel);
        if (vp.y < 0) {
          const j = -vp.y * this.mass * 0.35;
          this.vel.y += j / this.mass * 0.9;
          this.vel.x *= 1 - dt * 3; this.vel.z *= 1 - dt * 3;
          const imp = new THREE.Vector3(0, j, 0);
          const ang = new THREE.Vector3().crossVectors(r, imp).applyQuaternion(_q.copy(this.quat).invert());
          ang.x /= this.inertia.x; ang.y /= this.inertia.y; ang.z /= this.inertia.z;
          this.angVel.add(ang.applyQuaternion(this.quat).multiplyScalar(0.5));
          if (vp.y < -6) this._impact(-vp.y * 0.6, p);
        }
      }
    }
  }
  _collideWorld(dt) {
    const S = this.spec, col = this.world.collision;
    const origin = this.origin(_v2);
    const yaw = this.yaw;
    const n = col.collideOBB(this.com.x, this.com.z, S.W / 2, S.L / 2, yaw, origin.y + S.clr + 0.25, origin.y + S.H, contacts);
    for (let i = 0; i < n; i++) {
      const c = contacts[i];
      if (c.tag === 'breakable') { this.world.events.emit('propHit', { vehicle: this, contact: c, speed: this.speed }); continue; }
      const nx = c.nx, nz = c.nz;
      this.com.x += nx * c.depth; this.com.z += nz * c.depth;
      const r = new THREE.Vector3(c.px - this.com.x, 0, c.pz - this.com.z);
      const vp = new THREE.Vector3().crossVectors(this.angVel, r).add(this.vel);
      const vn = vp.x * nx + vp.z * nz;
      if (vn < 0) {
        const rxn = r.x * nz - r.z * nx; // (r x n).y
        const denom = 1 / this.mass + rxn * rxn / this.inertia.y;
        const e = 0.18;
        const j = -(1 + e) * vn / denom;
        this.vel.x += nx * j / this.mass; this.vel.z += nz * j / this.mass;
        this.angVel.y += rxn * j / this.inertia.y;
        // friction along wall
        const tx = -nz, tz = nx, vt = vp.x * tx + vp.z * tz;
        const jt = clamp(-vt / denom, -0.35 * j, 0.35 * j);
        this.vel.x += tx * jt / this.mass; this.vel.z += tz * jt / this.mass;
        if (-vn > 2.5) this._impact(-vn, new THREE.Vector3(c.px, origin.y + S.H * 0.45, c.pz), c);
      }
    }
  }
  _impact(speed, point, contact) {
    if (this.impactCooldown > 0 && speed < this.lastImpact * 1.5) return;
    this.impactCooldown = 0.25; this.lastImpact = speed;
    const dmg = Math.max(0, speed - 4) ** 1.5 * 2.2 * (this.spec.livery === 'swat' ? 0.4 : 1);
    if (dmg > 0) this.damage(dmg, point, 'crash');
    this.world.events.emit('vehicleImpact', { vehicle: this, speed, point });
  }
  damage(amount, worldPoint, cause = 'crash', attacker = null) {
    if (this.exploded) return;
    this.health -= amount;
    this.model.setDamage(clamp(1 - this.health / this.maxHealth, 0, 1));
    if (worldPoint && amount > 25) {
      const lp = this.worldToLocal(worldPoint, new THREE.Vector3());
      this.model.dent(lp, clamp(amount / 400, 0.03, 0.18));
    }
    if (this.health < 250 && this.burning === 0 && this.health > -1000) this.burning = 0.001;
    if (attacker) this.lastAttacker = attacker;
    this.world.events.emit('vehicleDamaged', { vehicle: this, amount, cause, attacker });
    if (this.mode === 'parked' && cause === 'crash') this.wake();
  }
  updateTimers(dt) {
    if (this.burning > 0 && !this.exploded) {
      this.burning += dt;
      if (this.health > 0) this.health -= dt * 12;
      if (this.burning > 6 || this.health < -80) this.explode();
    }
  }
  explode() {
    if (this.exploded) return;
    this.exploded = true; this.health = -1000; this.burning = 0;
    this.model.setBurnt(true);
    this.wake();
    this.vel.y += 6; this.angVel.x += (Math.random() - 0.5) * 3; this.angVel.z += (Math.random() - 0.5) * 3;
    this.world.events.emit('explosion', { position: this.com.clone(), radius: 9, source: this, attacker: this.lastAttacker });
  }
  /** Update render transforms. */
  sync(dt = 0, wheelRenderer = null) {
    const root = this.model.root;
    this.origin(root.position);
    root.quaternion.copy(this.quat);
    root.updateMatrixWorld();
    if (wheelRenderer) {
      const S = this.spec;
      for (const w of this.wheelState) {
        const y = w.r + (0.09 - w.comp) * 0.9;
        _m.makeRotationX(w.spin);
        const st = new THREE.Matrix4().makeRotationY(w.steer);
        st.multiply(_m);
        st.setPosition(w.x, clamp(y, w.r - 0.12, w.r + 0.2), w.z);
        const world = new THREE.Matrix4().multiplyMatrices(root.matrixWorld, st);
        wheelRenderer.push(world, w.r, w.w, this.exploded ? 3 : w.style, !w.left);
      }
    }
  }
  dispose() { this.world.scene.remove(this.model.root); this.model.dispose(); }
}
function driven(S, w) { return S.drive === 'awd' || (S.drive === 'fwd' ? w.front : !w.front); }

/** Vehicle-vehicle collision (2D OBB SAT + impulse). Returns impact speed or 0. */
export function collideVehicles(a, b) {
  const Sa = a.spec, Sb = b.spec;
  const dx = b.com.x - a.com.x, dz = b.com.z - a.com.z;
  const ra = Math.hypot(Sa.W, Sa.L) / 2, rb = Math.hypot(Sb.W, Sb.L) / 2;
  if (dx * dx + dz * dz > (ra + rb) * (ra + rb)) return 0;
  const oa = a.origin(_v), ya0 = oa.y, ob = b.origin(_v2), yb0 = ob.y;
  if (Math.abs(ya0 - yb0) > Math.max(Sa.H, Sb.H)) return 0;
  const ya = a.yaw, yb = b.yaw;
  const ca = Math.cos(ya), sa = Math.sin(ya), cb = Math.cos(yb), sb = Math.sin(yb);
  const axes = [[ca, -sa], [sa, ca], [cb, -sb], [sb, cb]];
  const A = [[ca, -sa], [sa, ca]], B = [[cb, -sb], [sb, cb]];
  let minO = Infinity, nx = 0, nz = 0;
  for (const [ux, uz] of axes) {
    const pa = Sa.W / 2 * Math.abs(A[0][0] * ux + A[0][1] * uz) + Sa.L / 2 * Math.abs(A[1][0] * ux + A[1][1] * uz);
    const pb = Sb.W / 2 * Math.abs(B[0][0] * ux + B[0][1] * uz) + Sb.L / 2 * Math.abs(B[1][0] * ux + B[1][1] * uz);
    const d = dx * ux + dz * uz, o = pa + pb - Math.abs(d);
    if (o <= 0) return 0;
    if (o < minO) { minO = o; const s = d > 0 ? 1 : -1; nx = ux * s; nz = uz * s; } // normal from a to b
  }
  // contact point ~ midpoint between centers, biased
  const px = (a.com.x + b.com.x) / 2, pz = (a.com.z + b.com.z) / 2;
  const ma = a.mode === 'dynamic' ? a.mass : Infinity, mb = b.mode === 'dynamic' ? b.mass : Infinity;
  const wa = ma === Infinity ? 0 : 1 / ma, wb = mb === Infinity ? 0 : 1 / mb;
  // kinematic/parked vehicles get woken into dynamic on significant impact
  const va = a.vel, vb = b.vel;
  const rv = (vb.x - va.x) * nx + (vb.z - va.z) * nz;
  const impact = Math.max(0, -rv);
  if (impact > 1.5) { if (a.mode !== 'dynamic') { a.wake(); } if (b.mode !== 'dynamic') { b.wake(); } }
  const wA = a.mode === 'dynamic' ? 1 / a.mass : 0, wB = b.mode === 'dynamic' ? 1 / b.mass : 0;
  if (wA + wB === 0) return 0;
  // positional correction
  const corr = minO / (wA + wB) * 0.8;
  a.com.x -= nx * corr * wA; a.com.z -= nz * corr * wA; b.com.x += nx * corr * wB; b.com.z += nz * corr * wB;
  if (rv < 0) {
    const j = -(1 + 0.25) * rv / (wA + wB);
    va.x -= nx * j * wA; va.z -= nz * j * wA; vb.x += nx * j * wB; vb.z += nz * j * wB;
    // spin
    const rA = (px - a.com.x) * nz - (pz - a.com.z) * nx, rB = (px - b.com.x) * nz - (pz - b.com.z) * nx;
    if (wA) a.angVel.y -= rA * j * 0.4 / a.inertia.y;
    if (wB) b.angVel.y += rB * j * 0.4 / b.inertia.y;
  }
  return impact;
}
