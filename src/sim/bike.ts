// Arcade motorcycle in ROAD coordinates, driven the way Toofan's ride mode is driven:
//   one thumb: stick magnitude = throttle (speed follows it straight away), left/right steers, pull back to brake;
//   steering turns the bike directly and letting go lines it up with the road again.
// s = distance along the loop, d = metres right of the lane centre, psi = how far the bike points right of the road.
// Pure and deterministic. Nothing hidden: rough ground slows you and bounces the camera; a ditch edge hit above a fixed
// speed throws the bike (a choreographed fall in the style of voxel-bike), below it you just scoot out on your feet.
//
//   s'   = v cos(psi) / (1 - kappa d)
//   d'   = v sin(psi)
//   psi' = yawRate - kappa s'        (kappa > 0 when the road turns right)

import { SURFACE_FEEL, type SurfaceKind } from '../world/surface.ts';
import { hash2 } from './rng.ts';

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
  slope: number;   // road slope under the wheels last step
  thud: number;    // one-shot impact strength 0..1; the game reads it (for sound / vibration) and clears it
  foot: number;    // -1 left / +1 right / 0: the foot that is down (stopped, or turning slowly)
  footBoth: boolean; // true while walking the bike along with both feet
  walk: number;    // walking animation phase, rad
  footAmt: number; // 0..1 animation of the dab
  fallT: number;   // > 0 while the fall plays out (seconds, up to BIKE.crashTime)
  fallDir: number; // side the bike goes down on, +1 right / -1 left
  tip: number;     // roll of the fallen bike, rad
  grace: number;   // seconds of no-fall protection after getting back on
  falls: number;   // count of falls this ride
  ditchLatch: boolean;
}

/** Road under the wheels: height and material at (s, d). */
export type Ground = (s: number, d: number) => { h: number; kind: SurfaceKind };
const FLAT: Ground = () => ({ h: 0, kind: 'tar' });

export const BIKE = {
  vmax: 17.5,        // m/s, about 63 km/h at full stick on good tar (Toofan: 17)
  accel: 5.5,        // m/s^2, Toofan's launch
  brake: 14,
  coast: 1.6,        // engine braking when the stick is let go
  shoulderStart: 5.5,
  edge: 7.6,         // hard limit left/right of the lane centre
  assist: 0.9,       // lane assist: how fast the bike lines up with the road when you are not steering
  maxLean: 0.7,
  maxAngle: 0.5,     // most the rider can point off the road direction while steering, rad
  turn: 2.1,         // rad/s of turn at speed (Toofan: 2.4)
  fallSpeed: 11,     // m/s (40 km/h): hitting a ditch edge faster than this throws the bike
  crashTime: 2.85,   // seconds: tumble, stand up, run back, remount (voxel-bike's CRASH_TIME)
} as const;

export function newBike(s = 0): BikeState {
  return { s, d: 0, psi: 0, v: 0, steer: 0, yawRate: 0, lean: 0, odo: 0, surface: 'tar', y: 0, yv: 0, pitch: 0, hit: 0, slope: 0, thud: 0, foot: 0, footBoth: false, walk: 0, footAmt: 0, fallT: 0, fallDir: 1, tip: 0, grace: 0, falls: 0, ditchLatch: false };
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, c: number, x: number) => { const t = clamp((x - a) / (c - a), 0, 1); return t * t * (3 - 2 * t); };

function fall(b: BikeState, dir: number): void {
  if (b.fallT > 0 || b.grace > 0) return;
  b.fallT = 1e-4; b.fallDir = dir >= 0 ? 1 : -1; b.thud = 1; b.falls++;
  b.v *= 0.33; // the slide
}

/** The fall (like voxel-bike's): the bike goes down on its side and slides, the rider tumbles clear, gets up, runs back and remounts. */
function stepFall(b: BikeState, dt: number, kappaAt: (s: number) => number, length: number, ground: Ground): void {
  b.fallT += dt;
  const t = b.fallT;
  b.v *= Math.exp(-2.4 * dt);
  const kappa = kappaAt(b.s), denom = Math.max(0.3, 1 - kappa * b.d);
  b.s = (((b.s + (b.v * Math.cos(b.psi) / denom) * dt) % length) + length) % length;
  b.psi *= Math.exp(-4 * dt); b.yawRate = 0; b.steer = 0;
  b.odo += b.v * dt;
  b.tip = b.fallDir * 1.4 * smoothstep(0, 0.48, t) * (1 - smoothstep(2.49, 2.77, t));
  b.lean = 0;
  b.pitch += (-0.25 * smoothstep(0, 0.3, t) * (1 - smoothstep(2.49, 2.77, t)) - b.pitch) * Math.min(1, dt * 10);
  b.y += (ground(b.s, b.d).h - b.y) * Math.min(1, dt * 12); b.yv = 0;
  b.foot = 0; b.footBoth = false; b.footAmt *= Math.exp(-10 * dt);
  if (t >= BIKE.crashTime) {
    // upright again on a level bit of road a little further on
    let s = b.s;
    for (let i = 0; i < 40 && ground(s, b.d).h < -0.12; i++) s += 0.5;
    b.s = s; b.d = clamp(b.d, -3.2, 3.2); b.psi = 0; b.v = 0; b.tip = 0; b.pitch = 0; b.y = ground(s, b.d).h;
    b.fallT = 0; b.grace = 1.5;
  }
}

export function stepBike(b: BikeState, input: BikeInput, kappaAt: (s: number) => number, length: number, dt: number, ground: Ground = FLAT): void {
  b.grace = Math.max(0, b.grace - dt);
  if (b.fallT > 0) { stepFall(b, dt, kappaAt, length, ground); return; }
  const th = clamp(input.throttle, 0, 1), br = clamp(input.brake, 0, 1), st = clamp(input.steer, -1, 1);
  const onShoulder = Math.abs(b.d) > BIKE.shoulderStart;
  const under = ground(b.s, b.d), front = ground(b.s + 0.7, b.d), rear = ground(b.s - 0.7, b.d);
  b.surface = onShoulder && under.kind === 'tar' ? 'shoulder' : under.kind;
  const feel = SURFACE_FEEL[b.surface];
  const sl = (front.h - rear.h) / 1.4;

  // --- speed: follows the stick like Toofan's. Bad ground lowers the top speed and sheds speed faster.
  const walking = th > 0.1 && b.v < 2.8; // up to ~10 km/h the rider still pushes along with his feet
  const tgt = BIKE.vmax * feel.cap * th;
  if (th > 0.15 && br === 0) b.v = b.v < tgt ? Math.min(tgt, b.v + BIKE.accel * th * (walking ? 0.6 : 1) * dt) : Math.max(tgt, b.v - (BIKE.coast + feel.drag) * dt);
  else if (br > 0.15) b.v = Math.max(0, b.v - BIKE.brake * br * dt);
  else b.v = Math.max(0, b.v - (BIKE.coast + feel.drag) * dt);
  b.v = Math.max(0, b.v - clamp(sl, -1, 1) * 9.8 * 0.35 * dt); // a wall of a ditch is a hill

  // --- ditch / hole edge: hit with the front wheel
  const fdrop = under.h - front.h;
  if (fdrop > 0.18 && !b.ditchLatch && b.v > 2) {
    b.ditchLatch = true;
    if (b.v > BIKE.fallSpeed) fall(b, hash2(Math.floor(b.odo), 11) - 0.5);
    else { b.v *= 0.6; b.thud = Math.max(b.thud, Math.min(1, b.v / 8)); }
  } else if (fdrop < 0.03) b.ditchLatch = false;
  if (b.fallT > 0) return;

  // --- steering: direct, like Toofan. The turn rate rises with speed; letting go lines the bike up with the road.
  b.steer += (st - b.steer) * Math.min(1, dt * 18);
  const authority = BIKE.turn * Math.min(1, 0.25 + b.v / 8) * Math.min(1, b.v / 0.8);
  const kappa = kappaAt(b.s);
  const sdotPre = b.v * Math.cos(b.psi);
  const settle = BIKE.assist * (1 - Math.min(1, Math.abs(st) * 0.8));
  const into = Math.sign(b.steer) * b.psi;
  const room = into > 0 ? clamp(1 - into / BIKE.maxAngle, 0, 1) : 1; // a lane change, not a spin-out
  const target = b.steer * authority * room * feel.grip + kappa * sdotPre - 0.9 * settle * b.psi * Math.min(1, b.v / 3);
  b.yawRate += (target - b.yawRate) * Math.min(1, dt * 20);
  const leanTarget = clamp(Math.atan((b.v * b.yawRate) / 9.81) * 1.35, -BIKE.maxLean, BIKE.maxLean); // a cartoonishly big lean
  b.lean += (leanTarget - b.lean) * Math.min(1, dt * 10);

  // --- kinematics in road coordinates
  const denom = Math.max(0.3, 1 - kappa * b.d);
  const sdot = (b.v * Math.cos(b.psi)) / denom;
  b.d += b.v * Math.sin(b.psi) * dt;
  b.psi += (b.yawRate - kappa * sdot) * dt;
  b.psi = clamp(b.psi, -1.45, 1.45);
  b.s = (((b.s + sdot * dt) % length) + length) % length;
  b.odo += b.v * dt;

  // --- feet (looks only): stopped = left foot down; gas on at a crawl = both feet walk the bike; a slow turn dabs the inside foot
  const stopped = b.v < 1.2 && !walking;
  b.footBoth = walking;
  b.foot = walking ? 0 : stopped ? -1 : b.v < 4.5 && Math.abs(b.steer) > 0.5 ? Math.sign(b.steer) : 0;
  if (walking) b.walk += dt * (2.5 + b.v * 3);
  b.footAmt += ((b.foot !== 0 || walking ? 1 : 0) - b.footAmt) * Math.min(1, dt * 14);

  // --- suspension: body rides on a damped spring above the average wheel height
  const wheelie = th > 0.5 && br === 0 && b.v < 9 && b.v > 0.3 ? 0.26 * (1 - b.v / 9) * th : 0; // launch wheelie
  const wheelY = (front.h + rear.h) / 2, pitchT = Math.atan2(front.h - rear.h, 1.4) + wheelie;
  if (Math.abs(sl) > 0.22 && Math.abs(b.slope) <= 0.22 && b.v > 3) {
    const power = Math.min(1, b.v / 12) * Math.min(1.6, Math.abs(sl) * 3.2);
    b.yv += (sl < 0 ? -1.4 : -2.2) * power;
    b.thud = Math.max(b.thud, Math.min(1, power));
  }
  b.slope = sl;
  const k = 190, cd = 26;
  const acc = -k * (b.y - wheelY) - cd * b.yv;
  b.yv += acc * dt;
  b.y += b.yv * dt;
  b.pitch += (pitchT - b.pitch) * Math.min(1, dt * 14);
  b.hit = Math.max(Math.min(1, Math.abs(acc) / 90), b.thud, b.hit * Math.exp(-6 * dt));

  // --- road edge: stop at the limit and scrub speed
  if (Math.abs(b.d) > BIKE.edge) {
    b.d = Math.sign(b.d) * BIKE.edge;
    if (Math.sign(b.psi) === Math.sign(b.d)) b.psi *= 0.4;
    b.v *= Math.exp(-2.4 * dt);
  }
}

/** Speed in km/h for the readout. */
export const kmh = (v: number) => v * 3.6;
