export type DateFormat = "dd-mm-yyyy" | "mm-dd-yyyy" | "yyyy-mm-dd";

export function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function normalizeDateFormat(value?: string | null): DateFormat {
  if (value === "mm-dd-yyyy" || value === "yyyy-mm-dd") {
    return value;
  }
  return "dd-mm-yyyy";
}

export function dateFormatPattern(format: DateFormat) {
  switch (format) {
    case "mm-dd-yyyy":
      return "MM-DD-YYYY";
    case "yyyy-mm-dd":
      return "YYYY-MM-DD";
    case "dd-mm-yyyy":
    default:
      return "DD-MM-YYYY";
  }
}

export function formatDateForDisplay(value: string, format: DateFormat) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const [year, month, day] = value.split("-");
  switch (format) {
    case "mm-dd-yyyy":
      return `${month}-${day}-${year}`;
    case "yyyy-mm-dd":
      return value;
    case "dd-mm-yyyy":
    default:
      return `${day}-${month}-${year}`;
  }
}

export function parseDisplayDate(value: string, format: DateFormat) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  let year = "";
  let month = "";
  let day = "";
  const parts = trimmed.split("-");
  if (parts.length !== 3) return null;

  switch (format) {
    case "mm-dd-yyyy":
      [month, day, year] = parts;
      break;
    case "yyyy-mm-dd":
      [year, month, day] = parts;
      break;
    case "dd-mm-yyyy":
    default:
      [day, month, year] = parts;
      break;
  }

  if (!/^\d{2}$/.test(day) || !/^\d{2}$/.test(month) || !/^\d{4}$/.test(year)) {
    return null;
  }

  const normalized = `${year}-${month}-${day}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;

  const parsed = parseYmdLocal(normalized);
  if (Number.isNaN(parsed.getTime()) || ymd(parsed) !== normalized) {
    return null;
  }

  return normalized;
}

export function ymFromYmd(s: string) {
  return s.slice(0, 7);
}

export function parseYmdLocal(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function daysInMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

export function inclusiveDays(startYmd: string, endYmd: string) {
  const start = parseYmdLocal(startYmd);
  const end = parseYmdLocal(endYmd);
  const start0 = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const end0 = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const diffDays = Math.floor((end0.getTime() - start0.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(diffDays, 0);
}

export function overlapInclusiveDays(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (start > end) return 0;
  return inclusiveDays(start, end);
}
