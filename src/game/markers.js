// Immediate-mode world markers (glowing columns, ground rings, race checkpoints, floating arrows)
// and spinning pickups. Call begin() each frame, add markers, then end().
import * as THREE from 'three';

const VS = `
varying vec2 vUv; varying vec3 vCol;
void main(){ vUv = uv; vCol = instanceColor; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const FS_COLUMN = `
uniform float uTime; varying vec2 vUv; varying vec3 vCol;
void main(){ float a = pow(1.0 - vUv.y, 1.6) * (0.55 + 0.12 * sin(uTime * 3.0 - vUv.y * 9.0)); gl_FragColor = vec4(vCol * a, a); }`;
const FS_RING = `
uniform float uTime; varying vec2 vUv; varying vec3 vCol;
void main(){ float a = 0.85 + 0.15 * sin(uTime * 4.0); gl_FragColor = vec4(vCol * a, a); }`;

class Pool {
  constructor(scene, geo, fs, max, order) {
    this.uniforms = { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; this.mesh.count = 0; this.max = max;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._c = new THREE.Color();
  }
  add(x, y, z, sx, sy, sz, color, yaw = 0, pitch = 0) {
    const m = this.mesh; if (m.count >= this.max) return;
    this._q.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    this._m.compose(this._p.set(x, y, z), this._q, this._s.set(sx, sy, sz));
    m.setMatrixAt(m.count, this._m); this._c.set(color); m.instanceColor.setXYZ(m.count, this._c.r, this._c.g, this._c.b); m.count++;
  }
  begin() { this.mesh.count = 0; }
  end(t) { this.uniforms.uTime.value = t; this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
}

export class Markers {
  constructor(scene) {
    const col = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true); col.translate(0, 0.5, 0);
    this.columns = new Pool(scene, col, FS_COLUMN, 64);
    const ring = new THREE.RingGeometry(0.88, 1, 48); ring.rotateX(-Math.PI / 2);
    this.rings = new Pool(scene, ring, FS_RING, 64);
    const hoop = new THREE.TorusGeometry(1, 0.06, 8, 48);
    this.hoops = new Pool(scene, hoop, FS_RING, 16);
    // floating chevron
    const shape = new THREE.Shape(); shape.moveTo(-0.6, 0.5); shape.lineTo(0, -0.3); shape.lineTo(0.6, 0.5); shape.lineTo(0.35, 0.5); shape.lineTo(0, 0.05); shape.lineTo(-0.35, 0.5); shape.closePath();
    const arrow = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }); arrow.translate(0, 0, -0.06);
    this.arrows = new Pool(scene, arrow, FS_RING, 32);
    this.t = 0;
  }
  begin() { for (const p of [this.columns, this.rings, this.hoops, this.arrows]) p.begin(); }
  end(dt) { this.t += dt; for (const p of [this.columns, this.rings, this.hoops, this.arrows]) p.end(this.t); }
  column(x, y, z, r = 1.4, h = 5, color = 0xffc857) { this.columns.add(x, y, z, r, h, r, color); this.rings.add(x, y + 0.06, z, r * 1.15, 1, r * 1.15, color); }
  ring(x, y, z, r, color) { this.rings.add(x, y + 0.08, z, r, 1, r, color); }
  checkpoint(x, y, z, yaw, r = 7, color = 0xff4fd8) { this.hoops.add(x, y + r * 0.85, z, r, r, r, color, yaw); this.rings.add(x, y + 0.08, z, r * 0.8, 1, r * 0.8, color); }
  arrow(x, y, z, color = 0xffc857, s = 1) { const b = Math.sin(this.t * 3) * 0.25; this.arrows.add(x, y + b, z, s, s, s, color, this.t * 1.5); }
}

// ---------------------------------------------------------------- pickups
const PICKUP_COLORS = { health: 0x3ddc84, armor: 0x3d9bff, cash: 0x9df2b6, token: 0xffc857, weapon: 0xff9f43, item: 0xff5e62 };
export class PickupRenderer {
  constructor(scene, weaponGeo) {
    this.scene = scene; this.group = new THREE.Group(); scene.add(this.group);
    const mk = (color, emissive = 0.4, metal = 0.3) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: emissive, roughness: 0.35, metalness: metal });
    const cross = new THREE.Group();
    cross.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.16), mk(0xffffff, 0.2)), new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), mk(0xffffff, 0.2)));
    const hbox = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.3), mk(0x2bb673, 0.35)); cross.children.forEach(c => { c.position.z = 0.16; });
    const health = new THREE.Group(); health.add(hbox, cross);
    const armor = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.1, 6), mk(0x3d7bff, 0.35, 0.6)); armor.rotation.x = Math.PI / 2;
    const cash = new THREE.Group(); for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.26), mk(0x5fbf6a, 0.25, 0.1)); b.position.y = i * 0.085; b.rotation.y = i * 0.2; cash.add(b); }
    const token = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 28), mk(0xffc23d, 0.55, 0.9)); token.rotation.x = Math.PI / 2;
    const sun = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 6, 24), mk(0xfff0b0, 0.8, 0.9)); sun.position.z = 0.05; const tokenG = new THREE.Group(); tokenG.add(token, sun);
    const item = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.38, 0.14), mk(0x9a1f2f, 0.3, 0.2));
    this.proto = { health, armor, cash, token: tokenG, item, weapon: weaponGeo };
    this.items = [];
  }
  add(p) {
    let obj;
    if (p.type === 'weapon') { const g = this.proto.weapon[p.weapon]; obj = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6, emissive: 0xff9f43, emissiveIntensity: 0.25 })); obj.scale.setScalar(1.6); }
    else obj = this.proto[p.type].clone();
    obj.position.set(p.x, p.y, p.z);
    this.group.add(obj);
    p.obj = obj;
    return p;
  }
  remove(p) { if (p.obj) { this.group.remove(p.obj); p.obj = null; } }
  update(dt, time, cam) {
    for (const c of this.group.children) {
      c.rotation.y += dt * 1.8;
      c.visible = c.position.distanceToSquared(cam) < 160 * 160;
    }
  }
}
export { PICKUP_COLORS };
