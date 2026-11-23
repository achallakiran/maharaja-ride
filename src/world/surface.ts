// Road surface model: height + material at any (s, d) of the loop. Pure and deterministic (hash-based),
// shared by the road mesher (what you see) and the bike sim (what you feel).
//
// The loop is cut into 400 m zones; each zone is good tar, broken tar, flooded (potholes full of water and
// cross-road ditches) or sandy. Speed breakers appear on their own.
import type { RoadLoop } from '../route/loop.ts';
import { hash2 } from '../sim/rng.ts';

export const ROAD_HALF = 5.25;
export const ZONE_LEN = 400;
const CELL = 8;

export type ZoneKind = 'good' | 'broken' | 'flooded' | 'sand';
export type SurfaceKind = 'tar' | 'broken' | 'pothole' | 'water' | 'mud' | 'sand' | 'bump' | 'shoulder';

export interface Hole { s: number; d: number; r: number; depth: number; water: boolean }
export interface Ditch { s: number; len: number; depth: number }
export interface Breaker { s: number; len: number; height: number }

export interface SurfaceSample { h: number; kind: SurfaceKind }

/** Per-kind handling: extra deceleration (m/s^2) and steering grip multiplier. */
export const SURFACE_FEEL: Record<SurfaceKind, { drag: number; grip: number }> = {
  tar: { drag: 0, grip: 1 },
  broken: { drag: 0.15, grip: 0.95 },
  pothole: { drag: 0.5, grip: 0.85 },
  water: { drag: 2.2, grip: 0.7 },
  mud: { drag: 3.4, grip: 0.65 },
  sand: { drag: 1.6, grip: 0.8 },
  bump: { drag: 0, grip: 1 },
  shoulder: { drag: 3.2, grip: 0.85 },
};

const smooth = (t: number) => t * t * (3 - 2 * t);

export class RoadSurface {
  private readonly length: number;
  private readonly cells = new Map<number, { holes: Hole[]; ditches: Ditch[]; breakers: Breaker[] }>();

  constructor(loop: RoadLoop) { this.length = loop.length; }

  private wrap(s: number): number { return ((s % this.length) + this.length) % this.length; }

  zoneAt(s: number): ZoneKind {
    const z = Math.floor(this.wrap(s) / ZONE_LEN);
    const r = hash2(z, 11);
    return r < 0.38 ? 'good' : r < 0.68 ? 'broken' : r < 0.84 ? 'flooded' : 'sand';
  }

  private cell(k: number) {
    let c = this.cells.get(k);
    if (c) return c;
    const holes: Hole[] = [], ditches: Ditch[] = [], breakers: Breaker[] = [];
    const s0 = k * CELL, zone = this.zoneAt(s0 + CELL / 2);
    const p = zone === 'broken' ? 0.5 : zone === 'flooded' ? 0.42 : zone === 'sand' ? 0.07 : 0.04;
    for (let j = 0; j < 3; j++) {
      const h = hash2(k * 5 + j, 21);
      if (h > p) continue;
      const a = hash2(k * 5 + j, 22), b = hash2(k * 5 + j, 23), c2 = hash2(k * 5 + j, 24);
      holes.push({ s: s0 + a * CELL, d: -ROAD_HALF + b * 2 * ROAD_HALF, r: 0.5 + c2 * 0.7, depth: 0.05 + hash2(k * 5 + j, 25) * 0.11, water: zone === 'flooded' });
    }
    if (zone === 'flooded' && hash2(k, 31) < 0.07) ditches.push({ s: s0 + hash2(k, 32) * CELL, len: 3 + hash2(k, 33) * 4, depth: 0.14 + hash2(k, 34) * 0.1 });
    if (hash2(k, 41) < (zone === 'good' ? 0.018 : 0.012)) breakers.push({ s: s0 + hash2(k, 42) * CELL, len: 3.6, height: 0.09 });
    c = { holes, ditches, breakers };
    this.cells.set(k, c);
    return c;
  }

  /** Height and material at (s, d). d is metres right of the lane centre. */
  sample(s: number, d: number): SurfaceSample {
    const sw = this.wrap(s), zone = this.zoneAt(sw);
    const onTar = Math.abs(d) <= ROAD_HALF;
    if (!onTar) {
      const k = zone === 'flooded' ? 'mud' : zone === 'sand' ? 'sand' : 'shoulder';
      return { h: -0.015, kind: k };
    }
    let h = 0, kind: SurfaceKind = 'tar';
    if (zone === 'broken' || zone === 'flooded') {
      const n = hash2(Math.floor(sw / 1.5), Math.floor((d + 9) / 1.5) + 70);
      if (n < (zone === 'broken' ? 0.35 : 0.2)) kind = 'broken';
    } else if (zone === 'sand') {
      const drift = 1.4 + 2.4 * hash2(Math.floor(sw / 5), 91) * (0.4 + 0.6 * smooth(((sw / 5) % 1)));
      if (d < -ROAD_HALF + drift) kind = 'sand';
    }
    const k0 = Math.floor(sw / CELL);
    let water = false;
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      const c = this.cell(k);
      for (const hole of c.holes) {
        const ds = sw - hole.s, dd = d - hole.d, t = (ds * ds + dd * dd) / (hole.r * hole.r);
        if (t >= 1) continue;
        const bowl = -hole.depth * (1 - t);
        const wl = -hole.depth * 0.35;
        if (hole.water && bowl < wl) { if (wl < h || kind !== 'water') { h = Math.min(h, wl); kind = 'water'; water = true; } }
        else if (bowl < h) { h = bowl; if (!water) kind = 'pothole'; }
      }
      for (const dt of c.ditches) {
        const u = (sw - dt.s) / dt.len;
        if (u <= 0 || u >= 1) continue;
        const bowl = -dt.depth * Math.min(1, 1.5 * Math.sin(Math.PI * u));
        const wl = -dt.depth * 0.45;
        if (bowl < h || bowl < wl) { h = Math.min(h, Math.max(bowl, wl)); kind = bowl < wl ? 'water' : 'pothole'; water = water || bowl < wl; }
      }
      for (const b of c.breakers) {
        const u = (sw - b.s) / b.len;
        if (u <= 0 || u >= 1) continue;
        h += b.height * Math.sin(Math.PI * u) ** 0.8;
        kind = 'bump';
      }
    }
    return { h, kind };
  }

  height(s: number, d: number): number { return this.sample(s, d).h; }
}

const cache = new WeakMap<RoadLoop, RoadSurface>();
export function roadSurface(loop: RoadLoop): RoadSurface {
  let r = cache.get(loop);
  if (!r) { r = new RoadSurface(loop); cache.set(loop, r); }
  return r;
}
