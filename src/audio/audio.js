// Audio: fully synthesized with Web Audio (no audio files). One-shot SFX from generated buffers,
// continuous voices (engines, sirens, horns, tire screech), ambience beds, and generative radio.
import { clamp, lerp } from '../core/math.js';
import { RadioStations } from './radio.js';

const TAU = Math.PI * 2;
const rand = (a = -1, b = 1) => a + Math.random() * (b - a);

/** Offline buffer synthesis helpers. */
function makeBuffer(ctx, dur, fn, channels = 1) {
  const sr = ctx.sampleRate, n = Math.max(1, Math.floor(dur * sr));
  const b = ctx.createBuffer(channels, n, sr);
  for (let c = 0; c < channels; c++) { const d = b.getChannelData(c); fn(d, sr, c); }
  return b;
}
function onePoleLP(x, cutoff, sr) { const a = Math.exp(-TAU * cutoff / sr); let y = 0; for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; x[i] = y; } return x; }
function onePoleHP(x, cutoff, sr) { const a = Math.exp(-TAU * cutoff / sr); let y = 0, px = 0; for (let i = 0; i < x.length; i++) { const v = x[i]; y = a * (y + v - px); px = v; x[i] = y; } return x; }
function normalize(d, peak = 0.9) { let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); if (m > 0) { const k = peak / m; for (let i = 0; i < d.length; i++) d[i] *= k; } return d; }

function gunBuffer(ctx, kind) {
  const P = { pistol: [0.45, 1800, 28, 95, 0.9], smg: [0.28, 2400, 40, 120, 0.6], shotgun: [0.8, 1100, 16, 70, 1.3], rifle: [0.6, 2800, 30, 90, 1.0], heli: [0.5, 2200, 30, 80, 0.9] }[kind] || [0.4, 1800, 28, 95, 0.9];
  const [dur, lp, dec, boom, tail] = P;
  return makeBuffer(ctx, dur, (d, sr) => {
    const n = new Float32Array(d.length); for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    const body = onePoleLP(Float32Array.from(n), lp, sr);
    const crack = onePoleHP(Float32Array.from(n), 3000, sr);
    const echo = onePoleLP(Float32Array.from(n), 600, sr);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const f = boom * Math.exp(-t * 14) + 40;
      d[i] = body[i] * Math.exp(-t * dec) * 1.2 + crack[i] * Math.exp(-t * 180) * 0.9 + Math.sin(TAU * f * t) * Math.exp(-t * 20) * 1.1 + echo[i] * Math.exp(-t * 5) * 0.25 * tail * Math.min(1, t * 30);
    }
    normalize(d, 0.95);
  });
}
function noiseBuffer(ctx, dur, type = 'white', loop = true) {
  return makeBuffer(ctx, dur, (d, sr) => {
    let b = 0, p0 = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'brown') { b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; }
      else if (type === 'pink') { p0 = 0.997 * p0 + 0.029591 * w; p1 = 0.985 * p1 + 0.032534 * w; p2 = 0.95 * p2 + 0.048056 * w; d[i] = (p0 + p1 + p2 + w * 0.05) * 0.8; }
      else d[i] = w;
    }
    if (loop) { const f = Math.floor(sr * 0.05); for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[d.length - f + i] * (1 - k); } }
  });
}
function explosionBuffer(ctx) {
  return makeBuffer(ctx, 3.2, (d, sr) => {
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr; const w = Math.random() * 2 - 1; b = (b + 0.035 * w) / 1.035;
      const env = Math.min(1, t * 80) * Math.exp(-t * 1.6);
      d[i] = b * 7 * env + Math.sin(TAU * (38 + 30 * Math.exp(-t * 6)) * t) * Math.exp(-t * 3) * 0.9 + w * Math.exp(-t * 18) * 0.5;
    }
    normalize(d, 0.98);
  });
}
function crashBuffer(ctx, heavy) {
  return makeBuffer(ctx, heavy ? 1.1 : 0.6, (d, sr) => {
    const partials = []; for (let k = 0; k < 7; k++) partials.push([rand(250, 2400), rand(4, 14), rand(0.1, 0.35)]);
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr, w = Math.random() * 2 - 1; b = (b + 0.08 * w) / 1.08;
      let s = b * 4 * Math.exp(-t * (heavy ? 5 : 9)) + w * Math.exp(-t * 40) * 0.6 + Math.sin(TAU * 60 * t) * Math.exp(-t * 12) * (heavy ? 0.9 : 0.5);
      for (const [f, dcy, a] of partials) s += Math.sin(TAU * f * t) * Math.exp(-t * dcy) * a;
      d[i] = s;
    }
    normalize(d, 0.9);
  });
}
function glassBuffer(ctx) {
  return makeBuffer(ctx, 0.9, (d, sr) => {
    const pings = []; for (let k = 0; k < 18; k++) pings.push([rand(2000, 7000), rand(0, 0.35), rand(20, 50)]);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr; let s = (Math.random() * 2 - 1) * Math.exp(-t * 25) * 0.4;
      for (const [f, t0, dcy] of pings) if (t > t0) s += Math.sin(TAU * f * (t - t0)) * Math.exp(-(t - t0) * dcy) * 0.25;
      d[i] = s;
    }
    onePoleHP(d, 1500, sr); normalize(d, 0.7);
  });
}
function thudBuffer(ctx, f0 = 90, dur = 0.18, noise = 0.5) {
  return makeBuffer(ctx, dur, (d, sr) => {
    for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(TAU * (f0 * Math.exp(-t * 8)) * t) * Math.exp(-t * 22) + (Math.random() * 2 - 1) * Math.exp(-t * 60) * noise; }
    normalize(d, 0.9);
  });
}
function stepBuffer(ctx, bright) {
  return makeBuffer(ctx, 0.09, (d, sr) => {
    for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 55) + Math.sin(TAU * 110 * t) * Math.exp(-t * 60) * 0.5; }
    onePoleLP(d, bright ? 2600 : 900, sr); normalize(d, 0.8);
  });
}
function clickBuffer(ctx, f = 1800) { return makeBuffer(ctx, 0.05, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(TAU * f * t) * Math.exp(-t * 90) + (Math.random() * 2 - 1) * Math.exp(-t * 200) * 0.4; } }); }
function splashBuffer(ctx) {
  return makeBuffer(ctx, 1.0, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = (Math.random() * 2 - 1) * Math.min(1, t * 40) * Math.exp(-t * 4.5); } onePoleLP(d, 1800, sr); onePoleHP(d, 200, sr); normalize(d, 0.8); });
}

// engine timbres (original synth patches)
const ENGINES = {
  compact: { cyl: 4, lp: 1.4, type: 'sawtooth', sub: 0.35, gain: 0.5, noise: 0.25 },
  sedan: { cyl: 6, lp: 1.1, type: 'sawtooth', sub: 0.45, gain: 0.55, noise: 0.2 },
  muscle: { cyl: 8, lp: 0.75, type: 'square', sub: 0.8, gain: 0.7, noise: 0.25, rumble: 1 },
  sports: { cyl: 6, lp: 1.8, type: 'sawtooth', sub: 0.4, gain: 0.6, noise: 0.3 },
  super: { cyl: 10, lp: 2.4, type: 'sawtooth', sub: 0.3, gain: 0.62, noise: 0.35 },
  suv: { cyl: 6, lp: 0.9, type: 'sawtooth', sub: 0.55, gain: 0.55, noise: 0.2 },
  van: { cyl: 4, lp: 0.8, type: 'square', sub: 0.6, gain: 0.5, noise: 0.25 },
  truck: { cyl: 6, lp: 0.55, type: 'square', sub: 0.9, gain: 0.7, noise: 0.35, diesel: 1 },
  bus: { cyl: 6, lp: 0.5, type: 'square', sub: 0.9, gain: 0.7, noise: 0.35, diesel: 1 },
};

export class AudioSystem {
  constructor(game) {
    this.game = game; this.ctx = null; this.ready = false; this.muted = false;
    this.volume = { master: 0.9, sfx: 0.9, music: 0.55 };
    this.voices = []; this.engineVoices = []; this.sirenVoices = []; this.hornVoices = [];
    this.stepT = 0; this.birdT = 3; this.cricketT = 2; this.radioIndex = 0; this.radioOn = true;
  }
  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; return; }
    const ctx = this.ctx;
    // phones (iOS especially) only unlock audio inside the tap that started it: resume and play one silent sample now
    try { if (ctx.state === 'suspended') ctx.resume(); const sb = ctx.createBufferSource(); sb.buffer = ctx.createBuffer(1, 1, 22050); sb.connect(ctx.destination); sb.start(0); } catch (e) { /* ignore */ }
    this.master = ctx.createGain(); this.master.gain.value = this.volume.master;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.volume.sfx; this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.6; this.amb.connect(this.master);
    this.eng = ctx.createGain(); this.eng.gain.value = 0.55; this.eng.connect(this.master);
    // radio bus: slightly boxy car-speaker EQ
    this.music = ctx.createGain(); this.music.gain.value = 0;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000;
    this.music.connect(hp).connect(lp).connect(this.master);
    this.radioOut = ctx.createGain(); this.radioOut.gain.value = this.volume.music; this.radioOut.connect(this.music);
    // buffers
    this.buf = {
      pistol: gunBuffer(ctx, 'pistol'), smg: gunBuffer(ctx, 'smg'), shotgun: gunBuffer(ctx, 'shotgun'), rifle: gunBuffer(ctx, 'rifle'),
      explosion: explosionBuffer(ctx), crash: crashBuffer(ctx, false), crashHeavy: crashBuffer(ctx, true), glass: glassBuffer(ctx),
      punch: thudBuffer(ctx, 120, 0.16, 0.6), thud: thudBuffer(ctx, 70, 0.3, 0.3), body: thudBuffer(ctx, 55, 0.35, 0.4),
      step: [stepBuffer(ctx, false), stepBuffer(ctx, true), stepBuffer(ctx, false)], click: clickBuffer(ctx, 1800), clickLo: clickBuffer(ctx, 700),
      splash: splashBuffer(ctx), white: noiseBuffer(ctx, 2, 'white'), pink: noiseBuffer(ctx, 3, 'pink'), brown: noiseBuffer(ctx, 4, 'brown'),
      ricochet: makeBuffer(ctx, 0.35, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(TAU * (3200 - t * 5000) * t) * Math.exp(-t * 12) * 0.6 + (Math.random() * 2 - 1) * Math.exp(-t * 80) * 0.5; } }),
      bulletMetal: makeBuffer(ctx, 0.25, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = (Math.sin(TAU * 1450 * t) * 0.5 + Math.sin(TAU * 2230 * t) * 0.35) * Math.exp(-t * 22) + (Math.random() * 2 - 1) * Math.exp(-t * 90) * 0.6; } }),
    };
    // ambience beds
    this.bed = {
      city: this._loop(this.buf.brown, 'lowpass', 500, 0), sea: this._loop(this.buf.pink, 'lowpass', 900, 0), wind: this._loop(this.buf.pink, 'bandpass', 700, 0),
      rain: this._loop(this.buf.white, 'highpass', 2500, 0), screech: this._loop(this.buf.white, 'bandpass', 2400, 0, this.sfx), road: this._loop(this.buf.brown, 'lowpass', 300, 0, this.eng),
    };
    this.bed.screech.f.Q.value = 6; this.bed.wind.f.Q.value = 0.7;
    for (let i = 0; i < 5; i++) this.engineVoices.push(this._engineVoice());
    for (let i = 0; i < 2; i++) this.sirenVoices.push(this._sirenVoice());
    for (let i = 0; i < 3; i++) this.hornVoices.push(this._hornVoice());
    this.radio = new RadioStations(ctx, this.radioOut);
    this._bind();
    this.ready = true;
  }
  _loop(buffer, ftype, freq, gain, bus = this.amb) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = ftype; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = gain;
    const p = ctx.createStereoPanner();
    s.connect(f).connect(g).connect(p).connect(bus); s.start(0, Math.random() * buffer.duration);
    return { s, f, g, p };
  }
  _engineVoice() {
    const ctx = this.ctx;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'sine';
    const n = ctx.createBufferSource(); n.buffer = this.buf.white; n.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 800; nf.Q.value = 1.2;
    const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain(), gn = ctx.createGain();
    g1.gain.value = 0.3; g2.gain.value = 0.2; g3.gain.value = 0.3; gn.gain.value = 0.1;
    const shaper = ctx.createWaveShaper(); const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 2.2); } shaper.curve = curve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 2;
    const out = ctx.createGain(); out.gain.value = 0;
    const pan = ctx.createStereoPanner();
    // amplitude "firing" modulation for rumble
    const am = ctx.createOscillator(); am.type = 'sine'; const amg = ctx.createGain(); amg.gain.value = 0.0;
    am.connect(amg).connect(out.gain);
    o1.connect(g1).connect(shaper); o2.connect(g2).connect(shaper); o3.connect(g3).connect(shaper); n.connect(nf).connect(gn).connect(shaper);
    shaper.connect(lp).connect(out).connect(pan).connect(this.eng);
    for (const o of [o1, o2, o3, am]) o.start(); n.start();
    return { o1, o2, o3, n, nf, g1, g2, g3, gn, lp, out, pan, am, amg, v: null, level: 0 };
  }
  _sirenVoice() {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400;
    const g = ctx.createGain(); g.gain.value = 0; const p = ctx.createStereoPanner();
    const g2 = ctx.createGain(); g2.gain.value = 0.3;
    o.connect(f); o2.connect(g2).connect(f); f.connect(g).connect(p).connect(this.sfx); o.start(); o2.start();
    return { o, o2, g, p, v: null, phase: Math.random() * 10 };
  }
  _hornVoice() {
    const ctx = this.ctx;
    const a = ctx.createOscillator(), b = ctx.createOscillator(); a.type = 'square'; b.type = 'square';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500;
    const g = ctx.createGain(); g.gain.value = 0; const p = ctx.createStereoPanner();
    const ga = ctx.createGain(); ga.gain.value = 0.2; const gb = ctx.createGain(); gb.gain.value = 0.2;
    a.connect(ga).connect(f); b.connect(gb).connect(f); f.connect(g).connect(p).connect(this.sfx); a.start(); b.start();
    return { a, b, g, p, v: null };
  }

  // ------------------------------------------------------------------ helpers
  _listener() { return this.game.camera.camera; }
  /** gain/pan for a world position relative to the camera. */
  _spatial(pos, ref = 12, max = 250) {
    const cam = this._listener(), cp = cam.position;
    const dx = pos.x - cp.x, dy = pos.y - cp.y, dz = pos.z - cp.z, d = Math.hypot(dx, dy, dz);
    if (d > max) return null;
    const e = cam.matrixWorld.elements; // right vector = column 0
    const rx = e[0], rz = e[2];
    const pan = d > 0.5 ? clamp((dx * rx + dz * rz) / d, -1, 1) * 0.85 : 0;
    const gain = ref / (ref + Math.max(0, d - 1)) * clamp(1 - d / max, 0, 1) ** 0.5;
    return { gain, pan, d };
  }
  play(name, pos = null, o = {}) {
    if (!this.ready || this.muted) return;
    let b = this.buf[name]; if (Array.isArray(b)) b = b[(Math.random() * b.length) | 0];
    if (!b) return;
    let gain = o.vol ?? 1, pan = 0;
    if (pos) { const s = this._spatial(pos, o.ref ?? 14, o.max ?? 260); if (!s) return; gain *= s.gain; pan = s.pan; }
    if (gain < 0.01) return;
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = b;
    src.playbackRate.value = (o.rate ?? 1) * (1 + rand(-1, 1) * (o.var ?? 0.05));
    const g = ctx.createGain(); g.gain.value = gain;
    let node = src.connect(g);
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node = node.connect(f); }
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    node.connect(p).connect(o.bus || this.sfx);
    src.start(ctx.currentTime + (o.delay || 0));
    // distant sounds arrive later and duller
  }
  tone(freqs, dur = 0.12, type = 'sine', vol = 0.25, gap = 0.09) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ctx.createGain(); const t = t0 + i * gap;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
    });
  }
  jingle(kind) {
    if (kind === 'pass') { this.tone([523, 659, 784, 1047], 0.35, 'triangle', 0.22, 0.11); this.tone([262, 330, 392], 0.9, 'sine', 0.12, 0.0); }
    else if (kind === 'fail') this.tone([392, 330, 262, 196], 0.4, 'triangle', 0.2, 0.16);
    else if (kind === 'cash') this.tone([1319, 1760], 0.12, 'square', 0.07, 0.07);
    else if (kind === 'check') this.tone([880, 1320], 0.15, 'triangle', 0.18, 0.08);
    else if (kind === 'heat') this.tone([740, 554], 0.18, 'square', 0.08, 0.14);
    else if (kind === 'pickup') this.tone([660, 990, 1320], 0.1, 'triangle', 0.15, 0.05);
    else if (kind === 'ui') this.tone([1200], 0.05, 'square', 0.05);
    else if (kind === 'start') { this.tone([392, 523, 659], 0.5, 'triangle', 0.16, 0.12); }
  }

  // ------------------------------------------------------------------ event wiring
  _bind() {
    const ev = this.game.events, P = () => this.game.player;
    ev.on('gunshot', (e) => { const heli = !e.shooter || !e.shooter.rig; this.play(heli ? 'rifle' : e.weapon, e.position, { vol: e.shooter && e.shooter.isPlayer ? 0.85 : 0.75, ref: 30, max: 450, var: 0.07 }); });
    ev.on('explosionFx', (e) => { this.play('explosion', e.position, { vol: 1.3, ref: 60, max: 900, var: 0.1 }); this.play('glass', e.position, { vol: 0.5, ref: 20, delay: 0.1 }); });
    ev.on('vehicleCrash', (e) => { this.play(e.impact > 12 ? 'crashHeavy' : 'crash', e.position, { vol: clamp(e.impact / 14, 0.25, 1.3), ref: 20 }); if (e.impact > 9) this.play('glass', e.position, { vol: 0.45, ref: 15 }); });
    ev.on('vehicleImpact', (e) => { if (e.speed > 4) this.play(e.speed > 12 ? 'crashHeavy' : 'crash', e.point, { vol: clamp(e.speed / 16, 0.2, 1.1), ref: 18 }); });
    ev.on('propBroken', (e) => { this.play(e.kind === 'hydrant' || e.kind === 'lamp' || e.kind === 'meter' ? 'crash' : 'thud', e.position, { vol: 0.7, ref: 15, rate: 1.2 }); });
    ev.on('pedHit', (e) => { this.play('body', e.actor.pos, { vol: clamp(e.speed / 10, 0.4, 1.2), ref: 14 }); });
    ev.on('punchHit', (e) => this.play('punch', e.target.pos, { vol: 0.8, ref: 10 }));
    ev.on('punch', (e) => this.play('clickLo', e.actor.pos, { vol: 0.15, rate: 0.6 }));
    ev.on('bulletHitVehicle', (e) => this.play('bulletMetal', e.vehicle.com, { vol: 0.35, ref: 10, var: 0.15 }));
    ev.on('dryFire', () => this.play('click', null, { vol: 0.4 }));
    ev.on('reload', () => { this.play('clickLo', null, { vol: 0.35 }); this.play('click', null, { vol: 0.3, delay: 0.5 }); });
    ev.on('weaponSwitch', () => this.play('clickLo', null, { vol: 0.3 }));
    ev.on('doorOpen', (e) => this.play('clickLo', e.vehicle.com, { vol: 0.5, rate: 0.5, ref: 8 }));
    ev.on('enteredVehicle', (e) => { this.play('thud', e.vehicle.com, { vol: 0.5, rate: 1.4, ref: 8 }); if (e.actor.isPlayer) this.radio && this.radioOn && this.radio.tune(this.radioIndex); });
    ev.on('exitedVehicle', (e) => this.play('thud', e.vehicle.com, { vol: 0.45, rate: 1.4, ref: 8 }));
    ev.on('splash', (e) => this.play('splash', e.position, { vol: 0.8 }));
    ev.on('land', (e) => this.play(e.hard ? 'body' : 'thud', e.actor.pos, { vol: e.hard ? 0.8 : 0.3, ref: 8 }));
    ev.on('jump', (e) => { if (e.actor.isPlayer) this.play('step', e.actor.pos, { vol: 0.3 }); });
    ev.on('horn', (e) => this.honk(e.vehicle, 0.45));
    ev.on('heatChanged', (e) => { if (e.level > (e.was ?? 0)) this.jingle('heat'); });
    ev.on('cash', (e) => { if (e.amount > 0) this.jingle('cash'); });
    ev.on('pickup', () => this.jingle('pickup'));
  }
  honk(v, dur = 0.5) { v._honkUntil = (this.ctx ? this.ctx.currentTime : 0) + dur; }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    if (!this.ready) return;
    const game = this.game, ctx = this.ctx, now = ctx.currentTime, P = game.player;
    const paused = game.paused || !game.started;
    this.master.gain.setTargetAtTime(paused ? 0.25 * this.volume.master : this.volume.master, now, 0.1);
    const cam = this._listener().position;
    // --- engines: nearest active vehicles
    const cands = [];
    for (const v of game.vehicles.list) {
      if (v.exploded) continue;
      const active = v.driver || v.ai || v.policeUnit;
      if (!active) continue;
      const d2 = (v.com.x - cam.x) ** 2 + (v.com.z - cam.z) ** 2;
      if (d2 > 90 * 90 && v.driver !== P) continue;
      cands.push([v.driver === P ? -1 : d2, v]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    const chosen = cands.slice(0, this.engineVoices.length).map(c => c[1]);
    // keep voices attached to the same vehicle when possible
    for (const ev of this.engineVoices) if (ev.v && !chosen.includes(ev.v)) ev.v = null;
    for (const v of chosen) if (!this.engineVoices.some(e => e.v === v)) { const free = this.engineVoices.find(e => !e.v); if (free) free.v = v; }
    for (const e of this.engineVoices) this._updateEngine(e, dt, now);
    // --- sirens
    const sir = game.vehicles.list.filter(v => v.lights.siren && !v.exploded).sort((a, b) => a.com.distanceToSquared(cam) - b.com.distanceToSquared(cam)).slice(0, 2);
    this.sirenVoices.forEach((s, i) => {
      const v = sir[i];
      if (!v) { s.g.gain.setTargetAtTime(0, now, 0.1); return; }
      const sp = this._spatial(v.com, 40, 500);
      s.phase += dt;
      const mode = Math.floor(s.phase / 8) % 2; // wail / yelp
      const f = mode === 0 ? 650 + 520 * (0.5 - 0.5 * Math.cos(s.phase * TAU / 2.6)) : 700 + 450 * (0.5 - 0.5 * Math.cos(s.phase * TAU * 3.3));
      s.o.frequency.setTargetAtTime(f, now, 0.02); s.o2.frequency.setTargetAtTime(f * 0.5, now, 0.02);
      s.g.gain.setTargetAtTime(sp ? sp.gain * 0.16 : 0, now, 0.05); if (sp) s.p.pan.setTargetAtTime(sp.pan, now, 0.05);
    });
    // --- horns
    const horns = game.vehicles.list.filter(v => (v.horn || (v._honkUntil && v._honkUntil > now)) && !v.exploded).slice(0, 3);
    this.hornVoices.forEach((h, i) => {
      const v = horns[i];
      if (!v) { h.g.gain.setTargetAtTime(0, now, 0.03); return; }
      const sp = this._spatial(v.com, 16, 220);
      const base = v.spec.class === 'truck' || v.spec.class === 'bus' ? 220 : v.spec.class === 'van' ? 330 : 415;
      h.a.frequency.setTargetAtTime(base, now, 0.01); h.b.frequency.setTargetAtTime(base * 1.26, now, 0.01);
      h.g.gain.setTargetAtTime(sp ? sp.gain * 0.35 : 0, now, 0.015); if (sp) h.p.pan.setTargetAtTime(sp.pan, now, 0.05);
    });
    // --- tire screech + road noise for the player's car
    const pv = P.inVehicle ? P.vehicle : null;
    const sk = pv ? pv.skid * clamp(pv.speed / 8, 0, 1) : 0;
    this.bed.screech.g.gain.setTargetAtTime(sk * 0.22, now, 0.05);
    this.bed.screech.f.frequency.setTargetAtTime(1800 + (pv ? pv.speed * 20 : 0), now, 0.1);
    this.bed.road.g.gain.setTargetAtTime(pv && pv.onGround ? clamp(pv.speed / 40, 0, 1) * 0.35 : 0, now, 0.1);
    // --- footsteps
    if (!P.inVehicle && P.alive && P.grounded && P.speedNow > 0.8 && !P.swimming) {
      this.stepT -= dt * P.speedNow / (P.speedNow > 5 ? 2.2 : 1.35);
      if (this.stepT <= 0) { this.stepT = 1; this.play('step', null, { vol: P.speedNow > 5 ? 0.22 : 0.13, var: 0.15 }); }
    }
    // --- ambience
    const d = game.city.districtAt(cam.x, cam.z).id;
    const busy = { downtown: 1, midtown: 0.8, midtown2: 0.8, oldquarter: 0.7, palmshore: 0.5, linden: 0.4, ironworks: 0.6, saltgate: 0.6, crestline: 0.15, sea: 0.05 }[d] ?? 0.4;
    const night = game.env.nightFactor;
    this.bed.city.g.gain.setTargetAtTime(busy * (0.35 - night * 0.15), now, 0.5);
    const coast = game.city.terrain.coastDistanceAt(cam.x, cam.z);
    this.bed.sea.g.gain.setTargetAtTime(clamp(1 - coast / 120, 0, 1) * (0.28 + 0.12 * Math.sin(now * 0.4)), now, 0.3);
    const windSpeed = pv ? pv.speed : P.speedNow;
    this.bed.wind.g.gain.setTargetAtTime(clamp((windSpeed - 8) / 40, 0, 0.5) + clamp((cam.y - 60) / 200, 0, 0.3), now, 0.2);
    this.bed.wind.f.frequency.setTargetAtTime(400 + windSpeed * 18, now, 0.2);
    this.bed.rain.g.gain.setTargetAtTime(game.weather.rain * 0.25, now, 0.5);
    // birds by day / crickets at night
    if (!paused) {
      this.birdT -= dt;
      if (this.birdT <= 0) { this.birdT = 2 + Math.random() * 6; if (night < 0.3 && busy < 0.9 && game.weather.rain < 0.3) this._chirp(); }
      this.cricketT -= dt;
      if (this.cricketT <= 0) { this.cricketT = 0.6 + Math.random() * 1.5; if (night > 0.6 && busy < 0.8) this._cricket(); }
    }
    // --- radio: only while the player sits in a vehicle
    const radioOn = !!pv && this.radioOn && P.alive && !paused;
    this.music.gain.setTargetAtTime(radioOn ? 1 : 0, now, radioOn ? 0.3 : 0.15);
    this.radio.setActive(radioOn || (!!pv && paused));
    this.radio.update();
  }
  _updateEngine(e, dt, now) {
    const v = e.v;
    if (!v) { e.out.gain.setTargetAtTime(0, now, 0.1); return; }
    const S = ENGINES[v.spec.engine] || ENGINES.sedan;
    const sp = this._spatial(v.com, v.driver === this.game.player ? 40 : 14, 140);
    const isP = v.driver === this.game.player;
    if (!sp) { e.out.gain.setTargetAtTime(0, now, 0.1); return; }
    const rpm = v.mode === 'kinematic' ? 900 + v.speed * 110 : v.rpm;
    const thr = v.mode === 'kinematic' ? clamp(v.speed / 12, 0.1, 0.5) : clamp(v.throttleOut ?? 0, 0, 1);
    const fire = rpm / 60 * S.cyl / 2;
    e.o1.type = S.type;
    e.o1.frequency.setTargetAtTime(fire, now, 0.03); e.o2.frequency.setTargetAtTime(fire * 0.5, now, 0.03); e.o3.frequency.setTargetAtTime(fire * 0.25, now, 0.03);
    e.g3.gain.setTargetAtTime(S.sub * 0.5, now, 0.1);
    e.am.frequency.setTargetAtTime(fire * 0.5, now, 0.05); e.amg.gain.setTargetAtTime(S.rumble ? 0.12 : 0.04, now, 0.1);
    e.lp.frequency.setTargetAtTime((300 + rpm * 0.18 * S.lp) * (0.55 + thr * 0.6), now, 0.05);
    e.nf.frequency.setTargetAtTime(500 + rpm * 0.25, now, 0.05); e.gn.gain.setTargetAtTime(S.noise * (0.15 + thr * 0.4), now, 0.05);
    const idle = v.driver || v.ai || v.policeUnit ? 0.35 : 0;
    const vol = S.gain * (idle + thr * 0.65) * sp.gain * (isP ? 0.7 : 1);
    e.out.gain.setTargetAtTime(vol, now, 0.05); e.pan.pan.setTargetAtTime(isP ? 0 : sp.pan, now, 0.05);
  }
  _chirp() {
    const ctx = this.ctx, t = ctx.currentTime, n = 2 + (Math.random() * 4 | 0), base = 2200 + Math.random() * 2200;
    const p = ctx.createStereoPanner(); p.pan.value = rand(-0.8, 0.8); p.connect(this.amb);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(); const t0 = t + i * (0.09 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base, t0); o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), t0 + 0.06);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.03, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.08);
      o.connect(g).connect(p); o.start(t0); o.stop(t0 + 0.1);
    }
  }
  _cricket() {
    const ctx = this.ctx, t = ctx.currentTime, f = 4200 + Math.random() * 600;
    const p = ctx.createStereoPanner(); p.pan.value = rand(-0.9, 0.9); p.connect(this.amb);
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(); const t0 = t + i * 0.07;
      o.frequency.value = f; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.012, t0 + 0.01); g.gain.linearRampToValueAtTime(0, t0 + 0.05);
      o.connect(g).connect(p); o.start(t0); o.stop(t0 + 0.06);
    }
  }
  // ------------------------------------------------------------------ radio control
  nextStation(dir = 1) {
    if (!this.ready) return null;
    const n = this.radio.stations.length + 1; // + off
    this.radioIndex = ((this.radioIndex + dir) % n + n) % n;
    this.radioOn = this.radioIndex < this.radio.stations.length;
    if (this.radioOn) this.radio.tune(this.radioIndex);
    this.play('click', null, { vol: 0.25 });
    return this.radioOn ? this.radio.stations[this.radioIndex] : null;
  }
  setVolume(k, v) { this.volume[k] = v; if (!this.ready) return; if (k === 'master') this.master.gain.value = v; if (k === 'sfx') this.sfx.gain.value = v; if (k === 'music') this.radioOut.gain.value = v; }
}
