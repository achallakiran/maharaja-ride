// Voxel grid -> indexed triangle mesh. Only exposed faces are emitted, each vertex gets a baked
// ambient-occlusion shade, and colours come from a palette. Pure: returns typed arrays, no three.js.
import type { VoxelGrid } from './grid.ts';

export type RGB = readonly [number, number, number];

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  quads: number;
}

export interface MeshOptions {
  /** World size of one voxel (metres). */
  voxel: number;
  /** Only emit faces of voxels whose palette index passes. Neighbour solidity still uses the whole grid. */
  filter?: (k: number) => boolean;
  /** Bake ambient occlusion (default true). */
  ao?: boolean;
}

// Brightness per face direction, indexed [axis][sign>0 ? 1 : 0]
const FACE_SHADE: readonly (readonly [number, number])[] = [
  [0.82, 0.86], // -x, +x
  [0.58, 1.0],  // -y, +y
  [0.78, 0.92], // -z, +z
];
const AO_LEVEL = [0.56, 0.72, 0.87, 1];
const CORNER_ORDER_POS = [0, 1, 2, 3];
const CORNER_ORDER_NEG = [0, 3, 2, 1];
const CU = [0, 1, 1, 0];
const CV = [0, 0, 1, 1];

export function meshVoxels(grid: VoxelGrid, palette: readonly RGB[], opts: MeshOptions): MeshData {
  const { voxel } = opts;
  const useAo = opts.ao !== false;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  // centre on x/z, sit on y = 0
  const ox = -(grid.w * voxel) / 2, oz = -(grid.l * voxel) / 2;
  const base = [0, 0, 0], p = [0, 0, 0], q = [0, 0, 0];
  const solid = (a: number[]): boolean => grid.get(a[0], a[1], a[2]) !== 0;
  let quads = 0;

  for (let z = 0; z < grid.l; z++) for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    const k = grid.get(x, y, z);
    if (!k || (opts.filter && !opts.filter(k))) continue;
    base[0] = x; base[1] = y; base[2] = z;
    for (let a = 0; a < 3; a++) for (let s = -1; s <= 1; s += 2) {
      q[0] = x; q[1] = y; q[2] = z; q[a] += s;
      if (solid(q)) continue;
      const u = (a + 1) % 3, v = (a + 2) % 3;
      const order = s > 0 ? CORNER_ORDER_POS : CORNER_ORDER_NEG;
      const first = pos.length / 3;
      const ao: number[] = [];
      for (let c = 0; c < 4; c++) {
        const cc = order[c], cu = CU[cc], cv = CV[cc];
        p[a] = base[a] + (s > 0 ? 1 : 0); p[u] = base[u] + cu; p[v] = base[v] + cv;
        pos.push(p[0] * voxel + ox, p[1] * voxel, p[2] * voxel + oz);
        const n = [0, 0, 0]; n[a] = s; nor.push(n[0], n[1], n[2]);
        let level = 3;
        if (useAo) {
          const du = cu ? 1 : -1, dv = cv ? 1 : -1;
          const s1: number[] = [x, y, z], s2: number[] = [x, y, z], sc: number[] = [x, y, z];
          s1[a] += s; s1[u] += du;
          s2[a] += s; s2[v] += dv;
          sc[a] += s; sc[u] += du; sc[v] += dv;
          const a1 = solid(s1), a2 = solid(s2);
          level = a1 && a2 ? 0 : 3 - ((a1 ? 1 : 0) + (a2 ? 1 : 0) + (solid(sc) ? 1 : 0));
        }
        ao.push(level);
        const rgb = palette[k] ?? [1, 0, 1];
        const m = FACE_SHADE[a][s > 0 ? 1 : 0] * AO_LEVEL[level];
        col.push(rgb[0] * m, rgb[1] * m, rgb[2] * m);
      }
      // Flip the diagonal so the darker corner pair is not interpolated across the quad
      if (ao[0] + ao[2] >= ao[1] + ao[3]) idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
      else idx.push(first + 1, first + 2, first + 3, first + 1, first + 3, first);
      quads++;
    }
  }
  return {
    positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(col),
    indices: new Uint32Array(idx), quads,
  };
}
