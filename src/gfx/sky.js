// Analytic sky: gradient + scattering glow + sun/moon discs + stars + procedural cloud layer.
// SKY_GLSL is shared by the sky dome, the environment-map render and the ocean reflection.
import * as THREE from 'three';

export const SKY_UNIFORMS = () => ({
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
  uSunColor: { value: new THREE.Color() }, uSunDisc: { value: 1 }, uNight: { value: 0 }, uTime: { value: 0 },
  uCloud: { value: 0.35 }, uCloudDark: { value: 0 }, uStorm: { value: 0 }, uFlash: { value: 0 }, tNoise: { value: null },
  uGround: { value: new THREE.Color(0.08, 0.08, 0.09) }, uCloudOffset: { value: new THREE.Vector2() },
});

export const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uMoonDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uSunColor;
uniform float uSunDisc; uniform float uNight; uniform float uTime; uniform float uCloud; uniform float uCloudDark; uniform float uStorm; uniform float uFlash;
uniform sampler2D tNoise; uniform vec3 uGround; uniform vec2 uCloudOffset;
float skHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cloudFbm(vec2 p) {
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 5; i++) { v += a * texture(tNoise, p).r; p = p * 2.03 + vec2(0.17, 0.31); a *= 0.5; }
  return v;
}
vec3 skyBase(vec3 v) {
  float y = v.y;
  float yy = max(y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(yy, 0.55));
  float mu = dot(v, uSunDir);
  float band = pow(1.0 - yy, 5.0);
  // warm glow band around the sun near the horizon (sunset/sunrise)
  col += uGlow * band * (0.08 + 0.92 * pow(max(mu, 0.0), 2.5));
  // mie halo
  col += uSunColor * (pow(max(mu, 0.0), 12.0) * 0.18 + pow(max(mu, 0.0), 180.0) * 0.8) * uSunDisc;
  if (y < 0.0) col = mix(col, uGround, smoothstep(0.0, -0.25, y));
  return col;
}
vec4 skyClouds(vec3 v, vec3 camPos) {
  if (v.y < 0.01 || uCloud < 0.01) return vec4(0.0);
  float H = 1800.0 - camPos.y;
  float t = H / v.y;
  vec2 p = (camPos.xz + v.xz * t) * 0.000055 + uCloudOffset;
  float d = cloudFbm(p);
  float cov = mix(1.02, 0.36, uCloud);
  float c = smoothstep(cov, cov + 0.28, d);
  if (c <= 0.001) return vec4(0.0);
  float dl = cloudFbm(p + uSunDir.xz * 0.012);
  float shade = clamp(1.0 - (dl - d) * 3.5, 0.35, 1.25);
  float thick = smoothstep(cov, cov + 0.6, d);
  vec3 amb = mix(uHorizon, uZenith, 0.35) * 1.1;
  vec3 lit = uSunColor * (0.55 + 0.45 * shade) * max(uSunDir.y + 0.12, 0.0) * 2.2;
  vec3 col = mix(lit + amb * 0.9, amb * 0.75, thick * 0.7);
  float mu = max(dot(v, uSunDir), 0.0);
  col += uSunColor * pow(mu, 8.0) * (1.0 - thick) * 1.2 * uSunDisc;
  col = mix(col, col * vec3(0.32, 0.34, 0.38), uCloudDark);
  col += vec3(0.8, 0.85, 1.0) * uFlash * 4.0 * c;
  col = mix(col, uHorizon * 0.12 + amb * 0.3, uNight * 0.9);
  float fade = smoothstep(0.01, 0.2, v.y);
  return vec4(col, c * fade * (0.85 + 0.15 * uCloud));
}
vec3 skyStarsMoon(vec3 v) {
  vec3 col = vec3(0.0);
  if (uNight > 0.02 && v.y > 0.0) {
    vec3 d = v * 260.0; vec3 id = floor(d); float h = skHash(id);
    if (h > 0.9965) { vec3 f = fract(d) - 0.5; float tw = 0.6 + 0.4 * sin(uTime * (2.0 + h * 5.0) + h * 40.0); col += vec3(0.9, 0.95, 1.0) * smoothstep(0.22, 0.0, length(f)) * tw * uNight * (1.0 - uCloud) * 1.6; }
    float mm = dot(v, uMoonDir);
    if (mm > 0.99965) { float k = texture(tNoise, v.xz * 3.0 + 0.3).r; col += vec3(0.9, 0.92, 1.0) * (1.4 + k * 0.6) * uNight; }
    col += vec3(0.25, 0.3, 0.45) * pow(max(mm, 0.0), 60.0) * 0.25 * uNight;
  }
  return col;
}
vec3 skyColor(vec3 v, vec3 camPos, bool withSun) {
  vec3 col = skyBase(v);
  col += skyStarsMoon(v);
  if (withSun && v.y > -0.02) {
    float mu = dot(v, uSunDir);
    float disc = smoothstep(0.99985, 0.99992, mu);
    col += uSunColor * disc * 40.0 * uSunDisc;
  }
  vec4 cl = skyClouds(v, camPos);
  col = mix(col, cl.rgb, cl.a);
  col = mix(col, col * 0.45 + uHorizon * 0.12, uStorm * 0.6);
  return col;
}
`;

export function createSkyMesh(uniforms) {
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      ${SKY_GLSL}
      varying vec3 vDir;
      void main() {
        vec3 v = normalize(vDir);
        gl_FragColor = vec4(skyColor(v, cameraPosition, true), 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  return mesh;
}

// keyframes by sun elevation (degrees): [elev, zenith, horizon, glow, sunColor, sunIntensity, hemiSky, hemiGround, hemiInt, env]
const KEYS = [
  [-18, [0.002, 0.004, 0.014], [0.012, 0.016, 0.034], [0, 0, 0], [0.3, 0.38, 0.6], 0.0, [0.14, 0.16, 0.26], [0.1, 0.075, 0.05], 0.6, 0.45],
  [-7, [0.012, 0.02, 0.07], [0.08, 0.06, 0.12], [0.12, 0.04, 0.05], [0.4, 0.3, 0.4], 0.0, [0.16, 0.16, 0.26], [0.09, 0.07, 0.06], 0.55, 0.45],
  [-2, [0.05, 0.07, 0.2], [0.34, 0.22, 0.27], [0.75, 0.22, 0.07], [1.0, 0.32, 0.1], 0.0, [0.25, 0.22, 0.32], [0.08, 0.05, 0.05], 0.5, 0.55],
  [2, [0.07, 0.13, 0.36], [0.55, 0.4, 0.44], [1.4, 0.5, 0.14], [1.0, 0.46, 0.18], 1.6, [0.34, 0.33, 0.45], [0.12, 0.09, 0.07], 0.4, 0.55],
  [8, [0.08, 0.19, 0.52], [0.58, 0.58, 0.72], [1.0, 0.48, 0.15], [1.0, 0.68, 0.42], 3.1, [0.42, 0.48, 0.66], [0.2, 0.16, 0.12], 0.6, 0.8],
  [20, [0.08, 0.22, 0.6], [0.52, 0.63, 0.82], [0.14, 0.07, 0.02], [1.0, 0.88, 0.72], 3.7, [0.5, 0.6, 0.82], [0.27, 0.24, 0.19], 0.72, 1.0],
  [45, [0.07, 0.21, 0.62], [0.5, 0.65, 0.86], [0, 0, 0], [1.0, 0.96, 0.9], 4.1, [0.52, 0.63, 0.86], [0.3, 0.27, 0.22], 0.75, 1.02],
  [90, [0.07, 0.2, 0.62], [0.5, 0.64, 0.85], [0, 0, 0], [1.0, 0.97, 0.93], 4.3, [0.52, 0.63, 0.88], [0.32, 0.28, 0.23], 0.75, 1.02],
];
/** Evaluate sky/light parameters for a sun elevation (degrees). */
export function skyParams(elev, out = {}) {
  let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1][0] < elev) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  let t = (elev - a[0]) / (b[0] - a[0]); t = Math.max(0, Math.min(1, t));
  const lv = (k) => [0, 1, 2].map(j => a[k][j] + (b[k][j] - a[k][j]) * t);
  const ls = (k) => a[k] + (b[k] - a[k]) * t;
  out.zenith = lv(1); out.horizon = lv(2); out.glow = lv(3); out.sunColor = lv(4); out.sunIntensity = ls(5);
  out.hemiSky = lv(6); out.hemiGround = lv(7); out.hemiIntensity = ls(8); out.envIntensity = ls(9);
  return out;
}
