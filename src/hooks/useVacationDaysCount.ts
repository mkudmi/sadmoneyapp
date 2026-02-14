import { useCallback, useEffect, useState } from "react";

export function useVacationDaysCount(storageKey: string) {
  const [vacationDaysCount, setVacationDaysCount] = useState("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        const normalized = String(Math.max(0, Number.parseInt(stored, 10) || 0));
        setVacationDaysCount(normalized);
      }
    } catch (e) {
      console.error("failed to load vacation days count", e);
    }
  }, [storageKey]);

  const persistVacationDaysCount = useCallback((rawValue: string) => {
    const normalized = String(Math.max(0, Number.parseInt(rawValue, 10) || 0));
    setVacationDaysCount(normalized);
    try {
      localStorage.setItem(storageKey, normalized);
    } catch (e) {
      console.error("failed to save vacation days count", e);
    }
  }, [storageKey]);

  const handleVacationDaysCountChange = useCallback((rawValue: string) => {
    if (!/^\d*$/.test(rawValue)) return;
    setVacationDaysCount(rawValue);
  }, []);

  const clearVacationDaysCount = useCallback(() => {
    setVacationDaysCount("");
    try {
      localStorage.removeItem(storageKey);
    } catch (err) {
      console.error("failed to clear vacation days count", err);
    }
  }, [storageKey]);

  const commitVacationDaysCount = useCallback((rawValue: string) => {
    if (rawValue === "") {
      clearVacationDaysCount();
      return;
    }
    persistVacationDaysCount(rawValue);
  }, [clearVacationDaysCount, persistVacationDaysCount]);

  return {
    vacationDaysCount,
    handleVacationDaysCountChange,
    commitVacationDaysCount,
  };
}
