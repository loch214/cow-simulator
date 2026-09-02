"use client";

/**
 * Hands. There are exactly two in this game and they exist for one joke each:
 *
 * - `CowHand` is bolted to the end of the cow's front-right leg and is scaled to
 *   nothing until the slap reaction raises the arm, at which point the cow gives
 *   you an actual, articulated middle finger rather than waving a hoof.
 * - `SlapHand` is the hand that does the slapping. It is not attached to
 *   anything in the world: it swings in from off-screen, connects with the cow's
 *   cheek on the same frame the head-spring is kicked, and follows through out
 *   of frame again.
 *
 * Both are built from the same two primitives — a palm and a finger bone — so a
 * fist and an open hand are the same twenty lines with different joint angles.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { loft } from "@/lib/geometry";
import { cowState } from "@/lib/cowState";
import { cam } from "@/lib/camera";
import { useCowStore } from "@/lib/store";
import { SLAP_IMPACT } from "@/lib/reactions";

function once<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= build());
}

/**
 * A loft is built along +z; everything here wants its long axis along +y, which
 * is what this wrapper rotation does. Same convention as the rest of the game.
 */
const UP: [number, number, number] = [-Math.PI / 2, 0, 0];

/**
 * One bone of a finger: tapered, so a finger made of three reads as jointed.
 *
 * Each bone runs a little past the knuckle at both ends and domes off there.
 * Three flat-capped tubes stacked nose to tail look fine straight and come apart
 * into three separate segments the moment the finger curls, which is the whole
 * problem with building anything out of butted cylinders.
 */
const digit = (len: number, top: number, tip: number) => {
  const over = Math.min(0.012, len * 0.3);
  return loft(
    [
      { z: -over, rx: top * 0.5, ry: top * 0.44 },
      { z: 0, rx: top, ry: top * 0.88 },
      { z: len * 0.4, rx: top * 0.97, ry: top * 0.86 },
      { z: len * 0.82, rx: (top + tip) * 0.47, ry: (top + tip) * 0.42 },
      { z: len, rx: tip, ry: tip * 0.86 },
      { z: len + over, rx: tip * 0.5, ry: tip * 0.44 },
    ],
    { radial: 12, segments: 18, square: 0.25 },
  );
};

/** The knuckle a finger folds over, covering the two bone ends inside it. */
const knuckleGeo = (r: number) =>
  loft(
    [
      { z: -0.012, rx: r * 0.36, ry: r * 0.32 },
      { z: -0.005, rx: r * 0.86, ry: r * 0.8 },
      { z: 0.008, rx: r, ry: r * 0.92 },
      { z: 0.02, rx: r * 0.78, ry: r * 0.72 },
      { z: 0.03, rx: r * 0.3, ry: r * 0.28 },
    ],
    { radial: 12, segments: 14 },
  );

/**
 * The palm: a slab, wider at the knuckles than at the wrist and thinner with it.
 * `square` is what stops it being a sausage — a hand is flat, and that flatness
 * is most of what makes a silhouette read as a hand at all.
 */
const palmGeo = once(() =>
  loft(
    [
      { z: -0.02, y: 0, rx: 0.028, ry: 0.019 },
      { z: 0.012, y: 0, rx: 0.041, ry: 0.023 },
      { z: 0.055, y: 0.002, rx: 0.05, ry: 0.023 },
      { z: 0.09, y: 0.002, rx: 0.049, ry: 0.02 },
      { z: 0.108, y: 0, rx: 0.045, ry: 0.016 },
    ],
    { radial: 16, segments: 20, square: 0.6 },
  ),
);

/** The mound at the base of the thumb. Cheap, and the hand is lumpy without it. */
const thenarGeo = once(() => new THREE.SphereGeometry(0.028, 12, 10));

const boneGeo = {
  proximal: once(() => digit(0.05, 0.0165, 0.0145)),
  middle: once(() => digit(0.038, 0.0145, 0.0128)),
  distal: once(() => digit(0.03, 0.0128, 0.0105)),
  thumbBase: once(() => digit(0.045, 0.019, 0.016)),
  thumbTip: once(() => digit(0.036, 0.016, 0.0135)),
  // one knuckle per joint, each a shade wider than the bones meeting in it
  midKnuckle: once(() => knuckleGeo(0.0172)),
  tipKnuckle: once(() => knuckleGeo(0.0152)),
};

/** The dark keratin cap on the cow's middle fingertip. It still has a hoof in there. */
const nailGeo = once(() => new THREE.SphereGeometry(0.013, 10, 8));

interface FingerProps {
  /** Rotations at the knuckle, the middle joint and the last joint, in radians. */
  curl: [number, number, number];
  /** Sideways splay at the knuckle. */
  spread?: number;
  material: THREE.Material;
  position: [number, number, number];
  scale?: number;
  children?: React.ReactNode;
}

/**
 * One finger, as three bones each hanging off the last. Negative `curl` folds the
 * finger toward the palm (-z); zero leaves it standing straight up.
 */
function Finger({
  curl,
  spread = 0,
  material,
  position,
  scale = 1,
  children,
}: FingerProps) {
  return (
    <group position={position} rotation={[curl[0], 0, spread]} scale={scale}>
      <group rotation={UP}>
        <mesh geometry={boneGeo.proximal()} material={material} castShadow />
      </group>
      <group position={[0, 0.05, 0]} rotation={[curl[1], 0, 0]}>
        <group rotation={UP}>
          <mesh geometry={boneGeo.midKnuckle()} material={material} castShadow />
          <mesh geometry={boneGeo.middle()} material={material} castShadow />
        </group>
        <group position={[0, 0.038, 0]} rotation={[curl[2], 0, 0]}>
          <group rotation={UP}>
            <mesh geometry={boneGeo.tipKnuckle()} material={material} castShadow />
            <mesh geometry={boneGeo.distal()} material={material} castShadow />
          </group>
          {children}
        </group>
      </group>
    </group>
  );
}

/** The thumb: two bones, and it comes off the side of the palm rather than the top. */
function Thumb({
  material,
  position,
  rotation,
  fold,
}: {
  material: THREE.Material;
  position: [number, number, number];
  rotation: [number, number, number];
  fold: number;
}) {
  return (
    <group position={position} rotation={rotation}>
      <group rotation={UP}>
        <mesh geometry={boneGeo.thumbBase()} material={material} castShadow />
      </group>
      <group position={[0, 0.045, 0]} rotation={[fold, 0, 0]}>
        <group rotation={UP}>
          <mesh geometry={boneGeo.thumbTip()} material={material} castShadow />
        </group>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// the cow's hand
// ---------------------------------------------------------------------------

/**
 * Three fingers folded into the palm, the thumb laid across them and the middle
 * finger straight up. Built so that **+y is the finger and +z is the back of the
 * hand**, which is the contract `aimFist` in Cow.tsx relies on: it cancels the
 * arm's own rotation every frame so the finger points at the sky and the back of
 * the hand points wherever the cow is facing — i.e. at you.
 */
export function CowHand({
  hide,
  nail,
  skin,
}: {
  hide: THREE.Material;
  nail: THREE.Material;
  skin: THREE.Material;
}) {
  // Folded: knuckle over, then two more joints tucking the tip back at the wrist.
  const fold: [number, number, number] = [-1.62, -1.55, -0.75];
  return (
    <group scale={1.2}>
      <group rotation={UP}>
        <mesh geometry={palmGeo()} material={hide} castShadow />
      </group>
      <mesh
        geometry={thenarGeo()}
        material={hide}
        position={[-0.036, 0.036, -0.006]}
        scale={[0.85, 1.25, 0.72]}
      />

      {/* the one that matters */}
      <Finger
        curl={[0.02, 0.05, 0.04]}
        material={hide}
        position={[0.004, 0.104, 0]}
        scale={1.12}
      >
        <mesh
          geometry={nailGeo()}
          material={nail}
          position={[0, 0.028, 0.002]}
          scale={[0.9, 0.75, 0.8]}
        />
      </Finger>

      {/* and the ones that don't */}
      <Finger
        curl={fold}
        spread={0.12}
        material={hide}
        position={[-0.04, 0.1, 0]}
        scale={0.96}
      />
      <Finger
        curl={fold}
        spread={-0.1}
        material={hide}
        position={[0.041, 0.101, 0]}
        scale={0.94}
      />
      <Finger
        curl={[-1.66, -1.5, -0.7]}
        spread={-0.22}
        material={hide}
        position={[0.07, 0.093, -0.004]}
        scale={0.82}
      />

      <Thumb
        material={hide}
        position={[-0.05, 0.038, -0.014]}
        rotation={[-1.05, 0.2, 0.95]}
        fold={-0.95}
      />

      {/* bare pink skin on the palm, the way a muzzle and an inner ear are bare */}
      <mesh
        position={[0, 0.055, -0.021]}
        rotation={[0.06, 0, 0]}
        scale={[0.042, 0.05, 0.004]}
        material={skin}
      >
        <sphereGeometry args={[1, 12, 10]} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// the hand that does the slapping
// ---------------------------------------------------------------------------

/** How long the swing, the contact and the follow-through last, in seconds. */
const WIND_UP = SLAP_IMPACT / 1000;
const CONTACT = WIND_UP + 0.07;
const GONE = CONTACT + 0.42;

/**
 * Key positions of the swing, in a frame anchored on the cow's head and turned
 * to face the camera: **+x is screen right, +y is up, +z is toward the lens**.
 * So the hand comes in from the left of frame, in front of the cow, and leaves
 * to the right — readable from any angle you have dragged the camera round to,
 * which a hand anchored in the world would not be.
 */
const SWING = {
  from: new THREE.Vector3(-1.55, 0.6, 1.0),
  // Clear of the skull and well in front of it. A contact point any closer than
  // this puts the palm INSIDE the head, and all you see of the slap is four
  // fingertips poking out of the top of the cow.
  hit: new THREE.Vector3(-0.32, 0.05, 0.46),
  to: new THREE.Vector3(1.3, -0.28, 0.62),
};

/**
 * How the hand is turned at each of those three points, as an (x, y, z) Euler.
 *
 * The y term is the one that matters. The hand is modelled with its palm facing
 * -z, so a pure `-PI/2` would aim the palm exactly along the direction of
 * travel — physically right, and useless, because it presents the camera with
 * the thin edge of a hand and the whole thing reads as a wave. Backing off to
 * about -0.75 turns three quarters of the palm toward the lens while it still
 * clearly leads the swing.
 */
const TURN = {
  from: new THREE.Vector3(-0.1, -1.5, -0.2),
  hit: new THREE.Vector3(0.02, -0.7, 0.52),
  to: new THREE.Vector3(0.25, 0.15, 1.05),
};

function useSlapMaterials() {
  return useMemo(
    () => ({
      skin: new THREE.MeshStandardMaterial({
        color: "#d9a583",
        roughness: 0.68,
      }),
      cuff: new THREE.MeshStandardMaterial({
        color: "#3d4a63",
        roughness: 0.85,
      }),
    }),
    [],
  );
}

/**
 * The hand that slaps the cow. Deliberately about the size of the cow's head:
 * a correctly-scaled human hand at six metres is four pixels of nothing, and the
 * whole point of the gag is that you can see what just happened.
 *
 * It is anchored to the cow's head rather than to the camera, so it stays in
 * shot at every zoom, and it is driven off `slapAt` — a timestamp — rather than
 * a boolean, so a second slap simply restarts the swing from the top.
 */
export function SlapHand() {
  const mats = useSlapMaterials();
  const rootRef = useRef<THREE.Group>(null);
  const handRef = useRef<THREE.Group>(null);
  const slapAt = useCowStore((s) => s.slapAt);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const turn = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const root = rootRef.current;
    const hand = handRef.current;
    if (!root || !hand) return;

    const t = (performance.now() - slapAt) / 1000;
    if (slapAt === 0 || t < 0 || t > GONE) {
      root.visible = false;
      return;
    }
    root.visible = true;

    // Anchor on the head: the cow's own position, plus the poll swung round by
    // whichever way it is facing. Taken from `cowState` rather than the head node
    // because the head is being thrown about by a spring at exactly this moment,
    // and a hand chasing that would judder.
    const s = Math.sin(cowState.facing);
    const c = Math.cos(cowState.facing);
    root.position.set(
      cowState.x + s * 0.88,
      1.08 + cowState.stand * 0.8,
      cowState.z + c * 0.88,
    );
    // local +z toward the lens, local +x screen right
    root.rotation.y = cam.yaw;

    // How far off the cow it is, and how big it reads. The hand leaves by
    // getting smaller and further away rather than by fading: a transparent
    // material this size, overlapping the cow, sorts badly against the coat and
    // the shrink sells "whipped back out of shot" better anyway.
    let away = 1;
    if (t < WIND_UP) {
      // accelerating into the cheek — a slap is not a constant-speed sweep
      const u = t / WIND_UP;
      pos.copy(SWING.from).lerp(SWING.hit, u * u);
      turn.copy(TURN.from).lerp(TURN.hit, u * u);
    } else if (t < CONTACT) {
      pos.copy(SWING.hit);
      turn.copy(TURN.hit);
    } else {
      const u = (t - CONTACT) / (GONE - CONTACT);
      pos.copy(SWING.hit).lerp(SWING.to, u * (2 - u));
      turn.copy(TURN.hit).lerp(TURN.to, u * (2 - u));
      away = 1 - u * u * 0.75;
    }

    hand.position.copy(pos);
    hand.rotation.set(turn.x, turn.y, turn.z);
    // squashes against the cheek on impact and springs back
    const squash =
      t > WIND_UP && t < CONTACT ? 1 - (1 - (t - WIND_UP) / 0.07) * 0.22 : 1;
    const size = 2.2 * away;
    hand.scale.set(size, size * squash, size);
  });

  const flat: [number, number, number] = [0.06, 0.04, 0.03];
  return (
    <group ref={rootRef} visible={false}>
      <group ref={handRef}>
        {/* The hand is modelled from the wrist up, so it is shifted down by half
            its own length here: that puts the middle of the PALM on the group's
            origin, which is the point the swing aims at the cheek and the point
            the roll turns about. Skip this and the hand orbits its own wrist and
            lands somewhere above the cow's ears. */}
        <group position={[0, -0.09, 0]}>
          <group rotation={UP}>
            <mesh geometry={palmGeo()} material={mats.skin} castShadow />
          </group>
          <mesh
            geometry={thenarGeo()}
            material={mats.skin}
            position={[-0.036, 0.036, -0.006]}
            scale={[0.85, 1.25, 0.72]}
          />
          {/* four fingers, open and slightly splayed — this is a slap, not a punch */}
          <Finger
            curl={flat}
            spread={0.16}
            material={mats.skin}
            position={[-0.041, 0.1, 0]}
            scale={0.97}
          />
          <Finger
            curl={flat}
            spread={0.04}
            material={mats.skin}
            position={[-0.001, 0.106, 0]}
            scale={1.05}
          />
          <Finger
            curl={flat}
            spread={-0.06}
            material={mats.skin}
            position={[0.038, 0.103, 0]}
            scale={1}
          />
          <Finger
            curl={flat}
            spread={-0.19}
            material={mats.skin}
            position={[0.071, 0.094, -0.004]}
            scale={0.84}
          />
          <Thumb
            material={mats.skin}
            position={[-0.052, 0.036, -0.008]}
            rotation={[-0.35, 0.1, 1.15]}
            fold={-0.2}
          />
          {/* a cuff, so it ends somewhere instead of being a hand floating in a field */}
          <mesh position={[0, -0.045, 0]} material={mats.cuff} castShadow>
            <cylinderGeometry args={[0.056, 0.052, 0.075, 14]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
