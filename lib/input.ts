// All player input: keyboard, mouse look (pointer lock), and touch.
// Components poll this every frame instead of re-rendering on input events.

import { addLook, addZoom, cam, MOUSE_SENS, setZoom, TOUCH_SENS } from "./camera";

const held = new Set<string>();
const interactHandlers = new Set<() => void>();
const actionHandlers = new Set<(action: "pet" | "slap") => void>();
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

function onKeyDown(e: KeyboardEvent) {
  // The mouse belongs to the game by default. Pointer lock can only be asked for
  // from inside a real user gesture, so the first key you press takes it back
  // after Esc without you having to click anything.
  if (e.code in MOVE_KEYS || e.code === "KeyE" || e.code === "KeyQ" || e.code === "KeyF") {
    requestLock();
  }
  if (e.code in MOVE_KEYS) {
    held.add(e.code);
    e.preventDefault(); // stop arrow keys from scrolling the page
  }
  if (e.repeat) return;
  if (e.code === "KeyE") interactHandlers.forEach((h) => h());
  if (e.code === "KeyQ") actionHandlers.forEach((h) => h("pet"));
  if (e.code === "KeyF") actionHandlers.forEach((h) => h("slap"));
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

export function onAction(handler: (action: "pet" | "slap") => void): () => void {
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
  let pinchStart = 0;
  let pinchDist = 0;

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
    if (drags.size === 2) {
      pinchDist = twoFingerDistance(drags);
      pinchStart = cam.dist;
    }
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

    if (drags.size >= 2) {
      const d = twoFingerDistance(drags);
      if (pinchDist > 0) setZoom(pinchStart * (pinchDist / d));
      return;
    }
    addLook(dx, dy, e.pointerType === "touch" ? TOUCH_SENS : MOUSE_SENS);
  };

  const onPointerUp = (e: PointerEvent) => {
    drags.delete(e.pointerId);
    if (drags.size < 2) pinchDist = 0;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    addZoom(e.deltaY * 0.004);
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

function twoFingerDistance(drags: Map<number, { x: number; y: number }>): number {
  const [a, b] = [...drags.values()];
  return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
}

const lockListeners = new Set<(locked: boolean) => void>();

export function onPointerLockChange(handler: (locked: boolean) => void): () => void {
  lockListeners.add(handler);
  return () => { lockListeners.delete(handler); };
}
