"use client";

import { useCowStore } from "@/lib/store";
import { LIP_MARK_DURATION } from "@/lib/reactions";

/**
 * The payoff of the kiss: a lipstick print left on the screen itself. The cow
 * lunges out of the scene until its muzzle is against the lens (see `kissLunge`
 * in Cow.tsx) and this is what it leaves behind — on the glass of whatever
 * you're playing on, not on anything in the 3D world.
 *
 * Remounted on every kiss via `lipMarkSeq` so the stamp animation replays from
 * the top instead of being skipped on the second kiss.
 */
export default function LipMark() {
  const show = useCowStore((s) => s.showLipMark);
  const seq = useCowStore((s) => s.lipMarkSeq);

  if (!show) return null;

  return (
    <div
      key={seq}
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{ ["--lip-ms" as string]: `${LIP_MARK_DURATION}ms` }}
    >
      {/* breath fog around the print, as if something warm was just against it */}
      <div
        className="lip-fog absolute h-[52vmin] w-[52vmin] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.12) 45%, rgba(255,255,255,0) 70%)",
          filter: "blur(6px)",
        }}
      />

      <div className="lip-stamp relative">
        <svg
          viewBox="0 0 260 150"
          style={{
            // sized in CSS, not in the width attribute: min() isn't reliable there
            width: "min(52vmin, 460px)",
            height: "auto",
            filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.28))",
          }}
        >
          <defs>
            {/* lipstick is thicker in the middle of the lip and thins at the edges */}
            <radialGradient id="lipBody" cx="50%" cy="45%" r="62%">
              <stop offset="0%" stopColor="#d62060" stopOpacity="0.95" />
              <stop offset="65%" stopColor="#b81450" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#7d0c33" stopOpacity="0.78" />
            </radialGradient>
            {/* the smear that bleeds out past the print */}
            <filter id="lipSmear" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
            {/* speckle: the print breaks up where the glass didn't take it */}
            <filter id="lipGrain" x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" />
              <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1.4 1" />
              <feComposite operator="in" in2="SourceGraphic" />
            </filter>
          </defs>

          {/* soft halo underneath, so it looks pressed rather than drawn */}
          <path
            d="M130 22 C 96 6, 56 26, 41 47 C 21 72, 31 97, 66 102 C 96 106, 116 92, 130 80
               C 144 92, 166 106, 196 102 C 231 97, 241 72, 221 47 C 206 26, 166 6, 130 22 Z"
            fill="#c81d5b"
            opacity="0.35"
            filter="url(#lipSmear)"
          />

          {/* the print itself */}
          <g>
            <path
              d="M130 22 C 96 6, 56 26, 41 47 C 21 72, 31 97, 66 102 C 96 106, 116 92, 130 80
                 C 144 92, 166 106, 196 102 C 231 97, 241 72, 221 47 C 206 26, 166 6, 130 22 Z"
              fill="url(#lipBody)"
            />
            {/* the line where the lips meet */}
            <path
              d="M74 50 C 100 68, 160 68, 186 50"
              fill="none"
              stroke="#6d0a2c"
              strokeWidth="3.5"
              strokeLinecap="round"
              opacity="0.85"
            />
            {/* vertical lip creases */}
            {[-42, -26, -10, 8, 24, 40].map((dx, i) => (
              <path
                key={i}
                d={`M${130 + dx} ${34 + Math.abs(dx) * 0.16} L${130 + dx * 1.06} ${
                  92 - Math.abs(dx) * 0.28
                }`}
                stroke="#8e0f3e"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.35"
              />
            ))}
            {/* the print doesn't take evenly — speckle it */}
            <path
              d="M130 22 C 96 6, 56 26, 41 47 C 21 72, 31 97, 66 102 C 96 106, 116 92, 130 80
                 C 144 92, 166 106, 196 102 C 231 97, 241 72, 221 47 C 206 26, 166 6, 130 22 Z"
              fill="#ffffff"
              opacity="0.22"
              filter="url(#lipGrain)"
            />
          </g>

          {/* glass gloss: a hard highlight lying ON TOP of the print, which is
              what sells it as being on the screen rather than in the scene */}
          <path
            d="M62 34 C 84 20, 108 16, 124 18"
            fill="none"
            stroke="#ffffff"
            strokeWidth="5"
            strokeLinecap="round"
            opacity="0.32"
          />
          <path
            d="M150 108 C 168 110, 186 106, 198 100"
            fill="none"
            stroke="#ffffff"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.18"
          />
        </svg>
      </div>
    </div>
  );
}
