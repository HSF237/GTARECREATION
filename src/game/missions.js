// Missions: an original six-job story (Inez, Otis, Marisol) plus side jobs (street races, taxi fares,
// courier runs). Small state machines built from shared helpers (objectives, GPS, timers, markers,
// cutscenes with subtitles, spawned vehicles and crews).
import * as THREE from 'three';
import { randomAppearance } from '../entities/character.js';
import { makeRng } from '../core/rng.js';
import { clamp, dampAngle } from '../core/math.js';
import { Actor } from './actor.js';
import { AIDriver } from './driver.js';

const GOLD = 0xffc857, TEAL = 0x3dd6c6, PINK = 0xff4fd8, GREEN = 0x3ddc84, RED = 0xff5e62;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- contacts (original characters)
const CONTACT_LOOKS = {
  inez: { name: 'Inez Varga', app: { model: 'inez', fem: true, height: 1.72, build: 0.98, skin: 0xa86b45, hair: 3, hairColor: 0x1b120c, shirt: 0x7a1f2f, jacket: 0x1c1c1e, pants: 0x1f2a3a, shoes: 0x111111, sleeves: 0, shorts: false } },
  otis: { name: 'Otis Bell', app: { model: 'otis', fem: false, height: 1.9, build: 1.16, skin: 0x4e2c19, hair: 0, hairColor: 0x111111, beard: true, shirt: 0x2e86c1, pants: 0x3b3b3b, shoes: 0x5a3a22, hat: 4, sleeves: 1, shorts: false } },
  marisol: { name: 'Marisol Reyes', app: { model: 'marisol', fem: true, height: 1.68, build: 0.95, skin: 0xc68863, hair: 4, hairColor: 0x2c1b10, shirt: 0xe8e0c8, jacket: 0x5b2c6f, pants: 0x111111, shoes: 0x111111, sleeves: 0, shorts: false } },
};

// ---------------------------------------------------------------- base mission
class Mission {
  constructor(mgr, def) { this.mgr = mgr; this.game = mgr.game; this.def = def; this.step = 0; this.t = 0; this.vehicles = []; this.hostileGroup = 'm' + Math.random().toString(36).slice(2); }
  get P() { return this.game.player; }
  get pp() { const P = this.P; return P.inVehicle && P.vehicle ? P.vehicle.com : P.pos; }
  near(p, r, needVehicle = false) { if (needVehicle && !this.P.inVehicle) return false; const q = this.pp; return Math.hypot(p.x - q.x, p.z - q.z) < r && Math.abs((p.y ?? q.y) - q.y) < 8; }
  next(n) { this.step = n ?? this.step + 1; this.t = 0; }
  car(type, x, y, z, yaw, o = {}) { const v = this.game.vehicles.spawn(type, x, y, z, yaw, o); v.keep = true; v.missionCar = true; this.vehicles.push(v); return v; }
  lane(x, z, maxD = 60) { return this.game.city.nearestLane(x, z, null, maxD); }
  carOnLane(type, x, z, o = {}) { const n = this.lane(x, z, 80); if (!n) return null; return this.car(type, n.x, n.y, n.z, Math.atan2(n.dx, n.dz), o); }
  cleanup() {
    const P = this.P;
    for (const v of this.vehicles) if (!v.removed) { v.keep = false; v.missionCar = false; if (v.ai && v.ai.mission) v.ai = null; if (P.vehicle !== v && P.lastVehicle !== v && v.com.distanceTo(this.pp) > 60) this.game.vehicles.remove(v); }
    this.game.hostiles.clear(this.hostileGroup);
    this.mgr.clearActors();
  }
  update() {}
}

// ---------------------------------------------------------------- story
class Homecoming extends Mission {
  begin() { this.mgr.obj('Go to the end of Sol Pier.'); }
  update(dt) {
    const m = this.mgr, P = this.game.city.poi;
    if (this.step === 0) {
      m.gps(P.pierEnd); m.marker(P.pierEnd, 2, GOLD);
      if (this.near(P.pierEnd, 3.2)) { this.next(1); m.obj('Take the package to Inez\'s garage.'); m.timer(200); this.game.hud.note('You picked up <b>Inez\'s package</b>.'); this.game.audio?.jingle('pickup'); }
    } else if (this.step === 1) {
      m.gps(P.salvageDrop); m.marker(P.salvageDrop, 6, GOLD);
      if (this.near(P.salvageDrop, 7)) return 'pass';
      if (m.timeLeft <= 0) return 'fail:You took too long.';
    }
  }
}
class SalvageRights extends Mission {
  begin() {
    const city = this.game.city;
    // a driveway or lot in the Crestline Hills, else along the hill road
    const spots = city.parking.filter(s => s.district === 'crestline');
    let s = spots.length ? spots[Math.floor(spots.length * 0.37)] : null;
    if (!s) { const pts = city.hill.roadB.points, p = pts[Math.floor(pts.length * 0.4)]; s = { x: p.x + 6, y: city.collision.groundHeight(p.x + 6, p.z), z: p.z, yaw: 0 }; }
    for (const v of [...this.game.vehicles.list]) if (!v.keep && v.com.distanceTo(V(s.x, s.y, s.z)) < 6) this.game.vehicles.remove(v);
    this.target = this.car('super', s.x, s.y, s.z, s.yaw, { color: 0xf2f2f2, seed: 777 });
    this.mgr.obj('Steal the white Zenith R in the Crestline Hills.');
  }
  update(dt) {
    const m = this.mgr, v = this.target, P = this.game.player, drop = this.game.city.poi.salvageDrop;
    if (v.exploded || v.drowned > 2) return 'fail:The Zenith R was wrecked.';
    if (v.health < v.maxHealth * 0.3) return 'fail:The Zenith R is too damaged to sell.';
    if (this.step === 0) {
      m.gps(v.com); m.arrow(v.com, v.spec.H + 1.2, GOLD);
      if (P.vehicle === v) { this.next(1); this.game.heat.addPoints(4); this.game.hud.note('The alarm company called it in.'); }
    } else {
      if (P.vehicle !== v) { m.obj('Get back in the Zenith R.'); m.gps(v.com); m.arrow(v.com, v.spec.H + 1.2, GOLD); return; }
      if (this.game.heat.level > 0) { m.obj('Lose the heat.'); m.gps(null); return; }
      m.obj('Deliver the Zenith R to Inez\'s garage.'); m.gps(drop); m.marker(drop, 5, GOLD);
      if (this.near(drop, 6, true) && v.speed < 3) { this.bonus = Math.round(1500 * v.health / v.maxHealth); return 'pass'; }
    }
  }
  reward() { return 3000 + (this.bonus || 0); }
}
class ColdCargo extends Mission {
  begin() {
    const g = this.game, o = g.city.poi.contacts.otis;
    const n = this.lane(o.x + 120, o.z - 40, 120) || this.lane(o.x, o.z, 200);
    this.truck = this.car('truck', n.x, n.y, n.z, Math.atan2(n.dx, n.dz), { color: 0x7a1f2f, seed: 31 });
    this.truck.maxHealth = this.truck.health = 2600;
    this.drv = g.hostiles.spawn(n.x, n.y, n.z, { group: this.hostileGroup, weapon: 'pistol' }); g.hostiles.seat(this.drv, this.truck, 1);
    this.dest = V(-560, 0, -520); // far side of Linden Grove
    this.ai = new AIDriver(g, this.truck, { maxSpeed: 19, aggressive: 0.3 });
    this.truck.wake();
    // escort SUV with two shooters
    const n2 = this.lane(n.x - n.dx * 18, n.z - n.dz * 18, 30) || n;
    this.escort = this.car('suv', n2.x - n.dx * 14, n2.y, n2.z - n.dz * 14, Math.atan2(n.dx, n.dz), { color: 0x111214, seed: 32 });
    const e1 = g.hostiles.spawn(n2.x, n2.y, n2.z, { group: this.hostileGroup, weapon: 'smg' }); g.hostiles.seat(e1, this.escort, 1);
    const e2 = g.hostiles.spawn(n2.x, n2.y, n2.z, { group: this.hostileGroup, weapon: 'pistol' }); g.hostiles.seat(e2, this.escort, -1);
    this.eai = new AIDriver(g, this.escort, { maxSpeed: 24, aggressive: 0.8 });
    this.escort.wake();
    this.mgr.obj('Destroy the box truck before it reaches Linden Grove.');
  }
  update(dt) {
    const m = this.mgr, t = this.truck;
    if (t.exploded) return 'pass';
    m.gps(t.com); m.arrow(t.com, t.spec.H + 1.5, RED);
    if (this.drv.a.alive && this.drv.a.vehicle === t) {
      const d = this.ai.update(dt, this.dest, null, { minSpeed: 8 });
      if (d < 25) return 'fail:The truck got away.';
    } else { t.controls.throttle = 0; t.controls.brake = 1; }
    if (this.escort && !this.escort.exploded && this.escort.driver && this.escort.driver.alive) {
      const tgt = this.P.pos.distanceTo(this.escort.com) < 60 ? this.pp : t.com;
      this.eai.update(dt, tgt, null, { ram: this.P.vehicle || null, directDist: 40 });
    }
    if (this.t > 20 && t.com.distanceTo(this.pp) > 520) return 'fail:You lost the truck.';
  }
}
class NightShift extends Mission {
  begin() {
    const city = this.game.city;
    let best = null, bd = 1e9;
    for (const b of city.blocks) if (b.district === 'ironworks' && b.kind === 'city') { const d = Math.hypot(b.cx - 720, b.cz + 150); if (d < bd) { bd = d; best = b; } }
    this.yard = best ? V(best.cx, best.top, best.cz) : V(720, 0.15, -150);
    this.mgr.obj('Go to the crew\'s yard in the Ironworks.');
  }
  update(dt) {
    const m = this.mgr, g = this.game, y = this.yard;
    if (this.step === 0) {
      m.gps(y); m.marker(y, 8, RED);
      if (this.near(y, 70)) {
        const col = g.city.collision;
        for (let i = 0; i < 6; i++) {
          let x = y.x, z = y.z;
          for (let k = 0; k < 20; k++) { const a = i / 6 * Math.PI * 2 + k * 0.7, r = 6 + (k % 4) * 3; x = y.x + Math.cos(a) * r; z = y.z + Math.sin(a) * r; if (col.collideCircle(x, z, 0.5, y.y + 0.5, y.y + 1.7, []) === 0) break; }
          g.hostiles.spawn(x, y.y + 1, z, { group: this.hostileGroup, weapon: ['pistol', 'smg', 'shotgun', 'pistol', 'smg', 'rifle'][i], accuracy: 0.6 });
        }
        this.next(1);
      }
    } else if (this.step === 1) {
      const n = g.hostiles.alive(this.hostileGroup);
      m.obj(`Take out the crew. <b>${n}</b> left.`); m.gps(y);
      for (const h of g.hostiles.list) if (h.group === this.hostileGroup && h.a.alive) m.arrow(h.a.pos, 2.4, RED, 0.6);
      if (n === 0) { this.next(2); this.ledger = g.activities.drop('item', y.x, y.y + 0.7, y.z, {}); this.ledger.type = 'item'; }
    } else if (this.step === 2) {
      m.obj('Grab the ledger.'); m.gps(y); m.marker(y, 1.4, GOLD);
      if (this.near(y, 1.8)) { g.activities.render.remove(this.ledger); g.activities.pickups.splice(g.activities.pickups.indexOf(this.ledger), 1); g.heat.addPoints(5); this.game.audio?.jingle('pickup'); this.game.hud.note('Got the ledger. Someone heard the shooting.'); this.next(3); }
    } else {
      if (g.heat.level > 0) { m.obj('Lose the heat.'); m.gps(null); }
      else return 'pass';
    }
  }
}
class VelvetRope extends Mission {
  begin() {
    const g = this.game, c = g.city.poi.contacts.marisol;
    this.club = V(c.x, c.y ?? 0.15, c.z);
    this.mari = this.mgr.contactActor('marisol', true);
    const park = g.city.blocks.find(b => b.kind === 'park' && Math.abs(b.cx + 300) < 80 && Math.abs(b.cz - 228) < 80) || g.city.blocks.find(b => b.kind === 'park');
    const pn = this.lane(park ? park.cx : -300, park ? park.cz + 70 : 300, 90);
    this.stop1 = V(pn.x, pn.y, pn.z);
    const s = g.city.poi.solstice; const sn = this.lane(s.x, s.z + 20, 90);
    this.stop2 = V(sn.x, sn.y, sn.z);
    this.mgr.obj('Get a car and pick up Marisol.');
  }
  update(dt) {
    const m = this.mgr, g = this.game, P = this.P, a = this.mari;
    if (!a.alive) return 'fail:Marisol is dead.';
    const inCar = a.inVehicle && P.vehicle && a.vehicle === P.vehicle;
    if (this.step === 0) {
      m.gps(this.club); m.arrow(a.pos, 2.4, GOLD, 0.7);
      if (P.inVehicle && P.vehicle && P.vehicle.spec.seats >= 2 && !P.vehicle.passenger && a.pos.distanceTo(P.vehicle.com) < 14 && P.vehicle.speed < 2) {
        if (a.state !== 'toDoor' && a.state !== 'entering' && !a.inVehicle) a.beginEnter(P.vehicle, -1);
      }
      if (a.state === 'toDoor') a.updateToDoor(dt, false);
      if (inCar) { this.next(1); m.say([['Marisol', 'Castell Park first. Someone owes me an answer.']]); m.timer(150); }
    } else if (!inCar && this.step < 5) {
      m.obj('Marisol is waiting. Get back to her.'); m.arrow(a.pos, 2.4, GOLD, 0.7);
      if (a.inVehicle && a.vehicle !== P.vehicle) { a.leaveSeat(true); }
      if (P.inVehicle && P.vehicle && !P.vehicle.passenger && a.pos.distanceTo(P.vehicle.com) < 14 && P.vehicle.speed < 2 && a.state !== 'toDoor' && a.state !== 'entering' && !a.inVehicle) a.beginEnter(P.vehicle, -1);
      if (a.state === 'toDoor') a.updateToDoor(dt, true);
      if (!P.inVehicle && a.pos.distanceTo(P.pos) > 80) return 'fail:You left Marisol behind.';
      return;
    } else if (this.step === 1) {
      m.obj('Drive Marisol to Castell Park.'); m.gps(this.stop1); m.marker(this.stop1, 4, GOLD);
      if (m.timeLeft <= 0) return 'fail:Marisol missed her meeting.';
      if (this.near(this.stop1, 6, true) && P.vehicle.speed < 3) { this.next(2); m.timer(0); m.say([['Marisol', '...'], ['Marisol', 'Fine. Solstice Tower. And step on it.']]); m.timer(160); }
    } else if (this.step === 2) {
      m.obj('Drive to Solstice Tower.'); m.gps(this.stop2); m.marker(this.stop2, 4, GOLD);
      if (m.timeLeft <= 0) return 'fail:Marisol missed her meeting.';
      if (this.near(this.stop2, 6, true) && P.vehicle.speed < 3) {
        m.timer(0);
        m.say([['Marisol', 'That black Bruiser has been on us since the park.'], ['Remy', 'Hold on to something.']]);
        const back = this.lane(this.stop2.x - 80, this.stop2.z + 60, 120) || this.lane(this.stop2.x, this.stop2.z, 200);
        this.rival = this.car('muscle', back.x, back.y, back.z, Math.atan2(back.dx, back.dz), { color: 0x111214, seed: 55 });
        const h1 = g.hostiles.spawn(back.x, back.y, back.z, { group: this.hostileGroup, weapon: 'smg', alert: true }); g.hostiles.seat(h1, this.rival, 1);
        const h2 = g.hostiles.spawn(back.x, back.y, back.z, { group: this.hostileGroup, weapon: 'pistol', alert: true }); g.hostiles.seat(h2, this.rival, -1);
        this.rai = new AIDriver(g, this.rival, { maxSpeed: 40, aggressive: 0.9 }); this.rival.wake();
        this.next(3);
      }
    } else if (this.step === 3) {
      const r = this.rival, d = r.com.distanceTo(this.pp);
      m.obj(`Lose the rival crew. <b>${Math.round(d)}</b> m`); m.gps(null); m.arrow(r.com, r.spec.H + 1.2, RED);
      if (r.driver && r.driver.alive && !r.exploded) this.rai.update(dt, this.pp, P.vehicle ? P.vehicle.vel : null, { ram: P.vehicle, directDist: 60 });
      if (d > 190 || r.exploded || !r.driver || !r.driver.alive) { this.next(4); m.say([['Marisol', 'Not bad. Take me home.']]); }
    } else if (this.step === 4) {
      m.obj('Take Marisol back to the club.'); m.gps(this.club); m.marker(this.club, 5, GOLD);
      if (this.near(this.club, 12, true) && P.vehicle.speed < 3) { a.beginExit(); this.next(5); }
    } else {
      if (a.state === 'exiting' || a.inVehicle) return;
      return 'pass';
    }
  }
}
class HighTide extends Mission {
  begin() {
    const g = this.game;
    const n = this.lane(420, -20, 60) || this.lane(300, -20, 200);
    this.truck = this.car('truck', n.x, n.y, n.z, Math.atan2(n.dx, n.dz), { color: 0x3b4a2f, seed: 91 });
    this.truck.maxHealth = this.truck.health = 5200;
    this.drv = g.hostiles.spawn(n.x, n.y, n.z, { group: this.hostileGroup, weapon: 'rifle' }); g.hostiles.seat(this.drv, this.truck, 1);
    this.ai = new AIDriver(g, this.truck, { maxSpeed: 17, aggressive: 0.2 });
    this.dest = V(-880, 0, -600);
    this.escorts = [];
    for (let k = 1; k <= 2; k++) {
      const e = this.car('suv', n.x - n.dx * 13 * k, n.y, n.z - n.dz * 13 * k, Math.atan2(n.dx, n.dz), { color: 0x1c1f24, seed: 92 + k });
      for (const side of [1, -1]) { const h = g.hostiles.spawn(e.com.x, n.y, e.com.z, { group: this.hostileGroup, weapon: side === 1 ? 'smg' : 'rifle', accuracy: 0.65, health: 120 }); g.hostiles.seat(h, e, side); }
      this.escorts.push({ v: e, ai: new AIDriver(g, e, { maxSpeed: 26, aggressive: 0.8 }) });
      e.wake();
    }
    this.truck.wake();
    this.mgr.obj('Stop the armored truck.');
  }
  update(dt) {
    const m = this.mgr, g = this.game, t = this.truck, P = this.P;
    if (this.step === 0) {
      m.gps(t.com); m.arrow(t.com, t.spec.H + 1.5, RED);
      this.ai.maxSpeed = this.t < 12 ? 9 : 17;
      const d = this.drv.a.alive && t.driver === this.drv.a ? this.ai.update(dt, this.dest, null, { minSpeed: 6 }) : 1e9;
      if (d < 30) return 'fail:The armored truck made it out.';
      for (const e of this.escorts) if (!e.v.exploded && e.v.driver && e.v.driver.alive) { const close = e.v.com.distanceTo(this.pp) < 50; e.ai.update(dt, close ? this.pp : t.com, null, { ram: close ? P.vehicle : null }); }
      if (t.health < t.maxHealth * 0.5 || t.exploded || !this.drv.a.alive || t.driver !== this.drv.a) {
        t.controls.throttle = 0; t.controls.brake = 1; t.controls.handbrake = true;
        for (const h of g.hostiles.list) if (h.group === this.hostileGroup) g.hostiles.alert(h);
        this.next(1); g.hud.note('The truck is disabled. The guards are getting out.');
      }
      if (this.t > 25 && t.com.distanceTo(this.pp) > 600) return 'fail:You lost the armored truck.';
    } else if (this.step === 1) {
      t.controls.throttle = 0; t.controls.brake = 1;
      const n = g.hostiles.alive(this.hostileGroup);
      m.obj(`Deal with the guards. <b>${n}</b> left.`); m.gps(t.com);
      for (const h of g.hostiles.list) if (h.group === this.hostileGroup && h.a.alive) m.arrow(h.a.pos, 2.4, RED, 0.6);
      if (n === 0 || this.t > 90) {
        const back = t.localToWorld(V(0, 0, -t.spec.L / 2 - 1.5), V());
        this.caseP = V(back.x, g.city.collision.groundHeight(back.x, back.z, t.com.y + 2, 1), back.z);
        this.case = g.activities.drop('item', this.caseP.x, this.caseP.y + 0.6, this.caseP.z, {});
        this.next(2);
      }
    } else if (this.step === 2) {
      m.obj('Grab the cash.'); m.gps(this.caseP); m.marker(this.caseP, 1.4, GOLD);
      if (this.near(this.caseP, 2, false)) {
        g.activities.render.remove(this.case); const i = g.activities.pickups.indexOf(this.case); if (i >= 0) g.activities.pickups.splice(i, 1);
        g.heat.addPoints(18); g.audio?.jingle('pickup');
        m.say([['Inez', 'Every cop in Sol Harbor is looking for you. Lose them, then meet us at the lookout.']]);
        this.next(3);
      }
    } else if (this.step === 3) {
      if (g.heat.level > 0) { m.obj('Lose the heat.'); m.gps(null); }
      else { m.obj('Bring the cash to the Crestline Lookout.'); const L = g.city.poi.lookout; m.gps(L); m.marker(L, 6, GOLD); if (this.near(L, 8)) return 'pass'; }
    }
  }
}

const STORY = [
  { id: 'homecoming', title: 'Homecoming', contact: 'inez', reward: 1500, cls: Homecoming, requires: [],
    lines: [['Inez', 'Remy Castillo. Six years gone and you walk in like you left yesterday.'], ['Remy', 'I heard you need a driver.'], ['Inez', 'I need someone who doesn\'t ask questions. A package is waiting at the end of Sol Pier.'], ['Inez', 'Bring it to my garage. And Remy? Don\'t make me wait.']] },
  { id: 'salvage', title: 'Salvage Rights', contact: 'inez', reward: 3000, cls: SalvageRights, requires: ['homecoming'],
    lines: [['Inez', 'A banker up in Crestline drives a Zenith R he doesn\'t deserve.'], ['Inez', 'Take it and bring it to the garage. In one piece, it\'s worth more.'], ['Remy', 'And the alarm?'], ['Inez', 'Loud. Lose whoever comes looking before you bring it here.']] },
  { id: 'cargo', title: 'Cold Cargo', contact: 'otis', reward: 3500, cls: ColdCargo, requires: ['homecoming'],
    lines: [['Otis', 'You\'re Inez\'s driver. Good. I need someone with a heavy foot.'], ['Otis', 'A crew hit my warehouse and loaded my cargo into a box truck. It\'s pulling out of Saltgate now.'], ['Otis', 'I don\'t want it back. I want it gone.']] },
  { id: 'nightshift', title: 'Night Shift', contact: 'otis', reward: 4000, cls: NightShift, requires: ['cargo'],
    lines: [['Otis', 'That crew works out of a yard in the Ironworks.'], ['Otis', 'They keep a ledger. Names, drops, dates. I want it.'], ['Remy', 'They\'ll be armed.'], ['Otis', 'So will you. There\'s a gun shop downtown if you need to shop first.']] },
  { id: 'velvet', title: 'Velvet Rope', contact: 'marisol', reward: 5000, cls: VelvetRope, requires: ['salvage'],
    lines: [['Marisol', 'So you\'re the driver everyone keeps mentioning.'], ['Remy', 'Depends who\'s asking.'], ['Marisol', 'Someone who pays. Two meetings, then back here before the doors open.']] },
  { id: 'hightide', title: 'High Tide', contact: 'inez', reward: 25000, cls: HighTide, requires: ['salvage', 'nightshift', 'velvet'],
    lines: [['Inez', 'Otis read the ledger. One man is behind every crew in this city.'], ['Otis', 'Tonight he moves his money in an armored truck, straight down Harbor Boulevard.'], ['Marisol', 'Two escort cars. Real guns. No second chances.'], ['Remy', 'Then tonight it doesn\'t arrive.']] },
];

// ---------------------------------------------------------------- side jobs
const RACES = {
  downtown: { cars: ['sports', 'muscle', 'sports'], via: [[420, -20], [420, 228], [60, 228], [60, -144], [300, -144], [300, -20], [140, -20]] },
  coastal: { cars: ['super', 'sports', 'muscle'], via: [[-900, 100], [-900, -600], [-540, -640]] },
  hill: { cars: ['sports', 'suv', 'muscle'], via: ['lookout'] },
};
class Race extends Mission {
  begin() {
    const g = this.game, start = this.def.start, R = RACES[start.id];
    // build the course by chaining road routes
    let pts = [[start.x, start.z]]; let from = { x: start.x, z: start.z };
    for (const w of R.via) {
      const to = w === 'lookout' ? { x: g.city.poi.lookout.x, z: g.city.poi.lookout.z } : { x: w[0], z: w[1] };
      const r = g.city.route(from, to);
      if (r) for (const p of r.points) { const q = pts[pts.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 2) pts.push(p); }
      from = to;
    }
    this.path = pts;
    this.cum = [0]; for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.length = this.cum[this.cum.length - 1];
    // checkpoints every ~120 m
    this.cps = [];
    for (let s = 120; s < this.length - 30; s += 120) this.cps.push(this._at(s));
    this.cps.push(this._at(this.length));
    this.cp = 0;
    // grid: rivals beside and behind the player
    const P = this.P, pv = P.vehicle, yaw = start.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw), lx = fz, lz = -fx;
    pv.place(start.x, start.y ?? 0, start.z, yaw); pv.wake();
    this.rivals = [];
    const slots = [[-3.4, 0], [0, -8], [-3.4, -8]];
    R.cars.forEach((type, i) => {
      const [lat, back] = slots[i];
      const x = start.x + lx * lat + fx * back, z = start.z + lz * lat + fz * back;
      const v = this.car(type, x, 0, z, yaw, { seed: 400 + i });
      const d = new Actor(g, randomAppearance(makeRng(80 + i), { role: 'civilian' }));
      d.inVehicle = true; d.vehicle = v; d.seatSide = 1; v.driver = d; this.mgr.addActor(d);
      const ai = new AIDriver(g, v, { maxSpeed: v.spec.maxSpeed * 0.78, aggressive: 0.7 }); ai.setPath(pts);
      this.rivals.push({ v, d, ai, prog: 0, idx: 0, done: false });
      v.wake();
    });
    this.count = 3.5; this.raceT = 0; this.pIdx = 0;
    this.mgr.obj(`${this.def.title}: get ready.`);
    this.game.gpsTarget = null;
  }
  _at(s) { let i = 1; while (i < this.cum.length - 1 && this.cum[i] < s) i++; const t = (s - this.cum[i - 1]) / ((this.cum[i] - this.cum[i - 1]) || 1); const a = this.path[i - 1], b = this.path[i]; return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]), s }; }
  _progress(pos, st) {
    let best = st.idx, bd = 1e18; const P = this.path;
    for (let i = Math.max(0, st.idx - 3); i < Math.min(P.length, st.idx + 25); i++) { const d = (P[i][0] - pos.x) ** 2 + (P[i][1] - pos.z) ** 2; if (d < bd) { bd = d; best = i; } }
    st.idx = best; return this.cum[best];
  }
  update(dt) {
    const m = this.mgr, g = this.game, P = this.P;
    const pv = P.vehicle;
    if (!P.inVehicle) { this.outT = (this.outT || 0) + dt; if (this.outT > 10) return 'fail:You left your car.'; m.obj('Get back in a car!'); } else this.outT = 0;
    if (pv && (pv.exploded || pv.drowned > 2)) return 'fail:Your car is wrecked.';
    if (this.count > 0) {
      this.count -= dt;
      const n = Math.ceil(this.count);
      if (n !== this._lastN && n >= 1 && n <= 3) { g.hud.big(String(n), '', '#fff', 0.8); g.audio?.tone([440], 0.2, 'square', 0.12); }
      this._lastN = n;
      for (const r of this.rivals) { r.v.controls.throttle = 0; r.v.controls.brake = 1; }
      if (pv) { pv.controls.throttle = Math.min(pv.controls.throttle, 0); pv.controls.handbrake = true; }
      if (this.count <= 0) { g.hud.big('GO', '', '#3ddc84', 1); g.audio?.tone([880], 0.4, 'square', 0.14); }
      this._show(); return;
    }
    this.raceT += dt;
    // rivals with rubber banding
    const pProg = this._progress(this.pp, this);
    for (const r of this.rivals) {
      if (r.done || r.v.exploded || !r.d.alive || r.v.driver !== r.d) continue;
      r.prog = this._progress(r.v.com, r);
      const gap = r.prog - pProg;
      r.ai.maxSpeed = r.v.spec.maxSpeed * (gap > 80 ? 0.66 : gap < -80 ? 0.9 : 0.78);
      r.ai.update(dt, { x: this.path[this.path.length - 1][0], y: 0, z: this.path[this.path.length - 1][1] });
      if (r.prog >= this.length - 12) { r.done = true; r.finish = this.raceT; r.v.controls.throttle = 0; r.v.controls.brake = 1; }
    }
    // checkpoints
    const c = this.cps[this.cp];
    if (c && Math.hypot(c.x - this.pp.x, c.z - this.pp.z) < 11) {
      this.cp++; g.audio?.jingle('check');
      if (this.cp >= this.cps.length) {
        const place = 1 + this.rivals.filter(r => r.done).length;
        this.place = place;
        const best = this.mgr.best[this.def.start.id];
        if (!best || this.raceT < best) this.mgr.best[this.def.start.id] = this.raceT;
        if (place > 3) return `fail:You finished ${place}th.`;
        return 'pass';
      }
    }
    this._show();
  }
  _show() {
    const m = this.mgr, c = this.cps[this.cp], nx = this.cps[this.cp + 1];
    if (c) { m.checkpoint(c, this.cp === this.cps.length - 1 ? GREEN : PINK); m.gps(c, true); }
    if (nx) m.game.markers.ring(nx.x, 0, nx.z, 3, 0x7a2a6a);
    const pProg = this.cum[this.idx || 0] || 0;
    const pos = 1 + this.rivals.filter(r => r.done || r.prog > pProg + 1).length;
    const tt = this.raceT, mm = Math.floor(tt / 60), ss = (tt % 60).toFixed(1).padStart(4, '0');
    m.obj(`${this.def.title} · Position <b>${pos}/4</b> · Checkpoint ${Math.min(this.cp + 1, this.cps.length)}/${this.cps.length} · ${mm}:${ss}`);
  }
  reward() { return [0, 2000, 800, 300][this.place] || 0; }
  cleanup() { for (const r of this.rivals) { r.v.keep = false; } super.cleanup(); }
}
class TaxiJob extends Mission {
  begin() { this.fares = 0; this.earned = 0; this.mgr.obj('Taxi duty. Pick up the fare marked on the map.'); this._newFare(); }
  _newFare() {
    const g = this.game, city = g.city, SW = city.sidewalks, rng = Math.random;
    const pp = this.pp;
    let best = null;
    for (let k = 0; k < 40; k++) { const n = SW.nodes[(rng() * SW.nodes.length) | 0]; const d = Math.hypot(n.x - pp.x, n.z - pp.z); if (d > 70 && d < 260 && city.districtAt(n.x, n.z).id !== 'crestline') { best = n; break; } }
    if (!best) best = SW.nodes[(rng() * SW.nodes.length) | 0];
    const a = new Actor(g, randomAppearance(makeRng((rng() * 1e6) | 0), { role: rng() < 0.4 ? 'business' : 'civilian' }));
    a.place(best.x, city.collision.groundHeight(best.x, best.z, best.y + 1, 0.6), best.z, 0);
    this.mgr.addActor(a);
    this.fare = a; this.dest = null; this.step = 0; this.t = 0;
  }
  update(dt) {
    const m = this.mgr, g = this.game, P = this.P, v = P.vehicle, a = this.fare;
    if (!v || v.type !== 'taxi') { this.outT = (this.outT || 0) + dt; m.obj('Get back in your cab.'); if (this.outT > 20) return this.fares ? 'pass' : 'fail:You left the cab.'; return; } else this.outT = 0;
    if (g.input.pressed('mission')) return this.fares ? 'pass' : 'fail:Taxi duty ended.';
    if (!a.alive) { this.mgr.dropActor(a); this._newFare(); return; }
    if (this.step === 0) {
      m.obj('Pick up the fare.'); m.gps(a.pos); m.arrow(a.pos, 2.4, GREEN, 0.6);
      a.updateAnim(dt, { mode: 'wave' }); a.yaw = dampAngle(a.yaw, Math.atan2(v.com.x - a.pos.x, v.com.z - a.pos.z), 4, dt);
      if (a.pos.distanceTo(v.com) < 12 && v.speed < 2 && !v.passenger) { a.beginEnter(v, -1); this.next(1); }
    } else if (this.step === 1) {
      if (a.state === 'toDoor') { a.updateToDoor(dt, false); a.updateAnim(dt); }
      if (a.inVehicle) {
        const SW = g.city.sidewalks; let dn = null;
        for (let k = 0; k < 60; k++) { const n = SW.nodes[(Math.random() * SW.nodes.length) | 0]; const d = Math.hypot(n.x - v.com.x, n.z - v.com.z); if (d > 350 && d < 1000 && g.city.districtAt(n.x, n.z).id !== 'crestline') { dn = n; break; } }
        dn = dn || SW.nodes[0];
        const l = this.lane(dn.x, dn.z, 40) || { x: dn.x, y: 0, z: dn.z };
        this.dest = V(l.x, l.y, l.z); this.dist = Math.hypot(this.dest.x - v.com.x, this.dest.z - v.com.z);
        m.timer(Math.round(this.dist / 9 + 25)); this.next(2);
        m.say([[ 'Fare', ['Just get me there in one piece.', 'I\'m late. Very late.', 'Scenic route is fine, as long as it\'s fast.', 'Take me across town, please.'][(Math.random() * 4) | 0] ]]);
      } else if (this.t > 12 || v.speed > 3 && a.state !== 'entering') { if (a.state === 'toDoor') a.cancelEnter(); this.step = 0; }
    } else if (this.step === 2) {
      m.obj('Drive the fare to the destination.'); m.gps(this.dest); m.marker(this.dest, 3.5, GREEN);
      if (m.timeLeft <= 0) { m.say([['Fare', 'Forget it, I\'ll walk.']]); a.beginExit(); m.timer(0); this.next(4); return; }
      if (this.near(this.dest, 9, true) && v.speed < 2.5) {
        const pay = Math.round(18 + this.dist * 0.06 + m.timeLeft * 1.2);
        P.addCash(pay); this.earned += pay; this.fares++; m.timer(0);
        g.hud.note(`Fare paid <b>$${pay}</b> · ${this.fares} fares, $${this.earned} tonight`);
        a.beginExit(); this.next(3);
      }
    } else {
      if (a.state === 'exiting') return;
      if (!a.inVehicle) { this.mgr.dropActor(a, true); this._newFare(); }
    }
  }
  reward() { return this.fares >= 5 ? 500 : 0; }
}
class CourierJob extends Mission {
  begin() { this.n = 0; this.total = 4; this.mgr.obj('Courier run: get in any vehicle.'); this._next(); }
  _next() {
    const g = this.game, SW = g.city.sidewalks;
    let dn = null;
    for (let k = 0; k < 80; k++) { const n = SW.nodes[(Math.random() * SW.nodes.length) | 0]; const d = Math.hypot(n.x - this.pp.x, n.z - this.pp.z); if (d > 250 && d < 800 && g.city.districtAt(n.x, n.z).id !== 'crestline') { dn = n; break; } }
    dn = dn || SW.nodes[0];
    const l = this.lane(dn.x, dn.z, 40) || { x: dn.x, y: 0, z: dn.z };
    this.dest = V(l.x, l.y, l.z);
    this.mgr.timer(Math.round(Math.hypot(this.dest.x - this.pp.x, this.dest.z - this.pp.z) / 10 + 30));
  }
  update(dt) {
    const m = this.mgr, P = this.P;
    m.obj(`Courier run: deliver package <b>${this.n + 1}/${this.total}</b>.`); m.gps(this.dest); m.marker(this.dest, 3.5, TEAL);
    if (m.timeLeft <= 0) return `fail:Package ${this.n + 1} arrived late.`;
    if (this.near(this.dest, 8, true) && P.vehicle.speed < 4) {
      this.n++; const pay = 150 + Math.round(m.timeLeft * 2); P.addCash(pay); this.game.audio?.jingle('check');
      this.game.hud.note(`Delivered · <b>+$${pay}</b>`);
      if (this.n >= this.total) return 'pass';
      this._next();
    }
  }
}

// ---------------------------------------------------------------- manager
export class MissionManager {
  constructor(game) {
    this.game = game; this.done = new Set(); this.best = {}; this.active = null; this.def = null;
    this.timeLeft = 0; this.timerOn = false; this.subs = []; this.cutscene = null; this.actors = []; this.contacts = {};
    this.story = STORY;
    game.events.on('actorKilled', (e) => { if (e.actor === game.player && this.active) this.fail('You died.'); });
    game.events.on('arrested', () => { if (this.active) this.fail('You were arrested.'); });
  }
  get suppressHeat() { return false; }
  *allActors() { for (const a of this.actors) if (!a.removed) yield a; for (const c of Object.values(this.contacts)) if (c && !c.removed) yield c; }
  addActor(a) { this.actors.push(a); return a; }
  dropActor(a, walkAway = false) { const i = this.actors.indexOf(a); if (i >= 0) this.actors.splice(i, 1); if (walkAway && a.alive && this.game.peds) this.game.peds.adopt(a, 'walk'); else a.removed = true; }
  clearActors() { for (const a of this.actors) { if (a.inVehicle) a.leaveSeat(true); if (a.alive && this.game.peds && a.pos.distanceTo(this.game.player.pos) < 60) this.game.peds.adopt(a, 'walk'); else a.removed = true; } this.actors = []; }
  contactActor(id, detach = false) {
    let a = this.contacts[id];
    const poi = this.game.city.poi.contacts[id];
    if (!a || a.removed) {
      const L = CONTACT_LOOKS[id], app = Object.assign(randomAppearance(makeRng(id.length * 77), { role: 'civilian' }), L.app);
      a = new Actor(this.game, app, { health: 150 }); a.contactId = id; a.name = L.name;
      a.place(poi.x, this.game.city.collision.groundHeight(poi.x, poi.z, (poi.y ?? 0) + 1, 0.6), poi.z, poi.yaw || 0);
      this.contacts[id] = a;
    }
    if (detach) { delete this.contacts[id]; this.actors.push(a); }
    return a;
  }
  available() {
    const out = [];
    for (const d of STORY) if (!this.done.has(d.id) && d.requires.every(r => this.done.has(r))) out.push(d);
    return out;
  }
  // ---- helpers used by missions
  obj(text) { this.game.hud.objective(text); }
  gps(p, quiet = false) { this.game.gpsTarget = p ? { x: p.x, y: p.y ?? 0, z: p.z } : null; }
  timer(sec) { this.timeLeft = sec; this.timerOn = sec > 0; }
  marker(p, r, color) { this.game.markers.column(p.x, (p.y ?? 0) + 0.02, p.z, r, 4 + r * 0.6, color); }
  checkpoint(c, color) { const y = this.game.city.collision.groundHeight(c.x, c.z, 50, 0); this.game.markers.checkpoint(c.x, y, c.z, c.yaw, 7, color); }
  arrow(p, h, color, s = 1) { this.game.markers.arrow(p.x, (p.y ?? 0) + h, p.z, color, s); }
  say(lines) { for (const [who, text] of lines) this.subs.push({ who, text, t: Math.max(2.4, text.length * 0.055) }); }
  /** The actor voicing a subtitle line (drives lip movement and expressions). */
  _speaker(who) {
    const g = this.game;
    if (who === 'Remy') return g.player;
    for (const a of this.allActors()) if (a.name && a.name.split(' ')[0] === who) return a;
    if (who === 'Fare') { const v = g.player.vehicle; for (const a of this.actors) if (!a.removed && (!v || a.vehicle === v)) return a; }
    return null;
  }

  start(def) {
    const g = this.game;
    if (this.active) return;
    this.def = def;
    const M = def.cls;
    this.active = new M(this, def);
    g.hud.big(def.title.toUpperCase(), def.contact ? (CONTACT_LOOKS[def.contact].name) : def.subtitle || '', '#ffc857', 3.5);
    g.audio?.jingle('start');
    this.active.begin();
  }
  startStory(def) {
    const g = this.game, c = this.contactActor(def.contact);
    // short cutscene: camera frames Remy and the contact while the lines play
    const P = g.player;
    P.yaw = Math.atan2(c.pos.x - P.pos.x, c.pos.z - P.pos.z); c.yaw = Math.atan2(P.pos.x - c.pos.x, P.pos.z - c.pos.z);
    const mid = P.pos.clone().add(c.pos).multiplyScalar(0.5);
    const side = new THREE.Vector3(c.pos.z - P.pos.z, 0, -(c.pos.x - P.pos.x)).normalize();
    const from = mid.clone().addScaledVector(side, 4.2).setY(mid.y + 1.9), to = mid.clone().addScaledVector(side, 3.2).setY(mid.y + 1.6);
    const dur = def.lines.reduce((s, l) => s + Math.max(2.4, l[1].length * 0.055), 0);
    this.cutscene = { t: 0, dur, def };
    g.camera.cinematic = { from, to, look: mid.clone().setY(mid.y + 1.45), dur, hold: 0.1, t: 0 };
    P.controlEnabled = false;
    this.subs = []; this.say(def.lines);
  }
  _endCutscene() {
    const g = this.game, def = this.cutscene.def;
    this.cutscene = null; g.camera.cinematic = null; g.player.controlEnabled = true; this.subs = [];
    g.hud.subtitle(null);
    this.start(def);
  }
  pass() {
    const g = this.game, a = this.active, def = this.def;
    const reward = a.reward ? a.reward() : def.reward || 0;
    if (reward) g.player.addCash(reward);
    if (def.cls && STORY.includes(def)) this.done.add(def.id);
    if (def.race) this.done.add('race:' + def.start.id);
    g.hud.big(def.id === 'hightide' ? 'SOL HARBOR IS YOURS' : 'JOB DONE', reward ? `+$${reward.toLocaleString('en-US')}` : '', '#3ddc84', def.id === 'hightide' ? 7 : 4);
    g.audio?.jingle('pass');
    if (def.id === 'hightide') setTimeout(() => g.hud.note('Story complete. Thanks for playing Sol Harbor. The island is still yours to explore.', 9), 3000);
    this._end();
    g.saveGame(false);
  }
  fail(reason) {
    const g = this.game;
    g.hud.big('JOB FAILED', reason, '#ff5e62', 4);
    g.audio?.jingle('fail');
    this._end();
  }
  _end() { const a = this.active; this.active = null; this.def = null; if (a) a.cleanup(); this.timerOn = false; this.timeLeft = 0; this.game.gpsTarget = null; this.game.hud.objective(null); this.game.hud.timer(null); }

  update(dt) {
    const g = this.game, P = g.player, hud = g.hud;
    this.prompt = null;
    // subtitles
    if (this.subs.length) { const s = this.subs[0]; s.t -= dt; hud.subtitle(s.who, s.text); if (s.t <= 0) this.subs.shift(); } else hud.subtitle(null);
    const talker = this.subs.length ? this._speaker(this.subs[0].who) : null;
    if (this._talker && this._talker !== talker) this._talker.talking = false;
    if (talker) talker.talking = true;
    this._talker = talker;
    if (this.cutscene) {
      const c = this.cutscene; c.t += dt;
      const ca = this.contacts[c.def.contact]; if (ca) ca.updateAnim(dt, { mode: 'normal' });
      P.updateAnim(dt);
      if (c.t > c.dur || (c.t > 0.5 && (g.input.pressed('interact') || g.input.pressed('jump') || g.input.pressed('enter') || g.input.pressed('fire')))) this._endCutscene();
      return;
    }
    // contact idles
    for (const [id, a] of Object.entries(this.contacts)) {
      if (!a || a.removed) continue;
      const d = a.pos.distanceTo(P.pos);
      if (d > 120) { a.removed = true; delete this.contacts[id]; continue; }
      if (!a.alive) continue;
      a.rig.visible = d < 120; a.yaw = dampAngle(a.yaw, d < 8 ? Math.atan2(P.pos.x - a.pos.x, P.pos.z - a.pos.z) : a.yaw, 3, dt);
      a.updateAnim(dt, { mode: d < 6 ? 'normal' : 'phone' }); a.physics(dt, 0, 0);
    }
    for (const a of this.actors) if (!a.removed && a.state !== 'toDoor') { if (a.updateState(dt)) a.updateAnim(dt); else if (!a.inVehicle) { a.physics(dt, 0, 0); } }
    if (this.active) {
      if (this.timerOn) { this.timeLeft = Math.max(0, this.timeLeft - dt); hud.timer(this.timeLeft); } else hud.timer(null);
      const r = this.active.update(dt);
      if (this.active) this.active.t += dt;
      if (r === 'pass') this.pass();
      else if (typeof r === 'string' && r.startsWith('fail:')) this.fail(r.slice(5));
      return;
    }
    // ---- free roam: start markers
    if (!P.alive) return;
    let prompt = null;
    const heat = g.heat.level;
    for (const d of this.available()) {
      const poi = g.city.poi.contacts[d.contact]; if (!poi) continue;
      const dist = Math.hypot(poi.x - P.pos.x, poi.z - P.pos.z);
      if (dist < 90) this.contactActor(d.contact);
      this.marker({ x: poi.x, y: (poi.y ?? 0.15), z: poi.z }, 1.6, GOLD);
      if (!P.inVehicle && dist < 2.6) {
        if (heat > 0) prompt = 'Lose the heat before starting a job.';
        else { prompt = `<kbd>E</kbd> Talk to ${CONTACT_LOOKS[d.contact].name} · <b>${d.title}</b>`; if (g.input.pressed('interact')) { this.startStory(d); return; } }
      }
    }
    // races
    for (const s of g.city.poi.raceStarts || []) {
      const dist = Math.hypot(s.x - P.pos.x, s.z - P.pos.z);
      if (dist < 250) this.marker({ x: s.x, y: 0.02, z: s.z }, 3.2, PINK);
      if (dist < 5) {
        if (!P.inVehicle) prompt = `${s.name}: bring a car to race.`;
        else if (heat > 0) prompt = 'Lose the heat before racing.';
        else { const b = this.best[s.id]; prompt = `<kbd>E</kbd> Start ${s.name}${b ? ` · best ${Math.floor(b / 60)}:${(b % 60).toFixed(1).padStart(4, '0')}` : ''}`; if (g.input.pressed('interact')) { this.start({ id: 'race-' + s.id, title: s.name, subtitle: 'Street race · first place pays $2,000', cls: Race, start: s, race: true }); return; } }
      }
    }
    // courier depot
    const cd = g.city.poi.courierDepot;
    if (cd) {
      const dist = Math.hypot(cd.x - P.pos.x, cd.z - P.pos.z);
      if (dist < 250) this.marker(cd, 2.4, TEAL);
      if (dist < 4) { prompt = '<kbd>E</kbd> Start a courier run'; if (g.input.pressed('interact')) { this.start({ id: 'courier', title: 'Courier Run', subtitle: 'Four packages, tight windows', cls: CourierJob, reward: 500 }); return; } }
    }
    // taxi duty
    if (P.inVehicle && P.vehicle && P.vehicle.type === 'taxi' && P.seatSide === 1) {
      if (!prompt) prompt = '<kbd>T</kbd> Start taxi duty';
      if (g.input.pressed('mission')) { if (heat > 0) g.hud.note('Lose the heat first.'); else { this.start({ id: 'taxi', title: 'Taxi Duty', subtitle: 'Fares all over the island', cls: TaxiJob }); return; } }
    }
    this.prompt = prompt;
  }
  blips() {
    const out = [], P = this.game.city.poi;
    if (!this.active) {
      for (const d of this.available()) { const c = P.contacts[d.contact]; if (c) out.push({ x: c.x, z: c.z, color: '#ffc857', label: d.contact[0].toUpperCase(), r: 6, kind: 'story', name: `${CONTACT_LOOKS[d.contact].name}: ${d.title}` }); }
      for (const s of P.raceStarts || []) out.push({ x: s.x, z: s.z, color: '#ff4fd8', label: 'R', r: 5, kind: 'race', name: s.name });
      if (P.courierDepot) out.push({ x: P.courierDepot.x, z: P.courierDepot.z, color: '#3dd6c6', label: 'C', r: 5, kind: 'job', name: 'Courier depot' });
    }
    return out;
  }
  save() { return { done: [...this.done], best: this.best }; }
  load(s) { this.done = new Set(s.done || []); this.best = s.best || {}; }
}
