// Free-roam activities: pickups (health, armor, weapons, cash, Sun Tokens), gun shops, paint shops,
// stunt jumps, the safehouse save point.
import * as THREE from 'three';
import { WEAPONS } from './combat.js';
import { clamp } from '../core/math.js';
import { PickupRenderer } from './markers.js';
import { buildWeaponGeometry } from '../entities/character.js';

const _v = new THREE.Vector3();
const PAINTS = [0xd35400, 0x1c3f8a, 0x2f6b3e, 0x111214, 0xf2f2f2, 0x8b1a1a, 0x117a8b, 0xd9a520, 0x5b2c6f, 0xb8bdc2, 0xc0392b, 0x2c3e50];

export class Activities {
  constructor(game) {
    this.game = game;
    const wg = {}; for (const w of ['pistol', 'smg', 'shotgun', 'rifle']) wg[w] = buildWeaponGeometry(w);
    this.render = new PickupRenderer(game.scene, wg);
    this.pickups = [];
    this.tokens = new Set(); this.stunts = new Set();
    this.jump = null; this.shopOpen = null; this.prompt = null;
    this._placeStatic();
    game.events.on('actorKilled', (e) => {
      const a = e.actor, att = e.info && e.info.attacker;
      if (a.isPlayer || !att || !att.isPlayer) return;
      const amt = a.isCop ? 40 + Math.floor(Math.random() * 60) : a.isHostile ? 60 + Math.floor(Math.random() * 120) : 5 + Math.floor(Math.random() * 35);
      this.drop('cash', a.pos.x, a.pos.y + 0.35, a.pos.z, { amount: amt, life: 30 });
      if ((a.isCop || a.isHostile) && Math.random() < 0.5) this.drop('weapon', a.pos.x + 0.6, a.pos.y + 0.4, a.pos.z, { weapon: a.weapon, amount: a.weapon === 'pistol' ? 12 : 30, life: 30 });
    });
  }
  _placeStatic() {
    const P = this.game.city.poi, col = this.game.city.collision;
    const gy = (x, z, y = 200) => col.groundHeight(x, z, y, 0) + 0.7;
    for (const h of P.hospitals || []) { const x = h.x + Math.sin(h.yaw || 0) * 3, z = h.z + Math.cos(h.yaw || 0) * 3; this.drop('health', x, gy(x, z, (h.y ?? 0) + 1), z, { respawn: 60 }); }
    for (const s of P.policeStations || []) { const x = s.x + Math.sin(s.yaw || 0) * 3, z = s.z + Math.cos(s.yaw || 0) * 3; this.drop('armor', x, gy(x, z, (s.y ?? 0) + 1), z, { respawn: 90 }); }
    // weapons stashed around the island
    const stash = [['smg', P.salvageDrop, 6, 0, 90], ['shotgun', { x: -1000, z: -150 }, 0, 0, 24], ['rifle', P.radioTower, 6, 4, 90], ['pistol', P.pierEnd, -4, 0, 36], ['smg', P.courierDepot, 5, 5, 60]];
    for (const [w, p, ox, oz, ammo] of stash) { if (!p) continue; const x = p.x + ox, z = p.z + oz; this.drop('weapon', x, gy(x, z), z, { weapon: w, amount: ammo, respawn: 240 }); }
    // health in some parks
    for (const b of this.game.city.blocks) if (b.kind === 'park' && Math.abs(b.cx * 7 + b.cz * 3) % 5 < 1.2) this.drop('health', b.cx, gy(b.cx, b.cz), b.cz, { respawn: 120 });
    for (const [i, t] of (P.collectibles || []).entries()) { const p = this.drop('token', t.x, t.y, t.z, {}); p.tokenId = i; }
  }
  drop(type, x, y, z, o = {}) {
    const p = { type, x, y, z, amount: o.amount ?? (type === 'health' || type === 'armor' ? 50 : 0), weapon: o.weapon, life: o.life ?? 0, respawn: o.respawn ?? 0, taken: false, t: 0 };
    this.pickups.push(p);
    this.render.add(p);
    return p;
  }
  applyLoad(save) {
    this.tokens = new Set(save.tokens || []); this.stunts = new Set(save.stunts || []);
    for (const p of this.pickups) if (p.type === 'token' && this.tokens.has(p.tokenId)) { p.taken = true; this.render.remove(p); }
  }

  update(dt) {
    const game = this.game, P = game.player, hud = game.hud;
    const pp = P.inVehicle && P.vehicle ? P.vehicle.com : P.pos;
    this.prompt = null;
    // ---- pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (p.taken) { if (p.respawn > 0) { p.t += dt; if (p.t > p.respawn) { p.taken = false; p.t = 0; this.render.add(p); } } continue; }
      if (p.life > 0) { p.t += dt; if (p.t > p.life) { this.render.remove(p); this.pickups.splice(i, 1); continue; } }
      const r = P.inVehicle ? 2.6 : 1.3;
      if (!P.alive || Math.abs(p.x - pp.x) > r + 1 || Math.abs(p.z - pp.z) > r + 1) continue;
      if (Math.hypot(p.x - pp.x, p.z - pp.z) > r || Math.abs(p.y - pp.y - 0.8) > 2.5) continue;
      if (!this._take(p)) continue;
      p.taken = true; this.render.remove(p);
      if (p.life > 0 || (p.respawn <= 0)) this.pickups.splice(i, 1);
      game.events.emit('pickup', { type: p.type });
    }
    this.render.update(dt, game.time, game.camera.camera.position);
    // ---- gun shops
    const Pp = game.city.poi;
    if (!P.inVehicle && P.alive && !game.missions?.cutscene) {
      for (const s of Pp.gunShops || []) {
        if (Math.hypot(s.x - P.pos.x, s.z - P.pos.z) < 2.2) { this.prompt = `<kbd>E</kbd> Browse ${s.name || 'the gun shop'}`; if (game.input.pressed('interact')) this.openShop(s); }
      }
      const sh = Pp.safehouse;
      if (sh && Math.hypot(sh.x - P.pos.x, sh.z - P.pos.z) < 2.4) { this.prompt = '<kbd>E</kbd> Rest and save the game'; if (game.input.pressed('interact')) { game.saveGame(true); game.timeOfDay = (game.timeOfDay + 6) % 24; P.heal(P.maxHealth); hud.note('Rested six hours. <b>Game saved.</b>'); } }
    }
    // ---- paint shops (resprays)
    if (P.inVehicle && P.vehicle && P.alive) {
      const v = P.vehicle;
      for (const r of Pp.resprays || []) {
        const d = r.door; if (!d) continue;
        if (Math.hypot(d.x - v.com.x, d.z - v.com.z) < d.r) {
          if (v.speed > 3) { this.prompt = 'Slow down to use the paint shop'; continue; }
          if (this._sprayCooldown > 0) continue;
          if (P.cash < 100) { this.prompt = 'Fresh Coat: a respray costs $100'; continue; }
          this._sprayCooldown = 8;
          P.addCash(-100);
          const c = PAINTS[(Math.random() * PAINTS.length) | 0];
          if (v.type !== 'police' && v.type !== 'taxi' && v.type !== 'bus') v.model.setPaint(c);
          v.health = v.maxHealth; v.burning = 0; v.model.setDamage(0);
          const had = game.heat.level > 0;
          if (had && !game.heat.seen) game.heat.clear(false);
          game.fx.particles.smoke(v.com, 2, false);
          hud.note(`Fresh Coat Auto Paint · <b>-$100</b>${had ? (game.heat.level === 0 ? ' · the police lost your description' : ' · they saw you drive in, still hot') : ''}`, 5);
          game.events.emit('respray', { vehicle: v });
        }
      }
    }
    this._sprayCooldown = Math.max(0, (this._sprayCooldown || 0) - dt);
    // ---- stunt jumps
    this._stunts(dt);
  }
  _take(p) {
    const P = this.game.player, hud = this.game.hud;
    switch (p.type) {
      case 'health': if (P.health >= P.maxHealth) return false; P.heal(p.amount * 2); hud.note('+ Health'); return true;
      case 'armor': if (P.armor >= P.maxArmor) return false; P.addArmor(p.amount); hud.note('+ Armor'); return true;
      case 'cash': P.addCash(p.amount); return true;
      case 'weapon': { const fresh = !P.owned.has(p.weapon); P.giveWeapon(p.weapon, p.amount); if (fresh) P.selectWeapon(p.weapon); hud.note(`${WEAPONS[p.weapon].name} ${fresh ? 'picked up' : `+${p.amount} rounds`}`); return true; }
      case 'token': {
        this.tokens.add(p.tokenId); P.addCash(250);
        const n = this.tokens.size;
        hud.note(`Sun Token <b>${n}/30</b> · +$250`);
        if (n === 30) { P.addCash(10000); hud.big('ALL SUN TOKENS', 'the island is yours · +$10,000', '#ffc857', 5); this.game.audio?.jingle('pass'); }
        this.game.saveGame(false);
        return true;
      }
    }
    return false;
  }
  // ---- stunts
  _stunts(dt) {
    const game = this.game, P = game.player, v = P.inVehicle ? P.vehicle : null;
    if (!v) { this.jump = null; return; }
    if (!this.jump) {
      for (const r of game.city.ramps) {
        const dx = v.com.x - r.x, dz = v.com.z - r.z; if (dx * dx + dz * dz > 400) continue;
        const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw);
        const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        const vAlong = v.vel.x * fx + v.vel.z * fz;
        if (lat < r.width / 2 + 0.5 && along > r.length * 0.2 && along < r.length / 2 + 1.5 && vAlong > 14) { this.jump = { ramp: r, t: 0, air: false, maxH: 0, y0: v.com.y }; break; }
      }
    } else {
      const j = this.jump; j.t += dt;
      if (!v.onGround) { if (!j.air) { j.air = true; game.env.effects.slowMo(1.2); } j.maxH = Math.max(j.maxH, v.com.y - j.y0); }
      if (j.air && v.onGround && j.t > 0.4) {
        const L = j.ramp.landing, ok = Math.hypot(v.com.x - L.x, v.com.z - L.z) < L.r;
        const first = !this.stunts.has(j.ramp.id);
        if (ok) {
          this.stunts.add(j.ramp.id);
          const pay = first ? 500 : 100; P.addCash(pay);
          game.hud.big('STUNT JUMP', `${j.ramp.name} · ${this.stunts.size}/${game.city.ramps.length} · +$${pay}`, '#3dd6c6', 3.5);
          game.audio?.jingle('pass'); game.saveGame(false);
        } else if (j.t > 0.6) game.hud.note(`${j.ramp.name}: missed the landing`);
        this.jump = null;
      }
      if (j && j.t > 6) this.jump = null;
    }
  }
  // ---- shop
  openShop(s) {
    const game = this.game;
    this.shopOpen = s; game.menuOpen = true; game.input.unlock();
    game.hud.shop(s.name || 'Gun Shop', this._shopItems(), (id) => this._buy(id), () => this.closeShop());
  }
  closeShop() { this.shopOpen = null; this.game.menuOpen = false; this.game.hud.shop(null); this.game.input.lock(); }
  _shopItems() {
    const P = this.game.player, items = [];
    for (const w of ['pistol', 'smg', 'shotgun', 'rifle']) {
      const W = WEAPONS[w];
      if (!P.owned.has(w)) items.push({ id: 'buy:' + w, label: W.name, sub: `${W.melee ? '' : W.clip + '-round mag'}`, price: W.price });
      else items.push({ id: 'ammo:' + w, label: `${W.name} ammo`, sub: `+${W.ammoPack} rounds · you have ${(P.ammo[w] || 0) + (P.clip[w] || 0)}`, price: W.ammoPrice });
    }
    items.push({ id: 'armor', label: 'Body armor', sub: P.armor >= P.maxArmor ? 'already full' : 'full vest', price: 300 });
    return items;
  }
  _buy(id) {
    const P = this.game.player, hud = this.game.hud;
    const item = this._shopItems().find(i => i.id === id); if (!item) return;
    if (P.cash < item.price) { hud.shopMsg('Not enough cash.'); this.game.audio?.jingle('fail'); return; }
    if (id === 'armor') { if (P.armor >= P.maxArmor) { hud.shopMsg('Your vest is already full.'); return; } P.addArmor(100); }
    else { const [k, w] = id.split(':'); if (k === 'buy') { P.giveWeapon(w, WEAPONS[w].ammoPack); P.selectWeapon(w); } else P.giveWeapon(w, WEAPONS[w].ammoPack); }
    P.addCash(-item.price);
    hud.shopMsg(`Bought ${item.label}.`);
    hud.shop(this.shopOpen.name || 'Gun Shop', this._shopItems(), (i) => this._buy(i), () => this.closeShop());
  }
}
