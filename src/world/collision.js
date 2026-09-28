// CollisionWorld: static colliders (vertical prisms) in a uniform-grid spatial hash + terrain.
//   addBox({cx,cz,hx,hz,rot,minY,maxY,tag,data}) -> id     (OBB in XZ, rot = yaw like Object3D.rotation.y)
//   addCylinder({x,z,r,minY,maxY,tag,data}) -> id
//   addRamp({cx,cz,hx,hz,rot,y0,y1,base,tag,data}) -> id  (top rises from y0 at local z=-hz to y1 at +hz)
//   remove(id), setEnabled(id, on), get(id)
//   groundHeight(x,z,y,step) / groundInfo(x,z,y,step,out)
//   collideCircle(x,z,r,y0,y1,out[]) -> n   contacts {nx,nz,depth,px,pz,id,tag,data}  (normal pushes the moving shape out)
//   collideOBB(cx,cz,hx,hz,rot,y0,y1,out[]) -> n
//   raycast(ox,oy,oz,dx,dy,dz,maxDist,opts{ignoreTags:Set, water:bool, terrain:bool}) -> hit|null {t,x,y,z,nx,ny,nz,id,tag,data}
//   lineOfSight(ax,ay,az,bx,by,bz,ignoreTags) -> bool
const BOX = 0, CYL = 1, RAMP = 2;

function mkContact() { return { nx: 0, nz: 0, depth: 0, px: 0, pz: 0, id: -1, tag: '', data: null }; }

export class CollisionWorld {
  constructor(terrain, { minX = -1600, minZ = -1700, maxX = 1600, maxZ = 1300, cell = 16 } = {}) {
    this.terrain = terrain;
    this.minX = minX; this.minZ = minZ; this.cell = cell;
    this.cx = Math.ceil((maxX - minX) / cell); this.cz = Math.ceil((maxZ - minZ) / cell);
    this.cells = new Array(this.cx * this.cz).fill(null);
    this.colliders = [];
    this.stamp = 1;
    this._contacts = [];
    this.waterLevel = terrain ? terrain.waterLevel : -1.5;
  }
  _cellRange(x0, z0, x1, z1, out) {
    out[0] = Math.max(0, Math.floor((x0 - this.minX) / this.cell));
    out[1] = Math.max(0, Math.floor((z0 - this.minZ) / this.cell));
    out[2] = Math.min(this.cx - 1, Math.floor((x1 - this.minX) / this.cell));
    out[3] = Math.min(this.cz - 1, Math.floor((z1 - this.minZ) / this.cell));
    return out;
  }
  _insert(c) {
    const ext = c.type === CYL ? c.r : Math.abs(c.hx * c.c) + Math.abs(c.hz * c.s);
    const ezt = c.type === CYL ? c.r : Math.abs(c.hx * c.s) + Math.abs(c.hz * c.c);
    c.ex = ext; c.ez = ezt;
    const r = this._cellRange(c.x - ext, c.z - ezt, c.x + ext, c.z + ezt, [0, 0, 0, 0]);
    c.cells = [];
    for (let iz = r[1]; iz <= r[3]; iz++) for (let ix = r[0]; ix <= r[2]; ix++) {
      const k = iz * this.cx + ix;
      if (!this.cells[k]) this.cells[k] = [];
      this.cells[k].push(c);
      c.cells.push(k);
    }
    return c.id;
  }
  _base(type, o) {
    const rot = o.rot || 0;
    const c = { id: this.colliders.length, type, x: o.cx ?? o.x, z: o.cz ?? o.z, hx: o.hx || 0, hz: o.hz || 0, r: o.r || 0,
      rot, c: Math.cos(rot), s: Math.sin(rot), minY: o.minY ?? 0, maxY: o.maxY ?? 1, y0: o.y0 ?? 0, y1: o.y1 ?? 0,
      tag: o.tag || 'static', data: o.data ?? null, enabled: true, stamp: 0, ex: 0, ez: 0, cells: null };
    this.colliders.push(c);
    return c;
  }
  addBox(o) { return this._insert(this._base(BOX, o)); }
  addCylinder(o) { return this._insert(this._base(CYL, o)); }
  addRamp(o) {
    const c = this._base(RAMP, o);
    c.minY = o.base ?? Math.min(o.y0, o.y1) - 0.5;
    c.maxY = Math.max(o.y0, o.y1);
    return this._insert(c);
  }
  get(id) { return this.colliders[id]; }
  setEnabled(id, on) { const c = this.colliders[id]; if (c) c.enabled = on; }
  remove(id) {
    const c = this.colliders[id]; if (!c || !c.cells) return;
    for (const k of c.cells) { const l = this.cells[k]; const i = l.indexOf(c); if (i >= 0) l.splice(i, 1); }
    c.cells = null; c.enabled = false;
  }
  // --- local transforms
  _local(c, x, z, out) { const dx = x - c.x, dz = z - c.z; out.x = c.c * dx - c.s * dz; out.z = c.s * dx + c.c * dz; return out; }
  _rampTop(c, lz) { const t = (lz + c.hz) / (2 * c.hz); return c.y0 + (c.y1 - c.y0) * (t < 0 ? 0 : t > 1 ? 1 : t); }

  /** Highest walkable surface at (x,z) that is <= y + step. */
  groundHeight(x, z, y = 1e4, step = 0.5) {
    let h = this.terrain ? this.terrain.heightAt(x, z) : 0;
    const ix = Math.floor((x - this.minX) / this.cell), iz = Math.floor((z - this.minZ) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.cx || iz >= this.cz) return h;
    const l = this.cells[iz * this.cx + ix];
    if (!l) return h;
    const lim = y + step, L = this._tmpL || (this._tmpL = { x: 0, z: 0 });
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (!c.enabled || c.maxY <= h) continue;
      let top;
      if (c.type === CYL) {
        const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz > c.r * c.r) continue; top = c.maxY;
      } else {
        this._local(c, x, z, L);
        if (L.x < -c.hx || L.x > c.hx || L.z < -c.hz || L.z > c.hz) continue;
        top = c.type === RAMP ? this._rampTop(c, L.z) : c.maxY;
      }
      if (top <= lim && top > h) h = top;
    }
    return h;
  }
  /** Like groundHeight but also returns the surface normal and collider id (-1 = terrain). */
  groundInfo(x, z, y, step, out) {
    const t = this.terrain;
    let h = t ? t.heightAt(x, z) : 0, id = -1, best = null;
    const ix = Math.floor((x - this.minX) / this.cell), iz = Math.floor((z - this.minZ) / this.cell);
    const l = (ix >= 0 && iz >= 0 && ix < this.cx && iz < this.cz) ? this.cells[iz * this.cx + ix] : null;
    const lim = y + step, L = this._tmpL || (this._tmpL = { x: 0, z: 0 });
    if (l) for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (!c.enabled || c.maxY <= h) continue;
      let top;
      if (c.type === CYL) { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz > c.r * c.r) continue; top = c.maxY; }
      else {
        this._local(c, x, z, L);
        if (L.x < -c.hx || L.x > c.hx || L.z < -c.hz || L.z > c.hz) continue;
        top = c.type === RAMP ? this._rampTop(c, L.z) : c.maxY;
      }
      if (top <= lim && top > h) { h = top; id = c.id; best = c; }
    }
    out.height = h; out.id = id; out.collider = best;
    if (best) {
      if (best.type === RAMP) {
        const k = (best.y1 - best.y0) / (2 * best.hz); // dy/dlz; local normal (0,1,-k) -> world
        const nl = 1 / Math.sqrt(1 + k * k), nlz = -k * nl;
        out.nx = best.s * nlz; out.ny = nl; out.nz = best.c * nlz;
      } else { out.nx = 0; out.ny = 1; out.nz = 0; }
      out.surface = best.tag === 'pier' ? 'wood' : (best.tag === 'ramp' ? 'wood' : (best.data && best.data.surface) || 'concrete');
    } else {
      if (t) { t.normalAt(x, z, out); out.surface = t.surfaceAt(x, z); } else { out.nx = 0; out.ny = 1; out.nz = 0; out.surface = 'asphalt'; }
      // normalAt writes x,y,z
      if (t) { out.nx = out.x; out.ny = out.y; out.nz = out.z; }
    }
    return out;
  }

  _visit(x0, z0, x1, z1, fn) {
    const r = this._cellRange(x0, z0, x1, z1, this._rr || (this._rr = [0, 0, 0, 0]));
    const st = ++this.stamp;
    for (let iz = r[1]; iz <= r[3]; iz++) for (let ix = r[0]; ix <= r[2]; ix++) {
      const l = this.cells[iz * this.cx + ix]; if (!l) continue;
      for (let i = 0; i < l.length; i++) { const c = l[i]; if (c.stamp === st) continue; c.stamp = st; if (c.enabled) fn(c); }
    }
  }
  _contact(out, n) {
    let c = out[n]; if (!c) c = out[n] = mkContact();
    return c;
  }

  /** Circle (x,z,r) spanning heights [y0,y1] vs static colliders. */
  collideCircle(x, z, r, y0, y1, out) {
    let n = 0;
    const L = { x: 0, z: 0 };
    const r0 = this._cellRange(x - r, z - r, x + r, z + r, this._rr || (this._rr = [0, 0, 0, 0]));
    const st = ++this.stamp;
    for (let iz = r0[1]; iz <= r0[3]; iz++) for (let ix = r0[0]; ix <= r0[2]; ix++) {
      const l = this.cells[iz * this.cx + ix]; if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const c = l[i]; if (c.stamp === st) continue; c.stamp = st;
        if (!c.enabled || c.minY >= y1 || c.maxY <= y0) continue;
        if (c.type === CYL) {
          const dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz, rr = r + c.r;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2) || 1e-6;
          const k = this._contact(out, n++);
          k.nx = dx / d; k.nz = dz / d; k.depth = rr - d; k.px = c.x + k.nx * c.r; k.pz = c.z + k.nz * c.r; k.id = c.id; k.tag = c.tag; k.data = c.data;
          continue;
        }
        this._local(c, x, z, L);
        const qx = L.x < -c.hx ? -c.hx : L.x > c.hx ? c.hx : L.x;
        const qz = L.z < -c.hz ? -c.hz : L.z > c.hz ? c.hz : L.z;
        if (c.type === RAMP && this._rampTop(c, qz) <= y0) continue;
        let dx = L.x - qx, dz = L.z - qz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let lnx, lnz, depth;
        if (d2 > 1e-10) { const d = Math.sqrt(d2); lnx = dx / d; lnz = dz / d; depth = r - d; }
        else { // center inside: push along min axis
          const px = c.hx - Math.abs(L.x), pz = c.hz - Math.abs(L.z);
          if (px < pz) { lnx = L.x < 0 ? -1 : 1; lnz = 0; depth = px + r; } else { lnx = 0; lnz = L.z < 0 ? -1 : 1; depth = pz + r; }
        }
        const k = this._contact(out, n++);
        // local -> world: x = c*lx + s*lz ; z = -s*lx + c*lz
        k.nx = c.c * lnx + c.s * lnz; k.nz = -c.s * lnx + c.c * lnz; k.depth = depth;
        k.px = c.x + c.c * qx + c.s * qz; k.pz = c.z - c.s * qx + c.c * qz; k.id = c.id; k.tag = c.tag; k.data = c.data;
      }
    }
    return n;
  }

  /** OBB (center, half extents, yaw) spanning [y0,y1] vs static colliders (2D SAT). */
  collideOBB(cx, cz, hx, hz, rot, y0, y1, out) {
    let n = 0;
    const ca = Math.cos(rot), sa = Math.sin(rot);
    // box A axes in world: local X -> (ca, -sa), local Z -> (sa, ca)
    const ax0 = ca, az0 = -sa, ax1 = sa, az1 = ca;
    const ext = Math.abs(hx * ca) + Math.abs(hz * sa), ezt = Math.abs(hx * sa) + Math.abs(hz * ca);
    const r0 = this._cellRange(cx - ext, cz - ezt, cx + ext, cz + ezt, this._rr || (this._rr = [0, 0, 0, 0]));
    const st = ++this.stamp;
    const L = { x: 0, z: 0 };
    for (let iz = r0[1]; iz <= r0[3]; iz++) for (let ix = r0[0]; ix <= r0[2]; ix++) {
      const l = this.cells[iz * this.cx + ix]; if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const c = l[i]; if (c.stamp === st) continue; c.stamp = st;
        if (!c.enabled || c.minY >= y1 || c.maxY <= y0) continue;
        if (Math.abs(c.x - cx) > ext + c.ex || Math.abs(c.z - cz) > ezt + c.ez) continue;
        if (c.type === CYL) {
          // circle vs OBB (A): transform circle into A local
          const dx = c.x - cx, dz = c.z - cz;
          const lx = ca * dx - sa * dz, lz = sa * dx + ca * dz;
          const qx = lx < -hx ? -hx : lx > hx ? hx : lx, qz = lz < -hz ? -hz : lz > hz ? hz : lz;
          let ddx = qx - lx, ddz = qz - lz, d2 = ddx * ddx + ddz * ddz;
          if (d2 >= c.r * c.r) continue;
          let lnx, lnz, depth;
          if (d2 > 1e-10) { const d = Math.sqrt(d2); lnx = ddx / d; lnz = ddz / d; depth = c.r - d; }
          else { const px = hx - Math.abs(lx), pz = hz - Math.abs(lz); if (px < pz) { lnx = lx < 0 ? 1 : -1; lnz = 0; depth = px + c.r; } else { lnx = 0; lnz = lz < 0 ? 1 : -1; depth = pz + c.r; } }
          const k = this._contact(out, n++);
          k.nx = ca * lnx + sa * lnz; k.nz = -sa * lnx + ca * lnz; k.depth = depth;
          k.px = c.x - k.nx * (c.r - depth * 0.5); k.pz = c.z - k.nz * (c.r - depth * 0.5); k.id = c.id; k.tag = c.tag; k.data = c.data;
          continue;
        }
        if (c.type === RAMP) {
          this._local(c, cx, cz, L);
          const qz = L.z < -c.hz ? -c.hz : L.z > c.hz ? c.hz : L.z;
          if (this._rampTop(c, qz) <= y0) continue;
        }
        // SAT with 4 axes
        const bx0 = c.c, bz0 = -c.s, bx1 = c.s, bz1 = c.c;
        const dx = c.x - cx, dz = c.z - cz;
        let minO = Infinity, mnx = 0, mnz = 0, sep = false;
        const axes = [ax0, az0, ax1, az1, bx0, bz0, bx1, bz1];
        for (let a = 0; a < 4; a++) {
          const ux = axes[a * 2], uz = axes[a * 2 + 1];
          const ra = hx * Math.abs(ax0 * ux + az0 * uz) + hz * Math.abs(ax1 * ux + az1 * uz);
          const rb = c.hx * Math.abs(bx0 * ux + bz0 * uz) + c.hz * Math.abs(bx1 * ux + bz1 * uz);
          const dist = dx * ux + dz * uz;
          const o = ra + rb - Math.abs(dist);
          if (o <= 0) { sep = true; break; }
          if (o < minO) { minO = o; const sgn = dist > 0 ? -1 : 1; mnx = ux * sgn; mnz = uz * sgn; }
        }
        if (sep) continue;
        // contact point: average of A corners inside B, else B corners inside A, else midpoint
        let sx = 0, sz = 0, cnt = 0;
        for (let q = 0; q < 4; q++) {
          const lx = (q & 1 ? 1 : -1) * hx, lz = (q & 2 ? 1 : -1) * hz;
          const wx = cx + ca * lx + sa * lz, wz = cz - sa * lx + ca * lz;
          const bx = c.c * (wx - c.x) - c.s * (wz - c.z), bz = c.s * (wx - c.x) + c.c * (wz - c.z);
          if (Math.abs(bx) <= c.hx + 1e-3 && Math.abs(bz) <= c.hz + 1e-3) { sx += wx; sz += wz; cnt++; }
        }
        if (!cnt) for (let q = 0; q < 4; q++) {
          const lx = (q & 1 ? 1 : -1) * c.hx, lz = (q & 2 ? 1 : -1) * c.hz;
          const wx = c.x + c.c * lx + c.s * lz, wz = c.z - c.s * lx + c.c * lz;
          const ex = ca * (wx - cx) - sa * (wz - cz), ez = sa * (wx - cx) + ca * (wz - cz);
          if (Math.abs(ex) <= hx + 1e-3 && Math.abs(ez) <= hz + 1e-3) { sx += wx; sz += wz; cnt++; }
        }
        if (!cnt) { sx = (cx + c.x) * 0.5; sz = (cz + c.z) * 0.5; cnt = 1; }
        const k = this._contact(out, n++);
        k.nx = mnx; k.nz = mnz; k.depth = minO; k.px = sx / cnt; k.pz = sz / cnt; k.id = c.id; k.tag = c.tag; k.data = c.data;
      }
    }
    return n;
  }

  /** Ray vs colliders + terrain (+ optional water plane). Direction need not be normalized (t in units of dir length). */
  raycast(ox, oy, oz, dx, dy, dz, maxDist = 100, opts = null) {
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const ignore = opts && opts.ignoreTags;
    const wantTerrain = !opts || opts.terrain !== false;
    let bestT = maxDist, best = null;
    const hit = this._hit || (this._hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, id: -1, tag: '', data: null, collider: null });
    // terrain march
    if (wantTerrain && this.terrain) {
      const T = this.terrain, step = 1.5;
      let prevT = 0, prevD = oy - T.heightAt(ox, oz);
      if (prevD > 0) {
        for (let t = step; t <= bestT + step; t += step) {
          const tt = Math.min(t, bestT);
          const px = ox + dx * tt, pz = oz + dz * tt, py = oy + dy * tt;
          const d = py - T.heightAt(px, pz);
          if (d <= 0) {
            let a = prevT, b = tt;
            for (let k = 0; k < 10; k++) { const m = (a + b) * 0.5; const q = oy + dy * m - T.heightAt(ox + dx * m, oz + dz * m); if (q > 0) a = m; else b = m; }
            bestT = b; best = 'terrain';
            break;
          }
          prevT = tt; prevD = d;
          if (tt >= bestT) break;
          // speed up when far above ground
          if (d > 30 && dy >= 0) break;
        }
      }
    }
    if (opts && opts.water && dy < 0) {
      const tw = (this.waterLevel - oy) / dy;
      if (tw > 0 && tw < bestT && (!best || best === 'terrain')) { bestT = tw; best = 'water'; }
    }
    // colliders: walk cells along the ray
    const st = ++this.stamp;
    const cs = this.cell;
    let cx = Math.floor((ox - this.minX) / cs), cz = Math.floor((oz - this.minZ) / cs);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDX = Math.abs(dx) > 1e-9 ? cs / Math.abs(dx) : Infinity, tDZ = Math.abs(dz) > 1e-9 ? cs / Math.abs(dz) : Infinity;
    let tMX = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (cx + 1) * cs + this.minX - ox : ox - (cx * cs + this.minX)) / Math.abs(dx)) : Infinity;
    let tMZ = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (cz + 1) * cs + this.minZ - oz : oz - (cz * cs + this.minZ)) / Math.abs(dz)) : Infinity;
    let tCell = 0, bestC = null, bnx = 0, bny = 1, bnz = 0;
    for (let guard = 0; guard < 4000; guard++) {
      if (cx >= 0 && cz >= 0 && cx < this.cx && cz < this.cz) {
        const l = this.cells[cz * this.cx + cx];
        if (l) for (let i = 0; i < l.length; i++) {
          const c = l[i]; if (c.stamp === st) continue; c.stamp = st;
          if (!c.enabled || (ignore && ignore.has(c.tag))) continue;
          const r = this._rayShape(c, ox, oy, oz, dx, dy, dz, bestT);
          if (r >= 0 && r < bestT) { bestT = r; bestC = c; bnx = this._rn[0]; bny = this._rn[1]; bnz = this._rn[2]; best = 'collider'; }
        }
      }
      const tNext = Math.min(tMX, tMZ);
      if (tNext > bestT) break;
      tCell = tNext;
      if (tMX < tMZ) { cx += stepX; tMX += tDX; } else { cz += stepZ; tMZ += tDZ; }
      if ((cx < 0 && stepX < 0) || (cz < 0 && stepZ < 0) || (cx >= this.cx && stepX > 0) || (cz >= this.cz && stepZ > 0)) break;
    }
    if (!best) return null;
    hit.t = bestT; hit.x = ox + dx * bestT; hit.y = oy + dy * bestT; hit.z = oz + dz * bestT;
    if (best === 'collider') {
      hit.nx = bnx; hit.ny = bny; hit.nz = bnz; hit.id = bestC.id; hit.tag = bestC.tag; hit.data = bestC.data; hit.collider = bestC;
    } else if (best === 'water') {
      hit.nx = 0; hit.ny = 1; hit.nz = 0; hit.id = -2; hit.tag = 'water'; hit.data = null; hit.collider = null;
    } else {
      const n = this.terrain.normalAt(hit.x, hit.z, this._tn || (this._tn = { x: 0, y: 1, z: 0 }));
      hit.nx = n.x; hit.ny = n.y; hit.nz = n.z; hit.id = -1; hit.tag = 'terrain'; hit.data = null; hit.collider = null;
      if (hit.y < this.waterLevel && opts && opts.water) { hit.tag = 'water'; }
    }
    return hit;
  }
  _rayShape(c, ox, oy, oz, dx, dy, dz, maxT) {
    const rn = this._rn || (this._rn = [0, 1, 0]);
    if (c.type === CYL) {
      const px = ox - c.x, pz = oz - c.z;
      const a = dx * dx + dz * dz;
      let tin = -Infinity, tout = Infinity, nIn = 0; // 0 side, 1 top, 2 bottom
      if (a > 1e-12) {
        const b = px * dx + pz * dz, cc = px * px + pz * pz - c.r * c.r;
        const disc = b * b - a * cc; if (disc < 0) return -1;
        const sq = Math.sqrt(disc); tin = (-b - sq) / a; tout = (-b + sq) / a;
      } else if (px * px + pz * pz > c.r * c.r) return -1;
      // y slab
      if (Math.abs(dy) > 1e-12) {
        let t0 = (c.minY - oy) / dy, t1 = (c.maxY - oy) / dy, n0 = 2, n1 = 1;
        if (t0 > t1) { const t = t0; t0 = t1; t1 = t; n0 = 1; n1 = 2; }
        if (t0 > tin) { tin = t0; nIn = n0; }
        if (t1 < tout) tout = t1;
      } else if (oy < c.minY || oy > c.maxY) return -1;
      if (tin > tout || tout < 0 || tin > maxT) return -1;
      const t = tin < 0 ? 0 : tin;
      if (nIn === 1) { rn[0] = 0; rn[1] = 1; rn[2] = 0; }
      else if (nIn === 2) { rn[0] = 0; rn[1] = -1; rn[2] = 0; }
      else { const hx = px + dx * t, hz = pz + dz * t, l = Math.hypot(hx, hz) || 1; rn[0] = hx / l; rn[1] = 0; rn[2] = hz / l; }
      return t;
    }
    // box / ramp: Cyrus-Beck in local space
    const lox = c.c * (ox - c.x) - c.s * (oz - c.z), loz = c.s * (ox - c.x) + c.c * (oz - c.z);
    const ldx = c.c * dx - c.s * dz, ldz = c.s * dx + c.c * dz;
    let tin = -Infinity, tout = Infinity, inAxis = -1, inSign = 0;
    // planes: n·p <= d  -> x<=hx, -x<=hx, z<=hz, -z<=hz, y<=maxY (or slope), -y<=-minY
    const planes = this._planes || (this._planes = new Float32Array(24));
    let np = 0;
    const add = (nx, ny, nz, d) => { planes[np++] = nx; planes[np++] = ny; planes[np++] = nz; planes[np++] = d; };
    add(1, 0, 0, c.hx); add(-1, 0, 0, c.hx); add(0, 0, 1, c.hz); add(0, 0, -1, c.hz); add(0, -1, 0, -c.minY);
    if (c.type === RAMP) { const k = (c.y1 - c.y0) / (2 * c.hz); const cc = c.y0 + k * c.hz; add(0, 1, -k, cc); }
    else add(0, 1, 0, c.maxY);
    for (let p = 0; p < np; p += 4) {
      const nx = planes[p], ny = planes[p + 1], nz = planes[p + 2], d = planes[p + 3];
      const num = d - (nx * lox + ny * oy + nz * loz), den = nx * ldx + ny * dy + nz * ldz;
      if (Math.abs(den) < 1e-12) { if (num < 0) return -1; continue; }
      const t = num / den;
      if (den < 0) { if (t > tin) { tin = t; inAxis = p; } } else if (t < tout) tout = t;
      if (tin > tout) return -1;
    }
    if (tout < 0 || tin > maxT) return -1;
    const t = tin < 0 ? 0 : tin;
    if (inAxis >= 0) {
      let nx = planes[inAxis], ny = planes[inAxis + 1], nz = planes[inAxis + 2];
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      rn[0] = c.c * nx + c.s * nz; rn[1] = ny; rn[2] = -c.s * nx + c.c * nz;
    } else { rn[0] = -dx; rn[1] = -dy; rn[2] = -dz; }
    return t;
  }
  lineOfSight(ax, ay, az, bx, by, bz, ignoreTags) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
    if (d < 1e-3) return true;
    const h = this.raycast(ax, ay, az, dx, dy, dz, d - 0.05, ignoreTags ? { ignoreTags } : null);
    return !h;
  }
}
