import { useEffect } from "react";

type UsePiggyBankHotkeysParams = {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
};

export function usePiggyBankHotkeys({ open, onClose, onSubmit }: UsePiggyBankHotkeysParams) {
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onSubmit();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, onSubmit]);
}
