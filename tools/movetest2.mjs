// Deterministic input test: hold ArrowUp for N simulated seconds (60 Hz steps), release, and measure
// how long and how far the player keeps moving. Also checks the per-frame lag between input and motion.
import { chromium } from 'playwright';
import path from 'path';
const opt = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const HOLD = +(opt.hold || 10);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on('pageerror', e => console.log('[pageerror] ' + (e.stack || e.message)));
await page.addInitScript(() => { try { localStorage.setItem('solharbor.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
await page.goto('file://' + path.resolve('dist/solharbor.html'));
await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 240000, polling: 500 });
await page.evaluate(() => { __game.renderer.setAnimationLoop(null); });
await page.click('#sh-play');
await page.evaluate(() => __game.simulate(1.5));
const step = (n, sprint) => page.evaluate(([n]) => { const g = __game, out = []; for (let i = 0; i < n; i++) { g.update(1 / 60, false); out.push([g.player.pos.x, g.player.pos.z]); } return out; }, [n]);
const res = { hold_s: HOLD }; console.log('started');
for (const mode of ['jog', 'sprint']) {
  await page.evaluate(() => __game.simulate(1));
  if (mode === 'sprint') await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('ArrowUp');
  const held = await step(Math.round(HOLD * 60)); console.log('held', mode, held.length);
  await page.keyboard.up('ArrowUp');
  if (mode === 'sprint') await page.keyboard.up('ShiftLeft');
  const after = await step(90);
  const all = [...held, ...after];
  const sp = []; for (let i = 1; i < all.length; i++) sp.push(Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1]) * 60);
  const firstMoveFrame = sp.findIndex(v => v > 0.05);
  let stopFrame = -1; for (let i = held.length - 1; i < sp.length; i++) if (sp[i] < 0.05) { stopFrame = i - (held.length - 1); break; }
  const distAfter = Math.hypot(after[after.length - 1][0] - held[held.length - 1][0], after[after.length - 1][1] - held[held.length - 1][1]);
  const moving = sp.slice(0, held.length - 1).filter(v => v > 0.05).length / 60;
  res[mode] = { start_after_frames: firstMoveFrame + 1, moving_s_while_held: +moving.toFixed(2), top_speed: +Math.max(...sp).toFixed(2), frames_to_stop_after_release: stopFrame, ms_to_stop: Math.round(stopFrame / 60 * 1000), slide_after_release_m: +distAfter.toFixed(3) };
}
console.log(JSON.stringify(res, null, 1));
await browser.close();
