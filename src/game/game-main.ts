import { Game } from './game.ts';
import { Controls } from '../ui/controls.ts';
import { RideAudio } from '../audio/audio.ts';

declare global { interface Window { __game?: Game } }

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export function runGame(): void {
  const query = new URLSearchParams(location.search);
  document.body.classList.add('game');
  const canvas = $<HTMLCanvasElement>('world');
  const audio = new RideAudio();
  let game: Game;
  try { game = new Game(canvas, audio); } catch (e) {
    $('start').querySelector('p')!.textContent = 'WebGL is not available in this browser.';
    throw e;
  }
  window.__game = game;
  const controls = new Controls({ zone: $('stickZone'), base: $('stickBase'), knob: $('stickKnob'), gas: $('btnGas'), brake: $('btnBrake'), horn: $('btnHorn') });

  let running = false;
  const begin = (): void => {
    if (running) return;
    running = true;
    $('start').hidden = true;
    $('ride').hidden = false;
    game.resize();
    audio.start();
    const el = document.documentElement;
    try { void el.requestFullscreen?.(); } catch { /* not allowed */ }
    try { void (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => undefined); } catch { /* not supported */ }
  };
  $('startBtn').addEventListener('click', begin);
  if (query.has('autostart')) { running = true; $('start').hidden = true; $('ride').hidden = false; game.resize(); }

  $('btnView').addEventListener('click', () => game.toggleView());
  addEventListener('keydown', e => { if (e.key === 'c' || e.key === 'C') game.toggleView(); });
  const mute = $('btnMute'), fs = $('btnFs');
  mute.addEventListener('click', () => { audio.setMuted(!audio.muted); mute.classList.toggle('off', audio.muted); });
  if (!document.fullscreenEnabled) fs.hidden = true;
  fs.addEventListener('click', () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); });
  addEventListener('resize', () => game.resize());
  for (const ev of ['gesturestart', 'contextmenu']) document.addEventListener(ev, e => e.preventDefault());

  const portrait = matchMedia('(orientation: portrait) and (pointer: coarse)');
  const warn = $('warn'), blink = $('blink');
  blink.hidden = false;
  const spd = $('spd'), odo = $('odo'), place = $('place');
  let last = performance.now(), hudAt = 0;
  const tick = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (running && !portrait.matches && !document.hidden) game.frame(dt, controls.read());
    const bk = game.bike;
    warn.style.opacity = String(Math.max(0, (bk.danger - 0.35) / 0.65));
    blink.style.opacity = String(bk.blink);
    if (now - hudAt > 100) {
      hudAt = now;
      const i = game.info();
      spd.textContent = String(Math.round(i.kmh));
      odo.textContent = `${i.km.toFixed(1)} km`;
      place.textContent = i.place;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
