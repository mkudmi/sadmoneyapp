import { useEffect, useState } from "react";
import {
  loadRussianProductionCalendarYears,
  type RussianProductionCalendarDay,
} from "../lib/russianProductionCalendar";

export function useRussianProductionCalendar(years: number[]) {
  const [daysByDate, setDaysByDate] = useState<Map<string, RussianProductionCalendarDay>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const uniqueYears = Array.from(new Set(years)).sort((a, b) => a - b);
    if (uniqueYears.length === 0) {
      setDaysByDate(new Map());
      return;
    }

    loadRussianProductionCalendarYears(uniqueYears)
      .then((nextDaysByDate) => {
        if (!cancelled) {
          setDaysByDate(nextDaysByDate);
        }
      })
      .catch((error) => {
        console.error("failed to load Russian production calendar", error);
      });

    return () => {
      cancelled = true;
    };
  }, [years.join(",")]);

  return daysByDate;
}
