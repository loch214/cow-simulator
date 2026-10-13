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

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { POSTED_LIMIT, useCowStore } from "@/lib/store";
import { cowState } from "@/lib/cowState";
import { bladeGeometry, loft, rng } from "@/lib/geometry";
import { SHEEP_DARK } from "@/lib/sheepBody";
import { onSack } from "@/lib/scarecrowBody";
import { skinGeometry } from "@/lib/skinClient";
import { applySway } from "@/lib/sway";
import { dirtMap, discFadeMap, woodMap } from "@/lib/textures";
import { baa, yeet } from "@/lib/audio";
import {
  BONK_SPEED,
  MPH,
  PIT_RADIUS,
  POND,
  resolveFence,
  resolveSolids,
  SCARECROW,
  SHEEP_HOME,
  SPEED_SIGN,
  SPEED_TRAP,
} from "@/lib/world";

// ---------------------------------------------------------------------------
// the scarecrow
// ---------------------------------------------------------------------------

/** How long the spin takes after a bellow, in seconds. */
const SPIN_TIME = 1.6;

/**
 * The face somebody drew on the sack in a hurry: two buttons for eyes and a
 * row of stitches for a mouth, each found ON the lumpy front of the sack.
 */
const SACK_FACE = (() => {
  const at = (x: number, y: number) => {
    const { p, n } = onSack(x, y);
    return { pos: [p[0], p[1], p[2]] as [number, number, number], rot: [-Math.asin(n[1]), Math.atan2(n[0], n[2]), 0] as [number, number, number] };
  };
  return {
    eyes: [at(-0.065, 1.67), at(0.07, 1.655)],
    stitches: [-0.075, -0.045, -0.015, 0.015, 0.045, 0.075].map((x, i) => at(x, 1.56 + (i % 2 ? 0.008 : -0.004) + x * x * 1.6)),
  };
})();

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
      body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
      button: new THREE.MeshStandardMaterial({ color: "#1d1a17", roughness: 0.35 }),
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
  // the stuffed body, meshed in the skin worker
  const [body, setBody] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    let live = true;
    void skinGeometry({ kind: "scarecrow" }).then(([g]) => {
      if (live) setBody(g);
    });
    return () => {
      live = false;
    };
  }, []);
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
        {/* the shirt and the sack head: one stuffed body, hung off the cross */}
        {body && <mesh geometry={body} material={mats.body} castShadow receiveShadow />}
        {cuffStraw.map((s, i) => (
          <group key={i} position={s.pos} rotation={s.rot}>
            <mesh geometry={geo.tuft} material={mats.straw} />
          </group>
        ))}
        {/* a face drawn on by somebody in a hurry: odd buttons, and stitches */}
        {body &&
          SACK_FACE.eyes.map((e, i) => (
            <group key={i} position={e.pos} rotation={e.rot}>
              {/* a cylinder stands on its y axis; a button lies flat on the face */}
              <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.button}>
                <cylinderGeometry args={[i ? 0.026 : 0.032, i ? 0.026 : 0.032, 0.014, 14]} />
              </mesh>
            </group>
          ))}
        {body &&
          SACK_FACE.stitches.map((st, i) => (
            <mesh key={`s${i}`} position={st.pos} rotation={[st.rot[0], st.rot[1], i % 2 ? 0.7 : -0.7]} material={mats.ink}>
              <boxGeometry args={[0.032, 0.007, 0.01]} />
            </mesh>
          ))}
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

/** The speed camera's own lens, for taking the photo. */
let photoLens: THREE.PerspectiveCamera | null = null;

/** A canvas texture, drawn once. */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The posted limit: a red ring and a number, the one sign everybody knows. */
function limitSignMap() {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(128, 128, 124, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#d4202a";
    g.lineWidth = 30;
    g.beginPath();
    g.arc(128, 128, 104, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "#111";
    g.font = "bold 128px Arial, Helvetica, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(POSTED_LIMIT), 128, 136);
  });
}

/** The plate under it: a camera, and who it is for. */
function cameraPlateMap() {
  return canvasTexture(256, 160, (g) => {
    g.fillStyle = "#f2f2f2";
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = "#111";
    g.lineWidth = 8;
    g.strokeRect(6, 6, 244, 148);
    // the camera pictogram
    g.fillStyle = "#111";
    g.fillRect(70, 34, 84, 46);
    g.fillRect(150, 44, 28, 26);
    g.beginPath();
    g.arc(112, 57, 15, 0, Math.PI * 2);
    g.fillStyle = "#f2f2f2";
    g.fill();
    g.fillStyle = "#111";
    g.font = "bold 34px Arial, Helvetica, sans-serif";
    g.textAlign = "center";
    g.fillText("COWS TOO", 128, 128);
  });
}

/**
 * The speed camera: a yellow box on a pole beside the road, a posted limit
 * on the way to it, and measuring lines painted across the track. It fires
 * when the cow GALLOPS past (see `checkSpeedTrap` in components/Cow.tsx and
 * `flash` in the store); walking is legal.
 *
 * When it fires it really does take a photograph: the scene is rendered from
 * the lens, at the cow, and the picture goes on the penalty notice — and from
 * there onto a WANTED poster outside the station.
 */
function SpeedCamera() {
  const mats = useMemo(
    () => ({
      post: new THREE.MeshStandardMaterial({ color: "#6f7276", roughness: 0.6, metalness: 0.3 }),
      // Yellow, like the real thing — a grey box by a grey road is invisible,
      // and a camera nobody can see is not a joke, it is an ambush.
      box: new THREE.MeshStandardMaterial({ color: "#e6bd1c", roughness: 0.45, metalness: 0.1 }),
      dark: new THREE.MeshStandardMaterial({ color: "#1d1f22", roughness: 0.4 }),
      lens: new THREE.MeshStandardMaterial({
        color: "#20242b",
        roughness: 0.15,
        emissive: "#ffffff",
        emissiveIntensity: 0,
      }),
      paint: new THREE.MeshBasicMaterial({ color: "#e8e4d8", transparent: true, opacity: 0.55 }),
      limit: new THREE.MeshStandardMaterial({ map: limitSignMap(), roughness: 0.5 }),
      plate: new THREE.MeshStandardMaterial({ map: cameraPlateMap(), roughness: 0.5 }),
      back: new THREE.MeshStandardMaterial({ color: "#8d9095", roughness: 0.5, metalness: 0.4 }),
    }),
    []
  );

  const lensRef = useRef<THREE.Mesh>(null);
  const flashSeq = useCowStore((s) => s.flashSeq);
  const firedAt = useRef(-1);
  const developed = useRef(0);
  const { gl, scene, size } = useThree();

  useEffect(() => {
    if (flashSeq > 0) firedAt.current = 0;
  }, [flashSeq]);

  /**
   * Take the picture. Rendered into the corner of the main canvas and read
   * straight back off it, inside the same frame — the normal render that
   * follows draws over it before the browser ever shows it, and it costs no
   * second WebGL context and no render-target colour fix-ups.
   */
  function develop() {
    // module state rather than a memo: the lint rule forbids a frame callback
    // mutating a memo result, and there is only ever one speed camera
    const lens = (photoLens ??= new THREE.PerspectiveCamera(36, 4 / 3, 0.1, 120));
    const pr = gl.getPixelRatio();
    const ctx = gl.getContext();
    const W = Math.min(480, ctx.drawingBufferWidth);
    const H = Math.min(360, ctx.drawingBufferHeight);
    const at = new THREE.Vector3(cowState.x, 0.78 + cowState.stand * 0.5, cowState.z);
    // just in front of the lens, not inside the box it lives in
    const face = Math.atan2(-SPEED_TRAP.z, -SPEED_TRAP.x);
    lens.position.set(SPEED_TRAP.x + Math.sin(face) * 0.45, 2.2, SPEED_TRAP.z + Math.cos(face) * 0.45);
    const d = lens.position.distanceTo(at);
    // zoom to fill the frame with cow, however close it came
    lens.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(1.15 / d)), 18, 70);
    lens.aspect = W / H;
    lens.updateProjectionMatrix();
    lens.lookAt(at);

    gl.setScissorTest(true);
    gl.setViewport(0, 0, W / pr, H / pr);
    gl.setScissor(0, 0, W / pr, H / pr);
    gl.render(scene, lens);
    const px = new Uint8Array(W * H * 4);
    ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);

    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    const img = g.createImageData(W, H);
    // GL rows run bottom-up; and a speed camera does not do colour well
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = ((H - 1 - y) * W + x) * 4;
        const o = (y * W + x) * 4;
        const lum = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
        img.data[o] = Math.min(255, (px[i] * 0.45 + lum * 0.55) * 1.08);
        img.data[o + 1] = Math.min(255, (px[i + 1] * 0.45 + lum * 0.55) * 1.06);
        img.data[o + 2] = Math.min(255, (px[i + 2] * 0.45 + lum * 0.55) * 0.95);
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // the data strip burned into every speed camera photo
    const tickets = useCowStore.getState().tickets;
    const t = tickets[tickets.length - 1];
    g.fillStyle = "rgba(0,0,0,0.72)";
    g.fillRect(0, H - 34, W, 34);
    g.fillStyle = "#ffcf3a";
    g.font = "bold 17px ui-monospace, Menlo, Consolas, monospace";
    g.textBaseline = "middle";
    const clock = new Date().toTimeString().slice(0, 8);
    g.fillText(`${(t?.mph ?? cowState.speed * MPH).toFixed(1)} MPH`, 12, H - 17);
    g.fillText(`LIMIT ${POSTED_LIMIT}`, 150, H - 17);
    g.fillText(clock, W - 100, H - 17);
    g.fillStyle = "#ff4a3a";
    g.fillText("● CAM 07", 12, 18);
    useCowStore.getState().fileTicket(c.toDataURL("image/jpeg", 0.85));
  }

  useFrame((_, delta) => {
    if (flashSeq > developed.current) {
      developed.current = flashSeq;
      develop();
    }
    const lensMesh = lensRef.current;
    if (!lensMesh) return;
    const m = lensMesh.material as THREE.MeshStandardMaterial;
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
    <group>
      <group position={[SPEED_TRAP.x, 0, SPEED_TRAP.z]}>
        <mesh position={[0, 1.1, 0]} material={mats.post} castShadow>
          <cylinderGeometry args={[0.055, 0.075, 2.2, 10]} />
        </mesh>
        <group position={[0, 2.2, 0]} rotation={[0, face, 0]}>
          <mesh material={mats.box} castShadow>
            <boxGeometry args={[0.36, 0.42, 0.52]} />
          </mesh>
          {/* hood over the lens, so it reads as a camera and not a junction box */}
          <mesh position={[0, 0.06, 0.3]} rotation={[0.12, 0, 0]} material={mats.dark} castShadow>
            <boxGeometry args={[0.3, 0.16, 0.12]} />
          </mesh>
          <mesh ref={lensRef} position={[0, 0.02, 0.28]} rotation={[Math.PI / 2, 0, 0]} material={mats.lens}>
            <cylinderGeometry args={[0.08, 0.08, 0.06, 14]} />
          </mesh>
          <mesh position={[0, -0.25, 0]} material={mats.dark}>
            <boxGeometry args={[0.2, 0.1, 0.2]} />
          </mesh>
        </group>
        {/* the measuring lines painted across the track */}
        {[-1.2, -0.6, 0.0, 0.6, 1.2].map((d) => (
          <mesh
            key={d}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[d, 0.024, -SPEED_TRAP.z]}
            material={mats.paint}
          >
            <planeGeometry args={[0.14, 2.6]} />
          </mesh>
        ))}
      </group>

      {/* The posted limit, on the way TO the camera, facing the cow coming
          out of the pen — so the rule is there to be read before it is broken. */}
      <group position={[SPEED_SIGN.x, 0, SPEED_SIGN.z]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh position={[0, 0.95, 0]} material={mats.post} castShadow>
          <cylinderGeometry args={[0.035, 0.045, 1.9, 8]} />
        </mesh>
        <mesh position={[0, 1.78, 0.04]} material={mats.limit} castShadow>
          <circleGeometry args={[0.3, 32]} />
        </mesh>
        <mesh position={[0, 1.78, 0.035]} rotation={[0, Math.PI, 0]} material={mats.back}>
          <circleGeometry args={[0.3, 32]} />
        </mesh>
        <mesh position={[0, 1.31, 0.04]} material={mats.plate} castShadow>
          <planeGeometry args={[0.5, 0.31]} />
        </mesh>
        <mesh position={[0, 1.31, 0.035]} rotation={[0, Math.PI, 0]} material={mats.back}>
          <planeGeometry args={[0.5, 0.31]} />
        </mesh>
      </group>
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
  /** Which side of the pen fence it is on — see `resolveFence`. */
  outside: boolean;
  /** Height off the ground, and velocity, while it is in the air. */
  y: number;
  vx: number;
  vy: number;
  vz: number;
  airborne: boolean;
  /** Tumble, while airborne; and how long it stays dazed after landing. */
  spin: number;
  spinRate: number;
  dazed: number;
  /** Seconds it has been running flat out. Sheep are sprinters, not stayers. */
  run: number;
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
      outside: true,
      y: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      airborne: false,
      spin: 0,
      spinRate: 0,
      dazed: 0,
      run: 0,
    };
  });
})();

/** A leg: dark, thin, pivoting at the top so it can trot. */
const SHEEP_LEG = new THREE.CapsuleGeometry(0.027, 0.3, 4, 8).translate(0, -0.17, 0);

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
  // the flock, for poking at from the console in dev
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __flock?: unknown }).__flock = flock;
  }, []);
  const mats = useMemo(
    () => ({
      fleece: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
      leg: new THREE.MeshStandardMaterial({ color: SHEEP_DARK, roughness: 0.7 }),
      eye: new THREE.MeshStandardMaterial({ color: "#fbfbf6", roughness: 0.3 }),
      pupil: new THREE.MeshBasicMaterial({ color: "#111" }),
    }),
    []
  );

  // meshed in the skin worker; the flock appears when it is ready
  const [geo, setGeo] = useState<{ body: THREE.BufferGeometry; head: THREE.BufferGeometry } | null>(null);
  useEffect(() => {
    let live = true;
    void skinGeometry({ kind: "sheep" }).then(([body, head]) => {
      if (live) setGeo({ body, head });
    });
    return () => {
      live = false;
    };
  }, []);

  const groups = useRef<(THREE.Group | null)[]>([]);
  const heads = useRef<(THREE.Group | null)[]>([]);
  const legs = useRef<(THREE.Group | null)[]>([]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;

    for (let i = 0; i < flock.length; i++) {
      const s = flock[i];
      const dx = s.x - cowState.x;
      const dz = s.z - cowState.z;
      const d = Math.hypot(dx, dz);

      // Bowled. A galloping cow is faster than a sheep, and what happens when
      // it catches one is not a collision, it is a launch.
      if (!s.airborne && d < 1.1 && cowState.speed > BONK_SPEED * 0.9 && cowState.stand < 0.2) {
        const fx = Math.sin(cowState.facing);
        const fz = Math.cos(cowState.facing);
        const nx = d > 1e-3 ? dx / d : fx;
        const nz = d > 1e-3 ? dz / d : fz;
        const push = 2.4 + cowState.speed * 0.7;
        s.vx = (nx * 0.6 + fx * 0.8) * push;
        s.vz = (nz * 0.6 + fz * 0.8) * push;
        s.vy = 5.2 + Math.random() * 1.2;
        s.airborne = true;
        s.spinRate = (Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 5);
        yeet();
        const store = useCowStore.getState();
        store.bumpStat("sheep");
        store.complete("bowl");
      }

      let speed = 0;
      if (s.airborne) {
        s.x += s.vx * dt;
        s.z += s.vz * dt;
        s.y += s.vy * dt;
        s.vy -= 15 * dt;
        s.spin += s.spinRate * dt;
        if (s.y <= 0) {
          s.y = 0;
          // which side of the fence it came down on is simply where it is now
          s.outside = Math.hypot(s.x, s.z) > PIT_RADIUS;
          if (s.vy < -4) {
            // one bounce, then a heap
            s.vy *= -0.32;
            s.vx *= 0.45;
            s.vz *= 0.45;
            s.spinRate *= 0.4;
            baa();
          } else {
            s.airborne = false;
            s.vy = 0;
            s.dazed = 1.6;
            s.homeX = s.x;
            s.homeZ = s.z;
          }
        }
      } else if (s.dazed > 0) {
        // lies there for a moment reconsidering its life
        s.dazed -= dt;
        s.spin += (Math.round(s.spin / (Math.PI * 2)) * Math.PI * 2 - s.spin) * Math.min(1, dt * 6);
      } else if (d < SPOOK) {
        // straight away from the cow, and it does not look back
        const nx = d > 1e-3 ? dx / d : 1;
        const nz = d > 1e-3 ? dz / d : 0;
        // a little sideways too, so six sheep don't run in one straight line
        const swerve = Math.sin(i * 2.1) * 0.5;
        const ax = nx - nz * swerve;
        const az = nz + nx * swerve;
        const al = Math.hypot(ax, az) || 1;
        // A sheep outruns a galloping cow for about two seconds, then flags —
        // so a cow that keeps after one will catch it, and one that gives up
        // never will.
        s.run += dt;
        const tired = 1 - Math.min(0.42, Math.max(0, s.run - 2) * 0.2);
        speed = SHEEP_SPEED * tired * Math.min(1, (SPOOK - d) / 1.6 + 0.35);
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
        s.spin = 0;
        s.run = Math.max(0, s.run - dt * 0.8);
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

      if (!s.airborne) {
        // Sheep respect the fence too, the same way the cow does: a ring with
        // a gate in it. They used to walk straight through the rails.
        const fence = resolveFence(s.x, s.z, s.outside, cowState.gateOpen);
        s.x = fence.x;
        s.z = fence.z;
        if (!fence.outside && s.outside) useCowStore.getState().complete("herd");
        s.outside = fence.outside;
        // ...and trees, and the station, or a herded flock ends up inside one
        const clear = resolveSolids(s.x, s.z);
        s.x = clear.x;
        s.z = clear.z;
        // and they cannot stand inside the cow
        const cx = s.x - cowState.x;
        const cz = s.z - cowState.z;
        const cd = Math.hypot(cx, cz);
        if (cd < 0.7 && cd > 1e-3) {
          s.x = cowState.x + (cx / cd) * 0.7;
          s.z = cowState.z + (cz / cd) * 0.7;
        }
      }

      s.cooldown = Math.max(0, s.cooldown - dt);
      s.bob += dt * (2.5 + speed * 3.2);

      const g = groups.current[i];
      if (g) {
        const run = Math.min(1, speed);
        g.position.set(s.x, s.y + Math.abs(Math.sin(s.bob)) * 0.035 * run, s.z);
        g.rotation.set(s.airborne || s.dazed > 0 ? s.spin : 0, s.facing, Math.sin(s.bob) * 0.05 * run);
      }
      const h = heads.current[i];
      if (h) {
        // head down grazing when still, up and forward when running
        const run = Math.min(1, speed / 2);
        h.rotation.x = 0.85 * (1 - run) + Math.sin(t * 2 + i) * 0.06 * (1 - run) - run * 0.15;
        if (s.dazed > 0) h.rotation.x = Math.sin(t * 9) * 0.3;
      }
      // trotting legs, diagonal pairs together; flailing in the air
      for (let k = 0; k < 4; k++) {
        const leg = legs.current[i * 4 + k];
        if (!leg) continue;
        const pair = k === 0 || k === 3 ? 0 : Math.PI;
        leg.rotation.x = s.airborne
          ? Math.sin(t * 22 + k * 1.7) * 0.9
          : Math.sin(s.bob * 2 + pair) * 0.55 * Math.min(1, speed / 1.5);
      }
    }
  });

  if (!geo) return null;

  return (
    <group>
      {flock.map((_, i) => (
        <group
          key={i}
          ref={(g) => {
            groups.current[i] = g;
          }}
        >
          <mesh geometry={geo.body} material={mats.fleece} castShadow />
          <group
            ref={(g) => {
              heads.current[i] = g;
            }}
            position={[0, 0.52, 0.27]}
          >
            <mesh geometry={geo.head} material={mats.fleece} castShadow />
            {/* Eyes: white, round and permanently alarmed, which is the only
                expression a sheep needs. */}
            {[-1, 1].map((sx) => (
              <group key={sx} position={[sx * 0.042, 0.025, 0.075]}>
                <mesh material={mats.eye}>
                  <sphereGeometry args={[0.02, 10, 8]} />
                </mesh>
                <mesh position={[sx * 0.004, 0, 0.016]} material={mats.pupil}>
                  <sphereGeometry args={[0.008, 8, 6]} />
                </mesh>
              </group>
            ))}
          </group>
          {[-1, 1].map((sx) =>
            [-1, 1].map((sz) => (
              <group
                key={`${sx}${sz}`}
                position={[sx * 0.11, 0.36, sz * 0.17]}
                ref={(g) => {
                  legs.current[i * 4 + (sx < 0 ? 0 : 2) + (sz < 0 ? 0 : 1)] = g;
                }}
              >
                <mesh geometry={SHEEP_LEG} material={mats.leg} castShadow />
              </group>
            ))
          )}
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
