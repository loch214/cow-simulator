"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setStick } from "@/lib/input";
import { useCowStore } from "@/lib/store";
import { useIsTouch } from "@/lib/useIsTouch";

// Outer ring, in px. Big enough to hit without looking, but smaller than it
// was: at 150 the stick, the buttons and the hint banner between them took up
// the whole bottom third of an upright phone and left the cow squeezed into
// what was left. The knob keeps its size, so the target you actually press is
// unchanged — only the ring around it got tighter.
const BASE = 128;
const KNOB = 66;
const RADIUS = (BASE - KNOB) / 2;

/**
 * On-screen thumb stick. Sits above the canvas and swallows its own touches, so
 * dragging it never doubles as a camera look.
 *
 * It's oversized on purpose: the target here is someone who has never held a
 * game controller, so the stick is big, always visible, and works whether you
 * drag from the centre or just plant a thumb near the edge.
 */
export default function TouchControls() {
  const touch = useIsTouch();
  const started = useCowStore((s) => s.started);
  const padRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const release = useCallback(() => {
    activeId.current = null;
    setKnob({ x: 0, y: 0 });
    setStick(0, 0);
  }, []);

  // Make sure the cow stops if the controls ever unmount mid-walk.
  useEffect(() => release, [release]);

  if (!touch || !started) return null;

  const update = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let dx = clientX - (r.left + r.width / 2);
    let dy = clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist > RADIUS) {
      dx = (dx / dist) * RADIUS;
      dy = (dy / dist) * RADIUS;
    }
    setKnob({ x: dx, y: dy });
    // screen y grows downward, but "up on the stick" means walk forward
    setStick(dx / RADIUS, -dy / RADIUS);
  };

  return (
    <div
      ref={padRef}
      onPointerDown={(e) => {
        activeId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (activeId.current !== e.pointerId) return;
        update(e.clientX, e.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      // Offsets are measured from the safe area rather than the raw viewport,
      // so the stick can't end up half under a home indicator or a browser nav
      // bar — which is exactly where it sat on an upright Android phone.
      className="pointer-events-auto absolute touch-none select-none rounded-full border-4 border-white/50 bg-black/25 backdrop-blur-sm"
      style={{
        width: BASE,
        height: BASE,
        left: "calc(var(--safe-l) + 1rem)",
        bottom: "calc(var(--safe-b) + 1rem)",
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center text-3xl text-white/35">
        ✛
      </div>
      <div
        className="pointer-events-none absolute rounded-full bg-white/85 shadow-xl"
        style={{
          width: KNOB,
          height: KNOB,
          left: (BASE - KNOB) / 2,
          top: (BASE - KNOB) / 2,
          transform: `translate(${knob.x}px, ${knob.y}px)`,
        }}
      />
    </div>
  );
}
