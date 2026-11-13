import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/** Keep a dropdown inside the visible viewport and any scrolling ancestor. */
export function useDropdownPlacement(open: boolean, optionCount: number, portal = false) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ above: false, maxHeight: 180, top: 0, left: 0, width: 0, zIndex: 5001 });

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;

    function update() {
      const rect = anchor!.getBoundingClientRect();
      let top = 0;
      let bottom = window.innerHeight;
      for (let parent = portal ? null : anchor!.parentElement; parent; parent = parent.parentElement) {
        const overflow = window.getComputedStyle(parent).overflowY;
        if (overflow === "auto" || overflow === "scroll" || overflow === "hidden" || overflow === "clip") {
          const bounds = parent.getBoundingClientRect();
          top = Math.max(top, bounds.top + parent.clientTop);
          bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
        }
      }
      let zIndex = 5001;
      if (portal) {
        for (let parent = anchor!.parentElement; parent; parent = parent.parentElement) {
          const ancestorZIndex = Number.parseInt(window.getComputedStyle(parent).zIndex, 10);
          if (Number.isFinite(ancestorZIndex)) zIndex = Math.max(zIndex, ancestorZIndex + 1);
        }
      }
      const gap = 4;
      const below = Math.max(0, bottom - rect.bottom - gap);
      const above = Math.max(0, rect.top - top - gap);
      const desired = Math.min(180, optionCount * 34 + 8);
      const openAbove = below < desired && above > below;
      const maxHeight = Math.max(0, Math.min(180, openAbove ? above : below));
      const next = { above: openAbove, maxHeight, top: openAbove ? rect.top - gap - maxHeight : rect.bottom + gap, left: rect.left, width: rect.width, zIndex };
      setPlacement((current) => Object.keys(next).every((key) => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
    }

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, optionCount, portal]);

  const dropdownStyle: CSSProperties = portal
    ? { position: "fixed", top: placement.top, left: placement.left, right: "auto", width: placement.width, maxHeight: placement.maxHeight, zIndex: placement.zIndex }
    : placement.above
    ? { top: "auto", bottom: "calc(100% + 4px)", maxHeight: placement.maxHeight }
    : { maxHeight: placement.maxHeight };
  return { anchorRef, dropdownStyle };
}
