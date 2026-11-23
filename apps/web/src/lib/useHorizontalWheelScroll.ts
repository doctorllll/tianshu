import { type RefObject, useEffect } from "react";
import { observeResize } from "./observeResize";

/**
 * Lets a mouse wheel scroll a sideways strip: a vertical turn moves it left or right while it has
 * room, and passes on at either end. Trackpads already scroll sideways and are left alone. Marks
 * `data-more-before` / `data-more-after` on the strip while items are hidden off either edge.
 */
export function useHorizontalWheelScroll(ref: RefObject<HTMLElement | null>) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the strip's native non-passive wheel, scroll and size listeners while mounted
  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;

    const mark = () => {
      const room = strip.scrollWidth - strip.clientWidth;
      strip.toggleAttribute("data-more-before", room > 1 && strip.scrollLeft > 1);
      strip.toggleAttribute("data-more-after", room > 1 && strip.scrollLeft < room - 1);
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const room = strip.scrollWidth - strip.clientWidth;
      if (room <= 1) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? strip.clientWidth
            : 1;
      const delta = event.deltaY * unit;
      if ((delta < 0 && strip.scrollLeft <= 0) || (delta > 0 && strip.scrollLeft >= room - 1)) {
        return;
      }
      event.preventDefault();
      // A wheel notch jumps ~100px; glide it so the strip does not teleport.
      strip.scrollBy({ left: delta, behavior: Math.abs(delta) >= 40 ? "smooth" : "auto" });
    };

    mark();
    strip.addEventListener("wheel", onWheel, { passive: false });
    strip.addEventListener("scroll", mark, { passive: true });
    const stopResize = observeResize(strip, mark);
    // Items arriving later widen the content without resizing the strip.
    const items = new MutationObserver(mark);
    items.observe(strip, { childList: true });
    return () => {
      strip.removeEventListener("wheel", onWheel);
      strip.removeEventListener("scroll", mark);
      stopResize();
      items.disconnect();
    };
  }, [ref]);
}
