"use client";

/**
 * Everything in the field beyond the fence.
 *
 * The pen was the whole game until the gate opened, so this file is the reward
 * for getting out of it: a scarecrow to shout at, a pond to drink out of, a
 * speed camera on the road, and a flock of sheep that want nothing to do with
 * any of it.
 *
 * Two rules hold the whole file together:
 *
 * - **Positions come from `lib/world.ts`.** The cow's collision reads the same
 *   table, so nothing here can be nudged in one place and left solid in the
 *   other. That is the same rule the trough and the hay bales already follow.
 * - **Nothing here owns any game state.** The scarecrow spins because
 *   `scareSeq` in the store went up; the sheep run because `cowState` says the
 *   cow is close. Neither of them can get out of step with the thing that
 *   caused it.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useCowStore } from "@/lib/store";
import { cowState } from "@/lib/cowState";
import { bladeGeometry, loft, lumpGeometry, rng } from "@/lib/geometry";
import { applySway } from "@/lib/sway";
import { dirtMap, discFadeMap, woodMap } from "@/lib/textures";
import { baa } from "@/lib/audio";
import { POND, resolveSolids, SCARECROW, SHEEP_HOME, SPEED_TRAP } from "@/lib/world";

// ---------------------------------------------------------------------------
// the scarecrow
// ---------------------------------------------------------------------------

/** How long the spin takes after a bellow, in seconds. */
const SPIN_TIME = 1.6;

/** Which way the scarecrow looks: back down the field at the pen. */
const FACE_PEN = Math.atan2(-SCARECROW.x, -SCARECROW.z);

/**
 * A cross of stakes in a shirt, with a sack for a head and a hat that is only
 * balanced on top of it.
 *
 * The joke is that it is scared of the cow rather than the other way round: a
 * bellow spins it round on its post and knocks the hat off, and it spends the
 * next few seconds putting itself back together.
 */
function Scarecrow() {
  const mats = useMemo(
    () => ({
      post: new THREE.MeshStandardMaterial({ map: woodMap(), roughness: 0.95 }),
      sack: new THREE.MeshStandardMaterial({ color: "#c8ab74", roughness: 1 }),
      shirt: new THREE.MeshStandardMaterial({ color: "#8d4a44", roughness: 0.95 }),
      hat: new THREE.MeshStandardMaterial({ color: "#a8823f", roughness: 1 }),
      straw: new THREE.MeshStandardMaterial({ color: "#d7bb6f", roughness: 1 }),
      ink: new THREE.MeshStandardMaterial({ color: "#2a231c", roughness: 0.8 }),
    }),
    []
  );

  const geo = useMemo(
    () => ({
      post: loft(
        [
          { z: 0, rx: 0.075, ry: 0.075 },
          { z: 0.9, rx: 0.06, ry: 0.06 },
          { z: 1.7, rx: 0.05, ry: 0.05 },
        ],
        { radial: 8, segments: 12, square: 0.4 }
      ).rotateX(-Math.PI / 2),
      arm: loft(
        [
          { z: -0.62, rx: 0.042, ry: 0.042 },
          { z: 0, rx: 0.05, ry: 0.05 },
          { z: 0.62, rx: 0.04, ry: 0.04 },
        ],
        { radial: 8, segments: 10, square: 0.4 }
      ).rotateY(Math.PI / 2),
      head: lumpGeometry(4242, 0.2, 0.12, 2, true),
      // the straw sticking out of the cuffs and the collar
      tuft: loft(
        [
          { z: 0, rx: 0.012, ry: 0.012 },
          { z: 0.1, rx: 0.008, ry: 0.008 },
          { z: 0.17, rx: 0.002, ry: 0.002 },
        ],
        { radial: 5, segments: 6 }
      ),
    }),
    []
  );

  const cuffStraw = useMemo(() => {
    const r = rng(515);
    return Array.from({ length: 14 }, (_, i) => {
      const side = i < 7 ? -1 : 1;
      const a = r() * Math.PI * 2;
      return {
        pos: [side * 0.62, 1.25, 0] as [number, number, number],
        rot: [
          (r() - 0.5) * 1.1,
          side * (0.9 + r() * 0.6),
          a,
        ] as [number, number, number],
      };
    });
  }, []);

  const spinRef = useRef<THREE.Group>(null);
  const hatRef = useRef<THREE.Group>(null);
  /** Seconds since the last bellow, or -1 if nothing has happened yet. */
  const since = useRef(-1);
  const scareSeq = useCowStore((s) => s.scareSeq);

  useEffect(() => {
    if (scareSeq > 0) since.current = 0;
  }, [scareSeq]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const spin = spinRef.current;
    const hat = hatRef.current;
    if (!spin || !hat) return;

    // Idle: it turns very slowly in the breeze, and that is all.
    const drift = Math.sin(t * 0.21) * 0.22 + Math.sin(t * 0.13 + 1.4) * 0.14;

    if (since.current < 0) {
      spin.rotation.y = drift;
      hat.position.set(0, 1.82, 0);
      hat.rotation.set(0, 0.2, 0.06);
      return;
    }

    since.current += Math.min(delta, 0.05);
    const u = Math.min(1, since.current / SPIN_TIME);
    // three turns, easing out — a scared thing does not spin at a steady rate
    const eased = 1 - Math.pow(1 - u, 3);
    spin.rotation.y = drift + eased * Math.PI * 6;

    // The hat goes up, comes down, lies in the grass for a few seconds and
    // then puts itself back on — which is funnier than either leaving it off
    // or never dropping it.
    const RETURN_AT = 4.2;
    const off =
      since.current < RETURN_AT
        ? Math.min(1, since.current / 0.9)
        : Math.max(0, 1 - (since.current - RETURN_AT) / 0.8);
    const hop = Math.sin(Math.min(1, since.current / 0.9) * Math.PI) * 0.45;
    hat.position.set(off * 0.5, 1.82 + hop * (since.current < 1 ? 1 : 0) - off * 1.7, off * 0.22);
    hat.rotation.set(off * 1.5, 0.2 + off * 2.4, 0.06 + off * 0.4);
  });

  return (
    // Turned to face the pen. Without this it has a fifty-fifty chance of
    // standing with its back to the only thing that ever comes near it.
    <group position={[SCARECROW.x, 0, SCARECROW.z]} rotation={[0, FACE_PEN, 0]}>
      <mesh geometry={geo.post} material={mats.post} castShadow />
      <group ref={spinRef} position={[0, 0, 0]}>
        {/* the cross-piece the arms hang off */}
        <mesh geometry={geo.arm} material={mats.post} position={[0, 1.25, 0]} castShadow />
        {/* the shirt, straight off the cross */}
        <mesh position={[0, 1.05, 0]} material={mats.shirt} castShadow>
          <cylinderGeometry args={[0.2, 0.26, 0.62, 10]} />
        </mesh>
        <mesh position={[0, 1.25, 0]} material={mats.shirt} castShadow>
          <boxGeometry args={[0.95, 0.16, 0.17]} />
        </mesh>
        {cuffStraw.map((s, i) => (
          <group key={i} position={s.pos} rotation={s.rot}>
            <mesh geometry={geo.tuft} material={mats.straw} />
          </group>
        ))}
        {/* sacking head, with a face drawn on it by somebody in a hurry */}
        <mesh geometry={geo.head} material={mats.sack} position={[0, 1.62, 0]} castShadow />
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.07, 1.66, 0.17]} material={mats.ink}>
            <boxGeometry args={[0.05, 0.05, 0.02]} />
          </mesh>
        ))}
        <mesh position={[0, 1.55, 0.17]} rotation={[0, 0, 0.1]} material={mats.ink}>
          <boxGeometry args={[0.12, 0.022, 0.02]} />
        </mesh>
      </group>
      {/* The hat is NOT inside the spinning group: it comes off. */}
      <group ref={hatRef} position={[0, 1.82, 0]} rotation={[0, 0.2, 0.06]}>
        <mesh material={mats.hat} castShadow>
          <cylinderGeometry args={[0.15, 0.17, 0.12, 12]} />
        </mesh>
        <mesh position={[0, -0.06, 0]} material={mats.hat} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 0.025, 14]} />
        </mesh>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// the pond
// ---------------------------------------------------------------------------

/**
 * Shallow, muddy and full of reeds. The cow can wade into it — it is not solid
 * — so the water plane sits low and the ripples are driven off how fast the cow
 * is moving through it, which is most of what makes it read as water rather
 * than a blue disc.
 */
function Pond() {
  const mats = useMemo(
    () => ({
      water: new THREE.MeshStandardMaterial({
        color: "#3d6a63",
        roughness: 0.08,
        metalness: 0.25,
        transparent: true,
        opacity: 0.88,
      }),
      mud: (() => {
        const m = new THREE.MeshStandardMaterial({
          map: dirtMap(),
          alphaMap: discFadeMap(),
          color: "#6d5a42",
          transparent: true,
          roughness: 1,
          depthWrite: false,
        });
        m.polygonOffset = true;
        m.polygonOffsetFactor = -3;
        return m;
      })(),
      reed: applySway(
        new THREE.MeshStandardMaterial({
          color: "#6b7f3a",
          roughness: 0.9,
          side: THREE.DoubleSide,
        }),
        0.9,
        0.09
      ),
    }),
    []
  );

  const reedGeo = useMemo(() => bladeGeometry(0.9, 0.06, 0.1, 5), []);
  const reeds = useMemo(() => {
    const r = rng(818);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    return Array.from({ length: 220 }, () => {
      const a = r() * Math.PI * 2;
      // clustered on the rim, thinning both inwards and outwards
      const d = POND.r * (0.82 + (r() - 0.4) * 0.32);
      pos.set(POND.x + Math.cos(a) * d, -0.02, POND.z + Math.sin(a) * d);
      e.set((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5);
      q.setFromEuler(e);
      scale.set(0.7 + r() * 0.6, 0.7 + r() * 0.9, 1);
      return m.clone().compose(pos, q, scale);
    });
  }, []);

  const water = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const mesh = water.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    // A cow standing in it makes more of a mess than the wind does.
    const wading =
      Math.hypot(cowState.x - POND.x, cowState.z - POND.z) < POND.r
        ? Math.min(1, cowState.speed * 0.6 + 0.3)
        : 0;
    mesh.position.y = 0.05 + Math.sin(t * 1.1) * 0.005 + Math.sin(t * 7) * 0.012 * wading;
    const s = 1 + Math.sin(t * 5.5) * 0.004 * wading;
    mesh.scale.set(s, s, 1);
  });

  return (
    <group>
      {/* the mud ring, laid over the field so the grass thins into it */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[POND.x, 0.014, POND.z]}
        material={mats.mud}
        receiveShadow
      >
        <planeGeometry args={[POND.r * 2.9, POND.r * 2.9]} />
      </mesh>
      <mesh
        ref={water}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[POND.x, 0.05, POND.z]}
        material={mats.water}
      >
        <circleGeometry args={[POND.r, 40]} />
      </mesh>
      <instancedMesh
        ref={(mesh) => {
          if (!mesh) return;
          reeds.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
          mesh.frustumCulled = false;
        }}
        args={[reedGeo, mats.reed, reeds.length]}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// the speed camera
// ---------------------------------------------------------------------------

/**
 * A grey box on a pole beside the road, complete with the painted lines on the
 * tarmac. It goes off when the cow gallops past — see `checkSpeedTrap` in
 * components/Cow.tsx — and the flash is the only part of it that is animated.
 */
function SpeedCamera() {
  const mats = useMemo(
    () => ({
      post: new THREE.MeshStandardMaterial({ color: "#6f7276", roughness: 0.6, metalness: 0.3 }),
      box: new THREE.MeshStandardMaterial({ color: "#8a8d90", roughness: 0.55, metalness: 0.2 }),
      dark: new THREE.MeshStandardMaterial({ color: "#1d1f22", roughness: 0.4 }),
      lens: new THREE.MeshStandardMaterial({
        color: "#20242b",
        roughness: 0.15,
        emissive: "#ffffff",
        emissiveIntensity: 0,
      }),
      paint: new THREE.MeshBasicMaterial({ color: "#e8e4d8", transparent: true, opacity: 0.5 }),
    }),
    []
  );

  const lensRef = useRef<THREE.Mesh>(null);
  const flashSeq = useCowStore((s) => s.flashSeq);
  const firedAt = useRef(-1);

  useEffect(() => {
    if (flashSeq > 0) firedAt.current = 0;
  }, [flashSeq]);

  useFrame((_, delta) => {
    const lens = lensRef.current;
    if (!lens) return;
    const m = lens.material as THREE.MeshStandardMaterial;
    if (firedAt.current < 0) {
      m.emissiveIntensity = 0;
      return;
    }
    firedAt.current += Math.min(delta, 0.05);
    // two pops, 0.12s apart, matching the shutter sound
    const t = firedAt.current;
    const pop = (at: number) => Math.max(0, 1 - Math.abs(t - at) / 0.06);
    m.emissiveIntensity = Math.max(pop(0.02), pop(0.14)) * 9;
    if (t > 0.4) firedAt.current = -1;
  });

  // Turned to look back down the road at the pen, which is where the cow is
  // coming from.
  const face = Math.atan2(-SPEED_TRAP.z, -SPEED_TRAP.x);

  return (
    <group position={[SPEED_TRAP.x, 0, SPEED_TRAP.z]}>
      <mesh position={[0, 1.1, 0]} material={mats.post} castShadow>
        <cylinderGeometry args={[0.055, 0.075, 2.2, 10]} />
      </mesh>
      <group position={[0, 2.2, 0]} rotation={[0, face, 0]}>
        <mesh material={mats.box} castShadow>
          <boxGeometry args={[0.34, 0.4, 0.5]} />
        </mesh>
        {/* hood over the lens, so it reads as a camera and not a junction box */}
        <mesh position={[0, 0.06, 0.29]} rotation={[0.12, 0, 0]} material={mats.dark} castShadow>
          <boxGeometry args={[0.3, 0.16, 0.12]} />
        </mesh>
        <mesh ref={lensRef} position={[0, 0.02, 0.27]} material={mats.lens}>
          <cylinderGeometry args={[0.08, 0.08, 0.06, 14]} />
        </mesh>
        <mesh position={[0, -0.24, 0]} material={mats.dark}>
          <boxGeometry args={[0.2, 0.1, 0.2]} />
        </mesh>
      </group>
      {/* the measuring lines painted across the track */}
      {[-0.8, -0.2, 0.4, 1.0].map((d) => (
        <mesh
          key={d}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[d, 0.024, -SPEED_TRAP.z - 0.4]}
          material={mats.paint}
        >
          <planeGeometry args={[0.14, 1.9]} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// the sheep
// ---------------------------------------------------------------------------

const FLOCK = 6;
/** How close the cow gets before a sheep gives up on grazing. */
const SPOOK = 4.2;
const SHEEP_SPEED = 3.4;

/**
 * Where each sheep is, right now.
 *
 * Module state rather than a `useMemo`, for the same reason `cowState` is: it
 * changes sixty times a second and nothing should re-render for it. (The lint
 * config also refuses to let a frame callback mutate a memo result, which is
 * the same rule stated from the other end.) There is only ever one flock.
 */
interface SheepState {
  x: number;
  z: number;
  facing: number;
  /** Where it would rather be standing. */
  homeX: number;
  homeZ: number;
  bob: number;
  fled: boolean;
  cooldown: number;
}

const flock: SheepState[] = (() => {
  const r = rng(9090);
  return Array.from({ length: FLOCK }, () => {
    const a = r() * Math.PI * 2;
    const d = r() * 3.4;
    const x = SHEEP_HOME.x + Math.cos(a) * d;
    const z = SHEEP_HOME.z + Math.sin(a) * d;
    return {
      x,
      z,
      facing: r() * Math.PI * 2,
      homeX: x,
      homeZ: z,
      bob: r() * 6.28,
      fled: false,
      cooldown: 0,
    };
  });
})();

/**
 * A small flock, which exists for one reason: the field outside the fence was
 * empty, and an empty field reads as unfinished however many trees are in it.
 *
 * They graze in a loose clump and bolt the moment the cow gets close, then
 * settle down again a little further off — so the cow can herd them right
 * across the field, which turns out to be the most fun thing out here and is
 * about fifteen lines of arithmetic.
 */
function Sheep() {
  const mats = useMemo(
    () => ({
      wool: new THREE.MeshStandardMaterial({ color: "#e8e4dc", roughness: 1 }),
      face: new THREE.MeshStandardMaterial({ color: "#3a3631", roughness: 0.8 }),
      leg: new THREE.MeshStandardMaterial({ color: "#33302c", roughness: 0.7 }),
    }),
    []
  );

  const geo = useMemo(
    () => ({
      // lumpy on purpose: a smooth ellipsoid reads as a bean, not a fleece
      body: lumpGeometry(2121, 0.33, 0.16, 2, true),
      head: lumpGeometry(2122, 0.13, 0.1, 1, true),
    }),
    []
  );

  const groups = useRef<(THREE.Group | null)[]>([]);
  const heads = useRef<(THREE.Group | null)[]>([]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;

    for (let i = 0; i < flock.length; i++) {
      const s = flock[i];
      const dx = s.x - cowState.x;
      const dz = s.z - cowState.z;
      const d = Math.hypot(dx, dz);

      let speed = 0;
      if (d < SPOOK) {
        // straight away from the cow, and it does not look back
        const nx = d > 1e-3 ? dx / d : 1;
        const nz = d > 1e-3 ? dz / d : 0;
        // a little sideways too, so six sheep don't run in one straight line
        const swerve = Math.sin(i * 2.1) * 0.5;
        const ax = nx - nz * swerve;
        const az = nz + nx * swerve;
        const al = Math.hypot(ax, az) || 1;
        speed = SHEEP_SPEED * Math.min(1, (SPOOK - d) / 1.6 + 0.35);
        s.x += (ax / al) * speed * dt;
        s.z += (az / al) * speed * dt;
        s.facing = Math.atan2(ax / al, az / al);
        s.homeX = s.x;
        s.homeZ = s.z;
        if (!s.fled) {
          s.fled = true;
          if (s.cooldown <= 0) {
            s.cooldown = 2.5 + i * 0.3;
            baa();
          }
        }
      } else {
        s.fled = false;
        // drift slowly back towards where it stopped, so the flock re-clumps
        const hx = s.homeX + Math.sin(t * 0.19 + i) * 1.4 - s.x;
        const hz = s.homeZ + Math.cos(t * 0.23 + i * 2) * 1.4 - s.z;
        const hd = Math.hypot(hx, hz);
        if (hd > 0.35) {
          speed = 0.5;
          s.x += (hx / hd) * speed * dt;
          s.z += (hz / hd) * speed * dt;
          s.facing = Math.atan2(hx / hd, hz / hd);
        }
      }
      // Sheep are solid-averse too, or a herded flock ends up inside a tree.
      const clear = resolveSolids(s.x, s.z);
      s.x = clear.x;
      s.z = clear.z;

      s.cooldown = Math.max(0, s.cooldown - dt);
      s.bob += dt * (2.5 + speed * 3.2);

      const g = groups.current[i];
      if (g) {
        g.position.set(s.x, Math.abs(Math.sin(s.bob)) * 0.035 * Math.min(1, speed), s.z);
        g.rotation.y = s.facing;
        g.rotation.z = Math.sin(s.bob) * 0.05 * Math.min(1, speed);
      }
      const h = heads.current[i];
      if (h) {
        // head down grazing when still, up and forward when running
        const run = Math.min(1, speed / 2);
        h.rotation.x = 0.85 * (1 - run) + Math.sin(t * 2 + i) * 0.06 * (1 - run) - run * 0.15;
      }
    }
  });

  return (
    <group>
      {flock.map((_, i) => (
        <group
          key={i}
          ref={(g) => {
            groups.current[i] = g;
          }}
        >
          <mesh
            geometry={geo.body}
            material={mats.wool}
            position={[0, 0.44, 0]}
            scale={[0.82, 0.9, 1.15]}
            castShadow
          />
          <group
            ref={(g) => {
              heads.current[i] = g;
            }}
            position={[0, 0.52, 0.3]}
          >
            <mesh geometry={geo.head} material={mats.wool} position={[0, 0, 0.02]} castShadow />
            <mesh position={[0, -0.03, 0.14]} scale={[0.75, 0.8, 1]} material={mats.face}>
              <sphereGeometry args={[0.075, 10, 8]} />
            </mesh>
            {/* ears, out sideways where they belong */}
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * 0.1, 0.02, 0.04]}
                rotation={[0, 0, s * 0.5]}
                scale={[1.6, 0.7, 0.5]}
                material={mats.face}
              >
                <sphereGeometry args={[0.04, 8, 6]} />
              </mesh>
            ))}
          </group>
          {[-1, 1].map((sx) =>
            [-1, 1].map((sz) => (
              <mesh
                key={`${sx}${sz}`}
                position={[sx * 0.14, 0.16, sz * 0.19]}
                material={mats.leg}
                castShadow
              >
                <cylinderGeometry args={[0.028, 0.024, 0.34, 6]} />
              </mesh>
            ))
          )}
          {/* tail */}
          <mesh position={[0, 0.46, -0.34]} scale={[0.8, 1, 0.7]} material={mats.wool}>
            <sphereGeometry args={[0.075, 8, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------

export default function Outside() {
  return (
    <group>
      <Scarecrow />
      <Pond />
      <SpeedCamera />
      <Sheep />
    </group>
  );
}
