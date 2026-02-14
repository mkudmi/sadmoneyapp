export function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
