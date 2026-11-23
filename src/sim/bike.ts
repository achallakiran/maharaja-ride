// Arcade motorcycle in ROAD coordinates: s = distance along the loop, d = metres to the right of the lane
// centre, psi = how far the bike points to the right of the road direction. Pure and deterministic.
//
//   s'   = v cos(psi) / (1 - kappa d)
//   d'   = v sin(psi)
//   psi' = yawRate - kappa s'        (kappa > 0 when the road turns right)

import { SURFACE_FEEL, type SurfaceKind } from '../world/surface.ts';

export interface BikeInput { steer: number; throttle: number; brake: number; horn: boolean }

export interface BikeState {
  s: number;       // distance along the loop (wraps)
  d: number;       // lateral offset, + = right of the lane centre
  psi: number;     // heading relative to the road, + = pointing right
  v: number;       // speed, m/s (never negative)
  steer: number;   // smoothed handlebar angle, -1..1
  yawRate: number; // rad/s, + = turning right
  lean: number;    // rad, + = leaning right
  odo: number;     // total distance ridden, m
  surface: SurfaceKind;
  y: number;       // sprung body height above the road datum, m
  yv: number;      // its vertical speed
  pitch: number;   // rad, + = nose up
  hit: number;     // 0..1 how hard the last bump was (for sound / shake)
}

/** Road under the wheels: height and material at (s, d). */
export type Ground = (s: number, d: number) => { h: number; kind: SurfaceKind };
const FLAT: Ground = () => ({ h: 0, kind: 'tar' });

export const BIKE = {
  vmax: 24,          // m/s, about 86 km/h
  accel: 5.4,        // m/s^2 at launch
  brake: 10.5,
  rolling: 0.18,
  drag: 0.0012,      // quadratic drag
  shoulderDrag: 3.2, // extra decel on the dirt shoulder
  shoulderStart: 5.5,
  edge: 7.6,         // hard limit left/right of the lane centre
  assist: 0.55,      // how much the bike helps follow the road (free-ride friendly on touch)
  maxLean: 0.62,
  maxAngle: 0.5,     // most the rider can point off the road direction while steering, rad
} as const;

export function newBike(s = 0): BikeState {
  return { s, d: 0, psi: 0, v: 0, steer: 0, yawRate: 0, lean: 0, odo: 0, surface: 'tar', y: 0, yv: 0, pitch: 0, hit: 0 };
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export function stepBike(b: BikeState, input: BikeInput, kappaAt: (s: number) => number, length: number, dt: number, ground: Ground = FLAT): void {
  const th = clamp(input.throttle, 0, 1), br = clamp(input.brake, 0, 1), st = clamp(input.steer, -1, 1);
  const onShoulder = Math.abs(b.d) > BIKE.shoulderStart;
  const under = ground(b.s, b.d), front = ground(b.s + 0.7, b.d), rear = ground(b.s - 0.7, b.d);
  b.surface = onShoulder && under.kind === 'tar' ? 'shoulder' : under.kind;
  const feel = SURFACE_FEEL[b.surface];

  // --- speed
  let a = th * BIKE.accel * Math.max(0, 1 - (b.v / BIKE.vmax) ** 2);
  if (b.v > 0.01) {
    a -= br * BIKE.brake + BIKE.rolling + BIKE.drag * b.v * b.v;
    a -= feel.drag;
    // dropping into / climbing out of a hole costs speed
    a -= Math.min(6, Math.abs(front.h - rear.h) / 1.4 * b.v * 1.4);
  }
  b.v = Math.max(0, b.v + a * dt);
  if (br > 0 && b.v < 0.05) b.v = 0;

  // --- handlebar -> yaw -> lean (all smoothed so it feels like a heavy bike)
  b.steer += (st - b.steer) * Math.min(1, dt * 9);
  const authority = clamp(24 / (b.v + 6), 0.42, 1.55) * Math.min(1, b.v / 1.2);
  const kappa = kappaAt(b.s);
  const sdotPre = b.v * Math.cos(b.psi);
  // The bike follows the road's own turn by itself, so the handlebar changes lane / line rather than
  // having to be held through every bend (friendly on a touch joystick). While the rider is not steering
  // it also lines itself up with the road again.
  const settle = BIKE.assist * (1 - Math.min(1, Math.abs(st) * 0.8));
  // steering can only angle the bike so far off the road direction (a lane change, not a spin-out)
  const into = Math.sign(b.steer) * b.psi;
  const room = into > 0 ? clamp(1 - into / BIKE.maxAngle, 0, 1) : 1;
  const target = b.steer * authority * room * feel.grip + kappa * sdotPre - 0.9 * settle * b.psi * Math.min(1, b.v / 3);
  b.yawRate += (target - b.yawRate) * Math.min(1, dt * 10);
  const leanTarget = clamp(Math.atan((b.v * b.yawRate) / 9.81), -BIKE.maxLean, BIKE.maxLean);
  b.lean += (leanTarget - b.lean) * Math.min(1, dt * 7);

  // --- kinematics in road coordinates
  const denom = Math.max(0.3, 1 - kappa * b.d);
  const sdot = (b.v * Math.cos(b.psi)) / denom;
  b.d += b.v * Math.sin(b.psi) * dt;
  b.psi += (b.yawRate - kappa * sdot) * dt;
  b.psi = clamp(b.psi, -1.45, 1.45);
  b.s = (((b.s + sdot * dt) % length) + length) % length;
  b.odo += b.v * dt;

  // --- suspension: body rides on a damped spring above the average wheel height
  const wheelY = (front.h + rear.h) / 2, pitchT = Math.atan2(front.h - rear.h, 1.4);
  const k = 190, cd = 26;
  const acc = -k * (b.y - wheelY) - cd * b.yv;
  b.yv += acc * dt;
  b.y += b.yv * dt;
  b.pitch += (pitchT - b.pitch) * Math.min(1, dt * 14);
  b.hit = Math.max(Math.min(1, Math.abs(acc) / 90), b.hit * Math.exp(-6 * dt));

  // --- road edge: stop at the limit and scrub speed
  if (Math.abs(b.d) > BIKE.edge) {
    b.d = Math.sign(b.d) * BIKE.edge;
    if (Math.sign(b.psi) === Math.sign(b.d)) b.psi *= 0.4;
    b.v *= Math.exp(-2.4 * dt);
  }
}

/** Speed in km/h for the readout. */
export const kmh = (v: number) => v * 3.6;
