import { parseYmdLocal, ymd } from "./date";

function getRecurringSalaryDays(salaryDates: string[]) {
  return Array.from(
    new Set(
      salaryDates
        .map((date) => Number(date.slice(8, 10)))
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31)
    )
  ).sort((a, b) => a - b);
}

export function findFollowingSalaryDate(nextSalaryDate: string, salaryDates: string[]) {
  const knownNext = salaryDates
    .filter((date) => date > nextSalaryDate)
    .sort((a, b) => a.localeCompare(b))[0] ?? null;
  if (knownNext) return knownNext;

  const recurringDays = getRecurringSalaryDays(salaryDates);
  if (recurringDays.length === 0) return null;

  const base = parseYmdLocal(nextSalaryDate);
  const candidates: string[] = [];

  for (let monthOffset = 0; monthOffset <= 2; monthOffset++) {
    const y = base.getFullYear();
    const m = base.getMonth() + monthOffset;
    const expectedMonth0 = ((m % 12) + 12) % 12;

    for (const day of recurringDays) {
      const candidate = new Date(y, m, day);
      if (candidate.getMonth() !== expectedMonth0) continue;

      const candidateYmd = ymd(candidate);
      if (candidateYmd > nextSalaryDate) candidates.push(candidateYmd);
    }
  }

  return candidates.sort((a, b) => a.localeCompare(b))[0] ?? null;
}
