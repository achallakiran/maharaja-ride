// Draws many voxel vehicles with a handful of draw calls: per vehicle type one InstancedMesh for the paintable
// body (per-instance paint colour) and one for everything else, plus a single instanced blob shadow.
import * as THREE from 'three';
import { meshVoxels, type MeshData, type RGB } from '../voxel/mesher.ts';
import { K, PALETTE_HEX, VOXEL_M, type VehicleSpec } from '../voxel/vehicles.ts';

export function linearPalette(): RGB[] {
  return PALETTE_HEX.map(h => { const c = new THREE.Color(h); return [c.r, c.g, c.b] as const; });
}

export function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

interface Part { body: THREE.InstancedMesh; rest: THREE.InstancedMesh; count: number; tris: number }

export class VehicleFleet {
  readonly group = new THREE.Group();
  private readonly parts: Part[] = [];
  private readonly shadows: THREE.InstancedMesh;
  private shadowCount = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly specs: readonly VehicleSpec[];
  /** Triangles in one copy of each vehicle type (for budgeting). */
  readonly trisPerType: number[] = [];

  constructor(specs: readonly VehicleSpec[], capacity: number) {
    this.specs = specs;
    const palette = linearPalette();
    // Paint is applied per instance, so the BODY colour inside the mesh is plain white.
    const bodyPalette = palette.map((c, i) => (i === K.BODY ? ([1, 1, 1] as const) : c));
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const spec of specs) {
      const body = meshVoxels(spec.grid, bodyPalette, { voxel: VOXEL_M, filter: k => k === K.BODY });
      const rest = meshVoxels(spec.grid, palette, { voxel: VOXEL_M, filter: k => k !== K.BODY });
      const bm = new THREE.InstancedMesh(toGeometry(body), material, capacity);
      const rm = new THREE.InstancedMesh(toGeometry(rest), material, capacity);
      for (const m of [bm, rm]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(m); }
      const tris = (body.indices.length + rest.indices.length) / 3;
      this.trisPerType.push(tris);
      this.parts.push({ body: bm, rest: rm, count: 0, tris });
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }), capacity * 2);
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.shadows);
  }

  begin(): void {
    for (const p of this.parts) p.count = 0;
    this.shadowCount = 0;
  }

  add(type: number, x: number, z: number, yaw: number, paint: number): void {
    const p = this.parts[type], spec = this.specs[type];
    const i = p.count++;
    this.dummy.position.set(x, 0, z);
    this.dummy.rotation.set(0, yaw, 0);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();
    p.body.setMatrixAt(i, this.dummy.matrix);
    p.body.setColorAt(i, this.color.setHex(paint));
    p.rest.setMatrixAt(i, this.dummy.matrix);
    this.dummy.position.set(x, 0.03, z);
    this.dummy.scale.set(spec.widthM * 1.12, 1, spec.lengthM * 1.06);
    this.dummy.updateMatrix();
    this.shadows.setMatrixAt(this.shadowCount++, this.dummy.matrix);
  }

  end(): number {
    let tris = 0;
    for (const p of this.parts) {
      p.body.count = p.rest.count = p.count;
      p.body.instanceMatrix.needsUpdate = p.rest.instanceMatrix.needsUpdate = true;
      if (p.body.instanceColor) p.body.instanceColor.needsUpdate = true;
      tris += p.count * p.tris;
    }
    this.shadows.count = this.shadowCount;
    this.shadows.instanceMatrix.needsUpdate = true;
    return tris;
  }

  dispose(): void {
    this.group.traverse(o => { if (o instanceof THREE.InstancedMesh) { o.geometry.dispose(); o.dispose(); } });
  }
}
