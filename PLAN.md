# Maharaja Ride: implementation plan

First-person voxel bike ride through Bangalore peak traffic. Free ride on a looped real route. Bike only to start.

## Locked decisions
- Stack: TypeScript, esbuild single-file offline build, Three.js bundled (no CDN). Pure game logic separate from rendering, with unit tests.
- Route: the real Utopia <-> Aquamarine corridor (route data from `city_drive_one`). Route A out (13.6 km, Panathur Rd + ORR), Route B back (15.3 km, Whitefield + Hoodi) = a ~29 km closed loop. To confirm: both routes share endpoints.
- Vehicle: bike only. Mode: free ride (no timer, score or missions).
- Targets: 60 fps on iPhone, about 200 draw calls or fewer, blob shadows only, fully offline.
- Workflow: each phase ends with tests, push to `main`, Pages link, then user test and feedback.

## Phases
0. **Foundation + perf spike** (this push): scaffold, tests, Pages deploy, 8-type voxel vehicle kit, instanced fleet, on-screen perf readout.
1. **Ride the empty loop**: road ribbon from the route polyline (A out, B back), chunk streaming, arcade bike physics, first-person cockpit (handlebar, mirrors, lean), joystick + throttle/brake + horn, landscape + fullscreen, basic engine sound.
2. **Broken roads**: per-cell height/depth field (potholes, ditches, speed breakers, patches); surface types (tar, broken, mud, sand); suspension bumps and camera shake.
2b. **Hazards you can feel** (user feedback after Phase 2): deep ditches every ~150-250 m in broken/flooded zones with one inside the first 100 m; hitting a ditch or hole is an event (hard speed loss, camera slam, throttle weak while stuck in deep water); warning stripes before deep ditches; surface sound (thud on holes, splash in water, squelch in mud, hiss in sand, rumble on broken tar). Falls and crashes wait for Phase 4.
2c. **Bike balance, wobble, feet and falls** (user feedback; replaces the point-bike feel):
   - Two-wheel contact: front and rear wheel each have height, load and grip; a front-wheel hit on a hole edge kicks the bars, a rear hit kicks the tail.
   - Balance value with wobble: speed stabilises, roughness and sudden steering disturb. Fast and rough = speed wobble that grows if you fight it; easing off and holding steady settles it. Joystick counter-steer helps if gentle, big inputs make it worse. Recovery must feel natural; if the disturbance is too big the rider simply cannot recover.
   - Feet: under ~10 km/h (and while stuck) the rider balances by dabbing feet; support depends on surface (tar/broken/shallow water good, mud/sand weak, deep trench and steep walls almost none). Throttle at crawl speed paddles the bike up a ditch wall, so deep ditches are escapable. 10-25 km/h is the risky band.
   - Falls: caused by dropping the front wheel into a deep/steep hole at speed, lean past the grip limit, or a growing wobble. Quick reset: a blink, then back on the road near zero speed (about 2 s). Real crashes with traffic come in Phase 4.
   - Sudden unmarked damage: broken sections and edge breaks with no warning stripes, more frequent and sharper in broken zones.
   - Feet feedback: voxel boots enter the lower corners on a dab, camera drops and tilts toward the planted foot, surface-specific scuff/squelch/splash/crunch sounds, dust or splash at the boot (basic now, nicer in Phase 6), bars shake plus a red edge vignette before a fall, phone vibration on Android (iPhone Safari does not support it).
   - Build order: (1) two-wheel contact + balance + wobble, (2) foot dab + slow paddling, (3) falls + blink reset, (4) unmarked damage, (5) boots/camera/sound/vibration feedback. Ship with generous recovery and a wobble indicator, then tune on the phone.
3. **Static Bangalore**: voxel buildings, flyovers, medians, footpaths, trees, signboards, parked vehicles as face-culled chunk meshes; sky, fog, baked AO.
4. **Traffic v1**: the 8 vehicle types with LOD, spawn/despawn ring around the rider, lane-following, bike collisions (slow bump vs fall and recover).
5. **Cut-throat traffic**: lane-less gap seeking, cut-ins, horns, jam waves, denser junction zones, bike filtering with mirror-scrape feedback.
6. **Water and sand**: puddles in ditches, splash cubes scaled to speed, spray on the first-person view, side-blown sand, wheel dust, quality tiers.
7. **Weather and time of day**: rain, wet roads, evening/night with headlights.
8. **Polish**: audio (horns, ambience, engines), pause/settings, installable on mobile, final perf pass.
