// GPU-billboard particle system (CPU simulated, instanced rendering in two blend layers).
//   const P = new Particles(scene, max) ; P.update(dt, camera, light) ; P.emit(type, pos, opts)
//   helpers: explosion(pos, scale), muzzleFlash(pos, dir), impact(pos, normal, surface), tracer(a, b), waterSplash(pos, size),
//            smoke(pos, amount, dark), fire(pos, size), tireSmoke(pos), dust(pos), sparks(pos, n, dir), glassShatter(pos)
import * as THREE from 'three';

const FR = { SMOKE: 0, SMOKE2: 1, FLAME: 2, SPARK: 3, GLOW: 4, DUST: 5, DROP: 6, CHIP: 7, RING: 8, STAR: 9, SOFT: 10, LEAF: 11 };

function atlas() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const cell = S / 4;
  const at = (i) => [(i % 4) * cell, Math.floor(i / 4) * cell];
  const puff = (i, hard, blobs) => {
    const [x, y] = at(i);
    for (let k = 0; k < blobs; k++) {
      const a = Math.random() * 6.28, r = Math.random() * cell * 0.18, cx = x + cell / 2 + Math.cos(a) * r, cy = y + cell / 2 + Math.sin(a) * r, rr = cell * (0.18 + Math.random() * 0.16);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      gr.addColorStop(0, `rgba(255,255,255,${hard})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rr, 0, 7); g.fill();
    }
  };
  puff(FR.SMOKE, 0.35, 14); puff(FR.SMOKE2, 0.55, 18); puff(FR.DUST, 0.25, 10); puff(FR.SOFT, 0.5, 6);
  { const [x, y] = at(FR.FLAME); for (let k = 0; k < 10; k++) { const cx = x + cell / 2 + (Math.random() - 0.5) * cell * 0.3, cy = y + cell * 0.55 + (Math.random() - 0.5) * cell * 0.3, rr = cell * (0.12 + Math.random() * 0.18); const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rr, 0, 7); g.fill(); } }
  { const [x, y] = at(FR.SPARK); const gr = g.createLinearGradient(x, y + cell / 2, x + cell, y + cell / 2); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x, y + cell * 0.44, cell, cell * 0.12); }
  { const [x, y] = at(FR.GLOW); const gr = g.createRadialGradient(x + cell / 2, y + cell / 2, 0, x + cell / 2, y + cell / 2, cell / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x, y, cell, cell); }
  { const [x, y] = at(FR.DROP); for (let k = 0; k < 8; k++) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(x + cell * (0.2 + Math.random() * 0.6), y + cell * (0.2 + Math.random() * 0.6), cell * 0.05, 0, 7); g.fill(); } }
  { const [x, y] = at(FR.CHIP); g.fillStyle = 'rgba(255,255,255,1)'; g.beginPath(); g.moveTo(x + cell * 0.3, y + cell * 0.25); g.lineTo(x + cell * 0.75, y + cell * 0.35); g.lineTo(x + cell * 0.65, y + cell * 0.75); g.lineTo(x + cell * 0.25, y + cell * 0.6); g.fill(); }
  { const [x, y] = at(FR.RING); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = cell * 0.06; g.beginPath(); g.arc(x + cell / 2, y + cell / 2, cell * 0.4, 0, 7); g.stroke(); }
  { const [x, y] = at(FR.STAR); g.save(); g.translate(x + cell / 2, y + cell / 2); for (let k = 0; k < 6; k++) { g.rotate(Math.PI / 3); const gr = g.createLinearGradient(0, 0, cell * 0.48, 0); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, -cell * 0.05); g.lineTo(cell * 0.48, 0); g.lineTo(0, cell * 0.05); g.fill(); } g.restore(); const gr2 = g.createRadialGradient(x + cell / 2, y + cell / 2, 0, x + cell / 2, y + cell / 2, cell * 0.2); gr2.addColorStop(0, 'rgba(255,255,255,1)'); gr2.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr2; g.fillRect(x, y, cell, cell); }
  { const [x, y] = at(FR.LEAF); g.fillStyle = 'rgba(255,255,255,1)'; g.beginPath(); g.ellipse(x + cell / 2, y + cell / 2, cell * 0.3, cell * 0.14, 0.6, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

class Layer {
  constructor(scene, max, tex, additive) {
    this.max = max; this.n = 0;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); // xyz + size
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); // rot, frame, stretch, lit
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    for (const a of [this.aPos, this.aCol, this.aMisc, this.aVel]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos); geo.setAttribute('aCol', this.aCol); geo.setAttribute('aMisc', this.aMisc); geo.setAttribute('aVel', this.aVel);
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tAtlas: { value: tex }, uLight: { value: new THREE.Color(1, 1, 1) } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute vec4 aPos; attribute vec4 aCol; attribute vec4 aMisc; attribute vec3 aVel;
        uniform vec3 uLight; varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float c = cos(aMisc.x), s = sin(aMisc.x);
          vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aPos.w;
          vec3 wp = aPos.xyz + camR * q.x + camU * q.y;
          if (aMisc.z > 0.0) { // stretch along velocity
            vec3 v = aVel; float l = length(v);
            if (l > 0.01) { vec3 d = v / l; vec3 toCam = normalize(cameraPosition - aPos.xyz); vec3 side = normalize(cross(d, toCam));
              wp = aPos.xyz + d * position.x * (aPos.w + l * aMisc.z) + side * position.y * aPos.w * 0.35; }
          }
          float f = aMisc.y; vec2 cell = vec2(mod(f, 4.0), floor(f / 4.0));
          vUv = (cell + position.xy + 0.5) / 4.0; vUv.y = 1.0 - vUv.y;
          vec3 lit = mix(vec3(1.0), uLight, aMisc.w);
          vCol = vec4(aCol.rgb * lit, aCol.a);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tAtlas; varying vec2 vUv; varying vec4 vCol;
        void main() { vec4 t = texture2D(tAtlas, vUv); gl_FragColor = vec4(vCol.rgb * ${additive ? 't.a * vCol.a' : '1.0'}, t.a * vCol.a); }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 31 : 30;
    scene.add(this.mesh);
    // particle state (SoA)
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.age = new Float32Array(max); this.life = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.c0 = new Float32Array(max * 4); this.c1 = new Float32Array(max * 4);
    this.rot = new Float32Array(max); this.rs = new Float32Array(max); this.frame = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.stretch = new Float32Array(max); this.lit = new Float32Array(max); this.fadeIn = new Float32Array(max); this.bounce = new Float32Array(max);
  }
  add(o) {
    let i = this.n;
    if (i >= this.max) { i = Math.floor(Math.random() * this.max); } else this.n++;
    this.p[i * 3] = o.x; this.p[i * 3 + 1] = o.y; this.p[i * 3 + 2] = o.z;
    this.v[i * 3] = o.vx || 0; this.v[i * 3 + 1] = o.vy || 0; this.v[i * 3 + 2] = o.vz || 0;
    this.age[i] = 0; this.life[i] = o.life || 1; this.s0[i] = o.size ?? 1; this.s1[i] = o.size1 ?? this.s0[i];
    const c0 = o.color || [1, 1, 1, 1], c1 = o.color1 || [c0[0], c0[1], c0[2], 0];
    this.c0.set(c0, i * 4); this.c1.set(c1, i * 4);
    this.rot[i] = o.rot ?? Math.random() * 6.28; this.rs[i] = o.spin ?? (Math.random() - 0.5) * 2; this.frame[i] = o.frame || 0;
    this.drag[i] = o.drag ?? 0.5; this.grav[i] = o.gravity ?? 0; this.stretch[i] = o.stretch || 0; this.lit[i] = o.lit ?? 1; this.fadeIn[i] = o.fadeIn || 0; this.bounce[i] = o.ground ?? -1e9;
  }
  update(dt) {
    let n = this.n;
    const P = this.aPos.array, C = this.aCol.array, Mi = this.aMisc.array, V = this.aVel.array;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { n--; this._move(n, i); i--; continue; }
      const d = Math.exp(-this.drag[i] * dt);
      const k = i * 3;
      this.v[k] *= d; this.v[k + 1] = this.v[k + 1] * d - this.grav[i] * dt; this.v[k + 2] *= d;
      this.p[k] += this.v[k] * dt; this.p[k + 1] += this.v[k + 1] * dt; this.p[k + 2] += this.v[k + 2] * dt;
      if (this.p[k + 1] < this.bounce[i]) { this.p[k + 1] = this.bounce[i]; this.v[k + 1] *= -0.3; this.v[k] *= 0.6; this.v[k + 2] *= 0.6; }
      this.rot[i] += this.rs[i] * dt;
      const t = this.age[i] / this.life[i];
      P[i * 4] = this.p[k]; P[i * 4 + 1] = this.p[k + 1]; P[i * 4 + 2] = this.p[k + 2]; P[i * 4 + 3] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const fi = this.fadeIn[i] > 0 ? Math.min(1, this.age[i] / this.fadeIn[i]) : 1;
      for (let c = 0; c < 4; c++) C[i * 4 + c] = this.c0[i * 4 + c] + (this.c1[i * 4 + c] - this.c0[i * 4 + c]) * t;
      C[i * 4 + 3] *= fi;
      Mi[i * 4] = this.rot[i]; Mi[i * 4 + 1] = this.frame[i]; Mi[i * 4 + 2] = this.stretch[i]; Mi[i * 4 + 3] = this.lit[i];
      V[k] = this.v[k]; V[k + 1] = this.v[k + 1]; V[k + 2] = this.v[k + 2];
    }
    this.n = n;
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aMisc.needsUpdate = true; this.aVel.needsUpdate = true;
  }
  _move(from, to) {
    if (from === to) return;
    const copy = (arr, w) => { for (let c = 0; c < w; c++) arr[to * w + c] = arr[from * w + c]; };
    copy(this.p, 3); copy(this.v, 3); copy(this.c0, 4); copy(this.c1, 4);
    for (const a of [this.age, this.life, this.s0, this.s1, this.rot, this.rs, this.frame, this.drag, this.grav, this.stretch, this.lit, this.fadeIn, this.bounce]) a[to] = a[from];
  }
}

const R = () => Math.random() - 0.5;
export class Particles {
  constructor(scene, max = 3000) {
    const tex = atlas();
    this.alpha = new Layer(scene, max, tex, false);
    this.add = new Layer(scene, Math.floor(max * 0.6), tex, true);
    this.lights = []; this.scene = scene;
    // pooled flash lights
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffaa55, 0, 30, 2); l.position.set(0, -500, 0); scene.add(l); this.lights.push({ l, t: 0, life: 0, peak: 0 }); } // lights stay in the scene at intensity 0 so the light count never changes (no shader recompiles)
    this.groundFn = null;
  }
  flashLight(pos, color = 0xffaa55, intensity = 60, life = 0.3, range = 30) {
    let best = this.lights[0];
    for (const L of this.lights) if (L.t >= L.life) { best = L; break; }
    best.l.position.copy(pos); best.l.color.set(color); best.l.distance = range; best.t = 0; best.life = life; best.peak = intensity;
  }
  update(dt, camera, light = [1, 1, 1]) {
    this.alpha.mat.uniforms.uLight.value.setRGB(light[0], light[1], light[2]);
    this.alpha.update(dt); this.add.update(dt);
    for (const L of this.lights) {
      if (L.t < L.life) { L.t += dt; const k = 1 - L.t / L.life; L.l.intensity = L.peak * k * k; if (L.t >= L.life) { L.l.intensity = 0; L.l.position.y = -500; } }
    }
  }
  // ---------------- composite effects
  explosion(pos, scale = 1) {
    const g = this.groundFn ? this.groundFn(pos.x, pos.z, pos.y + 2) : pos.y - 1;
    this.add.add({ x: pos.x, y: pos.y + 0.5, z: pos.z, size: 6 * scale, size1: 14 * scale, life: 0.22, frame: FR.GLOW, color: [4, 2.6, 1.2, 1], color1: [2, 0.6, 0.1, 0], lit: 0 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.28, sp = (2 + Math.random() * 7) * scale;
      this.add.add({ x: pos.x + R() * 2 * scale, y: pos.y + 0.5 + Math.random() * scale, z: pos.z + R() * 2 * scale, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 5 * scale, vz: Math.sin(a) * sp, size: (2 + Math.random() * 2.5) * scale, size1: (4 + Math.random() * 4) * scale, life: 0.5 + Math.random() * 0.7, frame: FR.FLAME, color: [3.5, 1.6, 0.45, 1], color1: [1.2, 0.2, 0.04, 0], drag: 3, gravity: -2, lit: 0 });
    }
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * 6.28, sp = (1 + Math.random() * 4) * scale;
      this.alpha.add({ x: pos.x + R() * 3 * scale, y: pos.y + 1 + Math.random() * 2 * scale, z: pos.z + R() * 3 * scale, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 4, vz: Math.sin(a) * sp, size: 3 * scale, size1: (10 + Math.random() * 8) * scale, life: 3 + Math.random() * 4, frame: FR.SMOKE2, color: [0.18, 0.16, 0.15, 0.85], color1: [0.3, 0.29, 0.28, 0], drag: 1.2, gravity: -1.2, fadeIn: 0.25 });
    }
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * 6.28, b = Math.random() * 1.4, sp = (8 + Math.random() * 18) * scale;
      this.add.add({ x: pos.x, y: pos.y + 0.8, z: pos.z, vx: Math.cos(a) * Math.cos(b) * sp, vy: Math.sin(b) * sp + 3, vz: Math.sin(a) * Math.cos(b) * sp, size: 0.12, life: 0.6 + Math.random() * 1.2, frame: FR.SPARK, color: [4, 2.2, 0.8, 1], color1: [2, 0.5, 0.1, 0], drag: 0.8, gravity: 9.8, stretch: 0.06, lit: 0, ground: g + 0.05 });
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * 6.28, sp = (4 + Math.random() * 10) * scale;
      this.alpha.add({ x: pos.x, y: pos.y + 0.8, z: pos.z, vx: Math.cos(a) * sp, vy: 4 + Math.random() * 9, vz: Math.sin(a) * sp, size: 0.25 + Math.random() * 0.3, life: 2 + Math.random(), frame: FR.CHIP, color: [0.12, 0.11, 0.1, 1], color1: [0.12, 0.11, 0.1, 0.8], drag: 0.3, gravity: 12, spin: R() * 14, ground: g + 0.1 });
    }
    this.add.add({ x: pos.x, y: g + 0.3, z: pos.z, size: 2 * scale, size1: 26 * scale, life: 0.45, frame: FR.RING, color: [1.5, 1.2, 0.9, 0.8], color1: [1, 0.8, 0.6, 0], lit: 0 });
    this.flashLight(pos, 0xff9a40, 180 * scale, 0.6, 40 * scale);
  }
  muzzleFlash(pos, dir, scale = 1) {
    this.add.add({ x: pos.x + dir.x * 0.08, y: pos.y + dir.y * 0.08, z: pos.z + dir.z * 0.08, size: 0.35 * scale, size1: 0.5 * scale, life: 0.05, frame: FR.STAR, color: [4, 2.8, 1.4, 1], color1: [3, 1.5, 0.5, 0], lit: 0 });
    this.add.add({ x: pos.x, y: pos.y, z: pos.z, size: 0.5 * scale, life: 0.06, frame: FR.GLOW, color: [2.5, 1.5, 0.6, 0.8], color1: [2, 1, 0.3, 0], lit: 0 });
    this.alpha.add({ x: pos.x + dir.x * 0.2, y: pos.y + dir.y * 0.2, z: pos.z + dir.z * 0.2, vx: dir.x * 2, vy: dir.y * 2 + 0.3, vz: dir.z * 2, size: 0.2, size1: 0.8, life: 0.6, frame: FR.SMOKE, color: [0.6, 0.6, 0.6, 0.25], color1: [0.7, 0.7, 0.7, 0], drag: 2 });
    this.flashLight(pos, 0xffc070, 12 * scale, 0.06, 8);
  }
  impact(pos, n, surface = 'concrete') {
    if (surface === 'water') return this.waterSplash(pos, 0.6);
    if (surface === 'flesh') {
      for (let i = 0; i < 5; i++) this.alpha.add({ x: pos.x, y: pos.y, z: pos.z, vx: n.x * 1.5 + R() * 1.5, vy: n.y * 1.5 + R() * 1.5, vz: n.z * 1.5 + R() * 1.5, size: 0.08, size1: 0.3, life: 0.35, frame: FR.SOFT, color: [0.35, 0.02, 0.02, 0.8], color1: [0.3, 0.02, 0.02, 0], drag: 4, gravity: 3 });
      return;
    }
    const metal = surface === 'metal' || surface === 'vehicle';
    const col = surface === 'grass' || surface === 'dirt' ? [0.35, 0.3, 0.2, 0.7] : surface === 'sand' ? [0.8, 0.72, 0.55, 0.7] : surface === 'wood' ? [0.45, 0.33, 0.2, 0.7] : [0.6, 0.58, 0.55, 0.6];
    for (let i = 0; i < 3; i++) this.alpha.add({ x: pos.x, y: pos.y, z: pos.z, vx: n.x * 1.2 + R(), vy: n.y * 1.2 + R() + 0.4, vz: n.z * 1.2 + R(), size: 0.12, size1: 0.6, life: 0.7, frame: FR.DUST, color: col, color1: [col[0], col[1], col[2], 0], drag: 3 });
    const ns = metal ? 8 : 3;
    for (let i = 0; i < ns; i++) this.add.add({ x: pos.x, y: pos.y, z: pos.z, vx: n.x * 4 + R() * 6, vy: n.y * 4 + R() * 6 + 1, vz: n.z * 4 + R() * 6, size: 0.04, life: 0.15 + Math.random() * 0.25, frame: FR.SPARK, color: [3, 2.2, 1.2, 1], color1: [2, 1, 0.3, 0], drag: 1, gravity: 9.8, stretch: 0.03, lit: 0 });
    if (!metal) for (let i = 0; i < 4; i++) this.alpha.add({ x: pos.x, y: pos.y, z: pos.z, vx: n.x * 3 + R() * 3, vy: n.y * 3 + Math.random() * 3, vz: n.z * 3 + R() * 3, size: 0.05, life: 0.6, frame: FR.CHIP, color: [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8, 1], color1: [col[0], col[1], col[2], 0.6], gravity: 9.8, spin: 10 });
  }
  tracer(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l = Math.hypot(dx, dy, dz);
    if (l < 1) return;
    const sp = 400;
    this.add.add({ x: a.x + dx / l * 2, y: a.y + dy / l * 2, z: a.z + dz / l * 2, vx: dx / l * sp, vy: dy / l * sp, vz: dz / l * sp, size: 0.03, life: Math.min(0.12, l / sp), frame: FR.SPARK, color: [3, 2.4, 1.4, 0.9], color1: [2, 1.5, 0.8, 0.3], drag: 0, stretch: 0.012, lit: 0 });
  }
  waterSplash(pos, size = 1) {
    for (let i = 0; i < 14 * size + 4; i++) this.alpha.add({ x: pos.x + R() * size, y: pos.y, z: pos.z + R() * size, vx: R() * 3 * size, vy: 2 + Math.random() * 5 * size, vz: R() * 3 * size, size: 0.3 * size, size1: 0.9 * size, life: 0.8, frame: FR.DROP, color: [0.85, 0.92, 0.95, 0.8], color1: [0.9, 0.95, 1, 0], gravity: 9.8, drag: 0.5 });
    this.alpha.add({ x: pos.x, y: pos.y + 0.1, z: pos.z, size: size, size1: size * 4, life: 0.8, frame: FR.SOFT, color: [0.9, 0.95, 1, 0.6], color1: [0.9, 0.95, 1, 0], drag: 1 });
  }
  hydrant(pos) {
    for (let i = 0; i < 3; i++) this.alpha.add({ x: pos.x + R() * 0.1, y: pos.y + 0.6, z: pos.z + R() * 0.1, vx: R() * 1.2, vy: 9 + Math.random() * 3, vz: R() * 1.2, size: 0.25, size1: 1.4, life: 1.6, frame: FR.DROP, color: [0.8, 0.88, 0.95, 0.7], color1: [0.85, 0.9, 1, 0], gravity: 9.8, drag: 0.4 });
  }
  smoke(pos, amount = 1, dark = false) {
    this.alpha.add({ x: pos.x + R() * 0.4, y: pos.y, z: pos.z + R() * 0.4, vx: R() * 0.6, vy: 1.2 + Math.random() * 1.2, vz: R() * 0.6, size: 0.6 * amount, size1: 3.5 * amount, life: 2.5 + Math.random() * 1.5, frame: dark ? FR.SMOKE2 : FR.SMOKE, color: dark ? [0.1, 0.09, 0.09, 0.7] : [0.55, 0.55, 0.55, 0.35], color1: dark ? [0.25, 0.24, 0.24, 0] : [0.7, 0.7, 0.7, 0], drag: 0.8, gravity: -0.4, fadeIn: 0.3 });
  }
  fire(pos, size = 1) {
    this.add.add({ x: pos.x + R() * size, y: pos.y, z: pos.z + R() * size, vx: R() * 0.5, vy: 1.5 + Math.random() * 1.5, vz: R() * 0.5, size: 0.8 * size, size1: 0.2 * size, life: 0.5 + Math.random() * 0.4, frame: FR.FLAME, color: [3.2, 1.5, 0.4, 1], color1: [1.5, 0.3, 0.05, 0], drag: 1, lit: 0 });
  }
  tireSmoke(pos, k = 1) {
    this.alpha.add({ x: pos.x, y: pos.y + 0.15, z: pos.z, vx: R() * 0.8, vy: 0.4 + Math.random() * 0.5, vz: R() * 0.8, size: 0.5, size1: 3.5 * k, life: 1.6 + Math.random(), frame: FR.SMOKE, color: [0.8, 0.8, 0.8, 0.28 * k], color1: [0.85, 0.85, 0.85, 0], drag: 1.2, gravity: -0.2, fadeIn: 0.15 });
  }
  dust(pos, k = 1, col = [0.7, 0.62, 0.48]) {
    this.alpha.add({ x: pos.x, y: pos.y + 0.1, z: pos.z, vx: R() * 1, vy: 0.3 + Math.random() * 0.5, vz: R() * 1, size: 0.4, size1: 2.5 * k, life: 1.2, frame: FR.DUST, color: [...col, 0.3 * k], color1: [...col, 0], drag: 1.5 });
  }
  exhaust(pos, dir) {
    this.alpha.add({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * 0.8 + R() * 0.3, vy: 0.2 + Math.random() * 0.2, vz: dir.z * 0.8 + R() * 0.3, size: 0.12, size1: 0.8, life: 0.8, frame: FR.SMOKE, color: [0.6, 0.6, 0.62, 0.15], color1: [0.7, 0.7, 0.7, 0], drag: 2 });
  }
  sparks(pos, n = 6, dir = null) {
    for (let i = 0; i < n; i++) this.add.add({ x: pos.x, y: pos.y, z: pos.z, vx: (dir ? dir.x * 5 : 0) + R() * 7, vy: Math.random() * 5, vz: (dir ? dir.z * 5 : 0) + R() * 7, size: 0.05, life: 0.3 + Math.random() * 0.4, frame: FR.SPARK, color: [3.5, 2.4, 1.2, 1], color1: [2, 0.6, 0.2, 0], gravity: 9.8, drag: 0.6, stretch: 0.03, lit: 0 });
  }
  glassShatter(pos) {
    for (let i = 0; i < 16; i++) this.alpha.add({ x: pos.x + R(), y: pos.y + R() * 0.5, z: pos.z + R(), vx: R() * 4, vy: Math.random() * 3, vz: R() * 4, size: 0.06, life: 1.2, frame: FR.CHIP, color: [0.7, 0.85, 0.9, 0.9], color1: [0.7, 0.85, 0.9, 0.3], gravity: 9.8, spin: 15 });
  }
  leaves(pos) {
    for (let i = 0; i < 8; i++) this.alpha.add({ x: pos.x + R() * 2, y: pos.y + 2 + Math.random() * 3, z: pos.z + R() * 2, vx: R() * 2, vy: Math.random(), vz: R() * 2, size: 0.12, life: 2.5, frame: FR.LEAF, color: [0.3, 0.45, 0.15, 1], color1: [0.3, 0.4, 0.15, 0], gravity: 1.2, drag: 1.5, spin: 4 });
  }
}
