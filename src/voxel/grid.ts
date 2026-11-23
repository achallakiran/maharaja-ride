// Dense voxel grid of palette indices (0 = empty). Axes: x = width, y = up, z = length (front is +z).
// Pure data: no three.js, so models are unit-testable in Node.

export class VoxelGrid {
  readonly data: Uint8Array;
  readonly w: number;
  readonly h: number;
  readonly l: number;
  /** Number of set() calls that fell outside the grid (a builder bug; tests assert this stays 0). */
  clipped = 0;

  constructor(w: number, h: number, l: number) {
    this.w = w; this.h = h; this.l = l;
    this.data = new Uint8Array(w * h * l);
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.w && y < this.h && z < this.l;
  }
  private index(x: number, y: number, z: number): number { return (z * this.h + y) * this.w + x; }

  get(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.data[this.index(x, y, z)] : 0;
  }
  set(x: number, y: number, z: number, k: number): void {
    if (!this.inside(x, y, z)) { this.clipped++; return; }
    this.data[this.index(x, y, z)] = k;
  }
  /** Inclusive box. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, k: number): void {
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, z, k);
  }
  /** A wheel: a disc in the y-z plane, `x0..x1` thick, centre (cy, cz) in voxel units, radius r. */
  wheel(x0: number, x1: number, cy: number, cz: number, r: number, tire: number, rim: number): void {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        const d = Math.hypot(y + 0.5 - cy, z + 0.5 - cz);
        if (d > r) continue;
        for (let x = x0; x <= x1; x++) {
          const outer = x === x0 || x === x1;
          this.set(x, y, z, outer && d <= r * 0.5 ? rim : tire);
        }
      }
    }
  }
  count(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i]) n++;
    return n;
  }
  countOf(k: number): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] === k) n++;
    return n;
  }
  /** Number of 26-connected solid components (a model should be exactly 1: nothing floating). */
  components(): number {
    const seen = new Uint8Array(this.data.length);
    let comps = 0;
    const stack: number[] = [];
    for (let z = 0; z < this.l; z++) for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = this.index(x, y, z);
      if (!this.data[i] || seen[i]) continue;
      comps++;
      seen[i] = 1;
      stack.push(x, y, z);
      while (stack.length) {
        const cz = stack.pop()!, cy = stack.pop()!, cx = stack.pop()!;
        for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy, nz = cz + dz;
          if (!this.inside(nx, ny, nz)) continue;
          const j = this.index(nx, ny, nz);
          if (this.data[j] && !seen[j]) { seen[j] = 1; stack.push(nx, ny, nz); }
        }
      }
    }
    return comps;
  }
  /** Tight bounding box of solid voxels, or null if empty. */
  bounds(): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } | null {
    let b: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } | null = null;
    for (let z = 0; z < this.l; z++) for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!this.data[this.index(x, y, z)]) continue;
      if (!b) b = { x0: x, x1: x, y0: y, y1: y, z0: z, z1: z };
      else { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z); }
    }
    return b;
  }
}
