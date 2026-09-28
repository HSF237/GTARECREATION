// CityRenderer: builds all static city visuals from CityData.
//   const cr = new CityRenderer({ scene, renderer, city, quality }); await cr.build(p => ...);
//   cr.update(dt, { time, nightFactor, camera, wetness }); cr.breakProp(i); cr.createDebris(kind)
import { createTextures } from '../gfx/textures.js';
import { createFacadeMaterial, buildBuildings } from './buildings.js';
import { buildGround } from './ground.js';
import { PropSystem } from './props.js';
import { smoothstep } from '../core/math.js';

const tick = () => new Promise(r => setTimeout(r, 0));

export class CityRenderer {
  constructor({ scene, renderer, city, quality = 'high' }) {
    this.scene = scene; this.renderer = renderer; this.city = city; this.quality = quality;
  }
  async build(progress = () => {}) {
    progress(0.05, 'Painting facades');
    await tick();
    this.textures = createTextures(this.renderer, this.quality);
    progress(0.35, 'Raising buildings');
    await tick();
    this.facadeMat = createFacadeMaterial(this.textures);
    this.buildings = buildBuildings(this.city, this.textures, this.facadeMat);
    this.scene.add(this.buildings.group);
    progress(0.55, 'Paving streets');
    await tick();
    this.ground = buildGround(this.city, this.textures);
    this.scene.add(this.ground.group);
    progress(0.75, 'Planting palms');
    await tick();
    this.props = new PropSystem(this.scene, this.city, this.textures, this.facadeMat, this.quality);
    progress(1, 'Ready');
  }
  update(dt, { time, nightFactor, camera, wetness = 0, timeOfDay = 12 }) {
    this.buildings.update(time, nightFactor);
    // fewer windows lit late at night
    const h = timeOfDay < 12 ? timeOfDay + 24 : timeOfDay; const late = smoothstep(22.5, 26.5, h) * (1 - smoothstep(28.5, 30.5, h));
    this.facadeMat.userData.uniforms.uLitFrac.value = 1 - late * 0.55;
    this.ground.update({ wetness });
    this.props.update(dt, { time, night: nightFactor, camera });
  }
  breakProp(i) { return this.props.breakProp(i); }
  restoreProp(i) { return this.props.restoreProp(i); }
  createDebris(kind, variant) { return this.props.createDebris(kind, variant); }
}
