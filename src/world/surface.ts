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

/** Per-kind handling: extra deceleration (m/s^2), steering grip multiplier and top-speed cap (fraction of vmax). */
export const SURFACE_FEEL: Record<SurfaceKind, { drag: number; grip: number; cap: number }> = {
  tar: { drag: 0, grip: 1, cap: 1 },
  broken: { drag: 0.3, grip: 0.95, cap: 0.7 },
  pothole: { drag: 1.5, grip: 0.85, cap: 0.5 },
  water: { drag: 4, grip: 0.7, cap: 0.4 },
  mud: { drag: 5, grip: 0.65, cap: 0.35 },
  sand: { drag: 2.5, grip: 0.8, cap: 0.5 },
  bump: { drag: 1, grip: 1, cap: 0.5 },
  shoulder: { drag: 2, grip: 0.85, cap: 0.55 },
};

const smooth = (t: number) => t * t * (3 - 2 * t);

export class RoadSurface {
  private readonly length: number;
  private readonly cells = new Map<number, { holes: Hole[]; ditches: Ditch[]; breakers: Breaker[] }>();

  constructor(loop: RoadLoop) { this.length = loop.length; }

  private wrap(s: number): number { return ((s % this.length) + this.length) % this.length; }

  zoneAt(s: number): ZoneKind {
    const z = Math.floor(this.wrap(s) / ZONE_LEN);
    if (z === 0) return 'broken'; // the start of the ride shows off what the roads are like
    if (z === 1) return 'flooded';
    const r = hash2(z, 11);
    return r < 0.2 ? 'good' : r < 0.55 ? 'broken' : r < 0.82 ? 'flooded' : 'sand';
  }

  private cell(k: number) {
    let c = this.cells.get(k);
    if (c) return c;
    const holes: Hole[] = [], ditches: Ditch[] = [], breakers: Breaker[] = [];
    const s0 = k * CELL, zone = this.zoneAt(s0 + CELL / 2);
    const p = zone === 'broken' ? 0.85 : zone === 'flooded' ? 0.8 : zone === 'sand' ? 0.12 : 0.05;
    for (let j = 0; j < 4; j++) {
      const h = hash2(k * 7 + j, 21);
      if (h > p) continue;
      const a = hash2(k * 7 + j, 22), b = hash2(k * 7 + j, 23), c2 = hash2(k * 7 + j, 24);
      holes.push({ s: s0 + a * CELL, d: -ROAD_HALF + b * 2 * ROAD_HALF, r: 0.7 + c2 * 1.1, depth: 0.09 + hash2(k * 7 + j, 25) * 0.17, water: zone === 'flooded' });
    }
    if ((zone === 'flooded' && hash2(k, 31) < 0.16) || (zone === 'broken' && hash2(k, 31) < 0.06)) ditches.push({ s: s0 + hash2(k, 32) * CELL, ...(hash2(k, 35) < 0.4 ? { len: 9 + hash2(k, 33) * 8, depth: 0.35 + hash2(k, 34) * 0.25 } : { len: 4 + hash2(k, 33) * 6, depth: 0.16 + hash2(k, 34) * 0.14 }) });
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
      if (n < (zone === 'broken' ? 0.55 : 0.4)) { kind = 'broken'; h = -0.045 * hash2(Math.floor(sw / 0.5), Math.floor((d + 9) / 0.5) + 300); }
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
