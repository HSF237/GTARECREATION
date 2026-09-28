// Post-processing chain (pmndrs postprocessing + N8AO): scene -> AO -> [fog, bloom, tone map (AgX), grade] -> SMAA.
//   const post = new PostChain(renderer, scene, camera, quality)
//   post.fog / post.grade : Effect uniforms (see below); post.render(dt); post.setSize(w,h)
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset, Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

class FogEffect extends Effect {
  constructor() {
    super('FogEffect', /* glsl */`
      uniform mat4 uProjInv; uniform mat4 uViewInv; uniform vec3 uCamPos; uniform vec3 uFogColor; uniform vec3 uFogSun; uniform vec3 uSunDir;
      uniform float uDensity; uniform float uHeightFall; uniform float uUnder; uniform vec3 uUnderColor; uniform float uMaxFog;
      void mainImage(const in vec4 inputColor0, const in vec2 uv, const in float depth, out vec4 outputColor) {
        vec4 inputColor = inputColor0;
        uvec3 bits = floatBitsToUint(inputColor.rgb) & uvec3(0x7F800000u);
        if (bits.x == 0x7F800000u || bits.y == 0x7F800000u || bits.z == 0x7F800000u) inputColor.rgb = vec3(0.0);
        inputColor.rgb = clamp(inputColor.rgb, 0.0, 2000.0);
        if (depth >= 0.999999) {
          outputColor = inputColor;
          if (uUnder > 0.5) outputColor.rgb = uUnderColor;
          return;
        }
        vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec4 vp = uProjInv * ndc; vp /= vp.w;
        vec3 wp = (uViewInv * vec4(vp.xyz, 1.0)).xyz;
        vec3 d = wp - uCamPos; float dist = length(d); vec3 dir = d / max(dist, 1e-3);
        float H = uHeightFall;
        float h0 = max(uCamPos.y, 0.0), h1 = max(wp.y, 0.0), dh = h1 - h0;
        float avg = abs(dh) > 0.5 ? (exp(-h0 / H) - exp(-h1 / H)) * H / dh : exp(-h0 / H);
        float f = (1.0 - exp(-dist * uDensity * max(avg, 0.0))) * uMaxFog;
        float sunAmt = pow(max(dot(dir, uSunDir), 0.0), 5.0);
        vec3 fc = mix(uFogColor, uFogSun, sunAmt);
        vec3 col = mix(inputColor.rgb, fc, f);
        if (uUnder > 0.5) { float uf = 1.0 - exp(-dist * 0.08); col = mix(col * vec3(0.35, 0.7, 0.75), uUnderColor, uf); }
        outputColor = vec4(col, inputColor.a);
      }`, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SET,
      uniforms: new Map([
        ['uProjInv', new THREE.Uniform(new THREE.Matrix4())], ['uViewInv', new THREE.Uniform(new THREE.Matrix4())], ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uFogColor', new THREE.Uniform(new THREE.Color(0.6, 0.7, 0.8))], ['uFogSun', new THREE.Uniform(new THREE.Color(1, 0.8, 0.6))], ['uSunDir', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uDensity', new THREE.Uniform(0.0008)], ['uHeightFall', new THREE.Uniform(220)], ['uUnder', new THREE.Uniform(0)], ['uUnderColor', new THREE.Uniform(new THREE.Color(0.02, 0.18, 0.22))],
        ['uMaxFog', new THREE.Uniform(1)],
      ]),
    });
  }
}
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */`
      uniform float uSat; uniform float uContrast; uniform float uVignette; uniform float uDamage; uniform float uDeath; uniform float uFlash; uniform float uGrain; uniform float uT;
      uniform vec3 uFlashColor; uniform vec3 uLift; uniform vec3 uGain; uniform float uSlow;
      float gh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat * (1.0 - uSlow * 0.4));
        c = (c - 0.5) * uContrast + 0.5;
        c = c * uGain + uLift * (1.0 - c);
        vec2 q = uv - 0.5;
        float r2 = dot(q, q);
        c *= 1.0 - r2 * (uVignette + uSlow * 0.8);
        float edge = smoothstep(0.08, 0.32, r2);
        c = mix(c, vec3(0.5, 0.0, 0.02), edge * uDamage * 0.85);
        float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(c, vec3(l2) * vec3(0.95, 0.9, 0.88), uDeath * 0.85);
        c *= 1.0 - uDeath * 0.4 * smoothstep(0.02, 0.3, r2);
        c += uFlashColor * uFlash;
        c += (gh(uv * 731.0 + uT) - 0.5) * uGrain;
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`, {
      uniforms: new Map([
        ['uSat', new THREE.Uniform(1.08)], ['uContrast', new THREE.Uniform(1.04)], ['uVignette', new THREE.Uniform(0.55)], ['uDamage', new THREE.Uniform(0)],
        ['uDeath', new THREE.Uniform(0)], ['uFlash', new THREE.Uniform(0)], ['uGrain', new THREE.Uniform(0.018)], ['uT', new THREE.Uniform(0)],
        ['uFlashColor', new THREE.Uniform(new THREE.Color(1, 1, 1))], ['uLift', new THREE.Uniform(new THREE.Color(0, 0, 0))], ['uGain', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['uSlow', new THREE.Uniform(0)],
      ]),
    });
  }
}

export const QUALITY = {
  low: { pixelRatio: 0.75, ao: false, bloom: 0.6, smaa: false, shadow: 1024, shadowExtent: 70 },
  medium: { pixelRatio: 1, ao: true, aoHalf: true, bloom: 0.85, smaa: true, shadow: 2048, shadowExtent: 90 },
  high: { pixelRatio: 1, ao: true, aoHalf: true, bloom: 0.9, smaa: true, shadow: 2048, shadowExtent: 110 },
  ultra: { pixelRatio: 1.5, ao: true, aoHalf: false, bloom: 0.9, smaa: true, shadow: 4096, shadowExtent: 140 },
};

export class PostChain {
  constructor(renderer, scene, camera, quality = 'high') {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.fog = new FogEffect();
    this.grade = new GradeEffect();
    this.build(quality);
  }
  build(quality) {
    const Q = QUALITY[quality] || QUALITY.high;
    this.quality = quality;
    if (this.composer) this.composer.dispose();
    const r = this.renderer;
    const composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(this.scene, this.camera));
    const size = r.getSize(new THREE.Vector2());
    if (Q.ao) {
      const ao = new N8AOPostPass(this.scene, this.camera, size.x, size.y);
      ao.configuration.aoRadius = 2.2; ao.configuration.distanceFalloff = 1.0; ao.configuration.intensity = 1.6; ao.configuration.denoiseRadius = 10;
      ao.configuration.halfRes = !!Q.aoHalf; ao.configuration.depthAwareUpsampling = true; ao.configuration.aoSamples = Q.aoHalf ? 12 : 16; ao.configuration.denoiseSamples = 8;
      ao.configuration.gammaCorrection = false;
      composer.addPass(ao); this.ao = ao;
    } else this.ao = null;
    this.bloom = new BloomEffect({ intensity: Q.bloom, luminanceThreshold: 0.92, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    composer.addPass(new EffectPass(this.camera, this.fog));
    composer.addPass(new EffectPass(this.camera, this.bloom, this.tone, this.grade));
    if (Q.smaa) composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    this.composer = composer;
    this.setSize(size.x, size.y);
  }
  setSize(w, h) { this.composer.setSize(w, h); }
  render(dt) {
    const cam = this.camera, U = this.fog.uniforms;
    U.get('uProjInv').value.copy(cam.projectionMatrixInverse);
    U.get('uViewInv').value.copy(cam.matrixWorld);
    U.get('uCamPos').value.setFromMatrixPosition(cam.matrixWorld);
    this.grade.uniforms.get('uT').value = (this.grade.uniforms.get('uT').value + 0.137) % 100;
    this.composer.render(dt);
  }
}
