import { parseYmdLocal, ymd } from "./date";

const XMLCALENDAR_BASE_URL =
  "https://raw.githubusercontent.com/xmlcalendar/xmlcalendar.github.io/main/data/ru";
const STORAGE_KEY_PREFIX = "sadmoneyapp.ru.production_calendar.";

export type RussianProductionCalendarDayType =
  | "public_holiday"
  | "additional_day_off"
  | "shortened_workday"
  | "working_weekend";

export type RussianProductionCalendarDay = {
  date: string;
  type: RussianProductionCalendarDayType;
  holidayName?: string;
  holidayId?: string;
  transferFrom?: string;
};

type DayTone = {
  border: string;
  color: string;
  background: string;
  tileBackground: string;
};

type RussianProductionCalendarYear = {
  year: number;
  days: RussianProductionCalendarDay[];
};

const memoryCache = new Map<number, Promise<RussianProductionCalendarYear>>();

function storageKey(year: number) {
  return `${STORAGE_KEY_PREFIX}${year}`;
}

function readYearFromStorage(year: number) {
  if (typeof localStorage === "undefined") return null;

  try {
    const raw = localStorage.getItem(storageKey(year));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RussianProductionCalendarYear;
    if (parsed.year !== year || !Array.isArray(parsed.days)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeYearToStorage(data: RussianProductionCalendarYear) {
  if (typeof localStorage === "undefined") return;

  try {
    localStorage.setItem(storageKey(data.year), JSON.stringify(data));
  } catch {
    // Ignore storage quota or serialization issues and continue with in-memory cache.
  }
}

function parseDayType(rawType: string | null, holidayId: string | null, transferFrom: string | null) {
  switch (rawType) {
    case "1":
      return holidayId ? "public_holiday" : "additional_day_off";
    case "2":
      return "shortened_workday";
    case "3":
      return "working_weekend";
    default:
      return transferFrom ? "additional_day_off" : null;
  }
}

function normalizeMonthDayToYmd(year: number, monthDay: string) {
  const [month, day] = monthDay.split(".");
  return `${year}-${month}-${day}`;
}

function parseCalendarXml(year: number, xmlText: string): RussianProductionCalendarYear {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error(`Failed to parse Russian production calendar for ${year}`);
  }

  const holidayNames = new Map<string, string>();
  for (const holidayNode of Array.from(doc.querySelectorAll("holiday"))) {
    const holidayId = holidayNode.getAttribute("id");
    const holidayName = holidayNode.getAttribute("title");
    if (holidayId && holidayName) {
      holidayNames.set(holidayId, holidayName);
    }
  }

  const days: RussianProductionCalendarDay[] = [];
  for (const dayNode of Array.from(doc.querySelectorAll("day"))) {
    const monthDay = dayNode.getAttribute("d");
    if (!monthDay) continue;

    const holidayId = dayNode.getAttribute("h");
    const transferFrom = dayNode.getAttribute("f");
    const type = parseDayType(dayNode.getAttribute("t"), holidayId, transferFrom);
    if (!type) continue;

    days.push({
      date: normalizeMonthDayToYmd(year, monthDay),
      type,
      holidayId: holidayId ?? undefined,
      holidayName: holidayId ? holidayNames.get(holidayId) : undefined,
      transferFrom: transferFrom ? normalizeMonthDayToYmd(year, transferFrom) : undefined,
    });
  }

  return { year, days };
}

async function fetchRussianProductionCalendarYear(year: number) {
  const response = await fetch(`${XMLCALENDAR_BASE_URL}/${year}/calendar.xml`);
  if (!response.ok) {
    throw new Error(`Failed to load Russian production calendar for ${year}`);
  }

  const xmlText = await response.text();
  return parseCalendarXml(year, xmlText);
}

export function loadRussianProductionCalendarYear(year: number) {
  const cached = memoryCache.get(year);
  if (cached) return cached;

  const stored = readYearFromStorage(year);
  if (stored) {
    const promise = Promise.resolve(stored);
    memoryCache.set(year, promise);
    return promise;
  }

  const promise = fetchRussianProductionCalendarYear(year)
    .then((data) => {
      writeYearToStorage(data);
      return data;
    })
    .catch((error) => {
      memoryCache.delete(year);
      throw error;
    });
  memoryCache.set(year, promise);
  return promise;
}

export async function loadRussianProductionCalendarYears(years: number[]) {
  const uniqueYears = Array.from(new Set(years)).sort((a, b) => a - b);
  const settledResults = await Promise.allSettled(
    uniqueYears.map((year) => loadRussianProductionCalendarYear(year))
  );
  const daysByDate = new Map<string, RussianProductionCalendarDay>();
  let firstError: unknown = null;

  for (const result of settledResults) {
    if (result.status !== "fulfilled") {
      firstError ??= result.reason;
      continue;
    }

    for (const day of result.value.days) {
      daysByDate.set(day.date, day);
    }
  }

  if (daysByDate.size === 0 && firstError) {
    throw firstError;
  }

  return daysByDate;
}

export function getRussianProductionCalendarDay(
  date: string,
  daysByDate?: ReadonlyMap<string, RussianProductionCalendarDay> | null,
) {
  return daysByDate?.get(date) ?? null;
}

export function isRussianProductionCalendarDayOff(
  date: string,
  daysByDate?: ReadonlyMap<string, RussianProductionCalendarDay> | null,
) {
  const calendarDay = getRussianProductionCalendarDay(date, daysByDate);
  if (calendarDay) {
    return calendarDay.type === "public_holiday" || calendarDay.type === "additional_day_off";
  }

  const jsDay = parseYmdLocal(date).getDay();
  return jsDay === 0 || jsDay === 6;
}

export function isRussianWorkingWeekend(
  date: string,
  daysByDate?: ReadonlyMap<string, RussianProductionCalendarDay> | null,
) {
  return getRussianProductionCalendarDay(date, daysByDate)?.type === "working_weekend";
}

export function getRussianProductionCalendarDayLabel(type: RussianProductionCalendarDayType) {
  switch (type) {
    case "public_holiday":
      return "Public holiday";
    case "additional_day_off":
      return "Additional day off";
    case "shortened_workday":
      return "Shortened workday";
    case "working_weekend":
      return "Working weekend";
  }
}

export function getRussianProductionCalendarDayTone(type: RussianProductionCalendarDayType): DayTone {
  switch (type) {
    case "public_holiday":
      return {
        border: "#4b83b6",
        color: "#1d5f91",
        background: "#d9efff",
        tileBackground: "rgba(118, 191, 255, 0.22)",
      };
    case "additional_day_off":
      return {
        border: "#79a5cb",
        color: "#2e6798",
        background: "#e6f4ff",
        tileBackground: "rgba(146, 203, 255, 0.18)",
      };
    case "shortened_workday":
      return {
        border: "#8f63c9",
        color: "#5d3797",
        background: "#efe3ff",
        tileBackground: "rgba(170, 123, 255, 0.20)",
      };
    case "working_weekend":
      return {
        border: "#7687a0",
        color: "#33475f",
        background: "#e4ebf5",
        tileBackground: "rgba(130, 155, 190, 0.16)",
      };
  }
}

export function listYearsInDateRange(startDate: string, endDate: string) {
  if (startDate > endDate) return [];

  const years = new Set<number>();
  const cursor = parseYmdLocal(startDate);
  const end = parseYmdLocal(endDate);

  while (cursor <= end) {
    years.add(cursor.getFullYear());
    cursor.setFullYear(cursor.getFullYear() + 1, 0, 1);
  }

  return Array.from(years).sort((a, b) => a - b);
}

export function listYearsFromDates(dates: string[]) {
  return Array.from(
    new Set(
      dates
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .map((date) => parseYmdLocal(date).getFullYear()),
    ),
  ).sort((a, b) => a - b);
}

export function expandDateRange(startDate: string, endDate: string) {
  if (startDate > endDate) return [];

  const dates: string[] = [];
  const cursor = parseYmdLocal(startDate);
  const end = parseYmdLocal(endDate);

  while (cursor <= end) {
    dates.push(ymd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}
