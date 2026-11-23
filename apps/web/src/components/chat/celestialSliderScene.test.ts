import { describe, expect, it } from "vite-plus/test";

import { celestialBlendAt, celestialStageAt, celestialStagesFor } from "./celestialSliderScene";

describe("celestialStagesFor", () => {
  it("opens on an asteroid and closes on a galaxy at any count", () => {
    expect(celestialStagesFor(3).map((stage) => stage.id)).toEqual(["asteroid", "star", "galaxy"]);
    expect(celestialStagesFor(5).map((stage) => stage.id)).toEqual([
      "asteroid",
      "planet",
      "star",
      "blackhole",
      "galaxy",
    ]);
    expect(celestialStagesFor(6)[0]?.id).toBe("stardust");
    const eight = celestialStagesFor(8);
    expect(eight).toHaveLength(8);
    expect(eight.at(-1)?.id).toBe("galaxy");
  });

  it("blends between the two bodies around a ratio", () => {
    const stages = celestialStagesFor(5);
    const halfway = celestialBlendAt(0.375, stages);
    expect([halfway.from.id, halfway.to.id, halfway.mix]).toEqual(["planet", "star", 0.5]);
    expect(celestialStageAt(1, stages).id).toBe("galaxy");
    expect(celestialStageAt(0, celestialStagesFor(1)).id).toBe("star");
  });
});
