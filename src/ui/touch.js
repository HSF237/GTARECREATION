// Touch controls for phones and tablets: a floating move stick for the left thumb, drag-to-look for
// the right thumb (also while holding FIRE), context buttons for walking and driving, tappable prompts,
// minimap-to-map, pause, fullscreen and a rotate-to-landscape hint. It feeds the shared Input as a
// virtual device, so gameplay code reads touch exactly like keys, mouse and gamepad.
import * as THREE from 'three';
import { clamp, wrapAngle } from '../core/math.js';
import { WEAPONS } from '../game/combat.js';

const CSS = `
html,body{-webkit-text-size-adjust:100%;text-size-adjust:100%}
#sh-touch{position:absolute;inset:0;pointer-events:none;--u:1;--il:max(10px,env(safe-area-inset-left));--ir:max(10px,env(safe-area-inset-right));--ib:max(10px,env(safe-area-inset-bottom));--it:max(8px,env(safe-area-inset-top))}
#sh-touch.dis,#sh-touch.off{display:none}
#sh-touch .tb{position:absolute;pointer-events:auto;touch-action:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;box-sizing:border-box;
 width:calc(var(--d) * var(--u));height:calc(var(--d) * var(--u));border-radius:50%;border:1.5px solid #ffffff5c;background:#0b0a1466;color:#fff;padding:0;margin:0;
 font:700 calc(8.5px * var(--u))/1 Barlow,system-ui,sans-serif;letter-spacing:.1em;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;
 backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);box-shadow:0 2px 10px #0005;transition:transform .07s,background-color .07s,opacity .18s;outline:none}
#sh-touch .tb svg{width:44%;height:44%;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
#sh-touch .tb span{pointer-events:none;opacity:.92}
#sh-touch .tb.big svg{width:40%;height:40%}
#sh-touch .tb.on{background:#ff7a3dc0;border-color:#ffc09a}
#sh-touch .tb.down{background:#ff7a3de0;border-color:#ffd0b0;transform:scale(.92)}
#sh-touch .tb.hint{border-color:#ffc857;box-shadow:0 0 0 3px #ffc85755,0 2px 10px #0005}
#sh-touch .tb.gone{opacity:0;pointer-events:none;transform:scale(.6)}
#sh-touch .tb.pedal{border-radius:calc(16px * var(--u))}
#sh-touch .cl{position:absolute;inset:0;pointer-events:none}
#sh-touch .cl.gone{display:none}
#sh-touch #tb-fire{--d:86px;right:calc(var(--ir) + 14px * var(--u));bottom:calc(var(--ib) + 16px * var(--u))}
#sh-touch #tb-aim{--d:62px;right:calc(var(--ir) + 112px * var(--u));bottom:calc(var(--ib) + 8px * var(--u))}
#sh-touch #tb-jump{--d:56px;right:calc(var(--ir) + 104px * var(--u));bottom:calc(var(--ib) + 90px * var(--u))}
#sh-touch #tb-run{--d:52px;right:calc(var(--ir) + 26px * var(--u));bottom:calc(var(--ib) + 114px * var(--u))}
#sh-touch #tb-car{--d:58px;right:calc(var(--ir) + 188px * var(--u));bottom:calc(var(--ib) + 10px * var(--u))}
#sh-touch #tb-wpn{--d:46px;right:calc(var(--ir) + 180px * var(--u));bottom:calc(var(--ib) + 86px * var(--u))}
#sh-touch #tb-rld{--d:42px;right:calc(var(--ir) + 84px * var(--u));bottom:calc(var(--ib) + 160px * var(--u))}
#sh-touch #tb-gas{--d:74px;height:calc(104px * var(--u));right:calc(var(--ir) + 14px * var(--u));bottom:calc(var(--ib) + 12px * var(--u))}
#sh-touch #tb-brk{--d:68px;height:calc(80px * var(--u));right:calc(var(--ir) + 100px * var(--u));bottom:calc(var(--ib) + 10px * var(--u))}
#sh-touch #tb-hb{--d:56px;right:calc(var(--ir) + 106px * var(--u));bottom:calc(var(--ib) + 100px * var(--u))}
#sh-touch #tb-exit{--d:50px;right:calc(var(--ir) + 26px * var(--u));bottom:calc(var(--ib) + 128px * var(--u))}
#sh-touch #tb-dby{--d:54px;right:calc(var(--ir) + 180px * var(--u));bottom:calc(var(--ib) + 64px * var(--u))}
#sh-touch #tb-taxi{--d:50px;right:calc(var(--ir) + 184px * var(--u));bottom:calc(var(--ib) + 128px * var(--u))}
#sh-touch #tb-horn{--d:44px;right:calc(var(--ir) + 180px * var(--u));bottom:calc(var(--ib) + 8px * var(--u))}
#sh-touch #tb-cam{--d:40px;left:calc(var(--il) + 146px + 96px * var(--u));top:var(--it)}
#sh-touch #tb-radio{--d:40px;left:calc(var(--il) + 146px + 144px * var(--u));top:var(--it)}
#sh-touch #tb-cam span,#sh-touch #tb-radio span{font-size:7.5px}
#sh-touch #tb-pause{--d:40px;left:calc(var(--il) + 146px);top:var(--it)}
#sh-touch #tb-map{--d:40px;left:calc(var(--il) + 146px + 48px * var(--u));top:var(--it)}
#sh-touch #tb-skip{--d:62px;right:calc(var(--ir) + 18px);bottom:calc(var(--ib) + 18px)}
#sh-stick{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;transition:opacity .2s}
#sh-stick .base,#sh-stick .knob{position:absolute;border-radius:50%;transform:translate(-50%,-50%)}
#sh-stick .base{width:calc(var(--R) * 2);height:calc(var(--R) * 2);border:2px solid #ffffff55;background:radial-gradient(circle,#ffffff10 0%,#0b0a1455 70%);box-shadow:0 0 0 1px #0004 inset}
#sh-stick .ring{position:absolute;border-radius:50%;transform:translate(-50%,-50%);width:calc(var(--R) * 2.9);height:calc(var(--R) * 2.9);border:1.5px dashed #ffc85700;transition:border-color .15s}
#sh-stick .knob{width:calc(var(--R) * .9);height:calc(var(--R) * .9);background:#ffffffcc;box-shadow:0 2px 8px #0008}
#sh-stick.idle{opacity:.45}
#sh-stick.sprint .knob{background:#ff9a5c}
#sh-stick.sprint .ring{border-color:#ffc857aa}
#sh-stick .lbl{position:absolute;transform:translate(-50%,0);font:600 10px Barlow,system-ui,sans-serif;letter-spacing:.2em;color:#fff;opacity:.7;white-space:nowrap;text-shadow:0 1px 3px #000}
#sh-stick:not(.idle) .lbl{display:none}
#sh-rotate{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#07060df2;z-index:30;pointer-events:auto;text-align:center;padding:24px;touch-action:none}
#sh-rotate.gone{display:none}
#sh-rotate b{font-family:'Big Shoulders Display',Oswald,'Arial Narrow',sans-serif;font-size:30px;letter-spacing:.12em;color:#ffd9b8}
#sh-rotate span{font-size:14px;opacity:.8;max-width:300px;line-height:1.5}
#sh-rotate button{pointer-events:auto;margin-top:10px;background:#ffffff14;border:1px solid #ffffff66;color:#fff;border-radius:30px;padding:13px 30px;font:600 15px 'Big Shoulders Display',Oswald,Barlow,system-ui,sans-serif;letter-spacing:.3em}
#sh-rotate .ph{width:46px;height:78px;border:3px solid #ffd9b8;border-radius:9px;position:relative;animation:shRot 2.4s ease-in-out infinite}
#sh-rotate .ph:after{content:'';position:absolute;left:50%;bottom:5px;width:10px;height:3px;margin-left:-5px;border-radius:2px;background:#ffd9b8}
@keyframes shRot{0%,20%{transform:rotate(0)}50%,80%{transform:rotate(-90deg)}100%{transform:rotate(0)}}
#sh-ui.touch #sh-mini{left:max(10px,env(safe-area-inset-left));top:max(8px,env(safe-area-inset-top));bottom:auto;width:128px;height:92px;border-radius:12px;pointer-events:auto}
#sh-ui.touch #sh-bars{left:max(10px,env(safe-area-inset-left));top:calc(max(8px,env(safe-area-inset-top)) + 98px);bottom:auto;width:132px}
#sh-ui.touch #sh-help{left:calc(max(10px,env(safe-area-inset-left)) + 146px);top:calc(max(8px,env(safe-area-inset-top)) + 50px * var(--tu,1));max-width:min(300px,36vw);font-size:12.5px;padding:9px 12px;line-height:1.4}
#sh-ui.touch #sh-help b{color:#ffd9b8}
#sh-ui.touch #sh-tr{right:max(12px,env(safe-area-inset-right));top:max(6px,env(safe-area-inset-top))}
#sh-ui.touch #sh-clock{font-size:14px}
#sh-ui.touch #sh-cash{font-size:22px}
#sh-ui.touch #sh-wpn{font-size:13px;margin-top:2px;pointer-events:auto;padding:4px 0 4px 16px}
#sh-ui.touch #sh-wpn small{font-size:11px}
#sh-ui.touch #sh-heat{font-size:14px;margin-top:2px;min-height:16px}
#sh-ui.touch #sh-speed{right:max(12px,env(safe-area-inset-right));bottom:auto;top:calc(max(6px,env(safe-area-inset-top)) + 96px)}
#sh-ui.touch #sh-speed .v{font-size:26px;display:inline-block}
#sh-ui.touch #sh-speed .u{font-size:10px;display:inline-block;margin-left:5px}
#sh-ui.touch #sh-speed .n{font-size:10px;margin-top:1px}
#sh-ui.touch #sh-speed .dmg{width:96px;margin-top:4px}
#sh-ui.touch #sh-zone{right:auto;left:50%;transform:translateX(-50%);bottom:calc(max(8px,env(safe-area-inset-bottom)) + 50px);text-align:center;font-size:22px;white-space:nowrap}
#sh-ui.touch #sh-obj{bottom:max(8px,env(safe-area-inset-bottom));max-width:min(420px,38vw);font-size:13px;line-height:1.3}
#sh-ui.touch #sh-sub{bottom:calc(max(8px,env(safe-area-inset-bottom)) + 44px);max-width:min(560px,52vw);font-size:14px}
#sh-ui.touch #sh-prompt{top:19%;font-size:14px;padding:9px 16px;white-space:normal;max-width:60vw;text-align:center}
#sh-ui.touch #sh-prompt.tap{pointer-events:auto;border:1px solid #ffc85799;background:#000c;touch-action:none}
#sh-ui.touch #sh-prompt kbd.tap{background:#ff7a3d;color:#fff;padding:1px 7px;margin-right:4px}
#sh-ui.touch #sh-big{top:26%}
#sh-ui.touch #sh-fps{display:none}
#sh-ui.touch #sh-notes{top:max(10px,env(safe-area-inset-top))}
#sh-ui.touch #sh-notes div{font-size:12px;padding:6px 12px}
#sh-ui.touch #sh-radio{top:calc(max(8px,env(safe-area-inset-top)) + 52px);font-size:18px}
#sh-ui.touch .sh-keys{font-size:12px}
#sh-ui.touch #sh-shop .foot{position:sticky;bottom:0;background:#0b0a12;padding:6px 0 2px}
@media (max-height:320px){
 #sh-ui.touch .sh-title{font-size:min(13vh,9vw)}
 #sh-ui.touch .sh-sub{margin-top:5px}
 #sh-ui.touch .sh-btn{margin-top:9px;padding:8px 22px;font-size:14px}
 #sh-ui.touch .sh-keys{margin-top:7px;padding:6px 12px;gap:2px 14px;font-size:11px;line-height:1.25}
 #sh-ui.touch .sh-note{margin-top:5px;font-size:10.5px;line-height:1.35}
}
@media (orientation:landscape) and (max-height:430px){
 #sh-ui.touch #sh-shop{width:min(600px,calc(100% - 2 * max(10px,env(safe-area-inset-left)) - 8px));display:grid;grid-template-columns:1fr 1fr;column-gap:8px;align-content:start}
 #sh-ui.touch #sh-shop h3,#sh-ui.touch #sh-shop .cash,#sh-ui.touch #sh-shop .foot{grid-column:1/-1}
 #sh-ui.touch #sh-shop button.item{padding:7px 10px;margin-top:6px}
 #sh-ui.touch #sh-shop .item small{display:block;margin-left:0}
}
@media (orientation:landscape){
 #sh-ui.touch #sh-speed{right:auto;left:max(10px,env(safe-area-inset-left));top:calc(max(8px,env(safe-area-inset-top)) + 112px);text-align:left}
 #sh-ui.touch #sh-speed .dmg{margin-left:0}
 #sh-ui.touch #sh-radio{left:auto;right:max(12px,env(safe-area-inset-right));transform:none;text-align:right;top:calc(max(6px,env(safe-area-inset-top)) + 100px)}
}
@media (orientation:portrait){
 #sh-ui.touch #sh-help{left:max(10px,env(safe-area-inset-left));top:calc(max(8px,env(safe-area-inset-top)) + 170px);max-width:62vw}
 #sh-touch #tb-cam{left:var(--il);top:calc(var(--it) + 116px)}
 #sh-touch #tb-radio{left:calc(var(--il) + 48px * var(--u));top:calc(var(--it) + 116px)}
 #sh-ui.touch #sh-obj,#sh-ui.touch #sh-sub{max-width:86vw}
 #sh-ui.touch #sh-obj{bottom:calc(max(8px,env(safe-area-inset-bottom)) + 240px)}
 #sh-ui.touch #sh-sub{bottom:calc(max(8px,env(safe-area-inset-bottom)) + 290px)}
 #sh-ui.touch #sh-zone{bottom:auto;top:42%}
 #sh-ui.touch #sh-radio{top:calc(max(8px,env(safe-area-inset-top)) + 108px);font-size:13px;letter-spacing:.1em;max-width:calc(100% - 2 * (max(12px,env(safe-area-inset-right)) + 104px))}
 #sh-ui.touch #sh-radio small{font-size:10px;letter-spacing:.08em}
}`;

const ICON = {
  fire: '<path d="M12 2.5l2.1 5.4 5.6-1.7-2.9 5 4.7 3.3-5.8.6.5 5.8-4.2-4-4.2 4 .5-5.8-5.8-.6 4.7-3.3-2.9-5 5.6 1.7z"/>',
  fist: '<path d="M7 11V8.5a1.6 1.6 0 0 1 3.2 0V10m0-1.7V7.4a1.6 1.6 0 0 1 3.2 0V10m0-1.4a1.6 1.6 0 0 1 3.2 0V11m0-.8a1.6 1.6 0 0 1 3.2 0v3.3A6.5 6.5 0 0 1 13.3 20h-1.8A5.5 5.5 0 0 1 6 14.5V12a1.5 1.5 0 0 1 3 0v1"/>',
  aim: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="1.6"/><path d="M12 2v4.5M12 17.5V22M2 12h4.5M17.5 12H22"/>',
  jump: '<path d="M12 18V5M6.5 10.5L12 5l5.5 5.5M5 21h14"/>',
  run: '<path d="M5 6l6 6-6 6M12.5 6l6 6-6 6"/>',
  car: '<path d="M3.5 16.5v-3.2L5.6 8.2A2 2 0 0 1 7.4 7h9.2a2 2 0 0 1 1.8 1.2l2.1 5.1v3.2z"/><circle cx="7.6" cy="16.6" r="1.9"/><circle cx="16.4" cy="16.6" r="1.9"/>',
  exit: '<path d="M10 4H5.5v16H10"/><path d="M14 8l4 4-4 4M18 12H9"/>',
  wpn: '<path d="M4.5 13A7.5 7.5 0 0 1 17.8 7.6L20 9.5M19.5 11A7.5 7.5 0 0 1 6.2 16.4L4 14.5"/><path d="M20 4.5v5h-5M4 19.5v-5h5"/>',
  rld: '<path d="M19.5 12a7.5 7.5 0 1 1-2.7-5.8"/><path d="M19.5 4v4.8h-4.8"/>',
  gas: '<path d="M6 13l6-6 6 6M6 18.5l6-6 6 6"/>',
  brk: '<path d="M6 5.5l6 6 6-6M6 11l6 6 6-6"/>',
  hb: '<circle cx="12" cy="12" r="8.5"/><path d="M10 16.5v-9h3.2a2.8 2.8 0 0 1 0 5.6H10"/>',
  horn: '<path d="M4 10v4h3.5l6 4.5v-13L7.5 10z"/><path d="M17 9a4.2 4.2 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11"/>',
  cam: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-2.5v7L16 13"/>',
  radio: '<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.8" cy="17.6" r="2.2"/><circle cx="16.8" cy="15.6" r="2.2"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  map: '<path d="M3 6.5l6-2.3 6 2.3 6-2.3v13.3l-6 2.3-6-2.3-6 2.3z"/><path d="M9 4.2v13.3M15 6.5v13.3"/>',
  end: '<path d="M7 7l10 10M17 7L7 17"/>',
  skip: '<path d="M5 6l7 6-7 6zM13 6l7 6-7 6z"/>',
};
const BTN = [
  // id, icon, label, cluster, extra classes
  ['fire', 'fire', 'FIRE', 'foot', 'big'], ['aim', 'aim', 'AIM', 'foot'], ['jump', 'jump', 'JUMP', 'foot'], ['run', 'run', 'RUN', 'foot'],
  ['car', 'car', 'ENTER', 'foot'], ['wpn', 'wpn', 'WEAPON', 'foot'], ['rld', 'rld', 'RELOAD', 'foot'],
  ['gas', 'gas', 'GAS', 'car', 'pedal'], ['brk', 'brk', 'BRAKE', 'car', 'pedal'], ['hb', 'hb', 'DRIFT', 'car'], ['exit', 'exit', 'EXIT', 'car'],
  ['dby', 'fire', 'SHOOT', 'car'], ['taxi', 'end', 'END SHIFT', 'car'], ['horn', 'horn', 'HORN', 'car'], ['cam', 'cam', 'VIEW', 'car'], ['radio', 'radio', 'RADIO', 'car'],
  ['skip', 'skip', 'SKIP', 'cut'], ['pause', 'pause', '', 'top'], ['map', 'map', '', 'top'],
];

/** Whether this device should start with touch controls (phones/tablets, or ?touch=1). */
export function touchPreferred() {
  try {
    const q = new URLSearchParams(location.search).get('touch');
    if (q === '1') return true;
    if (q === '0') return false;
  } catch (e) { /* no query */ }
  try { return matchMedia('(pointer: coarse)').matches || ((navigator.maxTouchPoints || 0) > 0 && !matchMedia('(any-pointer: fine)').matches); } catch (e) { return false; }
}
export function fullscreenAvailable() { const d = document; return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled); }
export async function toggleFullscreen() {
  const d = document, el = d.documentElement;
  try {
    if (d.fullscreenElement || d.webkitFullscreenElement) { await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen && d.webkitExitFullscreen()); return false; }
    const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen();
    if (r && r.then) await r;
    // phones: keep it sideways once in fullscreen (only some browsers allow this)
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
    return true;
  } catch (e) { return false; }
}

const _d = new THREE.Vector3();

export class TouchControls {
  constructor(game, on) {
    this.game = game; this.input = game.input;
    this.preferred = on;
    this.active = false; this.mode = 'none';
    this.stick = { id: null, bx: 0, by: 0, nx: 0, ny: 0, mag: 0, far: 0, sprint: false };
    this.look = null; this.look2 = null;
    this.aimOn = false; this.runOn = false; this.aimSnapT = 0;
    this.ctxT = 0; this.rotateDismissed = false;
    this.lookSpeed = 2.6; // screen pixels -> mouse-equivalent pixels
    this._build();
    this._bind();
    this.setActive(!!on);
  }

  _build() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const root = this.root = document.createElement('div'); root.id = 'sh-touch'; root.className = 'dis off';
    const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
    const cl = { foot: '', car: '', cut: '', top: '' };
    for (const [id, icon, label, c, cls] of BTN) cl[c] += `<button class="tb ${cls || ''}" id="tb-${id}" data-b="${id}" aria-label="${label || id}">${svg(icon)}${label ? `<span>${label}</span>` : ''}</button>`;
    root.innerHTML = `<div id="sh-probe" style="position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)"></div><div id="sh-stick" class="idle"><div class="ring"></div><div class="base"></div><div class="knob"></div><div class="lbl">MOVE</div></div>
      <div class="cl" id="tc-foot">${cl.foot}</div><div class="cl gone" id="tc-car">${cl.car}</div><div class="cl gone" id="tc-cut">${cl.cut}</div><div class="cl" id="tc-top">${cl.top}</div>`;
    const ui = this.game.hud.root;
    ui.appendChild(root);
    const rot = this.rotEl = document.createElement('div'); rot.id = 'sh-rotate'; rot.className = 'gone';
    rot.innerHTML = '<div class="ph"></div><b>TURN YOUR PHONE SIDEWAYS</b><span>Sol Harbor plays best in landscape. Rotate your phone, or keep playing upright.</span><button type="button">PLAY UPRIGHT</button>';
    ui.appendChild(rot);
    rot.querySelector('button').addEventListener('click', () => { this.rotateDismissed = true; this._layout(); });
    const $ = (s) => root.querySelector(s);
    this.el = { probe: $('#sh-probe'), stick: $('#sh-stick'), base: $('#sh-stick .base'), ring: $('#sh-stick .ring'), knob: $('#sh-stick .knob'), lbl: $('#sh-stick .lbl'),
      foot: $('#tc-foot'), car: $('#tc-car'), cut: $('#tc-cut'), top: $('#tc-top') };
    this.btn = {};
    root.querySelectorAll('.tb').forEach((b) => { this.btn[b.dataset.b] = { el: b, ids: new Set(), shown: true }; });
    this.btn.fire.label = this.btn.fire.el.querySelector('span');
    this.btn.fire.svg = this.btn.fire.el.querySelector('svg');
    this.btn.car.label = this.btn.car.el.querySelector('span');
  }

  _bind() {
    const game = this.game, I = this.input, cv = game.renderer.domElement;
    cv.style.touchAction = 'none';
    // --- screen touches: left part drives the move stick, the rest looks around
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') { if (this.active && !this.preferred) this.setActive(false); return; }
      if (!this.active) this.setActive(true);
      e.preventDefault(); // also suppresses the emulated mouse events (no accidental "mouse" fire)
      if (!this._playing()) return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (e.clientX < innerWidth * (this.portrait ? 0.5 : 0.42) && this.stick.id == null && this.mode !== 'cut') this._stickStart(e);
      else if (!this.look) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }, { passive: false });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') return;
      if (e.pointerId === this.stick.id) { e.preventDefault(); this._stickMove(e.clientX, e.clientY); }
      else if (this.look && e.pointerId === this.look.id) { e.preventDefault(); this._lookMove(this.look, e.clientX, e.clientY); }
    }, { passive: false });
    const up = (e) => {
      if (e.pointerId === this.stick.id) this._stickEnd();
      if (this.look && e.pointerId === this.look.id) this.look = null;
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('lostpointercapture', up);
    // --- buttons
    for (const [id, b] of Object.entries(this.btn)) {
      const el = b.el;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!this.active) this.setActive(true);
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        const first = b.ids.size === 0;
        b.ids.add(e.pointerId); el.classList.add('down');
        if (first) this._press(id, e);
      }, { passive: false });
      el.addEventListener('pointermove', (e) => { if (this.look2 && this.look2.id === e.pointerId) { e.preventDefault(); this._lookMove(this.look2, e.clientX, e.clientY); } }, { passive: false });
      const rel = (e) => {
        if (!b.ids.delete(e.pointerId)) return;
        if (this.look2 && this.look2.id === e.pointerId) this.look2 = null;
        if (b.ids.size === 0) { el.classList.remove('down'); this._release(id); }
      };
      el.addEventListener('pointerup', rel); el.addEventListener('pointercancel', rel); el.addEventListener('lostpointercapture', rel);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.addEventListener('click', (e) => e.preventDefault());
    }
    // --- HUD pieces that become buttons on touch
    const hud = game.hud;
    hud.el.mini.addEventListener('click', () => { if (this.active && this._playing()) game.toggleMap(); });
    hud.el.wpn.addEventListener('pointerdown', (e) => { if (this.active && this._playing() && !game.player.inVehicle) { e.preventDefault(); I._wheel += 1; } });
    // --- a real touch anywhere switches a hybrid device (touchscreen laptop) to touch controls
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !this.active) this.setActive(true); }, true);
    window.addEventListener('keydown', () => { if (this.active && !this.preferred && this.game.started) this.setActive(false); }, true);
    // --- no page zoom, text selection or long-press menus while playing
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => { if (this.active) e.preventDefault(); });
    document.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
    window.addEventListener('resize', () => this._layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this._layout(), 250));
    if (window.visualViewport) visualViewport.addEventListener('resize', () => this._layout());
  }

  setActive(on) {
    if (this.active === on) return;
    this.active = on; this.input.touchMode = on;
    this.root.classList.toggle('dis', !on);
    this.game.hud.setTouch(on);
    document.body.style.webkitUserSelect = on ? 'none' : '';
    document.body.style.webkitTouchCallout = on ? 'none' : '';
    if (on) this.input.unlock();
    this._reset();
    this._layout();
  }

  _playing() { const g = this.game; return g.started && !g.paused && !g.mapOpen && !g.menuOpen; }

  _layout() {
    const w = this._lw = innerWidth, h = this._lh = innerHeight;
    this.portrait = h > w * 1.05;
    // safe areas (notches, rounded corners, home indicator)
    let sf = { l: 0, r: 0, t: 0, b: 0 };
    try { const cs = getComputedStyle(this.el.probe); sf = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 }; } catch (e) { /* no insets */ }
    this.safe = sf;
    const iv = Math.max(8, sf.t) + Math.max(10, sf.b), ih = Math.max(10, sf.l) + Math.max(10, sf.r);
    // one size unit for all controls, from compact phones up to large tablets. It also shrinks to the
    // room that is really there (Safari toolbars, in-app browsers, notches) so nothing collides:
    // sideways the right cluster must stay under the cash/clock stack (and the radio name) and the move
    // stick under the minimap column with the speedometer; upright the stick and the cluster share the
    // bottom row.
    let u = Math.min(w, h) / 390;
    if (this.portrait) u = Math.min(u, (w - ih - 6) / 370);
    else u = Math.min(u, (h - iv - 100) / 206, (h - iv - 140) / 178, (h - iv - 167) / 128);
    u = this.u = clamp(u, 0.6, 1.35);
    this.root.style.setProperty('--u', u.toFixed(3));
    this.game.hud.root.style.setProperty('--tu', u.toFixed(3));
    this.R = 52 * u;
    this.el.stick.style.setProperty('--R', this.R.toFixed(1) + 'px');
    this.rotEl.classList.toggle('gone', !(this.active && this.portrait && !this.rotateDismissed));
    if (this.stick.id == null) this._stickIdle();
  }

  // ------------------------------------------------------------------ move stick
  _stickHome() {
    const R = this.R, u = this.u || 1, sf = this.safe || { l: 0, b: 0 };
    return { x: Math.max(10, sf.l) + R + 20 * u, y: innerHeight - Math.max(10, sf.b) - R - 24 * u };
  }
  _stickIdle() {
    const s = this.stick, h = this._stickHome();
    s.bx = h.x; s.by = h.y; s.nx = 0; s.ny = 0; s.mag = 0; s.far = 0; s.sprint = false;
    this._drawStick(0, 0);
    this.el.stick.classList.add('idle'); this.el.stick.classList.remove('sprint');
  }
  _stickStart(e) {
    const s = this.stick, R = this.R;
    s.id = e.pointerId;
    s.bx = clamp(e.clientX, R + 10, innerWidth * 0.5); s.by = clamp(e.clientY, R + 10, innerHeight - R - 10);
    this.el.stick.classList.remove('idle');
    this._stickMove(e.clientX, e.clientY);
  }
  _stickMove(x, y) {
    const s = this.stick, R = this.R;
    let dx = x - s.bx, dy = y - s.by, d = Math.hypot(dx, dy);
    // the base trails a finger that drifts far out, so reversing direction always stays quick
    const far = R * 1.9;
    if (d > far) { const f = (d - far) / d; s.bx += dx * f; s.by += dy * f; dx = x - s.bx; dy = y - s.by; d = far; }
    s.far = d / R; s.mag = Math.min(1, d / R);
    s.nx = d > 1e-3 ? dx / d : 0; s.ny = d > 1e-3 ? dy / d : 0;
    // push well past the ring to sprint (with hysteresis so it does not flicker)
    if (s.far > 1.45) s.sprint = true; else if (s.far < 1.18) s.sprint = false;
    this.el.stick.classList.toggle('sprint', s.sprint && this.mode === 'foot');
    const k = Math.min(d, R);
    this._drawStick(s.nx * k, s.ny * k);
  }
  _stickEnd() { this.stick.id = null; this.runOn = false; this._stickIdle(); }
  _drawStick(kx, ky) {
    const s = this.stick, e = this.el;
    const t = `translate(${s.bx.toFixed(1)}px,${s.by.toFixed(1)}px)`;
    e.base.style.transform = `${t} translate(-50%,-50%)`;
    e.ring.style.transform = `${t} translate(-50%,-50%)`;
    e.knob.style.transform = `translate(${(s.bx + kx).toFixed(1)}px,${(s.by + ky).toFixed(1)}px) translate(-50%,-50%)`;
    e.lbl.style.transform = `translate(${s.bx.toFixed(1)}px,${(s.by + this.R + 6).toFixed(1)}px) translate(-50%,0)`;
  }

  // ------------------------------------------------------------------ look
  _lookMove(L, x, y) {
    const dx = x - L.x, dy = y - L.y; L.x = x; L.y = y;
    const k = this.lookSpeed * (this.game.player.aiming ? 0.55 : 1);
    this.input.vLook(dx * k, dy * k * 0.85);
  }

  // ------------------------------------------------------------------ buttons
  _press(id, e) {
    const I = this.input, g = this.game, P = g.player;
    switch (id) {
      case 'fire': I.vSet('fire', true); this.look2 = { id: e.pointerId, x: e.clientX, y: e.clientY }; break;
      case 'aim': this.aimOn = !this.aimOn; this.aimSnapT = this.aimOn ? 0.35 : 0; break;
      case 'jump': I.vTap('jump'); break;
      case 'run': this.runOn = !this.runOn; break;
      case 'car': case 'exit': I.vTap('enter'); break;
      case 'wpn': I._wheel += 1; break;
      case 'rld': I.vTap('reload'); break;
      case 'hb': I.vSet('handbrake', true); break;
      case 'horn': I.vSet('horn', true); break;
      case 'cam': I.vTap('camera'); break;
      case 'radio': I.vTap('radioNext'); break;
      case 'taxi': I.vTap('mission'); break;
      case 'skip': I.vTap('interact'); break;
      case 'dby': {
        if (P.weapon !== 'pistol' && P.weapon !== 'smg') P.selectWeapon(P.hasWeapon('smg') ? 'smg' : 'pistol');
        I.vSet('aim', true); I.vSet('fire', true); this.look2 = { id: e.pointerId, x: e.clientX, y: e.clientY }; this.aimSnapT = 0.35; break;
      }
      case 'pause': if (this._playing()) g.setPaused(true); break;
      case 'map': if (g.started && !g.paused && !g.menuOpen) g.toggleMap(); break;
    }
    if (id === 'aim' || id === 'run') this.btn[id].el.classList.toggle('on', id === 'aim' ? this.aimOn : this.runOn);
  }
  _release(id) {
    const I = this.input;
    switch (id) {
      case 'fire': I.vSet('fire', false); break;
      case 'hb': I.vSet('handbrake', false); break;
      case 'horn': I.vSet('horn', false); break;
      case 'dby': I.vSet('aim', false); I.vSet('fire', false); break;
    }
  }
  _held(id) { return this.btn[id].ids.size > 0; }

  _reset() {
    const I = this.input;
    I.vClear();
    for (const b of Object.values(this.btn)) { b.ids.clear(); b.el.classList.remove('down', 'on'); }
    this.stick.id = null; this.look = null; this.look2 = null;
    this.aimOn = false; this.runOn = false;
    if (this.R) this._stickIdle();
  }
  _setMode(m) {
    const prev = this.mode; this.mode = m;
    // anything held in the old layout is let go (its buttons disappear)
    const keepStick = this.stick.id;
    for (const [id, b] of Object.entries(this.btn)) if (b.ids.size && !(id === 'pause' || id === 'map')) { b.ids.clear(); b.el.classList.remove('down'); this._release(id); }
    this.aimOn = false; this.runOn = false; this.btn.aim.el.classList.remove('on'); this.btn.run.el.classList.remove('on');
    this.input.vSet('aim', false); this.input.vSet('fire', false); this.input.vSet('sprint', false);
    if (m === 'none') { this.input.vClear(); this.stick.id = null; this.look = null; this.look2 = null; this._stickIdle(); }
    else if (keepStick == null) this._stickIdle();
    this.el.foot.classList.toggle('gone', m !== 'foot');
    this.el.car.classList.toggle('gone', m !== 'car');
    this.el.cut.classList.toggle('gone', m !== 'cut');
    this.el.stick.style.display = m === 'foot' || m === 'car' ? '' : 'none';
    this.el.lbl.textContent = m === 'car' ? 'STEER' : 'MOVE';
    this.ctxT = 0;
    return prev;
  }
  _show(id, on) { const b = this.btn[id]; if (b.shown !== on) { b.shown = on; b.el.classList.toggle('gone', !on); } }

  /** Per frame, before Input.poll(): turn stick and button state into actions and axes. */
  update(dt) {
    if (!this.active) return;
    if (innerWidth !== this._lw || innerHeight !== this._lh) this._layout();
    const g = this.game, P = g.player, I = this.input, A = I.vAxes;
    const playing = this._playing();
    this.root.classList.toggle('off', !playing);
    const mode = !playing ? 'none' : g.missions.cutscene ? 'cut' : (P.inVehicle && P.vehicle) ? 'car' : 'foot';
    if (mode !== this.mode) this._setMode(mode);
    A.moveX = A.moveY = A.steer = A.throttle = A.brake = 0;
    const s = this.stick;
    if (mode === 'foot') {
      const m = clamp((s.mag - 0.14) / 0.74, 0, 1);
      A.moveX = s.nx * m; A.moveY = -s.ny * m;
      I.vSet('sprint', (this.runOn || s.sprint) && m > 0.2);
      if (!P.alive) { this.aimOn = false; }
      I.vSet('aim', this.aimOn);
      if (this.btn.run.el.classList.contains('on') !== this.runOn) this.btn.run.el.classList.toggle('on', this.runOn);
      if (this.btn.aim.el.classList.contains('on') !== this.aimOn) this.btn.aim.el.classList.toggle('on', this.aimOn);
    } else if (mode === 'car') {
      const hx = s.nx * s.mag, vy = -s.ny * s.mag;
      const st = clamp((Math.abs(hx) - 0.08) / 0.84, 0, 1);
      A.steer = -Math.sign(hx) * Math.pow(st, 1.25);
      A.throttle = Math.max(this._held('gas') ? 1 : 0, clamp((vy - 0.5) / 0.4, 0, 1));
      A.brake = Math.max(this._held('brk') ? 1 : 0, clamp((-vy - 0.5) / 0.4, 0, 1));
    }
    this.aimSnapT = Math.max(0, this.aimSnapT - dt);
    // context-sensitive buttons, a few times a second
    this.ctxT -= dt;
    if (this.ctxT <= 0 && (mode === 'foot' || mode === 'car')) { this.ctxT = 0.15; this._context(mode); }
  }
  _context(mode) {
    const g = this.game, P = g.player, W = WEAPONS[P.weapon];
    if (mode === 'foot') {
      const near = this._nearCar();
      this._show('car', near < 6);
      this.btn.car.el.classList.toggle('hint', near < 3);
      const guns = P.owned.size > 0;
      this._show('wpn', guns);
      this._show('rld', !W.melee && (P.clip[P.weapon] ?? 0) < W.clip && (P.ammo[P.weapon] ?? 0) > 0 && P.reloadT <= 0);
      const melee = !!W.melee, f = this.btn.fire;
      if (f.melee !== melee) { f.melee = melee; f.label.textContent = melee ? 'PUNCH' : 'FIRE'; f.svg.innerHTML = melee ? ICON.fist : ICON.fire; }
    } else {
      const driver = P.seatSide === 1;
      for (const id of ['gas', 'brk', 'hb', 'horn', 'cam', 'radio']) this._show(id, driver);
      this._show('dby', driver && (P.hasWeapon('pistol') || P.hasWeapon('smg')));
      this._show('taxi', !!(g.missions.def && g.missions.def.id === 'taxi'));
    }
  }
  _nearCar() {
    const P = this.game.player; let best = 1e9;
    for (const v of this.game.vehicles.list) {
      if (v.exploded || v.spec.class === 'heli') continue;
      const d = Math.hypot(v.com.x - P.pos.x, v.com.z - P.pos.z) - Math.max(v.spec.L || 4, 2) * 0.5;
      if (d < best && Math.abs(v.com.y - P.pos.y) < 3) best = d;
    }
    return best;
  }

  /** Aim assist while aiming or firing on touch: ease the camera onto the nearest threat near the crosshair. */
  assist(dt) {
    if (!this.active || this.mode === 'none' || this.mode === 'cut') return;
    const g = this.game, P = g.player, I = this.input;
    if (!P.alive || WEAPONS[P.weapon].melee) return;
    const aiming = I.down('aim'), firing = I.down('fire');
    if (!aiming && !firing) return;
    const cam = g.camera, c = cam.camera;
    c.getWorldDirection(_d);
    const ay = Math.atan2(_d.x, _d.z), ap = Math.asin(clamp(_d.y, -1, 1));
    const snap = this.aimSnapT > 0;
    const cone = snap ? 0.55 : aiming ? 0.3 : 0.16;
    const heat = g.heat.level > 0;
    const cands = [];
    for (const a of g.actors()) {
      if (a === P || !a.alive || a.removed || !(a.isHostile || (heat && a.isCop))) continue;
      const t = a.chest;
      const dx = t.x - c.position.x, dy = t.y - 0.1 - c.position.y, dz = t.z - c.position.z;
      const hd = Math.hypot(dx, dz), dist = Math.hypot(hd, dy);
      if (dist > 60 || dist < 1.5) continue;
      const ey = wrapAngle(Math.atan2(dx, dz) - ay), ep = Math.atan2(dy, hd) - ap;
      const err = Math.hypot(ey, ep);
      if (err > cone) continue;
      cands.push({ ey, ep, s: err + dist * 0.004, x: t.x, y: t.y, z: t.z });
    }
    if (!cands.length) return;
    cands.sort((a, b) => a.s - b.s);
    const col = g.city.collision, o = c.position;
    for (let i = 0; i < Math.min(2, cands.length); i++) {
      const t = cands[i];
      if (col.lineOfSight && !col.lineOfSight(o.x, o.y, o.z, t.x, t.y, t.z, LOS_IGNORE)) continue;
      const rate = snap ? 14 : aiming ? 6 : 3.5;
      const k = 1 - Math.exp(-rate * dt);
      cam.yaw += t.ey * k;
      cam.pitch = clamp(cam.pitch - t.ep * k, -1.1, 1.3);
      return;
    }
  }
}
const LOS_IGNORE = new Set(['breakable', 'prop', 'fence', 'rail', 'curb', 'piling']);
