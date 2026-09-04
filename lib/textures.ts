// Every surface in the game is painted at runtime onto a <canvas> and handed to
// three.js as a texture. No image files, same as there are no model files.
//
// Two things do most of the work here:
//
// - `fbm` is tileable value noise (several octaves of a wrapping random lattice,
//   smoothed and summed). It is what stops the field, the dirt and the bark from
//   reading as flat paint, and because the lattice wraps, the texture can be
//   repeated across a 90-unit field with no visible seam.
// - `blob` draws a closed shape whose radius wobbles, so a cow's patches and a
//   dry spot in the grass have ragged organic outlines rather than being circles.
//
// Everything is cached by name: the canvases are drawn once, on first use.

import * as THREE from "three";
import { rng } from "./geometry";

const cache = new Map<string, THREE.Texture>();

function make(
  key: string,
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeat: [number, number] = [1, 1]
): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Same as `make`, but for maps that are read as data (bump, roughness). */
function makeData(
  key: string,
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeat: [number, number] = [1, 1]
): THREE.Texture {
  const tex = make(key, size, draw, repeat);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// noise + shape helpers
// ---------------------------------------------------------------------------

/**
 * A wrapping random lattice, smoothed. `cells` is rounded up to a power of two
 * so the wrap is a bitmask rather than two modulos — this function is called a
 * few million times while the textures are being painted, and that one change is
 * worth several hundred milliseconds off the load.
 */
function lattice(cells: number, seed: number): (x: number, y: number) => number {
  const n = 1 << Math.ceil(Math.log2(Math.max(2, cells)));
  const mask = n - 1;
  const r = rng(seed);
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    // smoothstep the interpolation, or the lattice shows up as a diamond grid
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const x0 = xi & mask;
    const x1 = (xi + 1) & mask;
    const r0 = (yi & mask) * n;
    const r1 = ((yi + 1) & mask) * n;
    const a = g[r0 + x0] + (g[r0 + x1] - g[r0 + x0]) * sx;
    const b = g[r1 + x0] + (g[r1 + x1] - g[r1 + x0]) * sx;
    return a + (b - a) * sy;
  };
}

/** Fractal noise on a tileable lattice, returned as a 0..1 sampler over 0..1 UV. */
function fbm(baseCells: number, octaves: number, seed: number): (u: number, v: number) => number {
  const base = 1 << Math.ceil(Math.log2(Math.max(2, baseCells)));
  const sizes: number[] = [];
  const gains: number[] = [];
  const layers: ((x: number, y: number) => number)[] = [];
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const cells = base << i;
    sizes.push(cells);
    gains.push(Math.pow(0.5, i));
    layers.push(lattice(cells, seed + i * 977));
    norm += gains[i];
  }
  return (u, v) => {
    let sum = 0;
    for (let i = 0; i < octaves; i++) sum += layers[i](u * sizes[i], v * sizes[i]) * gains[i];
    return sum / norm;
  };
}

/** Fill the canvas from a per-pixel colour function. */
function paint(
  ctx: CanvasRenderingContext2D,
  size: number,
  shade: (u: number, v: number) => [number, number, number]
) {
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = shade(x / size, y / size);
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** A closed shape with a ragged edge — a cow patch, a bare spot, a lichen stain. */
function blob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rand: () => number,
  wobble = 0.42
) {
  const lobes = 3 + Math.floor(rand() * 4);
  const phase = rand() * Math.PI * 2;
  const phase2 = rand() * Math.PI * 2;
  const squash = 0.6 + rand() * 0.8;
  ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const k =
      1 +
      Math.sin(a * lobes + phase) * wobble * 0.6 +
      Math.sin(a * (lobes + 3) + phase2) * wobble * 0.3;
    const x = cx + Math.cos(a) * r * k;
    const y = cy + Math.sin(a) * r * k * squash;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** Draw the same blob nine times so it survives being wrapped at the edges. */
function tiledBlob(
  ctx: CanvasRenderingContext2D,
  size: number,
  cx: number,
  cy: number,
  r: number,
  seed: number,
  wobble = 0.42
) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      blob(ctx, cx + ox * size, cy + oy * size, r, rng(seed), wobble);
    }
  }
}

function mix(a: number[], b: number[], t: number): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// ---------------------------------------------------------------------------
// the cow
// ---------------------------------------------------------------------------

const HIDE_CREAM = [243, 239, 229];
const HIDE_SHADOW = [214, 206, 190];
const HIDE_BLACK = [38, 34, 31];

/**
 * Holstein hide for the barrel and neck. `u` runs around the body and `v` along
 * it, so the patches are laid out to break the silhouette rather than stripe it.
 * Tiles horizontally, because u wraps at the seam down the cow's belly.
 */
export function hideMap(): THREE.Texture {
  return make("hide", 384, (ctx, s) => {
    const hair = fbm(24, 4, 31);
    paint(ctx, s, (u, v) => {
      const n = hair(u, v);
      return mix(HIDE_CREAM, HIDE_SHADOW, n * 0.55);
    });

    // Patches. Placed by hand rather than at random: a cow reads as a cow because
    // its back and flanks are broken up and its underside stays pale.
    ctx.fillStyle = `rgb(${HIDE_BLACK.join(",")})`;
    const patches: [number, number, number, number][] = [
      [0.12, 0.24, 0.15, 11],
      [0.42, 0.16, 0.13, 23],
      [0.78, 0.3, 0.16, 37],
      [0.28, 0.62, 0.17, 41],
      [0.62, 0.72, 0.14, 53],
      [0.9, 0.62, 0.12, 67],
      [0.05, 0.86, 0.13, 71],
      [0.55, 0.42, 0.09, 83],
    ];
    for (const [u, v, r, seed] of patches) tiledBlob(ctx, s, u * s, v * s, r * s, seed);

    // A wash of the hair noise back over the top, so the patches take the same
    // coat texture as the white and do not read as stickers.
    const grain = fbm(48, 3, 97);
    const img = ctx.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = (y * s + x) * 4;
        const k = 0.86 + grain(x / s, y / s) * 0.28;
        img.data[i] *= k;
        img.data[i + 1] *= k;
        img.data[i + 2] *= k;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/**
 * The head is painted deliberately: a dark cap over the poll, a patch over one
 * eye, and the classic pale blaze down the middle of the face.
 *
 * **`v` runs poll (0) to nose (1)**, because that is the order `skullGeo`'s
 * rings are listed in. This was upside down for a while and put the Holstein cap
 * on the cow's nose, which is a hard thing to unsee once you have spotted it.
 */
export function headMap(): THREE.Texture {
  return make("head", 384, (ctx, s) => {
    const hair = fbm(28, 4, 131);
    paint(ctx, s, (u, v) => {
      const n = hair(u, v);
      return mix(HIDE_CREAM, HIDE_SHADOW, n * 0.5);
    });
    ctx.fillStyle = `rgb(${HIDE_BLACK.join(",")})`;
    // cap over the poll and down the back of the ears
    tiledBlob(ctx, s, 0.5 * s, 0.06 * s, 0.28 * s, 211, 0.3);
    // patch over the cow's left eye and cheek
    tiledBlob(ctx, s, 0.72 * s, 0.4 * s, 0.17 * s, 227, 0.5);
    // a fleck on the other cheek so the face is not symmetrical
    tiledBlob(ctx, s, 0.22 * s, 0.34 * s, 0.07 * s, 233, 0.6);

    // The blaze: a pale stripe straight down the front of the face, painted back
    // over the patches. Without it a spotted head reads as a random mess rather
    // than a face, because there is nothing running along the axis of symmetry.
    const grad = ctx.createLinearGradient(0, 0, s, 0);
    grad.addColorStop(0.34, "rgba(246,242,233,0)");
    grad.addColorStop(0.46, "rgba(246,242,233,0.95)");
    grad.addColorStop(0.54, "rgba(246,242,233,0.95)");
    grad.addColorStop(0.66, "rgba(246,242,233,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s * 0.82);

    // A narrow band of dark skin right where the muzzle pad comes through, so
    // the pad is framed in lip rather than stuck onto white hair.
    //
    // The band is narrow because the pad already covers everything past v≈0.93:
    // an earlier version started this gradient at v=0.7 and painted the entire
    // bridge of the nose grey, which turned the head into a snout.
    const muzzle = ctx.createLinearGradient(0, s * 0.8, 0, s);
    muzzle.addColorStop(0, "rgba(96,80,76,0)");
    muzzle.addColorStop(1, "rgba(126,110,102,0.2)");
    ctx.fillStyle = muzzle;
    ctx.fillRect(0, s * 0.8, s, s * 0.2);
  });
}

// ---------------------------------------------------------------------------
// the cow's legs
//
// Two maps, and the split is the whole point: **both of them are cream at the
// knee**. The upper leg only darkens right at the top, where the shoulder or
// the haunch is covering it anyway, so the material changes at a joint where
// the two sides already match and the seam has nothing to show. Give the upper
// leg the hide's patches instead — the obvious thing to do — and you get a
// white pipe plugged into a spotted boot, which is what the first pass was.
//
// `v` runs 0 at the joint to 1 at the far end of the bone, because that is the
// direction `boneGeo` lofts.
// ---------------------------------------------------------------------------

const LEG_CREAM = [238, 233, 222];
const LEG_SHADOW = [206, 198, 182];

/** Cream, with the hair grain and a little dirt low down. Knee and cannon. */
export function legMap(): THREE.Texture {
  return make("leg", 192, (ctx, s) => {
    const hair = fbm(30, 4, 151);
    const grime = fbm(7, 3, 157);
    const dirt = [148, 128, 100];
    paint(ctx, s, (u, v) => {
      const col = mix(LEG_CREAM, LEG_SHADOW, hair(u, v) * 0.5);
      // Splashed up from the field, heaviest at the fetlock. Kept faint: any
      // more and the dirt reads as a sock rather than as dirt.
      const mud = Math.max(0, v - 0.68) * 1.4 * Math.max(0, grime(u, v) - 0.42) * 1.5;
      return mix(col, dirt, Math.min(0.26, mud));
    });
  });
}

/**
 * The same cream, shading into the coat only at the very top of the bone, which
 * is buried inside the shoulder or the haunch. Everything you can actually see
 * of this bone matches the one below it.
 */
export function upperLegMap(): THREE.Texture {
  return make("upperLeg", 192, (ctx, s) => {
    const hair = fbm(30, 4, 163);
    const shade = [198, 190, 174];
    paint(ctx, s, (u, v) => {
      const col = mix(LEG_CREAM, LEG_SHADOW, hair(u, v) * 0.5);
      // a soft darkening into the shadow of the body above, top 22% only
      return mix(col, shade, Math.max(0, 1 - v / 0.22) * 0.55);
    });
  });
}

/** Fine hair grain, used as a bump everywhere on the cow so the coat catches light. */
export function hairBump(): THREE.Texture {
  return makeData(
    "hairBump",
    256,
    (ctx, s) => {
      const n = fbm(40, 3, 401);
      paint(ctx, s, (u, v) => {
        // stretched along v so it reads as lying hair rather than static
        const k = n(u, v * 0.35) * 255;
        return [k, k, k];
      });
    },
    [3, 3]
  );
}

// ---------------------------------------------------------------------------
// the ground
// ---------------------------------------------------------------------------

/** The field. Tiled small enough to have detail underfoot and wide enough to hide the repeat. */
export function fieldMap(): THREE.Texture {
  return make(
    "field",
    256,
    (ctx, s) => {
      const clumps = fbm(6, 4, 7);
      const fine = fbm(40, 3, 17);
      const dry = fbm(3, 3, 29);
      const deepGreen = [66, 108, 45];
      const midGreen = [104, 152, 63];
      const litGreen = [136, 178, 82];
      const strawy = [158, 160, 96];
      paint(ctx, s, (u, v) => {
        const c = clumps(u, v);
        const f = fine(u, v);
        let col = mix(deepGreen, midGreen, c);
        col = mix(col, litGreen, f * 0.55);
        // sun-bleached patches, but only where the clump noise is already light
        const d = Math.max(0, dry(u, v) - 0.62) * 2.4 * c;
        return mix(col, strawy, Math.min(0.55, d));
      });
      // a scatter of darker tufts so the field has something to focus on
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "rgb(58,96,40)";
      const r = rng(59);
      for (let i = 0; i < 70; i++) {
        tiledBlob(ctx, s, r() * s, r() * s, 3 + r() * 9, 1000 + i, 0.6);
      }
      ctx.globalAlpha = 1;
    },
    [26, 26]
  );
}

/** Trodden earth: the pen floor and the road to the station. */
export function dirtMap(): THREE.Texture {
  return make(
    "dirt",
    256,
    (ctx, s) => {
      const coarse = fbm(5, 4, 71);
      const fine = fbm(44, 3, 89);
      const pale = [173, 148, 112];
      const mid = [143, 116, 83];
      const dark = [104, 82, 58];
      paint(ctx, s, (u, v) => {
        const c = coarse(u, v);
        const f = fine(u, v);
        const col = mix(dark, mid, c);
        return mix(col, pale, f * 0.6);
      });
      // Pebbles and hoof scuffs. Kept low-contrast and near-round on purpose:
      // this texture is repeated ten times across the pen, and anything bold or
      // spiky here turns into an obvious grid of identical stars on the ground.
      const r = rng(97);
      ctx.globalAlpha = 0.22;
      for (let i = 0; i < 200; i++) {
        const g = 110 + Math.floor(r() * 70);
        ctx.fillStyle = `rgb(${g + 26},${g + 14},${g})`;
        tiledBlob(ctx, s, r() * s, r() * s, 1.2 + r() * 2.6, 2000 + i, 0.18);
      }
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = "rgb(84,66,46)";
      for (let i = 0; i < 55; i++) {
        tiledBlob(ctx, s, r() * s, r() * s, 5 + r() * 16, 3000 + i, 0.45);
      }
      ctx.globalAlpha = 1;
    },
    [16, 16]
  );
}

/** Bump for anything on the ground, so low sun rakes across it. */
export function groundBump(): THREE.Texture {
  return makeData(
    "groundBump",
    256,
    (ctx, s) => {
      const n = fbm(20, 4, 211);
      paint(ctx, s, (u, v) => {
        const k = n(u, v) * 255;
        return [k, k, k];
      });
    },
    [26, 26]
  );
}

// ---------------------------------------------------------------------------
// timber, bark, buildings
// ---------------------------------------------------------------------------

/** Sawn fence timber: grain along the length, a couple of knots, weathered grey. */
export function woodMap(): THREE.Texture {
  return make(
    "wood",
    256,
    (ctx, s) => {
      const wander = fbm(4, 3, 313);
      const rough = fbm(30, 3, 331);
      const light = [173, 133, 86];
      const mid = [138, 101, 62];
      const dark = [96, 68, 42];
      const gone = [150, 140, 124]; // weathered to grey
      paint(ctx, s, (u, v) => {
        // grain runs along v; bend it so the lines are not ruler-straight
        const line = (u + wander(u * 0.3, v) * 0.14) * 26;
        const g = Math.abs(Math.sin(line * Math.PI));
        let col = mix(mid, dark, Math.pow(g, 3) * 0.9);
        col = mix(col, light, rough(u, v) * 0.4);
        return mix(col, gone, 0.22 + rough(u * 2, v * 0.4) * 0.2);
      });
      const r = rng(347);
      for (let i = 0; i < 3; i++) {
        const cx = r() * s;
        const cy = r() * s;
        ctx.fillStyle = "rgba(84,58,35,0.85)";
        tiledBlob(ctx, s, cx, cy, 4 + r() * 5, 4000 + i, 0.25);
        ctx.fillStyle = "rgba(56,38,22,0.9)";
        tiledBlob(ctx, s, cx, cy, 2 + r() * 2, 4100 + i, 0.25);
      }
    },
    [1, 3]
  );
}

/** Tree bark: deep vertical furrows. */
export function barkMap(): THREE.Texture {
  return make(
    "bark",
    256,
    (ctx, s) => {
      const wander = fbm(3, 3, 419);
      const grain = fbm(26, 4, 431);
      const light = [124, 100, 74];
      const mid = [88, 68, 48];
      const dark = [46, 35, 25];
      paint(ctx, s, (u, v) => {
        const line = (u + wander(u, v * 0.35) * 0.3) * 16;
        const furrow = Math.pow(Math.abs(Math.sin(line * Math.PI)), 0.5);
        let col = mix(dark, mid, furrow);
        col = mix(col, light, grain(u, v) * 0.45);
        return col;
      });
    },
    [2, 2]
  );
}

/** Painted render for the station walls: flat colour, but not perfectly flat. */
export function stuccoMap(): THREE.Texture {
  return make(
    "stucco",
    256,
    (ctx, s) => {
      const speck = fbm(52, 3, 509);
      const wash = fbm(4, 3, 521);
      const base = [226, 221, 208];
      const dirty = [188, 182, 166];
      paint(ctx, s, (u, v) => {
        const col = mix(base, dirty, wash(u, v) * 0.4);
        return mix(col, dirty, speck(u, v) * 0.35);
      });
      // rain streaks down from the top
      const r = rng(523);
      ctx.globalAlpha = 0.06;
      ctx.strokeStyle = "rgb(120,116,104)";
      for (let i = 0; i < 26; i++) {
        ctx.lineWidth = 1 + r() * 3;
        const x = r() * s;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (r() - 0.5) * 8, r() * s * 0.7);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    [2, 1]
  );
}

/** Brick, for the station plinth and gate piers. */
export function brickMap(): THREE.Texture {
  return make(
    "brick",
    256,
    (ctx, s) => {
      const grit = fbm(40, 3, 601);
      ctx.fillStyle = "rgb(196,192,182)"; // mortar
      ctx.fillRect(0, 0, s, s);
      const rows = 8;
      const h = s / rows;
      const r = rng(607);
      for (let row = 0; row < rows; row++) {
        const offset = (row % 2) * (s / 8);
        for (let col = -1; col < 4; col++) {
          const x = col * (s / 4) + offset + 2;
          const y = row * h + 2;
          const tone = 0.75 + r() * 0.5;
          ctx.fillStyle = `rgb(${Math.round(150 * tone)},${Math.round(84 * tone)},${Math.round(
            64 * tone
          )})`;
          ctx.fillRect(x, y, s / 4 - 4, h - 4);
        }
      }
      const img = ctx.getImageData(0, 0, s, s);
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const i = (y * s + x) * 4;
          const k = 0.82 + grit(x / s, y / s) * 0.36;
          img.data[i] *= k;
          img.data[i + 1] *= k;
          img.data[i + 2] *= k;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    [3, 2]
  );
}

/** Corrugated roof sheeting. */
export function roofMap(): THREE.Texture {
  return make(
    "roof",
    256,
    (ctx, s) => {
      const rust = fbm(9, 4, 701);
      const slate = [74, 80, 92];
      const litSlate = [116, 124, 138];
      const rusty = [128, 84, 58];
      paint(ctx, s, (u, v) => {
        const rib = (Math.sin(u * Math.PI * 2 * 16) + 1) / 2;
        const col = mix(slate, litSlate, rib);
        const r = Math.max(0, rust(u, v) - 0.62) * 2.2;
        return mix(col, rusty, Math.min(0.7, r));
      });
    },
    [4, 2]
  );
}

/** The station sign. Canvas text is the one thing a canvas texture is unbeatable at. */
export function signMap(text: string, bg = "#16306b", fg = "#f4f6fb"): THREE.Texture {
  return make(`sign:${text}:${bg}`, 512, (ctx, s) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = fg;
    ctx.fillRect(0, s * 0.22, s, s * 0.012);
    ctx.fillRect(0, s * 0.78, s, s * 0.012);
    ctx.font = `bold ${Math.round(s * 0.26)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, s / 2, s / 2, s * 0.9);
    // a little grime so it is not showroom-fresh
    const n = fbm(12, 3, 811);
    const img = ctx.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = (y * s + x) * 4;
        const k = 0.88 + n(x / s, y / s) * 0.2;
        img.data[i] *= k;
        img.data[i + 1] *= k;
        img.data[i + 2] *= k;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/**
 * Alpha masks for ground decals. A hard-edged circle of dirt on a field looks
 * painted on; fading the edge out lets the pen floor and the road *end* in the
 * grass the way worn earth actually does.
 */
export function discFadeMap(): THREE.Texture {
  const tex = make("discFade", 256, (ctx, s) => {
    const n = fbm(7, 4, 907);
    paint(ctx, s, (u, v) => {
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      // the noise makes the boundary ragged instead of a perfect circle
      const edge = 0.72 + n(u, v) * 0.3;
      const k = 1 - Math.max(0, Math.min(1, (d - edge + 0.28) / 0.34));
      const a = k * k * (3 - 2 * k) * 255;
      return [a, a, a];
    });
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** The same idea for the road: solid down the middle, ragged along both verges. */
export function stripFadeMap(): THREE.Texture {
  const tex = make("stripFade", 256, (ctx, s) => {
    const n = fbm(9, 4, 911);
    paint(ctx, s, (u, v) => {
      const d = Math.abs(v - 0.5) * 2;
      const edge = 0.6 + n(u * 3, v) * 0.34;
      const k = 1 - Math.max(0, Math.min(1, (d - edge + 0.3) / 0.36));
      const a = k * k * (3 - 2 * k) * 255;
      return [a, a, a];
    });
  });
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** A soft radial glow, used for the "you can eat this" marker and the beacon flare. */
export function glowMap(inner: string, outer: string): THREE.Texture {
  return make(`glow:${inner}:${outer}`, 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.55, outer);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}
