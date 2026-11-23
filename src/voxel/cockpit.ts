// The rider's own view: tank, handlebar, grips, gloves, sleeves, mirrors and a small speedo.
// Voxels here are 3 cm. Forward is +z; the rider's eye sits behind z = 0. Pure data, unit tested.
import { VoxelGrid } from './grid.ts';
import { K } from './vehicles.ts';

export const COCKPIT_VOXEL = 0.03;
/** Voxel-grid coordinates of the steering axis (the handlebar pivots about this x/z). */
export const STEER_PIVOT = { x: 21.5, z: 15 };

export function buildCockpit(): VoxelGrid {
  const g = new VoxelGrid(44, 22, 30);
  // tank + knee ridge
  g.box(13, 30, 2, 6, 3, 14, K.BODY);
  g.box(18, 25, 7, 7, 4, 12, K.BODY);
  // steering yoke up to the bar
  g.box(19, 24, 6, 8, 13, 18, K.DARK);
  g.box(8, 35, 8, 9, 17, 18, K.DARK);
  // gloves, brake / clutch levers
  g.box(4, 9, 7, 10, 15, 19, K.GLOVE); g.box(34, 39, 7, 10, 15, 19, K.GLOVE);
  g.box(5, 9, 10, 10, 20, 23, K.CHROME); g.box(34, 38, 10, 10, 20, 23, K.CHROME);
  // sleeves running back toward the rider
  g.box(4, 8, 6, 9, 9, 14, K.SHIRT); g.box(35, 39, 6, 9, 9, 14, K.SHIRT);
  g.box(3, 7, 3, 6, 4, 9, K.SHIRT); g.box(36, 40, 3, 6, 4, 9, K.SHIRT);
  // mirrors: stalk, housing, glass facing the rider
  g.box(8, 8, 10, 12, 17, 17, K.CHROME); g.box(35, 35, 10, 12, 17, 17, K.CHROME);
  g.box(5, 10, 13, 15, 16, 17, K.DARK); g.box(33, 38, 13, 15, 16, 17, K.DARK);
  g.box(6, 9, 13, 15, 15, 15, K.MIRROR); g.box(34, 37, 13, 15, 15, 15, K.MIRROR);
  // speedo with a dial face toward the rider
  g.box(17, 26, 9, 12, 13, 15, K.DARK);
  g.box(19, 24, 10, 11, 12, 12, K.HEAD);
  g.set(21, 10, 12, K.TAIL);
  return g;
}
