// Third-person camera: orbit on foot, over-the-shoulder aim, chase cam for vehicles, collision + shake.
//   const cam = new GameCamera(camera, collision) ; cam.update(dt, { mode, target, yaw, pitch, vehicle, aiming, lookBehind })
import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, angleDiff } from '../core/math.js';

const IGNORE = new Set(['breakable', 'prop', 'fence', 'rail', 'curb', 'piling']);
export class GameCamera {
  constructor(camera, collision) {
    this.camera = camera; this.collision = collision;
    this.yaw = 0; this.pitch = 0.18; this.dist = 4.5; this.curDist = 4.5;
    this.pivot = new THREE.Vector3(); this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.shakeAmt = 0; this.shakeT = 0; this.fovBase = 62; this.fovKick = 0;
    this.idleT = 0; this.mode = 'foot'; this.sideOff = 0;
    this.cinematic = null; this.vehicleCamIndex = 0;
    this._t = new THREE.Vector3(); this._d = new THREE.Vector3();
  }
  shake(a) { this.shakeAmt = Math.min(1.5, this.shakeAmt + a); }
  /** Mouse look input (radians). */
  rotate(dx, dy) { this.yaw -= dx; this.pitch = clamp(this.pitch + dy, -1.1, 1.3); if (Math.abs(dx) + Math.abs(dy) > 1e-4) this.idleT = 0; }
  forwardYaw() { return this.yaw; }
  update(dt, o) {
    this.idleT += dt;
    const cam = this.camera;
    let targetDist, height, side = 0, fov = this.fovBase;
    const p = this.pivot;
    if (o.mode === 'vehicle' && o.vehicle) {
      const v = o.vehicle, S = v.spec;
      const vYaw = v.yaw;
      const sp = v.speed;
      // auto-center behind the car when driving and no mouse input
      if (this.idleT > 1.2 && sp > 3) this.yaw = dampAngle(this.yaw, vYaw + (v.fwdSpeed < -1 ? Math.PI : 0), 2.5, dt);
      if (this.idleT > 1.2 && sp > 3) this.pitch = damp(this.pitch, 0.16, 2, dt);
      const size = Math.max(S.L, 4);
      const views = [[1.25, 0.42], [1.8, 0.62], [0.9, 0.3]];
      const [dk, hk] = views[this.vehicleCamIndex % views.length];
      targetDist = size * dk + sp * 0.04; height = S.H * hk + 1.0;
      v.origin(this._t);
      p.set(this._t.x, this._t.y + S.H * 0.75 + 0.3, this._t.z);
      fov = this.fovBase + clamp(sp - 15, 0, 40) * 0.35;
    } else {
      const t = o.target;
      const aim = o.aiming;
      targetDist = aim ? 1.9 : (o.sprinting ? 4.9 : 4.2);
      side = aim ? -0.62 : 0;
      height = aim ? 0.05 : 0.12;
      p.set(t.x, t.y + (o.crouch ? 1.1 : 1.55), t.z);
      if (o.swimming) p.y = t.y + 0.9;
      fov = aim ? this.fovBase - 12 : this.fovBase;
    }
    this.sideOff = damp(this.sideOff, side, 10, dt);
    this.fovKick = damp(this.fovKick, fov, 4, dt);
    cam.fov = this.fovKick; cam.updateProjectionMatrix();
    let yaw = this.yaw, pitch = this.pitch;
    if (o.lookBehind) yaw += Math.PI;
    // desired position: behind the pivot along -forward(yaw), raised by pitch
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = -fz, rz = fx; // right
    const cp = Math.cos(pitch), spc = Math.sin(pitch);
    const pivot = this._t.set(p.x + rx * this.sideOff, p.y + height, p.z + rz * this.sideOff);
    const dir = this._d.set(-fx * cp, spc, -fz * cp);
    // collision
    let dist = targetDist;
    const hit = this.collision.raycast(pivot.x, pivot.y, pivot.z, dir.x, dir.y, dir.z, targetDist + 0.3, { ignoreTags: IGNORE });
    if (hit) dist = Math.max(0.6, hit.t - 0.3);
    // avoid going under water/terrain
    this.curDist = dist < this.curDist ? dist : damp(this.curDist, dist, 3, dt);
    this.pos.copy(pivot).addScaledVector(dir, this.curDist);
    const gh = this.collision.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < gh + 0.4) this.pos.y = gh + 0.4;
    // shake
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
    this.shakeT += dt * 40;
    const s = this.shakeAmt * this.shakeAmt * 0.18;
    cam.position.set(this.pos.x + Math.sin(this.shakeT * 1.3) * s, this.pos.y + Math.sin(this.shakeT * 1.7 + 1) * s, this.pos.z + Math.sin(this.shakeT * 1.1 + 2) * s);
    this.look.set(pivot.x + fx * cp * 10, pivot.y - spc * 10, pivot.z + fz * cp * 10);
    if (this.cinematic) {
      const c = this.cinematic; c.t += dt;
      cam.position.lerpVectors(c.from, c.to, Math.min(1, c.t / c.dur));
      this.look.copy(c.look);
      if (c.t > c.dur + (c.hold || 0)) this.cinematic = null;
    }
    cam.lookAt(this.look);
    cam.updateMatrixWorld();
  }
  /** Direction the camera aims (for shooting): from camera through screen center. */
  aimRay(outOrigin, outDir) {
    outOrigin.copy(this.camera.position);
    this.camera.getWorldDirection(outDir);
    return outDir;
  }
}
