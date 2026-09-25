# GTA RECREATION: Sol Harbor

An open-world crime and driving game that runs in the browser, built from scratch with three.js and WebGL 2.

**Play it:** https://hsf237.github.io/GTARECREATION/ (desktop and phone)

Sol Harbor is inspired by the big open-world crime games, but everything in it is original: the island city, the characters, the cars, the missions and the radio music (generated live in the browser). No names, art, audio or code from any existing game are used, and this project is not affiliated with Rockstar Games or Take-Two Interactive.

## What's in the game

- **A living island city:** downtown towers, a beach boardwalk, the harbor and hills, with a day/night cycle and rain and fog.
- **Realistic people:** sculpted, skinned humans with natural walking, micro-expressions and lip-sync. Pedestrians react to what you do.
- **Driving:** sports cars, sedans, vans, taxis and police cars. Traffic follows the roads, cars take damage, and there are stunt jumps and paint shops.
- **On foot:** pistols, SMGs, shotguns and rifles, aiming and melee.
- **Police heat:** five levels, with car chases, officers on foot and a helicopter.
- **Missions:** story jobs for Inez, Otis and Marisol, plus street races, courier runs and taxi duty.
- **Extras:** a full map with GPS routes and waypoints, generative radio stations, and save/load.
- **Phones:** touch controls (move stick, drag to look, context buttons, driving pedals) and a layout for phones and tablets.

## Controls

| Desktop | |
|---|---|
| WASD | Move / drive |
| Mouse | Look (click to capture) |
| Shift / Space | Sprint / jump, handbrake |
| F | Enter / exit vehicle |
| Right / left mouse | Aim / shoot |
| 1-5, wheel, R | Weapons, reload |
| H, V, C | Horn, vehicle camera, look behind |
| E / Q | Radio (and E to talk or start jobs) |
| M, T | Map, taxi duty |
| Esc / P | Pause and settings |

**Phone:** left thumb moves (push past the ring to sprint) and the right thumb looks around. Use FIRE, AIM, JUMP and ENTER on foot, and GAS, BRAKE and DRIFT when driving. Tap the minimap for the full map, and tap prompts to talk, shop or start jobs. It plays best sideways.

## Run it locally

```bash
npm install
npm run build        # bakes the character meshes on a fresh clone, then bundles the game
```

Then open `dist/solharbor.html` in Chrome, Edge, Firefox or Safari. The whole game is one self-contained HTML file.

The character meshes are sculpted from signed distance fields and baked ahead of time into `src/generated/humans.bin.js`:

```bash
npm run bake         # incremental (cached in .cache/humans); add -- --force to rebuild everything
```

Every push to `main` runs `.github/workflows/pages.yml`, which bakes, builds and publishes the game to GitHub Pages.

## Automated tests

These run headless Chromium through Playwright (`npx playwright install chromium` once):

```bash
npm run test:missions   # plays through every story mission and side job
npm run test:move       # key-press to movement latency and stopping distance
npm run test:phone      # phone emulation driven by real multi-touch events
```

## Project layout

```
src/core      input (keyboard, mouse, gamepad, touch), math, seeded RNG
src/world     city generator, terrain, roads, buildings, props, collision
src/gfx       sky, lighting, post-processing, particles, decals
src/entities  humans (sculpting, baking, GPU skinning), vehicles
src/game      player, camera, traffic, pedestrians, police, combat, missions
src/audio     engines, effects, sirens, generative radio
src/ui        HUD, minimap and map, touch controls
tools/        mesh baker and automated playtests
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module contracts and conventions.

## Built with

[three.js](https://threejs.org), [postprocessing](https://github.com/pmndrs/postprocessing), [N8AO](https://github.com/N8python/n8ao), [fflate](https://github.com/101arrowz/fflate), [meshoptimizer](https://github.com/zeux/meshoptimizer), [esbuild](https://esbuild.github.io) and [Playwright](https://playwright.dev).
