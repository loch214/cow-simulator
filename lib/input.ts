// All player input: keyboard, mouse look (pointer lock), and touch.
// Components poll this every frame instead of re-rendering on input events.

import { addLook, addZoom, cam, MOUSE_SENS, setZoom, TOUCH_SENS } from "./camera";

export type Action = "pet" | "slap" | "dance";

const held = new Set<string>();
const interactHandlers = new Set<() => void>();
const actionHandlers = new Set<(action: Action) => void>();
let listening = 0;

/** Set by the on-screen stick. Merged with the keyboard so both always work. */
const touchStick = { x: 0, y: 0 };
/** Flips to true the first time a finger is used, so the UI can adapt. */
let touchSeen = false;
const touchListeners = new Set<(touch: boolean) => void>();

const MOVE_KEYS: Record<string, "fwd" | "back" | "left" | "right"> = {
  KeyW: "fwd", ArrowUp: "fwd",
  KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
};

/** The three things you can do to the cow, and the keys that do them. */
const ACTION_KEYS: Record<string, Action> = {
  KeyQ: "pet",
  KeyF: "slap",
  KeyR: "dance",
};

function onKeyDown(e: KeyboardEvent) {
  // The mouse belongs to the game by default. Pointer lock can only be asked for
  // from inside a real user gesture, so the first key you press takes it back
  // after Esc without you having to click anything.
  if (e.code in MOVE_KEYS || e.code in ACTION_KEYS || e.code === "KeyE") {
    requestLock();
  }
  if (e.code in MOVE_KEYS) {
    held.add(e.code);
    e.preventDefault(); // stop arrow keys from scrolling the page
  }
  if (e.repeat) return;
  if (e.code === "KeyE") interactHandlers.forEach((h) => h());
  const action = ACTION_KEYS[e.code];
  if (action) actionHandlers.forEach((h) => h(action));
}

function onKeyUp(e: KeyboardEvent) {
  held.delete(e.code);
}

function onBlur() {
  held.clear(); // otherwise alt-tabbing mid-stride leaves the cow walking forever
}

/** Call once from a mounted component; returns the teardown. */
export function startInput(): () => void {
  if (listening === 0) {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
  }
  listening++;
  return () => {
    listening--;
    if (listening === 0) {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      held.clear();
    }
  };
}

export function onInteract(handler: () => void): () => void {
  interactHandlers.add(handler);
  return () => { interactHandlers.delete(handler); };
}

export function onAction(handler: (action: Action) => void): () => void {
  actionHandlers.add(handler);
  return () => { actionHandlers.delete(handler); };
}

export function setStick(x: number, y: number) {
  touchStick.x = x;
  touchStick.y = y;
}

export function isTouch(): boolean {
  return touchSeen;
}

export function onTouchDetected(handler: (touch: boolean) => void): () => void {
  touchListeners.add(handler);
  return () => { touchListeners.delete(handler); };
}

function markTouch() {
  if (touchSeen) return;
  touchSeen = true;
  touchListeners.forEach((h) => h(true));
}

/** Movement intent in screen space: x = strafe (+ right), y = forward (+ away). */
export function moveAxis(): { x: number; y: number } {
  let x = touchStick.x;
  let y = touchStick.y;
  for (const code of held) {
    const dir = MOVE_KEYS[code];
    if (dir === "fwd") y += 1;
    else if (dir === "back") y -= 1;
    else if (dir === "right") x += 1;
    else if (dir === "left") x -= 1;
  }
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  return { x, y };
}

/** The canvas, remembered so anything can ask for the pointer back. */
let lockTarget: HTMLElement | null = null;
let lastLockTry = 0;

/**
 * Take the mouse. Silently does nothing on touch, when we already have it, or
 * within a second of the last try — Chrome refuses for about that long after Esc
 * and there's no point hammering it.
 */
export function requestLock() {
  if (!lockTarget || cam.locked || touchSeen) return;
  const now = performance.now();
  if (now - lastLockTry < 1000) return;
  lastLockTry = now;
  Promise.resolve(lockTarget.requestPointerLock?.()).catch(() => {});
}

/**
 * Bind looking to the 3D canvas.
 *
 * Mouse: the game holds the pointer by default — pressing anywhere on the field
 * (or any gameplay key) captures it, after which the view follows the mouse with
 * no button held. Esc gives the cursor back, and the next key or click takes it
 * again. While the pointer is free, dragging still looks around, so a player who
 * keeps hitting Esc can still play.
 *
 * Touch: a one-finger drag anywhere on the scene looks around, and a two-finger
 * pinch zooms. The on-screen stick sits above this and swallows its own touches.
 */
export function attachLook(el: HTMLElement): () => void {
  const drags = new Map<number, { x: number; y: number }>();

  /**
   * The pinch in progress, if any: which two pointers it is measured between,
   * how far apart they were when it started, and the zoom level it started
   * from.
   *
   * This used to be two loose numbers armed the instant a second finger
   * touched the field, and it was the reason the camera "zoomed by itself":
   * rest a second thumb anywhere while looking around with the first and the
   * next move rescaled the zoom by `startDist / currentDist`. Two fingers a
   * centimetre apart gave a ratio of five or six, so the camera slammed
   * straight out to its limit and back in again as they separated. A pinch now
   * has to look like a pinch before it counts.
   */
  let pinch: { a: number; b: number; span: number; from: number } | null = null;

  /** Two fingers closer together than this are a fumble, not a gesture. */
  const PINCH_MIN = 44;
  /** How much they have to squeeze before anything happens, as a fraction. */
  const PINCH_DEAD = 0.08;

  /** The first two live pointers, in the order they arrived. */
  const pair = (): [number, number] | null => {
    const ids = [...drags.keys()];
    return ids.length >= 2 ? [ids[0], ids[1]] : null;
  };

  const span = ([a, b]: [number, number]): number => {
    const pa = drags.get(a);
    const pb = drags.get(b);
    if (!pa || !pb) return 0;
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "touch") markTouch();
    // Any press on the field hands the mouse straight to the game.
    if (e.pointerType === "mouse") requestLock();
    // Capturing is only worth it for a drag we have to keep following off the
    // canvas. Under pointer lock there is no cursor to capture and the browser
    // throws InvalidStateError, and a mouse button released outside the window
    // can leave the id already dead — so this is guarded on both sides.
    if (!cam.locked && el.hasPointerCapture && !el.hasPointerCapture(e.pointerId)) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // pointer already gone; the drag map below still tracks it fine
      }
    }
    drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: PointerEvent) => {
    if (cam.locked) {
      addLook(e.movementX, e.movementY, MOUSE_SENS);
      return;
    }
    const prev = drags.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;

    const two = pair();
    if (two) {
      const now = span(two);
      if (!pinch) {
        // Arm it only once the fingers are properly apart. Until then this is
        // two thumbs on the screen, which is not a request for anything.
        if (now >= PINCH_MIN) pinch = { a: two[0], b: two[1], span: now, from: cam.dist };
      } else if (now > 0) {
        // Dead zone, so the pair drifting a few pixels while the player looks
        // around cannot nudge the zoom at all.
        let ratio = pinch.span / now;
        ratio = ratio > 1 ? Math.max(1, ratio - PINCH_DEAD) : Math.min(1, ratio + PINCH_DEAD);
        setZoom(pinch.from * ratio);
      }
      return;
    }
    addLook(dx, dy, e.pointerType === "touch" ? TOUCH_SENS : MOUSE_SENS);
  };

  const onPointerUp = (e: PointerEvent) => {
    drags.delete(e.pointerId);
    // Any pinch that loses one of its own two fingers is over. Rearming on the
    // remaining pair mid-gesture is what made a three-finger fumble jump.
    if (pinch && (e.pointerId === pinch.a || e.pointerId === pinch.b)) pinch = null;
    if (drags.size < 2) pinch = null;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // `deltaY` means different things depending on `deltaMode`: pixels, lines
    // or pages. Untranslated, one notch of a page-mode wheel is a hundred
    // times one notch of a pixel-mode one. And the clamp is for inertial
    // trackpads, which deliver a single enormous delta at the end of a fling.
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    addZoom(Math.max(-120, Math.min(120, px)) * 0.004);
  };

  const onLockChange = () => {
    cam.locked = document.pointerLockElement === el;
    if (!cam.locked) drags.clear();
    lockListeners.forEach((h) => h(cam.locked));
  };

  const onTouchStart = () => markTouch();

  lockTarget = el;
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("pointerlockchange", onLockChange);

  return () => {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("pointerlockchange", onLockChange);
    if (lockTarget === el) lockTarget = null;
    if (document.pointerLockElement === el) document.exitPointerLock?.();
  };
}

const lockListeners = new Set<(locked: boolean) => void>();

export function onPointerLockChange(handler: (locked: boolean) => void): () => void {
  lockListeners.add(handler);
  return () => { lockListeners.delete(handler); };
}
