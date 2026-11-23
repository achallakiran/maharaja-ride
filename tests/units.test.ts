import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, pickWeighted } from '../src/sim/rng.ts';
import { FixedStepper } from '../src/sim/stepper.ts';
import { FrameStats } from '../src/sim/frame-stats.ts';
import { VoxelGrid } from '../src/voxel/grid.ts';
import { meshVoxels } from '../src/voxel/mesher.ts';
import { K, VOXEL_M } from '../src/voxel/vehicles.ts';
import { buildTraffic, stepTraffic, gapAhead, worldZ, MIN_GAP, type LaneDef } from '../src/sim/spike-traffic.ts';
import { kit, RGB_PALETTE } from './helpers.ts';

test('rng is deterministic and in range', () => {
  const a = mulberry32(7), b = mulberry32(7);
  for (let i = 0; i < 100; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('pickWeighted respects weights and edges', () => {
  assert.equal(pickWeighted([1, 0, 0], 0.99), 0);
  assert.equal(pickWeighted([0, 1], 0), 1);
  assert.equal(pickWeighted([1, 1], 0.999), 1);
  const r = mulberry32(3), hits = [0, 0];
  for (let i = 0; i < 4000; i++) hits[pickWeighted([3, 1], r())]++;
  assert.ok(hits[0] > hits[1] * 2);
});

test('fixed stepper: equal steps, backlog guard', () => {
  const s = new FixedStepper(1 / 60);
  let n = 0;
  s.advance(1 / 30, () => n++);
  assert.equal(n, 2);
  n = 0;
  s.advance(5, () => n++); // clamped to 0.25 s -> 15 steps wanted, capped at 5
  assert.equal(n, 5);
  n = 0;
  s.advance(0.001, () => n++);
  assert.equal(n, 0);
});

test('frame stats window', () => {
  const f = new FrameStats(4);
  for (const t of [0.01, 0.02, 0.016, 0.016, 0.05]) f.push(t);
  assert.equal(f.count, 4);
  assert.ok(Math.abs(f.worstMs - 50) < 1e-9);
  assert.ok(f.fps > 30 && f.fps < 60);
});

test('mesher: single voxel = 6 faces, 24 verts; neighbours hide shared faces', () => {
  const g = new VoxelGrid(3, 3, 3);
  g.set(1, 1, 1, 1);
  const m = meshVoxels(g, RGB_PALETTE, { voxel: 1 });
  assert.equal(m.quads, 6);
  assert.equal(m.positions.length, 24 * 3);
  assert.equal(m.indices.length, 36);
  g.set(2, 1, 1, 1);
  assert.equal(meshVoxels(g, RGB_PALETTE, { voxel: 1 }).quads, 10);
});

test('mesher: normals are unit axis vectors and faces wind outward', () => {
  const g = new VoxelGrid(1, 1, 1);
  g.set(0, 0, 0, 1);
  const m = meshVoxels(g, RGB_PALETTE, { voxel: 1 });
  for (let t = 0; t < m.indices.length; t += 3) {
    const [i, j, k] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const P = (n: number) => [m.positions[n * 3], m.positions[n * 3 + 1], m.positions[n * 3 + 2]];
    const a = P(i), b = P(j), c = P(k);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const n = [m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]];
    assert.ok(cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0, 'triangle faces outward');
  }
});

test('mesher: filter emits only chosen voxels but culls against the whole grid', () => {
  const g = new VoxelGrid(2, 1, 1);
  g.set(0, 0, 0, K.BODY); g.set(1, 0, 0, K.DARK);
  const body = meshVoxels(g, RGB_PALETTE, { voxel: 1, filter: k => k === K.BODY });
  assert.equal(body.quads, 5); // shared face hidden by the dark neighbour
});

test('mesher: ambient occlusion darkens a corner', () => {
  const g = new VoxelGrid(3, 2, 3);
  g.set(1, 0, 1, 1); g.set(1, 1, 1, 1);
  g.set(0, 1, 1, 1); // wall beside the top face of the pillar? creates an occluder
  const lit = meshVoxels(g, RGB_PALETTE, { voxel: 1, ao: false });
  const ao = meshVoxels(g, RGB_PALETTE, { voxel: 1, ao: true });
  let a = 0, b = 0;
  for (const c of lit.colors) a += c;
  for (const c of ao.colors) b += c;
  assert.ok(b < a);
});

test('mesher: model is centred on x/z and sits on y=0', () => {
  const g = new VoxelGrid(4, 4, 4);
  g.box(0, 3, 0, 3, 0, 3, 1);
  const m = meshVoxels(g, RGB_PALETTE, { voxel: 0.5 });
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], m.positions[i + a]); hi[a] = Math.max(hi[a], m.positions[i + a]); }
  assert.deepEqual(lo.map(v => +v.toFixed(6)), [-1, 0, -1]);
  assert.deepEqual(hi.map(v => +v.toFixed(6)), [1, 2, 1]);
});

const EXPECT: Record<string, [number, number, number, number]> = {
  // id: [min length m, max length m, min height m, max height m]
  bike: [1.8, 2.4, 1.6, 2.0], scooter: [1.6, 2.1, 1.6, 2.1], auto: [2.4, 2.9, 1.6, 1.9],
  car: [3.5, 4.2, 1.4, 1.7], cab: [4.2, 4.8, 1.5, 1.9], tempo: [3.6, 4.4, 1.5, 1.9],
  bus: [9.5, 12.5, 2.8, 3.3], truck: [8.0, 10.0, 3.2, 3.8],
};

for (const spec of kit) {
  test(`vehicle ${spec.id}: one connected piece, in bounds, real-world size`, () => {
    assert.equal(spec.grid.clipped, 0, 'no voxels written outside the grid');
    assert.equal(spec.grid.components(), 1, 'nothing floating');
    assert.ok(spec.grid.countOf(K.BODY) > 20, 'has paintable body');
    assert.ok(spec.grid.countOf(K.TIRE) > 10, 'has tyres');
    const b = spec.grid.bounds()!;
    assert.equal(b.y0, 0, 'tyres touch the ground');
    const [l0, l1, h0, h1] = EXPECT[spec.id];
    const lenM = (b.z1 - b.z0 + 1) * VOXEL_M, hM = (b.y1 + 1) * VOXEL_M;
    assert.ok(lenM >= l0 && lenM <= l1, `length ${lenM}`);
    assert.ok(hM >= h0 && hM <= h1, `height ${hM}`);
    const mesh = meshVoxels(spec.grid, RGB_PALETTE, { voxel: VOXEL_M });
    assert.ok(mesh.quads > 100 && mesh.quads < 20000, `quads ${mesh.quads}`);
    for (const c of mesh.colors) assert.ok(Number.isFinite(c) && c >= 0 && c <= 1);
  });
}

test('vehicle kit: eight unique types with positive weights and paints', () => {
  assert.equal(kit.length, 8);
  assert.equal(new Set(kit.map(k => k.id)).size, 8);
  for (const k of kit) { assert.ok(k.weight > 0); assert.ok(k.paints.length > 0); }
});

const LANES: LaneDef[] = [
  { x: -4.5, dir: 1 }, { x: -7.5, dir: 1 }, { x: -10.5, dir: 1 },
  { x: 4.5, dir: -1 }, { x: 7.5, dir: -1 }, { x: 10.5, dir: -1 },
];
const TYPES = kit.map(k => ({ weight: k.weight, lengthM: k.lengthM, paints: k.paints }));

test('traffic: deterministic spawn, requested count, no overlap at start or after running', () => {
  const a = buildTraffic(5, LANES, -15, 225, 90, TYPES), b = buildTraffic(5, LANES, -15, 225, 90, TYPES);
  assert.equal(a.vehicles.length, 90);
  assert.deepEqual(a.vehicles.map(v => v.s), b.vehicles.map(v => v.s));
  for (let t = 0; t < 600; t++) {
    stepTraffic(a, 1 / 60);
    if (t % 60 === 0 || t === 599) for (const lane of a.order) for (let i = 0; i < lane.length; i++) {
      assert.ok(gapAhead(a, lane, i) >= MIN_GAP - 1e-6, `gap ${gapAhead(a, lane, i)} at step ${t}`);
    }
  }
});

test('traffic: moves forward, wraps inside the ring, speeds bounded', () => {
  const w = buildTraffic(9, LANES, -15, 225, 40, TYPES);
  const z0 = w.vehicles.map(v => worldZ(w, v));
  for (let t = 0; t < 3000; t++) stepTraffic(w, 1 / 60);
  for (const v of w.vehicles) {
    assert.ok(v.s >= 0 && v.s < w.ring);
    assert.ok(v.speed >= 0 && v.speed <= 5 + 1e-6);
    const z = worldZ(w, v);
    assert.ok(z >= w.zMin - 1e-6 && z <= w.zMax + 1e-6);
  }
  assert.notDeepEqual(z0, w.vehicles.map(v => worldZ(w, v)));
});

test('traffic: oncoming lanes run toward -z', () => {
  const w = buildTraffic(2, LANES, -15, 225, 12, TYPES);
  const v = w.vehicles.find(x => w.lanes[x.lane].dir < 0)!;
  const z1 = worldZ(w, v);
  for (let i = 0; i < 60; i++) stepTraffic(w, 1 / 60);
  assert.ok(worldZ(w, v) <= z1);
});

test('traffic: a full ring still respects capacity (never over-fills)', () => {
  const w = buildTraffic(1, LANES, 0, 30, 500, TYPES);
  for (const lane of w.order) {
    let used = 0;
    for (const i of lane) used += w.vehicles[i].len;
    assert.ok(used < w.ring);
  }
  assert.ok(w.vehicles.length < 500);
});

// ---------------------------------------------------------------- Phase 1: route loop
import { ROUTE_A, ROUTE_B, MILESTONES } from '../src/route/route-data.ts';
import { RoadLoop, buildLaneRing } from '../src/route/loop.ts';
import { bangaloreLoop } from '../src/route/bangalore.ts';

test('route data: A and B share endpoints; lane ring is closed with U-turns at both ends', () => {
  const a0 = ROUTE_A[0], b0 = ROUTE_B[0], a1 = ROUTE_A.at(-1)!, b1 = ROUTE_B.at(-1)!;
  assert.ok(Math.hypot(a0[0] - b0[0], a0[1] - b0[1]) < 1);
  assert.ok(Math.hypot(a1[0] - b1[0], a1[1] - b1[1]) < 1);
  const ring = buildLaneRing(ROUTE_A, ROUTE_B);
  assert.ok(ring.length > 28000);
});

test('loop: length matches the real routes, spacing even, smooth', () => {
  const loop = bangaloreLoop();
  assert.ok(loop.length > 28000 && loop.length < 31000, `length ${loop.length}`);
  assert.ok(Math.abs(loop.ds - 1) < 0.01);
  let maxStep = 0, minStep = Infinity;
  for (let s = 0; s < loop.length; s += 1) {
    const p = loop.sample(s), q = loop.sample(s + 1);
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    maxStep = Math.max(maxStep, d); minStep = Math.min(minStep, d);
    assert.ok(Math.abs(Math.hypot(p.fx, p.fz) - 1) < 1e-9);
  }
  assert.ok(maxStep < 1.2 && minStep > 0.5, `steps ${minStep}..${maxStep}`);
});

test('loop: closes seamlessly (end meets start, same heading)', () => {
  const loop = bangaloreLoop();
  const a = loop.sample(loop.length - 0.01), b = loop.sample(0);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.1);
  assert.ok(a.fx * b.fx + a.fz * b.fz > 0.999);
});

test('loop: corners are rideable (minimum turn radius)', () => {
  const loop = bangaloreLoop();
  let maxK = 0, spots = 0, last = -1e9;
  for (let s = 0; s < loop.length; s += 1) {
    const k = Math.abs(loop.kappaAt(s));
    maxK = Math.max(maxK, k);
    if (k > 1 / 5 && s - last > 40) spots++;
    if (k > 1 / 5) last = s;
  }
  // the only truly tight spot should be the U-turn at Aquamarine, where route A hands over to route B
  assert.ok(1 / maxK >= 2, `tightest radius ${(1 / maxK).toFixed(1)} m`);
  assert.ok(spots <= 4, `${spots} corners tighter than 5 m`);
});

test('loop: curvature sign - a right-hand circle has positive curvature', () => {
  // clockwise circle seen from above in (x east, z south): heading turns right
  const R = 100, ring = Array.from({ length: 120 }, (_, i) => { const t = (i / 120) * Math.PI * 2; return [R * Math.sin(t), -R * (1 - Math.cos(t))] as const; });
  const loop = new RoadLoop(ring);
  const k = loop.kappaAt(50);
  assert.ok(Math.abs(Math.abs(k) - 1 / R) < 0.002, `kappa ${k}`);
  // a point to the right of a right-turning road is closer to the circle centre
  const c = loop.sample(100), o = loop.offset(100, 10);
  const centre = [0, -R];
  const dc = Math.hypot(c.x - centre[0], c.z - centre[1]), dof = Math.hypot(o.x - centre[0], o.z - centre[1]);
  assert.ok(k > 0 ? dof < dc : dof > dc);
});

test('loop: milestones are placed, include both passes of shared roads, and name lookup works', () => {
  const loop = bangaloreLoop();
  // Forum Mall is ~340 m off both routes, so it is (rightly) not placed on the loop
  assert.ok(loop.milestones.length >= MILESTONES.length - 2, `placed ${loop.milestones.length}`);
  const utopia = loop.milestones.filter(m => m.short === 'Utopia');
  assert.ok(utopia.length >= 1);
  const near = loop.nearMilestone(utopia[0].s + 10);
  assert.equal(near?.short, 'Utopia');
  assert.equal(loop.nearMilestone(utopia[0].s + loop.length / 2 + 5000, 1), null);
});

test('loop: delta is the signed shortest distance around the ring', () => {
  const loop = bangaloreLoop(), L = loop.length;
  assert.ok(Math.abs(loop.delta(L - 5, 5) - 10) < 1e-9);
  assert.ok(Math.abs(loop.delta(5, L - 5) + 10) < 1e-9);
});

// ---------------------------------------------------------------- Phase 1: bike, road chunks, engine
import { newBike, stepBike, BIKE, type BikeInput } from '../src/sim/bike.ts';
import { newEngine, stepEngine, GEAR_TOP, IDLE_RPM, REDLINE_RPM } from '../src/audio/engine-model.ts';
import { buildRoadChunk, chunkProps, chunkCount, CHUNK_LEN, COLUMNS, ROAD_HALF, SHOULDER } from '../src/world/road-chunk.ts';

const START = 150; // a straight stretch of route A
const IDLE: BikeInput = { steer: 0, throttle: 0, brake: 0, horn: false };
const run = (b: ReturnType<typeof newBike>, inp: BikeInput, seconds: number, loop = bangaloreLoop()) => {
  for (let i = 0; i < seconds * 60; i++) stepBike(b, inp, s => loop.kappaAt(s), loop.length, 1 / 60);
};

test('bike: accelerates toward vmax, never beyond, never negative', () => {
  const b = newBike(START);
  const straight = { kappaAt: () => 0, length: 1e7 } as unknown as ReturnType<typeof bangaloreLoop>;
  run(b, { ...IDLE, throttle: 1 }, 6, straight);
  assert.ok(b.v > 12);
  run(b, { ...IDLE, throttle: 1 }, 120, straight);
  assert.ok(b.v > BIKE.vmax * 0.85 && b.v <= BIKE.vmax + 1e-9, `top speed ${b.v}`);
  run(b, { ...IDLE, brake: 1 }, 10, straight);
  assert.equal(b.v, 0);
});

test('bike: coasting slows down, braking stops faster', () => {
  const a = newBike(START), c = newBike(START);
  a.v = c.v = 15;
  run(a, IDLE, 3); run(c, { ...IDLE, brake: 1 }, 3);
  assert.ok(a.v < 15 && a.v > c.v);
});

test('bike: steering right moves right of the lane, left moves left; no steering at standstill', () => {
  const r = newBike(START), l = newBike(START), z = newBike(START);
  for (const b of [r, l]) b.v = 10;
  run(r, { ...IDLE, throttle: 0.5, steer: 1 }, 1.2);
  run(l, { ...IDLE, throttle: 0.5, steer: -1 }, 1.2);
  assert.ok(r.d > 0.2 && l.d < -0.2, `d ${r.d} ${l.d}`);
  assert.ok(r.lean > 0 && l.lean < 0);
  run(z, { ...IDLE, steer: 1 }, 2);
  assert.equal(z.d, 0);
});

test('bike: steering is capped to a lane-change angle, not a spin-out', () => {
  const b = newBike(START);
  b.v = 12;
  let worst = 0;
  for (let i = 0; i < 60 * 3; i++) { stepBike(b, { ...IDLE, throttle: 0.4, steer: 1 }, s => bangaloreLoop().kappaAt(s), bangaloreLoop().length, 1 / 60); worst = Math.max(worst, Math.abs(b.psi)); }
  assert.ok(worst < BIKE.maxAngle + 0.15, `angle off the road ${worst}`);
});

test('bike: road edge is a hard limit and the shoulder is slow', () => {
  const b = newBike(START);
  b.v = 20;
  run(b, { ...IDLE, throttle: 1, steer: 1 }, 20);
  assert.ok(Math.abs(b.d) <= BIKE.edge + 1e-9);
  assert.ok(b.v < 12, `speed on the shoulder ${b.v}`);
});

test('bike: a simple centre-following rider completes the whole loop without leaving the road', () => {
  const loop = bangaloreLoop(), b = newBike(START);
  let worst = 0, laps = 0, prev = 0;
  const kappa = (s: number) => loop.kappaAt(s);
  for (let i = 0; i < 60 * 3000 && laps < 1; i++) {
    // slow down for tight corners, steer back toward the centre
    const k = Math.abs(kappa(b.s + 12));
    const want = Math.min(BIKE.vmax * 0.8, Math.sqrt(4.5 / Math.max(k, 1e-4)));
    const steer = Math.max(-1, Math.min(1, 0.22 * b.d + 1.6 * b.psi));
    stepBike(b, { steer: -steer, throttle: b.v < want ? 1 : 0, brake: b.v > want + 2 ? 1 : 0, horn: false }, kappa, loop.length, 1 / 60);
    worst = Math.max(worst, Math.abs(b.d));
    if (b.s < prev - loop.length / 2) laps++;
    prev = b.s;
  }
  assert.equal(laps, 1, 'finished a lap');
  assert.ok(worst < 4.5, `max lateral offset ${worst}`);
  assert.ok(b.odo > loop.length * 0.98);
});

test('bike: with no steering the bike follows the road, even through bends', () => {
  const b = newBike(START), loop = bangaloreLoop();
  b.v = 8;
  let worst = 0;
  for (let i = 0; i < 60 * 60; i++) { stepBike(b, { ...IDLE, throttle: b.v < 9 ? 0.6 : 0.1 }, s => loop.kappaAt(s), loop.length, 1 / 60); worst = Math.max(worst, Math.abs(b.d)); }
  assert.ok(worst < 3, `drifted ${worst} m`);
});

test('engine model: rpm bounded, gears climb with speed and fall back, shifts have hysteresis', () => {
  const e = newEngine();
  let lastGear = 0, shiftsUp = 0;
  for (let v = 0; v <= 25; v += 0.05) {
    stepEngine(e, v, 1, 0.05);
    assert.ok(e.rpm >= IDLE_RPM - 1 && e.rpm <= REDLINE_RPM + 1);
    if (e.gear > lastGear) shiftsUp++;
    assert.ok(e.gear >= lastGear);
    lastGear = e.gear;
  }
  assert.equal(e.gear, GEAR_TOP.length - 1);
  assert.equal(shiftsUp, GEAR_TOP.length - 1);
  for (let v = 25; v >= 0; v -= 0.05) for (let k = 0; k < 4; k++) stepEngine(e, v, 0, 0.05);
  assert.equal(e.gear, 0);
  assert.ok(e.rpm < 2200);
});

test('road chunks: cover the loop, finite, upward facing, edges line up with neighbours', () => {
  const loop = bangaloreLoop();
  const n = chunkCount(loop);
  assert.equal(n, Math.ceil(loop.length / CHUNK_LEN));
  for (const c of [0, 1, 77, n - 2, n - 1]) {
    const m = buildRoadChunk(loop, c);
    assert.ok(m.quads >= (c === n - 1 ? 1 : CHUNK_LEN) * COLUMNS.length * 0.99, `quads ${m.quads} (chunk ${c})`);
    for (const v of m.positions) assert.ok(Number.isFinite(v));
    for (let t = 0; t < m.indices.length; t += 3) {
      const P = (i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
      const a = P(m.indices[t]), b = P(m.indices[t + 1]), cc = P(m.indices[t + 2]);
      const e1 = [b[0] - a[0], b[2] - a[2]], e2 = [cc[0] - a[0], cc[2] - a[2]];
      // normal y of (e1 x e2) in three's right-handed system: e1.z*e2.x - e1.x*e2.z
      const ny = e1[1] * e2[0] - e1[0] * e2[1];
      assert.ok(ny >= -0.05, 'faces up (tiny folds in hairpin pinches are tolerated)');
    }
  }
  // the first row of chunk c+1 starts where chunk c ended
  const a = buildRoadChunk(loop, 3), b = buildRoadChunk(loop, 4);
  const q = (a.quads - COLUMNS.length) * 12 + 9; // first column of the last row, its far-left (s end) corner
  assert.ok(Math.abs(a.positions[q] - b.positions[0]) < 0.05 && Math.abs(a.positions[q + 2] - b.positions[2]) < 0.05, 'chunks join without a gap');
  assert.ok(COLUMNS[0].d0 === -SHOULDER && COLUMNS.at(-1)!.d1 === SHOULDER && ROAD_HALF === 5.25);
  for (let i = 1; i < COLUMNS.length; i++) assert.ok(Math.abs(COLUMNS[i].d0 - COLUMNS[i - 1].d1) < 1e-9, 'columns are contiguous');
});

test('road props: deterministic, off the tar, trees farther out than posts', () => {
  const loop = bangaloreLoop();
  const a = chunkProps(loop, 12), b = chunkProps(loop, 12);
  assert.deepEqual(a, b);
  assert.ok(a.some(p => p.kind === 'post') && a.some(p => p.kind === 'lamp'));
  const total = Array.from({ length: 60 }, (_, c) => chunkProps(loop, c)).flat();
  assert.ok(total.some(p => p.kind === 'tree'));
  assert.ok(total.length < 60 * 60, 'prop budget');
});

// ---------------------------------------------------------------- Phase 1: cockpit and props
import { buildCockpit, COCKPIT_VOXEL } from '../src/voxel/cockpit.ts';
import { buildPost, buildLamp, buildTree } from '../src/voxel/props.ts';

test('cockpit: one connected piece, in bounds, bar is a believable width', () => {
  const g = buildCockpit();
  assert.equal(g.clipped, 0);
  assert.equal(g.components(), 1);
  assert.ok(g.countOf(K.BODY) > 100 && g.countOf(K.MIRROR) > 20 && g.countOf(K.GLOVE) > 40);
  const b = g.bounds()!;
  const widthM = (b.x1 - b.x0 + 1) * COCKPIT_VOXEL;
  assert.ok(widthM > 1.0 && widthM < 1.4, `width ${widthM}`);
  // symmetric left/right about the centre line
  for (let y = 0; y < g.h; y++) for (let z = 0; z < g.l; z++) for (let x = 0; x < g.w; x++) {
    assert.equal(g.get(x, y, z) === 0, g.get(g.w - 1 - x, y, z) === 0, `asymmetric at ${x},${y},${z}`);
  }
});

test('props: post, lamp and both trees are single connected pieces with sane sizes', () => {
  for (const [name, g, minH, maxH] of [['post', buildPost(), 0.8, 1.0], ['lamp', buildLamp(), 7.5, 8.5], ['tree0', buildTree(0), 4, 7], ['tree1', buildTree(1), 3, 7]] as const) {
    assert.equal(g.clipped, 0, name);
    assert.equal(g.components(), 1, name);
    const vox = name === 'post' || name === 'lamp' ? 0.1 : 0.35;
    const h = (g.bounds()!.y1 + 1) * vox;
    assert.ok(h >= minH && h <= maxH, `${name} height ${h}`);
  }
});

// ---------------------------------------------------------------- Phase 2: road surface
import { roadSurface, ZONE_LEN, SURFACE_FEEL } from '../src/world/surface.ts';

test('surface: deterministic, finite, mixture of zones and features', () => {
  const loop = bangaloreLoop(), a = roadSurface(loop), b = new (a.constructor as new (l: typeof loop) => typeof a)(loop);
  const zones = new Set<string>(), kinds = new Set<string>();
  let minH = 0, maxH = 0;
  for (let s = 0; s < loop.length; s += 0.7) for (let d = -8; d <= 8; d += 1.1) {
    const x = a.sample(s, d), y = b.sample(s, d);
    assert.equal(x.h, y.h); assert.equal(x.kind, y.kind);
    assert.ok(Number.isFinite(x.h));
    kinds.add(x.kind); minH = Math.min(minH, x.h); maxH = Math.max(maxH, x.h);
  }
  for (let z = 0; z * ZONE_LEN < loop.length; z++) zones.add(a.zoneAt(z * ZONE_LEN + 1));
  assert.equal(zones.size, 4, 'all four zone kinds appear');
  for (const k of ['tar', 'broken', 'pothole', 'water', 'mud', 'sand', 'bump', 'shoulder']) assert.ok(kinds.has(k), `has ${k}`);
  assert.ok(minH > -0.75 && minH < -0.12, `deepest ${minH}`);
  assert.ok(maxH > 0.05 && maxH < 0.2, `tallest ${maxH}`);
  assert.ok(SURFACE_FEEL.mud.drag > SURFACE_FEEL.tar.drag);
});

test('surface: smooth enough to ride (no cliffs between neighbouring samples)', () => {
  const loop = bangaloreLoop(), a = roadSurface(loop);
  let worst = 0;
  for (let s = 100; s < 6000; s += 0.25) for (let d = -5; d <= 5; d += 0.5) worst = Math.max(worst, Math.abs(a.height(s + 0.25, d) - a.height(s, d)));
  assert.ok(worst < 0.26, `step ${worst}`);
});

test('bike: potholes and breakers move the suspension and cost speed', () => {
  const loop = bangaloreLoop(), surf = roadSurface(loop);
  // find a speed breaker
  let sb = -1;
  for (let s = 200; s < loop.length && sb < 0; s += 0.5) if (surf.sample(s, 0).kind === 'bump' && Math.abs(loop.kappaAt(s)) < 0.002) sb = s;
  assert.ok(sb > 0, 'found a breaker');
  const b = newBike(sb - 30); b.v = 12;
  let amp = 0;
  for (let i = 0; i < 60 * 5; i++) { stepBike(b, { ...IDLE, throttle: 0.5 }, s => loop.kappaAt(s), loop.length, 1 / 60, (s, d) => surf.sample(s, d)); amp = Math.max(amp, Math.abs(b.y)); }
  assert.ok(amp > 0.03 && amp < 0.3, `suspension travel ${amp}`);
  assert.ok(Number.isFinite(b.y) && Math.abs(b.y) < 0.4, 'stays bounded');
});

test('bike: mud, water and sand cap the top speed well below tar', () => {
  const run = (kind: 'tar' | 'mud' | 'water' | 'sand') => {
    const b = newBike(300); b.v = 20;
    for (let i = 0; i < 60 * 8; i++) stepBike(b, { ...IDLE, throttle: 1 }, () => 0, 1e6, 1 / 60, () => ({ h: 0, kind }));
    return b.v;
  };
  const tar = run('tar'), mud = run('mud'), water = run('water'), sand = run('sand');
  assert.ok(tar > 20 && mud < 0.5 * tar && water < 0.55 * tar && sand < 0.65 * tar, `${tar} ${mud} ${water} ${sand}`);
});
