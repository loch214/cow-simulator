"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import Cow from "./Cow";
import Pit from "./Pit";
import GrassPatches from "./Grass";
import PoliceStation from "./PoliceStation";
import { cowState } from "@/lib/cowState";
import { cameraOffset, easeBehind, resetBehind } from "@/lib/camera";
import { attachLook, isTouch } from "@/lib/input";
import { PIT_RADIUS, STATION, WAYPOINTS } from "@/lib/world";

export default function Scene() {
  return (
    <Canvas
      shadows
      camera={{ position: [1.6, 3.2, 7.4], fov: 45 }}
      style={{ width: "100%", height: "100%", touchAction: "none" }}
    >
      <Sky sunPosition={[10, 8, 5]} turbidity={3} />
      <ambientLight intensity={0.65} />
      <directionalLight
        position={[8, 12, 6]}
        intensity={1.15}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-20}
        shadow-camera-right={26}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />

      {/* the field everything sits on */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[90, 90]} />
        <meshStandardMaterial color="#6fae4a" />
      </mesh>

      {/* dirt track from the gate down to the station */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(PIT_RADIUS + STATION.x - 2.4) / 2, 0.008, 0]}
      >
        <planeGeometry args={[STATION.x - 2.4 - PIT_RADIUS + 1.5, 1.6]} />
        <meshStandardMaterial color="#b09268" />
      </mesh>

      <Pit />
      <GrassPatches />
      <Cow />
      <PoliceStation />
      <Scenery />

      <CameraRig />
    </Canvas>
  );
}

/**
 * Third-person free-look camera. There are no OrbitControls here: the rig owns
 * the camera outright, positioning it from the yaw/pitch/distance in `cam` so
 * the view can follow the mouse without a button held down.
 */
function CameraRig() {
  const { camera, gl } = useThree();
  const focus = useRef(new THREE.Vector3(WAYPOINTS.penCentre.x, 0.85, WAYPOINTS.penCentre.z));

  useEffect(() => {
    resetBehind(cowState.facing);
    return attachLook(gl.domElement);
  }, [gl]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    // Ease the point we're orbiting toward the cow so the camera doesn't jitter
    // with every step of the walk cycle.
    const want = new THREE.Vector3(cowState.x, 0.85 + cowState.stand * 0.5, cowState.z);
    focus.current.lerp(want, 1 - Math.pow(0.0015, dt));

    // On a phone there's no spare thumb for looking, so swing the camera around
    // behind the cow by itself. With a mouse, the player is in charge.
    if (isTouch()) easeBehind(cowState.facing, dt);

    const off = cameraOffset();
    camera.position.set(
      focus.current.x + off.x,
      Math.max(0.4, focus.current.y + off.y),
      focus.current.z + off.z
    );
    camera.lookAt(focus.current);
  });

  return null;
}

/** A few trees so the world doesn't read as an empty green disc. */
function Scenery() {
  const spots: [number, number][] = [
    [-11, -6], [-13, 4], [-7, 11], [4, -12], [11, -9],
    [9, 10], [17, 7], [20, -6], [-2, 14], [24, 2],
  ];
  return (
    <group>
      {spots.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]} scale={0.9 + ((i * 7) % 5) * 0.12}>
          <mesh position={[0, 0.7, 0]} castShadow>
            <cylinderGeometry args={[0.16, 0.22, 1.4, 8]} />
            <meshStandardMaterial color="#7a5230" />
          </mesh>
          <mesh position={[0, 1.9, 0]} castShadow>
            <sphereGeometry args={[0.95, 12, 12]} />
            <meshStandardMaterial color="#3f8a35" />
          </mesh>
          <mesh position={[0.4, 1.5, 0.2]} castShadow>
            <sphereGeometry args={[0.6, 10, 10]} />
            <meshStandardMaterial color="#4a9c3d" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
