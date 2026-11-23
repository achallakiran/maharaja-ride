// Procedural voxel vehicle kit for Indian traffic. One voxel = 0.1 m. Front is +z, centre of footprint at the origin.
// Pure data (no three.js) so every model is unit-tested for floating parts, bounds and real-world size.
import { VoxelGrid } from './grid.ts';

export const VOXEL_M = 0.1;

/** Palette indices. BODY is the only tintable (per-vehicle paint) colour. */
export const K = {
  BODY: 1, DARK: 2, GLASS: 3, TIRE: 4, CHROME: 5, HEAD: 6, TAIL: 7, SEAT: 8, SHIRT: 9,
  SKIN: 10, HELMET: 11, CANVAS: 12, WHITE: 13, CARGO: 14, ACCENT: 15, RIM: 16, JEANS: 17,
  MIRROR: 18, GLOVE: 19,
} as const;

/** sRGB hex per palette index (index 0 unused). BODY is white: paint is applied per instance. */
export const PALETTE_HEX: readonly number[] = [
  0x000000, 0xffffff, 0x2b2d31, 0x7fa3b5, 0x1d1d1f, 0xc9ced4, 0xfff2b8, 0xd1252e, 0x2a2623, 0x3f6fb2,
  0xb07a56, 0xd8d8d2, 0x1b1c1e, 0xf2f0ea, 0xb9965b, 0xf1c232, 0x9aa0a8, 0x3a4560,
  0xa9c4d2, 0x2a1f1a,
];

export type VehicleId = 'bike' | 'scooter' | 'auto' | 'car' | 'cab' | 'tempo' | 'bus' | 'truck';

export interface VehicleSpec {
  id: VehicleId;
  name: string;
  /** Spawn weight in a typical Bangalore peak-hour mix. */
  weight: number;
  grid: VoxelGrid;
  /** Real-world size in metres (from the grid). */
  lengthM: number;
  widthM: number;
  heightM: number;
  /** Body paint choices (sRGB hex). */
  paints: readonly number[];
}

function bike(): VoxelGrid {
  const g = new VoxelGrid(9, 19, 22);
  g.wheel(3, 5, 3, 4, 3, K.TIRE, K.RIM);
  g.wheel(3, 5, 3, 18, 3, K.TIRE, K.RIM);
  g.box(4, 4, 3, 4, 4, 9, K.DARK);                 // swing arm
  g.box(3, 5, 4, 7, 8, 13, K.DARK);                // engine
  g.box(3, 5, 8, 10, 10, 15, K.BODY);              // tank
  g.box(3, 5, 8, 9, 4, 9, K.SEAT);                 // seat
  g.box(3, 5, 6, 6, 2, 6, K.BODY);                 // rear fender
  g.box(4, 4, 7, 7, 4, 7, K.DARK);                 // fender strut
  const forkZ = [18, 18, 17, 17, 17, 16, 16, 16, 16];
  forkZ.forEach((z, i) => { g.set(3, 3 + i, z, K.CHROME); g.set(5, 3 + i, z, K.CHROME); });
  g.box(3, 5, 11, 11, 16, 16, K.CHROME);           // top yoke
  g.box(0, 8, 12, 12, 16, 16, K.DARK);             // handlebar
  g.set(0, 13, 16, K.CHROME); g.set(8, 13, 16, K.CHROME);
  g.box(0, 1, 14, 14, 16, 16, K.DARK); g.box(7, 8, 14, 14, 16, 16, K.DARK); // mirrors
  g.box(3, 5, 9, 10, 17, 17, K.HEAD);              // headlight
  g.box(3, 5, 7, 7, 1, 1, K.TAIL);                 // tail light
  g.box(6, 6, 3, 4, 2, 9, K.CHROME);               // exhaust
  // rider
  g.box(2, 6, 10, 15, 6, 9, K.SHIRT);
  g.box(2, 2, 6, 10, 8, 13, K.JEANS); g.box(6, 6, 6, 10, 8, 13, K.JEANS);
  g.box(2, 2, 5, 5, 10, 12, K.DARK); g.box(6, 6, 5, 5, 10, 12, K.DARK);
  g.box(1, 1, 14, 15, 8, 10, K.SHIRT); g.box(7, 7, 14, 15, 8, 10, K.SHIRT);
  g.box(1, 1, 13, 14, 10, 13, K.SHIRT); g.box(7, 7, 13, 14, 10, 13, K.SHIRT);
  g.box(1, 1, 12, 13, 13, 15, K.SKIN); g.box(7, 7, 12, 13, 13, 15, K.SKIN);
  g.box(3, 5, 16, 18, 6, 9, K.HELMET);
  g.box(3, 5, 17, 17, 10, 10, K.GLASS);
  return g;
}

function scooter(): VoxelGrid {
  const g = new VoxelGrid(9, 20, 19);
  g.wheel(3, 5, 2, 4, 2, K.TIRE, K.RIM);
  g.wheel(3, 5, 2, 15, 2, K.TIRE, K.RIM);
  g.box(2, 6, 4, 4, 6, 12, K.BODY);                // floorboard
  g.box(2, 6, 4, 9, 1, 6, K.BODY);                 // rear body
  g.box(3, 5, 10, 10, 2, 8, K.SEAT);               // seat
  g.box(2, 6, 4, 12, 12, 13, K.BODY);              // front shield
  for (let y = 2; y <= 4; y++) { g.set(3, y, 14, K.CHROME); g.set(5, y, 14, K.CHROME); }
  g.box(0, 8, 13, 13, 12, 12, K.DARK);             // handlebar
  g.set(0, 14, 12, K.CHROME); g.set(8, 14, 12, K.CHROME);
  g.set(0, 15, 12, K.DARK); g.set(8, 15, 12, K.DARK);
  g.box(3, 5, 10, 11, 14, 14, K.HEAD);
  g.box(3, 5, 8, 8, 0, 0, K.TAIL);
  // rider
  g.box(2, 6, 11, 16, 3, 6, K.SHIRT);
  g.box(2, 2, 9, 10, 6, 9, K.JEANS); g.box(6, 6, 9, 10, 6, 9, K.JEANS);
  g.box(2, 2, 5, 9, 10, 11, K.JEANS); g.box(6, 6, 5, 9, 10, 11, K.JEANS);
  g.box(1, 1, 14, 15, 6, 8, K.SHIRT); g.box(7, 7, 14, 15, 6, 8, K.SHIRT);
  g.box(1, 1, 13, 14, 8, 11, K.SHIRT); g.box(7, 7, 13, 14, 8, 11, K.SHIRT);
  g.set(1, 13, 12, K.SKIN); g.set(7, 13, 12, K.SKIN);
  g.box(3, 5, 17, 19, 3, 6, K.HELMET);
  g.box(3, 5, 18, 18, 7, 7, K.GLASS);
  return g;
}

function auto(): VoxelGrid {
  const g = new VoxelGrid(14, 18, 27);
  g.wheel(6, 7, 3, 22, 3, K.TIRE, K.RIM);
  g.wheel(0, 1, 3, 5, 3, K.TIRE, K.RIM);
  g.wheel(12, 13, 3, 5, 3, K.TIRE, K.RIM);
  g.box(2, 11, 5, 6, 2, 18, K.DARK);               // chassis floor
  g.box(1, 12, 7, 9, 1, 18, K.BODY);               // lower body
  g.box(3, 10, 9, 9, 3, 17, K.DARK);               // cabin floor
  g.box(2, 11, 10, 11, 2, 6, K.SEAT);              // rear seat
  g.box(1, 2, 10, 11, 2, 17, K.BODY); g.box(11, 12, 10, 11, 2, 17, K.BODY); // low sides
  g.box(4, 9, 6, 12, 18, 24, K.BODY);              // nose
  g.box(5, 8, 7, 7, 20, 25, K.BODY);               // front mudguard
  g.box(4, 9, 13, 17, 19, 20, K.GLASS);            // windscreen
  g.box(6, 7, 8, 10, 25, 25, K.HEAD);
  g.box(4, 9, 10, 11, 14, 17, K.SEAT);             // driver seat
  g.box(0, 13, 16, 17, 0, 19, K.CANVAS);           // canvas roof
  for (const x of [1, 12]) { g.box(x, x, 12, 15, 1, 1, K.DARK); g.box(x, x, 12, 15, 17, 17, K.DARK); }
  g.box(1, 2, 7, 8, 0, 0, K.TAIL); g.box(11, 12, 7, 8, 0, 0, K.TAIL);
  g.box(5, 8, 11, 13, 14, 15, K.SHIRT);            // driver
  g.box(6, 7, 14, 15, 14, 15, K.SKIN);
  return g;
}

interface CarOpt { len: number; cs: number; ce: number; roofY: number; sign?: boolean }
function carLike(o: CarOpt): VoxelGrid {
  const { len, cs, ce, roofY } = o;
  const g = new VoxelGrid(17, roofY + 1 + (o.sign ? 2 : 0), len);
  g.box(2, 14, 3, 8, 0, len - 1, K.BODY);                       // lower body
  g.box(3, 13, 9, roofY - 1, cs, ce, K.GLASS);                  // glasshouse
  g.box(3, 13, roofY, roofY, cs, ce, K.BODY);                   // roof
  for (const x of [3, 13]) for (const z of [cs, ce - 1]) g.box(x, x, 9, roofY - 1, z, z + 1, K.BODY); // pillars
  g.box(3, 13, 9, roofY - 2, ce + 1, ce + 1, K.GLASS);          // windscreen
  g.box(3, 13, 9, roofY - 2, cs - 1, cs - 1, K.GLASS);          // rear window
  g.box(3, 5, 6, 7, len - 1, len - 1, K.HEAD); g.box(11, 13, 6, 7, len - 1, len - 1, K.HEAD);
  g.box(6, 10, 5, 7, len - 1, len - 1, K.DARK);
  g.box(3, 5, 6, 7, 0, 0, K.TAIL); g.box(11, 13, 6, 7, 0, 0, K.TAIL);
  g.box(7, 9, 4, 5, 0, 0, K.WHITE);
  g.box(2, 14, 2, 2, 2, len - 3, K.DARK);                       // underbody
  const zr = Math.round(len * 0.19), zf = len - 1 - zr;
  for (const z of [zr, zf]) { g.wheel(0, 1, 3, z, 3, K.TIRE, K.RIM); g.wheel(15, 16, 3, z, 3, K.TIRE, K.RIM); }
  if (o.sign) g.box(6, 10, roofY + 1, roofY + 2, Math.round((cs + ce) / 2) - 1, Math.round((cs + ce) / 2) + 1, K.ACCENT);
  return g;
}
const hatchback = () => carLike({ len: 38, cs: 7, ce: 27, roofY: 14 });
const cab = () => carLike({ len: 44, cs: 14, ce: 32, roofY: 14, sign: true });

function tempo(): VoxelGrid {
  const g = new VoxelGrid(17, 17, 40);
  g.box(2, 14, 3, 5, 0, 39, K.DARK);                            // chassis
  g.box(2, 14, 6, 9, 24, 39, K.BODY);                           // cab lower + bonnet
  g.box(3, 13, 10, 15, 24, 32, K.GLASS);
  g.box(3, 13, 16, 16, 24, 32, K.BODY);
  for (const x of [3, 13]) for (const z of [24, 31]) g.box(x, x, 10, 15, z, z + 1, K.BODY);
  g.box(3, 13, 10, 14, 33, 33, K.GLASS);
  g.box(3, 5, 7, 8, 39, 39, K.HEAD); g.box(11, 13, 7, 8, 39, 39, K.HEAD);
  g.box(2, 14, 6, 7, 0, 23, K.BODY);                            // bed floor
  g.box(2, 2, 8, 12, 0, 23, K.BODY); g.box(14, 14, 8, 12, 0, 23, K.BODY);
  g.box(2, 14, 8, 12, 0, 0, K.BODY); g.box(2, 14, 8, 12, 23, 23, K.BODY);
  g.box(3, 13, 8, 12, 2, 20, K.CARGO); g.box(4, 12, 13, 14, 4, 18, K.CARGO);
  g.box(3, 5, 7, 7, 0, 0, K.TAIL); g.box(11, 13, 7, 7, 0, 0, K.TAIL);
  for (const z of [6, 33]) { g.wheel(0, 1, 3, z, 3, K.TIRE, K.RIM); g.wheel(15, 16, 3, z, 3, K.TIRE, K.RIM); }
  return g;
}

function bus(): VoxelGrid {
  const g = new VoxelGrid(25, 30, 105);
  g.box(3, 21, 5, 8, 0, 104, K.DARK);                           // chassis
  g.box(3, 21, 9, 16, 0, 104, K.BODY);                          // lower panel
  g.box(3, 21, 17, 25, 0, 104, K.GLASS);                        // window band
  g.box(6, 18, 17, 25, 1, 103, K.DARK);                         // interior
  for (let z = 0; z <= 104; z += 9) { g.box(3, 5, 17, 25, z, Math.min(104, z + 1), K.BODY); g.box(19, 21, 17, 25, z, Math.min(104, z + 1), K.BODY); }
  g.box(3, 21, 17, 25, 0, 0, K.BODY);                           // rear panel
  g.box(3, 21, 26, 27, 0, 104, K.WHITE);                        // roof
  g.box(6, 18, 28, 29, 10, 60, K.WHITE);                        // AC unit
  g.box(8, 16, 22, 24, 104, 104, K.HEAD);                       // route board
  g.box(4, 6, 10, 12, 104, 104, K.HEAD); g.box(18, 20, 10, 12, 104, 104, K.HEAD);
  g.box(4, 6, 10, 12, 0, 0, K.TAIL); g.box(18, 20, 10, 12, 0, 0, K.TAIL);
  g.box(8, 16, 12, 13, 0, 0, K.WHITE);
  for (const z of [18, 90]) { g.wheel(0, 2, 5, z, 5, K.TIRE, K.RIM); g.wheel(22, 24, 5, z, 5, K.TIRE, K.RIM); }
  return g;
}

function truck(): VoxelGrid {
  const g = new VoxelGrid(25, 36, 90);
  g.box(3, 21, 5, 7, 0, 89, K.DARK);                            // chassis
  g.box(3, 21, 8, 16, 70, 89, K.BODY);                          // cab lower + bonnet
  g.box(3, 21, 17, 27, 72, 86, K.BODY);                         // cab upper
  g.box(4, 20, 18, 25, 86, 86, K.GLASS);                        // windscreen
  g.box(3, 3, 18, 25, 76, 84, K.GLASS); g.box(21, 21, 18, 25, 76, 84, K.GLASS);
  g.box(5, 8, 10, 12, 89, 89, K.HEAD); g.box(16, 19, 10, 12, 89, 89, K.HEAD);
  g.box(8, 16, 10, 12, 89, 89, K.DARK);
  g.box(3, 21, 8, 9, 0, 69, K.DARK);                            // deck
  g.box(3, 21, 10, 31, 1, 68, K.CARGO);                         // tarpaulin load
  g.box(5, 8, 9, 11, 0, 0, K.TAIL); g.box(16, 19, 9, 11, 0, 0, K.TAIL);
  g.box(9, 15, 7, 8, 0, 0, K.WHITE);
  for (const z of [80, 14, 26]) { g.wheel(0, 2, 5, z, 5, K.TIRE, K.RIM); g.wheel(22, 24, 5, z, 5, K.TIRE, K.RIM); }
  return g;
}

function spec(id: VehicleId, name: string, weight: number, grid: VoxelGrid, paints: readonly number[]): VehicleSpec {
  return { id, name, weight, grid, lengthM: grid.l * VOXEL_M, widthM: grid.w * VOXEL_M, heightM: grid.h * VOXEL_M, paints };
}

export function buildVehicleKit(): VehicleSpec[] {
  return [
    spec('bike', 'Motorcycle', 30, bike(), [0x2f5d9e, 0xb1272e, 0x2a2b2e, 0x8a8f96, 0x1f6b4a]),
    spec('scooter', 'Scooter', 15, scooter(), [0xe9e4d6, 0xc33a4a, 0x3e8fa8, 0x6b6f77, 0xe3b53a]),
    spec('auto', 'Auto-rickshaw', 15, auto(), [0xf1c232, 0x2f9b57, 0xf1c232, 0xf0a41f]),
    spec('car', 'Hatchback', 20, hatchback(), [0xf2f0ea, 0xa8adb4, 0x2a2d33, 0xb6342f, 0x2c5aa0, 0xd9d4c6]),
    spec('cab', 'Cab', 8, cab(), [0xf2f0ea, 0xf2f0ea, 0xe9e4d6, 0xc9ced4]),
    spec('tempo', 'Tempo', 5, tempo(), [0xf2f0ea, 0x3a6fb0, 0xd8d4c8, 0xb6342f]),
    spec('bus', 'City bus', 4, bus(), [0x2459a8, 0x2459a8, 0x2e8b57]),
    spec('truck', 'Lorry', 3, truck(), [0xd9822b, 0x2e8b57, 0xb6342f, 0x3a6fb0]),
  ];
}
