// Headless walkthrough of every story mission and side job (logic only, no rendering).
import { chromium } from 'playwright';
import path from 'path';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
let errors = 0;
page.on('pageerror', e => { errors++; console.log('[pageerror] ' + (e.stack || e.message)); });
page.on('console', m => { if (m.type() === 'error') { errors++; console.log('[error] ' + m.text().slice(0, 500)); } else if (m.text().startsWith('M ')) console.log(m.text()); });
await page.addInitScript(() => { try { localStorage.setItem('solharbor.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
await page.goto('file://' + path.resolve('dist/solharbor.html'));
await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 120000, polling: 500 });
await page.evaluate(() => { __game.renderer.setAnimationLoop(null); });
await page.click('#sh-play');
await page.evaluate(() => { __game.hud.drawMinimap = () => {}; });
const run = (fn) => page.evaluate(fn).catch(e => { errors++; console.log('[eval-error] ' + e.message); });
await run(() => {
  const g = __game, P = g.player, M = g.missions;
  window.log = (...a) => console.log('M ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
  window.st = () => ({ def: M.def && M.def.id, step: M.active && M.active.step, obj: document.querySelector('#sh-obj').textContent.slice(0, 80), heat: g.heat.level, cash: P.cash });
  window.tp = (x, y, z) => { if (P.inVehicle) { const v = P.vehicle; v.place(x, y, z, v.yaw); v.wake(); } else P.place(x, y, z, P.yaw); g.focus.set(x, y, z); };
  window.seat = (v) => { if (P.inVehicle) P.leaveSeat(true); P.inVehicle = true; P.vehicle = v; P.seatSide = 1; v.driver = P; v.wake(); };
  window.car = (type = 'sports') => { const v = g.vehicles.spawn(type, P.pos.x + 3, P.pos.y, P.pos.z, 0, {}); v.keep = true; return v; };
  window.def = (id) => M.story.find(d => d.id === id);
  window.done = () => { const r = { done: [...M.done], active: M.def && M.def.id }; return r; };
});
// 1 homecoming
await run(() => { const g = __game, M = g.missions, Pp = g.city.poi; M.start(def('homecoming')); g.simulate(0.5); log('home start', st()); tp(Pp.pierEnd.x, Pp.pierEnd.y, Pp.pierEnd.z); g.simulate(0.5); log('home pier', st()); tp(Pp.salvageDrop.x, Pp.salvageDrop.y, Pp.salvageDrop.z); g.simulate(0.5); log('home end', st(), done()); });
// 2 salvage
await run(() => { const g = __game, M = g.missions, Pp = g.city.poi; M.start(def('salvage')); g.simulate(0.5); const a = M.active; log('salv start', st(), a.target.com.toArray().map(Math.round)); seat(a.target); g.simulate(0.5); log('salv stolen', st()); g.heat.clearAll(); g.simulate(0.5); log('salv noheat', st()); tp(Pp.salvageDrop.x, Pp.salvageDrop.y, Pp.salvageDrop.z); a.target.vel.set(0, 0, 0); g.simulate(1); log('salv end', st(), done()); });
// 3 cargo
await run(() => { const g = __game, M = g.missions; const P = g.player; if (P.inVehicle) P.leaveSeat(true); const o = g.city.poi.contacts.otis; tp(o.x, o.y ?? 0, o.z); M.start(def('cargo')); g.simulate(0.3); const a = M.active; const p0 = a.truck.com.clone(); tp(p0.x + 30, p0.y, p0.z + 30); g.simulate(8); log('cargo moving', st(), Math.round(a.truck.com.distanceTo(p0)), 'm, escort', Math.round(a.escort.com.distanceTo(p0))); a.truck.explode(); g.simulate(1); log('cargo end', st(), done()); });
// 4 nightshift
await run(() => { const g = __game, M = g.missions; g.heat.clearAll(); M.start(def('nightshift')); g.simulate(0.3); const a = M.active; tp(a.yard.x + 40, a.yard.y, a.yard.z + 40); g.simulate(1); log('night near', st(), 'hostiles', g.hostiles.alive(a.hostileGroup)); for (const h of g.hostiles.list) h.a.takeDamage(999, { attacker: g.player }); g.simulate(1); log('night cleared', st()); tp(a.yard.x, a.yard.y, a.yard.z); g.simulate(0.5); log('night ledger', st()); g.heat.clearAll(); g.simulate(0.5); log('night end', st(), done()); });
// 5 velvet
await run(() => { const g = __game, M = g.missions, P = g.player; g.heat.clearAll(); M.start(def('velvet')); g.simulate(0.3); const a = M.active; const m = a.mari; tp(m.pos.x + 6, m.pos.y, m.pos.z + 2); const v = car('sedan'); v.place(m.pos.x + 6, m.pos.y - 0.15, m.pos.z + 2, 0); seat(v); g.simulate(6); log('velvet pickup', st(), 'mari', m.state, m.inVehicle); a.stop1 && tp(a.stop1.x, a.stop1.y, a.stop1.z); v.vel.set(0, 0, 0); g.simulate(1); log('velvet stop1', st()); tp(a.stop2.x, a.stop2.y, a.stop2.z); v.vel.set(0, 0, 0); g.simulate(1); log('velvet stop2', st()); if (a.rival) { a.rival.explode(); } g.simulate(1); log('velvet lost', st()); tp(a.club.x, a.club.y, a.club.z); v.vel.set(0, 0, 0); g.simulate(3); log('velvet end', st(), done()); });
// 6 hightide
await run(() => { const g = __game, M = g.missions, P = g.player; g.heat.clearAll(); if (P.inVehicle) P.leaveSeat(true); const ie = g.city.poi.contacts.inez; tp(ie.x, ie.y ?? 0.15, ie.z); M.start(def('hightide')); g.simulate(0.3); const a = M.active; const t = a.truck; tp(t.com.x + 25, t.com.y, t.com.z + 25); g.simulate(3); log('tide chase', st(), Math.round(t.speed)); t.damage(3000, t.com, 'bullet', P); g.simulate(1); log('tide stopped', st(), 'hostiles', g.hostiles.alive(a.hostileGroup)); g.simulate(3); for (const h of g.hostiles.list) h.a.takeDamage(999, { attacker: P }); g.simulate(1); log('tide guards', st()); tp(a.caseP.x, a.caseP.y, a.caseP.z); g.simulate(0.5); log('tide case', st()); g.heat.clearAll(); g.simulate(0.5); const L = g.city.poi.lookout; tp(L.x, L.y, L.z); g.simulate(1); log('tide end', st(), done()); });
// side jobs: courier + taxi (started through the real key presses)
await run(() => { const g = __game, P = g.player; g.heat.clearAll(); const cd = g.city.poi.courierDepot; if (P.inVehicle) P.leaveSeat(true); P.place(cd.x, cd.y, cd.z, 0); g.focus.set(cd.x, cd.y, cd.z); const v = car('van'); v.place(cd.x + 2, cd.y, cd.z, 0); seat(v); g.simulate(0.5); log('depot prompt', __game.missions.prompt); });
await page.keyboard.down('KeyE'); await run(() => __game.simulate(0.1)); await page.keyboard.up('KeyE');
await run(() => { const g = __game, M = g.missions; g.simulate(0.5); log('courier', st()); const a = M.active; for (let i = 0; i < 4 && M.active; i++) { const d = M.active.dest; tp(d.x, d.y, d.z); g.player.vehicle.vel.set(0, 0, 0); g.simulate(0.4); log('courier drop', i, st()); } log('courier end', st()); });
await run(() => { const g = __game, P = g.player; const v = car('taxi'); seat(v); g.simulate(0.5); log('taxi prompt', g.missions.prompt); });
await page.keyboard.down('KeyT'); await run(() => __game.simulate(0.1)); await page.keyboard.up('KeyT');
await run(() => { const g = __game, M = g.missions, P = g.player; g.simulate(0.5); const a = M.active; log('taxi', st()); if (!a) return; const f = a.fare; tp(f.pos.x + 5, f.pos.y, f.pos.z + 5); P.vehicle.vel.set(0, 0, 0); g.simulate(8); log('taxi pickup', st(), f.state, f.inVehicle); if (a.dest) { tp(a.dest.x, a.dest.y, a.dest.z); P.vehicle.vel.set(0, 0, 0); g.simulate(3); log('taxi drop', st(), 'fares', a.fares); } });
console.log('errors =', errors);
await browser.close();
