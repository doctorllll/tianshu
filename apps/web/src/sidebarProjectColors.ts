import { useEffect } from "react";
import { localStore } from "./threadCategories";

/**
 * Which colour each project's tag wears: a slot number per project key. A slot belongs to one
 * project for good, so no two projects share a colour and a colour never moves.
 */
export type ProjectColorSlots = Readonly<Record<string, number>>;
const EMPTY_SLOTS: ProjectColorSlots = {};

export function parseProjectColorSlots(raw: string | null): ProjectColorSlots {
  if (!raw) return EMPTY_SLOTS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_SLOTS;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY_SLOTS;
  const taken = new Set<number>();
  const slots: Record<string, number> = {};
  for (const [key, slot] of Object.entries(value)) {
    // A slot two projects claim stays with the first.
    if (typeof slot !== "number" || !Number.isSafeInteger(slot) || slot < 0 || taken.has(slot))
      continue;
    taken.add(slot);
    slots[key] = slot;
  }
  return slots;
}

/**
 * Gives every project without a slot the lowest free one, in key order so a cleared store comes
 * back the same. Known projects keep theirs, also while they are absent. Returns `known` itself
 * when there is nothing to add.
 */
export function assignProjectColorSlots(
  known: ProjectColorSlots,
  projectKeys: Iterable<string>,
): ProjectColorSlots {
  const missing = [...new Set(projectKeys)].filter((key) => !Object.hasOwn(known, key)).sort();
  if (missing.length === 0) return known;
  const taken = new Set(Object.values(known));
  const next: Record<string, number> = { ...known };
  let slot = 0;
  for (const key of missing) {
    while (taken.has(slot)) slot++;
    next[key] = slot;
    taken.add(slot);
  }
  return next;
}

export interface ProjectTagColors {
  readonly light: { readonly background: string; readonly foreground: string };
  readonly dark: { readonly background: string; readonly foreground: string };
}

/** Lightness and chroma of a tag's tint and of its text, per theme. */
const TIERS = [
  { tint: [0.72, 0.14], light: [0.4, 0.14], dark: [0.84, 0.11] },
  { tint: [0.8, 0.1], light: [0.46, 0.1], dark: [0.9, 0.08] },
  { tint: [0.62, 0.17], light: [0.34, 0.16], dark: [0.78, 0.15] },
] as const;
const GOLDEN_ANGLE = 137.508;

/**
 * The colour of a slot. Hues walk round the wheel by the golden angle, so any run of slots is
 * well spread; three tiers of lightness keep neighbours apart once there are many projects.
 */
export function projectTagColors(slot: number): ProjectTagColors {
  const tier = TIERS[slot % TIERS.length]!;
  const hue =
    Math.round(
      ((Math.floor(slot / TIERS.length) * GOLDEN_ANGLE + (slot % TIERS.length) * 47 + 20) % 360) *
        10,
    ) / 10;
  const oklch = ([lightness, chroma]: readonly [number, number], alpha?: number) =>
    `oklch(${lightness} ${chroma} ${hue}${alpha === undefined ? "" : ` / ${alpha}`})`;
  return {
    light: { background: oklch(tier.tint, 0.22), foreground: oklch(tier.light) },
    dark: { background: oklch(tier.tint, 0.2), foreground: oklch(tier.dark) },
  };
}

const slotStore = localStore(
  "t3code:sidebar-project-colors:v1",
  parseProjectColorSlots,
  EMPTY_SLOTS,
);

/** The slots of the given projects, new ones included; new ones are remembered on this machine. */
export function useProjectColorSlots(projectKeys: readonly string[]): ProjectColorSlots {
  const stored = slotStore.use();
  const slots = assignProjectColorSlots(stored, projectKeys);
  const unsaved = slots !== stored;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Remembers new projects' colours so they stay put across restarts.
  useEffect(() => {
    if (unsaved) slotStore.write(slots);
  }, [unsaved, slots]);
  return slots;
}
