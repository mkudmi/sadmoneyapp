import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/** Keep a dropdown inside the visible viewport and any scrolling ancestor. */
export function useDropdownPlacement(open: boolean, optionCount: number) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ above: false, maxHeight: 180 });

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;

    function update() {
      const rect = anchor!.getBoundingClientRect();
      let top = 0;
      let bottom = window.innerHeight;
      for (let parent = anchor!.parentElement; parent; parent = parent.parentElement) {
        const overflow = window.getComputedStyle(parent).overflowY;
        if (overflow === "auto" || overflow === "scroll" || overflow === "hidden" || overflow === "clip") {
          const bounds = parent.getBoundingClientRect();
          top = Math.max(top, bounds.top + parent.clientTop);
          bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
        }
      }
      const gap = 4;
      const below = Math.max(0, bottom - rect.bottom - gap);
      const above = Math.max(0, rect.top - top - gap);
      const desired = Math.min(180, optionCount * 34 + 8);
      const openAbove = below < desired && above > below;
      const maxHeight = Math.max(0, Math.min(180, openAbove ? above : below));
      setPlacement((current) => current.above === openAbove && current.maxHeight === maxHeight
        ? current : { above: openAbove, maxHeight });
    }

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, optionCount]);

  const dropdownStyle: CSSProperties = placement.above
    ? { top: "auto", bottom: "calc(100% + 4px)", maxHeight: placement.maxHeight }
    : { maxHeight: placement.maxHeight };
  return { anchorRef, dropdownStyle };
}
