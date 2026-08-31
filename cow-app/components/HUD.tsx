"use client";

import { useCowStore, Tool } from "@/lib/store";

const TOOLS: { id: Tool; label: string; emoji: string }[] = [
  { id: "feed", label: "Feed grass", emoji: "🌿" },
  { id: "pet", label: "Pet", emoji: "🖐️" },
  { id: "slap", label: "Slap", emoji: "👋" },
];

export default function HUD() {
  const tool = useCowStore((s) => s.tool);
  const setTool = useCowStore((s) => s.setTool);
  const dialogue = useCowStore((s) => s.dialogue);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
      <div className="flex justify-center">
        {dialogue && (
          <div className="pointer-events-none rounded-2xl bg-white/90 px-4 py-2 text-lg font-medium text-neutral-900 shadow-lg">
            {dialogue}
          </div>
        )}
      </div>

      <div className="pointer-events-auto flex justify-center gap-3 pb-4">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className={`flex items-center gap-2 rounded-full px-4 py-3 text-base font-semibold shadow-lg transition-transform active:scale-95 ${
              tool === t.id
                ? "bg-emerald-500 text-white"
                : "bg-white/90 text-neutral-800"
            }`}
          >
            <span className="text-xl">{t.emoji}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
