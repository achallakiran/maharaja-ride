import { buildVehicleKit, PALETTE_HEX } from '../src/voxel/vehicles.ts';
export const kit = buildVehicleKit();
export const RGB_PALETTE = PALETTE_HEX.map(h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255] as const);
