"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import Officer from "./Officer";
import { rng } from "@/lib/geometry";
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
import { STATION } from "@/lib/world";

const NAVY = "#22335e";

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
