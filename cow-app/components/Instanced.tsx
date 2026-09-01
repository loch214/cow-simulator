"use client";

import { useMemo } from "react";
import * as THREE from "three";

export interface Placement {
  pos: [number, number, number];
  rot?: [number, number, number];
  /** Uniform, or per-axis. */
  scale?: number | [number, number, number];
}

/**
 * One draw call for a crowd of identical things.
 *
 * The pen fence alone is a hundred and eleven rails, and the meadow has a couple
 * of hundred flowers; drawn one at a time that is most of a frame's budget spent
 * on scenery nobody looks at. Anything repeated more than a handful of times goes
 * through here instead.
 */
export default function InstancedGroup({
  geometry,
  material,
  items,
  castShadow = false,
  receiveShadow = false,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: Placement[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const matrices = useMemo(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    return items.map((it) => {
      p.set(...it.pos);
      e.set(...(it.rot ?? [0, 0, 0]));
      q.setFromEuler(e);
      const sc = it.scale ?? 1;
      if (typeof sc === "number") s.set(sc, sc, sc);
      else s.set(...sc);
      return m.clone().compose(p, q, s);
    });
  }, [items]);

  if (matrices.length === 0) return null;

  return (
    <instancedMesh
      ref={(mesh) => {
        if (!mesh) return;
        matrices.forEach((mat, i) => mesh.setMatrixAt(i, mat));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }}
      args={[geometry, material, matrices.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}
