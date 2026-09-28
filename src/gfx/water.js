// Ocean surface: large plane following the camera, analytic sky reflections, sun glint, depth-based color
// from the terrain height texture, shoreline foam.  createOcean(skyUniforms, terrain, noiseTex) -> { mesh, uniforms, update(camera, time, light) }
import * as THREE from 'three';
import { SKY_GLSL } from './sky.js';
import { makeRng } from '../core/rng.js';

function waveNormalTexture(N = 256, seed = 7) {
  const rng = makeRng(seed);
  const waves = [];
  for (let i = 0; i < 48; i++) {
    const ang = rng.gauss() * 1.1 + 0.6; // mostly aligned with wind
    const f = 1 + Math.floor(Math.pow(rng.next(), 1.6) * 22);
    const m = Math.round(Math.cos(ang) * f), n = Math.round(Math.sin(ang) * f);
    if (!m && !n) continue;
    const k = Math.hypot(m, n);
    waves.push([m, n, 1 / Math.pow(k, 1.35) * (0.6 + rng.next() * 0.8), rng.next() * Math.PI * 2]);
  }
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (const [m, n, a, p] of waves) { const s = Math.sin(2 * Math.PI * (m * x + n * y) / N + p); v += a * (s > 0 ? Math.pow(s, 1.4) : -Math.pow(-s, 1.1)); }
    h[y * N + x] = v;
  }
  const d = new Uint8Array(N * N * 4);
  const S = 14;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = h[y * N + (x + 1) % N] - h[y * N + (x - 1 + N) % N];
    const hy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
    let nx = -hx * S / N * 8, nz = -hy * S / N * 8, ny = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const p = (y * N + x) * 4;
    d[p] = (nx * 0.5 + 0.5) * 255; d[p + 1] = (nz * 0.5 + 0.5) * 255; d[p + 2] = ny * 255; d[p + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function createOcean(skyUniforms, terrain, noiseTex) {
  const { nx, nz, originX, originZ, cell, heights } = terrain;
  const half = new Uint16Array(nx * nz);
  for (let i = 0; i < nx * nz; i++) half[i] = THREE.DataUtils.toHalfFloat(heights[i]);
  const depthTex = new THREE.DataTexture(half, nx, nz, THREE.RedFormat, THREE.HalfFloatType);
  depthTex.minFilter = depthTex.magFilter = THREE.LinearFilter; depthTex.unpackAlignment = 2; depthTex.needsUpdate = true;
  const uniforms = {
    ...skyUniforms,
    tWave: { value: waveNormalTexture() }, tDepth: { value: depthTex },
    uDepthXf: { value: new THREE.Vector4(originX - cell / 2, originZ - cell / 2, 1 / (cell * nx), 1 / (cell * nz)) },
    uWaterLevel: { value: terrain.waterLevel }, uLight: { value: 1 }, uAmbient: { value: new THREE.Color(0.4, 0.5, 0.6) },
    uRough: { value: 0 }, uWaveTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true, depthWrite: true, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vWorld; varying float vViewZ;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp; vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      ${SKY_GLSL}
      uniform sampler2D tWave; uniform sampler2D tDepth; uniform vec4 uDepthXf; uniform float uWaterLevel; uniform float uLight; uniform vec3 uAmbient; uniform float uRough; uniform float uWaveTime;
      varying vec3 vWorld; varying float vViewZ;
      vec2 slope(vec2 uv) { vec3 n = texture(tWave, uv).xyz * 2.0 - 1.0; return n.xy / max(n.z, 0.2); }
      void main() {
        vec2 xz = vWorld.xz;
        float t = uWaveTime;
        vec3 V = cameraPosition - vWorld; float dist = length(V); V /= dist;
        float fade = 1.0 / (1.0 + dist * 0.0035);
        vec2 s = slope(xz * 0.021 + t * vec2(0.012, 0.007)) * 0.55
               + slope(xz * 0.057 + t * vec2(-0.02, 0.016)) * 0.3
               + slope(xz * 0.0047 + t * vec2(0.003, -0.002)) * 0.9;
        s *= (0.55 + uRough * 0.9) * mix(0.35, 1.0, fade);
        vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
        if (!gl_FrontFacing) {
          gl_FragColor = vec4(vec3(0.02, 0.12, 0.14) * uLight + uAmbient * 0.05, 0.9);
          return;
        }
        vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.001;
        vec3 refl = skyColor(normalize(R), vec3(0.0), false);
        float mu = max(dot(R, uSunDir), 0.0);
        vec3 spec = uSunColor * (pow(mu, 900.0) * 60.0 + pow(mu, 90.0) * 1.2) * uSunDisc * step(0.0, uSunDir.y);
        float ndv = max(dot(N, V), 0.0);
        float F = 0.02 + 0.8 * pow(1.0 - ndv, 5.0);
        // depth from terrain
        float th = texture(tDepth, (xz - uDepthXf.xy) * uDepthXf.zw).r;
        float depth = max(uWaterLevel - th, 0.0);
        vec3 deep = vec3(0.003, 0.03, 0.075);
        vec3 shallow = vec3(0.0, 0.42, 0.40);
        vec3 body = mix(shallow, deep, smoothstep(0.4, 11.0, depth));
        vec3 lightCol = uSunColor * max(uSunDir.y, 0.0) * 0.9 * uLight + uAmbient;
        body *= lightCol;
        // scattering glow when looking through wave crests toward the sun
        float sss = pow(max(dot(V, -uSunDir) * 0.5 + 0.5, 0.0), 3.0) * max(s.x + s.y, 0.0);
        body += vec3(0.0, 0.18, 0.16) * sss * uLight * max(uSunDir.y + 0.1, 0.0);
        vec3 col = mix(body, refl, F) + spec;
        // shoreline foam
        float fn = texture(tNoise, xz * 0.09 + vec2(t * 0.01, -t * 0.013)).r;
        float band = 0.5 + 0.5 * sin(depth * 7.0 - t * 1.6 + fn * 4.0);
        float foam = smoothstep(0.55, 0.05, depth) * smoothstep(0.5, 0.85, fn * 0.6 + band * 0.5);
        foam += smoothstep(0.12, 0.0, depth) * 0.5;
        foam *= smoothstep(300.0, 60.0, dist);
        col = mix(col, vec3(0.92, 0.96, 0.98) * lightCol * 1.1, clamp(foam, 0.0, 1.0) * 0.85);
        float alpha = mix(0.3, 0.97, smoothstep(0.0, 5.0, depth));
        alpha = clamp(alpha + F * 0.25 + foam, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = terrain.waterLevel;
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.name = 'ocean';
  return {
    mesh, uniforms,
    update(camera, time, { light = 1, ambient, rough = 0 } = {}) {
      mesh.position.x = Math.round(camera.position.x / 50) * 50;
      mesh.position.z = Math.round(camera.position.z / 50) * 50;
      mesh.updateMatrix(); mesh.updateMatrixWorld();
      uniforms.uWaveTime.value = time;
      uniforms.uLight.value = light;
      if (ambient) uniforms.uAmbient.value.copy(ambient);
      uniforms.uRough.value = rough;
    },
  };
}
