// Phone emulation test: landscape phone with real (CDP) multi-touch events driving the touch controls.
//   node tools/phonetest.mjs [--shots=dir] [--w=844 --h=390]
// The render loop is stopped and the game is stepped with __game.simulate(), so results are deterministic.
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
const opt = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const W = +(opt.w || 844), H = +(opt.h || 390), SHOTS = opt.shots || 'shots/phone';
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
const page = await ctx.newPage();
let errors = 0, fails = 0;
page.on('pageerror', e => { errors++; console.log('[pageerror] ' + (e.stack || e.message)); });
page.on('console', m => { if (m.type() === 'error') { errors++; console.log('[console.error] ' + m.text().slice(0, 400)); } });
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? '  ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`); };
const cdp = await ctx.newCDPSession(page);
const touches = new Map();
const pts = () => [...touches].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 6, radiusY: 6, force: 1 }));
const tdown = async (id, x, y) => { touches.set(id, { x, y }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts() }); };
const tmove = async (id, x, y, steps = 5) => {
  const p0 = { ...touches.get(id) };
  for (let i = 1; i <= steps; i++) { touches.set(id, { x: p0.x + (x - p0.x) * i / steps, y: p0.y + (y - p0.y) * i / steps }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts() }); }
};
const tup = async (id) => { touches.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: pts() }); };
const center = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; }, sel);
const tap = async (sel, id = 9) => { const c = await center(sel); if (!c) throw new Error('no element ' + sel); await tdown(id, c.x, c.y); await tup(id); return c; };
const sim = (s) => page.evaluate((s) => __game.simulate(s), s);
const shot = async (name) => { await page.evaluate(() => { __game.env.render(0.016); }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), scale: 'css' }); };
const ev = (fn, arg) => page.evaluate(fn, arg);

await page.goto('file://' + path.resolve('dist/solharbor.html'));
await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 300000, polling: 500 });
const info = await ev(() => ({ coarse: matchMedia('(pointer: coarse)').matches, touch: __game.touch.active, quality: __game.quality, uiTouch: document.querySelector('#sh-ui').classList.contains('touch'), fs: !!document.fullscreenEnabled }));
check('touch controls on by default for a phone', info.touch && info.uiTouch, info);
check('phone gets the fast graphics preset', info.quality === 'low', info.quality);
await ev(() => { __game.renderer.setAnimationLoop(null); });
await page.waitForTimeout(700);
await shot('01-title');
const titleFit = await ev(() => { const s = document.querySelector('#sh-title'); return { sh: s.scrollHeight, ch: s.clientHeight }; });
check('title screen fits without scrolling', titleFit.sh <= titleFit.ch + 2, titleFit);
await tap('#sh-play');
await sim(0.6);
check('game started from a tap', await ev(() => __game.started && !__game.paused));
check('touch layer visible in play', await ev(() => !document.querySelector('#sh-touch').classList.contains('off')));
await shot('02-foot');

// ---- move stick: hold forward 1 s, then release
const P0 = await ev(() => ({ x: __game.player.pos.x, z: __game.player.pos.z, yaw: __game.camera.yaw }));
const home = await ev(() => __game.touch._stickHome());
await tdown(1, home.x, home.y); await tmove(1, home.x, home.y - 70);
await sim(1.0);
const P1 = await ev(() => ({ x: __game.player.pos.x, z: __game.player.pos.z, spd: __game.player.speedNow }));
await tup(1); await sim(0.4);
const P2 = await ev(() => ({ x: __game.player.pos.x, z: __game.player.pos.z }));
const fwd = (P1.x - P0.x) * Math.sin(P0.yaw) + (P1.z - P0.z) * Math.cos(P0.yaw);
check('stick forward walks the camera-forward way', fwd > 3.2 && fwd < 5, { forward_m: +fwd.toFixed(2), speed: +P1.spd.toFixed(2) });
const over = Math.hypot(P2.x - P1.x, P2.z - P1.z);
check('stops on release (no slide)', over < 0.12, { after_release_m: +over.toFixed(3) });
// partial push walks slower
await tdown(1, home.x, home.y); await tmove(1, home.x, home.y - 22); await sim(0.8);
const slow = await ev(() => __game.player.speedNow); await tup(1); await sim(0.3);
check('half push walks slowly (analog)', slow > 0.6 && slow < 3.2, { speed: +slow.toFixed(2) });
// push past the ring to sprint
await tdown(1, home.x, home.y); await tmove(1, home.x, home.y - 90, 8); await sim(1.2);
const spr = await ev(() => ({ s: __game.player.speedNow, cls: document.querySelector('#sh-stick').className }));
await tup(1); await sim(0.3);
check('push past the ring sprints', spr.s > 6, { speed: +spr.s.toFixed(2), stick: spr.cls });

// ---- look: drag on the right side
const y0 = await ev(() => __game.camera.yaw);
await tdown(2, W * 0.7, H * 0.45); await tmove(2, W * 0.7 + 100, H * 0.45); await sim(0.05);
const y1 = await ev(() => __game.camera.yaw);
await tup(2);
check('right-side drag turns the camera', Math.abs(y1 - y0) > 0.3 && y1 < y0, { dyaw: +(y1 - y0).toFixed(3) });
// two thumbs at once: move + look
await tdown(1, home.x, home.y); await tdown(2, W * 0.7, H * 0.4);
await tmove(1, home.x + 60, home.y); await tmove(2, W * 0.7 - 60, H * 0.4);
await sim(0.5);
const both = await ev(() => ({ spd: __game.player.speedNow, yaw: __game.camera.yaw }));
await tup(1); await tup(2); await sim(0.3);
check('move and look together (multi-touch)', both.spd > 2 && both.yaw > y1 + 0.2, both);

// ---- weapons
const c0 = await ev(() => ({ clip: __game.player.clip.pistol, w: __game.player.weapon }));
if (c0.w !== 'pistol') { await tap('#tb-wpn'); await sim(0.4); }
const c1 = await ev(() => __game.player.clip.pistol);
const fire = await center('#tb-fire');
await tdown(3, fire.x, fire.y); await sim(0.15); await tup(3); await sim(0.3);
const c2 = await ev(() => __game.player.clip.pistol);
check('FIRE shoots', c2 === c1 - 1, { before: c1, after: c2 });
await tap('#tb-aim'); await sim(0.2);
const aimOn = await ev(() => __game.player.aiming);
await shot('03-aim');
await tap('#tb-aim'); await sim(0.2);
const aimOff = await ev(() => __game.player.aiming);
check('AIM toggles aiming', aimOn === true && aimOff === false, { aimOn, aimOff });
// aim assist: a hostile just off the crosshair pulls the camera toward it
const assist = await ev(() => {
  const g = __game, P = g.player, c = g.camera;
  const yaw = c.yaw, d = 14;
  const x = P.pos.x + Math.sin(yaw + 0.2) * d, z = P.pos.z + Math.cos(yaw + 0.2) * d;
  const h = g.hostiles.spawn(x, P.pos.y, z, { group: 'phonetest', weapon: 'pistol' });
  h.state = 'guard'; h.a.controlEnabled = false;
  window.__h = h;
  return { yaw };
});
await tap('#tb-aim'); await sim(0.5);
const assisted = await ev(() => { const g = __game, P = g.player, h = window.__h.a; const want = Math.atan2(h.pos.x - P.pos.x, h.pos.z - P.pos.z); return { yaw: g.camera.yaw, want, aiming: P.aiming }; });
await tap('#tb-aim'); await sim(0.1);
await ev(() => { __game.hostiles.clear('phonetest'); __game.heat.clearAll(); });
check('aim assist eases onto a nearby threat', Math.abs(assisted.yaw - assist.yaw) > 0.1, { from: +assist.yaw.toFixed(2), to: +assisted.yaw.toFixed(2), target: +assisted.want.toFixed(2) });
await tap('#tb-jump'); await sim(0.08);
const jv = await ev(() => __game.player.vel.y);
await sim(1.2);
check('JUMP jumps', jv > 1, { vy: +jv.toFixed(2) });

// ---- driving
await ev(() => {
  const g = __game, P = g.player, v = g.starterCar;
  const d = P.doorWorld(v, 1, P.pos.clone());
  const out = { x: d.x - v.com.x, z: d.z - v.com.z }, l = Math.hypot(out.x, out.z) || 1;
  P.place(d.x + out.x / l * 1.2, v.com.y, d.z + out.z / l * 1.2, P.yaw); g.focus.copy(P.pos);
});
await sim(0.4);
const carBtn = await ev(() => !document.querySelector('#tb-car').classList.contains('gone'));
check('ENTER appears next to a car', carBtn);
await tap('#tb-car'); await sim(4);
const inCar = await ev(() => ({ inV: __game.player.inVehicle, car: !document.querySelector('#tc-car').classList.contains('gone') }));
check('ENTER gets in and shows driving controls', inCar.inV && inCar.car, inCar);
const gas = await center('#tb-gas');
const v0 = await ev(() => ({ yaw: __game.player.vehicle.yaw }));
await tdown(3, gas.x, gas.y); await sim(2.5);
const v1 = await ev(() => ({ speed: __game.player.vehicle.speed, yaw: __game.player.vehicle.yaw }));
check('GAS accelerates', v1.speed > 6, { mph: Math.round(v1.speed * 2.237) });
await tdown(1, home.x, home.y); await tmove(1, home.x - 60, home.y); await sim(1.0);
const v2 = await ev(() => ({ speed: __game.player.vehicle.speed, yaw: __game.player.vehicle.yaw, steer: __game.player.vehicle.controls.steer }));
check('stick steers', Math.abs(v2.yaw - v1.yaw) > 0.15 && v2.steer > 0.5, { dyaw: +(v2.yaw - v1.yaw).toFixed(2), steer: +v2.steer.toFixed(2) });
await shot('04-drive');
await tup(1); await tup(3);
const brk = await center('#tb-brk');
await tdown(3, brk.x, brk.y); await sim(2.0); await tup(3);
const v3 = await ev(() => __game.player.vehicle.speed);
check('BRAKE slows down', v3 < v2.speed * 0.5, { mph: Math.round(v3 * 2.237) });
await tap('#tb-exit'); await sim(3);
check('EXIT gets out', await ev(() => !__game.player.inVehicle));

// ---- map: tap minimap, pinch zoom, tap waypoint, close
await sim(0.2);
await tap('#sh-mini'); await sim(0.1);
check('tapping the minimap opens the map', await ev(() => __game.mapOpen));
const z0 = await ev(() => __game.hud.mv.z);
await tdown(1, W * 0.4, H * 0.5); await tdown(2, W * 0.55, H * 0.5); await tmove(2, W * 0.75, H * 0.5); await tup(2); await tup(1);
const z1 = await ev(() => __game.hud.mv.z);
check('pinch zooms the map', z1 > z0 * 1.5, { z0: +z0.toFixed(2), z1: +z1.toFixed(2) });
await tdown(1, W * 0.5, H * 0.5); await tup(1);
await sim(0.1);
check('tap sets a waypoint', await ev(() => !!__game.waypoint));
await shot('05-map');
await tap('#sh-mapclose'); await sim(0.1);
check('CLOSE MAP closes it', await ev(() => !__game.mapOpen));

// ---- pause and resume
await tap('#tb-pause'); await sim(0.1);
check('pause button pauses', await ev(() => __game.paused));
await shot('06-pause');
const pauseFit = await ev(() => { const s = document.querySelector('#sh-pause'); const r = document.querySelector('#sh-resume').getBoundingClientRect(); return { sh: s.scrollHeight, ch: s.clientHeight, ov: getComputedStyle(s).overflowY, resumeTop: Math.round(r.top), resumeBottom: Math.round(r.bottom) }; });
check('pause menu reachable (fits or scrolls)', pauseFit.sh <= pauseFit.ch + 2 || pauseFit.ov === 'auto', pauseFit);
await tap('#sh-resume'); await sim(0.1);
check('RESUME resumes', await ev(() => !__game.paused));

// ---- tappable prompt: talk to the first available contact, then skip the scene
const contact = await ev(() => { __game.heat.clearAll(); const g = __game, d = g.missions.available()[0]; if (!d) return null; const c = g.city.poi.contacts[d.contact]; g.player.place(c.x + 1.2, c.y ?? 0.15, c.z, 0); g.focus.copy(g.player.pos); return d.contact; });
if (contact) {
  await sim(0.5);
  const pr = await ev(() => ({ html: document.querySelector('#sh-prompt').innerHTML, tap: document.querySelector('#sh-prompt').classList.contains('tap') }));
  check('prompt becomes a TAP button', pr.tap && pr.html.includes('TAP'), pr.html.replace(/<[^>]+>/g, '').slice(0, 60));
  await tap('#sh-prompt'); await sim(0.3);
  const cs = await ev(() => ({ cut: !!__game.missions.cutscene, def: __game.missions.def && __game.missions.def.id, skip: !document.querySelector('#tc-cut').classList.contains('gone') }));
  check('tapping the prompt starts the job', !!cs.def || cs.cut, cs);
  if (cs.cut) {
    await shot('07-cutscene');
    await sim(0.6); await tap('#tb-skip'); await sim(0.2);
    check('SKIP ends the scene', await ev(() => !__game.missions.cutscene));
  }
  await ev(() => { const M = __game.missions; if (M.active) M._end(); });
}

// ---- gun shop through the TAP prompt, buy with a tap, leave
const shopOk = await ev(() => { const g = __game, s = (g.city.poi.gunShops || [])[0]; if (!s) return false; g.heat.clearAll(); g.player.addCash(5000); g.player.place(s.x, s.y ?? 0.15, s.z, 0); g.focus.copy(g.player.pos); return true; });
if (shopOk) {
  await sim(0.4);
  await tap('#sh-prompt'); await sim(0.2);
  const so = await ev(() => ({ open: !!__game.activities.shopOpen, touchHidden: document.querySelector('#sh-touch').classList.contains('off'), cash: __game.player.cash }));
  check('shop opens from the prompt and hides the controls', so.open && so.touchHidden, so);
  await shot('10-shop');
  await tap('#sh-shop button.item'); await sim(0.1);
  const cash2 = await ev(() => __game.player.cash);
  check('tap an item to buy', cash2 < so.cash, { before: so.cash, after: cash2 });
  await tap('#sh-shopclose'); await sim(0.2);
  check('Leave closes the shop', await ev(() => !__game.activities.shopOpen && !document.querySelector('#sh-touch').classList.contains('off')));
}
// ---- taxi duty: start from the prompt, end with END SHIFT
await ev(() => { const g = __game, P = g.player; const v = g.vehicles.spawn('taxi', P.pos.x + 3, P.pos.y, P.pos.z, 0, {}); v.keep = true; P.inVehicle = true; P.vehicle = v; P.seatSide = 1; v.driver = P; v.wake(); });
await sim(0.5);
await tap('#sh-prompt'); await sim(0.3);
const taxi = await ev(() => ({ def: __game.missions.def && __game.missions.def.id, end: !document.querySelector('#tb-taxi').classList.contains('gone') }));
check('taxi duty starts from the prompt; END SHIFT shows', taxi.def === 'taxi' && taxi.end, taxi);
await tap('#tb-taxi'); await sim(0.3);
check('END SHIFT ends taxi duty', await ev(() => !__game.missions.def));
await ev(() => { const P = __game.player; if (P.inVehicle) P.leaveSeat(true); });
await sim(0.3);

// ---- portrait: rotate hint, then play anyway
await page.setViewportSize({ width: H, height: W });
await page.waitForTimeout(400);
await sim(0.1);
const rot = await ev(() => !document.querySelector('#sh-rotate').classList.contains('gone'));
check('portrait shows the rotate hint', rot);
await shot('08-portrait-hint');
await tap('#sh-rotate button'); await sim(0.3);
check('"play in portrait" dismisses it', await ev(() => document.querySelector('#sh-rotate').classList.contains('gone')));
await shot('09-portrait');
await page.setViewportSize({ width: W, height: H });
await page.waitForTimeout(300);
await sim(0.2);

console.log(`errors = ${errors}, failures = ${fails}`);
await browser.close();
process.exit(fails || errors ? 1 : 0);
