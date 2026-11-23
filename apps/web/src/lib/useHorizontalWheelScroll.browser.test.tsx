import { useRef } from "react";
import { expect, it } from "vite-plus/test";

import { render } from "../../test/render";
import { useHorizontalWheelScroll } from "./useHorizontalWheelScroll";

function Strip() {
  const ref = useRef<HTMLDivElement>(null);
  useHorizontalWheelScroll(ref);
  return (
    <div ref={ref} data-testid="strip" style={{ width: 200, overflowX: "auto", display: "flex" }}>
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} style={{ flex: "0 0 60px" }}>
          {`Agent ${i}`}
        </span>
      ))}
    </div>
  );
}

const wheel = (target: HTMLElement, deltaY: number, deltaX = 0) => {
  const event = new WheelEvent("wheel", { deltaY, deltaX, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

it("turns a vertical mouse wheel into sideways scrolling until the strip runs out", async () => {
  await using _screen = await render(<Strip />, { router: false }); // no routes involved
  const strip = document.querySelector<HTMLElement>('[data-testid="strip"]')!;
  expect(strip.hasAttribute("data-more-after")).toBe(true);
  expect(strip.hasAttribute("data-more-before")).toBe(false);

  const down = wheel(strip, 100);
  expect(down.defaultPrevented).toBe(true);
  await expect.poll(() => strip.scrollLeft).toBeGreaterThan(0);
  await expect.poll(() => strip.hasAttribute("data-more-before")).toBe(true);

  // At the start a wheel up is not ours: it passes on to whatever scrolls around the strip.
  strip.scrollLeft = 0;
  await expect.poll(() => strip.scrollLeft).toBe(0);
  expect(wheel(strip, -100).defaultPrevented).toBe(false);

  // Sideways trackpad swipes keep their native scrolling.
  expect(wheel(strip, 2, 60).defaultPrevented).toBe(false);
});
