"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { advance, Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import Cow from "./Cow";
import Pit from "./Pit";
import GrassPatches from "./Grass";
import PoliceStation from "./PoliceStation";
import Environment from "./Environment";
import { useCowStore } from "@/lib/store";
import { cowState } from "@/lib/cowState";
import { cameraOffset, easeBehind, resetBehind, stepShake } from "@/lib/camera";
import { attachLook, isTouch } from "@/lib/input";
import { WAYPOINTS } from "@/lib/world";

/**
 * Mid-afternoon, sun low and behind-left. Everything that needs to agree about
 * where the sun is — the sky dome, the shadow-casting light and the warmth of
 * the fill — reads it from here, so they can't drift apart.
 */
const SUN = new THREE.Vector3(-24, 21, 14);
/** Haze colour. Matching it to the sky at the horizon is what hides the world's edge. */
const HAZE = "#bcd0dd";

export default function Scene() {
  return (
    <Canvas
      // "percentage" is PCFShadowMap. The default R3F picks (PCFSoft) is
      // deprecated in this version of three and falls back to this anyway, with
      // a console warning every reload.
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: [1.6, 3.2, 7.4], fov: 45, near: 0.12, far: 400 }}
      gl={{ antialias: true }}
      onCreated={({ gl, scene }) => {
        // Filmic tone mapping keeps the white of the cow and the bright sky from
        // clipping to flat paper, which is most of what makes untuned WebGL look
        // like a screensaver.
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        scene.fog = new THREE.FogExp2(HAZE, 0.011);
      }}
      style={{ width: "100%", height: "100%", touchAction: "none" }}
    >
      <Sky sunPosition={SUN} turbidity={4} rayleigh={1.1} mieCoefficient={0.006} />

      {/* Sky above, warm bounce off the field below. */}
      <hemisphereLight args={["#bcd8f2", "#5c6b3a", 0.85]} />
      <ambientLight intensity={0.18} />
      <SunLight />

      <Environment />
      <Pit />
      <GrassPatches />
      <Cow />
      <PoliceStation />

      <CameraRig />
      <DevBridge />
    </Canvas>
  );
}

/**
 * Hands the live three.js state to the console in dev, next to `__cowStore()`.
 *
 * This exists because an automated browser tab runs backgrounded, and Chrome
 * suspends requestAnimationFrame in a hidden tab — so an agent screenshotting
 * this page gets a frozen frame or a black one. `__cowScene.advance(t, true)`
 * steps the whole frame loop by hand, which makes the scene checkable without a
 * human watching it. See "Verifying without watching it" in HANDOFF.md.
 */
function DevBridge() {
  const state = useThree();
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as Record<string, unknown>;
    w.__cowScene = { ...state, advance };
    return () => {
      delete w.__cowScene;
    };
  }, [state]);
  return null;
}

/**
 * The sun, and the one thing that casts shadows.
 *
 * A single shadow map stretched over the whole 70-unit world would be too coarse
 * to show a hoof, so the shadow camera is kept small and dragged along behind the
 * cow. You always get a sharp shadow where you are looking, and the far field
 * simply has none — which nobody notices.
 */
function SunLight() {
  const ref = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const light = ref.current;
    if (!light) return;
    target.position.set(cowState.x, 0, cowState.z);
    target.updateMatrixWorld();
    light.position.set(cowState.x + SUN.x * 0.5, SUN.y * 0.5, cowState.z + SUN.z * 0.5);
  });

  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={ref}
        color="#fff3dd"
        intensity={2.1}
        target={target}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.022}
        shadow-camera-near={1}
        shadow-camera-far={45}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={11}
        shadow-camera-bottom={-11}
      />
    </>
  );
}

/**
 * Third-person free-look camera. There are no OrbitControls here: the rig owns
 * the camera outright, positioning it from the yaw/pitch/distance in `cam` so
 * the view can follow the mouse without a button held down.
 */
function CameraRig() {
  const { camera, gl } = useThree();
  const focus = useRef(new THREE.Vector3(WAYPOINTS.penCentre.x, 1.05, WAYPOINTS.penCentre.z));
  const want = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    resetBehind(cowState.facing);
    return attachLook(gl.domElement);
  }, [gl]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    // Ease the point we're orbiting toward the cow so the camera doesn't jitter
    // with every step of the walk cycle.
    want.set(cowState.x, 1.05 + cowState.stand * 0.75, cowState.z);
    focus.current.lerp(want, 1 - Math.pow(0.0015, dt));

    // On a phone there's no spare thumb for looking, so swing the camera around
    // behind the cow by itself. With a mouse, the player is in charge.
    //
    // Never during a reaction: the kiss turns the cow to face the camera, and if
    // the camera were also chasing round behind the cow the two would spin round
    // each other forever.
    if (isTouch() && !useCowStore.getState().activeGag) easeBehind(cowState.facing, dt);

    const off = cameraOffset();
    // Impacts knock the camera about — a slap you can feel from behind the lens.
    const shake = stepShake(dt);
    camera.position.set(
      focus.current.x + off.x + shake.x,
      Math.max(0.5, focus.current.y + off.y + shake.y),
      focus.current.z + off.z + shake.z
    );
    camera.lookAt(focus.current);
  });

  return null;
}
