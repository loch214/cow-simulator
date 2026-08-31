"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useCowStore } from "@/lib/store";
import { gags } from "@/lib/reactions";
import { addPoses, samplePose, Pose, PartName } from "@/lib/poses";
import { idlePose, quadWalk } from "@/lib/locomotion";
import { approach, cowState, turnToward } from "@/lib/cowState";
import { moveAxis, onAction, onInteract, startInput } from "@/lib/input";
import { lookForward } from "@/lib/camera";
import { newRunner, stepCutscene, type CutsceneRunner } from "@/lib/cutscene";
import { GRASS, INTERACT_RANGE, PIT_INNER, TURN_SPEED, WALK_SPEED } from "@/lib/world";

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
  brow: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [0.001, 0.001, 0.001] },
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

export default function Cow() {
  // pivot = where the cow is in the world and which way it's facing.
  // root = the same cow, but only ever moved by pose deltas.
  const pivotRef = useRef<THREE.Group>(null);
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
  const browRef = useRef<THREE.Group>(null);

  const activeGag = useCowStore((s) => s.activeGag);
  const gagStartedAt = useCowStore((s) => s.gagStartedAt);
  const inCutscene = useCowStore((s) => s.inCutscene);
  const grassEatenAt = useCowStore((s) => s.grassEatenAt);

  const runnerRef = useRef<CutsceneRunner | null>(null);
  // `inCutscene` in the frame callback is a frame or two stale after we end the
  // scene, so latch it here — otherwise the cutscene restarts itself.
  const endedRef = useRef(false);

  useEffect(() => {
    if (inCutscene) {
      runnerRef.current = newRunner();
      endedRef.current = false;
    } else {
      runnerRef.current = null;
      cowState.scripted = false;
    }
  }, [inCutscene]);

  useEffect(() => {
    const stopKeys = startInput();
    const stopInteract = onInteract(() => useCowStore.getState().interact());
    const stopAction = onAction((action) =>
      useCowStore.getState().triggerGag(action === "pet" ? "shy" : "slap")
    );
    return () => {
      stopKeys();
      stopInteract();
      stopAction();
    };
  }, []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05); // a long stall shouldn't teleport the cow
    let pose: Pose;

    if (inCutscene && runnerRef.current) {
      cowState.scripted = true;
      const result = stepCutscene(runnerRef.current, dt);
      if (result.say !== undefined) useCowStore.getState().setDialogue(result.say);
      pose = result.pose;
      if (result.finished && !endedRef.current) {
        endedRef.current = true;
        cowState.scripted = false;
        useCowStore.getState().endCutscene();
      }
    } else if (activeGag) {
      // A reaction owns the whole body; the cow plants its feet until it's done.
      cowState.speed = 0;
      const gag = gags[activeGag];
      const elapsed = Math.min(performance.now() - gagStartedAt, gag.duration);
      pose = samplePose(gag.keyframes, elapsed);
    } else {
      pose = drive(dt, grassEatenAt);
    }

    // One shared stride clock, so the legs never jump when a gag ends mid-step.
    cowState.walkPhase += dt * cowState.speed * 3.2;

    if (pivotRef.current) {
      pivotRef.current.position.set(cowState.x, 0, cowState.z);
      pivotRef.current.rotation.y = cowState.facing;
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
    applyPart(browRef, BASE.brow, pose.brow);
  });

  return (
    <group ref={pivotRef}>
      <group ref={rootRef}>
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
          {/* eyes */}
          <mesh position={[-0.135, 0.08, 0.235]}>
            <sphereGeometry args={[0.072, 12, 12]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0.135, 0.08, 0.235]}>
            <sphereGeometry args={[0.072, 12, 12]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          <mesh position={[-0.142, 0.075, 0.29]}>
            <sphereGeometry args={[0.038, 10, 10]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
          <mesh position={[0.142, 0.075, 0.29]}>
            <sphereGeometry args={[0.038, 10, 10]} />
            <meshStandardMaterial color="#1a1a1a" />
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

          {/* angry brows — scaled to nothing until a gag switches them on */}
          <group ref={browRef} position={BASE.brow.pos} scale={BASE.brow.scale}>
            <mesh position={[-0.14, 0.185, 0.255]} rotation={[0, 0, -0.45]}>
              <boxGeometry args={[0.15, 0.035, 0.03]} />
              <meshStandardMaterial color="#2b2b2b" />
            </mesh>
            <mesh position={[0.14, 0.185, 0.255]} rotation={[0, 0, 0.45]}>
              <boxGeometry args={[0.15, 0.035, 0.03]} />
              <meshStandardMaterial color="#2b2b2b" />
            </mesh>
          </group>

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
            <mesh position={[-0.22, 0, 0.05]}>
              <sphereGeometry args={[0.06, 8, 8]} />
              <meshStandardMaterial color="#ff9bb3" />
            </mesh>
            <mesh position={[0.22, 0, 0.05]}>
              <sphereGeometry args={[0.06, 8, 8]} />
              <meshStandardMaterial color="#ff9bb3" />
            </mesh>
          </group>
        </group>

        <group ref={legFLRef} position={BASE.legFL.pos}>
          <Leg />
        </group>
        <group ref={legFRRef} position={BASE.legFR.pos}>
          <Leg />
        </group>
        <group ref={legBLRef} position={BASE.legBL.pos}>
          <Leg />
        </group>
        <group ref={legBRRef} position={BASE.legBR.pos}>
          <Leg />
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
    </group>
  );
}

function Leg() {
  return (
    <>
      <mesh position={[0, -0.2, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 0.4, 8]} />
        <meshStandardMaterial color="#f5f5f0" />
      </mesh>
      <mesh position={[0, -0.4, 0.01]} castShadow>
        <cylinderGeometry args={[0.085, 0.09, 0.08, 8]} />
        <meshStandardMaterial color="#2b2b2b" />
      </mesh>
    </>
  );
}

/**
 * Player-driven movement for one frame. Input is camera-relative — "up" always
 * means away from the camera, whichever way you've dragged it around.
 */
function drive(dt: number, grassEatenAt: (number | null)[]): Pose {
  const axis = moveAxis();

  // Forward is wherever the camera is pointing, so W always walks the cow off in
  // the direction you're looking. Taken from the camera's own yaw rather than its
  // position, which lags a frame behind.
  const { x: fx, z: fz } = lookForward();
  const rx = -fz; // right-hand side, given +Y is up
  const rz = fx;

  let dx = fx * axis.y + rx * axis.x;
  let dz = fz * axis.y + rz * axis.x;
  const len = Math.hypot(dx, dz);

  if (len > 0.001) {
    dx /= len;
    dz /= len;
    cowState.speed = approach(cowState.speed, WALK_SPEED, dt * 14);
    cowState.facing = turnToward(cowState.facing, Math.atan2(dx, dz), TURN_SPEED * dt);
    cowState.x += dx * cowState.speed * dt;
    cowState.z += dz * cowState.speed * dt;
  } else {
    cowState.speed = approach(cowState.speed, 0, dt * 18);
  }

  // The fence is the whole point of the pen: you can't walk out of it.
  const r = Math.hypot(cowState.x, cowState.z);
  if (r > PIT_INNER) {
    cowState.x = (cowState.x / r) * PIT_INNER;
    cowState.z = (cowState.z / r) * PIT_INNER;
  }

  // Contextual prompt: closest tuft still standing, within reach.
  let near: number | null = null;
  let best = INTERACT_RANGE;
  for (const spot of GRASS) {
    if (grassEatenAt[spot.id] !== null) continue;
    const d = Math.hypot(spot.x - cowState.x, spot.z - cowState.z);
    if (d < best) {
      best = d;
      near = spot.id;
    }
  }
  useCowStore.getState().setNearGrass(near);

  const walkAmt = Math.min(1, cowState.speed / WALK_SPEED);
  return addPoses(idlePose(performance.now() / 1000), quadWalk(cowState.walkPhase, walkAmt));
}
