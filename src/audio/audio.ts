// WebAudio synth: a thumpy single-cylinder engine, wind noise and a horn. No sample files.
// Must be started from a user gesture (iOS).
export class RideAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private eng!: { a: OscillatorNode; b: OscillatorNode; lp: BiquadFilterNode; amp: GainNode; lfo: OscillatorNode; lfoGain: GainNode; out: GainNode };
  private wind!: { gain: GainNode; bp: BiquadFilterNode };
  private horn!: { gain: GainNode };
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

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.03);
  }
}
