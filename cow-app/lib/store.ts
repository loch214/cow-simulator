import { create } from "zustand";
import { ensureAudio, smack, moo, chew, kissJingle } from "./audio";
import { gags, insultLines, LIP_MARK_DURATION } from "./reactions";

export type Tool = "feed" | "pet" | "slap";

interface CowStore {
  tool: Tool;
  activeGag: string | null;
  gagStartedAt: number;
  dialogue: string | null;
  showLipMark: boolean;
  slapCount: number;
  setTool: (tool: Tool) => void;
  triggerGag: (id: "kiss" | "shy" | "slap") => void;
}

let timeouts: ReturnType<typeof setTimeout>[] = [];
let lastInsult = -1;

function clearScheduled() {
  timeouts.forEach(clearTimeout);
  timeouts = [];
}

function pickInsult(): string {
  let i = Math.floor(Math.random() * insultLines.length);
  if (insultLines.length > 1) {
    while (i === lastInsult) i = Math.floor(Math.random() * insultLines.length);
  }
  lastInsult = i;
  return insultLines[i];
}

const sounds = { smack, moo, chew, kiss: kissJingle };

export const useCowStore = create<CowStore>((set, get) => {
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    (window as unknown as { __cowStore?: unknown }).__cowStore = () => get();
  }
  return {
  tool: "feed",
  activeGag: null,
  gagStartedAt: 0,
  dialogue: null,
  showLipMark: false,
  slapCount: 0,

  setTool: (tool) => set({ tool }),

  triggerGag: (id) => {
    ensureAudio();
    clearScheduled();

    const gag = gags[id];
    const startedAt = performance.now();
    set({
      activeGag: id,
      gagStartedAt: startedAt,
      dialogue: null,
      slapCount: id === "slap" ? get().slapCount + 1 : get().slapCount,
    });

    for (const step of gag.script) {
      const timeout = setTimeout(() => {
        if (step.sound) sounds[step.sound]();
        if (step.say || step.dynamicSay) {
          set({ dialogue: step.dynamicSay ? pickInsult() : step.say ?? null });
        }
        if (step.lips) {
          set({ showLipMark: true });
          const hide = setTimeout(() => set({ showLipMark: false }), LIP_MARK_DURATION);
          timeouts.push(hide);
        }
      }, step.t);
      timeouts.push(timeout);
    }

    const end = setTimeout(() => {
      set({ activeGag: null, dialogue: null });
    }, gag.duration);
    timeouts.push(end);
  },
  };
});
