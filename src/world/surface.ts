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
export type SurfaceKind = 'tar' | 'broken' | 'pothole' | 'crack' | 'water' | 'mud' | 'sand' | 'bump' | 'shoulder';

export interface Hole { s: number; d: number; r: number; depth: number; water: boolean; sharp?: boolean }
export interface Ditch { s: number; len: number; depth: number }
export interface Breaker { s: number; len: number; height: number }

/** h = what you see, p = what the wheels feel when it differs (a puddle hiding a hole). */
export interface SurfaceSample { h: number; kind: SurfaceKind; warn?: boolean; p?: number }
export interface Slab { s: number; len: number; d1: number; drop: number }

/** Per-kind handling: extra deceleration (m/s^2), steering grip multiplier and top-speed cap (fraction of vmax). */
export const SURFACE_FEEL: Record<SurfaceKind, { drag: number; grip: number; cap: number }> = {
  tar: { drag: 0, grip: 1, cap: 1 },
  broken: { drag: 0.3, grip: 0.95, cap: 0.8 },
  pothole: { drag: 0.8, grip: 0.9, cap: 0.6 },
  crack: { drag: 0.8, grip: 0.9, cap: 0.6 },
  water: { drag: 1.2, grip: 0.8, cap: 0.55 },
  mud: { drag: 1.6, grip: 0.7, cap: 0.5 },
  sand: { drag: 0.8, grip: 0.8, cap: 0.6 },
  bump: { drag: 0.3, grip: 1, cap: 0.7 },
  shoulder: { drag: 1, grip: 0.9, cap: 0.65 },
};

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class RoadSurface {
  private readonly length: number;
  private readonly cells = new Map<number, { holes: Hole[]; ditches: Ditch[]; breakers: Breaker[]; slabs: Slab[] }>();

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
    const holes: Hole[] = [], ditches: Ditch[] = [], breakers: Breaker[] = [], slabs: Slab[] = [];
    const s0 = k * CELL, zone = this.zoneAt(s0 + CELL / 2);
    const p = zone === 'broken' ? 0.85 : zone === 'flooded' ? 0.8 : zone === 'sand' ? 0.12 : 0.05;
    for (let j = 0; j < 4; j++) {
      const h = hash2(k * 7 + j, 21);
      if (h > p) continue;
      const a = hash2(k * 7 + j, 22), b = hash2(k * 7 + j, 23), c2 = hash2(k * 7 + j, 24);
      holes.push({ s: s0 + a * CELL, d: -ROAD_HALF + b * 2 * ROAD_HALF, r: 0.7 + c2 * 1.1, depth: 0.09 + hash2(k * 7 + j, 25) * 0.17, water: zone === 'flooded' });
    }
    if ((zone === 'flooded' && hash2(k, 31) < 0.2) || (zone === 'broken' && hash2(k, 31) < 0.1)) ditches.push({ s: s0 + hash2(k, 32) * CELL, len: 3 + hash2(k, 33) * 3, depth: 0.1 + hash2(k, 34) * 0.1 });
    if (hash2(k, 41) < (zone === 'good' ? 0.018 : 0.012)) breakers.push({ s: s0 + hash2(k, 42) * CELL, len: 3.6, height: 0.09 });
    // sudden damage with no warning: small sharp holes (hidden under puddles when flooded) and sunken slabs with a hard edge
    const rough = zone === 'broken' || zone === 'flooded';
    if (rough && hash2(k, 51) < (zone === 'broken' ? 0.2 : 0.14)) holes.push({ s: s0 + hash2(k, 52) * CELL, d: -ROAD_HALF + hash2(k, 53) * 2 * ROAD_HALF, r: 0.35 + hash2(k, 54) * 0.25, depth: 0.14 + hash2(k, 55) * 0.14, water: zone === 'flooded', sharp: true });
    if (rough && hash2(k, 61) < (zone === 'broken' ? 0.07 : 0.045)) slabs.push({ s: s0 + hash2(k, 62) * CELL, len: 10 + hash2(k, 63) * 16, d1: -2.4 + hash2(k, 64) * 4.8, drop: 0.1 + hash2(k, 65) * 0.1 });
    c = { holes, ditches, breakers, slabs };
    this.cells.set(k, c);
    return c;
  }

  /** Height and material at (s, d). d is metres right of the lane centre. */
  sample(s: number, d: number): SurfaceSample {
    const sw = this.wrap(s), zone = this.zoneAt(sw);
    const onTar = Math.abs(d) <= ROAD_HALF;
    if (!onTar) {
      let kind: SurfaceKind = zone === 'flooded' ? 'mud' : zone === 'sand' ? 'sand' : 'shoulder';
      let h = -0.015;
      // ditches cut right through the shoulders and fade out towards their outer edge
      const fade = Math.max(0, 1 - (Math.abs(d) - ROAD_HALF) / 2.75);
      if (fade > 0) {
        const k0 = Math.floor(sw / CELL);
        for (let k = k0 - 3; k <= k0 + 1; k++) for (const dt of this.cell(k).ditches) {
          const u = (sw - dt.s) / dt.len;
          if (u <= 0 || u >= 1) continue;
          const bowl = -dt.depth * Math.min(1, 1.5 * Math.sin(Math.PI * u)) * fade;
          if (bowl < h) { h = bowl; kind = 'water'; }
        }
      }
      return { h, kind };
    }
    let h = 0, p = 0, kind: SurfaceKind = 'tar', warn = false;
    {
      const kw = Math.floor(sw / CELL);
      for (let k = kw; k <= kw + 1; k++) for (const dt of this.cell(k).ditches) if (dt.depth > 0.6 && sw < dt.s && sw > dt.s - 4) warn = true;
    }
    if (zone === 'broken' || zone === 'flooded') {
      const n = hash2(Math.floor(sw / 1.5), Math.floor((d + 9) / 1.5) + 70);
      if (n < (zone === 'broken' ? 0.55 : 0.4)) { kind = 'broken'; h = -0.045 * hash2(Math.floor(sw / 0.5), Math.floor((d + 9) / 0.5) + 300); }
    } else if (zone === 'sand') {
      const drift = 1.4 + 2.4 * hash2(Math.floor(sw / 5), 91) * (0.4 + 0.6 * smooth(((sw / 5) % 1)));
      if (d < -ROAD_HALF + drift) kind = 'sand';
    }
    const k0 = Math.floor(sw / CELL);
    let water = false;
    for (let k = k0 - 4; k <= k0 + 1; k++) {
      const c = this.cell(k);
      for (const hole of c.holes) {
        const ds = sw - hole.s, dd = d - hole.d, t = (ds * ds + dd * dd) / (hole.r * hole.r);
        if (t >= 1) continue;
        const bowl = -hole.depth * (hole.sharp ? 1 - t * t : 1 - t);
        const wl = -hole.depth * 0.35;
        p = Math.min(p, bowl);
        if (hole.water && bowl < wl) { if (wl < h || kind !== 'water') { h = Math.min(h, wl); kind = 'water'; water = true; } }
        else if (bowl < h) { h = bowl; if (!water) kind = hole.sharp ? 'crack' : 'pothole'; }
      }
      for (const dt of c.ditches) {
        const u = (sw - dt.s) / dt.len;
        if (u <= 0 || u >= 1) continue;
        const bowl = -dt.depth * Math.min(1, 1.5 * Math.sin(Math.PI * u));
        const wl = -dt.depth * (dt.depth > 0.6 ? 0.85 : 0.45);
        if (bowl < h || bowl < wl) { h = Math.min(h, Math.max(bowl, wl)); kind = bowl < wl ? 'water' : 'pothole'; water = water || bowl < wl; }
      }
      for (const sb of c.slabs) {
        const u = sw - sb.s;
        if (u < -0.2 || u > sb.len + 0.2 || d > sb.d1 + 0.3) continue;
        const edge = smooth(clamp01((sb.d1 - d) / 0.35 + 0.5)); // hard edge along the slab's right side
        const ends = smooth(clamp01(u / 0.3)) * smooth(clamp01((sb.len - u) / 0.3));
        const drop = -sb.drop * edge * ends;
        if (drop < h) { h = drop; if (kind === 'tar') kind = 'broken'; }
        p = Math.min(p, drop);
      }
      for (const b of c.breakers) {
        const u = (sw - b.s) / b.len;
        if (u <= 0 || u >= 1) continue;
        h += b.height * Math.sin(Math.PI * u) ** 0.8;
        kind = 'bump';
      }
    }
    p = Math.min(p, h);
    const out: SurfaceSample = { h, kind };
    if (warn && kind === 'tar') out.warn = true;
    if (p < h - 0.02) out.p = p;
    return out;
  }

  height(s: number, d: number): number { return this.sample(s, d).h; }
}

const cache = new WeakMap<RoadLoop, RoadSurface>();
export function roadSurface(loop: RoadLoop): RoadSurface {
  let r = cache.get(loop);
  if (!r) { r = new RoadSurface(loop); cache.set(loop, r); }
  return r;
}
