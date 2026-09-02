"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useCowStore } from "@/lib/store";
import { bladeGeometry, rng } from "@/lib/geometry";
import { applySway } from "@/lib/sway";
import { glowMap } from "@/lib/textures";
import { GRASS, REGROW_MS } from "@/lib/world";

const BLADE_HEIGHT = 0.62;

/**
 * Blade layout for one tuft — generated once from a fixed seed, so every tuft is
 * the same clump and none of them shimmer between frames. The rosette is denser
 * in the middle and flops outwards at the rim, which is how a clump of grass a
 * cow has not got to yet actually grows.
 */
const CLUMP = (() => {
  const r = rng(8080);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  return Array.from({ length: 26 }, () => {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 0.6) * 0.28;
    const flop = 0.15 + (d / 0.28) * 0.75; // the outer blades lean right over
    pos.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    e.set(flop * Math.cos(a + 1.6), a + (r() - 0.5), flop * Math.sin(a + 1.6));
    q.setFromEuler(e);
    scale.set(0.8 + r() * 0.5, 0.7 + r() * 0.65, 1);
    return m.clone().compose(pos, q, scale);
  });
})();

export default function GrassPatches() {
  const eaten = useCowStore((s) => s.grassEatenAt);
  const nearGrass = useCowStore((s) => s.nearGrass);

  // One geometry and one material for all five tufts.
  const geo = useMemo(() => bladeGeometry(BLADE_HEIGHT, 0.062, 0.16, 5), []);
  const mat = useMemo(
    () =>
      applySway(
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.85,
          side: THREE.DoubleSide,
        }),
        BLADE_HEIGHT,
        0.055
      ),
    []
  );
  const glow = useMemo(() => glowMap("rgba(255,236,150,0.95)", "rgba(255,198,64,0.35)"), []);

  return (
    <group>
      {GRASS.map((spot) => (
        <Tuft
          key={spot.id}
          x={spot.x}
          z={spot.z}
          id={spot.id}
          geo={geo}
          mat={mat}
          glow={glow}
          eatenAt={eaten[spot.id]}
          highlighted={nearGrass === spot.id}
        />
      ))}
    </group>
  );
}

function Tuft({
  x,
  z,
  id,
  geo,
  mat,
  glow,
  eatenAt,
  highlighted,
}: {
  x: number;
  z: number;
  id: number;
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  glow: THREE.Texture;
  eatenAt: number | null;
  highlighted: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const markRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Eaten tufts shrink away and grow back over REGROW_MS, so the pen refills
    // itself without the player having to do anything.
    let grown = 1;
    if (eatenAt !== null) {
      const age = Date.now() - eatenAt;
      grown = Math.max(0.001, Math.min(1, (age - REGROW_MS * 0.45) / (REGROW_MS * 0.55)));
      if (age > REGROW_MS) useCowStore.getState().regrow(id);
    }

    if (groupRef.current) {
      // Regrowth comes back thin as well as short — new grass is not just a
      // smaller version of old grass.
      groupRef.current.scale.set(0.55 + grown * 0.45, grown, 0.55 + grown * 0.45);
    }
    if (markRef.current) {
      const on = highlighted && eatenAt === null;
      const s = on ? 1.15 + Math.sin(t * 4) * 0.09 : 0.001;
      markRef.current.scale.set(s, s, s);
      (markRef.current.material as THREE.MeshBasicMaterial).opacity = on
        ? 0.45 + Math.sin(t * 4) * 0.14
        : 0;
    }
  });

  return (
    <group position={[x, 0, z]}>
      {/* The "you can eat this" marker: a soft pool of light on the ground, not a
          hard ring, so it reads as a highlight rather than a UI decal. */}
      <mesh ref={markRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <planeGeometry args={[1.7, 1.7]} />
        <meshBasicMaterial map={glow} transparent depthWrite={false} opacity={0.5} />
      </mesh>

      <group ref={groupRef}>
        <instancedMesh
          ref={(mesh) => {
            if (!mesh) return;
            CLUMP.forEach((m, i) => mesh.setMatrixAt(i, m));
            mesh.instanceMatrix.needsUpdate = true;
          }}
          args={[geo, mat, CLUMP.length]}
          castShadow
        />
        {/* seed heads, so a full tuft looks worth walking over for */}
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            position={[Math.sin(i * 2.4) * 0.16, BLADE_HEIGHT * 0.86, Math.cos(i * 2.4) * 0.16]}
            rotation={[0.35, i, 0]}
            scale={[1, 2.4, 1]}
          >
            <sphereGeometry args={[0.022, 6, 5]} />
            <meshStandardMaterial color="#c8b96a" roughness={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
