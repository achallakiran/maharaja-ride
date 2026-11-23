// Phase 0 risk spike: how many close-detail voxel vehicles can a phone draw at 60 fps?
import * as THREE from 'three';
import { FixedStepper } from '../sim/stepper.ts';
import { FrameStats } from '../sim/frame-stats.ts';
import { buildTraffic, stepTraffic, worldX, worldZ, type LaneDef, type TrafficWorld } from '../sim/spike-traffic.ts';
import { buildVehicleKit } from '../voxel/vehicles.ts';
import { VehicleFleet } from '../render/vehicle-fleet.ts';
import { buildCityStrip } from './city-strip.ts';

const Z_MIN = -15, Z_MAX = 225;
// The rider's own strip (x -1..-3) stays empty, like a bike filtering along the median.
const LANES: LaneDef[] = [
  { x: -4.5, dir: 1 }, { x: -7.5, dir: 1 }, { x: -10.5, dir: 1 },
  { x: 4.5, dir: -1 }, { x: 7.5, dir: -1 }, { x: 10.5, dir: -1 },
];
export const DPR_STEPS = [1, 1.5, 2, 3];

export interface SpikeInfo { fps: number; worstMs: number; calls: number; tris: number; vehicles: number; dpr: number }

export class PerfSpike {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.05, 400);
  private readonly kit = buildVehicleKit();
  private readonly fleet: VehicleFleet;
  private readonly stepper = new FixedStepper(1 / 60);
  private readonly stats = new FrameStats(120);
  private world!: TrafficWorld;
  private canvas: HTMLCanvasElement;
  private dprIndex: number;
  private t = 0;
  private lastTris = 0;
  private requested = 0;

  constructor(canvas: HTMLCanvasElement, vehicles: number) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    const want = Math.min(window.devicePixelRatio || 1, 2);
    this.dprIndex = Math.max(0, DPR_STEPS.findIndex(d => d >= want));
    if (DPR_STEPS[this.dprIndex] > want + 0.01 && this.dprIndex > 0) this.dprIndex--;
    this.scene.background = new THREE.Color(0xc9d6da);
    this.scene.fog = new THREE.Fog(0xc9d6da, 45, 210);
    this.scene.add(new THREE.HemisphereLight(0xe8f1ff, 0x6b6257, 2.0));
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.0);
    sun.position.set(-30, 50, 20);
    this.scene.add(sun);
    buildCityStrip(this.scene, Z_MIN, Z_MAX);
    this.fleet = new VehicleFleet(this.kit, 160);
    this.scene.add(this.fleet.group);
    this.setVehicles(vehicles);
    this.resize();
  }

  setVehicles(n: number): void {
    this.requested = Math.max(0, Math.min(160, Math.round(n)));
    const types = this.kit.map(k => ({ weight: k.weight, lengthM: k.lengthM, paints: k.paints }));
    this.world = buildTraffic(2026, LANES, Z_MIN, Z_MAX, this.requested, types);
    this.stats.reset();
  }

  setDprIndex(i: number): void { this.dprIndex = (i + DPR_STEPS.length) % DPR_STEPS.length; this.resize(); this.stats.reset(); }
  cycleDpr(): number { this.setDprIndex(this.dprIndex + 1); return DPR_STEPS[this.dprIndex]; }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(DPR_STEPS[this.dprIndex]);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame(dt: number): void {
    this.stats.push(dt);
    this.t += dt;
    this.stepper.advance(dt, d => stepTraffic(this.world, d));
    this.fleet.begin();
    const w = this.world;
    for (const v of w.vehicles) {
      const yaw = w.lanes[v.lane].dir > 0 ? 0 : Math.PI;
      this.fleet.add(v.type, worldX(w, v), worldZ(w, v), yaw, v.paint);
    }
    this.lastTris = this.fleet.end();
    // rider's eye: low handlebar height, a little road shake
    this.camera.position.set(-1.9 + Math.sin(this.t * 1.3) * 0.02, 1.28 + Math.sin(this.t * 7) * 0.006, 0);
    this.camera.lookAt(-1.9, 1.15, 30);
    this.renderer.render(this.scene, this.camera);
  }

  info(): SpikeInfo {
    return {
      fps: this.stats.fps, worstMs: this.stats.worstMs, calls: this.renderer.info.render.calls,
      tris: this.renderer.info.render.triangles, vehicles: this.world.vehicles.length, dpr: DPR_STEPS[this.dprIndex],
    };
  }
  get requestedVehicles(): number { return this.requested; }
  get vehicleTris(): number { return this.lastTris; }
}
