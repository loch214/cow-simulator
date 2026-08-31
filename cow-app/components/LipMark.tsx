"use client";

import { useCowStore } from "@/lib/store";

export default function LipMark() {
  const show = useCowStore((s) => s.showLipMark);

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-500"
      style={{ opacity: show ? 1 : 0 }}
    >
      <svg width="260" height="140" viewBox="0 0 260 140" style={{ filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.35))" }}>
        <path
          d="M130 20
             C 95 5, 55 25, 40 45
             C 20 70, 30 95, 65 100
             C 95 104, 115 90, 130 78
             C 145 90, 165 104, 195 100
             C 230 95, 240 70, 220 45
             C 205 25, 165 5, 130 20 Z"
          fill="#c81d5b"
          stroke="#8e0f3e"
          strokeWidth="3"
        />
        <path d="M75 48 C 100 65, 160 65, 185 48" fill="none" stroke="#8e0f3e" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );
}
