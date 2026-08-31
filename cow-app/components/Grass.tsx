"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useCowStore } from "@/lib/store";
import { GRASS, REGROW_MS } from "@/lib/world";

/** Blade layout for one tuft — fixed, so tufts don't shimmer between frames. */
const BLADES = [
  { x: 0, z: 0, h: 0.42, tilt: 0.0, lean: 0.0 },
  { x: 0.11, z: 0.05, h: 0.34, tilt: 0.25, lean: 0.9 },
  { x: -0.1, z: 0.07, h: 0.37, tilt: 0.22, lean: -0.7 },
  { x: 0.05, z: -0.12, h: 0.3, tilt: 0.3, lean: 2.4 },
  { x: -0.07, z: -0.09, h: 0.33, tilt: 0.18, lean: -2.1 },
  { x: 0.15, z: -0.03, h: 0.26, tilt: 0.35, lean: 1.6 },
];

export default function GrassPatches() {
  const eaten = useCowStore((s) => s.grassEatenAt);
  const nearGrass = useCowStore((s) => s.nearGrass);

  return (
    <group>
      {GRASS.map((spot) => (
        <Tuft
          key={spot.id}
          x={spot.x}
          z={spot.z}
          id={spot.id}
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
  eatenAt,
  highlighted,
}: {
  x: number;
  z: number;
  id: number;
  eatenAt: number | null;
  highlighted: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);

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
      groupRef.current.scale.set(1, grown, 1);
      groupRef.current.rotation.z = Math.sin(t * 1.4 + x) * 0.06; // breeze
    }
    if (ringRef.current) {
      const on = highlighted && eatenAt === null;
      const s = on ? 1 + Math.sin(t * 5) * 0.06 : 0.001;
      ringRef.current.scale.set(s, s, s);
    }
  });

  return (
    <group position={[x, 0, z]}>
      {/* the "you can eat this" marker on the ground */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.42, 0.55, 24]} />
        <meshBasicMaterial color="#ffe66d" transparent opacity={0.85} />
      </mesh>

      <group ref={groupRef}>
        {BLADES.map((b, i) => (
          <mesh
            key={i}
            position={[b.x, b.h / 2, b.z]}
            rotation={[b.tilt * Math.cos(b.lean), b.lean, b.tilt * Math.sin(b.lean)]}
            castShadow
          >
            <coneGeometry args={[0.055, b.h, 4]} />
            <meshStandardMaterial color={i % 2 === 0 ? "#4f9a34" : "#5fb03d"} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
