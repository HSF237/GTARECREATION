// DOM HUD: loading/title/pause screens, minimap, health/armor, cash/clock/weapon, speedometer,
// help prompts, district toasts, notifications and big center messages. All original styling/wording.
import { WEAPONS } from '../game/combat.js';
import { clamp } from '../core/math.js';
import { fullscreenAvailable, toggleFullscreen } from './touch.js';

const CSS = `
#sh-ui{position:fixed;inset:0;pointer-events:none;font-family:Barlow,'Segoe UI',system-ui,sans-serif;color:#fff;user-select:none;z-index:5;--acc:#ff7a3d;--acc2:#3dd6c6}
#sh-ui .scr{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:auto;transition:opacity .6s}
#sh-ui .hidden{opacity:0;pointer-events:none!important}
#sh-ui .hidden *{pointer-events:none!important}
#sh-ui .gone{display:none!important}
#sh-load{background:radial-gradient(ellipse at 50% 120%,#ff7a3d55 0%,#1b0f2a 45%,#07060d 100%)}
.sh-title{font-family:'Big Shoulders Display',Oswald,Impact,sans-serif;font-weight:700;letter-spacing:.14em;font-size:clamp(44px,9vw,112px);line-height:.9;text-align:center;
 background:linear-gradient(180deg,#fff3d6 0%,#ffb36b 45%,#ff5e62 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 6px 24px #ff5e6255)}
.sh-sub{font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;letter-spacing:.5em;font-size:clamp(11px,1.6vw,16px);color:#ffd9b8;opacity:.85;margin-top:10px;text-align:center}
.sh-bar{width:min(420px,70vw);height:4px;background:#ffffff1a;border-radius:4px;margin-top:38px;overflow:hidden}
.sh-bar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--acc),#ffd36b);transition:width .25s}
.sh-status{margin-top:12px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#ffffffa0}
#sh-title{background:linear-gradient(180deg,#07060d00 0%,#07060d00 40%,#07060dcc 100%)}
#sh-title{padding-bottom:10vh!important}
.sh-btn{pointer-events:auto;margin-top:34px;font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;letter-spacing:.3em;font-size:18px;padding:14px 38px;border:1px solid #ffffff55;border-radius:40px;color:#fff;background:#ffffff14;backdrop-filter:blur(6px);cursor:pointer}
.sh-btn:hover{background:var(--acc);border-color:var(--acc)}
.sh-keys{display:grid;grid-template-columns:auto auto;gap:4px 18px;margin-top:26px;font-size:12.5px;color:#ffffffc8;background:#0008;padding:14px 20px;border-radius:12px;backdrop-filter:blur(6px)}
.sh-keys b{font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;font-weight:600;color:#ffd9b8;letter-spacing:.06em;text-align:right}
.sh-note{margin-top:14px;font-size:11.5px;color:#ffffff90;max-width:520px;text-align:center;line-height:1.5}
#sh-pause{background:#07060dcc;backdrop-filter:blur(4px)}
.sh-row{display:flex;gap:10px;margin-top:14px;align-items:center;font-size:13px;pointer-events:auto}
.sh-row button{pointer-events:auto;background:#ffffff14;border:1px solid #ffffff40;color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font-family:Barlow,'Segoe UI',sans-serif}
.sh-row button.on{background:var(--acc);border-color:var(--acc)}
#sh-hud{position:absolute;inset:0;transition:opacity .4s}
#sh-mini{position:absolute;left:22px;bottom:34px;width:220px;height:150px;border-radius:10px;overflow:hidden;box-shadow:0 4px 18px #0008;border:2px solid #0009}
#sh-bars{position:absolute;left:22px;bottom:20px;width:224px;display:flex;gap:4px}
#sh-bars div{height:7px;background:#0009;border-radius:3px;overflow:hidden;flex:1}
#sh-bars i{display:block;height:100%}
#sh-hp i{background:linear-gradient(90deg,#3ddc84,#8ef0b0)} #sh-ar i{background:linear-gradient(90deg,#3d9bff,#8ecbff)}
#sh-tr{position:absolute;right:26px;top:22px;text-align:right;font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;text-shadow:0 2px 6px #000b}
#sh-clock{font-size:20px;letter-spacing:.08em;opacity:.9}
#sh-cash{font-size:30px;color:#9df2b6;letter-spacing:.04em}
#sh-wpn{margin-top:6px;font-size:16px;letter-spacing:.1em;opacity:.95}
#sh-wpn small{font-size:13px;opacity:.75;margin-left:8px}
#sh-heat{margin-top:6px;font-size:18px;letter-spacing:.2em;color:#ff5e62;min-height:22px}
#sh-speed{position:absolute;right:30px;bottom:26px;text-align:right;font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;text-shadow:0 2px 8px #000c;transition:opacity .3s}
#sh-speed .v{font-size:54px;line-height:1}
#sh-speed .u{font-size:14px;letter-spacing:.3em;opacity:.8}
#sh-speed .n{font-size:13px;letter-spacing:.25em;opacity:.8;margin-top:4px}
#sh-speed .dmg{width:150px;height:4px;background:#0008;margin:6px 0 0 auto;border-radius:3px;overflow:hidden}
#sh-speed .dmg i{display:block;height:100%;background:linear-gradient(90deg,#ff5e62,#ffd36b)}
#sh-help{position:absolute;left:22px;top:22px;max-width:340px;background:#000b;padding:12px 16px;border-radius:10px;font-size:13.5px;line-height:1.45;border-left:3px solid var(--acc);transition:opacity .3s}
#sh-help kbd{font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;background:#ffffff22;border-radius:4px;padding:0 6px;color:#ffd9b8}
#sh-zone{position:absolute;right:30px;bottom:130px;text-align:right;font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;font-size:26px;letter-spacing:.12em;text-shadow:0 2px 10px #000c;transition:opacity .8s}
#sh-zone small{display:block;font-family:Barlow,'Segoe UI',sans-serif;font-size:12px;letter-spacing:.25em;opacity:.75}
#sh-big{position:absolute;left:0;right:0;top:36%;text-align:center;font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;font-weight:700;font-size:clamp(40px,7vw,86px);letter-spacing:.18em;transition:opacity .6s;text-shadow:0 4px 30px #000}
#sh-big small{display:block;font-size:.26em;letter-spacing:.4em;font-weight:400;opacity:.85;margin-top:6px}
#sh-cross{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;transition:opacity .15s}
#sh-cross:before,#sh-cross:after{content:'';position:absolute;background:#fff;box-shadow:0 0 3px #000}
#sh-cross:before{left:12px;top:4px;width:2px;height:18px}#sh-cross:after{top:12px;left:4px;height:2px;width:18px}
#sh-cross.hit:before,#sh-cross.hit:after{background:#ff5e62}
#sh-notes{position:absolute;left:50%;top:18px;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center}
#sh-notes div{background:#000b;padding:8px 16px;border-radius:20px;font-size:13px;animation:shIn .3s}
@keyframes shIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1}}
#sh-dmg{position:absolute;inset:0;box-shadow:inset 0 0 160px #ff000000;transition:box-shadow .2s}
#sh-fade{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .8s}
#sh-fps{position:absolute;right:8px;bottom:4px;font-size:10px;opacity:.45}

#sh-obj{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);max-width:min(720px,70vw);text-align:center;font-size:16px;line-height:1.4;text-shadow:0 2px 6px #000,0 0 2px #000;transition:opacity .3s}
#sh-obj b{color:#ffc857}
#sh-sub{position:absolute;left:50%;bottom:62px;transform:translateX(-50%);max-width:min(760px,80vw);text-align:center;font-size:18px;line-height:1.4;text-shadow:0 2px 6px #000,0 0 3px #000;transition:opacity .2s}
#sh-sub b{font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;letter-spacing:.1em;color:#ffc857;margin-right:8px}
#sh-timer{position:absolute;left:50%;top:18px;transform:translateX(-50%);font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;font-size:34px;letter-spacing:.08em;text-shadow:0 2px 8px #000c;font-variant-numeric:tabular-nums}
#sh-timer.low{color:#ff5e62}
#sh-radio{position:absolute;left:50%;top:64px;transform:translateX(-50%);text-align:center;font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;font-size:24px;letter-spacing:.14em;text-shadow:0 2px 8px #000c;transition:opacity .5s}
#sh-radio small{display:block;font-family:Barlow,'Segoe UI',sans-serif;font-size:12px;letter-spacing:.2em;opacity:.8}
#sh-prompt{position:absolute;left:50%;top:58%;transform:translateX(-50%);background:#000a;padding:8px 16px;border-radius:20px;font-size:14px;transition:opacity .2s;white-space:nowrap}
#sh-prompt kbd{font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;background:#ffffff22;border-radius:4px;padding:0 6px;color:#ffd9b8}
#sh-heat.flash{animation:shBlink .8s steps(2) infinite}
@keyframes shBlink{50%{opacity:.25}}
#sh-shop{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,92vw);background:#0b0a12ee;border:1px solid #ffffff22;border-radius:14px;padding:18px 18px 14px;pointer-events:auto;box-shadow:0 20px 60px #000a}
#sh-shop h3{margin:0 0 4px;font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;font-size:28px;letter-spacing:.1em;color:#ffc857}
#sh-shop .cash{font-size:13px;opacity:.75;margin-bottom:12px}
#sh-shop button.item{display:flex;width:100%;align-items:center;gap:12px;text-align:left;background:#ffffff0d;border:1px solid #ffffff18;color:#fff;border-radius:10px;padding:10px 12px;margin-top:8px;cursor:pointer;font:inherit;pointer-events:auto}
#sh-shop button.item:hover,#sh-shop button.item:focus-visible{background:#ff7a3d33;border-color:#ff7a3d;outline:none}
#sh-shop .item span{flex:1}#sh-shop .item small{display:block;opacity:.65;font-size:12px}
#sh-shop .item b{font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;font-size:20px;color:#9df2b6}
#sh-shop .foot{display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:12.5px;opacity:.85}
#sh-shop .foot button{pointer-events:auto;background:none;border:1px solid #ffffff40;color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer}
#sh-map{position:absolute;inset:0;background:#0b1a22;pointer-events:auto;cursor:grab}
#sh-map canvas{position:absolute;inset:0;width:100%;height:100%}
#sh-map .legend{position:absolute;left:18px;bottom:18px;background:#000b;border-radius:10px;padding:10px 14px;font-size:12.5px;line-height:1.7;pointer-events:none}
#sh-map .legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;vertical-align:middle;border:1px solid #000}
#sh-map .hint{position:absolute;right:18px;top:16px;background:#000b;border-radius:10px;padding:8px 14px;font-size:12.5px;pointer-events:none}
#sh-map h2{position:absolute;left:18px;top:10px;margin:0;font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;font-size:34px;letter-spacing:.14em;color:#ffd9b8;text-shadow:0 2px 8px #000;pointer-events:none}
.sh-btns{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
.sh-btn.sec{background:transparent}
#sh-ui .scr{overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;box-sizing:border-box;justify-content:flex-start;padding:16px 0}
#sh-ui .scr>:first-child{margin-top:auto!important}
#sh-ui .scr>:last-child{margin-bottom:auto!important}
@media (max-height:700px){.sh-keys{grid-template-columns:auto auto auto auto;gap:4px 16px}}
#sh-ui .sh-btn,#sh-ui .sh-row button,#sh-shop button,#sh-map button{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.sh-row{flex-wrap:wrap;justify-content:center;max-width:94vw}
.sh-keys.t{grid-template-columns:auto auto auto auto;gap:5px 14px}
#sh-map .mbtns{position:absolute;right:18px;bottom:18px;display:flex;gap:10px;pointer-events:auto}
#sh-map .mbtns button{pointer-events:auto;background:#000b;border:1px solid #ffffff40;color:#fff;border-radius:22px;padding:10px 16px;font:600 12.5px Barlow,'Segoe UI',sans-serif;letter-spacing:.08em;cursor:pointer}
#sh-map canvas{touch-action:none}
#sh-shop{max-height:calc(100% - 16px);overflow-y:auto;box-sizing:border-box;overscroll-behavior:contain;touch-action:pan-y}
@media (max-width:700px){#sh-mini{width:150px;height:110px;left:12px}#sh-bars{left:12px;width:154px}#sh-tr{right:14px;top:12px}#sh-cash{font-size:22px}#sh-speed .v{font-size:38px}.sh-keys,.sh-keys.t{grid-template-columns:auto auto}}
@media (max-height:520px){
 #sh-ui .scr{padding:12px 0}
 #sh-title{padding-bottom:12px!important}
 .sh-title{font-size:min(15vh,9vw)}
 #sh-pause .sh-title{font-size:min(11vh,48px)!important}
 .sh-sub{margin-top:9px}
 .sh-btn{margin-top:14px;padding:10px 26px;font-size:15px}
 .sh-keys{margin-top:10px;padding:9px 14px;font-size:11.5px}
 .sh-note{margin-top:8px;font-size:11px;max-width:80vw}
 .sh-row{margin-top:7px}
 .sh-bar{margin-top:22px}
 #sh-map h2{font-size:24px}
 #sh-map .legend{font-size:11px;line-height:1.5;padding:8px 10px;left:max(10px,env(safe-area-inset-left));bottom:10px}
 #sh-map .hint{font-size:11px;top:10px;right:max(10px,env(safe-area-inset-right))}
 #sh-map .mbtns{bottom:10px;right:max(10px,env(safe-area-inset-right))}
 #sh-shop{padding:12px 14px 10px}
 #sh-shop h3{font-size:22px}
 #sh-shop .cash{margin-bottom:4px}
 #sh-shop button.item{padding:8px 12px;margin-top:6px}
 #sh-shop .item small{display:inline;margin-left:8px}
 #sh-shop .foot{margin-top:8px}
}
`;

export class HUD {
  constructor(game) {
    this.game = game;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const root = this.root = document.createElement('div'); root.id = 'sh-ui';
    root.innerHTML = `
      <div id="sh-hud" class="hidden">
        <div id="sh-dmg"></div>
        <canvas id="sh-mini"></canvas>
        <div id="sh-bars"><div id="sh-hp"><i></i></div><div id="sh-ar"><i></i></div></div>
        <div id="sh-tr"><div id="sh-clock">--:--</div><div id="sh-cash">$0</div><div id="sh-wpn"></div><div id="sh-heat"></div></div>
        <div id="sh-speed" class="hidden"><div class="v">0</div><div class="u">MPH</div><div class="n"></div><div class="dmg"><i></i></div></div>
        <div id="sh-zone" class="hidden"></div>
        <div id="sh-help" class="hidden"></div>
        <div id="sh-cross" class="hidden"></div>
        <div id="sh-notes"></div>
        <div id="sh-big" class="hidden"></div>
        <div id="sh-timer" class="hidden"></div>
        <div id="sh-radio" class="hidden"></div>
        <div id="sh-sub" class="hidden"></div>
        <div id="sh-obj" class="hidden"></div>
        <div id="sh-prompt" class="hidden"></div>
        <div id="sh-fps"></div>
      </div>
      <div id="sh-shop" class="hidden"></div>
      <div id="sh-map" class="hidden"><canvas></canvas><h2>SOL HARBOR</h2><div class="hint">Drag to pan · wheel to zoom · click to set a waypoint · right-click clears · <b>M</b> closes</div><div class="legend"></div>
        <div class="mbtns"><button type="button" id="sh-mapclr">CLEAR WAYPOINT</button><button type="button" id="sh-mapclose">CLOSE MAP</button></div></div>
      <div id="sh-fade"></div>
      <div id="sh-load" class="scr"><div class="sh-title">SOL HARBOR</div><div class="sh-sub">AN OPEN CITY</div><div class="sh-bar"><i></i></div><div class="sh-status">Waking the city</div></div>
      <div id="sh-title" class="scr hidden"><div class="sh-title">SOL HARBOR</div><div class="sh-sub">AN OPEN ISLAND CITY</div>
        <div class="sh-btns"><button class="sh-btn" id="sh-play">NEW GAME</button><button class="sh-btn sec gone" id="sh-cont">CONTINUE</button><button class="sh-btn sec gone sh-fs">FULL SCREEN</button></div>
        <div class="sh-keys">${keysHTML()}</div>
        <div class="sh-note">Remy Castillo is back in Sol Harbor. Find Inez, Otis and Marisol (gold markers) for work, race the streets, drive a cab, and keep the police off your back. Best with a mouse and keyboard.</div></div>
      <div id="sh-pause" class="scr hidden"><div class="sh-title" style="font-size:64px">PAUSED</div>
        <div class="sh-row">Graphics <button data-q="low">Low</button><button data-q="medium">Medium</button><button data-q="high">High</button><button data-q="ultra">Ultra</button></div>
        <div class="sh-row"><span class="sh-looklbl">Mouse</span> <button data-s="0.6">Slow</button><button data-s="1">Normal</button><button data-s="1.6">Fast</button> &nbsp; <button data-inv="1">Invert Y</button></div>
        <div class="sh-row">Time <button data-t="8">Morning</button><button data-t="13">Noon</button><button data-t="18.2">Sunset</button><button data-t="23">Night</button> &nbsp; <button data-w="1">Toggle rain</button></div>
        <div class="sh-row">Sound <button data-vol="0">Off</button><button data-vol="0.5">Low</button><button data-vol="0.9">Normal</button> &nbsp; Radio <button data-mus="0">Off</button><button data-mus="0.35">Low</button><button data-mus="0.6">Normal</button></div>
        <div class="sh-btns"><button class="sh-btn" id="sh-resume">RESUME</button><button class="sh-btn sec" id="sh-save">SAVE GAME</button><button class="sh-btn sec gone sh-fs">FULL SCREEN</button></div>
        <div class="sh-keys">${keysHTML()}</div></div>`;
    document.body.appendChild(root);
    const $ = (s) => root.querySelector(s);
    this.el = { hud: $('#sh-hud'), load: $('#sh-load'), loadBar: $('#sh-load .sh-bar i'), loadStatus: $('#sh-load .sh-status'), title: $('#sh-title'), pause: $('#sh-pause'),
      mini: $('#sh-mini'), hp: $('#sh-hp i'), ar: $('#sh-ar i'), clock: $('#sh-clock'), cash: $('#sh-cash'), wpn: $('#sh-wpn'), heat: $('#sh-heat'), speed: $('#sh-speed'),
      speedV: $('#sh-speed .v'), speedN: $('#sh-speed .n'), speedD: $('#sh-speed .dmg i'), zone: $('#sh-zone'), help: $('#sh-help'), cross: $('#sh-cross'), notes: $('#sh-notes'), big: $('#sh-big'), dmg: $('#sh-dmg'), fade: $('#sh-fade'), fps: $('#sh-fps'),
      timer: $('#sh-timer'), radio: $('#sh-radio'), sub: $('#sh-sub'), obj: $('#sh-obj'), prompt: $('#sh-prompt'), shop: $('#sh-shop'), map: $('#sh-map') };
    this.radioT = 0; this.gpsRoute = null;
    this.cache = {};
    this.zoneT = 0; this.helpT = 0; this.bigT = 0; this.lastZone = '';
    this.mini = null; this.miniZoom = 0.55;
    this.fpsAcc = 0; this.fpsN = 0; this.fpsT = 0;
    // pause menu buttons
    root.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => { game.setQuality(b.dataset.q); this._markPause(); }));
    root.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { game.input.sens = +b.dataset.s; game.saveSettings(); this._markPause(); }));
    root.querySelector('[data-inv]').addEventListener('click', () => { game.input.invertY = !game.input.invertY; game.saveSettings(); this._markPause(); });
    root.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => { game.timeOfDay = +b.dataset.t; }));
    root.querySelector('[data-w]').addEventListener('click', () => { game.weatherTarget.rain = game.weatherTarget.rain > 0.3 ? 0 : 0.85; game.weatherTarget.clouds = game.weatherTarget.rain > 0.3 ? 0.9 : 0.3; });
    root.querySelectorAll('[data-vol]').forEach(b => b.addEventListener('click', () => { game.audio.setVolume('master', +b.dataset.vol); game.saveSettings(); this._markPause(); }));
    root.querySelectorAll('[data-mus]').forEach(b => b.addEventListener('click', () => { game.audio.setVolume('music', +b.dataset.mus); game.saveSettings(); this._markPause(); }));
    root.querySelector('#sh-save').addEventListener('click', () => { const ok = game.saveGame(true); root.querySelector('#sh-save').textContent = ok ? 'SAVED' : 'SAVE UNAVAILABLE'; setTimeout(() => { root.querySelector('#sh-save').textContent = 'SAVE GAME'; }, 1500); });
    // touch: prompts are buttons ("TAP Talk to Inez"), fullscreen, map buttons
    this.touchMode = false; this.promptAct = null;
    this.el.prompt.addEventListener('pointerdown', (e) => { if (this.touchMode && this.promptAct) { e.preventDefault(); game.input.vTap(this.promptAct); } });
    root.querySelectorAll('.sh-fs').forEach(b => b.addEventListener('click', () => toggleFullscreen()));
    root.querySelector('#sh-mapclr').addEventListener('click', () => game.setWaypoint(null));
    root.querySelector('#sh-mapclose').addEventListener('click', () => { if (game.mapOpen) game.toggleMap(); });
  }
  /** Switch the HUD between keyboard/mouse and touch layouts and wording. */
  setTouch(on) {
    this.touchMode = on;
    this.root.classList.toggle('touch', on);
    this.root.querySelectorAll('.sh-keys').forEach(k => { k.innerHTML = keysHTML(on); k.classList.toggle('t', on); });
    const note = this.root.querySelector('#sh-title .sh-note');
    if (note) note.innerHTML = on ? 'Remy Castillo is back in Sol Harbor. Find Inez, Otis and Marisol (gold markers) for work, race the streets, drive a cab and keep the police off your back. Best played sideways.'
      : 'Remy Castillo is back in Sol Harbor. Find Inez, Otis and Marisol (gold markers) for work, race the streets, drive a cab, and keep the police off your back. Best with a mouse and keyboard.';
    const lbl = this.root.querySelector('.sh-looklbl'); if (lbl) lbl.textContent = on ? 'Look speed' : 'Mouse';
    this.root.querySelector('#sh-map .hint').innerHTML = on ? 'Drag to pan · pinch to zoom · tap to set a waypoint' : 'Drag to pan · wheel to zoom · click to set a waypoint · right-click clears · <b>M</b> closes';
    this.root.querySelectorAll('.sh-fs').forEach(b => b.classList.toggle('gone', !(on && fullscreenAvailable())));
    this.cache.prompt = null;
  }
  _markPause() {
    const g = this.game;
    this.root.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('on', b.dataset.q === g.quality));
    this.root.querySelectorAll('[data-s]').forEach(b => b.classList.toggle('on', +b.dataset.s === g.input.sens));
    this.root.querySelector('[data-inv]').classList.toggle('on', g.input.invertY);
    if (g.audio) { this.root.querySelectorAll('[data-vol]').forEach(b => b.classList.toggle('on', +b.dataset.vol === g.audio.volume.master)); this.root.querySelectorAll('[data-mus]').forEach(b => b.classList.toggle('on', +b.dataset.mus === g.audio.volume.music)); }
  }
  loading(p, label) { this.el.loadBar.style.width = (p * 100).toFixed(0) + '%'; if (label) this.el.loadStatus.textContent = label; }
  showTitle(onPlay, onContinue = null) {
    this.el.load.classList.add('hidden');
    this.el.title.classList.remove('hidden');
    const b = this.root.querySelector('#sh-play'), c = this.root.querySelector('#sh-cont');
    const go = (fn) => {
      this.el.title.classList.add('hidden'); this.el.hud.classList.remove('hidden');
      // phones: take the whole screen when the browser allows it (Android); iPhones simply ignore this
      if (this.touchMode && fullscreenAvailable() && !document.fullscreenElement && this.game.touch?.preferred) toggleFullscreen();
      fn();
    };
    b.onclick = () => go(onPlay);
    if (onContinue) { c.classList.remove('gone'); c.onclick = () => go(onContinue); c.focus(); }
  }
  setPaused(p, onResume) {
    this.el.pause.classList.toggle('hidden', !p);
    if (p) { this._markPause(); this.root.querySelector('#sh-resume').onclick = onResume; }
  }
  fade(on) { this.el.fade.style.opacity = on ? 1 : 0; }
  set(key, el, text) { if (this.cache[key] !== text) { this.cache[key] = text; el.innerHTML = text; return true; } return false; }
  help(text, t = 5) { this.set('help', this.el.help, text); this.el.help.classList.remove('hidden'); this.helpT = t; }
  note(text, t = 4) {
    const d = document.createElement('div'); d.innerHTML = text; this.el.notes.appendChild(d);
    setTimeout(() => d.remove(), t * 1000);
    while (this.el.notes.children.length > 4) this.el.notes.firstChild.remove();
  }
  big(text, sub = '', color = '#fff', t = 4) { this.set('big', this.el.big, `${text}${sub ? `<small>${sub}</small>` : ''}`); this.el.big.style.color = color; this.el.big.classList.remove('hidden'); this.bigT = t; }
  objective(text) { if (!text) { this.el.obj.classList.add('hidden'); this.cache.obj = null; return; } this.set('obj', this.el.obj, text); this.el.obj.classList.remove('hidden'); }
  timer(t) {
    if (t == null) { this.el.timer.classList.add('hidden'); return; }
    this.el.timer.classList.remove('hidden');
    const m = Math.floor(t / 60), sec = Math.floor(t % 60);
    this.set('timer', this.el.timer, `${m}:${String(sec).padStart(2, '0')}`); this.el.timer.classList.toggle('low', t < 15);
  }
  subtitle(who, text) { if (!who) { this.el.sub.classList.add('hidden'); return; } this.set('sub', this.el.sub, `<b>${who}</b>${text}`); this.el.sub.classList.remove('hidden'); }
  prompt(text) {
    const el = this.el.prompt;
    if (!text) { el.classList.add('hidden'); this.promptAct = null; return; }
    let act = null;
    if (this.touchMode) {
      // "<kbd>E</kbd> Talk to Inez" becomes a button: tap the pill to do it
      const m = /^<kbd>([A-Z])<\/kbd>\s*/.exec(text);
      if (m) { act = m[1] === 'T' ? 'mission' : m[1] === 'F' ? 'enter' : 'interact'; text = '<kbd class="tap">TAP</kbd> ' + text.slice(m[0].length); }
    }
    this.promptAct = act;
    if (this.set('prompt', el, text)) el.classList.toggle('tap', !!act);
    el.classList.remove('hidden');
  }
  radio(st) { this.set('radio', this.el.radio, st ? `${st.name.toUpperCase()} ${st.freq}<small>${st.tag}</small>` : 'RADIO OFF'); this.el.radio.classList.remove('hidden'); this.radioT = 3; }
  shop(name, items, onBuy, onClose) {
    const el = this.el.shop;
    if (!name) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const P = this.game.player;
    el.innerHTML = `<h3>${name.toUpperCase()}</h3><div class="cash">Cash: $${P.cash.toLocaleString('en-US')}</div>` +
      items.map((it, i) => `<button class="item" data-id="${it.id}"><span>${i + 1}. ${it.label}<small>${it.sub || ''}</small></span><b>$${it.price.toLocaleString('en-US')}</b></button>`).join('') +
      `<div class="foot"><span id="sh-shopmsg">${this.touchMode ? 'Tap an item to buy it.' : 'Click an item or press its number.'}</span><button id="sh-shopclose">${this.touchMode ? 'Leave' : 'Leave (Esc)'}</button></div>`;
    el.classList.remove('hidden');
    el.querySelectorAll('button.item').forEach(b => b.onclick = () => onBuy(b.dataset.id));
    el.querySelector('#sh-shopclose').onclick = onClose;
    this._shopKeys = (e) => { if (e.code === 'Escape') { e.preventDefault(); onClose(); } const n = +e.key; if (n >= 1 && n <= items.length) onBuy(items[n - 1].id); };
  }
  shopMsg(t) { const m = this.el.shop.querySelector('#sh-shopmsg'); if (m) m.textContent = t; }
  zone(name, sub) { this.set('zone', this.el.zone, `${name}<small>${sub || ''}</small>`); this.el.zone.classList.remove('hidden'); this.zoneT = 5; }

  // ------------------------------------------------------------------ minimap
  buildMinimap() {
    const md = this.game.city.mapData, B = md.bounds, s = this.mapScale = 0.8;
    const W = Math.ceil((B.maxX - B.minX) * s), H = Math.ceil((B.maxZ - B.minZ) * s);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const X = (x) => (x - B.minX) * s, Z = (z) => (z - B.minZ) * s;
    const poly = (pts, fill) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.closePath(); g.fillStyle = fill; g.fill(); };
    g.fillStyle = '#1d4f63'; g.fillRect(0, 0, W, H);
    // subtle water texture
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 1); }
    for (const l of md.land) poly(l, '#43533f');
    // hills shading by height
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let py = 0; py < H; py += 1) for (let px = 0; px < W; px += 1) {
      const i = (py * W + px) * 4; if (d[i + 2] > 80) continue; // water
      const x = px / s + B.minX, z = py / s + B.minZ, h = md.heightAt(x, z);
      const k = clamp(h / 160, 0, 1);
      d[i] = 67 + k * 60; d[i + 1] = 83 + k * 45; d[i + 2] = 63 + k * 30;
    }
    g.putImageData(img, 0, 0);
    for (const b of md.beaches || []) poly(b.poly || b, '#c9b68a');
    for (const b of md.blocks) poly(b.poly, b.kind === 'park' ? '#4f7a45' : b.kind === 'plaza' ? '#7a7466' : '#6d6a64');
    for (const p of md.parks || []) if (p.poly || Array.isArray(p)) poly(p.poly || p, '#4f7a45');
    g.fillStyle = '#4a4744';
    for (const b of md.buildings) { g.save(); g.translate(X(b.x), Z(b.z)); g.rotate(-(b.rot || 0)); g.fillRect(-b.w * s / 2, -b.d * s / 2, b.w * s, b.d * s); g.restore(); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of [0, 1]) for (const r of md.roads) {
      g.beginPath(); r.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))));
      g.strokeStyle = pass ? (r.kind === 'boulevard' || r.kind === 'coastal' ? '#f1efe9' : '#d9d6cf') : '#2d2c2a';
      g.lineWidth = r.width * s * (pass ? 0.8 : 1.15) + (pass ? 0 : 1.5); g.stroke();
    }
    if (md.pier) { const p = md.pier; g.fillStyle = '#8a6d4b'; if (p.x0 != null) g.fillRect(X(p.x0), Z(p.z0), (p.x1 - p.x0) * s, (p.z1 - p.z0) * s); }
    // labels
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const l of md.labels) { g.font = `600 ${l.size === 3 ? 22 : l.size === 2 ? 17 : 12}px 'Big Shoulders Display', Oswald, Arial`; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillText(l.name, X(l.x) + 1.5, Z(l.z) + 1.5); g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(l.name, X(l.x), Z(l.z)); }
    this.mapCanvas = c;
    this.miniCtx = this.el.mini.getContext('2d');
  }
  drawMinimap(dt) {
    const game = this.game, cv = this.el.mini;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = this.miniCtx, B = game.city.mapData.bounds, s = this.mapScale;
    const p = game.player, pos = p.inVehicle && p.vehicle ? p.vehicle.com : p.pos;
    const sp = p.inVehicle && p.vehicle ? p.vehicle.speed : 0;
    const zoomT = clamp(0.62 - sp * 0.008, 0.3, 0.62);
    this.miniZoom += (zoomT - this.miniZoom) * Math.min(1, dt * 1.5);
    const yaw = game.camera.yaw;
    const rot = -Math.PI / 2 - Math.atan2(Math.cos(yaw), Math.sin(yaw));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1d4f63'; g.fillRect(0, 0, w, h);
    g.save();
    g.translate(w / 2, h * 0.62); g.rotate(rot); const k = this.miniZoom / s; g.scale(k, k);
    g.drawImage(this.mapCanvas, -(pos.x - B.minX) * s, -(pos.z - B.minZ) * s);
    if (this.el.hud && game.heat && game.heat.level > 0 && !game.heat.seen && Math.floor(game.time * 2) % 2) { g.fillStyle = 'rgba(40,60,255,0.08)'; g.fillRect(-1e4, -1e4, 2e4, 2e4); }
    // search area while the police have lost sight of you
    const H = game.heat;
    if (H && H.level > 0 && !H.seen) { g.beginPath(); g.arc((H.lastSeen.x - pos.x) * s, (H.lastSeen.z - pos.z) * s, H.searchRadius() * s, 0, Math.PI * 2); g.fillStyle = 'rgba(255,94,98,0.16)'; g.fill(); g.lineWidth = 2 / k; g.strokeStyle = 'rgba(255,94,98,0.6)'; g.stroke(); }
    // GPS route
    const R = game.gpsRoute;
    if (R && R.length > 1) {
      g.beginPath(); g.moveTo((R[0][0] - pos.x) * s, (R[0][1] - pos.z) * s);
      for (let i = 1; i < R.length; i++) g.lineTo((R[i][0] - pos.x) * s, (R[i][1] - pos.z) * s);
      g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#000a'; g.lineWidth = 7 / k; g.stroke(); g.strokeStyle = game.gpsColor || '#b36bff'; g.lineWidth = 4 / k; g.stroke();
    }
    g.restore();
    // blips
    const blip = (x, z, col, r = 4, label = '') => {
      let dx = (x - pos.x) * this.miniZoom, dz = (z - pos.z) * this.miniZoom;
      const c = Math.cos(rot), sn = Math.sin(rot); let bx = dx * c - dz * sn, by = dx * sn + dz * c;
      const cx = w / 2, cy = h * 0.62, mx = w / 2 - 8, myT = cy - 8, myB = h - cy - 8;
      const edge = Math.abs(bx) > mx || by < -myT || by > myB;
      if (edge) { const f = Math.min(mx / Math.abs(bx || 1e-6), (by < 0 ? myT : myB) / Math.abs(by || 1e-6)); bx *= f; by *= f; }
      g.beginPath(); g.arc(cx + bx, cy + by, edge ? r * 0.8 : r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#000a'; g.stroke();
      if (label && !edge) { g.font = '700 9px Barlow, Arial'; g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, cx + bx, cy + by + 0.5); }
    };
    for (const b of game.blips()) blip(b.x, b.z, b.color, b.r || 4.5, b.label || '');
    // north marker
    { const d = Math.min(w, h) * 0.46; const c = Math.cos(rot), sn = Math.sin(rot); const nx = -d * sn * -1 * 0, ny = 0; const ax = 0 * c - (-1) * sn, ay = 0 * sn + (-1) * c; g.font = "700 11px 'Big Shoulders Display', Oswald, Arial"; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let px = w / 2 + ax * d, py = h * 0.62 + ay * d; px = clamp(px, 10, w - 10); py = clamp(py, 10, h - 10); g.beginPath(); g.arc(px, py, 8, 0, 7); g.fillStyle = '#000a'; g.fill(); g.fillStyle = '#fff'; g.fillText('N', px, py + 0.5); }
    // player arrow
    g.save(); g.translate(w / 2, h * 0.62); g.rotate(rot + Math.atan2(Math.cos(p.yaw), Math.sin(p.yaw)) + Math.PI / 2 - Math.PI);
    g.rotate(Math.PI);
    g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke();
    g.restore();
  }

  // ------------------------------------------------------------------ full map
  openMap() {
    const game = this.game, el = this.el.map, cv = el.querySelector('canvas');
    this.mapOpen = true; el.classList.remove('hidden');
    const p = game.player, pos = p.inVehicle && p.vehicle ? p.vehicle.com : p.pos;
    this.mv = this.mv || { cx: pos.x, cz: pos.z, z: 0.55 };
    this.mv.cx = pos.x; this.mv.cz = pos.z;
    el.querySelector('.legend').innerHTML = [['#ffc857', 'Story job'], ['#ff4fd8', 'Street race'], ['#3dd6c6', 'Courier depot'], ['#3ddc84', 'Safehouse (save)'], ['#ff9f43', 'Gun shop'], ['#9b59b6', 'Paint shop'], ['#ff5e62', 'Clinic'], ['#3d9bff', 'Police station'], ['#b36bff', 'Waypoint']].map(([c, n]) => `<div><i style="background:${c}"></i>${n}</div>`).join('') + `<div style="margin-top:4px;opacity:.8">Sun Tokens ${game.activities.tokens.size}/30 · Stunt jumps ${game.activities.stunts.size}/${game.city.ramps.length}</div>`;
    if (!this._mapBound) {
      this._mapBound = true;
      // pointer events: mouse drag, one-finger pan, two-finger pinch zoom; a tap/click sets the waypoint
      const pts = new Map();
      let drag = null, pinch = null;
      const toWorld = (x, y) => { const r = cv.getBoundingClientRect(); return { x: this.mv.cx + (x - r.left - r.width / 2) / this.mv.z, z: this.mv.cz + (y - r.top - r.height / 2) / this.mv.z }; };
      const startPinch = () => {
        const [a, b] = [...pts.values()];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        pinch = { d: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), z: this.mv.z, w: toWorld(mx, my) };
        if (drag) drag.moved = true;
      };
      cv.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 1) { drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: this.mv.cx, cz: this.mv.cz, moved: false, btn: e.button }; el.style.cursor = 'grabbing'; }
        else if (pts.size === 2) startPinch();
      });
      cv.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId) || !this.mapOpen) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pts.size >= 2) {
          const [a, b] = [...pts.values()];
          const r = cv.getBoundingClientRect(), mx = (a.x + b.x) / 2 - r.left - r.width / 2, my = (a.y + b.y) / 2 - r.top - r.height / 2;
          this.mv.z = clamp(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, 0.18, 3);
          // keep the world point that started between the fingers under them
          this.mv.cx = pinch.w.x - mx / this.mv.z; this.mv.cz = pinch.w.z - my / this.mv.z;
        } else if (drag && e.pointerId === drag.id) {
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > (e.pointerType === 'touch' ? 10 : 4)) drag.moved = true;
          if (drag.moved) { this.mv.cx = drag.cx - dx / this.mv.z; this.mv.cz = drag.cz - dy / this.mv.z; }
        }
      });
      const up = (e) => {
        if (!pts.delete(e.pointerId)) return;
        if (pinch) { if (pts.size < 2) pinch = null; if (pts.size === 1) { const [id, p] = [...pts.entries()][0]; drag = { id, x: p.x, y: p.y, cx: this.mv.cx, cz: this.mv.cz, moved: true, btn: 0 }; } else drag = null; return; }
        if (drag && e.pointerId === drag.id) {
          el.style.cursor = 'grab';
          if (!drag.moved && e.type === 'pointerup' && this.mapOpen) {
            if (drag.btn === 2) this.game.setWaypoint(null); else this.game.setWaypoint(toWorld(e.clientX, e.clientY));
          }
          drag = null;
        }
      };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2; const wx = this.mv.cx + mx / this.mv.z, wz = this.mv.cz + my / this.mv.z; this.mv.z = clamp(this.mv.z * (e.deltaY > 0 ? 0.85 : 1.18), 0.18, 3); this.mv.cx = wx - mx / this.mv.z; this.mv.cz = wz - my / this.mv.z; }, { passive: false });
    }
  }
  closeMap() { this.mapOpen = false; this.el.map.classList.add('hidden'); }
  drawMap() {
    const game = this.game, cv = this.el.map.querySelector('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'), B = game.city.mapData.bounds, s = this.mapScale, mv = this.mv;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1d4f63'; g.fillRect(0, 0, w, h);
    const X = (x) => w / 2 + (x - mv.cx) * mv.z, Z = (z) => h / 2 + (z - mv.cz) * mv.z;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mapCanvas, X(B.minX), Z(B.minZ), (B.maxX - B.minX) * mv.z, (B.maxZ - B.minZ) * mv.z);
    const R = game.gpsRoute;
    if (R && R.length > 1) { g.beginPath(); g.moveTo(X(R[0][0]), Z(R[0][1])); for (let i = 1; i < R.length; i++) g.lineTo(X(R[i][0]), Z(R[i][1])); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#000a'; g.lineWidth = 7; g.stroke(); g.strokeStyle = game.gpsColor || '#b36bff'; g.lineWidth = 4; g.stroke(); }
    const dot = (x, z, col, r, label) => { g.beginPath(); g.arc(X(x), Z(z), r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000b'; g.stroke(); if (label) { g.font = '700 10px Barlow, Arial'; g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, X(x), Z(z) + 0.5); } };
    for (const b of game.blips(true)) dot(b.x, b.z, b.color, (b.r || 5) + 2, b.label || '');
    if (game.waypoint) { const wp = game.waypoint; g.beginPath(); g.moveTo(X(wp.x), Z(wp.z)); g.lineTo(X(wp.x) - 8, Z(wp.z) - 16); g.lineTo(X(wp.x) + 8, Z(wp.z) - 16); g.closePath(); g.fillStyle = '#b36bff'; g.fill(); g.strokeStyle = '#000'; g.stroke(); }
    const p = game.player, pos = p.inVehicle && p.vehicle ? p.vehicle.com : p.pos;
    g.save(); g.translate(X(pos.x), Z(pos.z)); g.rotate(-p.yaw + Math.PI);
    g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(0, 4); g.lineTo(-8, 8); g.closePath(); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke(); g.restore();
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const game = this.game, p = game.player, e = this.el;
    if (this.mapCanvas) this.drawMinimap(dt);
    this.set('hpw', e.hp, ''); e.hp.style.width = (clamp(p.health / p.maxHealth, 0, 1) * 100).toFixed(1) + '%';
    e.ar.style.width = (clamp(p.armor / p.maxArmor, 0, 1) * 100).toFixed(1) + '%';
    const t = game.timeOfDay, hh = Math.floor(t), mm = Math.floor((t - hh) * 60);
    this.set('clock', e.clock, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
    this.set('cash', e.cash, '$' + p.cash.toLocaleString('en-US'));
    const W = WEAPONS[p.weapon];
    this.set('wpn', e.wpn, W.melee ? W.name.toUpperCase() : `${W.name.toUpperCase()}<small>${p.reloadT > 0 ? 'RELOADING' : `${p.clip[p.weapon] ?? 0} / ${p.ammo[p.weapon] ?? 0}`}</small>`);
    const heat = game.heat ? game.heat.level : 0;
    this.set('heat', e.heat, heat > 0 ? '▲'.repeat(heat) + '<span style="opacity:.25">' + '▲'.repeat(5 - heat) + '</span>' : '');
    e.heat.classList.toggle('flash', heat > 0 && !game.heat.seen);
    if (this.radioT > 0) { this.radioT -= dt; if (this.radioT <= 0) e.radio.classList.add('hidden'); }
    if (this.mapOpen) this.drawMap();
    // speed
    const inV = p.inVehicle && p.vehicle;
    e.speed.classList.toggle('hidden', !inV);
    if (inV) {
      const v = p.vehicle;
      this.set('spd', e.speedV, String(Math.round(v.speed * 2.237)));
      this.set('vn', e.speedN, v.spec.name.toUpperCase() + (v.gear === -1 ? ' · R' : ''));
      e.speedD.style.width = (clamp(v.health / v.maxHealth, 0, 1) * 100).toFixed(0) + '%';
    }
    e.cross.classList.toggle('hidden', !(p.aiming && p.weapon !== 'fists'));
    // timers
    if (this.helpT > 0) { this.helpT -= dt; if (this.helpT <= 0) e.help.classList.add('hidden'); }
    if (this.zoneT > 0) { this.zoneT -= dt; if (this.zoneT <= 0) e.zone.classList.add('hidden'); }
    if (this.bigT > 0) { this.bigT -= dt; if (this.bigT <= 0) e.big.classList.add('hidden'); }
    const hurt = clamp(1 - p.health / (p.maxHealth * 0.45), 0, 1);
    e.dmg.style.boxShadow = `inset 0 0 ${120 + hurt * 80}px rgba(160,0,0,${(hurt * 0.55 + (p.hitT > 0 ? 0.25 : 0)).toFixed(2)})`;
    // fps
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 1) { this.set('fps', e.fps, `${Math.round(this.fpsN / this.fpsAcc)} fps · ${game.renderer.info.render.calls} calls`); this.fpsAcc = 0; this.fpsN = 0; }
  }
}
function keysHTML(touch = false) {
  if (touch) {
    return [['Left thumb', 'Move · push past the ring to sprint'], ['Right thumb', 'Look around'], ['FIRE · AIM', 'Shoot · aim locks on to threats'], ['ENTER', 'Get in a nearby car'],
      ['GAS · BRAKE', 'Drive · the stick steers'], ['Minimap', 'Tap it for the full map']].map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join('');
  }
  return [['WASD', 'Move / drive'], ['Mouse', 'Look (click to capture)'], ['Shift', 'Sprint'], ['Space', 'Jump / handbrake'], ['F', 'Enter / exit vehicle'], ['Right mouse', 'Aim'], ['Left mouse', 'Shoot / punch'],
    ['1-5 / wheel', 'Weapons'], ['R', 'Reload'], ['H', 'Horn'], ['V', 'Vehicle camera'], ['C', 'Look behind'], ['Esc / P', 'Pause & settings']].map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join('');
}
