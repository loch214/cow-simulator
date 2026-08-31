"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useCowStore } from "@/lib/store";
import { gags } from "@/lib/reactions";
import { lerpPose, Pose, PartName } from "@/lib/poses";

type Base = { pos: [number, number, number]; rot: [number, number, number]; scale: [number, number, number] };

const BASE: Record<PartName, Base> = {
  body: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] }, // whole-cow root transform
  head: { pos: [0, 0.85, 0.65], rot: [0, 0, 0], scale: [1, 1, 1] },
  earL: { pos: [-0.28, 0.05, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
  earR: { pos: [0.28, 0.05, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
  legFL: { pos: [-0.28, 0.2, 0.45], rot: [0, 0, 0], scale: [1, 1, 1] },
  legFR: { pos: [0.28, 0.2, 0.45], rot: [0, 0, 0], scale: [1, 1, 1] },
  legBL: { pos: [-0.28, 0.2, -0.45], rot: [0, 0, 0], scale: [1, 1, 1] },
  legBR: { pos: [0.28, 0.2, -0.45], rot: [0, 0, 0], scale: [1, 1, 1] },
  tail: { pos: [0, 0.7, -0.62], rot: [0.4, 0, 0], scale: [1, 1, 1] },
  blush: { pos: [0, -0.05, 0.25], rot: [0, 0, 0], scale: [0.001, 0.001, 0.001] },
};

function applyPart(ref: React.RefObject<THREE.Object3D | null>, base: Base, delta?: Pose[PartName]) {
  if (!ref.current) return;
  const dp = delta?.pos ?? [0, 0, 0];
  const dr = delta?.rot ?? [0, 0, 0];
  const ds = delta?.scale ?? [0, 0, 0];
  ref.current.position.set(base.pos[0] + dp[0], base.pos[1] + dp[1], base.pos[2] + dp[2]);
  ref.current.rotation.set(base.rot[0] + dr[0], base.rot[1] + dr[1], base.rot[2] + dr[2]);
  ref.current.scale.set(base.scale[0] + ds[0], base.scale[1] + ds[1], base.scale[2] + ds[2]);
}

function samplePose(keyframes: { t: number; pose: Pose }[], elapsed: number): Pose {
  if (elapsed <= keyframes[0].t) return keyframes[0].pose;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (elapsed >= a.t && elapsed <= b.t) {
      const ratio = b.t === a.t ? 1 : (elapsed - a.t) / (b.t - a.t);
      return lerpPose(a.pose, b.pose, ratio);
    }
  }
  return keyframes[keyframes.length - 1].pose;
}

function idlePose(t: number): Pose {
  return {
    body: { pos: [0, Math.sin(t * 1.5) * 0.02, 0] },
    tail: { rot: [0, Math.sin(t * 2) * 0.3, 0] },
    earL: { rot: [0, 0, Math.sin(t * 3) * 0.05] },
    earR: { rot: [0, 0, Math.sin(t * 3 + 1) * 0.05] },
  };
}

export default function Cow() {
  const rootRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const earLRef = useRef<THREE.Group>(null);
  const earRRef = useRef<THREE.Group>(null);
  const legFLRef = useRef<THREE.Group>(null);
  const legFRRef = useRef<THREE.Group>(null);
  const legBLRef = useRef<THREE.Group>(null);
  const legBRRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Group>(null);
  const blushRef = useRef<THREE.Group>(null);

  const activeGag = useCowStore((s) => s.activeGag);
  const gagStartedAt = useCowStore((s) => s.gagStartedAt);
  const lastClickRef = useRef(0);

  useFrame((state) => {
    let pose: Pose;
    if (activeGag) {
      const gag = gags[activeGag];
      const elapsed = Math.min(performance.now() - gagStartedAt, gag.duration);
      pose = samplePose(gag.keyframes, elapsed);
    } else {
      pose = idlePose(state.clock.elapsedTime);
    }

    applyPart(rootRef, BASE.body, pose.body);
    applyPart(headRef, BASE.head, pose.head);
    applyPart(earLRef, BASE.earL, pose.earL);
    applyPart(earRRef, BASE.earR, pose.earR);
    applyPart(legFLRef, BASE.legFL, pose.legFL);
    applyPart(legFRRef, BASE.legFR, pose.legFR);
    applyPart(legBLRef, BASE.legBL, pose.legBL);
    applyPart(legBRRef, BASE.legBR, pose.legBR);
    applyPart(tailRef, BASE.tail, pose.tail);
    applyPart(blushRef, BASE.blush, pose.blush);
  });

  function handleClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation();
    // The ray can hit multiple overlapping cow parts (e.g. head + torso), each
    // bubbling its own click up to this handler — dedupe so one tap = one gag.
    const now = performance.now();
    if (now - lastClickRef.current < 50) return;
    lastClickRef.current = now;
    const { tool, triggerGag } = useCowStore.getState();
    const gagId = tool === "feed" ? "kiss" : tool === "pet" ? "shy" : "slap";
    triggerGag(gagId);
  }

  return (
    <group ref={rootRef} onClick={handleClick}>
      {/* torso */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.8, 0.6, 1.3]} />
        <meshStandardMaterial color="#f5f5f0" />
      </mesh>
      <mesh position={[0.15, 0.75, -0.25]} castShadow>
        <boxGeometry args={[0.5, 0.35, 0.45]} />
        <meshStandardMaterial color="#2b2b2b" />
      </mesh>
      <mesh position={[-0.1, 0.4, 0.3]} castShadow>
        <boxGeometry args={[0.4, 0.3, 0.4]} />
        <meshStandardMaterial color="#2b2b2b" />
      </mesh>

      <group ref={headRef} position={BASE.head.pos}>
        <mesh castShadow>
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshStandardMaterial color="#f5f5f0" />
        </mesh>
        {/* snout */}
        <mesh position={[0, -0.12, 0.26]} castShadow>
          <boxGeometry args={[0.22, 0.14, 0.16]} />
          <meshStandardMaterial color="#f2b8c6" />
        </mesh>
        {/* horns */}
        <mesh position={[-0.14, 0.26, 0.02]} rotation={[0, 0, 0.5]} castShadow>
          <coneGeometry args={[0.05, 0.16, 8]} />
          <meshStandardMaterial color="#cfc6b8" />
        </mesh>
        <mesh position={[0.14, 0.26, 0.02]} rotation={[0, 0, -0.5]} castShadow>
          <coneGeometry args={[0.05, 0.16, 8]} />
          <meshStandardMaterial color="#cfc6b8" />
        </mesh>

        <group ref={earLRef} position={BASE.earL.pos}>
          <mesh rotation={[0, 0, 0.5]} castShadow>
            <coneGeometry args={[0.1, 0.22, 8]} />
            <meshStandardMaterial color="#f5f5f0" />
          </mesh>
        </group>
        <group ref={earRRef} position={BASE.earR.pos}>
          <mesh rotation={[0, 0, -0.5]} castShadow>
            <coneGeometry args={[0.1, 0.22, 8]} />
            <meshStandardMaterial color="#f5f5f0" />
          </mesh>
        </group>

        <group ref={blushRef} position={BASE.blush.pos} scale={BASE.blush.scale}>
          <mesh position={[-0.2, 0, 0.05]}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial color="#ff9bb3" />
          </mesh>
          <mesh position={[0.2, 0, 0.05]}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial color="#ff9bb3" />
          </mesh>
        </group>
      </group>

      <group ref={legFLRef} position={BASE.legFL.pos}>
        <mesh position={[0, -0.2, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 0.4, 8]} />
          <meshStandardMaterial color="#f5f5f0" />
        </mesh>
      </group>
      <group ref={legFRRef} position={BASE.legFR.pos}>
        <mesh position={[0, -0.2, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 0.4, 8]} />
          <meshStandardMaterial color="#f5f5f0" />
        </mesh>
      </group>
      <group ref={legBLRef} position={BASE.legBL.pos}>
        <mesh position={[0, -0.2, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 0.4, 8]} />
          <meshStandardMaterial color="#f5f5f0" />
        </mesh>
      </group>
      <group ref={legBRRef} position={BASE.legBR.pos}>
        <mesh position={[0, -0.2, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 0.4, 8]} />
          <meshStandardMaterial color="#f5f5f0" />
        </mesh>
      </group>

      <group ref={tailRef} position={BASE.tail.pos} rotation={BASE.tail.rot}>
        <mesh position={[0, -0.2, 0]}>
          <cylinderGeometry args={[0.03, 0.05, 0.4, 6]} />
          <meshStandardMaterial color="#f5f5f0" />
        </mesh>
        <mesh position={[0, -0.42, 0]}>
          <sphereGeometry args={[0.07, 8, 8]} />
          <meshStandardMaterial color="#2b2b2b" />
        </mesh>
      </group>
    </group>
  );
}
