// Road ribbon in fixed-length chunks, built from the loop. Pure typed-array output, no three.js.
// Cross-section (metres right of lane centre): shoulder | edge line | tar | centre-side kerb | ... mirrored.
// The lane is one carriageway of a divided road, so the "centre" side next to the median has a kerb.
import type { RoadLoop } from '../route/loop.ts';
import { hash2 } from '../sim/rng.ts';
import type { MeshData } from '../voxel/mesher.ts';

export const CHUNK_LEN = 64;
export const ROAD_HALF = 5.25; // half width of the tar (3 lanes of 3.5 m), metres
export const SHOULDER = 8;     // half width including the dirt shoulders

export function chunkCount(loop: RoadLoop): number { return Math.ceil(loop.length / CHUNK_LEN); }

type Kind = 'shoulder' | 'edge' | 'tar' | 'dash';
interface Col { d0: number; d1: number; kind: Kind }

/** Columns across one carriageway (metres right of the lane centre), left to right: 3 lanes of 3.5 m. */
export const COLUMNS: readonly Col[] = (() => {
  const cols: Col[] = [];
  const add = (from: number, to: number, kind: Kind, n: number) => { for (let i = 0; i < n; i++) cols.push({ d0: from + ((to - from) * i) / n, d1: from + ((to - from) * (i + 1)) / n, kind }); };
  add(-SHOULDER, -ROAD_HALF - 0.2, 'shoulder', 3);
  add(-ROAD_HALF - 0.2, -ROAD_HALF, 'edge', 1);
  add(-ROAD_HALF, -1.825, 'tar', 2);
  add(-1.825, -1.675, 'dash', 1);
  add(-1.675, 1.675, 'tar', 3);
  add(1.675, 1.825, 'dash', 1);
  add(1.825, ROAD_HALF, 'tar', 2);
  add(ROAD_HALF, ROAD_HALF + 0.2, 'edge', 1);
  add(ROAD_HALF + 0.2, SHOULDER, 'shoulder', 3);
  return cols;
})();

// sRGB hex colours
const TAR = 0x3d3f44, EDGE = 0xdcdad0, DIRT = 0x9a8664, DASH = 0xe3b92f;

function linear(hex: number): [number, number, number] {
  const f = (c: number) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)] as [number, number, number];
}

export function buildRoadChunk(loop: RoadLoop, c: number): MeshData {
  const s0 = c * CHUNK_LEN, s1 = Math.min((c + 1) * CHUNK_LEN, loop.length);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  let quads = 0;
  const rows: number[] = [];
  for (let s = s0; s < s1 - 1e-6; s += 1) rows.push(s);
  rows.push(s1);
  for (let r = 0; r < rows.length - 1; r++) {
    const sa = rows[r], sb = rows[r + 1], sm = (sa + sb) / 2;
    for (let ci = 0; ci < COLUMNS.length; ci++) {
      const cl = COLUMNS[ci];
      const dm = (cl.d0 + cl.d1) / 2;
      let hex = TAR, y = 0, jitter = 0.05;
      if (cl.kind === 'shoulder') { hex = DIRT; y = -0.015; jitter = 0.12; }
      else if (cl.kind === 'edge') { hex = EDGE; y = 0.004; jitter = 0.02; }
      else if (cl.kind === 'dash') { if (Math.floor(sm / 3) % 2 === 0) { hex = DASH; y = 0.004; jitter = 0.02; } }
      const h = hash2(Math.floor(sm) + c * 131, ci * 7 + 3);
      const k = 1 + (h - 0.5) * 2 * jitter;
      const rgb = linear(hex) as [number, number, number];
      const first = pos.length / 3;
      const corners: [number, number][] = [[sa, cl.d0], [sa, cl.d1], [sb, cl.d1], [sb, cl.d0]];
      for (const [s, d] of corners) {
        // inside a tight bend the offset curve would fold over itself: pinch it instead
        const kap = loop.kappaAt(s);
        const dd = d * kap > 0.9 ? 0.9 / kap : d;
        const p = loop.offset(s, dd);
        pos.push(p.x, y, p.z);
        nor.push(0, 1, 0);
        col.push(rgb[0] * k, rgb[1] * k, rgb[2] * k);
      }
      // winding: the quad runs forward (+s) then rightward (+d); with right = (-fz, fx) this faces up in three's y-up system
      idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
      quads++;
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(col), indices: new Uint32Array(idx), quads };
}

export interface Prop { kind: 'post' | 'lamp' | 'tree'; x: number; z: number; yaw: number; scale: number; variant: number }

/**
 * Roadside props for a chunk, deterministic from the chunk index. The median (centre of the physical road)
 * is on the RIGHT of this carriageway, the open roadside on the LEFT.
 */
export function chunkProps(loop: RoadLoop, c: number): Prop[] {
  const out: Prop[] = [];
  const s0 = c * CHUNK_LEN, s1 = Math.min((c + 1) * CHUNK_LEN, loop.length);
  const yawAt = (s: number) => { const p = loop.sample(s); return Math.atan2(p.fx, p.fz); };
  for (let s = s0; s < s1; s += 8) {
    const p = loop.offset(s, -(SHOULDER + 0.4));
    out.push({ kind: 'post', x: p.x, z: p.z, yaw: yawAt(s), scale: 1, variant: Math.floor(s / 8) % 2 });
  }
  for (let s = s0 + 12; s < s1; s += 32) {
    const p = loop.offset(s, SHOULDER + 0.3); // median side
    out.push({ kind: 'lamp', x: p.x, z: p.z, yaw: yawAt(s), scale: 1, variant: 0 });
    const q = loop.offset(s + 16, -(SHOULDER + 1.6)); // open side
    out.push({ kind: 'lamp', x: q.x, z: q.z, yaw: yawAt(s + 16) + Math.PI, scale: 1, variant: 0 });
  }
  for (let s = s0; s < s1; s += 6) {
    const h = hash2(Math.floor(s / 6) + c * 977, 5);
    if (h > 0.5) continue;
    const off = SHOULDER + 5 + hash2(Math.floor(s / 6) + c * 31, 9) * 14;
    const p = loop.offset(s + h * 5, -off); // trees only on the open side
    out.push({ kind: 'tree', x: p.x, z: p.z, yaw: h * 20, scale: 0.8 + h * 1.0, variant: Math.floor(h * 100) % 2 });
  }
  return out;
}
