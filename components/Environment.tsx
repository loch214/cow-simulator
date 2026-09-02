"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { bladeGeometry, foliageGeometry, loft, lumpGeometry, rng } from "@/lib/geometry";
import {
  barkMap,
  dirtMap,
  fieldMap,
  groundBump,
  stripFadeMap,
  woodMap,
} from "@/lib/textures";
import InstancedGroup, { type Placement } from "./Instanced";
import { applySway, wind } from "@/lib/sway";
import { OBSTACLES, PIT_RADIUS, STATION } from "@/lib/world";

/** How far out the ground plane and the loose grass go. Beyond that: hills and haze. */
const FIELD_RADIUS = 34;

/** Advances the one wind clock. Mounted once, by `Environment`. */
function WindClock() {
  useFrame((state) => {
    wind.value = state.clock.elapsedTime;
  });
  return null;
}

// ---------------------------------------------------------------------------
// ground
// ---------------------------------------------------------------------------

function Ground() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: fieldMap(),
        bumpMap: groundBump(),
        bumpScale: 0.35,
        roughness: 0.95,
        metalness: 0,
      }),
    []
  );
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={mat}>
      <planeGeometry args={[180, 180]} />
    </mesh>
  );
}

/**
 * The track from the gate to the station. A rectangle of dirt with a hard edge
 * reads as a rug thrown on the grass, so the edges are dissolved by a ragged
 * alpha mask and the grass is left growing through them.
 */
function Road() {
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      map: dirtMap(),
      alphaMap: stripFadeMap(),
      bumpMap: groundBump(),
      bumpScale: 0.2,
      transparent: true,
      roughness: 1,
      depthWrite: false,
    });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    return m;
  }, []);

  const from = PIT_RADIUS - 0.6;
  const to = STATION.x - 1.6;
  const len = to - from;

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[(from + to) / 2, 0.012, 0]}
      material={mat}
      receiveShadow
    >
      <planeGeometry args={[len, 3.4]} />
    </mesh>
  );
}

/**
 * Wheel ruts down the middle of the track. Two darker strips are the cheapest
 * possible way to say "things drive down here".
 */
function Ruts() {
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#6b5439",
        transparent: true,
        opacity: 0.28,
        alphaMap: stripFadeMap(),
        depthWrite: false,
      }),
    []
  );
  const from = PIT_RADIUS + 0.4;
  const to = STATION.x - 2.2;
  return (
    <>
      {[-0.62, 0.62].map((z) => (
        <mesh
          key={z}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[(from + to) / 2, 0.02, z]}
          material={mat}
        >
          <planeGeometry args={[to - from, 0.46]} />
        </mesh>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// loose grass
// ---------------------------------------------------------------------------

/** True where the ground is trodden bare and grass should not grow. */
function isBare(x: number, z: number): boolean {
  if (Math.hypot(x, z) < PIT_RADIUS - 0.35) return true; // the pen floor
  if (Math.abs(z) < 1.6 && x > PIT_RADIUS - 1 && x < STATION.x - 1) return true; // the road
  if (Math.abs(x - STATION.x) < 4 && Math.abs(z) < 4.5) return true; // the station yard
  return false;
}

/**
 * The field, one blade at a time. Fifteen thousand of them is a single draw call
 * as an InstancedMesh, and the whole reason the ground stops looking like a
 * painted plane: from the cow's eye height you can see individual blades move.
 */
function GrassField({ count = 15000 }: { count?: number }) {
  const geo = useMemo(() => bladeGeometry(0.34, 0.05, 0.1, 4), []);
  const mat = useMemo(
    () =>
      applySway(
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.9,
          side: THREE.DoubleSide,
        }),
        0.34,
        0.055
      ),
    []
  );

  const matrices = useMemo(() => {
    const r = rng(4242);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const out: THREE.Matrix4[] = [];
    let guard = 0;
    while (out.length < count && guard++ < count * 6) {
      // denser near the pen, thinning out towards the haze
      const a = r() * Math.PI * 2;
      const d = Math.pow(r(), 0.62) * FIELD_RADIUS;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (isBare(x, z)) continue;
      const h = 0.6 + r() * 0.85;
      pos.set(x, -0.01, z);
      e.set((r() - 0.5) * 0.35, r() * Math.PI * 2, (r() - 0.5) * 0.35);
      q.setFromEuler(e);
      scale.set(0.7 + r() * 0.6, h, 1);
      out.push(m.clone().compose(pos, q, scale));
    }
    return out;
  }, [count]);

  return (
    <instancedMesh
      // Instances live in the matrix buffer, so they have to be uploaded once the
      // mesh exists. The bounding sphere only covers a single blade, so culling
      // has to be off or the whole field vanishes when you look away from origin.
      ref={(mesh) => {
        if (!mesh) return;
        matrices.forEach((mat4, i) => mesh.setMatrixAt(i, mat4));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
      }}
      args={[geo, mat, matrices.length]}
    />
  );
}

/** Buttercups and daisies, scattered where the grass is thickest. */
function Flowers() {
  const geo = useMemo(() => new THREE.SphereGeometry(0.035, 6, 5), []);
  const white = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#f6f2e2", roughness: 0.8 }),
    []
  );
  const yellow = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#e8c33f", roughness: 0.8 }),
    []
  );

  const [warmSpots, coolSpots] = useMemo(() => {
    const r = rng(77);
    const warm: Placement[] = [];
    const cool: Placement[] = [];
    let guard = 0;
    while (warm.length + cool.length < 240 && guard++ < 3000) {
      const a = r() * Math.PI * 2;
      const d = 3 + Math.pow(r(), 0.7) * (FIELD_RADIUS - 4);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (isBare(x, z)) continue;
      const item: Placement = {
        pos: [x, 0.14 + r() * 0.12, z],
        rot: [0, r() * Math.PI, 0],
        scale: [1, 0.55, 1],
      };
      (r() > 0.45 ? warm : cool).push(item);
    }
    return [warm, cool];
  }, []);

  return (
    <group>
      <InstancedGroup geometry={geo} material={yellow} items={warmSpots} />
      <InstancedGroup geometry={geo} material={white} items={coolSpots} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// trees
// ---------------------------------------------------------------------------

interface TreeParts {
  trunk: THREE.BufferGeometry;
  branches: { geo: THREE.BufferGeometry; pos: [number, number, number]; rot: [number, number, number] }[];
  canopy: { geo: THREE.BufferGeometry; pos: [number, number, number]; scale: number; dark: boolean }[];
}

/**
 * A tree grown from numbers: a trunk that flares into roots and tapers to a
 * crown, a handful of branches leaning out of it, and overlapping blobs of
 * foliage. Four variants are built and then reused at different scales — the
 * silhouette is what makes them read as different trees, not the leaf count.
 */
function buildTree(seed: number): TreeParts {
  const r = rng(seed);
  // Shorter and thicker than the first pass: a tall bare pole with a ball on top
  // is a lollipop, not a tree. The crown has to start low enough that the trunk
  // disappears into it.
  const height = 2.5 + r() * 1.1;
  const thick = 0.2 + r() * 0.08;

  const trunk = loft(
    [
      { z: 0, x: 0, rx: thick * 1.9, ry: thick * 1.9 },
      { z: 0.22, x: 0, rx: thick * 1.25, ry: thick * 1.25 },
      { z: height * 0.35, x: (r() - 0.5) * 0.18, rx: thick, ry: thick },
      { z: height * 0.7, x: (r() - 0.5) * 0.3, rx: thick * 0.72, ry: thick * 0.72 },
      { z: height, x: (r() - 0.5) * 0.4, rx: thick * 0.4, ry: thick * 0.4 },
    ],
    { radial: 12, segments: 22 }
  );

  // Boughs leave the trunk steeply and end inside the crown, so they read as
  // structure glimpsed through leaves rather than spikes stuck on the outside.
  const branches: TreeParts["branches"] = [];
  const count = 4 + Math.floor(r() * 3);
  for (let i = 0; i < count; i++) {
    const len = 0.7 + r() * 0.55;
    branches.push({
      geo: loft(
        [
          { z: 0, rx: thick * 0.5, ry: thick * 0.5 },
          { z: len * 0.6, rx: thick * 0.26, ry: thick * 0.26 },
          { z: len, rx: thick * 0.08, ry: thick * 0.08 },
        ],
        { radial: 8, segments: 10 }
      ),
      pos: [0, height * (0.62 + r() * 0.28), 0],
      rot: [-0.95 - r() * 0.45, (i / count) * Math.PI * 2 + r() * 0.6, 0],
    });
  }

  // Two shells of foliage: a wide, dark inner mass and lighter clumps hung
  // around its edge, which is what gives a canopy depth instead of a silhouette.
  const canopy: TreeParts["canopy"] = [];
  const crown = height * 0.92;
  canopy.push({ geo: foliageGeometry(seed * 97, 1.05), pos: [0, crown + 0.25, 0], scale: 1, dark: true });
  canopy.push({ geo: foliageGeometry(seed * 89, 0.9), pos: [0, crown + 0.75, 0], scale: 0.95, dark: true });
  const blobs = 8 + Math.floor(r() * 3);
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + r() * 0.5;
    const spread = 0.55 + r() * 0.55;
    const rise = crown + 0.1 + r() * 0.95;
    canopy.push({
      geo: foliageGeometry(seed * 31 + i, 0.5 + r() * 0.26),
      pos: [Math.cos(a) * spread, rise, Math.sin(a) * spread],
      scale: 0.9 + r() * 0.35,
      dark: i % 3 === 0,
    });
  }

  return { trunk, branches, canopy };
}

function Trees() {
  const kinds = useMemo(() => [11, 29, 53, 71].map(buildTree), []);
  const mats = useMemo(() => {
    const bark = new THREE.MeshStandardMaterial({ map: barkMap(), roughness: 0.95 });
    return {
      bark,
      // Smooth-shaded: `foliageGeometry` welds its seams so the normals blend,
      // and a faceted crown reads as crumpled paper rather than leaves.
      leafDark: applySway(
        new THREE.MeshStandardMaterial({ color: "#33682c", roughness: 0.95 }),
        3,
        0.045
      ),
      leafLit: applySway(
        new THREE.MeshStandardMaterial({ color: "#55913c", roughness: 0.95 }),
        3,
        0.045
      ),
    };
  }, []);

  const spots = useMemo(() => {
    const r = rng(1234);
    const out: { x: number; z: number; kind: number; scale: number; spin: number }[] = [];
    const ring: [number, number][] = [
      [-13, -7], [-16, 5], [-9, 14], [5, -15], [14, -12],
      [11, 13], [21, 10], [25, -9], [-3, 18], [28, 4],
      [-21, -14], [18, 18], [-24, 8], [7, 22], [-14, -19],
      [30, -16], [24, 20], [-29, -3],
    ];
    for (const [x, z] of ring) {
      out.push({
        x: x + (r() - 0.5) * 2,
        z: z + (r() - 0.5) * 2,
        kind: Math.floor(r() * 4),
        scale: 0.85 + r() * 0.7,
        spin: r() * Math.PI * 2,
      });
    }
    return out;
  }, []);

  return (
    <group>
      {spots.map((s, i) => {
        const t = kinds[s.kind];
        return (
          <group key={i} position={[s.x, 0, s.z]} rotation={[0, s.spin, 0]} scale={s.scale}>
            <group rotation={[-Math.PI / 2, 0, 0]}>
              <mesh geometry={t.trunk} material={mats.bark} castShadow receiveShadow />
            </group>
            {t.branches.map((b, j) => (
              <group key={j} position={b.pos} rotation={[b.rot[0] + Math.PI / 2, 0, 0]}>
                <group rotation={[0, 0, b.rot[1]]}>
                  <mesh geometry={b.geo} material={mats.bark} castShadow />
                </group>
              </group>
            ))}
            {t.canopy.map((c, j) => (
              <mesh
                key={j}
                geometry={c.geo}
                material={c.dark ? mats.leafDark : mats.leafLit}
                position={c.pos}
                scale={c.scale}
                castShadow
              />
            ))}
          </group>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// props
// ---------------------------------------------------------------------------

/** Rocks, mostly to break up the far ground and catch the sun. */
function Rocks() {
  const geos = useMemo(() => [1, 2, 3, 4].map((i) => lumpGeometry(500 + i, 0.3, 0.38, 1)), []);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#8d8b83", roughness: 0.95, flatShading: true }),
    []
  );
  const buckets = useMemo(() => {
    const r = rng(31337);
    const out: Placement[][] = [[], [], [], []];
    let guard = 0;
    let placed = 0;
    while (placed < 26 && guard++ < 400) {
      const a = r() * Math.PI * 2;
      const d = 9 + r() * (FIELD_RADIUS - 10);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (isBare(x, z)) continue;
      const scale = 0.4 + r() * 1.1;
      out[Math.floor(r() * 4)].push({
        pos: [x, scale * 0.1, z],
        rot: [0, r() * 6.28, 0],
        scale,
      });
      placed++;
    }
    return out;
  }, []);

  return (
    <group>
      {geos.map((g, i) => (
        <InstancedGroup key={i} geometry={g} material={mat} items={buckets[i]} castShadow receiveShadow />
      ))}
    </group>
  );
}

/** A galvanised water trough in the pen. Cows need somewhere to drink. */
function Trough({ position }: { position: [number, number, number] }) {
  const mats = useMemo(
    () => ({
      metal: new THREE.MeshStandardMaterial({ color: "#8a9099", roughness: 0.45, metalness: 0.5 }),
      water: new THREE.MeshStandardMaterial({
        color: "#3f6d78",
        roughness: 0.08,
        metalness: 0.2,
        transparent: true,
        opacity: 0.85,
      }),
      wood: new THREE.MeshStandardMaterial({ map: woodMap(), roughness: 0.9 }),
    }),
    []
  );
  const shell = useMemo(
    () =>
      loft(
        [
          { z: 0, rx: 0.34, ry: 0.24 },
          { z: 0.3, rx: 0.36, ry: 0.26 },
          { z: 0.9, rx: 0.36, ry: 0.26 },
          { z: 1.2, rx: 0.34, ry: 0.24 },
        ],
        { radial: 18, segments: 18, square: 0.75 }
      ),
    []
  );
  const water = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    // barely moving, but not dead still
    if (water.current) {
      water.current.position.y = 0.42 + Math.sin(state.clock.elapsedTime * 0.9) * 0.004;
    }
  });

  return (
    <group position={position}>
      <group position={[0, 0.27, -0.6]}>
        <mesh geometry={shell} material={mats.metal} castShadow receiveShadow />
      </group>
      <mesh ref={water} position={[0, 0.42, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.water}>
        <planeGeometry args={[0.6, 1.1]} />
      </mesh>
      {[-0.45, 0.45].map((z) => (
        <mesh key={z} position={[0, 0.04, z]} material={mats.wood} castShadow>
          <boxGeometry args={[0.78, 0.08, 0.12]} />
        </mesh>
      ))}
    </group>
  );
}

/** A round bale, wrapped in string. */
function HayBale({ position, spin = 0 }: { position: [number, number, number]; spin?: number }) {
  const mats = useMemo(
    () => ({
      hay: new THREE.MeshStandardMaterial({ color: "#c9ab63", roughness: 1 }),
      end: new THREE.MeshStandardMaterial({ color: "#b0904d", roughness: 1 }),
      string: new THREE.MeshStandardMaterial({ color: "#8b7a52", roughness: 0.9 }),
    }),
    []
  );
  return (
    <group position={position} rotation={[0, spin, Math.PI / 2]}>
      <mesh castShadow receiveShadow material={mats.hay}>
        <cylinderGeometry args={[0.62, 0.62, 0.95, 22]} />
      </mesh>
      {[-0.481, 0.481].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.end}>
          <circleGeometry args={[0.6, 22]} />
        </mesh>
      ))}
      {[-0.28, 0, 0.28].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.string}>
          <torusGeometry args={[0.625, 0.012, 6, 24]} />
        </mesh>
      ))}
    </group>
  );
}

/** Low rolling ground on the horizon, so the field does not end in a hard line. */
function Hills() {
  // `smooth` welds the icosahedron before displacing it, so a hill is a rolling
  // shape and not a heap of triangles.
  const geos = useMemo(() => [1, 2, 3].map((i) => lumpGeometry(880 + i, 1, 0.26, 3, true)), []);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#68855080", roughness: 1 }),
    []
  );
  const spots = useMemo(() => {
    const r = rng(9);
    return Array.from({ length: 22 }, (_, i) => {
      const a = (i / 22) * Math.PI * 2 + r() * 0.2;
      const d = 72 + r() * 34;
      return {
        x: Math.cos(a) * d,
        z: Math.sin(a) * d,
        w: 22 + r() * 30,
        h: 5 + r() * 9,
        k: i % 3,
      };
    });
  }, []);
  return (
    <group>
      {spots.map((s, i) => (
        <mesh
          key={i}
          geometry={geos[s.k]}
          material={mat}
          position={[s.x, -s.h * 0.25, s.z]}
          scale={[s.w, s.h, s.w * 0.8]}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------

export default function Environment() {
  return (
    <group>
      <WindClock />
      <Ground />
      <Hills />
      <Road />
      <Ruts />
      <GrassField />
      <Flowers />
      <Rocks />
      <Trees />
      {/* Positions come from OBSTACLES so the models and the collision agree. */}
      <Trough position={[OBSTACLES[0].x, 0, OBSTACLES[0].z]} />
      {OBSTACLES.slice(1).map((ob, i) => (
        <HayBale key={i} position={[ob.x, 0.62, ob.z]} spin={ob.spin ?? 0} />
      ))}
    </group>
  );
}
