"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useCowStore } from "@/lib/store";
import { loft, lumpGeometry, rng } from "@/lib/geometry";
import {
  brickMap,
  dirtMap,
  glowMap,
  roofMap,
  signMap,
  stripFadeMap,
  stuccoMap,
  woodMap,
} from "@/lib/textures";
import { OFFICER, STATION } from "@/lib/world";

const NAVY = "#22335e";
const NAVY_DARK = "#161f3a";
const HI_VIS = "#d8e24a";

const WIDTH = 5.4; // across the front, facing the pen
const DEPTH = 6.4;
const WALL = 3.5;

/**
 * The roof, solved from the pitch rather than positioned by eye. The first
 * attempt had each slab rotated the wrong way, so the roof sloped *up* away from
 * the ridge and hung in the air; deriving the eaves, the ridge height and the
 * slab length from one angle makes that impossible.
 */
const PITCH = 0.3; // radians
const OVERHANG = 0.28;
const EAVE_Y = 0.4 + WALL; // top of the wall
const ROOF_HALF = WIDTH / 2 + OVERHANG; // ridge to eaves, horizontally
const ROOF_RISE = ROOF_HALF * Math.tan(PITCH);
const RIDGE_Y = EAVE_Y + ROOF_RISE;
const SLAB_LEN = Math.hypot(ROOF_HALF, ROOF_RISE) + 0.05;

function useStationMaterials() {
  return useMemo(
    () => ({
      wall: new THREE.MeshStandardMaterial({ map: stuccoMap(), roughness: 0.92 }),
      brick: new THREE.MeshStandardMaterial({ map: brickMap(), roughness: 0.95 }),
      roof: new THREE.MeshStandardMaterial({ map: roofMap(), roughness: 0.6, metalness: 0.35 }),
      trim: new THREE.MeshStandardMaterial({ color: "#e9ecf2", roughness: 0.5 }),
      navy: new THREE.MeshStandardMaterial({ color: NAVY, roughness: 0.6 }),
      door: new THREE.MeshStandardMaterial({ map: woodMap(), color: "#4a5f8f", roughness: 0.55 }),
      // A window is a hole you can see a room through, not a blue rectangle. It
      // has to stay mostly dielectric though: there is no environment map in this
      // scene, and a fully metallic surface with nothing to reflect renders as a
      // flat black hole in the wall.
      glass: new THREE.MeshStandardMaterial({
        color: "#33465e",
        roughness: 0.12,
        metalness: 0.18,
        emissive: "#9fc0dd",
        emissiveIntensity: 0.16,
      }),
      metal: new THREE.MeshStandardMaterial({ color: "#6d7480", roughness: 0.35, metalness: 0.8 }),
      concrete: new THREE.MeshStandardMaterial({ color: "#b4b0a6", roughness: 0.95 }),
    }),
    []
  );
}

/** Down the road from the pen. Only ever visited under protest. */
export default function PoliceStation() {
  const mats = useStationMaterials();
  const lampRef = useRef<THREE.Mesh>(null);
  const flareRef = useRef<THREE.Sprite>(null);

  const roofSlab = useMemo(
    () => new THREE.BoxGeometry(SLAB_LEN, 0.13, DEPTH + OVERHANG * 2),
    []
  );
  // The triangle of wall left under each slope.
  const gable = useMemo(() => {
    const shape = new THREE.Shape();
    const edge = ROOF_RISE - (WIDTH / 2) * Math.tan(PITCH);
    shape.moveTo(-WIDTH / 2, 0);
    shape.lineTo(WIDTH / 2, 0);
    shape.lineTo(WIDTH / 2, edge);
    shape.lineTo(0, ROOF_RISE);
    shape.lineTo(-WIDTH / 2, edge);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);
  const sign = useMemo(() => signMap("POLICE"), []);
  const forecourt = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      map: dirtMap(),
      alphaMap: stripFadeMap(),
      transparent: true,
      roughness: 1,
      depthWrite: false,
    });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -3;
    return m;
  }, []);
  const flare = useMemo(() => glowMap("rgba(150,200,255,0.9)", "rgba(60,120,240,0.35)"), []);

  useFrame((state) => {
    // The lamp over the door pulses rather than spins: a slow blue breath is
    // read as "open" from a long way off, and does not fight the daylight.
    const t = state.clock.elapsedTime;
    const k = 0.55 + 0.45 * Math.sin(t * 1.6);
    if (lampRef.current) {
      (lampRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + k * 1.4;
    }
    if (flareRef.current) {
      flareRef.current.material.opacity = 0.18 + k * 0.3;
      const s = 1.1 + k * 0.35;
      flareRef.current.scale.set(s, s, s);
    }
  });

  return (
    <group position={[STATION.x, 0, STATION.z]}>
      {/* forecourt, so the building is not standing in a meadow */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[-2.6, 0.016, 0]}
        material={forecourt}
        receiveShadow
      >
        <planeGeometry args={[5.5, 7]} />
      </mesh>

      {/* plinth */}
      <mesh position={[0, 0.2, 0]} material={mats.brick} castShadow receiveShadow>
        <boxGeometry args={[WIDTH + 0.3, 0.4, DEPTH + 0.3]} />
      </mesh>
      {/* main block */}
      <mesh position={[0, 0.4 + WALL / 2, 0]} material={mats.wall} castShadow receiveShadow>
        <boxGeometry args={[WIDTH, WALL, DEPTH]} />
      </mesh>
      {/* string course under the eaves */}
      <mesh position={[0, 0.4 + WALL - 0.16, 0]} material={mats.trim} castShadow>
        <boxGeometry args={[WIDTH + 0.14, 0.16, DEPTH + 0.14]} />
      </mesh>

      {/* pitched roof: two slabs meeting over a ridge that runs front to back */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          geometry={roofSlab}
          material={mats.roof}
          position={[(s * ROOF_HALF) / 2, EAVE_Y + ROOF_RISE / 2, 0]}
          rotation={[0, 0, -s * PITCH]}
          castShadow
        />
      ))}
      <mesh position={[0, RIDGE_Y + 0.04, 0]} material={mats.metal} castShadow>
        <boxGeometry args={[0.2, 0.1, DEPTH + OVERHANG * 2]} />
      </mesh>
      {/* gable ends, filling the triangle under each slope */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          geometry={gable}
          material={mats.wall}
          position={[0, EAVE_Y - 0.01, s * (DEPTH / 2)]}
          rotation={[0, s > 0 ? 0 : Math.PI, 0]}
          castShadow
        />
      ))}
      <mesh position={[1.1, RIDGE_Y + 0.35, -1.8]} material={mats.brick} castShadow>
        <boxGeometry args={[0.5, 1.4, 0.5]} />
      </mesh>
      <mesh position={[1.1, RIDGE_Y + 1.08, -1.8]} material={mats.concrete} castShadow>
        <boxGeometry args={[0.62, 0.1, 0.62]} />
      </mesh>

      {/* --- the front, facing the pen (-x) --- */}
      <group position={[-WIDTH / 2, 0, 0]}>
        {/* doorway, recessed */}
        <mesh position={[0.06, 1.4, 0]} material={mats.trim}>
          <boxGeometry args={[0.18, 2.5, 1.7]} />
        </mesh>
        <mesh position={[-0.02, 1.35, 0]} material={mats.door} castShadow>
          <boxGeometry args={[0.1, 2.25, 1.35]} />
        </mesh>
        <mesh position={[-0.09, 1.35, 0.5]} material={mats.metal}>
          <boxGeometry args={[0.04, 0.5, 0.05]} />
        </mesh>
        {/* fanlight over the door */}
        <mesh position={[-0.06, 2.42, 0]} material={mats.glass}>
          <boxGeometry args={[0.06, 0.32, 1.2]} />
        </mesh>

        {/* sign board */}
        <mesh position={[-0.14, 3.05, 0]}>
          <boxGeometry args={[0.08, 0.62, 2.4]} />
          <meshStandardMaterial map={sign} roughness={0.45} />
        </mesh>

        {/* the blue lamp */}
        <group position={[-0.35, 2.72, 1.05]}>
          <mesh position={[0.18, 0.12, 0]} material={mats.metal}>
            <boxGeometry args={[0.36, 0.05, 0.05]} />
          </mesh>
          <mesh ref={lampRef}>
            <sphereGeometry args={[0.15, 16, 12]} />
            <meshStandardMaterial
              color="#4b8ce8"
              emissive="#3f7dff"
              emissiveIntensity={1}
              roughness={0.2}
            />
          </mesh>
          <sprite ref={flareRef} scale={[1.2, 1.2, 1.2]}>
            <spriteMaterial map={flare} transparent depthWrite={false} opacity={0.3} />
          </sprite>
        </group>

        {/* windows either side, with sills and glazing bars */}
        {[-2.1, 2.1].map((z) => (
          <group key={z} position={[0, 1.85, z]}>
            <mesh position={[0.04, 0, 0]} material={mats.trim}>
              <boxGeometry args={[0.16, 1.35, 1.15]} />
            </mesh>
            <mesh position={[-0.05, 0, 0]} material={mats.glass}>
              <boxGeometry args={[0.06, 1.15, 0.95]} />
            </mesh>
            <mesh position={[-0.07, 0, 0]} material={mats.trim}>
              <boxGeometry args={[0.03, 1.16, 0.05]} />
            </mesh>
            <mesh position={[-0.07, 0, 0]} material={mats.trim}>
              <boxGeometry args={[0.03, 0.05, 0.96]} />
            </mesh>
            <mesh position={[0, -0.74, 0]} material={mats.concrete} castShadow>
              <boxGeometry args={[0.3, 0.1, 1.4]} />
            </mesh>
          </group>
        ))}

        {/* steps down to the forecourt */}
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            position={[-0.12 - i * 0.26, 0.34 - i * 0.13, 0]}
            material={mats.concrete}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.3 + i * 0.06, 0.14, 2.1 + i * 0.18]} />
          </mesh>
        ))}

        {/* bollards, a bin and a notice board — the clutter outside every station */}
        {[-1.9, 1.9].map((z) => (
          <group key={z} position={[-1.5, 0, z]}>
            <mesh position={[0, 0.34, 0]} material={mats.navy} castShadow>
              <cylinderGeometry args={[0.075, 0.09, 0.68, 10]} />
            </mesh>
            <mesh position={[0, 0.62, 0]} material={mats.trim}>
              <cylinderGeometry args={[0.078, 0.078, 0.09, 10]} />
            </mesh>
          </group>
        ))}
        <NoticeBoard position={[-0.9, 0, 3.55]} mats={mats} />
      </group>

      <Officer />
    </group>
  );
}

function NoticeBoard({
  position,
  mats,
}: {
  position: [number, number, number];
  mats: ReturnType<typeof useStationMaterials>;
}) {
  const notes = useMemo(() => {
    const r = rng(404);
    return Array.from({ length: 5 }, () => ({
      x: (r() - 0.5) * 0.7,
      y: (r() - 0.5) * 0.42,
      w: 0.16 + r() * 0.1,
      h: 0.2 + r() * 0.09,
      spin: (r() - 0.5) * 0.3,
      warm: r() > 0.6,
    }));
  }, []);
  return (
    <group position={position} rotation={[0, -Math.PI / 2, 0]}>
      {[-0.42, 0.42].map((x) => (
        <mesh key={x} position={[x, 0.6, 0]} material={mats.brick} castShadow>
          <boxGeometry args={[0.07, 1.2, 0.07]} />
        </mesh>
      ))}
      <mesh position={[0, 1.32, 0]} material={mats.navy} castShadow>
        <boxGeometry args={[1.05, 0.72, 0.08]} />
      </mesh>
      {notes.map((n, i) => (
        <mesh key={i} position={[n.x, 1.32 + n.y, 0.05]} rotation={[0, 0, n.spin]}>
          <planeGeometry args={[n.w, n.h]} />
          <meshStandardMaterial color={n.warm ? "#e8dfa8" : "#f3f1e8"} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// the officer
// ---------------------------------------------------------------------------

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

const officerGeo = {
  torso: () =>
    loft(
      [
        { z: 0, y: 0, rx: 0.17, ry: 0.11 },
        { z: 0.18, y: -0.01, rx: 0.185, ry: 0.115 },
        { z: 0.4, y: 0, rx: 0.21, ry: 0.125 },
        { z: 0.58, y: 0.005, rx: 0.235, ry: 0.13 },
        { z: 0.66, y: 0, rx: 0.2, ry: 0.12 },
      ],
      { radial: 18, segments: 24, square: 0.35 }
    ),
  skull: () =>
    loft(
      [
        { z: -0.11, y: 0, rx: 0.096, ry: 0.1 },
        { z: -0.02, y: 0.005, rx: 0.115, ry: 0.12 },
        { z: 0.06, y: -0.01, rx: 0.108, ry: 0.115 },
        { z: 0.12, y: -0.035, rx: 0.085, ry: 0.09 },
        { z: 0.145, y: -0.06, rx: 0.062, ry: 0.06 },
      ],
      { radial: 18, segments: 22 }
    ),
  vest: () =>
    loft(
      [
        { z: 0.1, y: 0, rx: 0.205, ry: 0.14 },
        { z: 0.26, y: 0.004, rx: 0.228, ry: 0.148 },
        { z: 0.46, y: 0.004, rx: 0.244, ry: 0.152 },
        { z: 0.58, y: 0, rx: 0.225, ry: 0.142 },
        { z: 0.62, y: -0.004, rx: 0.19, ry: 0.125 },
      ],
      { radial: 18, segments: 22, square: 0.42 }
    ),
  hiVis: () =>
    loft(
      [
        { z: 0.27, y: 0.004, rx: 0.233, ry: 0.153 },
        { z: 0.34, y: 0.004, rx: 0.236, ry: 0.155 },
      ],
      { radial: 18, segments: 4, caps: false, square: 0.42 }
    ),
  upperArm: () => limb(0.3, 0.062, 0.05, 0.045),
  foreArm: () => limb(0.29, 0.048, 0.042, 0.036),
  thigh: () => limb(0.46, 0.095, 0.08, 0.06),
  shin: () => limb(0.45, 0.062, 0.05, 0.045),
};

function useOfficerMaterials() {
  return useMemo(
    () => ({
      shirt: new THREE.MeshStandardMaterial({ color: "#8fa8cc", roughness: 0.85 }),
      vest: new THREE.MeshStandardMaterial({ color: NAVY_DARK, roughness: 0.8 }),
      trouser: new THREE.MeshStandardMaterial({ color: "#232838", roughness: 0.9 }),
      cap: new THREE.MeshStandardMaterial({ color: NAVY, roughness: 0.7 }),
      skin: new THREE.MeshStandardMaterial({ color: "#c9946f", roughness: 0.72 }),
      hair: new THREE.MeshStandardMaterial({ color: "#3b2f26", roughness: 0.95 }),
      boot: new THREE.MeshStandardMaterial({ color: "#171717", roughness: 0.45 }),
      belt: new THREE.MeshStandardMaterial({ color: "#14161d", roughness: 0.5 }),
      chrome: new THREE.MeshStandardMaterial({ color: "#c9cdd4", roughness: 0.3, metalness: 0.85 }),
      badge: new THREE.MeshStandardMaterial({
        color: "#e2b53c",
        roughness: 0.3,
        metalness: 0.7,
      }),
      hivis: new THREE.MeshStandardMaterial({
        color: HI_VIS,
        roughness: 0.7,
        emissive: HI_VIS,
        emissiveIntensity: 0.12,
      }),
      paper: new THREE.MeshStandardMaterial({ color: "#f7f4e8", roughness: 0.95 }),
      eye: new THREE.MeshStandardMaterial({ color: "#241a12", roughness: 0.15 }),
      mouth: new THREE.MeshStandardMaterial({ color: "#6b3a38", roughness: 0.6 }),
    }),
    []
  );
}

/**
 * Stands outside the door taking a statement. What he does is driven by who is
 * currently talking, so the notepad, the nodding and the jaw all stay locked to
 * the dialogue instead of running on their own clock.
 *
 * The rest of the time he is doing what anyone stood on a doorstep for an hour
 * does: shifting his weight, breathing, blinking, and looking down the road.
 */
function Officer() {
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
      nose: lumpGeometry(1717, 0.032, 0.12, 1),
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
  const headRef = useRef<THREE.Group>(null);
  const padArmRef = useRef<THREE.Group>(null);
  const padForeRef = useRef<THREE.Group>(null);
  const freeArmRef = useRef<THREE.Group>(null);
  const freeForeRef = useRef<THREE.Group>(null);
  const jawRef = useRef<THREE.Group>(null);
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

    // Weight shifts from one foot to the other every few seconds, and breathing
    // rides on top. Standing perfectly still is the tell of a mannequin.
    const shift = Math.sin(t * 0.31) * 0.6 + Math.sin(t * 0.19 + 1.3) * 0.4;
    const breath = Math.sin(t * 1.15);
    if (rootRef.current) {
      rootRef.current.position.y = Math.abs(shift) * -0.012 + breath * 0.006;
      rootRef.current.rotation.z = shift * 0.03;
    }
    if (hipsRef.current) {
      hipsRef.current.rotation.y = shift * 0.05;
      hipsRef.current.position.x = shift * 0.02;
    }
    if (chestRef.current) {
      chestRef.current.rotation.y = -shift * 0.07;
      chestRef.current.scale.set(1 + breath * 0.012, 1, 1 + breath * 0.02);
    }

    if (headRef.current) {
      if (talking) {
        // chin up, delivering the bad news
        headRef.current.rotation.x = -0.08 + Math.sin(t * 3.4) * 0.05;
        headRef.current.rotation.y = Math.sin(t * 1.9) * 0.12;
      } else if (listening) {
        // slow, unimpressed nodding while the cow makes its case
        headRef.current.rotation.x = 0.1 + Math.sin(t * 2.2) * 0.1;
        headRef.current.rotation.y = shift * 0.04;
      } else {
        headRef.current.rotation.x = Math.sin(t * 0.8) * 0.04;
        headRef.current.rotation.y = Math.sin(t * 0.37) * 0.35;
      }
    }

    // the notepad only comes up while there's a statement being given, and the
    // hand scribbles at it in bursts
    const scribble = listening ? Math.sin(t * 14) * 0.06 : 0;
    if (padArmRef.current) {
      padArmRef.current.rotation.x = inCutscene ? -0.85 + Math.sin(t * 1.3) * 0.06 : -0.08;
      padArmRef.current.rotation.z = inCutscene ? -0.28 : -0.06;
    }
    if (padForeRef.current) {
      padForeRef.current.rotation.x = inCutscene ? -1.15 + scribble : -0.25;
    }
    if (freeArmRef.current) {
      // a small "well, what did you expect" hand when it's his turn
      freeArmRef.current.rotation.x = talking ? -0.55 + Math.sin(t * 2.6) * 0.16 : -0.06;
      freeArmRef.current.rotation.z = talking ? 0.3 : 0.07;
    }
    if (freeForeRef.current) {
      freeForeRef.current.rotation.x = talking ? -1.1 + Math.sin(t * 3.1) * 0.25 : -0.3;
    }
    if (jawRef.current) {
      // the jaw only moves on his own lines, which is how you can tell who is
      // speaking without reading the bubble
      const open = talking ? Math.abs(Math.sin(t * 9)) * 0.32 + 0.04 : 0;
      jawRef.current.rotation.x = open;
      jawRef.current.position.z = -open * 0.012;
    }

    const b = blinkRef.current;
    b.next -= dt;
    if (b.next <= 0) {
      b.closing = 1;
      b.next = 2 + Math.random() * 4;
    }
    b.closing = Math.max(0, b.closing - dt * 8);
    const shut = Math.min(1, Math.sin(Math.min(1, b.closing) * Math.PI) * 1.8);
    lidRefs.current.forEach((lid) => {
      if (lid) lid.scale.y = 0.08 + shut * 1.15;
    });
  });



  return (
    <group position={[px, 0, pz]} rotation={[0, -Math.PI / 2, 0]}>
      <group ref={rootRef}>
        <group ref={hipsRef} position={[0, 0.94, 0]}>
          {/* legs */}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.11, 0, 0]} rotation={[0.03, 0, s * 0.02]}>
              <group rotation={down}>
                <mesh geometry={geo.thigh} material={mats.trouser} castShadow />
              </group>
              <group position={[0, -0.46, 0]} rotation={[-0.05, 0, 0]}>
                <group rotation={down}>
                  <mesh geometry={geo.shin} material={mats.trouser} castShadow />
                </group>
                <mesh position={[0, -0.47, 0.045]} material={mats.boot} castShadow>
                  <boxGeometry args={[0.11, 0.08, 0.25]} />
                </mesh>
                <mesh position={[0, -0.42, 0]} material={mats.boot} castShadow>
                  <boxGeometry args={[0.115, 0.11, 0.13]} />
                </mesh>
              </group>
            </group>
          ))}

          {/* torso, from the belt up */}
          <group ref={chestRef}>
            <group rotation={up}>
              <mesh geometry={geo.torso} material={mats.shirt} castShadow />
            </group>
            {/* stab vest over the shirt, and the band round it */}
            <group rotation={up}>
              <mesh geometry={geo.vest} material={mats.vest} castShadow />
              <mesh geometry={geo.hiVis} material={mats.hivis} />
            </group>
            <mesh position={[0.1, 0.47, 0.15]} material={mats.badge}>
              <boxGeometry args={[0.055, 0.07, 0.014]} />
            </mesh>
            {/* epaulettes */}
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.2, 0.58, 0]} material={mats.vest} castShadow>
                <boxGeometry args={[0.13, 0.045, 0.15]} />
              </mesh>
            ))}
            {/* belt kit */}
            <mesh position={[0, 0.03, 0]} material={mats.belt}>
              <boxGeometry args={[0.42, 0.09, 0.27]} />
            </mesh>
            <mesh position={[-0.2, 0.04, 0.02]} material={mats.belt} castShadow>
              <boxGeometry args={[0.07, 0.16, 0.08]} />
            </mesh>
            <mesh position={[0.2, 0.05, 0.02]} material={mats.chrome}>
              <boxGeometry args={[0.05, 0.11, 0.05]} />
            </mesh>
            {/* radio on the shoulder, aerial and all */}
            <mesh position={[-0.16, 0.5, 0.13]} material={mats.belt}>
              <boxGeometry args={[0.06, 0.1, 0.04]} />
            </mesh>
            <mesh position={[-0.16, 0.58, 0.13]} material={mats.belt}>
              <cylinderGeometry args={[0.006, 0.006, 0.09, 6]} />
            </mesh>

            {/* notepad arm */}
            <group ref={padArmRef} position={[0.24, 0.55, 0]} rotation={[-0.08, 0, -0.06]}>
              <group rotation={down}>
                <mesh geometry={geo.upperArm} material={mats.shirt} castShadow />
              </group>
              <group ref={padForeRef} position={[0, -0.3, 0]} rotation={[-0.25, 0, 0]}>
                <group rotation={down}>
                  <mesh geometry={geo.foreArm} material={mats.shirt} castShadow />
                </group>
                <mesh position={[0, -0.31, 0.01]} material={mats.skin} castShadow>
                  <boxGeometry args={[0.06, 0.1, 0.09]} />
                </mesh>
                <mesh position={[0, -0.34, 0.08]} rotation={[0.55, 0, 0]} material={mats.paper}>
                  <boxGeometry args={[0.16, 0.21, 0.012]} />
                </mesh>
              </group>
            </group>

            {/* free arm */}
            <group ref={freeArmRef} position={[-0.24, 0.55, 0]} rotation={[-0.06, 0, 0.07]}>
              <group rotation={down}>
                <mesh geometry={geo.upperArm} material={mats.shirt} castShadow />
              </group>
              <group ref={freeForeRef} position={[0, -0.3, 0]} rotation={[-0.3, 0, 0]}>
                <group rotation={down}>
                  <mesh geometry={geo.foreArm} material={mats.shirt} castShadow />
                </group>
                <mesh position={[0, -0.31, 0.01]} material={mats.skin} castShadow>
                  <boxGeometry args={[0.06, 0.1, 0.09]} />
                </mesh>
                {/* a pen, held ready */}
                <mesh position={[0, -0.34, 0.05]} rotation={[0.4, 0, 0]} material={mats.chrome}>
                  <cylinderGeometry args={[0.007, 0.007, 0.12, 6]} />
                </mesh>
              </group>
            </group>

            {/* neck */}
            <mesh position={[0, 0.63, 0]} material={mats.skin}>
              <cylinderGeometry args={[0.055, 0.07, 0.12, 10]} />
            </mesh>

            <group ref={headRef} position={[0, 0.735, 0]} scale={1.08}>
              <group rotation={[-Math.PI / 2, 0, 0]}>
                <mesh geometry={geo.skull} material={mats.skin} castShadow />
              </group>
              {/* jaw, hinged at the ears */}
              <group ref={jawRef} position={[0, -0.025, -0.02]}>
                <mesh position={[0, -0.05, 0.045]} scale={[1, 0.7, 1.05]} material={mats.skin} castShadow>
                  <sphereGeometry args={[0.077, 14, 10]} />
                </mesh>
                <mesh position={[0, -0.026, 0.104]} material={mats.mouth}>
                  <boxGeometry args={[0.042, 0.011, 0.014]} />
                </mesh>
              </group>
              <mesh
                geometry={geo.nose}
                material={mats.skin}
                position={[0, 0, 0.098]}
                scale={[0.72, 1.15, 0.95]}
              />
              {/* eyes, set into the skull, with lids that actually close */}
              {[-1, 1].map((s, i) => (
                <group key={s} position={[s * 0.045, 0.025, 0.088]}>
                  <mesh material={mats.eye}>
                    <sphereGeometry args={[0.016, 10, 8]} />
                  </mesh>
                  <mesh
                    ref={(m) => {
                      lidRefs.current[i] = m;
                    }}
                    position={[0, 0.012, 0.004]}
                    scale={[1, 0.08, 1]}
                    material={mats.skin}
                  >
                    <sphereGeometry args={[0.019, 10, 8]} />
                  </mesh>
                  <mesh position={[0, 0.032, 0.004]} rotation={[0, 0, -s * 0.2]} material={mats.hair}>
                    <boxGeometry args={[0.045, 0.009, 0.014]} />
                  </mesh>
                </group>
              ))}
              {/* ears */}
              {[-1, 1].map((s) => (
                <mesh key={s} position={[s * 0.098, -0.005, 0]} scale={[0.4, 1, 0.7]} material={mats.skin}>
                  <sphereGeometry args={[0.035, 10, 8]} />
                </mesh>
              ))}
              {/* peaked cap */}
              <group position={[0, 0.085, -0.005]}>
                <mesh material={mats.cap} castShadow>
                  <cylinderGeometry args={[0.125, 0.115, 0.085, 16]} />
                </mesh>
                <mesh position={[0, 0.045, 0]} material={mats.cap}>
                  <cylinderGeometry args={[0.128, 0.125, 0.02, 16]} />
                </mesh>
                <mesh position={[0, -0.03, 0]} material={mats.vest}>
                  <cylinderGeometry args={[0.122, 0.122, 0.038, 16]} />
                </mesh>
                {/* chequered band, the one thing that makes a cap read as police */}
                {Array.from({ length: 12 }, (_, i) => (
                  <mesh
                    key={i}
                    position={[
                      Math.sin((i / 12) * Math.PI * 2) * 0.123,
                      -0.03 + (i % 2 ? 0.009 : -0.009),
                      Math.cos((i / 12) * Math.PI * 2) * 0.123,
                    ]}
                    rotation={[0, (i / 12) * Math.PI * 2, 0]}
                  >
                    <boxGeometry args={[0.066, 0.019, 0.006]} />
                    <meshStandardMaterial color="#f0f2f6" roughness={0.8} />
                  </mesh>
                ))}
                <mesh position={[0, -0.028, 0.115]} rotation={[0.32, 0, 0]} material={mats.vest} castShadow>
                  <boxGeometry args={[0.185, 0.016, 0.11]} />
                </mesh>
                <mesh position={[0, 0.005, 0.113]} material={mats.badge}>
                  <boxGeometry args={[0.045, 0.05, 0.008]} />
                </mesh>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
