// The ride is one closed loop: route A out (Utopia -> Aquamarine) then route B back (Aquamarine -> Utopia).
// This module turns the sparse real centrelines into a smooth, evenly spaced closed curve and answers
// "where is the road at distance s?". Pure: no three.js.
//
// Conventions: x = east, z = -north. Heading theta has forward f = (sin theta, cos theta); the rider's
// right is (-cos theta, sin theta). Curvature is positive when the road turns to the RIGHT.

export type Pt = readonly [number, number];

export interface Milestone { id: string; name: string; short: string; x: number; z: number }
export interface MilestoneHit { name: string; short: string; s: number }

export interface RoadSample { x: number; z: number; fx: number; fz: number; kappa: number }

export interface LoopOptions {
  /** Spacing of the final samples, metres. */
  spacing?: number;
  /** Half window (in samples) of the corner-rounding average. */
  smoothRadius?: number;
  smoothPasses?: number;
}

// ---- building the lane ring -------------------------------------------------------------------------
// Real routes are road centrelines, and A and B share a lot of road in opposite directions. We ride the
// LEFT carriageway of each (India drives on the left), so the two directions never overlap, and join
// them with a U-turn arc at each end.

function resampleOpen(pts: readonly Pt[], spacing: number): Pt[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1], count = Math.max(2, Math.round(total / spacing));
  const out: Pt[] = [];
  let seg = 0;
  for (let i = 0; i <= count; i++) {
    const d = (total * i) / count;
    while (seg < pts.length - 2 && cum[seg + 1] < d) seg++;
    const p = pts[seg], q = pts[seg + 1];
    const t = (d - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
    out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
  }
  return out;
}

function smoothOpen(pts: readonly Pt[], radius: number, passes: number): Pt[] {
  let a: Pt[] = [...pts];
  const n = a.length;
  for (let pass = 0; pass < passes; pass++) {
    const b: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.min(radius, i, n - 1 - i); // window shrinks to nothing at the ends, so the ends stay put
      let sx = 0, sz = 0;
      for (let k = -r; k <= r; k++) { sx += a[i + k][0]; sz += a[i + k][1]; }
      b.push([sx / (2 * r + 1), sz / (2 * r + 1)]);
    }
    a = b;
  }
  return a;
}

function tangents(pts: readonly Pt[]): Pt[] {
  const n = pts.length;
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l] as Pt;
  });
}

/** Shift a chain sideways: positive `left` moves to the rider's left (which is (fz, -fx)). */
function offsetLeft(pts: readonly Pt[], left: number): Pt[] {
  const t = tangents(pts);
  return pts.map((p, i) => [p[0] + t[i][1] * left, p[1] - t[i][0] * left] as Pt);
}

function bezier(p0: Pt, d0: Pt, p3: Pt, d3: Pt, k: number, spacing: number): Pt[] {
  const p1: Pt = [p0[0] + d0[0] * k, p0[1] + d0[1] * k];
  const p2: Pt = [p3[0] - d3[0] * k, p3[1] - d3[1] * k];
  const N = 64, raw: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    const c = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    raw.push([c[0] * p0[0] + c[1] * p1[0] + c[2] * p2[0] + c[3] * p3[0], c[0] * p0[1] + c[1] * p1[1] + c[2] * p2[1] + c[3] * p3[1]]);
  }
  return resampleOpen(raw, spacing);
}

export interface RingOptions { spacing?: number; laneOffset?: number; smoothRadius?: number; smoothPasses?: number }

/**
 * Closed ring of the left-hand lane: route A out, route B back, joined by smooth turn-around arcs.
 * Both routes must start at the same place and end at the same place.
 */
export function buildLaneRing(a: readonly Pt[], b: readonly Pt[], o: RingOptions = {}): Pt[] {
  const spacing = o.spacing ?? 1, lane = o.laneOffset ?? 8;
  const radius = o.smoothRadius ?? 14, passes = o.smoothPasses ?? 3;
  const prep = (pts: readonly Pt[]) => offsetLeft(smoothOpen(resampleOpen(pts, spacing), radius, passes), lane);
  const A = prep(a), B = prep([...b].reverse());
  const tA = tangents(A), tB = tangents(B);
  const k = Math.max(4, lane * 1.3);
  // Aquamarine end: A arrives, B leaves. Utopia end: B arrives, A leaves.
  const turn1 = bezier(A[A.length - 1], tA[A.length - 1], B[0], tB[0], k, spacing);
  const turn2 = bezier(B[B.length - 1], tB[B.length - 1], A[0], tA[0], k, spacing);
  return [...A, ...turn1.slice(1, -1), ...B, ...turn2.slice(1, -1)];
}

function resampleClosed(pts: readonly Pt[], spacing: number): { x: Float64Array; z: Float64Array; length: number } {
  const n = pts.length;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const total = cum[n];
  const count = Math.max(8, Math.round(total / spacing));
  const x = new Float64Array(count), z = new Float64Array(count);
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const d = (total * i) / count;
    while (cum[seg + 1] < d) seg++;
    const p = pts[seg], q = pts[(seg + 1) % n];
    const t = (d - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
    x[i] = p[0] + (q[0] - p[0]) * t;
    z[i] = p[1] + (q[1] - p[1]) * t;
  }
  return { x, z, length: total };
}

function smoothClosed(v: Float64Array, radius: number, passes: number): Float64Array {
  const n = v.length;
  let a = v;
  for (let pass = 0; pass < passes; pass++) {
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += a[(i + k + n * 4) % n];
      b[i] = s / (2 * radius + 1);
    }
    a = b;
  }
  return a;
}

export class RoadLoop {
  readonly count: number;
  readonly ds: number;
  readonly length: number;
  private readonly px: Float64Array;
  private readonly pz: Float64Array;
  private readonly fx: Float64Array;
  private readonly fz: Float64Array;
  private readonly kap: Float64Array;
  readonly milestones: MilestoneHit[] = [];

  constructor(ring: readonly Pt[], opts: LoopOptions = {}) {
    const spacing = opts.spacing ?? 1;
    const base = resampleClosed(ring, spacing);
    const radius = opts.smoothRadius ?? 3, passes = opts.smoothPasses ?? 2;
    const sx = smoothClosed(base.x, radius, passes), sz = smoothClosed(base.z, radius, passes);
    const n = sx.length;
    this.count = n;
    // re-measure the smoothed ring and re-space it exactly
    const re = resampleClosed(Array.from({ length: n }, (_, i) => [sx[i], sz[i]] as Pt), spacing);
    this.px = re.x; this.pz = re.z; this.length = re.length;
    this.count = re.x.length;
    this.ds = this.length / this.count;
    const m = this.count;
    this.fx = new Float64Array(m); this.fz = new Float64Array(m); this.kap = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const a = (i - 1 + m) % m, b = (i + 1) % m;
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a];
      const len = Math.hypot(dx, dz) || 1;
      this.fx[i] = dx / len; this.fz[i] = dz / len;
    }
    // Curvature from the heading change over a +-4 sample baseline (single-sample differences are too noisy).
    const W = 4;
    for (let i = 0; i < m; i++) {
      const a = (i - W + m * 4) % m, b = (i + W) % m;
      // theta = atan2(fx, fz); right-turning road has decreasing theta
      let dth = Math.atan2(this.fx[b], this.fz[b]) - Math.atan2(this.fx[a], this.fz[a]);
      while (dth > Math.PI) dth -= 2 * Math.PI;
      while (dth < -Math.PI) dth += 2 * Math.PI;
      this.kap[i] = -dth / (2 * W * this.ds);
    }
  }

  private wrap(s: number): number { const L = this.length; return ((s % L) + L) % L; }

  sample(s: number): RoadSample {
    const u = this.wrap(s) / this.ds;
    const i = Math.floor(u) % this.count, j = (i + 1) % this.count, t = u - Math.floor(u);
    const lerp = (a: Float64Array) => a[i] + (a[j] - a[i]) * t;
    let fx = lerp(this.fx), fz = lerp(this.fz);
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    return { x: lerp(this.px), z: lerp(this.pz), fx, fz, kappa: lerp(this.kap) };
  }

  kappaAt(s: number): number {
    const u = this.wrap(s) / this.ds;
    const i = Math.floor(u) % this.count, j = (i + 1) % this.count, t = u - Math.floor(u);
    return this.kap[i] + (this.kap[j] - this.kap[i]) * t;
  }

  /** World position of the point `d` metres to the right of the centreline at distance s. */
  offset(s: number, d: number): { x: number; z: number; fx: number; fz: number } {
    const r = this.sample(s);
    return { x: r.x + -r.fz * d, z: r.z + r.fx * d, fx: r.fx, fz: r.fz };
  }

  /** Signed smallest distance from s0 to s1 around the ring. */
  delta(s0: number, s1: number): number {
    const L = this.length;
    let d = (s1 - s0) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  /** Find where each milestone sits on the loop (it can appear twice: on the way out and the way back). */
  placeMilestones(list: readonly Milestone[], radius = 90): void {
    this.milestones.length = 0;
    const m = this.count;
    for (const ms of list) {
      const dist = new Float64Array(m);
      for (let i = 0; i < m; i++) dist[i] = Math.hypot(this.px[i] - ms.x, this.pz[i] - ms.z);
      for (let i = 0; i < m; i++) {
        if (dist[i] > radius) continue;
        let isMin = true;
        for (let k = -40; k <= 40 && isMin; k++) if (k && dist[(i + k + m) % m] < dist[i]) isMin = false;
        if (isMin) this.milestones.push({ name: ms.name, short: ms.short, s: i * this.ds });
      }
    }
    this.milestones.sort((a, b) => a.s - b.s);
  }

  /** The milestone closest (along the road) to s within `within` metres, if any. */
  nearMilestone(s: number, within = 140): MilestoneHit | null {
    let best: MilestoneHit | null = null, bd = within;
    for (const h of this.milestones) {
      const d = Math.abs(this.delta(s, h.s));
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
}
