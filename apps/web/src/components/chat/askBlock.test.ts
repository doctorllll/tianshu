import { describe, expect, it } from "vite-plus/test";
import {
  answeredOptionIndex,
  askReplyText,
  countAskFences,
  hasAskFence,
  parseAskBlock,
} from "./askBlock";

const BLOCK = ["Ship the change now?", "* Run the replay first", "- Ship it", "- Hold off"].join(
  "\n",
);

describe("parseAskBlock", () => {
  it("reads the question and marks the suggested option", () => {
    expect(parseAskBlock(BLOCK)).toEqual({
      question: "Ship the change now?",
      details: [],
      options: [
        { text: "Run the replay first", recommended: true },
        { text: "Ship it", recommended: false },
        { text: "Hold off", recommended: false },
      ],
    });
  });

  it("keeps lines before the options as details and joins wrapped options", () => {
    const block = parseAskBlock(
      "Which plan?\nBoth cost the same.\n\n* Plan A\n  with a rollback\n- Plan B\n",
    );
    expect(block?.details).toEqual(["Both cost the same."]);
    expect(block?.options.map((option) => option.text)).toEqual([
      "Plan A with a rollback",
      "Plan B",
    ]);
  });

  it("accepts a question without options and rejects a block without a question", () => {
    expect(parseAskBlock("What should the title be?")?.options).toEqual([]);
    expect(parseAskBlock("* only an option")).toBeNull();
    expect(parseAskBlock("  \n")).toBeNull();
  });
});

describe("ask fences", () => {
  it("counts only fences tagged ask", () => {
    const text =
      "Intro\n\n```ask\nA?\n- yes\n```\n\n```ts\nconst ask = 1;\n```\n\n~~~ask\nB?\n~~~\n";
    expect(countAskFences(text)).toBe(2);
    expect(hasAskFence("```asking\nx\n```")).toBe(false);
  });
});

describe("replies", () => {
  const block = parseAskBlock(BLOCK)!;

  it("sends the answer alone, or under its question when a message asks several", () => {
    expect(askReplyText(block, " Ship it ", 1)).toBe("Ship it");
    expect(askReplyText(block, "Ship it", 2)).toBe("Ship the change now?\nShip it");
  });

  it("finds the option a reply chose", () => {
    expect(answeredOptionIndex(block, "Ship  it")).toBe(1);
    expect(answeredOptionIndex(block, "Ship the change now?\nHold off")).toBe(2);
    expect(answeredOptionIndex(block, "Something else entirely")).toBe(-1);
  });
});
