// WebAudio synth: a thumpy single-cylinder engine, wind noise and a horn. No sample files.
// Must be started from a user gesture (iOS).
export class RideAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private eng!: { a: OscillatorNode; b: OscillatorNode; lp: BiquadFilterNode; amp: GainNode; lfo: OscillatorNode; lfoGain: GainNode; out: GainNode };
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

    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 1.4;
    const amp = ctx.createGain(); amp.gain.value = 0.55;
    const out = ctx.createGain(); out.gain.value = 0.5;
    const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 12;
    const b = ctx.createOscillator(); b.type = 'square'; b.frequency.value = 24;
    const gb = ctx.createGain(); gb.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 10;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.42;
    lfo.connect(lfoGain); lfoGain.connect(amp.gain);
    a.connect(lp); b.connect(gb); gb.connect(lp); lp.connect(amp); amp.connect(out); out.connect(this.master);
    a.start(); b.start(); lfo.start();
    this.eng = { a, b, lp, amp, lfo, lfoGain, out };

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
    const fire = rpm / 120; // single cylinder, four stroke: one power stroke every two revolutions
    this.eng.a.frequency.setTargetAtTime(fire * 1.0, t, k);
    this.eng.b.frequency.setTargetAtTime(fire * 2.0, t, k);
    this.eng.lfo.frequency.setTargetAtTime(fire, t, k);
    this.eng.lp.frequency.setTargetAtTime(260 + rpm * 0.42 + load * 500, t, k);
    this.eng.out.gain.setTargetAtTime(0.32 + load * 0.28, t, 0.08);
    this.wind.gain.gain.setTargetAtTime(Math.min(0.2, (speed / 24) ** 1.6 * 0.2), t, 0.1);
    this.wind.bp.frequency.setTargetAtTime(600 + speed * 60, t, 0.1);
    this.horn.gain.gain.setTargetAtTime(horn ? 0.2 : 0, t, 0.015);
  }

  /** Continuous tyre-on-surface sound. */
  surface(kind: string, speed: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, v = Math.min(1, speed / 14);
    const table: Record<string, [number, number]> = { // [level, filter Hz]
      tar: [0.02, 500], broken: [0.2, 330], pothole: [0.28, 260], water: [0.34, 1500], mud: [0.34, 420], sand: [0.2, 2600], bump: [0.1, 300], shoulder: [0.22, 900],
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

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.03);
  }
}
