// WebAudio synth: a thumpy single-cylinder engine, wind noise and a horn. No sample files.
// Must be started from a user gesture (iOS).
export class RideAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private eng = { acc: 0, odd: 0, thr: 0, last: 0 };
  private wind!: { gain: GainNode; bp: BiquadFilterNode };
  private horn!: { gain: GainNode };
  private road!: { gain: GainNode; filt: BiquadFilterNode };
  private noise!: AudioBuffer;
  muted = false;

  get running(): boolean { return this.ctx !== null; }

  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.55; this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    this.noise = buf;
    const rg = ctx.createGain(); rg.gain.value = 0;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 400;
    const rn = ctx.createBufferSource(); rn.buffer = buf; rn.loop = true; rn.connect(rf); rf.connect(rg); rg.connect(this.master); rn.start();
    this.road = { gain: rg, filt: rf };
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.5;
    const wg = ctx.createGain(); wg.gain.value = 0;
    noise.connect(bp); bp.connect(wg); wg.connect(this.master); noise.start();
    this.wind = { gain: wg, bp };

    const hg = ctx.createGain(); hg.gain.value = 0;
    const hl = ctx.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 2400;
    for (const f of [415, 523]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(hl); o.start(); }
    hl.connect(hg); hg.connect(this.master);
    this.horn = { gain: hg };
  }

  update(rpm: number, load: number, speed: number, horn: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, k = 0.04;
    // Royal Enfield-style single cylinder, as in Toofan: one deep pulse per power stroke, uneven like the real thing
    const now = performance.now(), dt = Math.min(0.1, Math.max(0, (now - (this.eng.last || now)) / 1000));
    this.eng.last = now;
    const rn = Math.max(0, Math.min(1, rpm / 7200)), thr = Math.max(0, Math.min(1, load));
    this.eng.acc += dt * (4.4 + rn * 17) * (0.88 + Math.random() * 0.24);
    let n = 0;
    while (this.eng.acc >= 1 && n++ < 3) { this.eng.acc -= 1; this.eng.odd++; this.firePulse(rn, thr, this.eng.odd % 7 === 0 ? 0.6 : 1); }
    if (this.eng.acc > 3) this.eng.acc = 0;
    if (this.eng.thr > 0.6 && thr < 0.1 && speed > 5 && Math.random() < 0.08) this.backfire();
    this.eng.thr = thr;
    this.wind.gain.gain.setTargetAtTime(Math.min(0.2, (speed / 24) ** 1.6 * 0.2), t, 0.1);
    this.wind.bp.frequency.setTargetAtTime(600 + speed * 60, t, 0.1);
    this.horn.gain.gain.setTargetAtTime(horn ? 0.2 : 0, t, 0.015);
  }

  private firePulse(rn: number, thr: number, vol: number): void {
    const ctx = this.ctx!, t = ctx.currentTime, jit = 0.82 + Math.random() * 0.36, dur = 0.16 - 0.07 * rn, f0 = 62 + rn * 38 + thr * 10;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(f0 * jit, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime((0.5 + 0.35 * thr) * vol * jit, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g2 = ctx.createGain();
    s.buffer = this.noise; s.loop = true; f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(260 + rn * 320 + thr * 380, t); f.frequency.exponentialRampToValueAtTime(110, t + dur * 0.8);
    g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime((0.16 + 0.22 * thr) * vol, t + 0.005); g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.8);
    s.connect(f); f.connect(g2); g2.connect(this.master); s.start(t, Math.random() * 0.5); s.stop(t + dur);
    // the hollow tube of the long silencer
    const o2 = ctx.createOscillator(), g3 = ctx.createGain(), f3 = ctx.createBiquadFilter(), d3 = dur * 1.5;
    o2.type = 'sine'; o2.frequency.setValueAtTime(f0 * 0.5 * jit, t); o2.frequency.exponentialRampToValueAtTime(f0 * 0.36, t + d3);
    f3.type = 'lowpass'; f3.frequency.value = 220;
    g3.gain.setValueAtTime(0.0001, t); g3.gain.exponentialRampToValueAtTime((0.55 + 0.25 * thr) * vol, t + 0.012); g3.gain.exponentialRampToValueAtTime(0.0001, t + d3);
    o2.connect(f3); f3.connect(g3); g3.connect(this.master); o2.start(t); o2.stop(t + d3 + 0.02);
  }

  /** Pops from the exhaust when the throttle is shut at speed. */
  private backfire(): void {
    const ctx = this.ctx!, k = 1 + ((Math.random() * 3) | 0);
    for (let q = 0; q < k; q++) {
      const t = ctx.currentTime + 0.05 + q * 0.09, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = this.noise; f.type = 'bandpass'; f.Q.value = 1.4; f.frequency.setValueAtTime(900 + Math.random() * 500, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.05);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 0.5); s.stop(t + 0.06);
    }
  }

  /** Continuous tyre-on-surface sound. */
  surface(kind: string, speed: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, v = Math.min(1, speed / 14);
    const table: Record<string, [number, number]> = { // [level, filter Hz]
      tar: [0.02, 500], broken: [0.2, 330], pothole: [0.28, 260], crack: [0.26, 280], water: [0.34, 1500], mud: [0.34, 420], sand: [0.2, 2600], bump: [0.1, 300], shoulder: [0.22, 900],
    };
    const [lvl, hz] = table[kind] ?? table.tar;
    this.road.gain.gain.setTargetAtTime(lvl * (0.25 + 0.75 * v), t, 0.06);
    this.road.filt.frequency.setTargetAtTime(hz, t, 0.06);
  }

  /** One-shot impact: a body thump plus a splash / crunch tail depending on what you hit. */
  thud(strength: number, kind: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, st = Math.min(1, Math.max(0.15, strength));
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    g.gain.setValueAtTime(0.9 * st, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.32);
    const wet = kind === 'water' || kind === 'mud';
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = wet ? 'bandpass' : 'lowpass'; f.frequency.value = wet ? 1400 : 700; f.Q.value = 0.7;
    const ng = ctx.createGain(); const dur = wet ? 0.7 : 0.18;
    ng.gain.setValueAtTime((wet ? 0.7 : 0.45) * st, t); ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(ng); ng.connect(this.master); n.start(t, Math.random()); n.stop(t + dur + 0.05);
  }

  /** A boot hitting the ground: scuff on hard ground, squelch / splash / crunch on soft. */
  foot(kind: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    const [hz, dur, lvl] = kind === 'water' ? [1800, 0.35, 0.5] : kind === 'mud' ? [380, 0.3, 0.55] : kind === 'sand' ? [3200, 0.22, 0.35] : [1100, 0.1, 0.4];
    f.frequency.value = hz; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(lvl, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.master); n.start(t, Math.random()); n.stop(t + dur + 0.05);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.03);
  }
}
