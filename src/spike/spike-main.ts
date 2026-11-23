import { PerfSpike } from './perf-spike.ts';

declare global { interface Window { __bench?: { done: boolean; results: Record<string, number>[]; error?: string } } }

export function runSpike(): void {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const canvas = $<HTMLCanvasElement>('world');
  const hud = $('hud');
  const query = new URLSearchParams(location.search);

  let spike: PerfSpike;
  try {
    spike = new PerfSpike(canvas, Number(query.get('n')) || 60);
  } catch (e) {
    hud.textContent = 'WebGL is not available in this browser.';
    window.__bench = { done: true, results: [], error: String(e) };
    throw e;
  }

  $('less').addEventListener('click', () => spike.setVehicles(spike.requestedVehicles - 10));
  $('more').addEventListener('click', () => spike.setVehicles(spike.requestedVehicles + 10));
  $('dpr').addEventListener('click', () => { spike.cycleDpr(); });
  addEventListener('resize', () => spike.resize());
  // no pinch-zoom / long-press menus on the game surface
  for (const ev of ['gesturestart', 'contextmenu']) document.addEventListener(ev, e => e.preventDefault());

  // Optional automatic benchmark: ?bench=1 steps through vehicle counts and records the numbers.
  const bench = query.has('bench');
  const steps = [20, 40, 60, 80, 100];
  const STEP_SECONDS = Number(query.get('benchSeconds')) || 3;
  let benchIndex = 0, benchStart = 0, benchStarted = false;
  if (bench) window.__bench = { done: false, results: [] };

  let last = performance.now(), hudAt = 0;
  function loop(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    spike.frame(dt);
    if (now - hudAt > 250) {
      hudAt = now;
      const i = spike.info();
      hud.textContent = `${i.fps.toFixed(0)} fps · worst ${i.worstMs.toFixed(0)} ms · ${i.calls} calls · ${(i.tris / 1000).toFixed(0)}k tris · ${i.vehicles} vehicles · DPR ${i.dpr}`;
    }
    if (bench && window.__bench && !window.__bench.done) {
      if (!benchStarted) { benchStarted = true; spike.setVehicles(steps[0]); benchStart = now; }
      else if (now - benchStart > STEP_SECONDS * 1000) {
        const i = spike.info();
        window.__bench.results.push({ n: i.vehicles, fps: +i.fps.toFixed(1), worstMs: +i.worstMs.toFixed(1), calls: i.calls, tris: i.tris, dpr: i.dpr });
        benchIndex++;
        if (benchIndex >= steps.length) window.__bench.done = true;
        else { spike.setVehicles(steps[benchIndex]); benchStart = now; }
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
