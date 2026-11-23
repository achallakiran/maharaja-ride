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
const EYE_HEIGHT = 1.62;
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
  private readonly boots: THREE.Group[] = [];
  private readonly bikeBody = new THREE.Group();
  private readonly rider = new THREE.Group();
  private readonly limbs: { thigh: THREE.Mesh; shin: THREE.Mesh; boot: THREE.Mesh; side: number }[] = [];
  private readonly wheels: THREE.Mesh[] = [];
  /** 'behind' = camera above and behind the rider so the whole bike and biker show; 'rider' = first person. */
  view: 'behind' | 'rider' = 'behind';
  private footPrev = false;
  private lastFoot = 1;
  private fallsPrev = 0;
  private vibeAt = 0;
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
    this.buildRider();
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
    // lower legs + boots that swing in when a foot goes down (index 0 = rider's left, +x)
    const denim = new THREE.MeshLambertMaterial({ color: 0x2f4a78 }), leather = new THREE.MeshLambertMaterial({ color: 0x1b1b1d }), sole = new THREE.MeshLambertMaterial({ color: 0x3a3a3c });
    for (const side of [1, -1]) {
      const g = new THREE.Group();
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), denim); shin.position.set(0, 0.36, 0);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.42), leather); boot.position.set(0, 0.02, 0.07);
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.05, 0.44), sole); sl.position.set(0, -0.08, 0.07);
      g.add(shin, boot, sl);
      g.userData.side = side;
      g.visible = false;
      this.rig.add(g);
      this.boots.push(g);
    }
  }

  toggleView(): void { this.view = this.view === 'behind' ? 'rider' : 'behind'; }

  private static limb(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    m.position.copy(a).addScaledVector(d, 0.5);
    m.scale.y = len;
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.divideScalar(len || 1));
  }

  /** The rest of the bike (wheels, seat, fork, lights) and the biker, seen in the 'behind' view. */
  private buildRider(): void {
    const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c });
    const box = (w: number, h: number, l: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m); o.position.set(x, y, z); parent.add(o); return o;
    };
    const tyre = mat(0x151517), rim = mat(0x9a9ca0), steel = mat(0x55575c), seat = mat(0x1d1d20), tail = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    const wheel = (z: number) => {
      const g = new THREE.Group(); g.position.set(0, 0.34, z);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.14, 14).rotateZ(Math.PI / 2), tyre);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.16, 10).rotateZ(Math.PI / 2), rim);
      const hub = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.06), steel);
      g.add(t, r, hub);
      this.bikeBody.add(g); this.wheels.push(t as THREE.Mesh); (t as THREE.Mesh).userData.hub = hub;
      return g;
    };
    wheel(-0.78); wheel(0.78);
    box(0.34, 0.06, 0.62, steel, 0, 0.7, -0.78, this.bikeBody);        // rear mudguard
    box(0.34, 0.1, 0.62, seat, 0, 0.82, -0.3, this.bikeBody);          // seat
    box(0.1, 0.08, 0.04, tail, 0, 0.72, -1.12, this.bikeBody);         // tail light
    box(0.12, 0.18, 0.7, steel, 0.24, 0.32, -0.45, this.bikeBody);     // exhaust
    box(0.07, 0.62, 0.07, steel, 0.17, 0.62, 0.74, this.bikeBody);     // fork legs
    box(0.07, 0.62, 0.07, steel, -0.17, 0.62, 0.74, this.bikeBody);
    box(0.22, 0.18, 0.1, mat(0xf4e9b8), 0, 1.02, 0.98, this.bikeBody); // headlight
    this.bikeBody.visible = true;
    this.rig.add(this.bikeBody);

    const jacket = mat(0x1f2f55), helmet = mat(0xe9e7e0), stripe = mat(0xc02a2a), jeans = mat(0x2f4a78), boots = mat(0x1a1a1c), glove = mat(0x222224), visor = mat(0x2a3440);
    const R = this.rider;
    box(0.46, 0.62, 0.3, jacket, 0, 1.28, -0.12, R).rotation.x = 0.32;      // torso leaning toward the bars
    box(0.3, 0.3, 0.34, helmet, 0, 1.72, 0.0, R);                            // helmet
    box(0.31, 0.06, 0.35, stripe, 0, 1.78, 0.0, R);
    box(0.24, 0.1, 0.06, visor, 0, 1.7, 0.17, R);
    box(0.34, 0.2, 0.28, jeans, 0, 0.98, -0.25, R);                          // hips on the seat
    for (const side of [1, -1]) {
      // arms: shoulder -> bar grip (they follow the bars' general position)
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.12), jacket); R.add(arm);
      Game.limb(arm, new THREE.Vector3(side * 0.27, 1.42, 0.0), new THREE.Vector3(side * 0.34, 1.07, 0.58));
      box(0.14, 0.12, 0.16, glove, side * 0.34, 1.05, 0.62, R);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1, 0.18), jeans), shin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1, 0.16), jeans);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.34), boots);
      R.add(thigh, shin, boot);
      this.limbs.push({ thigh, shin, boot, side });
    }
    this.rig.add(R);
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
      stepBike(this.bike, input, s => this.loop.kappaAt(s), this.loop.length, step, (s, d) => { const x = this.surface.sample(s, d); return { h: x.p ?? x.h, kind: x.kind }; });
      stepEngine(this.engine, this.bike.v, input.throttle, step);
    });
    this.stream.update(this.bike.s);
    this.updatePose();
    this.audio?.update(this.engine.rpm, this.engine.load, this.bike.v, input.horn);
    this.audio?.surface(this.bike.surface, this.bike.v);
    const b = this.bike;
    if (b.thud > 0) { this.audio?.thud(b.thud, b.surface); this.buzz(Math.round(25 + b.thud * 70)); b.thud = 0; }
    const down = b.foot !== 0 || b.footBoth;
    if (down && !this.footPrev) { this.audio?.foot(b.surface); this.buzz(18); }
    this.footPrev = down;
    if (b.falls !== this.fallsPrev) { this.fallsPrev = b.falls; this.buzz(180); }
    if (Math.abs(b.wob) > 0.15 && performance.now() - this.vibeAt > 140) { this.vibeAt = performance.now(); this.buzz(10); }
    this.renderer.render(this.scene, this.camera);
  }

  private poseRider(): void {
    const b = this.bike, A = new THREE.Vector3(), K = new THREE.Vector3(), F = new THREE.Vector3(), H = new THREE.Vector3();
    // wheels spin with the road
    for (const w of this.wheels) w.rotation.x = b.odo / 0.34;
    for (const l of this.limbs) {
      if (b.foot !== 0) this.lastFoot = b.foot;
      const amt = b.footAmt * (b.footBoth || this.lastFoot === -l.side ? 1 : 0);
      H.set(l.side * 0.2, 0.98, -0.2);
      // riding: knee forward against the tank, boot on the peg. dabbing: the boot reaches the ground out to the side.
      K.set(l.side * (0.27 + 0.2 * amt), 0.86 - 0.08 * amt, 0.3 + 0.1 * amt);
      F.set(l.side * (0.27 + 0.45 * amt), 0.3 * (1 - amt) - b.y * amt, 0.0 + 0.22 * amt);
      Game.limb(l.thigh, H, K); Game.limb(l.shin, K, F);
      l.boot.position.set(F.x, F.y + 0.02, F.z + 0.1);
    }
    A.set(0, 0, 0);
  }

  private updatePose(): void {
    const b = this.bike, r = this.loop.sample(b.s), t = this.v;
    const px = r.x - r.fz * b.d, pz = r.z + r.fx * b.d;
    const phi = Math.atan2(r.fx, r.fz) - b.psi;
    const cp = Math.cos(b.pitch), sp = Math.sin(b.pitch);
    t.f.set(Math.sin(phi) * cp, sp, Math.cos(phi) * cp);
    t.r.set(-Math.cos(phi), 0, Math.sin(phi));
    // whole bike rolls with the lean...
    const lean = b.lean + b.bal + b.tip;
    t.up.set(0, Math.cos(lean), 0).addScaledVector(t.r, Math.sin(lean));
    t.left.crossVectors(t.up, t.f);
    t.up.crossVectors(t.f, t.left);
    this.rig.matrix.makeBasis(t.left, t.up, t.f).setPosition(px, b.y, pz);
    this.rig.matrixWorldNeedsUpdate = true;
    this.bars.rotation.y = -(b.steer + b.wob * 0.9) * 0.38;
    const chase = this.view === 'behind';
    this.bikeBody.visible = this.rider.visible = chase;
    if (chase) this.poseRider();
    for (const g of this.boots) {
      const side = g.userData.side as number; // +1 = left of the rider
      const both = b.footBoth;
      if (b.foot !== 0) this.lastFoot = b.foot;
      const amt = b.footAmt * (both || this.lastFoot === -side ? 1 : 0);
      g.visible = amt > 0.03 && !chase;
      // stylised: the planted leg reaches out ahead and to the side so it is in the lower corner of the view
      g.position.set(side * (0.5 + 0.35 * amt), -0.5 + 1.0 * amt, -0.7 + 1.75 * amt);
      g.rotation.set(0.25 * amt, side * -0.25, side * -0.5 * amt);
    }

    // ...the rider's head leans only half as much and looks into the turn
    const phiC = phi - clamp(b.yawRate * 0.16, -0.22, 0.22);
    t.fc.set(Math.sin(phiC), 0, Math.cos(phiC));
    t.rc.set(-Math.cos(phiC), 0, Math.sin(phiC));
    const camLean = b.lean * 0.5 + b.bal * 0.7 + b.tip * 0.9 + this.lastFoot * 0.05 * b.footAmt;
    t.upc.set(0, Math.cos(camLean), 0).addScaledVector(t.rc, Math.sin(camLean));
    t.eye.set(px, b.y * 1.5 - 0.07 * b.footAmt - Math.abs(b.tip) * 0.35, pz).addScaledVector(t.upc, EYE_HEIGHT);
    t.eye.y += Math.sin(b.odo * 2.3) * 0.004 * (b.v / 20) + Math.sin(b.odo * 5.1) * 0.0025 * (b.v / 20) + b.hit * 0.03 * Math.sin(b.odo * 23);
    if (chase) {
      // above and behind the rider; leans a little with the bike, lags a little into turns
      const cl = b.lean * 0.45 + b.bal * 0.6 + b.tip * 0.8;
      t.upc.set(0, Math.cos(cl), 0).addScaledVector(t.rc, Math.sin(cl));
      t.eye.set(px, b.y * 0.8, pz).addScaledVector(t.fc, -3.9 - b.v * 0.02).addScaledVector(t.upc, 2.6).addScaledVector(t.rc, -Math.sin(b.lean) * 0.4);
      t.eye.y += b.hit * 0.03 * Math.sin(b.odo * 23);
      this.camera.position.copy(t.eye);
      this.camera.up.copy(t.upc);
      t.tmp.set(px, b.y * 0.8 + 0.7, pz).addScaledVector(t.fc, 5);
      this.camera.lookAt(t.tmp);
    } else {
    this.camera.position.copy(t.eye);
    this.camera.up.copy(t.upc);
    t.tmp.copy(t.eye).addScaledVector(t.fc, 20);
    t.tmp.y -= 1.9 - b.pitch * 12;
    this.camera.lookAt(t.tmp);
    }
    const fov = (chase ? 62 : 70) + (b.v / 24) * 9;
    if (Math.abs(fov - this.fov) > 0.05) { this.fov = fov; this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    this.ground.position.set(px, -2, pz);
    this.sky.position.copy(t.eye);
    this.sun.position.set(px - 80, 120, pz + 50);
    this.sun.target.position.set(px, 0, pz);
  }

  private buzz(ms: number): void {
    try { if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; navigator.vibrate?.(ms); } catch { /* not supported */ }
  }

  info(): RideInfo {
    const near = this.loop.nearMilestone(this.bike.s);
    return { kmh: kmh(this.bike.v), km: this.bike.odo / 1000, place: near ? near.short : '', s: this.bike.s, d: this.bike.d, fps: this.stats.fps, chunks: this.stream.chunkCountAlive };
  }

  get input(): BikeInput { return this.lastInput; }
}
