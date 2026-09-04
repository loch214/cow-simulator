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
import Outside from "./Outside";
import { useCowStore } from "@/lib/store";
import { cowState } from "@/lib/cowState";
import { cam, frame, framedOffset, easeBehind, resetBehind, stepShake } from "@/lib/camera";
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
      <Outside />
      <Pit />
      <GrassPatches />
      <Cow />
      <PoliceStation />

      <FrameRig />
      <CameraRig />
      <DevBridge />
    </Canvas>
  );
}

/**
 * Keeps the shot readable on any screen shape.
 *
 * `fov` in three.js is the VERTICAL angle, which is the wrong end to hold fixed
 * on a phone: a 45-degree vertical on a 9:20 portrait screen leaves barely 22
 * degrees across, which is why an upright phone used to show nothing but the
 * cow's backside. So the HORIZONTAL angle is what's held constant instead — the
 * "Hor+" convention — and the vertical gives way to keep it.
 *
 * Two limits stop that from going silly. The vertical is capped, because the
 * angle a tall screen actually wants is about 117 degrees and that looks like a
 * fisheye lens. Whatever width the cap couldn't give back is then taken by
 * pulling the camera further off the cow instead, which widens the view without
 * bending it.
 */
const DESIGN_FOV = 45; // vertical degrees, framed for a 16:9 screen
const DESIGN_ASPECT = 16 / 9;
const DESIGN_HFOV = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(DESIGN_FOV) / 2) * DESIGN_ASPECT);
const FOV_CAP = 64;
const DIST_CAP = 1.6;

/**
 * How much the viewport has to change shape before the framing is allowed to
 * move at all. A phone's dynamic viewport height changes on its own as the
 * browser's chrome slides in and out, and reframing on every one of those was
 * one of the two things that made the camera look like it was zooming by
 * itself.
 */
const ASPECT_DEAD = 0.04;

function FrameRig() {
  // Recomputed from inside the frame loop rather than an effect, because the
  // camera is the render loop's to mutate — the same reason `CameraRig` below
  // writes to it there.
  const lastAspect = useRef(0);
  const want = useRef({ fov: DESIGN_FOV, scale: 1 });

  useFrame(({ camera, size }, delta) => {
    const lens = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const first = lastAspect.current === 0;

    // Recompute the target, but only when the shape has really changed. The
    // targets are held in a ref rather than derived every frame so that a
    // viewport wobbling inside the dead zone leaves the framing exactly alone
    // rather than easing towards a slightly different one.
    if (first || Math.abs(aspect - lastAspect.current) / aspect > ASPECT_DEAD) {
      lastAspect.current = aspect;
      const wanted = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(DESIGN_HFOV / 2) / aspect));
      const fov = THREE.MathUtils.clamp(wanted, DESIGN_FOV, FOV_CAP);
      // What we ended up with across, after the cap — and so how much further
      // back the camera has to stand to make up the difference.
      const got = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect);
      want.current = { fov, scale: THREE.MathUtils.clamp(DESIGN_HFOV / got, 1, DIST_CAP) };
    }

    // Rotating a phone swings the framing a long way — 64 degrees and 1.6x out
    // in portrait against 45 and 1x in landscape — and snapping between the
    // two reads as the camera lurching. Easing over about a quarter of a second
    // makes the same change read as a move.
    const k = first ? 1 : 1 - Math.pow(0.02, Math.min(delta, 0.05));
    frame.distScale += (want.current.scale - frame.distScale) * k;
    if (Math.abs(lens.fov - want.current.fov) > 0.005) {
      lens.fov += (want.current.fov - lens.fov) * k;
      lens.updateProjectionMatrix();
    }
  });

  return null;
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

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const started = useCowStore.getState().started;

    // Ease the point we're orbiting toward the cow so the camera doesn't jitter
    // with every step of the walk cycle.
    want.set(cowState.x, 1.05 + cowState.stand * 0.75, cowState.z);
    focus.current.lerp(want, 1 - Math.pow(0.0015, dt));

    // Title card: a slow drift across the FRONT of the cow, so you watch it
    // dance rather than watching it dance away from you. The values it leaves
    // behind are deliberately ordinary ones — a fine distance and pitch to
    // start playing at — so tapping through needs no handoff animation at all.
    if (!started) {
      cam.yaw = cowState.facing + Math.sin(state.clock.elapsedTime * 0.22) * 0.6;
      cam.pitch = 0.28;
      cam.dist = 5.4;
    }

    // On a phone there's no spare thumb for looking, so swing the camera around
    // behind the cow by itself. With a mouse, the player is in charge.
    //
    // Never during a reaction: the kiss turns the cow to face the camera, and if
    // the camera were also chasing round behind the cow the two would spin round
    // each other forever.
    if (started && isTouch() && !useCowStore.getState().activeGag) {
      easeBehind(cowState.facing, dt);
    }

    const off = framedOffset();
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
