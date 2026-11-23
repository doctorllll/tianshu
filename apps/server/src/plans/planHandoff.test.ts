import { assert, describe, it } from "vitest";

import { PARENT_PLAN_MAX_CHARS, shouldCarry, withParentPlan } from "./planHandoff.ts";

describe("withParentPlan", () => {
  it("leaves the task alone when the parent has no plan", () => {
    assert.strictEqual(withParentPlan("Do it", { threadId: "t1", markdown: "  \n" }), "Do it");
  });

  it("puts the parent's plan after the task", () => {
    const text = withParentPlan("Do it", { threadId: "t1", markdown: "# Goal\n- [ ] a\n" });
    assert.isTrue(
      text.startsWith('Do it\n\n<parent_plan thread="t1">\n# Goal\n- [ ] a\n</parent_plan>'),
    );
    assert.notInclude(text, "plan_read");
  });

  it("cuts a long plan and says how to read the rest", () => {
    const text = withParentPlan("Do it", {
      threadId: "t1",
      markdown: "x".repeat(PARENT_PLAN_MAX_CHARS + 50),
    });
    assert.isBelow(text.length, PARENT_PLAN_MAX_CHARS + 400);
    assert.include(text, 'plan_read with threadId "t1"');
  });
});

describe("shouldCarry", () => {
  const carried = { key: "fastctx:a@m", markdown: "# Plan", updatedAt: "2026-11-24T01:00:00.000Z" };
  const here = { key: "tianshu", markdown: "", updatedAt: null, editable: true };

  it("carries the plan into an empty new home", () => {
    assert.isTrue(shouldCarry(carried, here));
  });

  it("keeps a newer plan in the new home", () => {
    assert.isFalse(
      shouldCarry(carried, { ...here, markdown: "# Mine", updatedAt: "2026-11-24T02:00:00.000Z" }),
    );
    assert.isTrue(
      shouldCarry(carried, { ...here, markdown: "# Old", updatedAt: "2026-11-23T02:00:00.000Z" }),
    );
  });

  it("does nothing in the same home, without a plan, or where it cannot write", () => {
    assert.isFalse(shouldCarry(null, here));
    assert.isFalse(shouldCarry(carried, { ...here, key: carried.key }));
    assert.isFalse(shouldCarry({ ...carried, markdown: " " }, here));
    assert.isFalse(shouldCarry(carried, { ...here, editable: false }));
  });

  it("compares fastctx's nanosecond times too", () => {
    assert.isTrue(
      shouldCarry(
        { ...carried, updatedAt: "2026-11-23T16:32:51.507479932Z" },
        { ...here, markdown: "# Old", updatedAt: "2026-11-23T16:00:00.000Z" },
      ),
    );
  });
});
