// Game orchestrator: owns renderer/scene/world, all systems, the main loop, saving and settings.
import * as THREE from 'three';
import { generateCity } from '../world/citygen.js';
import { CityRenderer } from '../world/cityRenderer.js';
import { Environment } from '../gfx/environment.js';
import { Particles } from '../gfx/particles.js';
import { Decals } from '../gfx/decals.js';
import { J, buildWeaponGeometry } from '../entities/character.js';
import { HumanRenderer } from '../entities/humanRender.js';
import { loadHumanModels } from '../entities/humanAssets.js';
import { Events } from '../core/events.js';
import { Input } from '../core/input.js';
import { clamp, damp } from '../core/math.js';
import { GameCamera } from './camera.js';
import { Player } from './player.js';
import { VehicleManager } from './vehicles.js';
import { TrafficManager } from './traffic.js';
import { PedManager } from './peds.js';
import { HeatSystem } from './police.js';
import { Hostiles } from './hostile.js';
import { Markers } from './markers.js';
import { Activities } from './activities.js';
import { MissionManager } from './missions.js';
import { explode, WEAPON_ORDER } from './combat.js';
import { AudioSystem } from '../audio/audio.js';
import { HUD } from '../ui/hud.js';
import { TouchControls, touchPreferred } from '../ui/touch.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const SETTINGS_KEY = 'solharbor.settings.v1';
const SAVE_KEY = 'solharbor.save.v1';

class WeaponRenderer {
  constructor(scene) {
    this.meshes = {};
    for (const w of ['pistol', 'smg', 'shotgun', 'rifle']) {
      const g = buildWeaponGeometry(w);
      const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.6 }), 64);
      m.count = 0; m.frustumCulled = false; m.castShadow = true; scene.add(m); this.meshes[w] = m;
    }
  }
  render(actors) {
    for (const k in this.meshes) this.meshes[k].count = 0;
    for (const a of actors) {
      if (!a.rig.visible || a.weapon === 'fists' || !a.alive || a.state === 'ragdoll' || a.removed) continue;
      if (a.inVehicle && !a.aiming) continue;
      const m = this.meshes[a.weapon]; if (!m || m.count >= 64) continue;
      m.setMatrixAt(m.count++, a.rig.gripMatrix(this._gm || (this._gm = new THREE.Matrix4())));
    }
    for (const k in this.meshes) this.meshes[k].instanceMatrix.needsUpdate = true;
  }
}

export class Game {
  constructor(container) {
    this.container = container;
    this.events = new Events();
    this.time = 0; this.timeOfDay = 17.4; this.timeScale = 24 / (48 * 60); // 48-minute day
    this.weather = { clouds: 0.3, rain: 0, fog: 0 }; this.weatherTarget = { clouds: 0.3, rain: 0, fog: 0 }; this.weatherT = 240;
    this.paused = true; this.started = false; this.focus = new THREE.Vector3();
    this.cheats = {}; this.menuOpen = false; this.mapOpen = false;
    this.gpsTarget = null; this.waypoint = null; this.gpsRoute = null; this.gpsT = 0;
    this.settings = this.loadSettings();
    this.quality = this.settings.quality || (matchMedia('(max-width: 800px)').matches ? 'low' : 'high');
  }
  /** Pick a sensible default graphics level from the GPU name. */
  _detectQuality(renderer) {
    if (matchMedia('(max-width: 800px)').matches || touchPreferred()) return 'low'; // phones and tablets: fastest settings
    try {
      const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      this.gpuName = name;
      if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'low';
      if (/intel|uhd|iris|mali|adreno|powervr|vivante|apple gpu/i.test(name)) return 'medium';
    } catch (e) { /* unknown GPU */ }
    return 'high';
  }
  loadSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ quality: this.quality, sens: this.input.sens, invertY: this.input.invertY, vol: this.audio?.volume.master, music: this.audio?.volume.music })); } catch (e) { /* storage unavailable */ }
  }

  async init() {
    const hud = this.hud = new HUD(this);
    const progress = (p, l) => hud.loading(p, l);
    progress(0.02, 'Waking the city');
    await tick();
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
    renderer.domElement.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;outline:none';
    renderer.domElement.tabIndex = 0;
    this.container.appendChild(renderer.domElement);
    if (!this.settings.quality) this.quality = this._detectQuality(renderer);
    const scene = this.scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 6000);
    progress(0.06, 'Surveying the island');
    await tick();
    const city = this.city = generateCity({ seed: 1337 });
    progress(0.22, 'Painting facades');
    const cr = this.cityRenderer = new CityRenderer({ scene, renderer, city, quality: this.quality });
    await cr.build((p, l) => progress(0.22 + p * 0.55, l));
    progress(0.8, 'Lighting the sky');
    await tick();
    this.env = new Environment({ renderer, scene, camera, quality: this.quality, terrain: city.terrain, noise: cr.textures.noise });
    if (touchPreferred()) { this.env.phone = true; this.env.setQuality(this.quality); }
    const particles = new Particles(scene, 3000);
    particles.groundFn = (x, z, y) => city.collision.groundHeight(x, z, y, 0.3);
    this.fx = { particles, decals: new Decals(scene) };
    this.world = { collision: city.collision, terrain: city.terrain, scene, events: this.events, wetness: 0, breakPropsInRadius: (p, r) => this.vehicles.breakPropsInRadius(p, r) };
    city.collision.waterLevel = city.terrain.waterLevel;
    this.camera = new GameCamera(camera, city.collision);
    this._fitCamera(window.innerWidth, window.innerHeight);
    this.input = new Input(renderer.domElement);
    this.input.sens = this.settings.sens || 1; this.input.invertY = !!this.settings.invertY;
    this.touch = new TouchControls(this, touchPreferred());
    progress(0.83, 'Casting the locals');
    await tick();
    // skinned, instanced humans: player, contacts and crowd bases with accessory overlays
    const humans = loadHumanModels();
    this.crowd = new HumanRenderer(scene, 256);
    for (const [key, m] of Object.entries(humans)) this.crowd.addModel(key, m.lods, m.lodDist, { shadowLod: m.shadowLod, overlays: m.overlays });
    this.crowd.lodScale = this.quality === 'low' ? 0.35 : this.quality === 'medium' ? 0.65 : 1;
    this.weapons = new WeaponRenderer(scene);
    this.markers = new Markers(scene);
    progress(0.86, 'Parking cars');
    await tick();
    this.vehicles = new VehicleManager(this);
    this.player = new Player(this);
    this.traffic = new TrafficManager(this);
    this.peds = new PedManager(this);
    this.heat = new HeatSystem(this);
    this.hostiles = new Hostiles(this);
    this.activities = new Activities(this);
    this.missions = new MissionManager(this);
    this.audio = new AudioSystem(this);
    if (this.settings.vol != null) this.audio.volume.master = this.settings.vol;
    if (this.settings.music != null) this.audio.volume.music = this.settings.music;
    const ps = city.poi.playerStart;
    this.player.place(ps.x, ps.y, ps.z, ps.yaw);
    this.player.giveWeapon('pistol', 48);
    this.camera.yaw = ps.yaw; this.camera.pitch = 0.12;
    this.focus.copy(this.player.pos);
    this._spawnStarterCar();
    this.vehicles.populateParked(this.player.pos, true);
    this._bindEvents();
    this.hud.buildMinimap();
    progress(0.95, 'Warming up shaders');
    await tick();
    for (let i = 0; i < 3; i++) { this.update(0.016, true); this.env.render(0.016); }
    this._bindWindow();
    progress(1, 'Ready');
    const save = this.readSave();
    this.hud.showTitle(() => this.start(false), save ? () => this.start(true) : null);
    this.attract = true;
    this.last = performance.now();
    renderer.setAnimationLoop(() => this.frame());
  }
  _bindEvents() {
    const ev = this.events;
    ev.on('explosion', (e) => { if (!e.heli) explode(this, e.position, e.radius || 8, e.attacker, e.source); });
    ev.on('actorKilled', (e) => { if (e.actor === this.player) this._onPlayerDeath(e); });
    ev.on('enteredVehicle', (e) => {
      if (e.actor !== this.player) return;
      this.hud.help(this.touch?.active ? 'Hold <b>GAS</b> and <b>BRAKE</b>, steer with the left stick · <b>DRIFT</b> handbrake · <b>EXIT</b> gets out'
        : `<kbd>W</kbd><kbd>S</kbd> drive · <kbd>Space</kbd> handbrake · <kbd>F</kbd> exit · <kbd>Q</kbd><kbd>E</kbd> radio · <kbd>V</kbd> camera`, 5);
      if (this.audio.ready) this.hud.radio(this.audio.radioOn ? this.audio.radio.stations[this.audio.radioIndex] : null);
    });
    ev.on('actorDamaged', (e) => { if (e.actor === this.player && e.amount > 1) this.env.effects.damage(clamp(e.amount / 40, 0.2, 0.8)); });
  }
  _spawnStarterCar() {
    const ps = this.city.poi.playerStart;
    let best = null, bd = 1e9;
    for (const s of this.city.parking) { if (s.kind !== 'street') continue; const d = (s.x - ps.x) ** 2 + (s.z - ps.z) ** 2; if (d < bd) { bd = d; best = s; } }
    if (best) {
      const v = this.vehicles.spawn('sports', best.x, best.y, best.z, best.yaw, { color: 0xd35400, seed: 99 });
      v.keep = true; v.playerOwned = true; this.starterCar = v;
      this.vehicles.usedSpots.add(this.city.parking.indexOf(best));
    }
  }
  _bindWindow() {
    window.addEventListener('resize', () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.env.resize(w, h); this._fitCamera(w, h);
    });
    this.renderer.domElement.addEventListener('click', () => { if (this.started && !this.paused && !this.menuOpen && !this.mapOpen) this.input.lock(); });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.started && !this.paused && !this.menuOpen && !this.mapOpen && this._lockedOnce && !this._ignoreUnlock) this.setPaused(true);
      if (document.pointerLockElement) this._lockedOnce = true;
    });
    document.addEventListener('pointerlockerror', () => { if (!this._dragHint && this.started && !this.touch?.active) { this._dragHint = true; this.hud.help('Mouse capture isn\'t available here. <b>Hold the right mouse button and drag</b> to look around.', 7); } });
    this.input.onKey = (e) => {
      if (!this.started) return;
      if (this.activities.shopOpen) { if (this.hud._shopKeys) this.hud._shopKeys(e); return; }
      if (e.code === 'KeyM' && !this.paused) { this.toggleMap(); return; }
      if (this.mapOpen) { if (e.code === 'Escape') this.toggleMap(); return; }
      if (e.code === 'Escape' || e.code === 'KeyP') { if (this.paused) this.resume(); else this.setPaused(true); }
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.started && !this.paused) this.setPaused(true); });
  }
  /** Aspect and field of view: upright phones get a taller view so the sides of the street stay visible. */
  _fitCamera(w, h) {
    const a = w / Math.max(1, h), c = this.camera;
    c.camera.aspect = a; c.fovBase = a >= 1 ? 62 : Math.min(84, 62 + (1 - a) * 36);
    c.camera.updateProjectionMatrix();
  }
  start(cont) {
    this.started = true; this.attract = false; this.paused = false;
    this.audio.start();
    if (cont) this.loadGame();
    this.input.lock();
    const z = this.city.districtAt(this.player.pos.x, this.player.pos.z).name;
    this.hud.zone(z, 'SOL HARBOR'); this.lastZone = z;
    if (!cont) this.hud.help(this.touch?.active ? 'Your car is parked out front: walk up to it and tap <b>ENTER</b>. Gold markers on the map (tap the minimap) are people with work for you.'
      : 'Your car is parked out front: walk up and press <kbd>F</kbd>. Gold markers on the map (<kbd>M</kbd>) are people with work for you.', 9);
    else this.hud.note('Welcome back to Sol Harbor.');
    this.renderer.domElement.focus();
    this.traffic.clear(); this.peds.clear();
    this.focus.copy(this.player.pos); this.traffic.populate(); this.peds.populate();
  }
  setPaused(p) {
    this.paused = p;
    this.hud.setPaused(p, () => this.resume());
    if (p) { this._ignoreUnlock = true; this.input.unlock(); setTimeout(() => { this._ignoreUnlock = false; }, 100); }
  }
  resume() { this.setPaused(false); this.input.lock(); this.renderer.domElement.focus(); this.audio.start(); }
  toggleMap() {
    this.mapOpen = !this.mapOpen;
    if (this.mapOpen) { this._ignoreUnlock = true; this.input.unlock(); setTimeout(() => { this._ignoreUnlock = false; }, 100); this.hud.openMap(); }
    else { this.hud.closeMap(); this.input.lock(); }
  }
  setWaypoint(p) { this.waypoint = p ? { x: p.x, y: 0, z: p.z } : null; this.gpsT = 0; if (p) this.audio.jingle('ui'); }
  setQuality(q) { this.quality = q; this.env.setQuality(q); if (this.crowd) this.crowd.lodScale = q === 'low' ? 0.35 : q === 'medium' ? 0.65 : 1; this.saveSettings(); }

  // ------------------------------------------------------------------ actors & blips
  *actors() {
    yield this.player;
    yield* this.peds.actors();
    yield* this.traffic.drivers();
    yield* this.heat.actors();
    yield* this.hostiles.actors();
    yield* this.missions.allActors();
  }
  blips(full = false) {
    const out = [], P = this.city.poi;
    if (P.safehouse) out.push({ x: P.safehouse.x, z: P.safehouse.z, color: '#3ddc84', label: 'H', r: 6 });
    if (full || true) {
      for (const h of P.hospitals || []) out.push({ x: h.x, z: h.z, color: '#ff5e62', label: '+', r: 4.5 });
      for (const s of P.gunShops || []) out.push({ x: s.x, z: s.z, color: '#ff9f43', label: '$', r: 4.5 });
      for (const r of P.resprays || []) out.push({ x: r.door ? r.door.x : r.x, z: r.door ? r.door.z : r.z, color: '#9b59b6', label: 'P', r: 4.5 });
      if (full) for (const s of P.policeStations || []) out.push({ x: s.x, z: s.z, color: '#3d9bff', label: '★', r: 4.5 });
    }
    out.push(...this.missions.blips());
    if (this.starterCar && !this.starterCar.removed && this.player.vehicle !== this.starterCar && !this.starterCar.exploded) out.push({ x: this.starterCar.com.x, z: this.starterCar.com.z, color: '#ff9f43', r: 3.5 });
    // police and hostiles
    const flash = Math.floor(this.time * 4) % 2 ? '#ff3b3b' : '#3b6bff';
    for (const u of this.heat.units) if (!u.v.removed) out.push({ x: u.v.com.x, z: u.v.com.z, color: flash, r: 4 });
    for (const f of this.heat.foot) if (f.a.alive && !f.a.removed) out.push({ x: f.a.pos.x, z: f.a.pos.z, color: flash, r: 3 });
    if (this.heat.heli.active) out.push({ x: this.heat.heli.com.x, z: this.heat.heli.com.z, color: flash, r: 5, label: 'H' });
    for (const h of this.hostiles.list) if (h.a.alive && !h.a.removed) out.push({ x: h.a.pos.x, z: h.a.pos.z, color: '#ff5e62', r: 3 });
    const t = this.gpsTarget || this.waypoint;
    if (t) out.push({ x: t.x, z: t.z, color: this.gpsTarget ? '#ffc857' : '#b36bff', r: 5 });
    return out;
  }

  // ------------------------------------------------------------------ death, arrest, respawn
  _onPlayerDeath() {
    this.hud.big('LIGHTS OUT', 'patched up at the nearest clinic', '#ff5e62', 5);
    this.env.effects.death(4);
    this.deathTimer = 4.5; this.deathKind = 'death';
  }
  arrestPlayer() {
    if (this.deathTimer > 0 || !this.player.alive) return;
    const P = this.player;
    if (P.inVehicle) P.leaveSeat(true);
    P.controlEnabled = false;
    this.hud.big('IN CUSTODY', 'released from the precinct after paperwork', '#3d9bff', 5);
    this.deathTimer = 4; this.deathKind = 'arrest';
    this.events.emit('arrested', {});
  }
  _respawnPlayer() {
    const p = this.player, arrest = this.deathKind === 'arrest';
    const list = (arrest ? this.city.poi.policeStations : this.city.poi.hospitals) || [];
    let best = this.city.poi.playerStart, bd = 1e12;
    for (const h of list) { const d = (h.x - p.pos.x) ** 2 + (h.z - p.pos.z) ** 2; if (d < bd) { bd = d; best = h; } }
    const fee = arrest ? 250 + this.heat.level * 150 : 150;
    this.heat.clearAll();
    p.respawn(best.x + Math.sin(best.yaw || 0) * 2.5, best.y ?? 0.15, best.z + Math.cos(best.yaw || 0) * 2.5, best.yaw ?? 0);
    p.controlEnabled = true;
    p.addCash(-Math.min(p.cash, fee));
    this.camera.yaw = best.yaw ?? 0;
    this.hud.note(arrest ? `Bail and fines: <b>-$${fee}</b>` : `Clinic bill: <b>-$${fee}</b>`);
    this.focus.copy(p.pos); this.peds.populate();
  }

  // ------------------------------------------------------------------ save / load
  readSave() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return s && s.v === 1 ? s : null; } catch (e) { return null; } }
  saveGame(note = false) {
    const P = this.player;
    const data = { v: 1, cash: P.cash, armor: P.armor, owned: [...P.owned], ammo: P.ammo, clip: P.clip, weapon: P.weapon, time: this.timeOfDay,
      missions: this.missions.save(), tokens: [...this.activities.tokens], stunts: [...this.activities.stunts], stats: P.stats, radio: this.audio.radioIndex };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data, (k, v) => (v === Infinity ? 1e9 : v))); if (note) this.hud.note('Game saved.'); return true; }
    catch (e) { if (note) this.hud.note('Saving isn\'t available in this browser window.'); return false; }
  }
  loadGame() {
    const s = this.readSave(); if (!s) return;
    const P = this.player;
    P.cash = s.cash ?? P.cash; P.armor = s.armor || 0;
    P.owned = new Set(s.owned || []); P.ammo = Object.assign({ fists: Infinity }, s.ammo || {}); P.clip = Object.assign({ fists: Infinity }, s.clip || {});
    P.weapon = P.hasWeapon(s.weapon) ? s.weapon : 'fists';
    if (s.stats) Object.assign(P.stats, s.stats);
    this.timeOfDay = s.time ?? this.timeOfDay;
    this.missions.load(s.missions || {});
    this.activities.applyLoad(s);
    if (s.radio != null) this.audio.radioIndex = s.radio;
    const sh = this.city.poi.safehouse;
    if (sh) { P.place(sh.x + Math.sin(sh.yaw) * 2, sh.y, sh.z + Math.cos(sh.yaw) * 2, sh.yaw); this.camera.yaw = sh.yaw; }
  }

  /** Test/debug helper: advance the simulation without rendering. */
  simulate(seconds, dt = 1 / 30) { const n = Math.round(seconds / dt); for (let i = 0; i < n; i++) this.update(dt, false); this.last = performance.now(); }

  // ------------------------------------------------------------------ loop
  frame() {
    // GPU pacing: never let rendered frames queue up behind a busy GPU. A deep queue is what makes
    // the character keep moving on screen after a key is released (input lag of several seconds).
    const gl = this.renderer.getContext();
    if (this._fence) {
      const done = gl.getSyncParameter(this._fence, gl.SYNC_STATUS) === gl.SIGNALED;
      if (!done && performance.now() - this._fenceT < 250) return; // GPU still busy: skip this vsync
      gl.deleteSync(this._fence); this._fence = null;
    }
    const now = performance.now();
    const raw = (now - this.last) / 1000;
    // real time drives the simulation 1:1 down to 10 fps (below that, time slows rather than teleporting)
    let dt = Math.min(0.1, raw); this.last = now;
    if (dt <= 0) dt = 0.001;
    this.update(dt, false);
    this.env.render(dt);
    this._fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); this._fenceT = performance.now();
    gl.flush();
    this._adapt(raw);
  }
  /** Dynamic resolution: keep the frame rate playable on weaker GPUs. */
  _adapt(raw) {
    if (!this.started || this.paused || raw > 0.5) return;
    this._fa = (this._fa || 0) + raw; this._fn = (this._fn || 0) + 1;
    if (this._fa < 3) return;
    const fps = this._fn / this._fa; this._fa = 0; this._fn = 0;
    const s = this.resScale ?? 1;
    let n = s;
    if (fps < 38 && s > 0.55) n = Math.max(0.55, s - 0.12);
    else if (fps > 57 && s < 1) n = Math.min(1, s + 0.06);
    if (n !== s) { this.resScale = n; this.env.setResolutionScale(n); }
  }
  update(dt, warm) {
    const input = this.input, cam = this.camera, P = this.player;
    if (this.touch) this.touch.update(dt);
    input.poll();
    if (this.attract) this._attractCam(dt);
    const running = this.started && !this.paused && !this.mapOpen;
    this.markers.begin();
    if (running) {
      const sdt = dt * (this.env.slowT > 0 ? 0.35 : 1);
      this.time += sdt;
      this.timeOfDay = (this.timeOfDay + sdt * this.timeScale) % 24;
      const free = !this.menuOpen && !this.missions.cutscene;
      if (free) cam.rotate(input.mouseDX * 0.0023, input.mouseDY * 0.0023);
      if (free && this.touch) this.touch.assist(sdt);
      P.controlEnabled = !(this.menuOpen || this.missions.cutscene || this.deathTimer > 0);
      P.control(sdt, input, cam);
      this.traffic.update(sdt);
      this.peds.update(sdt);
      this.heat.update(sdt);
      this.hostiles.update(sdt);
      this.missions.update(sdt);
      this.activities.update(sdt);
      const prompt = this.activities.shopOpen ? null : (this.activities.prompt || this.missions.prompt || null);
      this.hud.prompt(prompt);
      // radio (E doubles as "interact", so it only changes stations when no prompt is showing)
      if (P.inVehicle && free && !prompt) {
        if (input.pressed('radioNext')) this.hud.radio(this.audio.nextStation(1));
        if (input.pressed('radioPrev')) this.hud.radio(this.audio.nextStation(-1));
      }
      this.vehicles.update(sdt);
      if (P.inVehicle) P.syncSeat();
      this._weather(sdt);
      this._gps(sdt);
      if (this.deathTimer > 0) { this.deathTimer -= dt; if (this.deathTimer < 0.8) this.hud.fade(true); if (this.deathTimer <= 0) { this._respawnPlayer(); this.hud.fade(false); } }
      const pp = P.inVehicle && P.vehicle ? P.vehicle.com : P.pos;
      this._zoneT = (this._zoneT || 0) - dt;
      if (this._zoneT <= 0) { this._zoneT = 1; const z = this.city.districtAt(pp.x, pp.z).name; if (z && z !== this.lastZone) { this.lastZone = z; this.hud.zone(z, ''); } }
    } else if (warm || !this.started) {
      this.traffic.update(dt); this.peds.update(dt); this.vehicles.update(dt);
    }
    this.markers.end(dt);
    const tgt = P.inVehicle && P.vehicle ? P.vehicle.com : P.pos;
    if (!this.attract) {
      this.focus.copy(tgt);
      cam.update(dt, { mode: P.inVehicle && P.vehicle ? 'vehicle' : 'foot', target: P.pos, vehicle: P.vehicle, aiming: P.aiming, sprinting: P.speedNow > 5.5, swimming: P.swimming, lookBehind: this.started && input.down('lookBehind') });
    }
    this.world.wetness = this.env.wetness;
    this.env.update(dt, { timeOfDay: this.timeOfDay, weather: this.weather, focus: this.focus, time: this.time });
    this.cityRenderer.update(dt, { time: this.time, nightFactor: this.env.nightFactor, camera: cam.camera, wetness: this.env.wetness, timeOfDay: this.timeOfDay });
    const rigs = [];
    for (const a of this.actors()) if (!a.removed) rigs.push(a.rig);
    this.crowd.fill.value = 0.05 + this.env.daylight * 0.26;
    this.crowd.render(rigs, cam.camera.position, 170, this.focus);
    this.weapons.render(this.actors());
    const l = 0.25 + this.env.daylight * 0.75;
    this.fx.particles.update(dt, cam.camera, [l, l * 0.97, l * 0.94]);
    if (this.started) this.hud.update(dt);
    this.audio.update(dt);
  }
  _gps(dt) {
    const t = this.gpsTarget || this.waypoint;
    const P = this.player, pp = P.inVehicle && P.vehicle ? P.vehicle.com : P.pos;
    this.gpsColor = this.gpsTarget ? '#ffc857' : '#b36bff';
    if (!t) { this.gpsRoute = null; return; }
    if (!this.gpsTarget && Math.hypot(t.x - pp.x, t.z - pp.z) < 20) { this.waypoint = null; this.gpsRoute = null; this.hud.note('Waypoint reached.'); return; }
    this.gpsT -= dt;
    if (this.gpsT <= 0) {
      this.gpsT = P.inVehicle ? 1.2 : 2.5;
      const r = this.city.route({ x: pp.x, z: pp.z }, { x: t.x, z: t.z });
      this.gpsRoute = r ? [[pp.x, pp.z], ...r.points, [t.x, t.z]] : [[pp.x, pp.z], [t.x, t.z]];
    } else if (this.gpsRoute) this.gpsRoute[0] = [pp.x, pp.z];
  }
  _weather(dt) {
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      this.weatherT = 180 + Math.random() * 240;
      const r = Math.random();
      if (r < 0.62) Object.assign(this.weatherTarget, { clouds: 0.15 + Math.random() * 0.3, rain: 0, fog: 0 });
      else if (r < 0.85) Object.assign(this.weatherTarget, { clouds: 0.6 + Math.random() * 0.3, rain: 0, fog: Math.random() * 0.3 });
      else Object.assign(this.weatherTarget, { clouds: 0.9, rain: 0.5 + Math.random() * 0.5, fog: 0.2 });
    }
    for (const k of ['clouds', 'rain', 'fog']) this.weather[k] = damp(this.weather[k], this.weatherTarget[k], 0.05, dt);
  }
  _attractCam(dt) {
    this._at = (this._at || 0) + dt;
    const t = 0.35 + this._at * 0.018;
    const cx = 60, cz = 40;
    const cam = this.camera.camera;
    cam.position.set(cx + Math.cos(t) * 640, 215 + Math.sin(t * 0.7) * 15, cz + Math.sin(t) * 640);
    cam.lookAt(cx, 40, cz);
    cam.updateMatrixWorld();
    this.focus.set(cx + Math.cos(t) * 120, 0, cz + Math.sin(t) * 120);
  }
}
