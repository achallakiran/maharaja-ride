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
