"use client";

/**
 * The officer.
 *
 * He is fat and he is not interested, and both of those are built into the
 * geometry rather than acted out on top of it. The gut is the widest thing on
 * him, the stab vest visibly no longer does up over it, his arms cannot hang
 * straight because of it, and the legs are short and already bent so he stands
 * with his weight given up. Everything the animation does — the yawn, the
 * doughnut, the heavy blink — sits on top of a body that already reads as
 * somebody who would rather be sitting down.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useCowStore } from "@/lib/store";
import { loft, lumpGeometry, rng } from "@/lib/geometry";
import { OFFICER, STATION } from "@/lib/world";

const NAVY = "#22335e";
const NAVY_DARK = "#161f3a";
const HI_VIS = "#d8e24a";

/** A tapered limb segment, built along +z and swung down by its parent group. */
const limb = (len: number, top: number, waist: number, bottom: number) =>
  loft(
    [
      { z: 0, rx: top, ry: top * 0.92 },
      { z: len * 0.32, rx: waist * 1.06, ry: waist },
      { z: len * 0.78, rx: waist * 0.86, ry: waist * 0.82 },
      { z: len, rx: bottom, ry: bottom * 0.9 },
    ],
    { radial: 12, segments: 14 }
  );

/**
 * The stance, solved rather than eyeballed, so the boots stand ON the forecourt
 * instead of in it. The thigh tips forward and the shin tips back under it —
 * the shape a heavy man standing still for an hour settles into — and the boot
 * then cancels the net angle so the sole stays flat.
 */
const HIP_Y = 0.9;
const THIGH = 0.4;
const SHIN = 0.4;
const THIGH_TILT = 0.09;
const SHIN_TILT = -0.16;
/** What the boot has to undo to sit flat on the ground. */
const FOOT_LEVEL = -(THIGH_TILT + SHIN_TILT);

const officerGeo = {
  /**
   * Belt line at z=0, shoulders at z=0.66 — and the widest ring is the second
   * one, not the chest. A torso that tapers *upwards* is the whole silhouette.
   * The loft's `y` runs backwards once the shape is stood up, so the negative
   * values on the low rings are the belly leaning out over the belt.
   */
  torso: () =>
    loft(
      [
        { z: 0, y: -0.02, rx: 0.225, ry: 0.185 },
        { z: 0.1, y: -0.055, rx: 0.272, ry: 0.228 },
        { z: 0.24, y: -0.05, rx: 0.278, ry: 0.23 },
        { z: 0.4, y: -0.022, rx: 0.258, ry: 0.196 },
        { z: 0.55, y: 0.004, rx: 0.242, ry: 0.164 },
        { z: 0.66, y: 0.006, rx: 0.212, ry: 0.146 },
      ],
      { radial: 20, segments: 28, square: 0.28 }
    ),
  /** Round, jowly, and set on a neck that is barely a neck. */
  skull: () =>
    loft(
      [
        { z: -0.12, y: 0, rx: 0.108, ry: 0.112 },
        { z: -0.02, y: 0.006, rx: 0.132, ry: 0.134 },
        { z: 0.06, y: -0.014, rx: 0.126, ry: 0.128 },
        { z: 0.125, y: -0.045, rx: 0.098, ry: 0.098 },
        { z: 0.152, y: -0.07, rx: 0.068, ry: 0.062 },
      ],
      { radial: 18, segments: 22 }
    ),
  /**
   * The stab vest. It starts at the bottom of the ribs and gives up there: the
   * gut below it is in shirt, which is the joke and also what a stab vest does
   * on somebody this shape.
   */
  vest: () =>
    loft(
      [
        { z: 0.3, y: -0.03, rx: 0.268, ry: 0.212 },
        { z: 0.4, y: -0.02, rx: 0.272, ry: 0.208 },
        { z: 0.54, y: 0.004, rx: 0.256, ry: 0.176 },
        { z: 0.64, y: 0.006, rx: 0.228, ry: 0.158 },
        { z: 0.68, y: 0.006, rx: 0.19, ry: 0.135 },
      ],
      { radial: 20, segments: 24, square: 0.34 }
    ),
  hiVis: () =>
    loft(
      [
        { z: 0.44, y: -0.014, rx: 0.266, ry: 0.196 },
        { z: 0.51, y: -0.004, rx: 0.264, ry: 0.19 },
      ],
      { radial: 20, segments: 4, caps: false, square: 0.34 }
    ),
  // Short and thick. The forearm barely tapers, which is what stops a fat arm
  // reading as a thin arm with a loose sleeve on it.
  upperArm: () => limb(0.27, 0.082, 0.072, 0.062),
  foreArm: () => limb(0.25, 0.066, 0.06, 0.05),
  thigh: () => limb(THIGH, 0.128, 0.115, 0.082),
  shin: () => limb(SHIN, 0.084, 0.07, 0.058),
};

/** The doughnut. Not a full torus: there is a bite out of it. */
const donutGeo = () => new THREE.TorusGeometry(0.048, 0.023, 10, 20, Math.PI * 1.52);

/** Hundreds and thousands, scattered once from a fixed seed. */
const SPRINKLES = (() => {
  const r = rng(3131);
  return Array.from({ length: 14 }, () => {
    const a = r() * Math.PI * 1.5;
    const ring = 0.048 + (r() - 0.5) * 0.022;
    return {
      pos: [Math.cos(a) * ring, Math.sin(a) * ring, 0.02 + r() * 0.006] as [number, number, number],
      rot: [0, 0, a + (r() - 0.5) * 1.4] as [number, number, number],
    };
  });
})();

function useOfficerMaterials() {
  return useMemo(
    () => ({
      shirt: new THREE.MeshStandardMaterial({ color: "#8fa8cc", roughness: 0.85 }),
      vest: new THREE.MeshStandardMaterial({ color: NAVY_DARK, roughness: 0.8 }),
      trouser: new THREE.MeshStandardMaterial({ color: "#232838", roughness: 0.9 }),
      cap: new THREE.MeshStandardMaterial({ color: NAVY, roughness: 0.7 }),
      // ruddier than the first pass: this is a man who takes the stairs badly
      skin: new THREE.MeshStandardMaterial({ color: "#d09a72", roughness: 0.7 }),
      flush: new THREE.MeshStandardMaterial({ color: "#c47f66", roughness: 0.72 }),
      hair: new THREE.MeshStandardMaterial({ color: "#5a4436", roughness: 0.95 }),
      boot: new THREE.MeshStandardMaterial({ color: "#171717", roughness: 0.45 }),
      belt: new THREE.MeshStandardMaterial({ color: "#14161d", roughness: 0.5 }),
      chrome: new THREE.MeshStandardMaterial({ color: "#c9cdd4", roughness: 0.3, metalness: 0.85 }),
      badge: new THREE.MeshStandardMaterial({ color: "#e2b53c", roughness: 0.3, metalness: 0.7 }),
      hivis: new THREE.MeshStandardMaterial({
        color: HI_VIS,
        roughness: 0.7,
        emissive: HI_VIS,
        emissiveIntensity: 0.12,
      }),
      paper: new THREE.MeshStandardMaterial({ color: "#f7f4e8", roughness: 0.95 }),
      eye: new THREE.MeshStandardMaterial({ color: "#241a12", roughness: 0.15 }),
      mouth: new THREE.MeshStandardMaterial({ color: "#5c2f2d", roughness: 0.6 }),
      icing: new THREE.MeshStandardMaterial({ color: "#e8709c", roughness: 0.55 }),
      sprinkle: new THREE.MeshStandardMaterial({ color: "#fdf6e6", roughness: 0.6 }),
      cup: new THREE.MeshStandardMaterial({ color: "#f0ece2", roughness: 0.85 }),
      lid: new THREE.MeshStandardMaterial({ color: "#2c2a28", roughness: 0.6 }),
    }),
    []
  );
}

/**
 * A soft bump: 0 for most of `period`, rising to 1 and back over `width`
 * seconds. Two of these at periods that do not divide into each other are all
 * the state the yawning and the eating need — no timers, no RNG, nothing to
 * reset, and they drift in and out of step forever instead of settling into a
 * loop you can spot.
 */
function pulse(t: number, period: number, width: number): number {
  const u = ((t % period) + period) % period;
  if (u > width) return 0;
  return Math.sin((u / width) * Math.PI);
}

/**
 * Stands outside the door taking a statement, under duress. What he does is
 * driven by who is currently talking, so the notepad and the jaw stay locked to
 * the dialogue rather than running on their own clock.
 *
 * The rest of the time he is doing what a bored man on a doorstep does: shifting
 * his weight, breathing through his mouth, yawning, and working through a
 * doughnut.
 */
export default function Officer() {
  const mats = useOfficerMaterials();
  const geo = useMemo(
    () => ({
      torso: officerGeo.torso(),
      vest: officerGeo.vest(),
      hiVis: officerGeo.hiVis(),
      skull: officerGeo.skull(),
      upperArm: officerGeo.upperArm(),
      foreArm: officerGeo.foreArm(),
      thigh: officerGeo.thigh(),
      shin: officerGeo.shin(),
      nose: lumpGeometry(1717, 0.036, 0.14, 1),
      donut: donutGeo(),
    }),
    []
  );

  // A loft is built along +z. `down` swings that to -y for anything that hangs
  // (arms, legs); `up` swings it to +y for anything that stands (torso, vest).
  const down: [number, number, number] = [Math.PI / 2, 0, 0];
  const up: [number, number, number] = [-Math.PI / 2, 0, 0];

  const rootRef = useRef<THREE.Group>(null);
  const hipsRef = useRef<THREE.Group>(null);
  const chestRef = useRef<THREE.Group>(null);
  const bellyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const padArmRef = useRef<THREE.Group>(null);
  const padForeRef = useRef<THREE.Group>(null);
  const foodArmRef = useRef<THREE.Group>(null);
  const foodForeRef = useRef<THREE.Group>(null);
  const jawRef = useRef<THREE.Group>(null);
  const browRefs = useRef<(THREE.Mesh | null)[]>([null, null]);
  const lidRefs = useRef<(THREE.Mesh | null)[]>([null, null]);
  const blinkRef = useRef({ next: 3, closing: 0 });

  const inCutscene = useCowStore((s) => s.inCutscene);
  const speaker = useCowStore((s) => s.speaker);
  const dialogue = useCowStore((s) => s.dialogue);

  const talking = inCutscene && speaker === "officer" && dialogue !== null;
  const listening = inCutscene && !talking;

  // positioned relative to the station group
  const px = OFFICER.x - STATION.x;
  const pz = OFFICER.z - STATION.z;

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);

    const yawn = pulse(t, 11.3, 2.2);
    const bite = pulse(t + 4.1, 7.7, 1.8);
    // still chewing for a good while after the doughnut has gone in
    const chew = Math.max(0, Math.sin(t * 5.5)) * pulse(t + 2.6, 7.7, 3.4);

    // Weight goes from one foot to the other, slower and heavier than a fit man
    // would, and the breathing under it is deep enough to see.
    const shift = Math.sin(t * 0.24) * 0.6 + Math.sin(t * 0.15 + 1.3) * 0.4;
    const breath = Math.sin(t * 0.95);
    if (rootRef.current) {
      rootRef.current.position.y = Math.abs(shift) * -0.014 + breath * 0.008;
      rootRef.current.rotation.z = shift * 0.035;
    }
    if (hipsRef.current) {
      hipsRef.current.rotation.y = shift * 0.06;
      hipsRef.current.position.x = shift * 0.03;
    }
    if (chestRef.current) {
      chestRef.current.rotation.y = -shift * 0.06;
      // The slouch, and the extra lean he rocks back into on a yawn. This is on
      // the CHEST rather than on the root on purpose: the root sits on the
      // ground, so tilting it there swings his boots through the forecourt,
      // while tilting here bends him at the waist, which is where a man leaning
      // back actually bends.
      chestRef.current.rotation.x = -0.07 - yawn * 0.16;
    }
    // The gut takes the breath, not the ribs. It is the only part of him doing
    // any visible work, and it is the fastest read on the whole character.
    if (bellyRef.current) {
      const swell = 1 + breath * 0.035 + yawn * 0.03;
      bellyRef.current.scale.set(swell, 1 + breath * 0.012, swell * 1.02);
    }

    if (headRef.current) {
      if (yawn > 0.02) {
        // chin up and away, the whole head going with it
        headRef.current.rotation.x = -yawn * 0.42;
        headRef.current.rotation.y = yawn * 0.16;
      } else if (talking) {
        headRef.current.rotation.x = -0.04 + Math.sin(t * 3.1) * 0.04;
        headRef.current.rotation.y = Math.sin(t * 1.7) * 0.1;
      } else if (listening) {
        // the slow nod of a man who stopped listening several sentences ago
        headRef.current.rotation.x = 0.13 + Math.sin(t * 1.4) * 0.07;
        headRef.current.rotation.y = shift * 0.05;
      } else {
        headRef.current.rotation.x = 0.06 + Math.sin(t * 0.6) * 0.04;
        headRef.current.rotation.y = Math.sin(t * 0.29) * 0.32;
      }
    }

    // The notepad comes up while a statement is being given, and the hand
    // scribbles at it — for about a second and a half, and then not again.
    const scribble = listening ? Math.sin(t * 12) * 0.05 * pulse(t, 9.4, 1.6) : 0;
    if (padArmRef.current) {
      padArmRef.current.rotation.x = inCutscene ? -0.72 + Math.sin(t * 1.1) * 0.05 : -0.12;
      // The arm cannot hang straight; there is a stomach in the way. This has to
      // clear a gut half a metre across, so it is a lot more than it looks.
      padArmRef.current.rotation.z = inCutscene ? -0.52 : -0.4;
    }
    if (padForeRef.current) {
      padForeRef.current.rotation.x = inCutscene ? -1.05 + scribble : -0.42;
    }

    // The other hand has a doughnut in it and its priorities are clear: it goes
    // to his mouth on a bite and hangs there the rest of the time. It does not
    // gesture, and it does not stop for the cow.
    if (foodArmRef.current) {
      foodArmRef.current.rotation.x = -0.34 - bite * 0.85;
      foodArmRef.current.rotation.z = 0.5 - bite * 0.2;
    }
    if (foodForeRef.current) {
      foodForeRef.current.rotation.x = -0.55 - bite * 1.15;
      foodForeRef.current.rotation.z = bite * 0.35;
    }

    if (jawRef.current) {
      // A yawn beats a sentence and a sentence beats chewing, so you can always
      // tell which of the three he is doing without reading the bubble.
      const open = Math.max(
        yawn * 0.75,
        talking ? Math.abs(Math.sin(t * 8)) * 0.28 + 0.04 : 0,
        chew * 0.16
      );
      jawRef.current.rotation.x = open;
      jawRef.current.position.z = -open * 0.014;
    }

    // Blinks: slow, and a yawn squeezes both eyes shut on its own.
    const b = blinkRef.current;
    b.next -= dt;
    if (b.next <= 0) {
      b.closing = 1;
      b.next = 2 + Math.random() * 4;
    }
    b.closing = Math.max(0, b.closing - dt * 5.5);
    const shut = Math.max(
      Math.min(1, Math.sin(Math.min(1, b.closing) * Math.PI) * 1.8),
      yawn * 1.3
    );
    lidRefs.current.forEach((lid) => {
      // never fully open: the lids sit low on him even wide awake
      if (lid) lid.scale.y = 0.42 + Math.min(1.15, shut) * 0.9;
    });
    browRefs.current.forEach((brow) => {
      if (brow) brow.position.y = 0.03 - yawn * 0.012;
    });
  });

  return (
    <group position={[px, 0, pz]} rotation={[0, -Math.PI / 2, 0]}>
      <group ref={rootRef}>
        <group ref={hipsRef} position={[0, HIP_Y, 0]}>
          {/* legs: short, set wide apart, and never quite straight */}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.145, 0, 0]} rotation={[THIGH_TILT, 0, s * 0.07]}>
              <group rotation={down}>
                <mesh geometry={geo.thigh} material={mats.trouser} castShadow />
              </group>
              <group position={[0, -THIGH, 0]} rotation={[SHIN_TILT, 0, 0]}>
                <group rotation={down}>
                  <mesh geometry={geo.shin} material={mats.trouser} castShadow />
                </group>
                {/* the boot undoes the leg's net angle, so the sole lands flat */}
                <group position={[0, -SHIN, 0]} rotation={[FOOT_LEVEL, 0, 0]}>
                  <mesh position={[0, -0.03, -0.005]} material={mats.boot} castShadow>
                    <boxGeometry args={[0.145, 0.09, 0.17]} />
                  </mesh>
                  <mesh position={[0, -0.075, 0.055]} material={mats.boot} castShadow>
                    <boxGeometry args={[0.14, 0.05, 0.3]} />
                  </mesh>
                </group>
              </group>
            </group>
          ))}

          {/* torso, from the belt up */}
          <group ref={chestRef}>
            <group ref={bellyRef}>
              <group rotation={up}>
                <mesh geometry={geo.torso} material={mats.shirt} castShadow />
              </group>
            </group>
            {/* the vest, which stops well short of the bottom of him */}
            <group rotation={up}>
              <mesh geometry={geo.vest} material={mats.vest} castShadow />
              <mesh geometry={geo.hiVis} material={mats.hivis} />
            </group>
            <mesh position={[0.13, 0.5, 0.19]} rotation={[0, 0.2, 0]} material={mats.badge}>
              <boxGeometry args={[0.055, 0.07, 0.014]} />
            </mesh>
            {/* epaulettes */}
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.215, 0.63, 0]} material={mats.vest} castShadow>
                <boxGeometry args={[0.14, 0.05, 0.16]} />
              </mesh>
            ))}
            {/* Belt kit, slung UNDER the gut rather than round the waist. There
                is no waist to put it round. */}
            <mesh position={[0, -0.03, 0.01]} material={mats.belt}>
              <boxGeometry args={[0.47, 0.1, 0.4]} />
            </mesh>
            <mesh position={[0, -0.03, 0.23]} material={mats.chrome}>
              <boxGeometry args={[0.09, 0.075, 0.02]} />
            </mesh>
            <mesh position={[-0.23, -0.02, 0.04]} material={mats.belt} castShadow>
              <boxGeometry args={[0.07, 0.17, 0.09]} />
            </mesh>
            <mesh position={[0.23, -0.01, 0.04]} material={mats.chrome}>
              <boxGeometry args={[0.05, 0.12, 0.05]} />
            </mesh>
            {/* radio on the shoulder, aerial and all */}
            <mesh position={[-0.18, 0.54, 0.15]} material={mats.belt}>
              <boxGeometry args={[0.06, 0.1, 0.04]} />
            </mesh>
            <mesh position={[-0.18, 0.62, 0.15]} material={mats.belt}>
              <cylinderGeometry args={[0.006, 0.006, 0.09, 6]} />
            </mesh>

            {/* notepad arm */}
            <group ref={padArmRef} position={[0.255, 0.58, 0]} rotation={[-0.12, 0, -0.4]}>
              <group rotation={down}>
                <mesh geometry={geo.upperArm} material={mats.shirt} castShadow />
              </group>
              <group ref={padForeRef} position={[0, -0.27, 0]} rotation={[-0.42, 0, 0]}>
                <group rotation={down}>
                  <mesh geometry={geo.foreArm} material={mats.shirt} castShadow />
                </group>
                <mesh position={[0, -0.28, 0.012]} material={mats.skin} castShadow>
                  <boxGeometry args={[0.075, 0.11, 0.1]} />
                </mesh>
                <mesh position={[0, -0.31, 0.085]} rotation={[0.55, 0, 0]} material={mats.paper}>
                  <boxGeometry args={[0.16, 0.21, 0.012]} />
                </mesh>
                <mesh position={[0.03, -0.3, 0.12]} rotation={[0.4, 0, 0.3]} material={mats.chrome}>
                  <cylinderGeometry args={[0.007, 0.007, 0.12, 6]} />
                </mesh>
              </group>
            </group>

            {/* doughnut arm */}
            <group ref={foodArmRef} position={[-0.255, 0.58, 0]} rotation={[-0.34, 0, 0.5]}>
              <group rotation={down}>
                <mesh geometry={geo.upperArm} material={mats.shirt} castShadow />
              </group>
              <group ref={foodForeRef} position={[0, -0.27, 0]} rotation={[-0.55, 0, 0]}>
                <group rotation={down}>
                  <mesh geometry={geo.foreArm} material={mats.shirt} castShadow />
                </group>
                <mesh position={[0, -0.28, 0.012]} material={mats.skin} castShadow>
                  <boxGeometry args={[0.075, 0.11, 0.1]} />
                </mesh>
                {/* held between the fingers, bite already taken */}
                <group position={[0, -0.315, 0.075]} rotation={[1.35, 0.3, 0.4]}>
                  <mesh geometry={geo.donut} material={mats.icing} castShadow />
                  {SPRINKLES.map((s, i) => (
                    <mesh key={i} position={s.pos} rotation={s.rot} material={mats.sprinkle}>
                      <boxGeometry args={[0.014, 0.005, 0.005]} />
                    </mesh>
                  ))}
                </group>
              </group>
            </group>

            {/* Neck. There is not much of one, and it is wider than the head. */}
            <mesh position={[0, 0.68, 0.005]} material={mats.skin}>
              <cylinderGeometry args={[0.085, 0.105, 0.1, 12]} />
            </mesh>

            <group ref={headRef} position={[0, 0.755, 0]} scale={1.06}>
              <group rotation={[-Math.PI / 2, 0, 0]}>
                <mesh geometry={geo.skull} material={mats.skin} castShadow />
              </group>
              {/* jowls, which is where the weight shows first */}
              {[-1, 1].map((s) => (
                <mesh
                  key={s}
                  position={[s * 0.105, -0.05, 0.045]}
                  scale={[0.78, 0.95, 0.95]}
                  material={mats.skin}
                  castShadow
                >
                  <sphereGeometry args={[0.062, 12, 10]} />
                </mesh>
              ))}
              {/* jaw, hinged at the ears, with the second chin under it */}
              <group ref={jawRef} position={[0, -0.03, -0.02]}>
                <mesh position={[0, -0.055, 0.05]} scale={[1.05, 0.72, 1.05]} material={mats.skin} castShadow>
                  <sphereGeometry args={[0.09, 14, 10]} />
                </mesh>
                <mesh position={[0, -0.1, 0.02]} scale={[1.15, 0.62, 1.05]} material={mats.skin} castShadow>
                  <sphereGeometry args={[0.082, 14, 10]} />
                </mesh>
                <mesh position={[0, -0.028, 0.112]} material={mats.mouth}>
                  <boxGeometry args={[0.05, 0.012, 0.014]} />
                </mesh>
                {/* the moustache, which is doing a lot of the work here */}
                <mesh
                  position={[0, 0.006, 0.108]}
                  rotation={[0.15, 0, 0]}
                  scale={[1, 0.55, 0.5]}
                  material={mats.hair}
                >
                  <sphereGeometry args={[0.058, 12, 10]} />
                </mesh>
              </group>
              <mesh
                geometry={geo.nose}
                material={mats.flush}
                position={[0, 0.024, 0.108]}
                scale={[0.85, 1.1, 1]}
              />
              {/* a bit of colour high on each cheek */}
              {[-1, 1].map((s) => (
                <mesh
                  key={s}
                  position={[s * 0.085, -0.012, 0.086]}
                  scale={[0.055, 0.035, 0.012]}
                  material={mats.flush}
                >
                  <sphereGeometry args={[1, 10, 8]} />
                </mesh>
              ))}
              {/* small eyes, set deep, with lids that sit low even wide awake */}
              {[-1, 1].map((s, i) => (
                <group key={s} position={[s * 0.05, 0.038, 0.096]}>
                  <mesh material={mats.eye}>
                    <sphereGeometry args={[0.015, 10, 8]} />
                  </mesh>
                  <mesh
                    ref={(m) => {
                      lidRefs.current[i] = m;
                    }}
                    position={[0, 0.011, 0.004]}
                    scale={[1, 0.42, 1]}
                    material={mats.skin}
                  >
                    <sphereGeometry args={[0.019, 10, 8]} />
                  </mesh>
                  {/* the bag under it */}
                  <mesh position={[0, -0.015, 0.002]} scale={[1.05, 0.4, 0.8]} material={mats.flush}>
                    <sphereGeometry args={[0.017, 10, 8]} />
                  </mesh>
                  <mesh
                    ref={(m) => {
                      browRefs.current[i] = m;
                    }}
                    position={[0, 0.03, 0.004]}
                    rotation={[0, 0, -s * 0.26]}
                    material={mats.hair}
                  >
                    <boxGeometry args={[0.05, 0.012, 0.016]} />
                  </mesh>
                </group>
              ))}
              {/* ears */}
              {[-1, 1].map((s) => (
                <mesh
                  key={s}
                  position={[s * 0.115, -0.008, 0]}
                  scale={[0.4, 1, 0.7]}
                  material={mats.skin}
                >
                  <sphereGeometry args={[0.04, 10, 8]} />
                </mesh>
              ))}
              {/* peaked cap, pushed back off his forehead */}
              <group position={[0, 0.1, -0.03]} rotation={[-0.22, 0.06, 0.04]}>
                <mesh material={mats.cap} castShadow>
                  <cylinderGeometry args={[0.132, 0.122, 0.085, 16]} />
                </mesh>
                <mesh position={[0, 0.045, 0]} material={mats.cap}>
                  <cylinderGeometry args={[0.135, 0.132, 0.02, 16]} />
                </mesh>
                <mesh position={[0, -0.03, 0]} material={mats.vest}>
                  <cylinderGeometry args={[0.129, 0.129, 0.038, 16]} />
                </mesh>
                {/* chequered band, the one thing that makes a cap read as police */}
                {Array.from({ length: 12 }, (_, i) => (
                  <mesh
                    key={i}
                    position={[
                      Math.sin((i / 12) * Math.PI * 2) * 0.13,
                      -0.03 + (i % 2 ? 0.009 : -0.009),
                      Math.cos((i / 12) * Math.PI * 2) * 0.13,
                    ]}
                    rotation={[0, (i / 12) * Math.PI * 2, 0]}
                  >
                    <boxGeometry args={[0.07, 0.019, 0.006]} />
                    <meshStandardMaterial color="#f0f2f6" roughness={0.8} />
                  </mesh>
                ))}
                <mesh
                  position={[0, -0.028, 0.122]}
                  rotation={[0.32, 0, 0]}
                  material={mats.vest}
                  castShadow
                >
                  <boxGeometry args={[0.195, 0.016, 0.115]} />
                </mesh>
                <mesh position={[0, 0.005, 0.12]} material={mats.badge}>
                  <boxGeometry args={[0.045, 0.05, 0.008]} />
                </mesh>
              </group>
            </group>
          </group>
        </group>
      </group>

      {/* And the coffee, going cold on the step where he put it down. */}
      <group position={[-0.34, 0, 0.42]}>
        <mesh position={[0, 0.06, 0]} material={mats.cup} castShadow>
          <cylinderGeometry args={[0.045, 0.035, 0.12, 14]} />
        </mesh>
        <mesh position={[0, 0.125, 0]} material={mats.lid}>
          <cylinderGeometry args={[0.048, 0.047, 0.018, 14]} />
        </mesh>
      </group>
    </group>
  );
}
