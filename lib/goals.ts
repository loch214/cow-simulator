// The to-do list.
//
// The game is a sandbox — there is no score and nothing to lose — but a sandbox
// with nothing to aim at is a toy you put down after five minutes. So there is
// a list of things to do to (and with) the cow, ticked off as they happen,
// remembered between visits, and with an ending once the list is done.
//
// The list doubles as the tutorial. Every item names something the game can do
// that a new player might never find: that the gate opens, that the cow
// gallops, that sheep can be bowled, that speeding is a crime.

export type GoalId =
  | "escape"
  | "graze"
  | "kiss"
  | "finger"
  | "dance"
  | "drink"
  | "scare"
  | "gallop"
  | "bonk"
  | "ticket"
  | "bowl"
  | "herd"
  | "police"
  | "wanted";

export interface Goal {
  id: GoalId;
  /** What it says on the list. A little cryptic is fine; a riddle is not. */
  title: string;
  /** The hint underneath, for when the title is not enough. */
  hint: string;
}

export const GOALS: Goal[] = [
  { id: "escape", title: "Let yourself out", hint: "The gate opens. Walk up to it." },
  { id: "graze", title: "Have a little snack", hint: "Stand on a tuft of grass." },
  { id: "kiss", title: "Get a kiss on the screen", hint: "Pet the cow." },
  { id: "finger", title: "Get the finger", hint: "Slap the cow. Once." },
  { id: "dance", title: "Make it dance", hint: "It has moves." },
  { id: "drink", title: "Drink from the pond", hint: "Bottom right of the field." },
  { id: "scare", title: "Scare the scarecrow", hint: "Go and moo at it." },
  { id: "gallop", title: "Go flat out", hint: "Hold Shift, or push the stick all the way." },
  { id: "bonk", title: "Run headfirst into something", hint: "Galloping helps." },
  { id: "ticket", title: "Get a speeding ticket", hint: "There is a camera on the road." },
  { id: "bowl", title: "Bowl over a sheep", hint: "They are faster than you. Mostly." },
  { id: "herd", title: "Herd a sheep into the pen", hint: "They run from you. Use that." },
  { id: "police", title: "Make the cow call the police", hint: "Slap it until it has had enough." },
  { id: "wanted", title: "Become the most wanted cow", hint: "Three speeding tickets." },
];

const KEY = "the-cow:goals:v1";

/** What has been done, as id -> when. Safe to call on the server: returns {}. */
export function loadGoals(): Partial<Record<GoalId, number>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const known = new Set<string>(GOALS.map((g) => g.id));
    return Object.fromEntries(Object.entries(parsed).filter(([k]) => known.has(k)));
  } catch {
    return {};
  }
}

export function saveGoals(done: Partial<Record<GoalId, number>>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(done));
  } catch {
    // private mode, full storage: the list just won't survive a reload
  }
}
