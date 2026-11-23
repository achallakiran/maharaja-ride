// Rolling frame statistics for the on-screen perf readout. Pure logic.

export class FrameStats {
  private readonly times: number[] = [];
  private readonly window: number;
  constructor(window = 120) { this.window = window; }

  push(seconds: number): void {
    this.times.push(seconds);
    if (this.times.length > this.window) this.times.shift();
  }
  get count(): number { return this.times.length; }
  get avgMs(): number {
    if (!this.times.length) return 0;
    let s = 0;
    for (const t of this.times) s += t;
    return (s / this.times.length) * 1000;
  }
  get fps(): number { const ms = this.avgMs; return ms > 0 ? 1000 / ms : 0; }
  get worstMs(): number {
    let w = 0;
    for (const t of this.times) if (t > w) w = t;
    return w * 1000;
  }
  reset(): void { this.times.length = 0; }
}
