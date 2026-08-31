"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { cowState } from "@/lib/cowState";
import { GATE_WIDTH, PIT_RADIUS } from "@/lib/world";

const POSTS = 34;
const RAIL_HEIGHTS = [0.42, 0.78];
const WOOD = "#a9763f";
const WOOD_DARK = "#7d5326";

/** Half-angle of the gap the gate fills, at the +X side of the ring. */
const GATE_HALF = GATE_WIDTH / 2 / PIT_RADIUS;

interface Segment {
  x: number;
  z: number;
  len: number;
  rotY: number;
}

export default function Pit() {
  const { posts, rails } = useMemo(() => {
    const step = (Math.PI * 2) / POSTS;
    const postAngles: number[] = [];
    const railSegments: Segment[] = [];

    for (let i = 0; i < POSTS; i++) {
      const a = i * step;
      const wrapped = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(wrapped) > GATE_HALF) postAngles.push(a);

      const mid = a + step / 2;
      const midWrapped = Math.atan2(Math.sin(mid), Math.cos(mid));
      if (Math.abs(midWrapped) < GATE_HALF + step / 2) continue; // leave the doorway open
      railSegments.push({
        x: Math.cos(mid) * PIT_RADIUS,
        z: Math.sin(mid) * PIT_RADIUS,
        len: 2 * PIT_RADIUS * Math.sin(step / 2) + 0.02,
        rotY: -(mid + Math.PI / 2),
      });
    }

    return {
      posts: postAngles.map((a) => [Math.cos(a) * PIT_RADIUS, Math.sin(a) * PIT_RADIUS] as const),
      rails: railSegments,
    };
  }, []);

  return (
    <group>
      {/* the pen floor: a scuffed dirt ring the cow has already trodden flat */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
        <circleGeometry args={[PIT_RADIUS, 64]} />
        <meshStandardMaterial color="#87a05a" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <ringGeometry args={[0, PIT_RADIUS * 0.55, 48]} />
        <meshStandardMaterial color="#9b8a5e" />
      </mesh>

      {posts.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.5, z]} castShadow>
          <boxGeometry args={[0.13, 1.0, 0.13]} />
          <meshStandardMaterial color={WOOD_DARK} />
        </mesh>
      ))}

      {rails.map((seg, i) =>
        RAIL_HEIGHTS.map((h) => (
          <mesh key={`${i}-${h}`} position={[seg.x, h, seg.z]} rotation={[0, seg.rotY, 0]} castShadow>
            <boxGeometry args={[seg.len, 0.11, 0.06]} />
            <meshStandardMaterial color={WOOD} />
          </mesh>
        ))
      )}

      <Gate />
    </group>
  );
}

/** The one way out. Swings open only when the cow decides it's had enough. */
function Gate() {
  const gateRef = useRef<THREE.Group>(null);
  const hinge = useMemo(() => {
    const a = -GATE_HALF;
    return {
      x: Math.cos(a) * PIT_RADIUS,
      z: Math.sin(a) * PIT_RADIUS,
      // Closed orientation follows the CHORD between the two gate posts, which
      // is the tangent at the middle of the gap (angle 0) — not the tangent at
      // the hinge, which would leave the panel splayed out past the fence.
      rotY: -Math.PI / 2,
    };
  }, []);

  useFrame(() => {
    if (gateRef.current) {
      gateRef.current.rotation.y = hinge.rotY - cowState.gateOpen * 1.5;
    }
  });

  const len = GATE_WIDTH;

  return (
    <group ref={gateRef} position={[hinge.x, 0, hinge.z]} rotation={[0, hinge.rotY, 0]}>
      <mesh position={[len / 2, 0.42, 0]} castShadow>
        <boxGeometry args={[len, 0.11, 0.06]} />
        <meshStandardMaterial color={WOOD} />
      </mesh>
      <mesh position={[len / 2, 0.78, 0]} castShadow>
        <boxGeometry args={[len, 0.11, 0.06]} />
        <meshStandardMaterial color={WOOD} />
      </mesh>
      {/* diagonal brace, so it reads as a gate and not a floating plank */}
      <mesh position={[len / 2, 0.6, 0]} rotation={[0, 0, Math.atan2(0.36, len)]} castShadow>
        <boxGeometry args={[Math.hypot(len, 0.36), 0.07, 0.05]} />
        <meshStandardMaterial color={WOOD} />
      </mesh>
      <mesh position={[len - 0.05, 0.6, 0]} castShadow>
        <boxGeometry args={[0.1, 0.85, 0.1]} />
        <meshStandardMaterial color={WOOD_DARK} />
      </mesh>
    </group>
  );
}
