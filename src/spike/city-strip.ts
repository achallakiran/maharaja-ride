// A throwaway straight strip of divided road with roadside blocks, only to give the perf spike a believable
// backdrop. The real city arrives in Phase 3.
import * as THREE from 'three';
import { mulberry32 } from '../sim/rng.ts';

export function buildCityStrip(scene: THREE.Scene, zMin: number, zMax: number): void {
  const len = zMax - zMin, cz = (zMin + zMax) / 2;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: hex }));
    m.position.set(x, y, z);
    scene.add(m);
  };
  box(300, 0.2, len + 200, 0, -0.1, cz + 40, 0x8a7f6a);      // dusty ground
  box(27, 0.04, len, 0, 0.02, cz, 0x3b3d40);                 // tarmac
  box(2, 0.3, len, 0, 0.15, cz, 0x9a968c);                   // median
  for (const side of [-1, 1]) box(4, 0.18, len, side * 15, 0.09, cz, 0x8c8a82); // footpaths

  // roadside blocks (one instanced draw call)
  const rnd = mulberry32(99);
  const items: { x: number; z: number; w: number; d: number; h: number; c: number }[] = [];
  for (const side of [-1, 1]) {
    for (let z = zMin - 10; z < zMax + 40; z += 0) {
      const d = 9 + rnd() * 9, w = 8 + rnd() * 8, h = 6 + rnd() * 24;
      items.push({ x: side * (17.5 + w / 2), z: z + d / 2, w, d, h, c: [0xc7b9a4, 0xb8a58a, 0xa9b4b8, 0xd2c6b2, 0xb98f7b, 0x9fa6a0][Math.floor(rnd() * 6)] });
      z += d + rnd() * 3;
    }
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), items.length);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  items.forEach((b, i) => {
    m.compose(new THREE.Vector3(b.x, b.h / 2, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHex(b.c));
  });
  mesh.frustumCulled = false;
  scene.add(mesh);
}
