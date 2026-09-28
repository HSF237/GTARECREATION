// Environment orchestrator: time of day, sun/moon light + shadows, hemisphere + PMREM sky IBL,
// sky dome, ocean, rain & lightning, and the post-processing chain.
//   const env = new Environment({ renderer, scene, camera, quality, terrain, noise })
//   env.update(dt, { timeOfDay, weather:{clouds, rain, fog}, focus: Vector3, time })
//   env.render(dt); env.resize(w,h); env.setQuality(q)
//   env.effects.flash(color, strength) / damage(a) / death(t) / slowMo(t)
//   props: sunDirection, nightFactor, daylight, wetness, sunLight, hemiLight, onLightning(cb)
import * as THREE from 'three';
import { SKY_UNIFORMS, SKY_GLSL, createSkyMesh, skyParams } from './sky.js';
import { createOcean } from './water.js';
import { PostChain, QUALITY } from './post.js';
import { clamp, smoothstep, lerp } from '../core/math.js';

function createRain(count = 7000) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(2, 1) }, uLight: { value: 1 }, uColor: { value: new THREE.Color(0.6, 0.65, 0.72) } },
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute vec4 aSeed; uniform float uTime; uniform vec3 uCam; uniform vec2 uWind; varying float vA;
      void main() {
        vec3 box = vec3(56.0, 30.0, 56.0);
        float speed = 17.0 + aSeed.w * 7.0;
        vec3 base = aSeed.xyz * box;
        base.y -= uTime * speed; base.x += uWind.x * uTime; base.z += uWind.y * uTime;
        vec3 wp;
        wp.x = uCam.x + mod(base.x - uCam.x + box.x * 0.5, box.x) - box.x * 0.5;
        wp.z = uCam.z + mod(base.z - uCam.z + box.z * 0.5, box.z) - box.z * 0.5;
        wp.y = uCam.y - 12.0 + mod(base.y - uCam.y + 12.0, box.y);
        vec3 dir = normalize(vec3(uWind.x, -speed, uWind.y));
        vec3 toCam = normalize(uCam - wp);
        vec3 side = normalize(cross(dir, toCam));
        vec3 p = wp + dir * position.y * 0.75 + side * position.x * 0.025;
        float d = length(uCam - wp);
        vA = smoothstep(56.0, 8.0, d) * smoothstep(0.5, 3.0, d);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uLight; uniform vec3 uColor; varying float vA;
      void main() { gl_FragColor = vec4(uColor * uLight, 0.32 * vA); }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 20;
  return { mesh, mat, geo, count };
}

export class Environment {
  constructor({ renderer, scene, camera, quality = 'high', terrain, noise }) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.skyU = SKY_UNIFORMS(); this.skyU.tNoise.value = noise;
    this.sky = createSkyMesh(this.skyU); scene.add(this.sky);
    // environment map scene
    this.envScene = new THREE.Scene();
    // the lower hemisphere is sunlit ground, not black: its bounce light keeps shaded walls, cars and people readable
    this.envGround = { value: new THREE.Color(0.06, 0.06, 0.06) };
    const envMat = new THREE.ShaderMaterial({
      uniforms: { ...this.skyU, uEnvGround: this.envGround }, side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `${SKY_GLSL}\nuniform vec3 uEnvGround; varying vec3 vDir; void main(){ vec3 v = normalize(vDir); vec3 c = skyColor(v, vec3(0.0), false); if (v.y < 0.0) c = mix(c, uEnvGround, smoothstep(0.0, -0.25, v.y)); gl_FragColor = vec4(c, 1.0); }`,
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), envMat));
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null; this.envTimer = 0; this.lastEnvSun = new THREE.Vector3(0, -2, 0); this.lastEnvCloud = -1;
    // lights
    const sun = this.sunLight = new THREE.DirectionalLight(0xffffff, 3);
    sun.castShadow = true;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 1400;
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.045;
    sun.shadow.camera.layers.enable(1);
    scene.add(sun, sun.target);
    this.hemiLight = new THREE.HemisphereLight(0x99bbff, 0x443322, 0.6);
    scene.add(this.hemiLight);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    // ocean & rain
    this.ocean = createOcean(this.skyU, terrain, noise); scene.add(this.ocean.mesh);
    this.rain = createRain(); scene.add(this.rain.mesh);
    // post
    this.post = new PostChain(renderer, scene, camera, quality);
    this.setQuality(quality);
    // state
    this.sunDirection = new THREE.Vector3(0, 1, 0); this.moonDirection = new THREE.Vector3();
    this.nightFactor = 0; this.daylight = 1; this.wetness = 0; this.rainAmount = 0;
    this.params = {};
    this.flashT = 0; this.flashColor = new THREE.Color(1, 1, 1); this.flashStrength = 0;
    this.damageAmt = 0; this.deathT = 0; this.slowT = 0;
    this.lightningT = 8; this.lightningFlash = 0; this.onLightning = null;
    this.cloudOffset = new THREE.Vector2();
    const self = this;
    this.effects = {
      flash(color = 0xffffff, strength = 0.6) { self.flashColor.set(color); self.flashStrength = Math.max(self.flashStrength, strength); },
      damage(a) { self.damageAmt = Math.min(1, Math.max(self.damageAmt, a)); },
      death(t) { self.deathT = t; },
      slowMo(t) { self.slowT = t; },
    };
    this._tmp = new THREE.Vector3(); this._lx = new THREE.Vector3(); this._ly = new THREE.Vector3();
  }
  setQuality(q) {
    this.quality = q;
    const Q = QUALITY[q] || QUALITY.high;
    const s = this.sunLight.shadow;
    if (s.map) { s.map.dispose(); s.map = null; }
    s.mapSize.set(Q.shadow, Q.shadow);
    const e = Q.shadowExtent;
    Object.assign(s.camera, { left: -e, right: e, top: e, bottom: -e });
    s.camera.updateProjectionMatrix();
    this.shadowExtent = e; this.shadowSize = Q.shadow;
    // phones start the fast preset at full CSS resolution (dynamic resolution scales down if the GPU struggles)
    const pr = this.phone ? Math.max(1, Q.pixelRatio) : Q.pixelRatio;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pr) * (this.resScale || 1));
    if (this.post.quality !== q) this.post.build(q);
  }
  setResolutionScale(s) { this.resScale = s; this.setQuality(this.quality); this.resize(window.innerWidth, window.innerHeight); }
  resize(w, h) { this.renderer.setSize(w, h); this.post.setSize(w, h); }

  update(dt, { timeOfDay = 12, weather = {}, focus, time = 0 }) {
    const clouds = weather.clouds ?? 0.3, rain = weather.rain ?? 0, fogW = weather.fog ?? 0;
    this.rainAmount = rain;
    // --- sun position
    const th = ((timeOfDay - 6.25) / 12.5) * Math.PI, tilt = 0.5;
    const s = this.sunDirection.set(Math.cos(th), Math.sin(th) * Math.cos(tilt), Math.sin(th) * Math.sin(tilt)).normalize();
    this.moonDirection.set(-s.x, Math.max(0.25, -s.y * 0.8 + 0.2), -s.z + 0.3).normalize();
    const elev = Math.asin(clamp(s.y, -1, 1)) * 180 / Math.PI;
    const P = skyParams(elev, this.params);
    this.nightFactor = smoothstep(0.1, -0.1, s.y);
    const storm = clamp(rain * 1.2, 0, 1), overcast = clamp(clouds * 0.42 + storm * 0.7, 0, 1);
    // --- sky uniforms
    const U = this.skyU;
    U.uSunDir.value.copy(s); U.uMoonDir.value.copy(this.moonDirection);
    const grey = (c, k, g) => [lerp(c[0], g, k), lerp(c[1], g, k), lerp(c[2], g, k)];
    const zen = grey(P.zenith, overcast * 0.55, (P.zenith[0] + P.zenith[1] + P.zenith[2]) / 3 * 0.8);
    const hor = grey(P.horizon, overcast * 0.6, (P.horizon[0] + P.horizon[1] + P.horizon[2]) / 3 * 0.85);
    U.uZenith.value.setRGB(...zen); U.uHorizon.value.setRGB(...hor); U.uGlow.value.setRGB(...P.glow.map(v => v * (1 - overcast * 0.7)));
    U.uSunColor.value.setRGB(...P.sunColor);
    U.uSunDisc.value = clamp(1 - overcast * 1.1, 0, 1) * smoothstep(-0.04, 0.02, s.y);
    U.uNight.value = this.nightFactor; U.uTime.value = time;
    U.uCloud.value = clamp(clouds + storm * 0.5, 0, 1); U.uCloudDark.value = storm * 0.85; U.uStorm.value = storm;
    this.cloudOffset.x += dt * 0.0011; this.cloudOffset.y += dt * 0.0004; U.uCloudOffset.value.copy(this.cloudOffset);
    U.uGround.value.setRGB(hor[0] * 0.25, hor[1] * 0.25, hor[2] * 0.26);
    // --- lightning
    this.lightningFlash = Math.max(0, this.lightningFlash - dt * 6);
    if (storm > 0.55) {
      this.lightningT -= dt;
      if (this.lightningT <= 0) {
        this.lightningT = 5 + Math.random() * 16;
        this.lightningFlash = 1;
        if (this.onLightning) this.onLightning(0.6 + Math.random() * 2.5);
      }
    }
    const lf = this.lightningFlash > 0 ? this.lightningFlash * (0.6 + 0.4 * Math.sin(time * 90)) : 0;
    U.uFlash.value = lf;
    // --- lights
    const sunUp = s.y > -0.03;
    const sunI = P.sunIntensity * (1 - overcast * 0.75);
    const L = this.sunLight;
    if (sunUp) { L.color.setRGB(...P.sunColor); L.intensity = sunI; }
    else { L.color.setRGB(0.5, 0.6, 0.9); L.intensity = 0.5 * (1 - overcast * 0.6) * smoothstep(-0.02, -0.2, s.y); }
    const ld = sunUp ? s : this.moonDirection;
    this.daylight = clamp(sunI / 3.5, 0, 1);
    this.hemiLight.color.setRGB(...P.hemiSky.map(v => v * (1 - overcast * 0.3)));
    this.hemiLight.groundColor.setRGB(...P.hemiGround);
    this.hemiLight.intensity = P.hemiIntensity * (1 + overcast * 0.4) + lf * 2.5;
    this.scene.environmentIntensity = P.envIntensity * (1 - storm * 0.3);
    // ground radiance for the env map: pavement (albedo ~0.25) lit by sun and sky
    { const sunG = sunUp ? sunI * Math.max(0, s.y) * 0.25 / Math.PI : 0, skyG = 0.25 * P.hemiIntensity * 0.9;
      this.envGround.value.setRGB(P.sunColor[0] * sunG + P.hemiSky[0] * skyG + 0.012, P.sunColor[1] * sunG + P.hemiSky[1] * skyG + 0.011, P.sunColor[2] * sunG + P.hemiSky[2] * skyG + 0.01); }
    // shadow follows focus with texel snapping
    if (focus) {
      const lz = this._tmp.copy(ld).normalize();
      const up = Math.abs(lz.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const lx = this._lx.crossVectors(up, lz).normalize(), ly = this._ly.crossVectors(lz, lx);
      const texel = (2 * this.shadowExtent) / this.shadowSize;
      const a = Math.round(focus.dot(lx) / texel) * texel, b = Math.round(focus.dot(ly) / texel) * texel, c = focus.dot(lz);
      const f = new THREE.Vector3().addScaledVector(lx, a).addScaledVector(ly, b).addScaledVector(lz, c);
      L.target.position.copy(f);
      L.position.copy(f).addScaledVector(lz, 600);
      L.target.updateMatrixWorld();
    }
    // --- environment map refresh
    this.envTimer -= dt;
    const envChanged = this.lastEnvSun.distanceTo(s) > 0.02 || Math.abs(this.lastEnvCloud - U.uCloud.value) > 0.05;
    if (!this.envRT || (this.envTimer <= 0 && envChanged)) {
      this.envTimer = 2.5;
      this.lastEnvSun.copy(s); this.lastEnvCloud = U.uCloud.value;
      const saveFlash = U.uFlash.value; U.uFlash.value = 0;
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 100, { size: 128 });
      U.uFlash.value = saveFlash;
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt; this.scene.environment = rt.texture;
    }
    // --- fog
    const fog = this.post.fog.uniforms;
    const morning = smoothstep(5.5, 6.5, timeOfDay) * (1 - smoothstep(8, 10, timeOfDay));
    const density = 0.00026 + morning * 0.0005 + storm * 0.0022 + fogW * 0.0035 + this.nightFactor * 0.00008;
    fog.get('uDensity').value = density;
    fog.get('uFogColor').value.setRGB(hor[0] * 0.92, hor[1] * 0.95, hor[2]);
    fog.get('uFogSun').value.setRGB(hor[0] * 0.9 + P.glow[0] * 0.8 + P.sunColor[0] * 0.25 * U.uSunDisc.value, hor[1] * 0.9 + P.glow[1] * 0.8 + P.sunColor[1] * 0.2 * U.uSunDisc.value, hor[2] * 0.9 + P.glow[2] * 0.8 + P.sunColor[2] * 0.15 * U.uSunDisc.value);
    fog.get('uSunDir').value.copy(s);
    fog.get('uHeightFall').value = 180 + (1 - storm) * 120;
    const camY = this.camera.position.y;
    const under = camY < this.ocean.uniforms.uWaterLevel.value - 0.05 ? 1 : 0;
    fog.get('uUnder').value = under;
    fog.get('uUnderColor').value.setRGB(0.01 + 0.03 * this.daylight, 0.08 + 0.12 * this.daylight, 0.1 + 0.14 * this.daylight);
    // --- ocean
    this.ocean.update(this.camera, time, { light: 1, ambient: this.hemiLight.color.clone().multiplyScalar(this.hemiLight.intensity * 0.6), rough: storm });
    // --- rain + wetness
    this.wetness = clamp(this.wetness + (rain > 0.05 ? dt / 25 * rain : -dt / 150), 0, 1);
    const rg = this.rain;
    rg.geo.instanceCount = Math.floor(rg.count * clamp(rain, 0, 1));
    rg.mesh.visible = rain > 0.02 && !under;
    rg.mat.uniforms.uTime.value = time; rg.mat.uniforms.uCam.value.copy(this.camera.position);
    rg.mat.uniforms.uLight.value = 0.25 + this.daylight * 0.9 + lf;
    // --- grade / effects
    const G = this.post.grade.uniforms;
    this.flashStrength = Math.max(0, this.flashStrength - dt * 3.2);
    G.get('uFlash').value = this.flashStrength + lf * 0.12; G.get('uFlashColor').value.copy(this.flashColor);
    this.damageAmt = Math.max(0, this.damageAmt - dt * 1.4);
    G.get('uDamage').value = this.damageAmt; G.get('uDeath').value = this.deathT; G.get('uSlow').value = this.slowT;
    // warm golden grade in the evening, cool at night
    const golden = smoothstep(25, 4, elev) * smoothstep(-6, 2, elev);
    G.get('uGain').value.setRGB(1 + golden * 0.05, 1 + golden * 0.01, 1 - golden * 0.05 + this.nightFactor * 0.04);
    G.get('uLift').value.setRGB(0.004 * this.nightFactor, 0.006 * this.nightFactor, 0.014 * this.nightFactor);
    G.get('uSat').value = 1.16 - overcast * 0.15 + golden * 0.06;
    G.get('uContrast').value = 1.07;
  }
  render(dt) { this.post.render(dt); }
}
