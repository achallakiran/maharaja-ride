// Keeps just the road chunks (and their roadside props) around the rider alive. Everything else is freed.
import * as THREE from 'three';
import type { RoadLoop } from '../route/loop.ts';
import { buildRoadChunk, chunkCount, chunkProps, CHUNK_LEN } from '../world/road-chunk.ts';
import { meshVoxels, type MeshData, type RGB } from '../voxel/mesher.ts';
import { buildPost, buildLamp, buildTree, PROP_PALETTE_HEX, POST_VOXEL, LAMP_VOXEL, TREE_VOXEL } from '../voxel/props.ts';
import { toGeometry } from './vehicle-fleet.ts';

const BEHIND = 90, AHEAD = 380;

function propPalette(): RGB[] {
  return PROP_PALETTE_HEX.map(h => { const c = new THREE.Color(h); return [c.r, c.g, c.b] as const; });
}

export class RoadStream {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<number, THREE.Mesh>();
  private readonly roadMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly loop: RoadLoop;
  private readonly total: number;
  private key = '';
  private readonly post: THREE.InstancedMesh;
  private readonly lamp: THREE.InstancedMesh;
  private readonly trees: THREE.InstancedMesh[];
  private readonly dummy = new THREE.Object3D();
  /** Number of chunk meshes built since start (for tests / stats). */
  built = 0;

  constructor(loop: RoadLoop) {
    this.loop = loop;
    this.total = chunkCount(loop);
    const pal = propPalette(), mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const inst = (m: MeshData, cap: number) => { const o = new THREE.InstancedMesh(toGeometry(m), mat, cap); o.count = 0; o.frustumCulled = false; this.group.add(o); return o; };
    this.post = inst(meshVoxels(buildPost(), pal, { voxel: POST_VOXEL }), 300);
    this.lamp = inst(meshVoxels(buildLamp(), pal, { voxel: LAMP_VOXEL }), 120);
    this.trees = [0, 1].map(v => inst(meshVoxels(buildTree(v), pal, { voxel: TREE_VOXEL }), 300));
  }

  private wanted(s: number): number[] {
    const a = Math.floor((s - BEHIND) / CHUNK_LEN), b = Math.floor((s + AHEAD) / CHUNK_LEN);
    const out: number[] = [];
    for (let c = a; c <= b; c++) out.push(((c % this.total) + this.total) % this.total);
    return [...new Set(out)];
  }

  update(s: number): void {
    const want = this.wanted(s), key = want.join(',');
    if (key === this.key) return;
    this.key = key;
    const keep = new Set(want);
    for (const [c, mesh] of this.chunks) if (!keep.has(c)) { this.group.remove(mesh); mesh.geometry.dispose(); this.chunks.delete(c); }
    for (const c of want) if (!this.chunks.has(c)) {
      const mesh = new THREE.Mesh(toGeometry(buildRoadChunk(this.loop, c)), this.roadMat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.chunks.set(c, mesh);
      this.built++;
    }
    this.rebuildProps(want);
  }

  private rebuildProps(want: number[]): void {
    const counts = { post: 0, lamp: 0, t0: 0, t1: 0 };
    const d = this.dummy;
    for (const c of want) for (const p of chunkProps(this.loop, c)) {
      d.position.set(p.x, 0, p.z); d.rotation.set(0, p.yaw, 0);
      if (p.kind === 'post' && counts.post < 300) { d.scale.setScalar(1); d.updateMatrix(); this.post.setMatrixAt(counts.post++, d.matrix); }
      else if (p.kind === 'lamp' && counts.lamp < 120) { d.scale.setScalar(1); d.updateMatrix(); this.lamp.setMatrixAt(counts.lamp++, d.matrix); }
      else if (p.kind === 'tree') {
        const m = this.trees[p.variant % 2], n = p.variant % 2 ? counts.t1 : counts.t0;
        if (n >= 300) continue;
        d.scale.setScalar(p.scale); d.updateMatrix(); m.setMatrixAt(n, d.matrix);
        if (p.variant % 2) counts.t1++; else counts.t0++;
      }
    }
    this.post.count = counts.post; this.lamp.count = counts.lamp; this.trees[0].count = counts.t0; this.trees[1].count = counts.t1;
    for (const m of [this.post, this.lamp, ...this.trees]) m.instanceMatrix.needsUpdate = true;
  }

  get chunkCountAlive(): number { return this.chunks.size; }
}
