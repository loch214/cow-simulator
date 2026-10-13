"use client";

/**
 * The officer.
 *
 * He is fat and he is not interested, and both of those are built into the
 * body rather than acted out on top of it. The gut is the widest thing on him,
 * the stab vest gave up trying to close over it some time ago, his arms cannot
 * hang straight because of it, and the legs are short and already bent so he
 * stands with his weight given up. Everything the animation does — the yawn,
 * the doughnut, the heavy blink — sits on top of a body that already reads as
 * somebody who would rather be sitting down.
 *
 * He used to be built the way the cow was: forty separate tubes, spheres and
 * boxes pushed into each other, which left his scalp poking up through his own
 * cap and his face sunk into his vest. He is now two pieces of skin built by
 * lib/sdf.ts — a body, and a head-and-neck that goes into the body at the shirt
 * collar, which is where a seam belongs — painted by region and bound to the
 * same groups the animation has always driven.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useCowStore } from "@/lib/store";
import { rng } from "@/lib/geometry";
import { bindSkin, snapshotRest } from "@/lib/sdf";
import { skinGeometry } from "@/lib/skinClient";
import {
  C,
  FACE,
  FOOT_LEVEL,
  HEAD_Y,
  HIP_Y,
  OFFICER_BONES as BONES,
  SHIN,
  SHIN_TILT,
  THIGH,
  THIGH_TILT,
  type BoneName,
} from "@/lib/officerBody";
import { OFFICER, STATION } from "@/lib/world";

const lin = (hex: string) => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

/**
 * The uniform, painted per pixel from where each point sits on him at rest
 * (model space: y up from the ground, +z forward). Vertex colours alone left a
 * saw-tooth along every hem, one triangle wide; this draws the edges clean.
 *
 * The clothes are colour on one skin rather than shells over another, so the
 * vest can never end up inside the shirt again — which it was, twice.
 */
const UNIFORM_GLSL = /* glsl */ `
varying vec3 vRest;
varying float vRegion;
vec3 officerTorso(vec3 p) {
  float a = fwidth(p.y) * 1.2 + 0.0008;
  float ax = fwidth(p.x) * 1.2 + 0.0008;
  // The vest stops above the gut and does not meet in the middle: there is
  // too much of him for it.
  float hem = 1.16 + smoothstep(-0.05, 0.12, p.z) * 0.05 + max(p.z, 0.0) * 0.12;
  float gapW = 0.028 + max(0.0, 1.5 - p.y) * 0.09;
  float gap = smoothstep(0.06, 0.1, p.z) * (1.0 - smoothstep(gapW - ax, gapW + ax, abs(p.x)));
  float vest = smoothstep(hem - a, hem + a, p.y) * (1.0 - smoothstep(1.58 - a, 1.58 + a, p.y)) * (1.0 - gap);
  float hivis = smoothstep(1.33 - a, 1.33 + a, p.y) * (1.0 - smoothstep(1.385 - a, 1.385 + a, p.y));
  float belt = smoothstep(0.865 - a, 0.865 + a, p.y) * (1.0 - smoothstep(0.95 - a, 0.95 + a, p.y));
  float legs = 1.0 - smoothstep(0.865 - a, 0.865 + a, p.y);
  vec3 c = ${lin(C.shirt)};
  c = mix(c, ${lin(C.belt)}, belt);
  c = mix(c, ${lin(C.trouser)}, legs);
  c = mix(c, mix(${lin(C.vest)}, ${lin(C.hivis)}, hivis), vest);
  return c;
}
`;

function uniformMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float region;\nvarying vec3 vRest;\nvarying float vRegion;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRest = position;\nvRegion = region;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${UNIFORM_GLSL}`)
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, officerTorso(vRest), vRegion);"
      );
  };
  m.customProgramCacheKey = () => "officer-uniform";
  return m;
}


// ---------------------------------------------------------------------------

/** The chequered band, painted once onto a strip: two rows, eighteen across. */
function checkerMap(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 288;
  c.height = 32;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 18; i++) {
    for (let r = 0; r < 2; r++) {
      g.fillStyle = (i + r) % 2 ? C.check : C.cap;
      g.fillRect(i * 16, r * 16, 16, 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

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
      // one material for both pieces of skin: the clothes are vertex colour
      skin: uniformMaterial(),
      cap: new THREE.MeshStandardMaterial({ color: C.cap, roughness: 0.6 }),
      band: new THREE.MeshStandardMaterial({ map: checkerMap(), roughness: 0.7 }),
      visor: new THREE.MeshStandardMaterial({ color: C.visor, roughness: 0.25 }),
      flesh: new THREE.MeshStandardMaterial({ color: C.skin, roughness: 0.7 }),
      flush: new THREE.MeshStandardMaterial({ color: C.flush, roughness: 0.72 }),
      hair: new THREE.MeshStandardMaterial({ color: C.hair, roughness: 0.95 }),
      belt: new THREE.MeshStandardMaterial({ color: "#14161d", roughness: 0.5 }),
      vest: new THREE.MeshStandardMaterial({ color: C.vest, roughness: 0.8 }),
      chrome: new THREE.MeshStandardMaterial({ color: "#c9cdd4", roughness: 0.3, metalness: 0.85 }),
      badge: new THREE.MeshStandardMaterial({ color: "#e2b53c", roughness: 0.3, metalness: 0.7 }),
      paper: new THREE.MeshStandardMaterial({ color: "#f7f4e8", roughness: 0.95 }),
      eye: new THREE.MeshStandardMaterial({ color: "#241a12", roughness: 0.15 }),
      mouth: new THREE.MeshStandardMaterial({ color: "#4a2224", roughness: 0.6 }),
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
  const donut = useMemo(() => donutGeo(), []);

  const outerRef = useRef<THREE.Group>(null);
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
  const mouthRef = useRef<THREE.Mesh>(null);
  const browRefs = useRef<(THREE.Mesh | null)[]>([null, null]);
  const lidRefs = useRef<(THREE.Mesh | null)[]>([null, null]);
  const blinkRef = useRef({ next: 3, closing: 0 });
  const boundRef = useRef(false);

  const inCutscene = useCowStore((s) => s.inCutscene);
  const speaker = useCowStore((s) => s.speaker);
  const dialogue = useCowStore((s) => s.dialogue);

  // He talks at the station during the complaint, and to anyone who comes up
  // to him the rest of the time.
  const talking = speaker === "officer" && dialogue !== null;
  const listening = inCutscene && !talking;

  // positioned relative to the station group
  const px = OFFICER.x - STATION.x;
  const pz = OFFICER.z - STATION.z;

  /**
   * Bind the skin to the rig, on the first frame and before anything has moved
   * — the groups are still exactly where the JSX put them, which is the rest
   * pose the skin is built around.
   */
  function bind(outer: THREE.Group) {
    const found: Partial<Record<BoneName, THREE.Object3D>> = {};
    outer.traverse((o) => {
      if (o.name.startsWith("o-")) found[o.name.slice(2) as BoneName] = o;
    });
    const bones = BONES.map((n) => found[n]);
    if (bones.some((b) => !b)) {
      console.error("officer skin: missing bone", BONES.filter((_, i) => !bones[i]));
      return;
    }
    const rest = snapshotRest(outer, bones as THREE.Object3D[]);
    const toLocal = outer.matrixWorld.clone().invert();
    const frames = BONES.map((n) => toLocal.clone().multiply(found[n]!.matrixWorld).toArray());
    // meshed in a worker; he stays hidden until his skin turns up
    const root = found.root!;
    root.visible = false;
    void skinGeometry({ kind: "officer", frames }).then(([body, head]) => {
      bindSkin(body, mats.skin, outer, rest);
      bindSkin(head, mats.skin, outer, rest);
      root.visible = true;
    });
  }

  useFrame((state, delta) => {
    if (!boundRef.current && outerRef.current) {
      boundRef.current = true;
      bind(outerRef.current);
    }
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
        headRef.current.rotation.y = Math.sin(t * 0.9) * 0.05;
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
      // The arm cannot hang straight; there is a stomach in the way.
      padArmRef.current.rotation.z = inCutscene ? 0.38 : 0.4;
    }
    if (padForeRef.current) {
      padForeRef.current.rotation.x = inCutscene ? -1.15 + scribble : -0.75;
    }

    // The other hand has a doughnut in it and its priorities are clear: it goes
    // to his mouth on a bite and hangs there the rest of the time. It does not
    // gesture, and it does not stop for the cow.
    if (foodArmRef.current) {
      foodArmRef.current.rotation.x = -0.34 - bite * 0.85;
      // Mirrored, so negative is out. Taking a bite brings it back IN towards
      // the mouth, which is why the bite term moves it the other way.
      foodArmRef.current.rotation.z = -0.5 + bite * 0.22;
    }
    if (foodForeRef.current) {
      foodForeRef.current.rotation.x = -0.95 - bite * 0.8;
      foodForeRef.current.rotation.z = bite * 0.35;
    }

    // A yawn beats a sentence and a sentence beats chewing, so you can always
    // tell which of the three he is doing without reading the bubble.
    const open = Math.max(
      yawn * 0.75,
      talking ? Math.abs(Math.sin(t * 8)) * 0.28 + 0.04 : 0,
      chew * 0.16
    );
    if (jawRef.current) {
      jawRef.current.rotation.x = open * 0.7;
    }
    if (mouthRef.current) {
      // The chin is skin, so opening the jaw stretches the face rather than
      // splitting it; the dark of the mouth grows into the stretch.
      mouthRef.current.scale.set(1 + open * 0.3, 0.25 + open * 2.6, 1);
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
      if (lid) lid.scale.y = 0.45 + Math.min(1.15, shut) * 0.9;
    });
    browRefs.current.forEach((brow) => {
      if (brow) brow.position.y = 0.028 - yawn * 0.012;
    });
  });

  return (
    <group ref={outerRef} position={[px, 0, pz]} rotation={[0, -Math.PI / 2, 0]}>
      {/* Every group below is a bone; the skin is bound to them on the first
          frame. The meshes left in the tree are the things that really are
          separate from him: eyes, a moustache, a badge, a notepad, a doughnut. */}
      <group ref={rootRef} name="o-root">
        <group ref={hipsRef} name="o-hips" position={[0, HIP_Y, 0]}>
          {(["L", "R"] as const).map((side) => {
            const s = side === "L" ? -1 : 1;
            return (
              <group key={side} name={`o-leg${side}`} position={[s * 0.145, 0, 0]} rotation={[THIGH_TILT, 0, s * 0.07]}>
                <group name={`o-shin${side}`} position={[0, -THIGH, 0]} rotation={[SHIN_TILT, 0, 0]}>
                  <group name={`o-boot${side}`} position={[0, -SHIN, 0]} rotation={[FOOT_LEVEL, 0, 0]} />
                </group>
              </group>
            );
          })}

          <group ref={chestRef} name="o-chest">
            <group ref={bellyRef} name="o-belly" />

            {/* belt kit, on the front of a belt slung under the gut */}
            <mesh position={[0, -0.0, 0.215]} material={mats.chrome}>
              <boxGeometry args={[0.085, 0.06, 0.03]} />
            </mesh>
            <mesh position={[-0.235, -0.02, 0.06]} rotation={[0, 0.35, 0]} material={mats.belt} castShadow>
              <boxGeometry args={[0.07, 0.16, 0.09]} />
            </mesh>
            <mesh position={[0.24, -0.01, 0.05]} rotation={[0, -0.35, 0]} material={mats.belt}>
              <boxGeometry args={[0.06, 0.1, 0.07]} />
            </mesh>
            {/* badge, radio and epaulettes, out on the vest */}
            <mesh position={[0.11, 0.47, 0.195]} rotation={[-0.15, 0.3, 0]} material={mats.badge}>
              <boxGeometry args={[0.052, 0.066, 0.012]} />
            </mesh>
            <mesh position={[-0.13, 0.53, 0.185]} rotation={[-0.25, -0.3, 0]} material={mats.belt} castShadow>
              <boxGeometry args={[0.055, 0.095, 0.035]} />
            </mesh>
            <mesh position={[-0.13, 0.61, 0.18]} rotation={[-0.25, -0.3, 0]} material={mats.belt}>
              <cylinderGeometry args={[0.006, 0.006, 0.08, 6]} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.205, 0.675, -0.01]} rotation={[0, 0, s * -0.32]} material={mats.vest} castShadow>
                <boxGeometry args={[0.13, 0.018, 0.14]} />
              </mesh>
            ))}

            {/*
              Both arms. The shoulders sit OUTSIDE the widest ring of the torso
              rather than inside it, and each arm then swings further out still
              — there is a gut half a metre across between them and neither
              hand has anywhere to be except clear of it.
            */}
            <group ref={padArmRef} name="o-padArm" position={[0.3, 0.585, 0.01]} rotation={[-0.12, 0, 0.4]}>
              <group ref={padForeRef} name="o-padFore" position={[0, -0.27, 0]} rotation={[-0.75, 0, 0]}>
                <mesh position={[0, -0.33, 0.09]} rotation={[0.55, 0, 0]} material={mats.paper} castShadow>
                  <boxGeometry args={[0.16, 0.21, 0.012]} />
                </mesh>
                <mesh position={[0.035, -0.31, 0.135]} rotation={[0.4, 0, 0.3]} material={mats.chrome}>
                  <cylinderGeometry args={[0.007, 0.007, 0.12, 6]} />
                </mesh>
              </group>
            </group>

            <group ref={foodArmRef} name="o-foodArm" position={[-0.3, 0.585, 0.01]} rotation={[-0.34, 0, -0.5]}>
              <group ref={foodForeRef} name="o-foodFore" position={[0, -0.27, 0]} rotation={[-0.95, 0, 0]}>
                {/* held between the fingers, bite already taken */}
                <group position={[0, -0.335, 0.08]} rotation={[1.35, 0.3, 0.4]}>
                  <mesh geometry={donut} material={mats.icing} castShadow />
                  {SPRINKLES.map((s, i) => (
                    <mesh key={i} position={s.pos} rotation={s.rot} material={mats.sprinkle}>
                      <boxGeometry args={[0.014, 0.005, 0.005]} />
                    </mesh>
                  ))}
                </group>
              </group>
            </group>

            <group ref={headRef} name="o-head" position={[0, HEAD_Y, 0]}>
              <group ref={jawRef} name="o-jaw" position={[0, -0.03, -0.02]} />
              {/* the mouth: dark, and it grows as the chin drops */}
              <mesh ref={mouthRef} position={FACE.mouth.pos} rotation={FACE.mouth.rot} material={mats.mouth}>
                <sphereGeometry args={[0.026, 12, 8]} />
              </mesh>
              {/* The moustache, which is doing a lot of the work here. */}
              <mesh
                position={FACE.tache.pos}
                rotation={[0.15, 0, 0]}
                scale={[1.1, 0.42, 0.5]}
                material={mats.hair}
                castShadow
              >
                <sphereGeometry args={[0.05, 14, 10]} />
              </mesh>
              {/* Small eyes, set deep, with lids that sit low even wide awake. */}
              {FACE.eyes.map((e, i) => (
                <group key={i} position={e.pos} rotation={e.rot}>
                  <mesh position={[0, 0, 0.004]} material={mats.eye}>
                    <sphereGeometry args={[0.016, 10, 8]} />
                  </mesh>
                  <mesh
                    ref={(m) => {
                      lidRefs.current[i] = m;
                    }}
                    position={[0, 0.011, 0.002]}
                    scale={[1, 0.45, 1]}
                    material={mats.flesh}
                  >
                    <sphereGeometry args={[0.02, 10, 8]} />
                  </mesh>
                  {/* the bag under it */}
                  <mesh position={[0, -0.016, 0.002]} scale={[1.1, 0.4, 0.8]} material={mats.flush}>
                    <sphereGeometry args={[0.019, 10, 8]} />
                  </mesh>
                  <mesh
                    ref={(m) => {
                      browRefs.current[i] = m;
                    }}
                    position={[0, 0.028, 0.01]}
                    rotation={[0, 0, (i ? -1 : 1) * 0.26]}
                    material={mats.hair}
                  >
                    <boxGeometry args={[0.052, 0.014, 0.018]} />
                  </mesh>
                </group>
              ))}
              {/* The cap: a separate, solid thing sitting ON his head, sized
                  off the skull it sits on. The old one was a hair narrower than
                  the head inside it, and his scalp came up through the crown. */}
              <group position={[0, 0.115, -0.012]}>
                <mesh material={mats.band} castShadow>
                  <cylinderGeometry args={[0.139, 0.139, 0.072, 36, 1, true]} />
                </mesh>
                <mesh position={[0, 0.05, -0.008]} material={mats.cap} castShadow>
                  <cylinderGeometry args={[0.153, 0.14, 0.036, 36]} />
                </mesh>
                <mesh position={[0, 0.07, -0.008]} scale={[1, 0.25, 1]} material={mats.cap}>
                  <sphereGeometry args={[0.153, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
                </mesh>
                {/* the peak: a half disc out over his eyes */}
                <mesh position={[0, -0.03, 0.105]} rotation={[0.38, 0, 0]} scale={[1, 1, 0.62]} material={mats.visor} castShadow>
                  <cylinderGeometry args={[0.12, 0.12, 0.012, 24, 1, false, -Math.PI / 2, Math.PI]} />
                </mesh>
                <mesh position={[0, 0.006, 0.137]} material={mats.badge}>
                  <boxGeometry args={[0.04, 0.046, 0.01]} />
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
