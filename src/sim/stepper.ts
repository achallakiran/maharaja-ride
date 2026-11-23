// Fixed-timestep accumulator: simulation always advances in equal steps so it stays deterministic
// whatever the frame rate. Pure logic.

export class FixedStepper {
  private acc = 0;
  readonly dt: number;
  readonly maxSteps: number;
  constructor(dt: number, maxSteps = 5) { this.dt = dt; this.maxSteps = maxSteps; }

  /** Feed one rendered frame; runs `step` zero or more times. Returns blend factor 0..1 for rendering. */
  advance(frameSeconds: number, step: (dt: number) => void): number {
    this.acc += Math.min(Math.max(frameSeconds, 0), 0.25);
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSteps) {
      step(this.dt);
      this.acc -= this.dt;
      n++;
    }
    if (n === this.maxSteps) this.acc = 0; // spiral-of-death guard: drop the backlog
    return this.acc / this.dt;
  }
}
