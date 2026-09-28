// AIDriver: physics-based driving toward a moving target. Follows road routes when far, drives
// directly (and rams if asked) when close with line of sight, unsticks itself by reversing.
import * as THREE from 'three';
import { clamp, wrapAngle, lerp } from '../core/math.js';

const _v = new THREE.Vector3();
export class AIDriver {
  constructor(game, vehicle, opts = {}) {
    this.game = game; this.v = vehicle;
    this.maxSpeed = opts.maxSpeed || vehicle.spec.maxSpeed * 0.8;
    this.aggressive = opts.aggressive ?? 0.5;
    this.route = null; this.routeT = 0; this.idx = 0; this.routeTarget = new THREE.Vector3(1e9, 0, 1e9);
    this.stuckT = 0; this.reverseT = 0; this.mode = 'route'; this.losT = 0; this.hasLos = false;
    this.arriveDist = opts.arriveDist ?? 6;
    this.useRoads = opts.useRoads ?? true;
    this.path = null; // optional fixed path [[x,z],...] (races)
  }
  _refreshRoute(target) {
    const v = this.v;
    const r = this.game.city.route({ x: v.com.x, z: v.com.z }, { x: target.x, z: target.z });
    this.route = r && r.points.length > 1 ? r.points : null; this.idx = 0; this.routeT = 2.5;
    this.routeTarget.copy(target);
  }
  /** Follow a fixed polyline (e.g. a race). */
  setPath(points) { this.path = points; this.idx = 0; }
  _lookahead(pts, dist) {
    const v = this.v;
    // advance idx to closest point (search a window ahead)
    let best = this.idx, bd = 1e18;
    for (let i = this.idx; i < Math.min(pts.length, this.idx + 30); i++) { const d = (pts[i][0] - v.com.x) ** 2 + (pts[i][1] - v.com.z) ** 2; if (d < bd) { bd = d; best = i; } }
    this.idx = best;
    let acc = 0, i = best, px = v.com.x, pz = v.com.z;
    while (i < pts.length - 1) {
      const nx = pts[i + 1][0], nz = pts[i + 1][1], l = Math.hypot(nx - px, nz - pz);
      if (acc + l >= dist) { const t = (dist - acc) / (l || 1); return { x: px + (nx - px) * t, z: pz + (nz - pz) * t, end: false }; }
      acc += l; px = nx; pz = nz; i++;
    }
    return { x: pts[pts.length - 1][0], z: pts[pts.length - 1][1], end: true };
  }
  /** Drive toward target (Vector3). targetVel optional. Returns distance to target. */
  update(dt, target, targetVel = null, o = {}) {
    const v = this.v, ctl = v.controls, game = this.game;
    if (v.exploded || v.drowned > 1) { ctl.throttle = 0; ctl.brake = 0; return 1e9; }
    if (v.mode !== 'dynamic') v.wake();
    const dx0 = target.x - v.com.x, dz0 = target.z - v.com.z, dist = Math.hypot(dx0, dz0);
    // line of sight to the target (checked a few times per second)
    this.losT -= dt;
    if (this.losT <= 0) { this.losT = 0.35; this.hasLos = dist < 60 && game.city.collision.lineOfSight(v.com.x, v.com.y + 1, v.com.z, target.x, target.y + 1, target.z, IGNORE); }
    let aim;
    const direct = !this.path && (!this.useRoads || (this.hasLos && dist < (o.directDist ?? 45)));
    if (this.path) {
      aim = this._lookahead(this.path, 8 + v.speed * 0.6);
    } else if (direct) {
      const lead = targetVel ? clamp(dist / 25, 0, 1.2) : 0;
      aim = { x: target.x + (targetVel ? targetVel.x * lead : 0), z: target.z + (targetVel ? targetVel.z * lead : 0), end: dist < this.arriveDist };
      this.mode = 'direct';
    } else {
      this.routeT -= dt;
      if (!this.route || this.routeT <= 0 && this.routeTarget.distanceTo(target) > 20 || this.idx >= (this.route?.length || 0) - 2) this._refreshRoute(target);
      this.mode = 'route';
      aim = this.route ? this._lookahead(this.route, 7 + v.speed * 0.55) : { x: target.x, z: target.z };
    }
    // steering
    const yaw = v.yaw;
    let ang = wrapAngle(Math.atan2(aim.x - v.com.x, aim.z - v.com.z) - yaw);
    // avoid vehicles right ahead
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let avoid = 0, blockGap = 1e9;
    for (const o2 of game.vehicles.list) {
      if (o2 === v || (o.ignore && o.ignore === o2)) continue;
      const rx = o2.com.x - v.com.x, rz = o2.com.z - v.com.z;
      const ahead = rx * fx + rz * fz; if (ahead < 0 || ahead > 16) continue;
      const lat = rx * fz - rz * fx; // + = left
      if (Math.abs(lat) > (v.spec.W + o2.spec.W) / 2 + 0.6) continue;
      if (o.ram && o2 === o.ram) continue;
      blockGap = Math.min(blockGap, ahead);
      avoid += (lat > 0 ? -1 : 1) * (1 - ahead / 16) * 0.9;
    }
    // speed planning: slow for upcoming curvature
    let far = aim;
    if (!direct) far = this.path ? this._peek(this.path, 26 + v.speed * 0.8) : this.route ? this._peek(this.route, 26 + v.speed * 0.8) : aim;
    const angFar = Math.abs(wrapAngle(Math.atan2(far.x - v.com.x, far.z - v.com.z) - yaw));
    let vmax = lerp(this.maxSpeed, 9, clamp(angFar / 1.1, 0, 1));
    if (Math.abs(ang) > 1.2) vmax = Math.min(vmax, 8);
    if (!o.ram && dist < 25 && !this.path) vmax = Math.min(vmax, Math.max(o.minSpeed ?? 0, dist * 0.6));
    if (aim.end && !o.ram) vmax = Math.min(vmax, Math.max(0, (dist - this.arriveDist) * 0.8));
    if (blockGap < 9 && !o.ram) vmax = Math.min(vmax, blockGap * 0.9);
    // reverse to unstick
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      ctl.throttle = 0; ctl.brake = 1; ctl.steer = clamp(-ang * 2, -1, 1); ctl.handbrake = false;
      return dist;
    }
    const sp = v.fwdSpeed;
    ctl.steer = clamp(ang * 2.4 + avoid, -1, 1);
    if (sp < vmax - 0.5) { ctl.throttle = clamp((vmax - sp) * 0.35, 0.25, 1); ctl.brake = 0; }
    else if (sp > vmax + 2) { ctl.throttle = 0; ctl.brake = clamp((sp - vmax) * 0.15, 0.2, 1); }
    else { ctl.throttle = 0.15; ctl.brake = 0; }
    ctl.handbrake = Math.abs(ang) > 1.4 && sp > 12 && this.aggressive > 0.6;
    // stuck?
    if (ctl.throttle > 0.3 && Math.abs(sp) < 1.2 && dist > this.arriveDist + 2) { this.stuckT += dt; if (this.stuckT > 1.6) { this.reverseT = 1.3; this.stuckT = 0; } }
    else this.stuckT = Math.max(0, this.stuckT - dt);
    return dist;
  }
  _peek(pts, dist) {
    let acc = 0, i = this.idx, px = this.v.com.x, pz = this.v.com.z;
    while (i < pts.length - 1) { const nx = pts[i + 1][0], nz = pts[i + 1][1], l = Math.hypot(nx - px, nz - pz); if (acc + l >= dist) { const t = (dist - acc) / (l || 1); return { x: px + (nx - px) * t, z: pz + (nz - pz) * t }; } acc += l; px = nx; pz = nz; i++; }
    return { x: pts[pts.length - 1][0], z: pts[pts.length - 1][1] };
  }
}
const IGNORE = new Set(['breakable', 'prop', 'fence', 'rail', 'curb', 'piling']);
