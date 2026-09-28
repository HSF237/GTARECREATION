// Entry point: boots Sol Harbor.
import { Mesh, CylinderGeometry, MeshStandardMaterial } from 'three';
import { Game } from './game/game.js';

function fail(msg) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;background:#07060d;color:#ffd9b8;font:15px Barlow,system-ui,sans-serif;z-index:99';
  d.textContent = msg; document.body.appendChild(d);
}
(function boot() {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) { fail('Sol Harbor needs WebGL 2. Try a recent Chrome, Edge, Firefox or Safari (iPhone and iPad: iOS 15 or newer) with hardware acceleration turned on.'); return; }
  const root = document.getElementById('app') || document.body;
  const game = new Game(root);
  window.__game = game; window.__THREE = { Mesh, CylinderGeometry, MeshStandardMaterial }; // handles for automated playtests
  game.init().then(() => { window.__gameReady = true; }).catch((e) => {
    console.error(e);
    fail('The city failed to load: ' + (e && e.message ? e.message : e) + '. Reload the page to try again.');
  });
})();
