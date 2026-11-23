// Ring-road traffic for the Phase 0 perf spike: each lane is a closed ring so vehicles never pop in or out.
// Vehicles follow their leader with a minimum bumper gap, at a random jam speed. Pure and deterministic.
import { mulberry32, pickWeighted } from './rng.ts';

export interface LaneDef {
  /** World x of the lane centre. */
  x: number;
  /** +1 travels toward +z (same way as the rider), -1 oncoming. */
  dir: 1 | -1;
}

export interface TrafficVehicle {
  type: number;
  lane: number;
  /** Distance travelled along the lane ring, 0..ring. */
  s: number;
  /** Target speed, m/s. */
  v: number;
  /** Actual speed last step, m/s (used for animation / tests). */
  speed: number;
  len: number;
  /** Lateral jitter from lane centre, metres. */
  lateral: number;
  paint: number;
}

export interface TrafficTypeInfo { weight: number; lengthM: number; paints: readonly number[] }

export interface TrafficWorld {
  lanes: LaneDef[];
  ring: number;
  zMin: number;
  zMax: number;
  vehicles: TrafficVehicle[];
  /** Vehicles per lane, ordered by increasing s (leader of the last is the first). */
  order: number[][];
}

export const MIN_GAP = 0.35;

export function buildTraffic(seed: number, lanes: LaneDef[], zMin: number, zMax: number, total: number, types: readonly TrafficTypeInfo[]): TrafficWorld {
  const rnd = mulberry32(seed);
  const ring = zMax - zMin;
  const weights = types.map(t => t.weight);
  const vehicles: TrafficVehicle[] = [];
  const order: number[][] = lanes.map(() => []);
  const perLane = Math.ceil(total / lanes.length);
  for (let li = 0; li < lanes.length; li++) {
    let cursor = rnd() * 3;
    for (let n = 0; n < perLane && vehicles.length < total; n++) {
      const type = pickWeighted(weights, rnd());
      const info = types[type];
      const gap = 0.4 + rnd() * 1.8;
      if (cursor + info.lengthM + gap > ring) break;
      const s = cursor + info.lengthM / 2;
      cursor += info.lengthM + gap;
      order[li].push(vehicles.length);
      vehicles.push({
        type, lane: li, s, v: 0.6 + rnd() * 4.2, speed: 0, len: info.lengthM,
        lateral: (rnd() - 0.5) * 0.5, paint: info.paints[Math.floor(rnd() * info.paints.length)],
      });
    }
  }
  return { lanes, ring, zMin, zMax, vehicles, order };
}

/** Free distance between a vehicle's front and its leader's rear (metres). */
export function gapAhead(w: TrafficWorld, laneOrder: number[], i: number): number {
  const me = w.vehicles[laneOrder[i]];
  if (laneOrder.length === 1) return w.ring - me.len;
  const lead = w.vehicles[laneOrder[(i + 1) % laneOrder.length]];
  const d = (lead.s - me.s + w.ring) % w.ring;
  return d - (me.len + lead.len) / 2;
}

export function stepTraffic(w: TrafficWorld, dt: number): void {
  for (const lane of w.order) {
    // Leaders first would be ideal, but with a ring any order works: we only ever close to MIN_GAP.
    for (let i = 0; i < lane.length; i++) {
      const v = w.vehicles[lane[i]];
      const room = Math.max(0, gapAhead(w, lane, i) - MIN_GAP);
      const move = Math.min(v.v * dt, room);
      v.speed = move / dt;
      v.s = (v.s + move) % w.ring;
    }
  }
}

/** World z of a vehicle centre. */
export function worldZ(w: TrafficWorld, v: TrafficVehicle): number {
  return w.lanes[v.lane].dir > 0 ? w.zMin + v.s : w.zMax - v.s;
}
export function worldX(w: TrafficWorld, v: TrafficVehicle): number {
  return w.lanes[v.lane].x + v.lateral;
}
