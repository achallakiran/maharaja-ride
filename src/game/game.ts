// The ride: owns the renderer, scene, bike simulation and the first-person rig.
import * as THREE from 'three';
import { bangaloreLoop } from '../route/bangalore.ts';
import type { RoadLoop } from '../route/loop.ts';
import { newBike, stepBike, kmh, type BikeInput, type BikeState } from '../sim/bike.ts';
import { newEngine, stepEngine, type EngineState } from '../audio/engine-model.ts';
import { FixedStepper } from '../sim/stepper.ts';
import { FrameStats } from '../sim/frame-stats.ts';
import { roadSurface } from '../world/surface.ts';
import { RoadStream } from '../render/road-stream.ts';
import { linearPalette, toGeometry } from '../render/vehicle-fleet.ts';
import { meshVoxels } from '../voxel/mesher.ts';
import { buildCockpit, COCKPIT_VOXEL, STEER_PIVOT } from '../voxel/cockpit.ts';
import { K } from '../voxel/vehicles.ts';
import type { RideAudio } from '../audio/audio.ts';

export const START_S = 150;
const EYE_HEIGHT = 1.30;
const TANK_PAINT = 0x8c1d2b; // royal maroon

export interface RideInfo { kmh: number; km: number; place: string; s: number; d: number; fps: number; chunks: number }

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 700);
  readonly loop: RoadLoop = bangaloreLoop();
  readonly bike: BikeState = newBike(START_S);
  readonly engine: EngineState = newEngine();
  readonly stats = new FrameStats(60);
  private readonly stepper = new FixedStepper(1 / 60);
  private readonly stream: RoadStream;
  private readonly rig = new THREE.Group();
  private readonly bars = new THREE.Group();
  private readonly ground: THREE.Mesh;
  private readonly sky: THREE.Mesh;
  private readonly sun: THREE.DirectionalLight;
  private readonly canvas: HTMLCanvasElement;
  private fov = 72;
  private readonly surface = roadSurface(this.loop);
  private lastInput: BikeInput = { steer: 0, throttle: 0, brake: 0, horn: false };
  private readonly v = { f: new THREE.Vector3(), r: new THREE.Vector3(), up: new THREE.Vector3(), left: new THREE.Vector3(), tmp: new THREE.Vector3(), eye: new THREE.Vector3(), fc: new THREE.Vector3(), rc: new THREE.Vector3(), upc: new THREE.Vector3() };

  private readonly audio: RideAudio | null;

  constructor(canvas: HTMLCanvasElement, audio: RideAudio | null = null) {
    this.canvas = canvas;
    this.audio = audio;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const haze = 0xd6dfdc;
    this.scene.background = new THREE.Color(haze);
    this.scene.fog = new THREE.Fog(haze, 110, 420);
    this.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x7a6e58, 2.0));
    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.2);
    this.scene.add(this.sun, this.sun.target);

    this.sky = this.makeSky();
    this.scene.add(this.sky);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8c8168 }));
    this.ground.position.y = -2;
    this.scene.add(this.ground);

    this.stream = new RoadStream(this.loop);
    this.scene.add(this.stream.group);
    this.buildCockpit();
    this.scene.add(this.rig);
    this.resize();
    this.stream.update(this.bike.s);
    this.updatePose();
  }

  private makeSky(): THREE.Mesh {
    const g = new THREE.SphereGeometry(600, 24, 12);
    const pos = g.getAttribute('position'), col: number[] = [];
    const top = new THREE.Color(0x4f86cc), mid = new THREE.Color(0xa6c6e2), hor = new THREE.Color(0xd6dfdc), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / 600;
      if (h < 0.08) c.copy(hor); else if (h < 0.4) c.copy(hor).lerp(mid, (h - 0.08) / 0.32); else c.copy(mid).lerp(top, Math.min(1, (h - 0.4) / 0.6));
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -10;
    m.frustumCulled = false;
    return m;
  }

  private buildCockpit(): void {
    const grid = buildCockpit();
    const palette = linearPalette();
    const body = new THREE.Color(TANK_PAINT);
    palette[K.BODY] = [body.r, body.g, body.b];
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const frame = new THREE.Mesh(toGeometry(meshVoxels(grid, palette, { voxel: COCKPIT_VOXEL, filter: k => k === K.BODY })), mat);
    const barsMesh = new THREE.Mesh(toGeometry(meshVoxels(grid, palette, { voxel: COCKPIT_VOXEL, filter: k => k !== K.BODY })), mat);
    for (const m of [frame, barsMesh]) m.frustumCulled = false;
    // mesher centres the grid on x/z; the steering axis is at grid z = pivot, so shift to put it on the bars' axis
    const zShift = (grid.l / 2 - STEER_PIVOT.z) * COCKPIT_VOXEL;
    const baseY = 0.8, baseZ = 0.55;
    frame.position.set(0, baseY, baseZ + zShift);
    this.bars.position.set(0, 0, baseZ);
    barsMesh.position.set(0, baseY, zShift);
    this.bars.add(barsMesh);
    this.rig.add(frame, this.bars);
    this.rig.matrixAutoUpdate = false;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Advance the simulation by one rendered frame and draw it. */
  frame(dt: number, input: BikeInput): void {
    this.stats.push(dt);
    this.lastInput = input;
    this.stepper.advance(dt, step => {
      stepBike(this.bike, input, s => this.loop.kappaAt(s), this.loop.length, step, (s, d) => this.surface.sample(s, d));
      stepEngine(this.engine, this.bike.v, input.throttle, step);
    });
    this.stream.update(this.bike.s);
    this.updatePose();
    this.audio?.update(this.engine.rpm, this.engine.load, this.bike.v, input.horn);
    this.renderer.render(this.scene, this.camera);
  }

  private updatePose(): void {
    const b = this.bike, r = this.loop.sample(b.s), t = this.v;
    const px = r.x - r.fz * b.d, pz = r.z + r.fx * b.d;
    const phi = Math.atan2(r.fx, r.fz) - b.psi;
    const cp = Math.cos(b.pitch), sp = Math.sin(b.pitch);
    t.f.set(Math.sin(phi) * cp, sp, Math.cos(phi) * cp);
    t.r.set(-Math.cos(phi), 0, Math.sin(phi));
    // whole bike rolls with the lean...
    t.up.set(0, Math.cos(b.lean), 0).addScaledVector(t.r, Math.sin(b.lean));
    t.left.crossVectors(t.up, t.f);
    t.up.crossVectors(t.f, t.left);
    this.rig.matrix.makeBasis(t.left, t.up, t.f).setPosition(px, b.y, pz);
    this.rig.matrixWorldNeedsUpdate = true;
    this.bars.rotation.y = -b.steer * 0.38;

    // ...the rider's head leans only half as much and looks into the turn
    const phiC = phi - clamp(b.yawRate * 0.16, -0.22, 0.22);
    t.fc.set(Math.sin(phiC), 0, Math.cos(phiC));
    t.rc.set(-Math.cos(phiC), 0, Math.sin(phiC));
    t.upc.set(0, Math.cos(b.lean * 0.5), 0).addScaledVector(t.rc, Math.sin(b.lean * 0.5));
    t.eye.set(px, b.y, pz).addScaledVector(t.upc, EYE_HEIGHT);
    t.eye.y += Math.sin(b.odo * 2.3) * 0.004 * (b.v / 20) + Math.sin(b.odo * 5.1) * 0.0025 * (b.v / 20) + b.hit * 0.03 * Math.sin(b.odo * 23);
    this.camera.position.copy(t.eye);
    this.camera.up.copy(t.upc);
    t.tmp.copy(t.eye).addScaledVector(t.fc, 20);
    t.tmp.y -= 1.0 - b.pitch * 12;
    this.camera.lookAt(t.tmp);
    const fov = 70 + (b.v / 24) * 9;
    if (Math.abs(fov - this.fov) > 0.05) { this.fov = fov; this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    this.ground.position.set(px, -2, pz);
    this.sky.position.copy(t.eye);
    this.sun.position.set(px - 80, 120, pz + 50);
    this.sun.target.position.set(px, 0, pz);
  }

  info(): RideInfo {
    const near = this.loop.nearMilestone(this.bike.s);
    return { kmh: kmh(this.bike.v), km: this.bike.odo / 1000, place: near ? near.short : '', s: this.bike.s, d: this.bike.d, fps: this.stats.fps, chunks: this.stream.chunkCountAlive };
  }

  get input(): BikeInput { return this.lastInput; }
}
