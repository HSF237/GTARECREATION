// Input: keyboard + mouse (pointer lock) + gamepad + touch (virtual device fed by ui/touch.js), mapped to game actions.
//   const input = new Input(canvas); input.poll() once at the start of each frame
//   input.down(action) / pressed(action) (edge) / released(action); input.axis('moveX'|'moveY'|'steer'|'throttle'|'brake');
//   input.mouseDX/mouseDY (accumulated since last update), wheel; input.lock() / unlock(); input.locked
export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], handbrake: ['Space'], enter: ['KeyF', 'Enter'], reload: ['KeyR'],
  aim: ['Mouse2'], fire: ['Mouse0'], horn: ['KeyH'], lookBehind: ['KeyC'], camera: ['KeyV'], map: ['KeyM'], pause: ['Escape', 'KeyP'],
  radioNext: ['KeyE'], radioPrev: ['KeyQ'], weaponNext: ['Digit0'], weapon1: ['Digit1'], weapon2: ['Digit2'], weapon3: ['Digit3'], weapon4: ['Digit4'], weapon5: ['Digit5'],
  crouch: ['ControlLeft'], mission: ['KeyT'], lights: ['KeyL'], phone: ['Tab'], interact: ['KeyE'], walk: ['AltLeft'],
};
export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set(); this.prev = new Set(); this.now = new Set();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; this._dx = 0; this._dy = 0; this._wheel = 0;
    this.locked = false; this.enabled = true; this.sens = 1; this.invertY = false;
    this.gamepad = null; this.padButtons = new Set(); this.padPrev = new Set();
    this.lastDevice = 'kbm';
    this.onKey = null;
    // virtual device (touch controls): held actions, one-frame taps and analog axes
    this.touchMode = false;
    this.vHeld = new Set(); this.vTaps = new Set(); this.vNow = new Set(); this.vPrev = new Set();
    this.vAxes = { moveX: 0, moveY: 0, steer: 0, throttle: 0, brake: 0 };
    const kd = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.lastDevice = 'kbm';
      if (this.onKey) this.onKey(e);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab', 'AltLeft', 'KeyF'].includes(e.code) && this.enabled) e.preventDefault();
    };
    const ku = (e) => { this.keys.delete(e.code); };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousedown', (e) => { this.keys.add('Mouse' + e.button); this.lastDevice = 'kbm'; });
    window.addEventListener('mouseup', (e) => this.keys.delete('Mouse' + e.button));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => { if (this.locked || (!this.locked && (e.buttons & 2) && this.enabled)) { this._dx += e.movementX; this._dy += e.movementY; } });
    el.addEventListener('wheel', (e) => { this._wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
  }
  lock() { if (this.touchMode) return; if (!this.locked && this.el.requestPointerLock) { try { const p = this.el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* not allowed */ } } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  /** Touch: hold or release a virtual action (a tap is guaranteed to register for at least one frame). */
  vSet(action, on) {
    if (on) { if (!this.vHeld.has(action)) this.vTaps.add(action); this.vHeld.add(action); } else this.vHeld.delete(action);
    this.lastDevice = 'touch';
  }
  /** Touch: a one-frame press of an action. */
  vTap(action) { this.vTaps.add(action); this.lastDevice = 'touch'; }
  /** Touch: camera look in screen pixels (scaled like mouse movement). */
  vLook(dx, dy) { this._dx += dx; this._dy += dy; }
  vClear() { this.vHeld.clear(); this.vTaps.clear(); for (const k in this.vAxes) this.vAxes[k] = 0; }
  /** Call once at the start of each frame. */
  poll() {
    this.prev = this.now; this.now = new Set(this.keys);
    this.vPrev = this.vNow; this.vNow = new Set(this.vHeld);
    for (const a of this.vTaps) this.vNow.add(a);
    this.vTaps.clear();
    this.mouseDX = this._dx * this.sens; this.mouseDY = this._dy * this.sens * (this.invertY ? -1 : 1); this.wheel = this._wheel;
    this._dx = 0; this._dy = 0; this._wheel = 0;
    // gamepad
    // Gamepads: the API can be blocked by the page's permissions policy (e.g. inside a sandboxed frame) and throw.
    let pads = [];
    if (this.padsAllowed !== false && navigator.getGamepads) {
      try { pads = navigator.getGamepads() || []; } catch (e) { this.padsAllowed = false; pads = []; }
    }
    this.gamepad = null;
    for (const p of pads) if (p && p.connected) { this.gamepad = p; break; }
    this.padPrev = this.padButtons; this.padButtons = new Set();
    if (this.gamepad) {
      const g = this.gamepad;
      g.buttons.forEach((b, i) => { if (b.pressed) this.padButtons.add(i); });
      if (this.padButtons.size) this.lastDevice = 'pad';
      const lx = dz(g.axes[2] || 0), ly = dz(g.axes[3] || 0);
      this.mouseDX += lx * 14 * this.sens; this.mouseDY += ly * 10 * this.sens * (this.invertY ? -1 : 1);
    }
  }
  _pad(action) {
    const P = { jump: [0], handbrake: [5], enter: [3], reload: [2], aim: [6], fire: [7], horn: [10], lookBehind: [11], camera: [8], map: [8], pause: [9], radioNext: [15], radioPrev: [14], weaponNext: [5], sprint: [0], mission: [12] };
    return P[action] || [];
  }
  down(action) {
    if (!this.enabled) return false;
    if (this.vNow.has(action)) return true;
    for (const k of BINDINGS[action] || []) if (this.now.has(k)) return true;
    if (this.gamepad) {
      for (const b of this._pad(action)) if (this.padButtons.has(b)) return true;
      if (action === 'aim' && (this.gamepad.buttons[6]?.value || 0) > 0.3) return true;
      if (action === 'fire' && (this.gamepad.buttons[7]?.value || 0) > 0.3) return true;
    }
    return false;
  }
  pressed(action) {
    if (!this.enabled) return false;
    if (this.vNow.has(action) && !this.vPrev.has(action)) return true;
    for (const k of BINDINGS[action] || []) if (this.now.has(k) && !this.prev.has(k)) return true;
    if (this.gamepad) for (const b of this._pad(action)) if (this.padButtons.has(b) && !this.padPrev.has(b)) return true;
    return false;
  }
  released(action) {
    if (!this.vNow.has(action) && this.vPrev.has(action)) return true;
    for (const k of BINDINGS[action] || []) if (!this.now.has(k) && this.prev.has(k)) return true;
    return false;
  }
  axis(name) {
    if (!this.enabled) return 0;
    const g = this.gamepad, v = this.vAxes;
    switch (name) {
      case 'moveX': return (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0) + (g ? dz(g.axes[0]) : 0) + v.moveX;
      case 'moveY': return (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0) - (g ? dz(g.axes[1]) : 0) + v.moveY;
      case 'steer': return Math.max(-1, Math.min(1, (this.down('left') ? 1 : 0) - (this.down('right') ? 1 : 0) - (g ? dz(g.axes[0]) : 0) + v.steer));
      case 'throttle': return Math.max(this.down('forward') ? 1 : 0, g ? (g.buttons[7]?.value || 0) : 0, v.throttle);
      case 'brake': return Math.max(this.down('back') ? 1 : 0, g ? (g.buttons[6]?.value || 0) : 0, v.brake);
    }
    return 0;
  }
}
function dz(v) { return Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85; }
