// Roadside voxel props: kerb post, street lamp, two tree shapes. Own small palette. Pure data, unit tested.
import { VoxelGrid } from './grid.ts';
import { hash2 } from '../sim/rng.ts';

export const PROP_PALETTE_HEX: readonly number[] = [
  0x000000, 0xe9e6dc, 0x2a2b2e, 0x6b4a2f, 0x3f7a3a, 0x5a9a45, 0xc9ced4, 0xfff2b8, 0x2f6a3a,
];
const P = { WHITE: 1, BLACK: 2, TRUNK: 3, LEAF: 4, LEAF2: 5, METAL: 6, LIGHT: 7, LEAF3: 8 } as const;

export const POST_VOXEL = 0.1, LAMP_VOXEL = 0.1, TREE_VOXEL = 0.35;

/** Black-and-white painted kerb post: 0.3 x 0.9 x 0.3 m. */
export function buildPost(): VoxelGrid {
  const g = new VoxelGrid(3, 9, 3);
  for (let y = 0; y < 9; y++) g.box(0, 2, y, y, 0, 2, Math.floor(y / 2) % 2 === 0 ? P.WHITE : P.BLACK);
  return g;
}

/** Street lamp, 8 m tall, arm reaching toward +x (the rider's left when yaw = road direction). */
export function buildLamp(): VoxelGrid {
  const g = new VoxelGrid(16, 82, 4);
  g.box(5, 8, 0, 3, 0, 3, P.BLACK);
  g.box(6, 7, 4, 78, 1, 2, P.METAL);
  g.box(6, 14, 79, 80, 1, 2, P.METAL);
  g.box(11, 14, 77, 78, 0, 3, P.BLACK);
  g.box(11, 14, 76, 76, 0, 3, P.LIGHT);
  return g;
}

/** variant 0: round canopy; variant 1: wide flat rain-tree canopy. */
export function buildTree(variant: number): VoxelGrid {
  const g = new VoxelGrid(17, 20, 17);
  g.box(7, 9, 0, variant ? 8 : 6, 7, 9, P.TRUNK);
  const cx = 8, cz = 8, cy = variant ? 12 : 12, rx = variant ? 8 : 6.5, ry = variant ? 4.5 : 6.5;
  for (let z = 0; z < 17; z++) for (let y = 0; y < 20; y++) for (let x = 0; x < 17; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz(rx)) ** 2;
    if (d > 1) continue;
    const h = hash2(x * 3 + variant * 17, y * 5 + z * 11);
    g.set(x, y, z, h < 0.45 ? P.LEAF : h < 0.8 ? P.LEAF2 : P.LEAF3);
  }
  return g;
}
const rz = (rx: number) => rx;
