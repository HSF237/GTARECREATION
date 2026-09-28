// Pedestrians: wander the sidewalk graph (waiting at signalled crosswalks), idle, and react to danger:
// flee, cower, hands up, or fight back. Ex-drivers who abandon their car are adopted here.
import * as THREE from 'three';
import { randomAppearance } from '../entities/character.js';
import { makeRng } from '../core/rng.js';
import { clamp, dampAngle, wrapAngle } from '../core/math.js';
import { pedCanCross } from '../world/roads.js';
import { Actor } from './actor.js';
import { melee } from './combat.js';

const DENSITY = { downtown: 1, midtown: 0.85, midtown2: 0.85, oldquarter: 0.85, palmshore: 1, linden: 0.6, ironworks: 0.4, saltgate: 0.35, crestline: 0.22, sea: 0 };
const _v = new THREE.Vector3(), _sph = new THREE.Sphere();

export class PedManager {
  constructor(game) {
    this.game = game; this.peds = []; this.rng = makeRng(2024);
    const q = game.quality;
    this.max = q === 'low' ? 22 : q === 'medium' ? 34 : 46;
    this.spawnT = 0;
    this.frustum = new THREE.Frustum(); this._pm = new THREE.Matrix4();
    const ev = game.events;
    ev.on('gunshot', (e) => this.panic(e.position, e.shooter && e.shooter.isCop ? 25 : 45, 12, e.shooter));
    ev.on('explosionFx', (e) => this.panic(e.position, 70, 16, e.attacker));
    ev.on('actorKilled', (e) => { if (!e.actor.isPlayer) this.panic(e.actor.pos, 18, 12, e.info && e.info.attacker); });
    ev.on('pedHit', (e) => this.panic(e.actor.pos, 16, 8, e.vehicle.driver));
    ev.on('punchHit', (e) => this._punched(e));
    ev.on('carjack', (e) => this.panic(e.vehicle.com, 14, 8, e.actor));
  }
  *actors() { for (const p of this.peds) yield p.a; }

  // ------------------------------------------------------------------ spawning
  _visible(x, y, z) { _sph.center.set(x, y + 1, z); _sph.radius = 1.5; return this.frustum.intersectsSphere(_sph); }
  /** Fill the area immediately (after a teleport / new game); visible spots allowed beyond 25 m. */
  populate() { for (let k = 0; k < this.max * 4 && this.peds.length < this.max * 0.8; k++) this._trySpawn(this.game.focus, true); }
  _trySpawn(focus, force = false) {
    const city = this.game.city, SW = city.sidewalks, rng = this.rng;
    const ang = rng.next() * Math.PI * 2, dist = force ? 20 + rng.next() * 90 : 32 + rng.next() * 70;
    const x = focus.x + Math.cos(ang) * dist, z = focus.z + Math.sin(ang) * dist;
    const nid = city.nearestSidewalkNode(x, z);
    if (nid == null) return;
    const n = SW.nodes[nid];
    const d2 = (n.x - focus.x) ** 2 + (n.z - focus.z) ** 2;
    if (d2 < (force ? 18 * 18 : 30 * 30)) return;
    if (!force && d2 < 75 * 75 && this._visible(n.x, n.y, n.z)) return;
    const dist0 = city.districtAt(n.x, n.z).id;
    if (rng.next() > (DENSITY[dist0] ?? 0.6)) return;
    for (const p of this.peds) if ((p.a.pos.x - n.x) ** 2 + (p.a.pos.z - n.z) ** 2 < 9) return;
    const role = dist0 === 'downtown' && rng.chance(0.4) ? 'business' : dist0 === 'palmshore' && rng.chance(0.5) ? 'beach' : (dist0 === 'ironworks' || dist0 === 'saltgate') && rng.chance(0.45) ? 'worker' : 'civilian';
    const a = new Actor(this.game, randomAppearance(rng, { role }), { health: 60 + rng.int(0, 40) });
    const y = city.collision.groundHeight(n.x, n.z, n.y + 1, 0.6);
    a.place(n.x, y, n.z, rng.next() * 6.28);
    this.peds.push(this._brain(a, nid));
  }
  _brain(a, nid) {
    const rng = this.rng;
    const p = { a, node: nid, prev: -1, link: null, state: 'walk', t: 0, speed: 1.15 + rng.next() * 0.45, off: (rng.next() - 0.5) * 1.6, threat: null, threatActor: null, idleT: 0, fightT: 0, tough: rng.chance(a.app.fem ? 0.1 : 0.3) && a.role !== 'business', stuck: 0, lastD: 0, dead: 0 };
    this._pickNext(p);
    return p;
  }
  /** Take ownership of an existing actor (e.g. a driver who bailed out). */
  adopt(a, mood = 'flee', threatPos = null) {
    if (this.peds.some(p => p.a === a)) return;
    const nid = this.game.city.nearestSidewalkNode(a.pos.x, a.pos.z);
    const p = this._brain(a, nid ?? 0);
    if (mood === 'flee' || mood === 'panic') { p.state = 'flee'; p.t = 10 + this.rng.next() * 6; p.threat = (threatPos || a.pos).clone ? (threatPos || a.pos).clone() : new THREE.Vector3(threatPos.x, 0, threatPos.z); }
    else { p.state = 'return'; }
    this.peds.push(p);
  }
  _pickNext(p) {
    const SW = this.game.city.sidewalks, adj = SW.adj[p.node];
    if (!adj || !adj.length) { p.link = null; return; }
    let cands = adj.filter(li => { const l = SW.links[li]; const o = l.a === p.node ? l.b : l.a; return o !== p.prev; });
    if (!cands.length) cands = adj;
    // prefer walkways, cross streets sometimes
    const w = cands.map(li => SW.links[li].kind === 'crosswalk' ? 0.35 : 1);
    let tot = w.reduce((a, b) => a + b, 0), r = this.rng.next() * tot, pick = cands[0];
    for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) { pick = cands[i]; break; } }
    p.link = SW.links[pick];
    p.target = p.link.a === p.node ? p.link.b : p.link.a;
  }

  // ------------------------------------------------------------------ reactions
  panic(pos, radius, dur, source) {
    for (const p of this.peds) {
      const a = p.a; if (!a.alive || a.inVehicle) continue;
      const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
      if (d > radius) continue;
      if (p.state === 'fight' && source === p.threatActor) continue;
      if (p.state !== 'flee' && p.state !== 'cower') this.game.events.emit('pedScream', { actor: a, position: a.pos });
      if (d < radius * 0.35 && this.rng.chance(0.2)) { p.state = 'cower'; p.t = dur * 0.6; }
      else { p.state = 'flee'; p.t = dur + this.rng.next() * 6; }
      p.threat = new THREE.Vector3(pos.x, pos.y, pos.z); p.threatActor = source || null;
    }
  }
  _punched(e) {
    const t = e.target, p = this.peds.find(q => q.a === t);
    if (p && t.alive) {
      if (p.tough && e.attacker && e.attacker.isPlayer && !(e.attacker.weapon !== 'fists')) { p.state = 'fight'; p.threatActor = e.attacker; p.fightT = 14; }
      else { p.state = 'flee'; p.t = 10; p.threat = e.attacker.pos.clone(); p.threatActor = e.attacker; }
    }
    this.panic(e.target.pos, 10, 8, e.attacker);
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const game = this.game, focus = game.focus, cam = game.camera.camera, city = game.city;
    this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this._pm);
    const night = game.env.nightFactor;
    const target = Math.round(this.max * (1 - night * 0.55) * (game.weather.rain > 0.4 ? 0.6 : 1));
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 0.2; for (let k = 0; k < 3 && this.peds.filter(p => p.a.alive).length < target; k++) this._trySpawn(focus); }
    const player = game.player;
    const aimTarget = player.aiming && player.weapon !== 'fists' ? this._aimedPed() : null;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i], a = p.a;
      if (a.removed) { this.peds.splice(i, 1); continue; }
      const d2 = (a.pos.x - focus.x) ** 2 + (a.pos.z - focus.z) ** 2;
      const vis = this._visible(a.pos.x, a.pos.y, a.pos.z);
      if ((d2 > 150 * 150 && !vis) || d2 > 230 * 230) { this._remove(i); continue; }
      if (!a.alive) { p.dead += dt; a.updateState(dt); a.updateAnim(dt); if (p.dead > 30 && (!vis || d2 > 80 * 80)) this._remove(i); continue; }
      if (a.inVehicle) continue;
      if (a.updateState(dt)) { a.updateAnim(dt); continue; }
      if (aimTarget === p && p.state !== 'flee' && p.state !== 'fight') { if (p.state !== 'handsUp') { p.state = 'handsUp'; p.t = 2.5 + this.rng.next() * 3; } }
      const near = (a.pos.x - cam.position.x) ** 2 + (a.pos.z - cam.position.z) ** 2 < 130 * 130;
      this._think(p, dt);
      if (near || !a.rig.visible) { a.rig.visible = near; }
      a.rig.visible = near;
      if (near) a.updateAnim(dt, { mode: p.state === 'cower' ? 'cower' : p.state === 'handsUp' ? 'handsUp' : p.state === 'idle' && p.idleMode ? p.idleMode : 'normal', punch: p._punch });
      p._punch = false;
    }
  }
  _aimedPed() {
    const game = this.game, cam = game.camera.camera;
    const o = cam.position, d = cam.getWorldDirection(_v);
    let best = null, bd = 0.12;
    for (const p of this.peds) {
      const a = p.a; if (!a.alive) continue;
      const dx = a.pos.x - o.x, dy = a.pos.y + 1.3 - o.y, dz = a.pos.z - o.z, l = Math.hypot(dx, dy, dz);
      if (l > 28) continue;
      const ang = 1 - (dx * d.x + dy * d.y + dz * d.z) / l;
      if (ang < bd * (1 / Math.max(l / 8, 1))) { bd = ang; best = p; }
    }
    return best;
  }
  _remove(i) { const p = this.peds[i]; p.a.removed = true; this.peds.splice(i, 1); }
  _think(p, dt) {
    const a = p.a, game = this.game, city = game.city, SW = city.sidewalks;
    p.t -= dt;
    let vx = 0, vz = 0;
    switch (p.state) {
      case 'walk': {
        if (!p.link) { p.state = 'idle'; p.t = 3; break; }
        const n = SW.nodes[p.target];
        // offset sideways so peds don't walk single file
        const from = SW.nodes[p.link.a === p.target ? p.link.b : p.link.a];
        let dx = n.x - from.x, dz = n.z - from.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const off = p.link.kind === 'crosswalk' ? p.off * 0.6 : p.off;
        const tx = n.x - dz * off, tz = n.z + dx * off;
        const ddx = tx - a.pos.x, ddz = tz - a.pos.z, dd = Math.hypot(ddx, ddz);
        // waiting at a signalled crosswalk
        if (p.link.kind === 'crosswalk' && p.link.signal && !p.crossing) {
          const node = city.roads.nodes[p.link.node];
          if (!pedCanCross(node, p.link.edge, game.time)) { p.waiting = true; a.yaw = dampAngle(a.yaw, Math.atan2(dx, dz), 5, dt); break; }
          p.crossing = true; p.waiting = false;
        }
        if (dd < 0.7) {
          p.prev = p.node; p.node = p.target; p.crossing = false;
          if (this.rng.chance(0.08)) { p.state = 'idle'; p.t = 3 + this.rng.next() * 7; p.idleMode = this.rng.chance(0.4) ? 'phone' : null; }
          this._pickNext(p);
          break;
        }
        const sp = p.speed * (p.crossing ? 1.25 : 1) * (game.weather.rain > 0.4 ? 1.3 : 1);
        vx = ddx / dd * sp; vz = ddz / dd * sp;
        if (dd > p.lastD - 0.005 * dt) p.stuck += dt; else p.stuck = 0;
        p.lastD = dd;
        if (p.stuck > 4) { p.stuck = 0; p.prev = p.target; this._pickNext(p); }
        break;
      }
      case 'idle': if (p.t <= 0) { p.state = 'walk'; p.idleMode = null; } break;
      case 'handsUp': if (p.t <= 0) { p.state = 'flee'; p.t = 10; p.threat = game.player.pos.clone(); } break;
      case 'cower': if (p.t <= 0) { p.state = 'flee'; p.t = 8; } break;
      case 'flee': {
        const th = p.threatActor && p.threatActor.alive ? p.threatActor.pos : p.threat;
        let dx = a.pos.x - th.x, dz = a.pos.z - th.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        // bias toward sidewalks and away from walls
        const wob = Math.sin(game.time * 0.7 + p.off * 10) * 0.35;
        const c = Math.cos(wob), s = Math.sin(wob); const fx = dx * c - dz * s, fz = dx * s + dz * c;
        const sp = 5.2;
        vx = fx * sp; vz = fz * sp;
        if (a.speedNow < 1.2 && p.t < 20) { p.stuck += dt; if (p.stuck > 0.8) { p.off = -p.off; p.threat = new THREE.Vector3(a.pos.x + dz * 5 * Math.sign(p.off), 0, a.pos.z - dx * 5 * Math.sign(p.off)); p.stuck = 0; } } else p.stuck = 0;
        if (p.t <= 0 || l > 90) { p.state = 'return'; }
        break;
      }
      case 'return': {
        const nid = city.nearestSidewalkNode(a.pos.x, a.pos.z);
        if (nid == null) { p.state = 'idle'; p.t = 5; break; }
        const n = SW.nodes[nid], dx = n.x - a.pos.x, dz = n.z - a.pos.z, d = Math.hypot(dx, dz);
        if (d < 1) { p.node = nid; p.prev = -1; this._pickNext(p); p.state = 'walk'; break; }
        vx = dx / d * 1.4; vz = dz / d * 1.4;
        break;
      }
      case 'fight': {
        const t = p.threatActor;
        p.fightT -= dt;
        if (!t || !t.alive || t.inVehicle || p.fightT <= 0 || t.weapon !== 'fists') { p.state = 'flee'; p.t = 8; p.threat = t ? t.pos.clone() : a.pos.clone(); break; }
        const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        a.yaw = dampAngle(a.yaw, Math.atan2(dx, dz), 10, dt);
        if (d > 1.2) { vx = dx / d * 4.2; vz = dz / d * 4.2; }
        else { a.fireCooldown -= dt; if (a.fireCooldown <= 0) { a.fireCooldown = 0.8 + this.rng.next() * 0.5; melee(game, a, a.pos, a.yaw, 7); p._punch = true; } }
        break;
      }
    }
    if (vx || vz) { if (p.state !== 'fight') a.yaw = dampAngle(a.yaw, Math.atan2(vx, vz), 8, dt); }
    a.physics(dt, vx, vz, false);
  }
  clear() { for (const p of this.peds) p.a.removed = true; this.peds.length = 0; }
}
