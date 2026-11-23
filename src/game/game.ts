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
/** How much each surface shakes the view and the bars. */
const ROUGH: Record<string, number> = { broken: 0.5, pothole: 0.9, crack: 0.9, water: 0.35, mud: 0.55, sand: 0.3, shoulder: 0.5, bump: 0.5 };
const smoothstep = (a: number, c: number, x: number) => { const t = clamp((x - a) / (c - a), 0, 1); return t * t * (3 - 2 * t); };
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
  private upper!: THREE.Group;
  private readonly upperHome = new THREE.Vector3();
  private readonly limbs: { thigh: THREE.Mesh; shin: THREE.Mesh; boot: THREE.Mesh; side: number }[] = [];
  private readonly wheels: THREE.Mesh[] = [];
  /** Camera perspectives, from far to close: the whole bike, the bike and biker, over the shoulder, first person. */
  static readonly VIEWS = ['far', 'mid', 'close', 'rider'] as const;
  view: (typeof Game.VIEWS)[number] = 'mid';
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

  toggleView(): void { this.view = Game.VIEWS[(Game.VIEWS.indexOf(this.view) + 1) % Game.VIEWS.length]; }

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
    const R = new THREE.Group(); // upper body, hinged at the hips so it can lean over the planted foot
    R.position.set(0, 0.98, -0.2);
    this.rider.add(R);
    this.upperHome.set(0, 0.98, -0.2);
    const U = new THREE.Group(); U.position.set(0, -0.98, 0.2); R.add(U);
    box(0.46, 0.62, 0.3, jacket, 0, 1.28, -0.12, U).rotation.x = 0.32;      // torso leaning toward the bars
    box(0.3, 0.3, 0.34, helmet, 0, 1.72, 0.0, U);                            // helmet
    box(0.31, 0.06, 0.35, stripe, 0, 1.78, 0.0, U);
    box(0.24, 0.1, 0.06, visor, 0, 1.7, 0.17, U);
    box(0.34, 0.2, 0.28, jeans, 0, 0.98, -0.25, U);                          // hips on the seat
    for (const side of [1, -1]) {
      // arms: shoulder -> bar grip (they follow the bars' general position)
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.12), jacket); U.add(arm);
      Game.limb(arm, new THREE.Vector3(side * 0.27, 1.42, 0.0), new THREE.Vector3(side * 0.34, 1.07, 0.58));
      box(0.14, 0.12, 0.16, glove, side * 0.34, 1.05, 0.62, U);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1, 0.18), jeans), shin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1, 0.16), jeans);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.34), boots);
      this.rider.add(thigh, shin, boot);
      this.limbs.push({ thigh, shin, boot, side });
    }
    this.upper = R;
    this.rider.matrixAutoUpdate = false;
    this.scene.add(this.rider);
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
    if ((ROUGH[b.surface] ?? 0) > 0.4 && b.v > 6 && performance.now() - this.vibeAt > 160) { this.vibeAt = performance.now(); this.buzz(8); }
    this.renderer.render(this.scene, this.camera);
  }

  /** voxel-bike's fall: the rider is thrown clear and tumbles, lies there, gets up, runs back to the bike and swings back on. */
  private poseFall(r: { fx: number; fz: number }, px: number, pz: number, phi: number): void {
    const b = this.bike, age = b.fallT, e = (a: number, c: number) => smoothstep(a, c, age);
    const side = b.fallDir; // +1 = bike went down to the right
    const separate = e(0, 0.18), tumble = clamp(age / 0.86, 0, 1), standing = e(1.02, 1.39), mount = e(2.64, 2.85);
    const run = clamp((age - 1.39) / 1.1, 0, 1), runT = run * run * (3 - 2 * run);
    const travel = e(0.04, 0.88) * (1 - runT);
    const roll = age < 0.86 ? Math.PI * 2.5 * e(0.06, 0.86) : (Math.PI / 2) * (1 - e(1.02, 1.39));
    const arc = Math.sin(tumble * Math.PI) * 0.52;
    const stride = e(1.39, 1.51) * (1 - e(2.31, 2.49));
    const bob = Math.abs(Math.sin((age - 1.39) * Math.PI * 8.5)) * stride * 0.08;
    // bike-local offsets: ahead of the bike and out to the side the bike fell on
    const fwd = 3.25 * travel, lat = -side * 1.26 * travel;
    const sy = Math.sin(phi), cy = Math.cos(phi);
    const wx = px + sy * fwd, wz = pz + cy * fwd;
    // left of the bike in world = (cos phi, -sin phi) (rider's +x)
    const lx = cy, lz = -sy;
    const cxw = wx + lx * lat, czw = wz + lz * lat;
    const gy = this.surface.height(b.s + fwd, b.d) ;
    const lying = (1 - standing) * 0.32 + standing * 0.9;
    const center = new THREE.Vector3(cxw, Math.max(gy, 0) + lying + arc + bob, czw);
    const toBike = Math.atan2(px - cxw, pz - czw);
    const heading = phi + Math.atan2(Math.sin(toBike - phi), Math.cos(toBike - phi)) * e(1.1, 1.39) * (1 - mount) * (run > 0 ? 1 : 0);
    const free = new THREE.Matrix4().compose(center, new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, heading, side * -0.34 * (1 - standing), 'YXZ')), new THREE.Vector3(1, 1, 1));
    free.multiply(new THREE.Matrix4().makeTranslation(0, -0.9, 0));
    // blend between "on the bike" and "free" at the start (separate) and end (mount)
    const w = separate * (1 - mount);
    const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
    this.rig.matrix.decompose(pa, qa, sa); free.decompose(pb, qb, sb);
    pa.lerp(pb, w); qa.slerp(qb, w);
    this.rider.matrix.compose(pa, qa, new THREE.Vector3(1, 1, 1));
    void r;
  }

  private poseRider(): void {
    const b = this.bike, A = new THREE.Vector3(), K = new THREE.Vector3(), F = new THREE.Vector3(), H = new THREE.Vector3();
    // wheels spin with the road
    for (const w of this.wheels) w.rotation.x = b.odo / 0.34;
    for (const l of this.limbs) {
      if (b.foot !== 0) this.lastFoot = b.foot;
      const age = b.fallT, running = age > 1.39 && age < 2.49;
      const walking = b.footBoth || running, one = this.lastFoot === -l.side;
      const amt = running ? 1 : b.footAmt * (walking || one ? 1 : 0);
      H.set(l.side * 0.22, 0.98, -0.2);
      // riding: an inverted L - the thigh runs forward to the knee beside the tank, the shin drops straight to the peg.
      // one foot down: the shin slants out so the boot reaches the ground. walking: both feet scuff the ground.
      K.set(l.side * (0.29 + 0.05 * amt), 0.95 - 0.07 * amt, 0.32 + 0.08 * amt);
      const ground = -b.y;
      let fx = 0.29 + 0.12 * amt, fy = 0.34 * (1 - amt) + ground * amt, fz = 0.32 - 0.1 * amt;
      if (walking) {
        const ph = (running ? (age - 1.39) * Math.PI * 8.5 : b.walk) + (l.side > 0 ? 0 : Math.PI);
        fz = 0.15 + 0.4 * Math.sin(ph);
        fy = ground + Math.max(0, Math.cos(ph)) * 0.16; // the swinging foot lifts
      }
      F.set(l.side * fx, fy, fz);
      Game.limb(l.thigh, H, K); Game.limb(l.shin, K, F);
      l.boot.position.set(F.x, F.y + 0.02, F.z + 0.1);
    }
    // lean over the planted foot
    const planted = b.footBoth || b.fallT > 0 ? 0 : this.lastFoot * b.footAmt;
    this.upper.rotation.z += (planted * 0.42 - this.upper.rotation.z) * 0.25;
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
    const lean = b.lean + b.tip + (b.footBoth ? 0 : this.lastFoot * b.footAmt * 0.1);
    t.up.set(0, Math.cos(lean), 0).addScaledVector(t.r, Math.sin(lean));
    t.left.crossVectors(t.up, t.f);
    t.up.crossVectors(t.f, t.left);
    this.rig.matrix.makeBasis(t.left, t.up, t.f).setPosition(px, b.y, pz);
    this.rig.matrixWorldNeedsUpdate = true;
    const shake = (ROUGH[b.surface] ?? 0) * Math.min(1, b.v / 14);
    this.bars.rotation.y = -b.steer * 0.38 + Math.sin(b.odo * 29) * 0.05 * shake;
    const chase = this.view !== 'rider' || b.fallT > 0;
    this.bikeBody.visible = this.rider.visible = chase;
    if (chase) { this.poseRider(); if (b.fallT > 0) this.poseFall(r, px, pz, phi); else this.rider.matrix.copy(this.rig.matrix); }
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
    const camLean = b.lean * 0.5 + b.tip * 0.5 + this.lastFoot * 0.05 * b.footAmt;
    t.upc.set(0, Math.cos(camLean), 0).addScaledVector(t.rc, Math.sin(camLean));
    t.eye.set(px, b.y * 1.5 - 0.07 * b.footAmt - Math.abs(b.tip) * 0.35, pz).addScaledVector(t.upc, EYE_HEIGHT);
    t.eye.y += Math.sin(b.odo * 2.3) * 0.004 * (b.v / 20) + Math.sin(b.odo * 5.1) * 0.0025 * (b.v / 20) + b.hit * 0.03 * Math.sin(b.odo * 23) + shake * 0.02 * Math.sin(b.odo * 41);
    if (chase) {
      // above and behind the rider; leans a little with the bike, lags a little into turns
      const cam = { far: { back: 3.9, up: 2.6, look: 0.7, ahead: 5 }, mid: { back: 2.6, up: 1.95, look: 0.9, ahead: 5 }, close: { back: 1.8, up: 1.9, look: 1.0, ahead: 5 } }[(this.view === 'rider' ? 'mid' : this.view) as 'far' | 'mid' | 'close'];
      const cl = b.lean * 0.45 + b.tip * 0.2;
      t.upc.set(0, Math.cos(cl), 0).addScaledVector(t.rc, Math.sin(cl));
      t.eye.set(px, b.y * 0.8, pz).addScaledVector(t.fc, -cam.back - b.v * 0.015).addScaledVector(t.upc, cam.up).addScaledVector(t.rc, -Math.sin(b.lean) * 0.4);
      t.eye.y += b.hit * 0.03 * Math.sin(b.odo * 23);
      this.camera.position.copy(t.eye);
      this.camera.up.copy(t.upc);
      t.tmp.set(px, b.y * 0.8 + cam.look, pz).addScaledVector(t.fc, cam.ahead);
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
