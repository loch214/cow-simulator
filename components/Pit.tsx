"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { cowState } from "@/lib/cowState";
import { bladeGeometry, loft, rng } from "@/lib/geometry";
import { dirtMap, discFadeMap, groundBump, woodMap } from "@/lib/textures";
import InstancedGroup, { type Placement } from "./Instanced";
import { FENCE_HEIGHT, GATE_WIDTH, PIT_RADIUS } from "@/lib/world";

const POSTS = 40;
const RAIL_HEIGHTS = [0.42, 0.82, 1.16];

/** Half-angle of the gap the gate fills, at the +X side of the ring. */
const GATE_HALF = GATE_WIDTH / 2 / PIT_RADIUS;

interface Segment {
  x: number;
  z: number;
  len: number;
  rotY: number;
}

function useFenceMaterials() {
  return useMemo(() => {
    const grain = woodMap();
    return {
      wood: new THREE.MeshStandardMaterial({ map: grain, roughness: 0.92, metalness: 0 }),
      post: new THREE.MeshStandardMaterial({
        map: grain,
        color: "#b9a48a",
        roughness: 0.95,
        metalness: 0,
      }),
      iron: new THREE.MeshStandardMaterial({ color: "#4a4640", roughness: 0.5, metalness: 0.7 }),
    };
  }, []);
}

/**
 * A post that was a tree once: it is not a box. The radius wanders up its length
 * and the top is cut at a slant to shed rain, which is the detail that stops a
 * ring of forty of them reading as a picket toy.
 */
const postGeo = (seed: number) => {
  const r = rng(seed);
  const rings = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const w = 0.075 * (1 - t * 0.18) * (0.9 + r() * 0.2);
    rings.push({
      z: t * FENCE_HEIGHT,
      x: (r() - 0.5) * 0.018,
      y: (r() - 0.5) * 0.018,
      rx: w,
      ry: w * (0.9 + r() * 0.2),
    });
  }
  // Stood upright in the geometry rather than by a wrapper group, so an instance
  // only ever needs one rotation and there is no order-of-composition to get wrong.
  return loft(rings, { radial: 9, segments: 14, square: 0.35 }).rotateX(-Math.PI / 2);
};

/**
 * A rail sags between its posts under its own weight.
 *
 * Turned to run along +X, because `rotY` for each fence segment is the tangent
 * angle for a rail whoseaxis is X. Leave it along the loft's native +Z and
 * every rail points at the middle of the pen instead of following the fence.
 */
const railGeo = (len: number) =>
  loft(
    [
      { z: -len / 2, y: 0, rx: 0.055, ry: 0.048 },
      { z: -len / 4, y: -0.012, rx: 0.05, ry: 0.045 },
      { z: 0, y: -0.018, rx: 0.048, ry: 0.043 },
      { z: len / 4, y: -0.012, rx: 0.05, ry: 0.045 },
      { z: len / 2, y: 0, rx: 0.055, ry: 0.048 },
    ],
    { radial: 8, segments: 12, square: 0.7 }
  ).rotateY(Math.PI / 2);

export default function Pit() {
  const mats = useFenceMaterials();

  const { posts, rails, railLen } = useMemo(() => {
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
      railLen: 2 * PIT_RADIUS * Math.sin(step / 2) + 0.02,
    };
  }, []);

  // Half a dozen post shapes, dealt out around the ring — enough that no two
  // neighbours match, cheap enough to stay six geometries.
  const postShapes = useMemo(() => [3, 17, 41, 59, 83, 101].map(postGeo), []);
  const rail = useMemo(() => railGeo(railLen), [railLen]);
  // No two neighbouring posts share a shape, a lean or a height, but there are
  // still only six geometries and six draw calls.
  const postItems = useMemo(() => {
    const r = rng(555);
    const buckets: Placement[][] = [[], [], [], [], [], []];
    for (const [x, z] of posts) {
      const lean = (r() - 0.5) * 0.09;
      const twist = r() * Math.PI * 2;
      const height = 0.92 + r() * 0.16;
      const shape = Math.floor(r() * 6);
      buckets[shape].push({
        pos: [x, 0, z],
        rot: [lean, twist, lean * 0.7],
        scale: [1, height, 1],
      });
    }
    return buckets;
  }, [posts]);

  const railItems = useMemo<Placement[]>(
    () =>
      rails.flatMap((seg) =>
        RAIL_HEIGHTS.map((h) => ({
          pos: [seg.x, h, seg.z] as [number, number, number],
          rot: [0, seg.rotY, 0] as [number, number, number],
        }))
      ),
    [rails]
  );

  return (
    <group>
      <PenFloor />

      {/* One instanced batch per post shape, and one for all hundred-odd rails. */}
      {postShapes.map((shape, k) => (
        <InstancedGroup
          key={k}
          geometry={shape}
          material={mats.post}
          items={postItems[k]}
          castShadow
          receiveShadow
        />
      ))}
      <InstancedGroup
        geometry={rail}
        material={mats.wood}
        items={railItems}
        castShadow
        receiveShadow
      />

      <FenceWeeds />
      <Gate />
    </group>
  );
}

/**
 * The pen floor: earth the cow has already trodden flat. It is laid over the
 * field rather than replacing it, and its edge is dissolved by a ragged alpha
 * mask, so the grass thins out into bare ground instead of stopping at a line.
 */
function PenFloor() {
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      map: dirtMap(),
      alphaMap: discFadeMap(),
      bumpMap: groundBump(),
      bumpScale: 0.25,
      transparent: true,
      roughness: 1,
      depthWrite: false,
    });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -4;
    return m;
  }, []);

  const worn = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#7d6446",
        alphaMap: discFadeMap(),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    []
  );

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]} material={mat} receiveShadow>
        <planeGeometry args={[PIT_RADIUS * 1.95, PIT_RADIUS * 1.95]} />
      </mesh>
      {/* the middle, where she stands about the most */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.6, 0.022, 0.4]} material={worn}>
        <planeGeometry args={[PIT_RADIUS * 1.1, PIT_RADIUS * 1.1]} />
      </mesh>
    </group>
  );
}

/**
 * Grass survives right at the foot of a fence, where nothing can reach it. It is
 * a small thing and it does more for the fence looking real than the fence does.
 */
function FenceWeeds() {
  const geo = useMemo(() => bladeGeometry(0.42, 0.055, 0.14, 4), []);
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        side: THREE.DoubleSide,
      }),
    []
  );
  const matrices = useMemo(() => {
    const r = rng(606);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const out: THREE.Matrix4[] = [];
    for (let i = 0; i < 900; i++) {
      const a = r() * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < GATE_HALF * 1.4) continue;
      const d = PIT_RADIUS + (r() - 0.45) * 0.5;
      pos.set(Math.cos(a) * d, -0.01, Math.sin(a) * d);
      e.set((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5);
      q.setFromEuler(e);
      scale.set(0.8 + r() * 0.5, 0.7 + r() * 0.8, 1);
      out.push(m.clone().compose(pos, q, scale));
    }
    return out;
  }, []);

  return (
    <instancedMesh
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

/** The one way out. Swings open only when the cow decides it's had enough. */
function Gate() {
  const mats = useFenceMaterials();
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
  const bar = useMemo(() => railGeo(len), [len]);

  return (
    <group ref={gateRef} position={[hinge.x, 0, hinge.z]} rotation={[0, hinge.rotY, 0]}>
      {RAIL_HEIGHTS.map((h) => (
        <mesh key={h} geometry={bar} material={mats.wood} position={[len / 2, h, 0]} castShadow />
      ))}
      {/* diagonal brace, so it reads as a gate and not three floating planks */}
      <mesh
        position={[len / 2, (RAIL_HEIGHTS[0] + RAIL_HEIGHTS[2]) / 2, 0]}
        rotation={[0, 0, Math.atan2(RAIL_HEIGHTS[2] - RAIL_HEIGHTS[0], len)]}
        material={mats.wood}
        castShadow
      >
        <boxGeometry args={[Math.hypot(len, RAIL_HEIGHTS[2] - RAIL_HEIGHTS[0]), 0.07, 0.05]} />
      </mesh>
      {/* stiles at each end */}
      {[0.06, len - 0.06].map((x) => (
        <mesh key={x} position={[x, 0.79, 0]} material={mats.post} castShadow>
          <boxGeometry args={[0.1, 0.9, 0.09]} />
        </mesh>
      ))}
      {/* hinge straps and a latch, because the eye goes straight to them */}
      {[RAIL_HEIGHTS[0], RAIL_HEIGHTS[2]].map((h) => (
        <mesh key={h} position={[0.16, h, 0.05]} material={mats.iron}>
          <boxGeometry args={[0.3, 0.04, 0.012]} />
        </mesh>
      ))}
      <mesh position={[len - 0.02, RAIL_HEIGHTS[1], 0.06]} material={mats.iron}>
        <boxGeometry args={[0.22, 0.035, 0.012]} />
      </mesh>
      <mesh position={[len + 0.04, RAIL_HEIGHTS[1] + 0.02, 0.06]} material={mats.iron}>
        <cylinderGeometry args={[0.018, 0.018, 0.14, 8]} />
      </mesh>
    </group>
  );
}
