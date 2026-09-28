// Pooled decals: tire skid ribbons, bullet holes, scorch marks.
//   const D = new Decals(scene) ; D.skid(key, x, y, z, alpha) (continuous per wheel key; call D.skidEnd(key) when it stops)
//   D.bulletHole(pos, normal) ; D.scorch(pos, radius)
import * as THREE from 'three';

class QuadPool {
  constructor(scene, max, mat, order = 3) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 4 * 3); this.uv = new Float32Array(max * 4 * 2); this.alpha = new Float32Array(max * 4);
    const idx = [];
    for (let q = 0; q < max; q++) { const b = q * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
    scene.add(this.mesh);
  }
  push(a, b, c, d, alpha = 1, uvs = [0, 0, 1, 0, 1, 1, 0, 1]) {
    const q = this.i; this.i = (this.i + 1) % this.max;
    this.pos.set(a, q * 12); this.pos.set(b, q * 12 + 3); this.pos.set(c, q * 12 + 6); this.pos.set(d, q * 12 + 9);
    this.uv.set(uvs, q * 8);
    for (let k = 0; k < 4; k++) this.alpha[q * 4 + k] = alpha;
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true; this.geo.attributes.aAlpha.needsUpdate = true;
  }
}
function decalMat(tex, color, opacity = 1) {
  const m = new THREE.MeshStandardMaterial({ map: tex, color, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8, roughness: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAlpha; varying float vAlpha;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlpha;').replace('#include <map_fragment>', `#include <map_fragment>\ndiffuseColor.a *= vAlpha * ${opacity.toFixed(2)};`);
  };
  m.customProgramCacheKey = () => 'decal' + opacity;
  return m;
}
function radialTex(inner = '#000', soft = true) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(soft ? 0.3 : 0.55, 'rgba(0,0,0,0.9)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}
function skidTex() {
  const c = document.createElement('canvas'); c.width = 32; c.height = 64; const g = c.getContext('2d');
  for (let x = 0; x < 32; x++) { const a = Math.max(0, Math.sin(x / 31 * Math.PI)) * (0.6 + 0.4 * Math.random()); g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(x, 0, 1, 64); }
  const t = new THREE.CanvasTexture(c); t.wrapT = THREE.RepeatWrapping; return t;
}
export class Decals {
  constructor(scene) {
    this.skids = new QuadPool(scene, 2400, decalMat(skidTex(), 0x111111, 0.75), 4);
    this.holes = new QuadPool(scene, 300, decalMat(radialTex('#000', false), 0x151515, 1), 4);
    this.scorches = new QuadPool(scene, 40, decalMat(radialTex('#000', true), 0x0a0a0a, 0.85), 4);
    this.last = new Map();
  }
  skid(key, x, y, z, alpha = 1, width = 0.24) {
    const p = this.last.get(key);
    if (p) {
      const dx = x - p.x, dz = z - p.z, l = Math.hypot(dx, dz);
      if (l < 0.35) return;
      if (l < 4) {
        const nx = -dz / l * width / 2, nz = dx / l * width / 2;
        this.skids.push([p.x + nx, p.y + 0.02, p.z + nz], [p.x - nx, p.y + 0.02, p.z - nz], [x - nx, y + 0.02, z - nz], [x + nx, y + 0.02, z + nz], alpha, [0, 0, 1, 0, 1, l / 2, 0, l / 2]);
      }
      p.x = x; p.y = y; p.z = z;
    } else this.last.set(key, { x, y, z });
  }
  skidEnd(key) { this.last.delete(key); }
  bulletHole(pos, n, size = 0.09) {
    const up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const t = new THREE.Vector3().crossVectors(up, n).normalize().multiplyScalar(size), b = new THREE.Vector3().crossVectors(n, t).normalize().multiplyScalar(size);
    const c = new THREE.Vector3().copy(pos).addScaledVector(n, 0.01);
    const P = (sx, sy) => [c.x + t.x * sx + b.x * sy, c.y + t.y * sx + b.y * sy, c.z + t.z * sx + b.z * sy];
    this.holes.push(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), 1);
  }
  scorch(pos, r = 3) {
    const y = pos.y + 0.04;
    this.scorches.push([pos.x - r, y, pos.z + r], [pos.x + r, y, pos.z + r], [pos.x + r, y, pos.z - r], [pos.x - r, y, pos.z - r], 1);
  }
}
