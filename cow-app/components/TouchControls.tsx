"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setStick } from "@/lib/input";
import { useIsTouch } from "@/lib/useIsTouch";

const BASE = 150; // outer ring, in px — large enough to hit without looking
const KNOB = 68;
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

  if (!touch) return null;

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
      className="pointer-events-auto absolute bottom-6 left-5 touch-none select-none rounded-full border-4 border-white/50 bg-black/25 backdrop-blur-sm"
      style={{ width: BASE, height: BASE }}
    >
      <div className="absolute inset-0 flex items-center justify-center text-4xl text-white/35">
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
