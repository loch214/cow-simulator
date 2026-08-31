"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useCowStore } from "@/lib/store";
import { OFFICER, STATION } from "@/lib/world";

const NAVY = "#28407a";
const NAVY_DARK = "#1b2c56";

/** Down the road from the pen. Only ever visited under protest. */
export default function PoliceStation() {
  const beaconRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (beaconRef.current) beaconRef.current.rotation.y = state.clock.elapsedTime * 2.5;
  });

  return (
    <group position={[STATION.x, 0, STATION.z]}>
      {/* main block */}
      <mesh position={[0, 1.6, 0]} castShadow receiveShadow>
        <boxGeometry args={[4.2, 3.2, 5]} />
        <meshStandardMaterial color="#e6e2d8" />
      </mesh>
      {/* navy band along the front */}
      <mesh position={[-2.12, 2.55, 0]} castShadow>
        <boxGeometry args={[0.06, 0.55, 5.02]} />
        <meshStandardMaterial color={NAVY} />
      </mesh>
      {/* roof */}
      <mesh position={[0, 3.35, 0]} castShadow>
        <boxGeometry args={[4.6, 0.3, 5.4]} />
        <meshStandardMaterial color={NAVY_DARK} />
      </mesh>

      {/* doorway facing the pen */}
      <mesh position={[-2.12, 0.95, 0]}>
        <boxGeometry args={[0.08, 1.9, 1.2]} />
        <meshStandardMaterial color="#3c3428" />
      </mesh>
      <mesh position={[-2.18, 0.95, 0]}>
        <boxGeometry args={[0.06, 2.05, 1.35]} />
        <meshStandardMaterial color={NAVY} />
      </mesh>

      {/* windows */}
      {[-1.5, 1.5].map((z) => (
        <mesh key={z} position={[-2.14, 1.9, z]}>
          <boxGeometry args={[0.06, 0.9, 0.9]} />
          <meshStandardMaterial color="#8fb6d6" />
        </mesh>
      ))}

      {/* shield badge over the door */}
      <mesh position={[-2.2, 2.55, 0]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.5, 0.5, 0.06]} />
        <meshStandardMaterial color="#f0c419" />
      </mesh>
      <mesh position={[-2.24, 2.55, 0]}>
        <sphereGeometry args={[0.13, 12, 12]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>

      {/* rotating beacon on the roof */}
      <group ref={beaconRef} position={[0, 3.7, 0]}>
        <mesh>
          <cylinderGeometry args={[0.22, 0.22, 0.3, 12]} />
          <meshStandardMaterial color="#2f6fd0" emissive="#2f6fd0" emissiveIntensity={0.7} />
        </mesh>
        <mesh position={[0.18, 0, 0]}>
          <boxGeometry args={[0.12, 0.28, 0.1]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.6} />
        </mesh>
      </group>

      <Officer />
    </group>
  );
}

/** Stands outside the door. Nods along, does nothing. */
function Officer() {
  const rootRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const armRef = useRef<THREE.Group>(null);
  const inCutscene = useCowStore((s) => s.inCutscene);

  // positioned relative to the station group
  const px = OFFICER.x - STATION.x;
  const pz = OFFICER.z - STATION.z;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (rootRef.current) rootRef.current.position.y = Math.sin(t * 1.6) * 0.015;
    if (headRef.current) {
      // slow, unimpressed nodding while the cow makes its case
      headRef.current.rotation.x = inCutscene ? Math.sin(t * 2.2) * 0.12 : Math.sin(t * 0.8) * 0.03;
      headRef.current.rotation.y = inCutscene ? 0 : Math.sin(t * 0.5) * 0.2;
    }
    if (armRef.current) {
      armRef.current.rotation.x = inCutscene ? -0.6 + Math.sin(t * 1.3) * 0.08 : 0;
    }
  });

  return (
    <group position={[px, 0, pz]} rotation={[0, -Math.PI / 2, 0]}>
      <group ref={rootRef}>
        {/* legs */}
        <mesh position={[-0.11, 0.35, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.09, 0.7, 8]} />
          <meshStandardMaterial color="#2a2a35" />
        </mesh>
        <mesh position={[0.11, 0.35, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.09, 0.7, 8]} />
          <meshStandardMaterial color="#2a2a35" />
        </mesh>
        {/* torso */}
        <mesh position={[0, 1.05, 0]} castShadow>
          <boxGeometry args={[0.5, 0.75, 0.3]} />
          <meshStandardMaterial color={NAVY} />
        </mesh>
        {/* notepad arm — comes up when there's a statement to take */}
        <group ref={armRef} position={[0.3, 1.3, 0]}>
          <mesh position={[0, -0.28, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.07, 0.56, 8]} />
            <meshStandardMaterial color={NAVY} />
          </mesh>
          <mesh position={[0, -0.58, 0.1]} rotation={[0.5, 0, 0]}>
            <boxGeometry args={[0.22, 0.28, 0.03]} />
            <meshStandardMaterial color="#f7f4e8" />
          </mesh>
        </group>
        <mesh position={[-0.3, 1.02, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 0.56, 8]} />
          <meshStandardMaterial color={NAVY} />
        </mesh>
        {/* head + cap */}
        <group ref={headRef} position={[0, 1.62, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.22, 16, 16]} />
            <meshStandardMaterial color="#e0b08a" />
          </mesh>
          <mesh position={[0, 0.17, 0]} castShadow>
            <cylinderGeometry args={[0.23, 0.23, 0.14, 12]} />
            <meshStandardMaterial color={NAVY_DARK} />
          </mesh>
          <mesh position={[0, 0.12, 0.2]} rotation={[0.15, 0, 0]}>
            <boxGeometry args={[0.34, 0.04, 0.2]} />
            <meshStandardMaterial color={NAVY_DARK} />
          </mesh>
          <mesh position={[-0.08, 0.02, 0.19]}>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
          <mesh position={[0.08, 0.02, 0.19]}>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
        </group>
      </group>
    </group>
  );
}
