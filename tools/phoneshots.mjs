// Screenshots of the touch layout at several device sizes: title, on foot, driving.
//   node tools/phoneshots.mjs --sizes=667x375,1024x768,390x844
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
const opt = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const sizes = (opt.sizes || '667x375,1024x768').split(',').map(s => s.split('x').map(Number));
fs.mkdirSync('shots/phone', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[pageerror] ' + (e.stack || e.message)));
  await page.goto('file://' + path.resolve('dist/solharbor.html'));
  await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 300000, polling: 500 });
  await page.evaluate(() => { __game.renderer.setAnimationLoop(null); });
  await page.waitForTimeout(900);
  const tag = `${w}x${h}`;
  await page.screenshot({ path: `shots/phone/size-${tag}-title.png`, scale: 'css' });
  if (h > w) { await page.evaluate(() => document.querySelector('#sh-rotate button').click()); }
  await page.evaluate(() => document.querySelector('#sh-play').click());
  await page.evaluate(() => { __game.simulate(0.6); __game.env.render(0.016); });
  await page.screenshot({ path: `shots/phone/size-${tag}-foot.png`, scale: 'css' });
  await page.evaluate(() => { const g = __game, P = g.player, v = g.starterCar; P.inVehicle = true; P.vehicle = v; P.seatSide = 1; v.driver = P; v.wake(); g.simulate(0.6); g.env.render(0.016); });
  await page.screenshot({ path: `shots/phone/size-${tag}-car.png`, scale: 'css' });
  console.log('done', tag);
  await ctx.close();
}
await browser.close();
