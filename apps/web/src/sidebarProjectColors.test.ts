import { describe, expect, it } from "vite-plus/test";
import {
  assignProjectColorSlots,
  parseProjectColorSlots,
  projectTagColors,
} from "./sidebarProjectColors";

describe("parseProjectColorSlots", () => {
  it("reads a record of slot numbers and nothing else", () => {
    expect(parseProjectColorSlots(null)).toEqual({});
    expect(parseProjectColorSlots("not json")).toEqual({});
    expect(parseProjectColorSlots("[1,2]")).toEqual({});
    expect(
      parseProjectColorSlots(JSON.stringify({ a: 0, b: "1", c: -1, d: 1.5, e: null, f: 3 })),
    ).toEqual({ a: 0, f: 3 });
  });

  it("keeps a slot with the first project that claims it", () => {
    expect(parseProjectColorSlots(JSON.stringify({ a: 2, b: 2, c: 3 }))).toEqual({ a: 2, c: 3 });
  });
});

describe("assignProjectColorSlots", () => {
  it("gives new projects the lowest free slots in key order", () => {
    expect(assignProjectColorSlots({}, ["media", "phone", "notes"])).toEqual({
      media: 0,
      notes: 1,
      phone: 2,
    });
  });

  it("leaves known projects where they are and fills the gaps", () => {
    expect(assignProjectColorSlots({ phone: 1, media: 3 }, ["notes", "phone", "media"])).toEqual({
      phone: 1,
      media: 3,
      notes: 0,
    });
  });

  it("keeps a slot for a project that is absent, so a new one never takes its colour", () => {
    expect(assignProjectColorSlots({ gone: 0 }, ["new"])).toEqual({ gone: 0, new: 1 });
  });

  it("returns the known slots themselves when nothing is new", () => {
    const known = { a: 0, b: 1 };
    expect(assignProjectColorSlots(known, ["b", "a", "a"])).toBe(known);
    expect(assignProjectColorSlots(known, [])).toBe(known);
  });

  it("never shares a slot between projects", () => {
    const keys = Array.from({ length: 80 }, (_, index) => `project-${index}`);
    const slots = assignProjectColorSlots({}, keys);
    expect(new Set(Object.values(slots)).size).toBe(keys.length);
  });
});

describe("projectTagColors", () => {
  it("gives every slot its own colour", () => {
    const colors = Array.from({ length: 120 }, (_, slot) => JSON.stringify(projectTagColors(slot)));
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("is stable for a slot and tints and inks each theme", () => {
    expect(projectTagColors(4)).toEqual(projectTagColors(4));
    const { light, dark } = projectTagColors(0);
    expect(light.background).toMatch(/^oklch\(.+ \/ 0\.22\)$/);
    expect(dark.background).toMatch(/^oklch\(.+ \/ 0\.2\)$/);
    expect(light.foreground).not.toBe(dark.foreground);
  });

  it("keeps the hues of one tier apart", () => {
    const hues = Array.from({ length: 12 }, (_, index) =>
      Number(
        /oklch\([\d.]+ [\d.]+ ([\d.]+)/.exec(projectTagColors(index * 3).light.foreground)![1],
      ),
    );
    for (const [index, hue] of hues.entries())
      for (const other of hues.slice(index + 1)) {
        const gap = Math.abs(hue - other);
        expect(Math.min(gap, 360 - gap)).toBeGreaterThanOrEqual(10);
      }
  });
});
