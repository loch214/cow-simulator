/**
 * "Turn your phone sideways", with no words in it.
 *
 * A sentence of instructions is a sentence the player has to stop and read,
 * and this one was competing with a dancing cow. A phone that turns itself,
 * with two arrows going round it, says the same thing in about a fifth of a
 * second and needs no translating. The animation is `.phone-turn` and
 * `.phone-arrows` in app/globals.css.
 *
 * `aria-label` carries the words for anyone who needs them.
 */
export default function RotateHint({ size = 44 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="Turn your phone sideways"
      style={{ width: size, height: size }}
      className="shrink-0 overflow-visible"
    >
      {/* The arrows do not turn with the phone — they are the instruction, and
          the phone is what obeys it. */}
      <g
        className="phone-arrows"
        fill="none"
        stroke="#2ad2c9"
        strokeWidth={5}
        strokeLinecap="round"
      >
        <path d="M8 26 A26 26 0 0 1 22 9" />
        <path d="M56 38 A26 26 0 0 1 42 55" />
      </g>
      <g className="phone-arrows" fill="#2ad2c9">
        <path d="M23 1 L30 12 L14 13.5 Z" />
        <path d="M41 63 L34 52 L50 50.5 Z" />
      </g>

      <g className="phone-turn">
        <rect
          x={22}
          y={11}
          width={20}
          height={42}
          rx={5}
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
        />
        {/* camera and speaker, so it reads as a phone and not a domino */}
        <circle cx={27} cy={45} r={1.8} fill="currentColor" />
        <rect x={30.5} y={43.4} width={7} height={3.2} rx={1.6} fill="currentColor" />
      </g>
    </svg>
  );
}
