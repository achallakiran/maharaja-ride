# Maharaja Ride

A first-person voxel bike ride through Bangalore peak-hour traffic. Plain TypeScript + Three.js, bundled into one offline HTML file (no CDN), served by GitHub Pages from the root of `main`.

Play: https://achallakiran.github.io/maharaja-ride/

## Status
**Phase 0 (foundation + perf spike).** A first-person view of a divided road packed with eight kinds of voxel Indian vehicles (motorcycle, scooter, auto-rickshaw, hatchback, cab, tempo, city bus, lorry). The readout shows fps, draw calls and triangles; `-10` / `+10` change the vehicle count and `DPR` cycles render resolution. Use it to find how many vehicles your phone holds at 60 fps.

Try `?n=80` for a starting count, or `?bench=1` for an automatic 20 → 100 vehicle benchmark (results in `window.__bench`).

See [PLAN.md](PLAN.md) for the roadmap.

## Develop
```
npm ci
npm run check      # type check
npm test           # unit tests (Node, no browser)
npm run build      # -> dist/index.html (single offline file)
npm run release    # build + copy index.html to the repo root for Pages
npm run test:smoke # headless Chrome smoke test (pip install playwright pillow; needs Chrome)
```

## Layout
```
src/sim/     pure logic: rng, fixed stepper, frame stats, traffic (no three.js, unit tested)
src/voxel/   voxel grid, face-culled AO mesher, procedural vehicle kit (pure, unit tested)
src/render/  three.js adapters (instanced vehicle fleet)
src/spike/   Phase 0 perf spike scene
tests/       node unit tests + headless smoke test
```


## Phase 1 status: ride the empty loop
First-person bike on the Utopia ↔ Aquamarine loop (left carriageway, U-turns at both ends): road streaming, arcade bike physics, cockpit with mirrors and lean, joystick + gas/brake/horn, engine sound. Spike still at `?spike=1`.
