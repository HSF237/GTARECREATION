// Generative radio: four original stations whose instrumental songs are composed on the fly
// (random keys, progressions, drum patterns, basslines, arps and motifs) and synthesized with Web Audio.
const TAU = Math.PI * 2;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11], mixo: [0, 2, 4, 5, 7, 9, 10] };
const PROGS = {
  minor: [[0, 5, 3, 4], [0, 3, 5, 4], [0, 6, 5, 6], [0, 5, 2, 6], [0, 3, 4, 4]],
  dorian: [[0, 3, 0, 3], [0, 1, 3, 4], [0, 6, 3, 4]],
  major: [[0, 4, 5, 3], [0, 3, 4, 3], [0, 5, 3, 4], [0, 2, 3, 4]],
  mixo: [[0, 6, 3, 0], [0, 3, 6, 3]],
};
export const STATIONS = [
  { id: 'harbor', name: 'Harbor FM', freq: '94.1', tag: 'Sunset synth, all night', genre: 'synthwave', bpm: [96, 112], scales: ['minor', 'dorian'] },
  { id: 'lowtide', name: 'Low Tide Radio', freq: '88.7', tag: 'Slow beats by the water', genre: 'lofi', bpm: [70, 86], scales: ['dorian', 'major', 'minor'] },
  { id: 'pulse', name: 'Pulse 101', freq: '101.3', tag: 'Club heat from Saltgate', genre: 'house', bpm: [120, 126], scales: ['minor', 'dorian'] },
  { id: 'iron', name: 'Iron Signal', freq: '105.9', tag: 'Loud guitars, no apologies', genre: 'rock', bpm: [132, 152], scales: ['minor', 'mixo'] },
];

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }

export class RadioStations {
  constructor(ctx, out) {
    this.ctx = ctx; this.out = out; this.stations = STATIONS;
    this.active = false; this.cur = null; this.step = 0; this.nextTime = 0; this.song = null; this.bar = 0;
    const n = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, n, n); { const d = this.noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
    this.crackle = ctx.createBuffer(1, n * 2, n); { const d = this.crackle.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.8 : (Math.random() * 2 - 1) * 0.015; }
    this.crackleGain = ctx.createGain(); this.crackleGain.gain.value = 0;
    const cs = ctx.createBufferSource(); cs.buffer = this.crackle; cs.loop = true; cs.connect(this.crackleGain).connect(out); cs.start();
    this.bus = ctx.createGain(); this.bus.gain.value = 0.8; this.bus.connect(out);
    // simple send "room" for pads/leads
    this.delay = ctx.createDelay(1.5); this.fb = ctx.createGain(); this.fb.gain.value = 0.28; const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2500;
    this.send = ctx.createGain(); this.send.gain.value = 0.25;
    this.send.connect(this.delay); this.delay.connect(dlp).connect(this.fb).connect(this.delay); dlp.connect(this.bus);
    this.seed = (Math.random() * 1e9) | 0;
  }
  setActive(on) {
    if (on && !this.active && this.cur) this.nextTime = this.ctx.currentTime + 0.05;
    this.active = on;
    if (this.cur) this.crackleGain.gain.setTargetAtTime(on && this.cur.genre === 'lofi' ? 1 : 0, this.ctx.currentTime, 0.2);
  }
  tune(i) {
    this.cur = this.stations[i];
    this._newSong();
    this.nextTime = this.ctx.currentTime + 0.05;
    this._ident(this.nextTime);
    this.nextTime += 0.6;
    this.crackleGain.gain.value = this.cur.genre === 'lofi' ? 1 : 0;
  }
  _newSong() {
    const st = this.cur, r = rng(this.seed++ * 2654435761);
    const scaleName = st.scales[Math.floor(r() * st.scales.length)];
    const progs = PROGS[scaleName];
    const s = {
      r, bpm: st.bpm[0] + r() * (st.bpm[1] - st.bpm[0]), root: 38 + Math.floor(r() * 9), scale: SCALES[scaleName],
      prog: progs[Math.floor(r() * progs.length)], swing: st.genre === 'lofi' ? 0.18 : st.genre === 'house' ? 0.06 : 0,
      bars: 48 + Math.floor(r() * 3) * 8, drums: this._drumPattern(st.genre, r), bassPat: this._bassPattern(st.genre, r), arp: Math.floor(r() * 3), motif: null, fill: Math.floor(r() * 4),
    };
    s.motif = this._motif(s, r);
    this.song = s; this.step = 0; this.bar = 0;
  }
  _drumPattern(g, r) {
    const P = { k: new Array(16).fill(0), s: new Array(16).fill(0), h: new Array(16).fill(0), o: new Array(16).fill(0) };
    if (g === 'house') { for (let i = 0; i < 16; i += 4) P.k[i] = 1; P.s[4] = P.s[12] = 1; for (let i = 2; i < 16; i += 4) P.o[i] = 1; for (let i = 0; i < 16; i++) if (r() < 0.5) P.h[i] = 0.5; }
    else if (g === 'lofi') { P.k[0] = 1; P.k[7] = r() < 0.5 ? 0.7 : 0; P.k[10] = 0.8; P.s[4] = P.s[12] = 1; for (let i = 0; i < 16; i += 2) P.h[i] = 0.6; if (r() < 0.5) P.h[15] = 0.4; }
    else if (g === 'rock') { P.k[0] = P.k[8] = 1; P.k[10] = r() < 0.6 ? 1 : 0; P.k[6] = r() < 0.3 ? 0.8 : 0; P.s[4] = P.s[12] = 1; for (let i = 0; i < 16; i += 2) P.h[i] = 0.8; }
    else { P.k[0] = P.k[8] = 1; if (r() < 0.5) P.k[10] = 0.8; P.s[4] = P.s[12] = 1; for (let i = 0; i < 16; i += 2) P.h[i] = 0.55; if (r() < 0.5) for (let i = 1; i < 16; i += 2) P.h[i] = 0.25; }
    return P;
  }
  _bassPattern(g, r) {
    if (g === 'synthwave') return r() < 0.5 ? [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0].map((v, i) => v ? (i % 4 === 2 && r() < 0.3 ? 12 : 0) : null) : new Array(16).fill(0);
    if (g === 'house') return [null, null, 0, null, null, null, 0, null, null, null, 0, null, null, 7, 0, null];
    if (g === 'lofi') return [0, null, null, null, null, null, null, 7, null, null, 0, null, null, null, 5, null];
    return [0, null, 0, null, 0, null, 0, 0, 0, null, 0, null, 0, null, 0, 0];
  }
  _motif(s, r) {
    // 2-bar motif of (step, degreeOffset, length)
    const notes = []; let deg = Math.floor(r() * 5);
    for (let st = 0; st < 32;) {
      if (r() < 0.62) { const len = [2, 2, 4, 1, 3, 6][Math.floor(r() * 6)]; notes.push([st, deg, len]); st += len; deg += Math.floor(r() * 5) - 2; deg = Math.max(-2, Math.min(9, deg)); }
      else st += 2;
    }
    return notes;
  }
  // ------------------------------------------------------------------ scheduling
  update() {
    if (!this.active || !this.cur || !this.song) return;
    const ctx = this.ctx;
    if (this.nextTime < ctx.currentTime - 0.15) this.nextTime = ctx.currentTime + 0.02; // we fell behind (tab hidden / slow frame)
    let guard = 0;
    while (this.nextTime < ctx.currentTime + 0.3 && guard++ < 32) {
      const s = this.song, dur16 = 60 / s.bpm / 4;
      const swing = this.step % 2 === 1 ? s.swing * dur16 : 0;
      this._playStep(this.nextTime + swing, this.step, dur16);
      this.nextTime += dur16;
      this.step++;
      if (this.step % 16 === 0) { this.bar++; if (this.bar >= s.bars) { this._newSong(); this._ident(this.nextTime); this.nextTime += 0.7; } }
    }
  }
  _section(bar, total) {
    if (bar < 4) return 'intro';
    if (bar >= total - 4) return 'outro';
    const b = bar - 4, L = total - 8;
    if (b >= L * 0.45 && b < L * 0.45 + 8) return 'break';
    return b % 16 < 8 ? 'A' : 'B';
  }
  _chordNotes(s, bar, octave = 0) {
    const deg = s.prog[bar % 4];
    const sc = s.scale, n = (d) => { const o = Math.floor(d / 7); return s.root + 12 + octave * 12 + sc[((d % 7) + 7) % 7] + o * 12; };
    return [n(deg), n(deg + 2), n(deg + 4), n(deg + 6)];
  }
  _scaleNote(s, deg, octave) { const sc = s.scale, o = Math.floor(deg / 7); return s.root + 24 + octave * 12 + sc[((deg % 7) + 7) % 7] + o * 12; }
  _playStep(t, step, d16) {
    const s = this.song, g = this.cur.genre, st = step % 16, bar = this.bar, sec = this._section(bar, s.bars);
    const chord = this._chordNotes(s, bar);
    const fillBar = bar % 8 === 7;
    const drumsOn = sec !== 'break' && !(sec === 'intro' && bar < 2 && g !== 'house');
    // --- drums
    if (drumsOn) {
      const D = s.drums;
      if (D.k[st]) this.kick(t, D.k[st] * (g === 'rock' ? 0.9 : 1));
      if (D.s[st]) (g === 'house' ? this.clap(t, 0.55) : this.snare(t, g === 'lofi' ? 0.45 : 0.6));
      if (D.h[st] && sec !== 'intro') this.hat(t, D.h[st] * (g === 'rock' ? 0.35 : 0.3), false);
      if (D.o[st]) this.hat(t, 0.25, true);
      if (fillBar && st >= 12 && g !== 'house') this.snare(t, 0.3 + (st - 12) * 0.08);
      if (g === 'rock' && st === 0 && bar % 4 === 0) this.crash(t);
    }
    if (sec === 'break' && st === 0 && bar % 2 === 0) this.kick(t, 0.5);
    // --- bass
    if (sec !== 'intro' || bar >= 2) {
      const bp = s.bassPat[st];
      if (bp !== null && bp !== undefined && !(sec === 'break' && g !== 'lofi')) this.bass(t, chord[0] - 12 + bp, d16 * (g === 'lofi' ? 6 : g === 'rock' ? 1.8 : 1.6), g);
    }
    // --- harmony
    if (st === 0) {
      if (g === 'synthwave') this.pad(t, chord, d16 * 16, sec === 'break' ? 0.14 : 0.1);
      else if (g === 'lofi') this.keys(t, chord, d16 * 14);
      else if (g === 'house' && sec !== 'break') { /* stabs below */ }
      else if (g === 'rock' && sec !== 'break') this.power(t, chord[0], d16 * 7.5);
    }
    if (g === 'house' && (st === 2 || st === 10 || (st === 7 && s.fill > 1)) && sec !== 'intro') this.stab(t, chord, d16 * 1.5);
    if (g === 'house' && sec === 'break' && st === 0) this.pad(t, chord, d16 * 16, 0.12);
    if (g === 'rock' && st === 8 && sec !== 'break') this.power(t, chord[0] + (s.fill > 1 ? 0 : 5), d16 * 7.5);
    // --- arp (synthwave) / plucks
    if (g === 'synthwave' && (sec === 'A' || sec === 'B' || sec === 'break')) {
      const order = s.arp === 0 ? [0, 1, 2, 3] : s.arp === 1 ? [0, 2, 1, 3] : [0, 1, 2, 1];
      const note = chord[order[st % 4]] + 12 + (st % 8 >= 4 && s.arp === 2 ? 12 : 0);
      this.pluck(t, note, d16 * 0.9, 0.07);
    }
    // --- lead motif in A sections
    if (sec === 'A' || (sec === 'B' && g === 'lofi')) {
      const pos = (bar % 2) * 16 + st;
      for (const [ms, deg, len] of s.motif) if (ms === pos) {
        const note = this._scaleNote(s, deg + s.prog[bar % 4] * (g === 'lofi' ? 0 : 0), g === 'rock' ? 0 : 1);
        if (g === 'lofi') this.keysLead(t, note, d16 * len);
        else if (g === 'rock') this.guitarLead(t, note, d16 * len);
        else this.lead(t, note, d16 * len, g === 'house' ? 0.06 : 0.08);
      }
    }
  }
  _ident(t) {
    // station sting: rising sweep + bright chord (no voice)
    const ctx = this.ctx, root = 52 + (this.stations.indexOf(this.cur) * 3);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(6000, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.3); g.gain.linearRampToValueAtTime(0, t + 0.55);
    n.connect(f).connect(g).connect(this.bus); n.start(t); n.stop(t + 0.6);
    for (const m of [root, root + 4, root + 7, root + 12]) this._tone(t + 0.45, m, 0.5, 'triangle', 0.05, 3000);
  }
  // ------------------------------------------------------------------ instruments
  _env(g, t, a, peak, d, sus = 0.0001) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + d); }
  _tone(t, m, dur, type, vol, lp = 4000, dest = this.bus, detune = 0) {
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = type; o.frequency.value = mtof(m); o.detune.value = detune;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
    const g = ctx.createGain(); this._env(g, t, 0.005, vol, dur);
    o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
    return g;
  }
  kick(t, v = 1) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.9 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.4);
  }
  _noiseHit(t, type, freq, q, vol, dur, dest = this.bus) {
    const ctx = this.ctx, n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f).connect(g).connect(dest); n.start(t, Math.random() * 0.5); n.stop(t + dur + 0.02);
  }
  snare(t, v = 0.6) { this._noiseHit(t, 'bandpass', 1900, 0.8, v * 0.7, 0.16); this._tone(t, 54, 0.09, 'triangle', v * 0.35, 2000); }
  clap(t, v = 0.5) { for (let i = 0; i < 3; i++) this._noiseHit(t + i * 0.011, 'bandpass', 1300, 1.2, v * 0.6, 0.06 + i * 0.03); }
  hat(t, v = 0.3, open = false) { this._noiseHit(t, 'highpass', 7500, 0.5, v * 0.5, open ? 0.22 : 0.035); }
  crash(t) { this._noiseHit(t, 'highpass', 5000, 0.3, 0.18, 1.4); }
  bass(t, m, dur, g) {
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = g === 'lofi' ? 'triangle' : 'sawtooth'; o.frequency.value = mtof(m);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = g === 'house' ? 6 : 2;
    const base = g === 'lofi' ? 400 : 180; f.frequency.setValueAtTime(base * 5, t); f.frequency.exponentialRampToValueAtTime(base, t + Math.min(dur, 0.25));
    const gn = ctx.createGain(); this._env(gn, t, 0.005, g === 'rock' ? 0.22 : 0.3, dur);
    o.connect(f).connect(gn).connect(this.bus); o.start(t); o.stop(t + dur + 0.05);
  }
  pad(t, notes, dur, vol = 0.1) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(700, t); f.frequency.linearRampToValueAtTime(1600, t + dur * 0.5); f.frequency.linearRampToValueAtTime(900, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.35); g.gain.setValueAtTime(vol, t + dur - 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
    f.connect(g); g.connect(this.bus); g.connect(this.send);
    for (const m of notes.slice(0, 3)) for (const det of [-9, 9]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.5); }
  }
  pluck(t, m, dur, vol = 0.07) {
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = mtof(m);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3500, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.15);
    const g = ctx.createGain(); this._env(g, t, 0.003, vol, Math.max(0.08, dur));
    o.connect(f).connect(g); g.connect(this.bus); g.connect(this.send); o.start(t); o.stop(t + dur + 0.1);
  }
  lead(t, m, dur, vol = 0.08) {
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(12, t + Math.min(0.4, dur)); lfo.connect(lg).connect(o.detune);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.setValueAtTime(vol, t + Math.max(0.03, dur - 0.05)); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.12);
    o.connect(f).connect(g); g.connect(this.bus); g.connect(this.send); o.start(t); lfo.start(t); o.stop(t + dur + 0.2); lfo.stop(t + dur + 0.2);
  }
  keys(t, notes, dur) { for (const m of notes) this._fm(t, m, dur, 0.045); }
  keysLead(t, m, dur) { this._fm(t, m + 12, Math.max(0.25, dur), 0.05); }
  _fm(t, m, dur, vol) {
    const ctx = this.ctx, car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain();
    car.frequency.value = mtof(m); mod.frequency.value = mtof(m) * 1.0;
    mg.gain.setValueAtTime(mtof(m) * 1.4, t); mg.gain.exponentialRampToValueAtTime(mtof(m) * 0.1, t + 0.6);
    mod.connect(mg).connect(car.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + dur + 0.6);
    car.connect(f).connect(g); g.connect(this.bus); g.connect(this.send); car.start(t); mod.start(t); car.stop(t + dur + 0.7); mod.stop(t + dur + 0.7);
  }
  stab(t, notes, dur) {
    const ctx = this.ctx, f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 4; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(600, t + 0.2);
    const g = ctx.createGain(); this._env(g, t, 0.004, 0.06, dur); f.connect(g); g.connect(this.bus); g.connect(this.send);
    for (const m of notes.slice(0, 3)) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m + 12); o.connect(f); o.start(t); o.stop(t + dur + 0.1); }
  }
  power(t, m, dur) {
    const ctx = this.ctx;
    const sh = ctx.createWaveShaper(); if (!this._dist) { const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(x * 6); } this._dist = c; } sh.curve = this._dist;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.01); g.gain.setValueAtTime(0.05, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    sh.connect(f).connect(g).connect(this.bus);
    for (const [iv, det] of [[0, -6], [7, 5], [12, 0]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m + iv); o.detune.value = det; o.connect(sh); o.start(t); o.stop(t + dur + 0.05); }
  }
  guitarLead(t, m, dur) {
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m + 12);
    const sh = ctx.createWaveShaper(); sh.curve = this._dist || (this.power(t, m, 0.001), this._dist);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.045, t + 0.01); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.1);
    o.connect(sh).connect(f).connect(g); g.connect(this.bus); g.connect(this.send); o.start(t); o.stop(t + dur + 0.15);
  }
}
