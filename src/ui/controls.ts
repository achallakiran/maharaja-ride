// Touch + keyboard input: a floating steering joystick on the left, gas / brake / horn buttons on the right.
// Pointer events with capture, so every finger stays on its own control, and a lost finger never leaves a stuck input.
import type { BikeInput } from '../sim/bike.ts';

export interface ControlEls {
  zone: HTMLElement; base: HTMLElement; knob: HTMLElement;
  gas: HTMLElement; brake: HTMLElement; horn: HTMLElement;
}

const KEYS = {
  gas: ['ArrowUp', 'KeyW', 'KeyZ'], brake: ['ArrowDown', 'KeyS', 'Space', 'KeyX'],
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], horn: ['KeyH', 'KeyB'],
};

export class Controls {
  private readonly els: ControlEls;
  private readonly keys = new Set<string>();
  private stick = 0;   // left / right, -1..1
  private stickY = 0;  // forward / back, -1..1 (+ = pushed forward)
  private stickPid: number | null = null;
  private cx = 0;
  private cy = 0;
  private radius = 56;
  private readonly held = { gas: false, brake: false, horn: false };
  private readonly pids = new Map<string, number>();
  /** Latest input, refreshed by read(). */
  readonly state: BikeInput = { steer: 0, throttle: 0, brake: 0, horn: false };

  constructor(els: ControlEls) {
    this.els = els;
    this.bindStick();
    this.bindButton('gas', els.gas);
    this.bindButton('brake', els.brake);
    this.bindButton('horn', els.horn);
    addEventListener('keydown', e => { if (this.isGameKey(e.code)) { this.keys.add(e.code); e.preventDefault(); } });
    addEventListener('keyup', e => { this.keys.delete(e.code); });
    addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
  }

  private isGameKey(code: string): boolean { return Object.values(KEYS).some(l => l.includes(code)); }
  private anyKey(list: string[]): boolean { return list.some(k => this.keys.has(k)); }

  reset(): void {
    this.keys.clear();
    this.stick = 0; this.stickY = 0; this.stickPid = null;
    this.held.gas = this.held.brake = this.held.horn = false;
    this.pids.clear();
    this.els.base.classList.remove('active');
    for (const b of [this.els.gas, this.els.brake, this.els.horn]) b.classList.remove('down');
    this.els.knob.style.transform = 'translate(-50%, -50%)';
  }

  private bindStick(): void {
    const { zone, base, knob } = this.els;
    zone.addEventListener('pointerdown', e => {
      // a new finger while the old one is "still down" means the old lift-off was lost: follow the new one
      if (this.stickPid !== null && this.stickPid !== e.pointerId) { this.stickPid = null; this.stick = 0; this.stickY = 0; }
      if (this.stickPid !== null) return;
      e.preventDefault();
      this.stickPid = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch { /* synthetic events cannot be captured */ }
      const r = zone.getBoundingClientRect();
      this.radius = Math.max(40, Math.min(70, r.height * 0.18));
      base.style.setProperty('--r', `${this.radius}px`);
      this.cx = Math.min(Math.max(e.clientX, r.left + this.radius), r.right - this.radius);
      const cy = this.cy = Math.min(Math.max(e.clientY, r.top + this.radius), r.bottom - this.radius);
      base.style.left = `${this.cx - r.left}px`; base.style.top = `${cy - r.top}px`;
      base.classList.add('active');
      this.moveStick(e);
    });
    zone.addEventListener('pointermove', e => { if (e.pointerId === this.stickPid) this.moveStick(e); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPid) return;
      this.stickPid = null; this.stick = 0; this.stickY = 0;
      base.classList.remove('active');
      knob.style.transform = 'translate(-50%, -50%)';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  private moveStick(e: PointerEvent): void {
    const r = this.radius, cy = this.cy;
    const dx = Math.max(-r, Math.min(r, e.clientX - this.cx)), dy = Math.max(-r, Math.min(r, e.clientY - cy));
    const vx = dx / r, vy = -dy / r;
    this.stick = Math.abs(vx) < 0.12 ? 0 : vx;
    this.stickY = vy;
    this.els.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private bindButton(name: 'gas' | 'brake' | 'horn', el: HTMLElement): void {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.held[name] = true; el.classList.add('down');
      this.pids.set(name, e.pointerId);
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    const up = (e: PointerEvent) => {
      if (this.pids.get(name) !== e.pointerId) return;
      this.pids.delete(name); this.held[name] = false; el.classList.remove('down');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  /**
   * One-thumb driving, as in Toofan: push the stick any way except back and the bike goes (harder = faster); its left/right
   * part steers; pull it back to brake. The gas and brake buttons and the keyboard do the same job.
   */
  read(): BikeInput {
    const kb = (this.anyKey(KEYS.right) ? 1 : 0) - (this.anyKey(KEYS.left) ? 1 : 0);
    this.state.steer = kb !== 0 ? kb : this.stick;
    const mag = Math.min(1, Math.hypot(this.stick, Math.max(0, this.stickY)));
    const back = this.stickY < -0.35;
    const stickThr = back || mag < 0.15 ? 0 : mag;
    const stickBrk = back ? Math.min(1, -this.stickY) : 0;
    const key = this.anyKey(KEYS.gas) || this.held.gas ? 1 : 0;
    const brk = this.held.brake || this.anyKey(KEYS.brake) ? 1 : stickBrk;
    this.state.throttle = brk > 0 ? 0 : Math.max(key, stickThr);
    this.state.brake = brk;
    this.state.horn = this.held.horn || this.anyKey(KEYS.horn);
    return this.state;
  }
}
