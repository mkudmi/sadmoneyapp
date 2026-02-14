import { useEffect } from "react";

export function useDismissible(
  isOpen: boolean,
  close: () => void,
  allowSelector: string
) {
  useEffect(() => {
    if (!isOpen) return;

    function onDocClick(e: MouseEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && tgt.closest(allowSelector)) return;
      close();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [allowSelector, close, isOpen]);
}
