// GPU-skinned, instanced human renderer. Every character's bone matrices and look (skin, hair, clothes,
// blink, gaze, expression, cloth sway) live in one float texture row; meshes are drawn instanced per
// model / LOD, with optional accessory overlays (hats, long hair, vests) that share the row.
// The material paints detail per pixel in the bind-pose frame: skin pores and tone zones, a soft
// hairline, beard density and stubble, brows, lips and lash lines, eyes with iris and pupil, denim
// twill with seams and pockets, knit ribs, zippers and stitching; baked ambient occlusion grounds it all.
import * as THREE from 'three';
import { J, NB } from './character.js';
import { R } from './humanMesh.js';
import { FACADE_GLSL_PERTURB } from '../world/buildings.js';

const TEXW = NB * 4 + 8; // bone matrices + 8 data texels
const DATA0 = NB * 4;
export const HF = { BEARD: 1, STUBBLE: 2, BALD: 4, HAT: 8, VEST: 16, TIE: 32, JACKET: 64, LONGSLEEVE: 128, SLEEVELESS: 256, SHORTS: 512, GLOVES: 1024, DENIM: 2048, FADE: 4096, BUZZ: 8192, MAKEUP: 16384 };
const F = (n) => n.toFixed(1);

const VERT_COMMON = `
uniform highp sampler2D tBones; uniform vec3 uHeadPos; uniform float uK;
attribute vec4 aSkin; attribute vec4 aW; attribute float aRegion; attribute float aSway; attribute float aAO; attribute float iRow;
flat varying float vRegion; flat varying float vRow; varying vec3 vBind; varying vec3 vBindN; varying float vAO;
mat4 hBone(float b) {
  int x = int(b + 0.5) * 4; int y = int(iRow + 0.5);
  return mat4(texelFetch(tBones, ivec2(x, y), 0), texelFetch(tBones, ivec2(x + 1, y), 0), texelFetch(tBones, ivec2(x + 2, y), 0), texelFetch(tBones, ivec2(x + 3, y), 0));
}
mat4 hSkin() { return hBone(aSkin.x) * aW.x + hBone(aSkin.y) * aW.y + hBone(aSkin.z) * aW.z + hBone(aSkin.w) * aW.w; }
// facial micro-expressions and blinks as small bind-space displacements (the head frame is axis aligned in bind pose)
vec3 hExpr(vec3 p) {
  vec3 h = (p - uHeadPos) / uK;
  if (h.y < 0.04 || h.z < 0.03) return p;
  int y = int(iRow + 0.5);
  float blink = texelFetch(tBones, ivec2(${DATA0 + 1}, y), 0).a;
  float brow = texelFetch(tBones, ivec2(${DATA0 + 4}, y), 0).a;
  float smile = texelFetch(tBones, ivec2(${DATA0 + 6}, y), 0).a;
  float squint = texelFetch(tBones, ivec2(${DATA0 + 7}, y), 0).a;
  float ax = abs(h.x), sx = sign(h.x);
  vec3 d = vec3(0.0);
  // brows: raise (+) / knit (-)
  float bw = smoothstep(0.152, 0.166, h.y) * smoothstep(0.205, 0.178, h.y) * smoothstep(0.055, 0.075, h.z) * smoothstep(0.068, 0.05, ax);
  d.y += brow * 0.0035 * bw;
  d.x -= sx * max(0.0, -brow) * 0.0015 * bw * smoothstep(0.035, 0.012, ax);
  // smile: mouth corners up and back, cheeks lift
  float mc = exp(-pow((ax - 0.024) / 0.013, 2.0) - pow((h.y - 0.086) / 0.013, 2.0)) * smoothstep(0.06, 0.08, h.z);
  float ck = exp(-pow((ax - 0.042) / 0.018, 2.0) - pow((h.y - 0.118) / 0.016, 2.0)) * smoothstep(0.05, 0.07, h.z);
  d += vec3(sx * 0.0022, 0.0028, -0.0016) * smile * mc + vec3(0.0, 0.0018, 0.001) * smile * ck;
  // eyelids: the upper lid slides down over the eyeball on blinks, lower lids rise when squinting
  vec2 e = vec2((ax - 0.0315) / 0.0142, (h.y - 0.1504) / 0.0049);
  float near = smoothstep(2.6, 1.3, length(vec2(e.x, e.y * 0.55))) * smoothstep(0.075, 0.088, h.z);
  float upper = near * smoothstep(-0.2, 0.6, e.y) * smoothstep(3.4, 1.6, e.y);
  float lower = near * smoothstep(0.2, -0.6, e.y);
  d.y -= upper * blink * 0.0092;
  d.z += upper * blink * 0.0012;
  d.y += lower * (squint * 0.0022 + blink * 0.0012);
  return p + d * uK;
}
`;
const SKIN_POS = `
  vec3 hP = hExpr(position);
  vec3 transformed = (hSkinM * vec4(hP, 1.0)).xyz;
  vec4 hSw = texelFetch(tBones, ivec2(${DATA0 + 7}, int(iRow + 0.5)), 0);
  transformed += hSw.xyz * aSway;
`;

const FRAG_COMMON = `
uniform highp sampler2D tBones; uniform float uFill; uniform vec3 uEyeL; uniform vec3 uEyeR; uniform float uEyeR0;
uniform vec3 uHeadPos; uniform vec3 uTorsoPos; uniform vec3 uPelvisPos; uniform float uK; uniform float uFem; uniform float uHasJacket; uniform float uJacketOpen; uniform float uHairStyle;
uniform mat4 uArmInvL; uniform mat4 uArmInvR; uniform float uDbg; uniform float uZip;
flat varying float vRegion; flat varying float vRow; varying vec3 vBind; varying vec3 vBindN; varying float vAO;
${FACADE_GLSL_PERTURB}
vec4 hDat(int i) { return texelFetch(tBones, ivec2(${DATA0} + i, int(vRow + 0.5)), 0); }
float hH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hN(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hH(i), hH(i + vec3(1, 0, 0)), f.x), mix(hH(i + vec3(0, 1, 0)), hH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hH(i + vec3(0, 0, 1)), hH(i + vec3(1, 0, 1)), f.x), mix(hH(i + vec3(0, 1, 1)), hH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
bool hasF(float flags, float bit) { return mod(floor(flags / bit), 2.0) > 0.5; }
float sat(float x) { return clamp(x, 0.0, 1.0); }
float capD(vec3 p, vec3 a, vec3 b, float ra, float rb) { vec3 pa = p - a, ba = b - a; float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * t) - mix(ra, rb, t); }
float gHeight; float gRough; float gSSS; float gSpec; float gSheen; float gThin; float gAniso; float gShift; float gCloth;
// ---- head-frame feature masks (h: head-local metres for a 1.8 m adult, +z forward, +y up)
float hairLine(vec3 h) {
  float a = abs(atan(h.x, h.z));
  float l = a < 0.5 ? 0.222 - a * 0.03 : a < 1.2 ? 0.207 - (a - 0.5) * 0.1 : a < 2.0 ? 0.137 - (a - 1.2) * 0.02 : 0.121 - (a - 2.0) * 0.03;
  float ear = smoothstep(0.062, 0.07, abs(h.x)) * smoothstep(0.168, 0.156, h.y) * smoothstep(-0.042, -0.03, h.z) * smoothstep(0.026, 0.014, h.z);
  return l + ear * 0.05;
}
float beardMask(vec3 h) {
  float ax = abs(h.x);
  float ct = sat((ax - 0.026) / 0.04);
  float cheek = 0.097 + max(0.0, ax - 0.026) * 0.95 - sin(ct * 3.1416) * 0.006;
  float m = sat((cheek - h.y) / 0.0045 + 0.5);
  float sb = smoothstep(0.056, 0.066, ax) * sat((0.152 - h.y) / 0.006) * sat((h.z + 0.012) / 0.006) * sat((0.022 - h.z) / 0.006);
  m = max(m, sb);
  m *= sat((h.z + 0.006) / 0.009);
  float under = 0.034 + max(0.0, 0.03 - h.z) * 0.5;
  m *= sat((h.y - under) / 0.007);
  float st = sat((0.031 - ax) / 0.006) * sat((h.y - 0.091) / 0.003) * sat((0.1052 - h.y) / 0.0025) * sat((h.z - 0.078) / 0.006);
  return max(m, st);
}
float ellD(vec3 p, vec3 r) { float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-6); }
float lipDist(vec3 h) {
  vec3 q = vec3(abs(h.x), h.y, h.z);
  float u = mix(1.0, 1.14, uFem), l = mix(1.0, 1.12, uFem);
  float d = ellD(q - vec3(0.0066, 0.0892, 0.0962), vec3(0.0098, 0.0042 * u, 0.0058 * u));
  d = min(d, ellD(q - vec3(0.0168, 0.0879, 0.0932), vec3(0.0092, 0.0035 * u, 0.0052 * u)));
  d = min(d, ellD(q - vec3(0.0, 0.0806, 0.0946), vec3(0.0188, 0.0052 * l, 0.0066 * l)));
  return d;
}
float browMask(vec3 h, float jit) {
  float ax = abs(h.x);
  float t = sat((ax - 0.009) / 0.049);
  float yc = 0.1655 + sin(t * 2.6) * 0.0065 - t * t * 0.004;
  float th = mix(0.0056, 0.0026, t) * mix(1.0, 0.8, uFem);
  float d = abs(h.y - yc - (jit - 0.5) * 0.0012) - th;
  return sat(-d / 0.0019 + 0.5) * smoothstep(0.005, 0.012, ax) * smoothstep(0.063, 0.053, ax) * sat((h.z - 0.06) / 0.01);
}
`;

const STITCH = 'vec3(0.72, 0.52, 0.22)';
// albedo / roughness / bump per region
const FRAG_COLOR = `
{
  int reg = int(vRegion + 0.5);
  vec4 d0 = hDat(0), d1 = hDat(1), d2 = hDat(2), d3 = hDat(3), d4 = hDat(4), d5 = hDat(5), d6 = hDat(6);
  float flags = d0.a;
  vec3 skin = d0.rgb, hair = d1.rgb, top = d2.rgb, shirt = d3.rgb, pants = d4.rgb, shoes = d5.rgb, hat = d6.rgb;
  float blink = d1.a; vec2 gaze = vec2(d2.a, d3.a); float irisHue = d5.a;
  float fw = length(fwidth(vBind));
  float det = clamp(1.0 - fw * 300.0, 0.0, 1.0);   // fine detail fades with distance (no shimmer)
  float det2 = clamp(1.0 - fw * 90.0, 0.0, 1.0);   // mid detail
  vec3 col = skin; gHeight = 0.0; gRough = 0.55; gSSS = 0.0; gSpec = 0.5; gSheen = 0.0; gThin = 0.0; gAniso = 0.0; gShift = 0.0; gCloth = 0.0;
  vec3 P = vBind;
  vec3 h = (P - uHeadPos) / uK;
  float ax = abs(h.x);
  bool isHead = reg == ${R.SKIN} || reg == ${R.LIPS} || reg == ${R.MOUTH} || reg == ${R.BEARD} || reg == ${R.HAIR} || reg == ${R.BROW};
  // painted-over regions for crowd variety
  if (reg == ${R.SLEEVE_U} && hasF(flags, ${F(HF.SLEEVELESS)})) { isHead = true; reg = ${R.SKIN}; }
  if (reg == ${R.SHIN} && hasF(flags, ${F(HF.SHORTS)})) { isHead = true; reg = ${R.SKIN}; }
  if (isHead) {
    // ---------------- skin with pores and tone zones, plus per-pixel hair / beard / brows / lips on the head
    float n = hN(P * 90.0) * 0.6 + hN(P * 23.0) * 0.4;
    col = skin * (0.93 + 0.12 * n);
    col = mix(vec3(dot(col, vec3(0.3, 0.55, 0.15))), col, 0.86);
    float onHead = step(0.02, h.y) * step(h.y, 0.34);
    float red = exp(-pow(length(vec3(h.x, h.y - 0.113, h.z - 0.112)) / 0.022, 2.0)) * 0.9
              + exp(-pow(length(vec3(ax - 0.048, h.y - 0.121, h.z - 0.074)) / 0.026, 2.0)) * 0.35
              + smoothstep(0.066, 0.078, ax) * smoothstep(0.1, 0.12, h.y) * 0.5;
    red *= onHead;
    gThin = smoothstep(0.066, 0.079, ax) * onHead * smoothstep(0.1, 0.12, h.y) * smoothstep(0.18, 0.165, h.y);
    col = mix(col, col * vec3(1.06, 0.9, 0.93), sat(red) * 0.5);
    col = mix(col, col * vec3(1.05, 0.93, 0.9), smoothstep(0.55, 0.8, hN(P * 11.0)) * 0.3);
    float pores = hN(P * 1400.0) * 0.6 + hN(P * 420.0) * 0.4;
    gHeight = (pores - 0.5) * 0.00012 * det;
    gRough = 0.5 + 0.1 * n; gSSS = 1.0; gSpec = 0.35;
    float tz = onHead * (smoothstep(0.03, 0.0, ax) * smoothstep(0.1, 0.12, h.y) + smoothstep(0.2, 0.17, h.y) * smoothstep(0.15, 0.17, h.y) * smoothstep(0.05, 0.0, ax));
    gRough -= sat(tz) * 0.12;
    if (onHead > 0.5 && h.z > -0.02) {
      float mk = hasF(flags, ${F(HF.MAKEUP)}) ? 1.0 : 0.0;
      // eyes: lash lines, lid creases, sockets and under-eye tone
      vec2 e = vec2((ax - 0.0315) / 0.0142, (h.y - 0.1504) / 0.0049);
      float er = length(e);
      float frontEye = sat((h.z - 0.08) / 0.006);
      float lash = smoothstep(1.5, 1.04, er) * smoothstep(-0.1, 0.35, e.y) * frontEye;
      float lowl = smoothstep(1.35, 1.04, er) * smoothstep(0.1, -0.4, e.y) * frontEye;
      float crease = exp(-pow((length(vec2(e.x * 0.9, e.y - 0.25)) - 1.95) / 0.28, 2.0)) * smoothstep(-0.2, 0.5, e.y);
      float sock = smoothstep(3.4, 1.3, length(vec2(e.x * 0.75, (e.y + 0.4) * 0.5))) * smoothstep(0.07, 0.085, h.z);
      col *= 1.0 - sock * 0.07;
      col = mix(col, col * vec3(0.9, 0.88, 0.94), smoothstep(-0.8, -2.2, e.y) * smoothstep(3.2, 1.6, er) * 0.3);
      col *= 1.0 - crease * 0.2;
      col = mix(col, vec3(0.03, 0.02, 0.02), lash * (0.82 + 0.15 * mk));
      col = mix(col, col * 0.7, lowl * 0.4);
      gRough = mix(gRough, 0.7, lash);
      // lips (vermilion) and the mouth line
      float ld = lipDist(h);
      float lip = (1.0 - smoothstep(-0.0003, 0.0017, ld)) * step(0.068, h.y) * step(h.y, 0.1);
      vec3 lipCol = mix(skin * vec3(0.8, 0.55, 0.56), vec3(0.42, 0.16, 0.17), 0.25 + 0.25 * mk);
      col = mix(col, lipCol * (0.94 + 0.1 * hN(vec3(h.x * 900.0, h.y * 220.0, h.z * 900.0))), lip);
      gRough = mix(gRough, 0.34, lip); gHeight += lip * sin(h.x * 1500.0) * 0.00003 * det;
      float slit = (1.0 - smoothstep(0.0009, 0.0024, abs(h.y - 0.0848))) * smoothstep(0.0235, 0.0195, ax) * sat((h.z - 0.085) / 0.006);
      col = mix(col, vec3(0.12, 0.04, 0.035), slit * 0.9);
      // brows
      float jitB = hN(vec3(h.x * 500.0, h.y * 60.0, 0.0));
      float brow = browMask(h, jitB);
      // individual hairs: stretched along the brow, steeper near the inner end
      float bt = sat((ax - 0.009) / 0.049);
      vec2 bu = vec2(ax * 260.0 + h.y * mix(160.0, 40.0, bt), h.y * 1900.0 - ax * mix(900.0, 250.0, bt));
      float bStr = hN(vec3(bu, h.z * 300.0));
      float hairs = smoothstep(0.3, 0.7, bStr);
      col = mix(col, hair * (0.72 + 0.35 * bStr), brow * (0.7 + 0.25 * hairs));
      gHeight += brow * (bStr - 0.5) * 0.00012 * det;
      // beard: full (shell or painted), stubble, or the faint shadow every adult man has
      float lipX = 1.0 - smoothstep(0.0006, 0.0034, ld); // a trimmed moustache stops short of the lip line
      float bm = beardMask(h) * (1.0 - lipX) * (1.0 - slit);
      float full = hasF(flags, ${F(HF.BEARD)}) ? 1.0 : 0.0;
      float stub = hasF(flags, ${F(HF.STUBBLE)}) ? 1.0 : 0.0;
      float shadowStub = (1.0 - uFem) * 0.22;
      float bdens = bm * max(full, max(stub * 0.55, shadowStub));
      float bStrand = hN(P * 2400.0) * 0.6 + hN(vec3(P.x * 900.0, P.y * 2600.0, P.z * 900.0)) * 0.4;
      float bTone = hN(vec3(P.x * 700.0, P.y * 2200.0, P.z * 700.0));
      vec3 beardCol = hair * (0.55 + 0.6 * bStrand) * mix(vec3(1.0), vec3(1.35, 1.12, 0.95), smoothstep(0.6, 0.9, bTone));
      // individual hairs thin out toward the edges instead of fading like paint
      float fine = hN(P * 3600.0) * 0.5 + bStrand * 0.5;
      float fullCover = smoothstep(0.42, 0.58, fine + (bdens * (0.75 + 0.25 * sat((0.1 - h.y) / 0.02)) - 0.55) * 1.6) * (0.8 + 0.12 * bStrand);
      float cover = full > 0.5 ? mix(fullCover, bdens, 1.0 - det) : bdens * (0.5 + 0.5 * bStrand);
      col = mix(col, full > 0.5 ? beardCol : mix(col * vec3(0.8, 0.82, 0.86), beardCol, 0.35), cover);
      gHeight += full * bm * (bStrand - 0.5) * 0.00032 * det;
      gRough = mix(gRough, 0.62, full * bm); gSSS *= 1.0 - full * bm * 0.8; gAniso = max(gAniso, full * bm * 0.3); gShift = (hN(P * 160.0) - 0.5) * 0.5;
    }
    if (onHead > 0.5) {
      // scalp hair: soft irregular hairline, fades and buzz cuts let the skin show through
      if (!hasF(flags, ${F(HF.BALD)})) {
        float jit = hN(vec3(h.x * 180.0, h.y * 90.0, h.z * 180.0));
        float lineY = hairLine(h);
        float hd = smoothstep(-0.003, 0.007, h.y - lineY - (jit - 0.5) * 0.007);
        float a = abs(atan(h.x, h.z));
        float sides = smoothstep(0.85, 1.15, a);
        float fade = (hasF(flags, ${F(HF.FADE)}) || (uHairStyle > 0.5 && uHairStyle < 1.5)) ? 1.0 : 0.0;
        float buzz = (hasF(flags, ${F(HF.BUZZ)}) || uHairStyle > 1.5) ? 1.0 : 0.0;
        float dens = hd * mix(1.0, mix(0.6, 1.0, smoothstep(lineY + 0.004, lineY + 0.05, h.y)), fade * sides);
        dens *= mix(1.0, 0.6, buzz);
        vec3 sp = mix(vec3(P.x * 1500.0, P.y * 1500.0, P.z * 180.0), vec3(P.x * 1500.0, P.y * 180.0, P.z * 1500.0), sat(abs(vBindN.x) * 1.4));
        float s1 = hN(sp), s2 = hN(sp * 2.3 + 7.1);
        vec3 hc = hair * (0.6 + 0.55 * s1) * (0.85 + 0.25 * s2);
        float shortSkin = (fade * sides * (1.0 - smoothstep(lineY + 0.01, lineY + 0.05, h.y)) * 0.6 + buzz * 0.5) * (1.0 - s1 * 0.6);
        col = mix(col, hc, sat(dens * (1.0 - 0.45 * shortSkin)));
        gHeight += dens * (s1 * 0.6 + s2 * 0.4 - 0.5) * 0.0004 * det;
        gRough = mix(gRough, 0.62 + 0.1 * s2, dens); gSpec = mix(gSpec, 0.7, dens); gSSS *= 1.0 - dens;
        gSheen = dens * s1 * 0.5; gAniso = max(gAniso, dens); gShift = (hN(P * 140.0) - 0.5) * 0.4;
      }
    }
  } else if (reg == ${R.FOREARM} || reg == ${R.HAND} || reg == ${R.NAIL}) {
    float n = hN(P * 90.0) * 0.6 + hN(P * 23.0) * 0.4;
    col = skin * (0.93 + 0.12 * n);
    float pores = hN(P * 1300.0) * 0.6 + hN(P * 380.0) * 0.4;
    gHeight = (pores - 0.5) * 0.0001 * det; gRough = 0.52 + 0.1 * n; gSSS = 1.0; gSpec = 0.35;
    if (reg == ${R.HAND}) col = mix(col, col * vec3(1.06, 0.9, 0.88), smoothstep(0.55, 0.9, hN(P * 60.0)) * 0.35);
    if (reg == ${R.NAIL}) { col = mix(skin, vec3(0.93, 0.8, 0.76), 0.55); gRough = 0.28; gSSS = 0.3; }
    if (reg == ${R.FOREARM} && hasF(flags, ${F(HF.LONGSLEEVE)})) { col = uHasJacket > 0.5 ? shirt : top; gSSS = 0.0; gRough = 0.82; gHeight = (hN(P * 60.0) - 0.5) * 0.0004; }
    if (reg == ${R.HAND} && hasF(flags, ${F(HF.GLOVES)})) { col = vec3(0.045); gSSS = 0.0; gRough = 0.55; }
  } else if (reg == ${R.EYE}) {
    // eyeball: sclera, iris with fibres and a limbal ring, pupil; gaze moves the iris; the lid shades the top
    vec3 c = P.x > 0.0 ? uEyeL : uEyeR;
    vec3 e = (P - c) / uEyeR0;
    e.xy -= gaze * vec2(0.55, 0.45);
    float rr = length(e.xy);
    float front = smoothstep(-0.1, 0.2, e.z);
    vec3 irisCol = mix(vec3(0.2, 0.11, 0.05), vec3(0.3, 0.36, 0.16), step(0.72, irisHue));
    irisCol = mix(irisCol, vec3(0.2, 0.34, 0.5), step(0.9, irisHue));
    float ang = atan(e.y, e.x);
    float fib = 0.72 + 0.28 * sin(ang * 46.0 + hN(e * 20.0) * 6.0) * (0.6 + 0.4 * hN(vec3(ang * 8.0, rr * 30.0, 0.0)));
    vec3 sclera = mix(vec3(0.84, 0.8, 0.76), vec3(0.8, 0.6, 0.56), smoothstep(0.4, 1.0, abs(e.x)) * 0.4);
    col = sclera;
    float iris = front * (1.0 - smoothstep(0.46, 0.5, rr));
    vec3 ic = irisCol * fib * mix(0.5, 1.15, smoothstep(0.48, 0.22, rr));
    col = mix(col, ic, iris);
    col = mix(col, vec3(0.012), front * (1.0 - smoothstep(0.17, 0.2, rr)));
    gRough = 0.05; gSpec = 1.0; gSSS = 0.0;
    float lidY = (P.y - c.y) / uEyeR0;
    col *= mix(1.0, 0.45, smoothstep(0.05, 0.55, lidY));
    if (lidY > 1.0 - 2.1 * blink) { col = skin * 0.9; gRough = 0.5; gSSS = 1.0; gSpec = 0.3; }
  } else if (reg == ${R.TOP} || reg == ${R.VNECK} || reg == ${R.SLEEVE_U} || reg == ${R.SHIRT}) {
    // cotton jersey: tee, sleeves, neckline rib and hems
    col = (uHasJacket > 0.5 || reg == ${R.SHIRT}) ? shirt : top;
    if (reg == ${R.VNECK} && (hasF(flags, ${F(HF.JACKET)}) || uHasJacket > 0.5)) {
      col = shirt;
      if (hasF(flags, ${F(HF.TIE)}) && abs(P.x) < (0.016 + max(0.0, uTorsoPos.y + 0.46 * uK - P.y) * 0.05) * uK) col = vec3(0.42, 0.06, 0.1);
    }
    vec3 t = P - uTorsoPos;
    float knit = sin((P.x + P.z) * 5200.0) * sin(P.y * 2600.0);
    gHeight = knit * 0.000025 * det + (hN(P * 40.0) - 0.5) * 0.0004;
    col *= 0.95 + 0.08 * hN(P * 300.0);
    gRough = 0.86; gSpec = 0.35; gCloth = 1.0;
    float rad = length(vec2(t.x, t.z + 0.004 * uK)) / uK;
    float nb = (1.0 - smoothstep(0.078, 0.086, rad)) * step(0.4 * uK, t.y);
    if (reg != ${R.SHIRT} && nb > 0.0) { gHeight = sin(atan(t.x, t.z) * 110.0) * 0.00008 * det; col *= 0.94; }
    if (reg == ${R.SLEEVE_U}) {
      vec3 la = ((P.x > 0.0 ? uArmInvL : uArmInvR) * vec4(P, 1.0)).xyz / uK;
      float hem = smoothstep(-0.108, -0.114, la.y);
      float hs = (1.0 - smoothstep(0.0006, 0.0016, abs(la.y + 0.116))) * det2;
      col *= 1.0 - hem * 0.03 - hs * 0.12; gHeight += hem * 0.0001;
    }
    float bh = (1.0 - smoothstep(0.0006, 0.0016, abs((P.y - uPelvisPos.y) / uK - 0.045))) * det2 * step(t.y, 0.0);
    col *= 1.0 - bh * 0.12;
  } else if (reg == ${R.JACKET} || reg == ${R.RIB}) {
    col = top;
    vec3 t = P - uTorsoPos;
    if (reg == ${R.RIB}) { col = top * 0.74; gHeight = sin(atan(vBindN.x, vBindN.z) * 90.0 + P.y * 200.0) * 0.00012 * det + sin(P.y * 1400.0 + P.x * 60.0) * 0.00005 * det; gRough = 0.86; gSpec = 0.3; }
    else {
      // nylon / wool shell: soft wrinkles, stitched seams, a zipper along an open front
      gHeight = (hN(vec3(P.x * 30.0, P.y * 90.0, P.z * 30.0)) - 0.5) * 0.00018 + (hN(P * 700.0) - 0.5) * 0.00002 * det;
      gRough = 0.6; gSpec = 0.45; gCloth = 0.5; col *= 0.92 + 0.1 * hN(P * 25.0);
      if (uJacketOpen > 0.5 && uZip > 0.5 && t.z > 0.02 * uK) {
        float edgeX = (0.02 + max(0.0, t.y / uK - 0.1) * 0.12) * uK;
        float dz = abs(abs(t.x) - edgeX) / uK;
        float tape = 1.0 - smoothstep(0.004, 0.006, dz);
        float teeth = (1.0 - smoothstep(0.0012, 0.002, dz)) * step(0.5, fract(P.y * 420.0 / uK));
        col = mix(col, col * 0.55, tape); col = mix(col, vec3(0.62, 0.6, 0.55), teeth * det2);
        gRough = mix(gRough, 0.3, teeth); gHeight += teeth * 0.00012 * det;
      }
      float zline = 1.0 - smoothstep(0.0008, 0.002, abs(t.z / uK + 0.012));
      float shoulder = step(0.38 * uK, t.y) * step(0.07 * uK, abs(t.x)) * step(abs(t.x), 0.2 * uK);
      float sideS = step(t.y, 0.33 * uK) * step(0.12 * uK, abs(t.x));
      float seam = zline * max(shoulder, sideS) * det2;
      col *= 1.0 - seam * 0.3; gHeight -= seam * 0.00015;
    }
  } else if (reg == ${R.PELVIS} || reg == ${R.THIGH} || reg == ${R.SHIN}) {
    col = pants; gRough = 0.86; gSpec = 0.35; gCloth = 0.8;
    vec3 pp = P - uPelvisPos;
    float side = sign(P.x);
    if (hasF(flags, ${F(HF.DENIM)})) {
      // denim: twill, fades on thighs and knees, seams with gold stitching, pockets, yoke and waistband
      float tw = sin((P.x * side + P.y + P.z) * 2600.0);
      float slub = hN(vec3(P.x * 30.0, P.y * 400.0, P.z * 30.0));
      float fade = hN(vec3(P.x * 16.0, P.y * 5.0, P.z * 16.0));
      float thighFade = exp(-pow((pp.y / uK + 0.25) / 0.13, 2.0)) * smoothstep(0.0, 0.8, vBindN.z) * 0.35
                      + exp(-pow((pp.y / uK + 0.5) / 0.05, 2.0)) * smoothstep(0.2, 0.9, vBindN.z) * 0.25;
      col = pants * (0.86 + 0.18 * fade + 0.08 * slub) + vec3(0.03, 0.04, 0.06) * tw * det;
      col = mix(col, col * vec3(1.35, 1.35, 1.25) + vec3(0.02, 0.03, 0.05), sat(thighFade));
      gHeight = tw * 0.00004 * det + (slub - 0.5) * 0.00003 * det;
      float outer = (1.0 - smoothstep(0.035, 0.08, abs(vBindN.z))) * step(0.0, vBindN.x * side) * step(pp.y, -0.06 * uK);
      float inner = (1.0 - smoothstep(0.035, 0.08, abs(vBindN.z))) * step(vBindN.x * side, 0.0) * step(pp.y, -0.14 * uK);
      float seam = max(outer, inner);
      float stitch = seam * step(0.55, fract(P.y * 700.0)) * (1.0 - smoothstep(0.02, 0.05, abs(vBindN.z))) * det2;
      col = mix(col, col * 0.7, seam * 0.6);
      col = mix(col, ${STITCH}, stitch * 0.8);
      gHeight += seam * 0.0002;
      if (vBindN.z < -0.2) {
        vec2 q = vec2(abs(P.x) - 0.075 * uK, pp.y + 0.075 * uK) / uK;
        float inside = step(abs(q.x), 0.06) * step(q.y, 0.05) * step(-0.07 + abs(q.x) * 0.35, q.y);
        float inner2 = step(abs(q.x), 0.054) * step(q.y, 0.044) * step(-0.064 + abs(q.x) * 0.35, q.y);
        col = mix(col, ${STITCH}, (inside - inner2) * 0.7 * det2);
        gHeight += inside * 0.0003;
        float yokeY = -0.005 - max(0.0, 0.1 - abs(P.x) / uK) * 0.25;
        float yoke = 1.0 - smoothstep(0.001, 0.0022, abs(pp.y / uK - yokeY));
        col = mix(col, ${STITCH}, yoke * 0.6 * det2);
      } else if (vBindN.z > 0.2) {
        vec2 q = vec2(abs(P.x) / uK, pp.y / uK);
        float fp = (1.0 - smoothstep(0.0012, 0.0028, abs(length(vec2(q.x - 0.15, q.y - 0.075)) - 0.075))) * step(q.x, 0.15) * step(q.y, 0.075) * step(-0.01, q.y);
        float fly = (1.0 - smoothstep(0.001, 0.0024, abs(length(vec2(q.x + 0.01, q.y + 0.015)) - 0.035))) * step(q.y, 0.06) * step(-0.05, q.y) * step(0.0, P.x);
        col = mix(col, ${STITCH}, max(fp, fly) * 0.7 * det2);
        gHeight -= max(fp, fly) * 0.0002;
      }
      col *= 1.0 - step(0.035 * uK, pp.y) * 0.06;
    } else {
      // tailored trousers: fine wool with a pressed front crease
      gHeight = (hN(P * 900.0) - 0.5) * 0.00003 * det;
      float crease = (1.0 - smoothstep(0.02, 0.07, abs(vBindN.x))) * step(0.3, vBindN.z) * step(pp.y, -0.1 * uK);
      gHeight += crease * 0.0003; col *= 1.0 + crease * 0.05;
      gRough = 0.72; gSheen = 0.3;
    }
    gHeight += (hN(P * 35.0) - 0.5) * 0.0004;
  } else if (reg == ${R.SHOE} || reg == ${R.SOLE} || reg == ${R.LACE}) {
    col = reg == ${R.SOLE} ? mix(vec3(0.92), shoes, 0.25) : reg == ${R.LACE} ? mix(shoes, vec3(1.0), 0.6) : shoes;
    gRough = reg == ${R.SOLE} ? 0.85 : 0.42; gSpec = 0.6;
    gHeight = (hN(P * 800.0) - 0.5) * 0.00004 * det;
    if (reg == ${R.LACE}) gHeight += sin(P.z * 700.0) * 0.0002 * det;
    if (reg == ${R.SOLE}) gHeight += sin(P.y * 900.0) * 0.00008 * det;
    if (reg == ${R.SHOE}) { float st = step(0.5, fract((P.z + P.x) * 300.0)) * (1.0 - smoothstep(0.004, 0.006, abs(P.y - 0.03 * uK))); col = mix(col, col * 0.8, st * det2); }
  } else if (reg == ${R.HAT}) {
    col = hat; gRough = 0.7; gHeight = sin((P.x + P.z) * 1800.0) * 0.00004 * det + (hN(P * 50.0) - 0.5) * 0.0002;
  } else if (reg == ${R.HAIR_LONG}) {
    vec3 sp = vec3(P.x * 1600.0, P.y * 140.0, P.z * 1600.0);
    float s1 = hN(sp), s2 = hN(sp * 2.1 + 3.3);
    col = hair * (0.62 + 0.55 * s1) * (0.85 + 0.25 * s2);
    gHeight = (s1 * 0.6 + s2 * 0.4 - 0.5) * 0.0005 * det; gRough = 0.62 + 0.1 * s2; gSpec = 0.7; gSheen = s1 * 0.5; gAniso = 1.0; gShift = (hN(P * 120.0) - 0.5) * 0.4;
  } else if (reg == ${R.VEST}) { col = vec3(0.08, 0.09, 0.1); gRough = 0.78; gHeight = sin(P.y * 1300.0) * 0.00006 * det + (hN(P * 300.0) - 0.5) * 0.0001; }
  else if (reg == ${R.TIE}) { col = vec3(0.4, 0.06, 0.09); }
  else if (reg == ${R.BELT}) {
    col = vec3(0.16, 0.1, 0.06); gRough = 0.4; gSpec = 0.6;
    float buckle = step(abs(P.x), 0.022 * uK) * step(0.0, P.z);
    col = mix(col, vec3(0.7, 0.68, 0.62), buckle); gRough = mix(gRough, 0.25, buckle);
  }
  if (uDbg > 0.5 && uDbg < 1.5) col = vec3(hH(vec3(float(int(vRegion + 0.5)) * 1.7, 3.1, 7.3)), hH(vec3(float(int(vRegion + 0.5)) * 2.3, 1.1, 5.9)), hH(vec3(float(int(vRegion + 0.5)) * 0.9, 8.1, 2.7)));
  if (uDbg > 1.5) col = vec3(0.7);
  diffuseColor.rgb = col;
}
`;

const LIGHT = `
// ---- human direct lighting: standard PBR plus skin scattering, hair highlights and fabric sheen
void RE_Direct_Human( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float ndl = dot( geometryNormal, directLight.direction );
  vec3 lambert = BRDF_Lambert( material.diffuseColor );
  if ( gSSS > 0.0 ) {
    // light bleeding past the terminator with a blood-red tint (soft, not plastic)
    float wrapped = saturate( ( ndl + 0.5 ) / 1.5 );
    float extra = max( 0.0, wrapped - saturate( ndl ) );
    reflectedLight.directDiffuse += directLight.color * extra * vec3( 1.0, 0.42, 0.3 ) * lambert * gSSS * 0.5;
    // thin tissue (ears) glowing when lit from behind
    float back = pow( saturate( dot( geometryViewDir, - directLight.direction ) ), 3.0 ) * gThin;
    reflectedLight.directDiffuse += directLight.color * back * vec3( 1.0, 0.28, 0.18 ) * lambert * 0.9;
  }
  if ( gAniso > 0.0 ) {
    // strands run down from the crown: tangent = surface-projected up vector, jittered per strand
    vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
    vec3 T = normalize( upV - geometryNormal * dot( upV, geometryNormal ) + geometryNormal * gShift );
    vec3 H = normalize( directLight.direction + geometryViewDir );
    float th = dot( T, H );
    float s1 = pow( sqrt( max( 0.0, 1.0 - th * th ) ), 90.0 );
    float th2 = dot( normalize( T + geometryNormal * 0.25 ), H );
    float s2 = pow( sqrt( max( 0.0, 1.0 - th2 * th2 ) ), 24.0 );
    float vis = smoothstep( -0.1, 0.4, ndl );
    vec3 tint = mix( material.diffuseColor * 4.0, vec3( 0.9, 0.85, 0.8 ), 0.25 );
    reflectedLight.directSpecular += directLight.color * vis * gAniso * ( s1 * 0.05 * tint + s2 * 0.12 * material.diffuseColor * 2.0 );
  }
  if ( gCloth > 0.0 ) {
    // fuzz: cloth catches light at grazing angles
    float rim = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 3.0 );
    reflectedLight.directDiffuse += directLight.color * rim * saturate( ndl + 0.3 ) * material.diffuseColor * 0.12 * gCloth;
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Human
`;

function patchMaterial(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_COMMON)
      .replace('#include <beginnormal_vertex>', 'mat4 hSkinM = hSkin();\nvec3 objectNormal = normalize(mat3(hSkinM) * normal);\nvBind = position; vBindN = normal; vRegion = aRegion; vRow = iRow; vAO = aAO;')
      .replace('#include <begin_vertex>', SKIN_POS);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_COMMON)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + LIGHT)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n{ vec2 dH = vec2(dFdx(gHeight), dFdy(gHeight)) * 900.0; normal = fPerturb(-vViewPosition, normal, dH, faceDirection); }')
      .replace('#include <aomap_fragment>', `
  { float ao = vAO;
    reflectedLight.indirectDiffuse *= ao;
    reflectedLight.indirectSpecular *= ao * ao;
    reflectedLight.directDiffuse *= mix(1.0, ao, 0.45);
    reflectedLight.directSpecular *= mix(1.0, ao, 0.6); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  // outdoor bounce + sky fill (brighter on surfaces facing up), plus a warm subsurface-style glow for skin,
  // so people in shade or against the sun keep their colour instead of turning into silhouettes
  { vec3 wN = inverseTransformDirection(normal, viewMatrix);
    float hemi = 0.5 + 0.5 * wN.y;
    vec3 fillCol = mix(vec3(0.85, 0.78, 0.7), vec3(0.9, 0.97, 1.1), hemi) * (0.55 + 0.45 * hemi);
    totalEmissiveRadiance += diffuseColor.rgb * fillCol * uFill * (1.0 + gSSS * 0.6) * vAO;
    totalEmissiveRadiance += gSSS * diffuseColor.rgb * vec3(0.9, 0.32, 0.2) * uFill * 0.7 * vAO; }
  totalEmissiveRadiance += gSheen * diffuseColor.rgb * uFill * 0.4;`);
  };
  mat.customProgramCacheKey = () => 'human-v3';
}
function patchDepth(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_COMMON)
      .replace('#include <begin_vertex>', 'mat4 hSkinM = hSkin();\n' + SKIN_POS);
  };
  mat.customProgramCacheKey = () => 'human-depth-v2';
}

const _m = new THREE.Matrix4(), _s = new THREE.Matrix4(), _c = new THREE.Color();
const HAT_KEYS = { 1: 'police', 2: 'hard', 3: 'helmet', 4: 'cap' };
const LONG_HAIR = { 2: 'long', 3: 'ponytail', 4: 'bun', 5: 'curly' };
const GENERIC = new Set(['M', 'F', 'Msuit', 'Fsuit']);

export class HumanRenderer {
  static debug = { value: 0 };
  constructor(scene, max = 256) {
    this.scene = scene; this.max = max;
    this.data = new Float32Array(TEXW * max * 4);
    this.tex = new THREE.DataTexture(this.data, TEXW, max, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = THREE.NearestFilter; this.tex.minFilter = THREE.NearestFilter; this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    this.fill = { value: 0.08 };
    this.models = new Map();
    this.rows = 0;
    this.shadowRange = 45;
    this.lodScale = 1;
  }
  /**
   * Register a model (key) with LOD geometries [g0, g1, ...] and the max view distance of each LOD.
   * opts: { shadowLod, overlays: { name: [g0, g1] } }  (overlays share the base's bind pose)
   */
  addModel(key, geos, lodDist = [1e9], opts = {}) {
    const g0 = geos[0];
    const sp = g0.userData.spec, k = sp.k ?? 1, w = sp.w ?? 1;
    const inv = g0.userData.inv, bind = g0.userData.bind;
    const pos = (b) => new THREE.Vector3().setFromMatrixPosition(bind[b]);
    const eyes = [1, -1].map(sx => new THREE.Vector3(sx * 0.0315 * k, 0.151 * k, 0.0795 * k).applyMatrix4(bind[J.HEAD]));
    const of = sp.outfit || {};
    const uniforms = {
      tBones: { value: this.tex }, uFill: this.fill, uEyeL: { value: eyes[0] }, uEyeR: { value: eyes[1] }, uEyeR0: { value: 0.012 * k },
      uHeadPos: { value: pos(J.HEAD) }, uTorsoPos: { value: pos(J.TORSO) }, uPelvisPos: { value: pos(J.PELVIS) }, uK: { value: k }, uFem: { value: sp.fem ? 1 : 0 },
      uHasJacket: { value: of.jacket ? 1 : 0 }, uJacketOpen: { value: of.jacketOpen ? 1 : 0 }, uZip: { value: of.jacket === 'bomber' || of.jacket === 'leather' ? 1 : 0 },
      uHairStyle: { value: sp.hair === 'fade' ? 1 : sp.hair === 'buzz' ? 2 : 0 },
      uArmInvL: { value: inv[J.UARM_L] }, uArmInvR: { value: inv[J.UARM_R] }, uDbg: HumanRenderer.debug,
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
    mat.envMapIntensity = 1.1;
    patchMaterial(mat, uniforms);
    const depth = new THREE.MeshDepthMaterial(); patchDepth(depth, uniforms);
    const mk = (g, layer, name) => {
      const ig = new THREE.InstancedBufferGeometry();
      ig.index = g.index;
      for (const a of ['position', 'normal', 'aSkin', 'aW', 'aRegion', 'aSway', 'aAO']) ig.setAttribute(a, g.attributes[a]);
      const rowAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.max), 1); rowAttr.setUsage(THREE.DynamicDrawUsage);
      ig.setAttribute('iRow', rowAttr);
      ig.instanceCount = 0;
      ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      const mesh = new THREE.Mesh(ig, mat);
      mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.visible = false;
      if (layer === 1) { mesh.castShadow = true; mesh.layers.set(1); mesh.customDepthMaterial = depth; }
      else mesh.castShadow = false;
      mesh.name = 'human_' + name;
      this.scene.add(mesh);
      return { mesh, ig, rowAttr, n: 0 };
    };
    const shadowLod = opts.shadowLod ?? geos.length - 1;
    const overlays = new Map();
    for (const [name, list] of Object.entries(opts.overlays || {})) overlays.set(name, list.map((g, i) => mk(g, 0, key + ':' + name + i)));
    const model = { key, k, w, inv, lods: geos.map((g, i) => mk(g, 0, key + i)), lodDist, shadow: mk(geos[shadowLod], 1, key + 'S'), overlays, mat, uniforms };
    this.models.set(key, model);
    return model;
  }
  hasModel(key) { return this.models.has(key); }
  /** Pick the model and pack the look of a rig (cached on the rig). */
  _look(rig) {
    if (rig._look) return rig._look;
    const a = rig.app;
    const suit = a.fem ? 'Fsuit' : 'Msuit';
    const key = a.model && this.models.has(a.model) ? a.model : a.role === 'player' && this.models.has('player') ? 'player'
      : a.role === 'business' && this.models.has(suit) ? suit : (a.fem ? 'F' : 'M');
    const model = this.models.get(key) || this.models.get('M');
    const dedicated = !GENERIC.has(key);
    let flags = 0;
    const hair = a.hair ?? 0;
    if (a.beard && !a.fem) flags |= dedicated ? HF.BEARD : ((a.skin >> 3) & 1) ? HF.BEARD : HF.STUBBLE;
    if (!dedicated) {
      if (hair === 7) flags |= HF.BALD;
      if (hair === 6) flags |= HF.FADE;
      if (hair === 1 && !a.fem && ((a.skin >> 5) & 1)) flags |= HF.BUZZ;
    }
    if (a.fem && ((a.skin >> 2) & 1)) flags |= HF.MAKEUP;
    if (a.tie) flags |= HF.TIE;
    if (a.jacket || a.role === 'business') flags |= HF.JACKET;
    if (a.sleeves === 0 || a.jacket) flags |= HF.LONGSLEEVE;
    if (a.sleeves === 2 && !a.jacket) flags |= HF.SLEEVELESS;
    if (a.shorts) flags |= HF.SHORTS;
    if (a.role === 'swat') flags |= HF.GLOVES;
    if (a.denim ?? (a.pants === 0x1f3a5f || a.pants === 0x2c3e50 || a.pants === 0x1f2a3a || a.pants === 0x4a5a6a)) flags |= HF.DENIM;
    const hatCol = a.hat === 1 ? 0x121c2c : a.hat === 2 ? 0xf1c40f : a.hat === 3 ? 0x1c1c1c : a.hatColor ?? a.shirt;
    const lin = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };
    const ov = [];
    if (model && !dedicated) {
      if (a.hat && model.overlays.has(HAT_KEYS[a.hat])) ov.push(model.overlays.get(HAT_KEYS[a.hat]));
      else if (LONG_HAIR[hair] && (a.fem || hair === 5) && model.overlays.has(LONG_HAIR[hair])) ov.push(model.overlays.get(LONG_HAIR[hair]));
      if (a.vest && model.overlays.has('vest')) ov.push(model.overlays.get('vest'));
    }
    const seed = ((a.skin * 13 + (a.shirt || 0) * 7) >>> 0) % 997 / 997;
    rig._look = {
      key, model, ov, flags, skin: lin(a.skin), hair: lin(a.hairColor ?? 0x222222), top: lin(a.jacket || a.shirt), shirt: lin(a.shirt), pants: lin(a.pants), shoes: lin(a.shoes), hat: lin(hatCol),
      iris: a.iris ?? seed,
    };
    return rig._look;
  }
  _writeRow(row, rig, model, look) {
    const d = this.data, base = row * TEXW * 4, W = rig.world, inv = model.inv;
    const sk = rig.k / model.k, sw = rig.w / model.w;
    _s.makeScale(sw * sk, sk, sw * sk);
    for (let b = 1; b < NB; b++) {
      _m.multiplyMatrices(W[b], _s).multiply(inv[b]);
      d.set(_m.elements, base + b * 16);
    }
    const o = base + DATA0 * 4;
    const put = (i, c, a) => { d[o + i * 4] = c[0]; d[o + i * 4 + 1] = c[1]; d[o + i * 4 + 2] = c[2]; d[o + i * 4 + 3] = a; };
    const ex = rig.expr || { brow: 0, smile: 0, squint: 0 };
    put(0, look.skin, look.flags); put(1, look.hair, rig.blink || 0); put(2, look.top, rig.gaze ? rig.gaze.x : 0); put(3, look.shirt, rig.gaze ? rig.gaze.y : 0);
    put(4, look.pants, ex.brow); put(5, look.shoes, look.iris); put(6, look.hat, ex.smile);
    const sw3 = rig.sway || { x: 0, y: 0, z: 0 };
    d[o + 28] = sw3.x; d[o + 29] = sw3.y; d[o + 30] = sw3.z; d[o + 31] = ex.squint;
  }
  /** Render all visible rigs: pick LODs, pack rows, fill instance lists. */
  render(rigs, cameraPos = null, maxDist = 180, shadowFocus = null) {
    for (const m of this.models.values()) { for (const l of m.lods) l.n = 0; m.shadow.n = 0; for (const o of m.overlays.values()) for (const l of o) l.n = 0; }
    let row = 0;
    const md2 = maxDist * maxDist, sr = this.shadowRange;
    for (const rig of rigs) {
      if (!rig.visible || row >= this.max) continue;
      const rp = rig.root.position;
      let d2 = 0;
      if (cameraPos) { const dx = rp.x - cameraPos.x, dz = rp.z - cameraPos.z, dy = rp.y - cameraPos.y; d2 = dx * dx + dz * dz + dy * dy; if (d2 > md2) continue; }
      const look = this._look(rig);
      const model = look.model;
      if (!model) continue;
      const dist = Math.sqrt(d2);
      let li = 0; while (li < model.lods.length - 1 && dist > model.lodDist[li] * this.lodScale) li++;
      this._writeRow(row, rig, model, look);
      const L = model.lods[li]; L.rowAttr.array[L.n++] = row;
      for (const o of look.ov) { const ol = o[Math.min(li, o.length - 1)]; ol.rowAttr.array[ol.n++] = row; }
      if (shadowFocus && Math.abs(rp.x - shadowFocus.x) < sr && Math.abs(rp.z - shadowFocus.z) < sr) { const S = model.shadow; S.rowAttr.array[S.n++] = row; }
      row++;
    }
    this.rows = row;
    const fin = (l) => { l.ig.instanceCount = l.n; l.mesh.visible = l.n > 0; if (l.n) { l.rowAttr.needsUpdate = true; l.rowAttr.clearUpdateRanges(); l.rowAttr.addUpdateRange(0, l.n); } };
    for (const m of this.models.values()) { for (const l of m.lods) fin(l); fin(m.shadow); for (const o of m.overlays.values()) for (const l of o) fin(l); }
    if (row) this.tex.needsUpdate = true;
  }
  /** Triangles and draws submitted last frame (diagnostics). */
  stats() {
    let tris = 0, draws = 0;
    for (const m of this.models.values()) for (const l of [...m.lods, ...[...m.overlays.values()].flat()]) if (l.n) { draws++; tris += l.n * l.ig.index.count / 3; }
    return { rows: this.rows, draws, tris: Math.round(tris) };
  }
}
