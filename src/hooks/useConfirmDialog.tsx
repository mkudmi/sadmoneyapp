import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";

type ConfirmState = {
  open: boolean;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

const DEFAULT_MESSAGE = "Are you sure you want to delete this?";

export function useConfirmDialog() {
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const [state, setState] = useState<ConfirmState>({
    open: false,
    message: DEFAULT_MESSAGE,
  });

  const confirm = useCallback((message = DEFAULT_MESSAGE, confirmLabel = "Delete", cancelLabel = "Cancel") => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setState({
        open: true,
        message,
        confirmLabel,
        cancelLabel,
      });
    });
  }, []);

  const closeWith = useCallback((value: boolean) => {
    setState((prev) => ({ ...prev, open: false }));
    const resolver = resolverRef.current;
    resolverRef.current = null;
    if (resolver) resolver(value);
  }, []);

  useEffect(() => {
    return () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    };
  }, []);

  const dialog = useMemo(
    () => (
      <ConfirmDialog
        open={state.open}
        message={state.message}
        confirmLabel={state.confirmLabel}
        cancelLabel={state.cancelLabel}
        onConfirm={() => closeWith(true)}
        onCancel={() => closeWith(false)}
      />
    ),
    [closeWith, state]
  );

  return { confirm, dialog };
}
