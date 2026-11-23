// Gearbox + rev model for the engine sound. Pure: maps road speed and throttle to rpm and gear.

export const IDLE_RPM = 1300;
export const REDLINE_RPM = 7200;
const SHIFT_UP_RPM = 6300;
const SHIFT_DOWN_RPM = 2600;
/** Top speed of each gear in m/s, at redline. */
export const GEAR_TOP = [6.5, 11.5, 16.5, 21, 26] as const;

export interface EngineState { gear: number; rpm: number; load: number; shiftTimer: number }

export const newEngine = (): EngineState => ({ gear: 0, rpm: IDLE_RPM, load: 0, shiftTimer: 0 });

function rpmFor(speed: number, gear: number): number {
  return IDLE_RPM + (speed / GEAR_TOP[gear]) * (REDLINE_RPM - IDLE_RPM);
}

export function stepEngine(e: EngineState, speed: number, throttle: number, dt: number): void {
  e.shiftTimer = Math.max(0, e.shiftTimer - dt);
  let rpm = rpmFor(speed, e.gear);
  if (e.shiftTimer <= 0) {
    if (rpm > SHIFT_UP_RPM && e.gear < GEAR_TOP.length - 1) { e.gear++; e.shiftTimer = 0.22; }
    else if (rpm < SHIFT_DOWN_RPM && e.gear > 0) { e.gear--; e.shiftTimer = 0.18; }
    rpm = rpmFor(speed, e.gear);
  }
  // clutch slip in first gear at a standstill, plus a little rev flare with throttle
  const flare = throttle * 900 * (speed < 4 ? 1 : 0.35);
  const target = Math.min(REDLINE_RPM, Math.max(IDLE_RPM, rpm) + flare);
  // revs follow quickly but not instantly; during a shift the throttle is cut
  e.rpm += (target - e.rpm) * Math.min(1, dt * (e.shiftTimer > 0 ? 6 : 12));
  e.load = e.shiftTimer > 0 ? 0.1 : 0.2 + 0.8 * throttle;
}
