// Arcade motorcycle in ROAD coordinates: s = distance along the loop, d = metres to the right of the lane
// centre, psi = how far the bike points to the right of the road direction. Pure and deterministic.
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
  thud: number;    // one-shot impact strength 0..1; the game reads it (for sound) and clears it
  wob: number;     // handlebar wobble, in steering units (-1..1)
  wobV: number;
  bal: number;     // balance error: extra lean the rider is fighting, rad, + = falling right
  balV: number;
  foot: number;    // -1 / 0 / +1: which foot is down (dabbing); both feet when crawling (see footBoth)
  footBoth: boolean;
  footAmt: number; // 0..1 animation of the dab
  fallT: number;   // > 0 while falling / blinking, seconds
  fallDir: number; // side the bike goes down on
  tip: number;     // extra roll while falling, rad
  blink: number;   // 0..1 black-out amount for the reset blink
  grace: number;   // seconds of no-fall protection after a reset
  falls: number;   // count of falls this ride
  slF: number;     // front-wheel slope last step
  danger: number;  // 0..1 how close to falling (for the warning vignette / vibration)
}

/** Road under the wheels: height and material at (s, d). */
export type Ground = (s: number, d: number) => { h: number; kind: SurfaceKind };
const FLAT: Ground = () => ({ h: 0, kind: 'tar' });

export const BIKE = {
  vmax: 21,          // m/s, about 76 km/h
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
  return { s, d: 0, psi: 0, v: 0, steer: 0, yawRate: 0, lean: 0, odo: 0, surface: 'tar', y: 0, yv: 0, pitch: 0, hit: 0, slope: 0, thud: 0, wob: 0, wobV: 0, bal: 0, balV: 0, foot: 0, footBoth: false, footAmt: 0, fallT: 0, fallDir: 1, tip: 0, blink: 0, grace: 0, falls: 0, slF: 0, danger: 0 };
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

const KICK = 4.5, SELF = 0.24;
const smoothstep = (a: number, c: number, x: number) => { const t = clamp((x - a) / (c - a), 0, 1); return t * t * (3 - 2 * t); };

/** How well a planted foot holds the bike up on this ground. */
function footSupport(kind: SurfaceKind, h: number, slope: number): number {
  const base: Record<SurfaceKind, number> = { tar: 1, broken: 0.9, crack: 0.8, pothole: 0.7, water: 0.65, mud: 0.38, sand: 0.5, bump: 0.9, shoulder: 0.8 };
  let f = base[kind];
  if (h < -0.3) f *= 0.65;
  if (Math.abs(slope) > 0.45) f *= 0.65;
  return f;
}

function fall(b: BikeState, dir: number): void {
  if (b.fallT > 0 || b.grace > 0) return;
  b.fallT = 1e-4; b.fallDir = dir >= 0 ? 1 : -1; b.thud = 1; b.falls++;
}

/** The fall: tip over, slide, black out, then pop back on the road a few metres on, upright and slow. */
function stepFall(b: BikeState, dt: number, ground: Ground): void {
  b.fallT += dt;
  const t = b.fallT;
  b.v *= Math.exp(-3.2 * dt);
  b.tip = b.fallDir * Math.min(1.3, t * 5);
  b.wob *= Math.exp(-6 * dt); b.wobV = 0;
  b.s = b.s + b.v * dt;
  b.blink = clamp((t - 0.5) / 0.25, 0, 1);
  b.foot = 0; b.footBoth = false; b.footAmt *= Math.exp(-10 * dt);
  if (t >= 0.9) {
    // back on the road: slide forward out of any trench, centre up, standing still
    let s = b.s, d = clamp(b.d, -3.2, 3.2);
    for (let i = 0; i < 40 && ground(s, d).h < -0.15; i++) s += 0.5;
    b.s = s; b.d = d; b.psi = 0; b.v = 0; b.bal = 0; b.balV = 0; b.wob = 0; b.wobV = 0; b.tip = 0; b.lean = 0; b.yawRate = 0; b.steer = 0;
    b.y = ground(s, d).h; b.yv = 0; b.fallT = 0; b.grace = 1.8; b.danger = 0;
  }
}

export function stepBike(b: BikeState, input: BikeInput, kappaAt: (s: number) => number, length: number, dt: number, ground: Ground = FLAT): void {
  b.grace = Math.max(0, b.grace - dt);
  if (b.fallT === 0) b.blink = Math.max(0, b.blink - dt * 3);
  if (b.fallT > 0) { stepFall(b, dt, ground); return; }
  const th = clamp(input.throttle, 0, 1), br = clamp(input.brake, 0, 1), st = clamp(input.steer, -1, 1);
  const onShoulder = Math.abs(b.d) > BIKE.shoulderStart;
  const under = ground(b.s, b.d), front = ground(b.s + 0.7, b.d), rear = ground(b.s - 0.7, b.d), fwd = ground(b.s + 1.4, b.d);
  const gdF = (ground(b.s + 0.7, b.d + 0.2).h - ground(b.s + 0.7, b.d - 0.2).h) / 0.4;
  const gdR = (ground(b.s - 0.7, b.d + 0.2).h - ground(b.s - 0.7, b.d - 0.2).h) / 0.4;
  b.surface = onShoulder && under.kind === 'tar' ? 'shoulder' : under.kind;
  const feel = SURFACE_FEEL[b.surface];

  // --- speed
  const stuck = under.h < -0.3 ? 0.35 : 1; // deep in a trench: barely able to climb out
  const support = footSupport(b.surface, under.h, (front.h - rear.h) / 1.4);
  const W = 1 - smoothstep(3.5, 7.5, b.v); // how much feet can do at this speed
  const vcap = Math.max(BIKE.vmax * feel.cap * stuck, th > 0 ? 3.2 * support : 0);
  let a = th * BIKE.accel * Math.max(0, 1 - (b.v / vcap) ** 2);
  if (b.v > 0.01) {
    a -= br * BIKE.brake + BIKE.rolling + BIKE.drag * b.v * b.v;
    a -= feel.drag + Math.max(0, b.v - vcap) * 1.4;
    // dropping into / climbing out of a hole costs speed at pace; slowly, it is just a hill to climb
    a -= Math.min(60, Math.abs(front.h - rear.h) / 1.4 * b.v * 7) * smoothstep(3.5, 7, b.v);
  }
  a -= clamp((front.h - rear.h) / 1.4, -1, 1) * 9.8 * 0.55;
  if (b.foot !== 0 || b.footBoth) a += th * 4 * support * W - (br > 0 ? 0 : 0.6 * W); // paddling with the feet
  a -= Math.abs(b.wob) * 6 * smoothstep(0.1, 0.3, Math.abs(b.wob)) * Math.min(1, b.v / 6); // a wobbling bike scrubs speed
  b.v = Math.max(0, b.v + a * dt);
  if (br > 0 && b.v < 0.05) b.v = 0;
  if (th === 0 && b.v < 0.12 && Math.abs(front.h - rear.h) < 0.06) b.v = 0;

  // --- wobble: the front wheel kicks the bars on every edge; speed and a big swing make it self-exciting
  const noise = hash2(Math.floor(b.odo * 5), 7) * 2 - 1;
  const dSlF = ((fwd.h - front.h) / 0.7) - b.slF;
  b.slF = (fwd.h - front.h) / 0.7;
  b.wobV += (-gdF * 9 + noise * Math.abs(dSlF) * 5) * b.v * dt * KICK;
  const amp = Math.abs(b.wob);
  const hold = Math.abs(st) < 0.3 ? 3 : 0;
  const counter = Math.sign(st) === -Math.sign(b.wobV) && Math.abs(st) > 0.15 && Math.abs(st) < 0.7 ? 3.5 : 0;
  const jerk = Math.abs(st) > 0.75 && amp > 0.06 ? 1 : 0;
  const cw = 6.5 + hold + counter + 2.5 * br - jerk * 5 - SELF * Math.max(0, b.v - 4) * (0.3 + 3 * clamp((amp - 0.06) / 0.2, 0, 1)) - (th > 0.6 ? 1 : 0);
  b.wobV += (-220 * b.wob - cw * b.wobV) * dt;
  b.wob = clamp(b.wob + b.wobV * dt, -1, 1);

  // --- balance: an inverted pendulum. Speed holds it up; below ~25 km/h the rider's feet have to.
  const S = smoothstep(2, 7, b.v);
  const slip = feel.grip < 1 ? 1 - feel.grip : 0;
  b.balV += (-(gdF + gdR) * 0.5 * b.v * 1.6 + noise * slip * b.v * 1.2 + Math.sign(b.lean) * Math.max(0, Math.abs(b.lean) - 0.25) * slip * 14 * (b.v / 10)) * dt;
  if (br > 0.5 && slip > 0) b.balV += noise * br * slip * b.v * 0.9 * dt;
  let torque = 9 * b.bal - 14 * S * b.bal - 4 * b.balV;
  const dab = Math.abs(b.bal) > 0.1 && W > 0;
  b.footBoth = b.v < 1.2;
  b.foot = dab && !b.footBoth ? Math.sign(b.bal) : 0;
  if (dab || b.footBoth) torque -= 26 * support * W * b.bal + (b.footBoth ? 12 * support * b.balV : 6 * support * W * b.balV);
  b.balV += torque * dt;
  b.bal += b.balV * dt;
  if (b.footBoth) b.bal *= Math.exp(-6 * dt);
  const footTarget = b.foot !== 0 || b.footBoth ? 1 : 0;
  b.footAmt += (footTarget - b.footAmt) * Math.min(1, dt * 14);
  b.danger = clamp(Math.max(Math.abs(b.bal) / 0.55, Math.abs(b.wob) / 0.75), 0, 1);

  // --- falls: lost balance, tank-slapper, or dropping the front wheel into a deep hole too fast
  const sl0 = (front.h - rear.h) / 1.4;
  if (Math.abs(b.bal) > 0.55) fall(b, b.bal);
  else if (Math.abs(b.wob) > 0.75) fall(b, b.wob > 0 ? 1 : -1);
  else if (sl0 < -0.55 && -sl0 * b.v > 10) fall(b, noise);
  if (b.fallT > 0) return;

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
  const sEff = b.steer + 0.8 * b.wob;
  const into = Math.sign(sEff) * b.psi;
  const room = into > 0 ? clamp(1 - into / BIKE.maxAngle, 0, 1) : 1;
  const target = sEff * authority * room * feel.grip + kappa * sdotPre - 0.9 * settle * b.psi * Math.min(1, b.v / 3);
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
  const sl = (front.h - rear.h) / 1.4;
  if (Math.abs(sl) > 0.22 && Math.abs(b.slope) <= 0.22 && b.v > 3) {
    // dropping in (nose down) or slamming into the far wall (nose up)
    const power = Math.min(1, b.v / 12) * Math.min(1.6, Math.abs(sl) * 3.2);
    b.yv += (sl < 0 ? -1.4 : -2.2) * power;
    b.thud = Math.max(b.thud, Math.min(1, power));
    if (sl > 0) b.v *= 1 - Math.min(0.5, power * 0.35);
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
