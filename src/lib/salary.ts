import type { OffDay, SalaryConfig, SalaryEvent, Vacation } from "./api";
import { daysInMonth, parseYmdLocal, ymd } from "./date";
import {
  isRussianProductionCalendarDayOff,
  isRussianWorkingWeekend,
  type RussianProductionCalendarDay,
} from "./russianProductionCalendar";
import { getSalaryEventAccrualMonth, normalizeSalaryEventKind } from "./salaryEvent";

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

function clampSalaryDay(year: number, month0: number, day: number) {
  return Math.min(Math.max(day, 1), daysInMonth(year, month0));
}

function shiftToPreviousWorkday(date: Date) {
  const shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekDay = shifted.getDay();
  if (weekDay === 6) {
    shifted.setDate(shifted.getDate() - 1);
  } else if (weekDay === 0) {
    shifted.setDate(shifted.getDate() - 2);
  }
  return shifted;
}

export function normalizeSalaryConfigs(configs?: SalaryConfig[] | null) {
  return [...(configs ?? [])]
    .filter((config) => /^\d{4}-\d{2}-\d{2}$/.test(config.effectiveFrom))
    .map((config) => ({
      ...config,
      amount: Math.max(0, Math.trunc(config.amount)),
      autoGenerate: config.autoGenerate === true,
      advancePercent: Math.min(100, Math.max(0, Math.trunc(config.advancePercent))),
      advanceDay: Math.min(31, Math.max(1, Math.trunc(config.advanceDay))),
      salaryDay: Math.min(31, Math.max(1, Math.trunc(config.salaryDay))),
    }))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id));
}

export function findSalaryConfigForAccrualMonth(
  configs: SalaryConfig[] | null | undefined,
  accrualMonth: string,
) {
  if (!/^\d{4}-\d{2}$/.test(accrualMonth)) return null;

  const normalized = normalizeSalaryConfigs(configs);
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if (normalized[index].effectiveFrom.slice(0, 7) <= accrualMonth) {
      return normalized[index];
    }
  }

  return null;
}

export function buildAutoSalaryEvents(
  configs: SalaryConfig[] | null | undefined,
  rangeStart: string,
  rangeEnd: string,
): SalaryEvent[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rangeStart) || !/^\d{4}-\d{2}-\d{2}$/.test(rangeEnd) || rangeStart > rangeEnd) {
    return [];
  }

  const normalized = normalizeSalaryConfigs(configs);
  if (normalized.length === 0) return [];

  const start = parseYmdLocal(rangeStart);
  const end = parseYmdLocal(rangeEnd);
  const events: SalaryEvent[] = [];

  // Include the previous accrual month because its final payout happens in the
  // following calendar month (for example, August salary paid on September 5).
  const cursor = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const lastAccrualMonth = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= lastAccrualMonth) {
    const year = cursor.getFullYear();
    const month0 = cursor.getMonth();
    const accrualMonth = `${year}-${String(month0 + 1).padStart(2, "0")}`;
    let config: SalaryConfig | null = null;
    for (let index = normalized.length - 1; index >= 0; index -= 1) {
      if (normalized[index].effectiveFrom.slice(0, 7) <= accrualMonth) {
        config = normalized[index];
        break;
      }
    }

    if (config?.autoGenerate && config.amount > 0) {
      const advanceBase = new Date(year, month0, clampSalaryDay(year, month0, config.advanceDay));
      const salaryMonth = new Date(year, month0 + 1, 1);
      const salaryBase = new Date(
        salaryMonth.getFullYear(),
        salaryMonth.getMonth(),
        clampSalaryDay(salaryMonth.getFullYear(), salaryMonth.getMonth(), config.salaryDay),
      );
      const advanceDate = ymd(shiftToPreviousWorkday(advanceBase));
      const salaryDate = ymd(shiftToPreviousWorkday(salaryBase));
      const advanceAmount = Math.floor((config.amount * config.advancePercent) / 100);
      const salaryAmount = config.amount - advanceAmount;

      const candidates: Array<SalaryEvent & { payoutType: "advance" | "salary" }> = [
        {
          id: `auto_${config.id}_advance_${accrualMonth}`,
          date: advanceDate,
          amount: advanceAmount,
          title: "Advance",
          accrualMonth,
          generated: true,
          sourceConfigId: config.id,
          payoutType: "advance",
          kind: "regular",
        },
        {
          id: `auto_${config.id}_salary_${accrualMonth}`,
          date: salaryDate,
          amount: salaryAmount,
          title: "Salary",
          accrualMonth,
          generated: true,
          sourceConfigId: config.id,
          payoutType: "salary",
          kind: "regular",
        },
      ];

      for (const candidate of candidates) {
        if (candidate.amount <= 0) continue;
        if (candidate.date < rangeStart || candidate.date > rangeEnd) continue;
        events.push(candidate);
      }
    }

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

type ManualSalaryEstimateArgs = {
  enteredAmount: number;
  payoutDate: string;
  accrualMonth: string;
  payoutKindOverride?: ManualSalaryPayoutKind | null;
  title: string;
  salaryConfigs?: SalaryConfig[] | null;
  salaryEvents: SalaryEvent[];
  excludedSalaryEventIds?: string[];
  vacations: Vacation[];
  workSchedule: "5/2" | "custom";
  offDays: OffDay[];
  productionCalendarDays?: ReadonlyMap<string, RussianProductionCalendarDay> | null;
};

export type ManualSalaryEstimate = {
  amount: number;
  payoutKind: ManualSalaryPayoutKind;
  payrollMonth: string;
  periodStart: string;
  periodEnd: string;
  periodWorkingDays: number;
  monthWorkingDays: number;
  payablePeriodWorkingDays: number;
  payableMonthWorkingDays: number;
  vacationWorkingDaysExcluded: number;
  monthlySalaryAmount: number;
  previouslyRecordedAmount: number;
  enteredAmount: number | null;
  deltaFromEntered: number | null;
  source: "config" | "history" | "input_fallback";
};

export type ManualSalaryPayoutKind = "first_half" | "second_half";

function isEffectiveWorkingDay(
  date: string,
  workSchedule: "5/2" | "custom",
  offDays: OffDay[],
  productionCalendarDays?: ReadonlyMap<string, RussianProductionCalendarDay> | null,
) {
  const offForDay = offDays.find((offDay) => offDay.date === date) ?? null;
  if (workSchedule === "custom") {
    return offForDay ? !!offForDay.is_working : false;
  }

  const jsDay = parseYmdLocal(date).getDay();
  const isWeekend = jsDay === 0 || jsDay === 6;
  const defaultWorking = isRussianWorkingWeekend(date, productionCalendarDays)
    ? true
    : isRussianProductionCalendarDayOff(date, productionCalendarDays)
      ? false
      : !isWeekend;

  return offForDay ? !!offForDay.is_working : defaultWorking;
}

function countWorkingDaysInRange(
  startDate: string,
  endDate: string,
  workSchedule: "5/2" | "custom",
  offDays: OffDay[],
  productionCalendarDays?: ReadonlyMap<string, RussianProductionCalendarDay> | null,
) {
  if (startDate > endDate) return 0;

  let total = 0;
  const cursor = parseYmdLocal(startDate);
  const end = parseYmdLocal(endDate);

  while (cursor <= end) {
    const date = ymd(cursor);
    if (isEffectiveWorkingDay(date, workSchedule, offDays, productionCalendarDays)) {
      total += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return total;
}

function isVacationDay(date: string, vacations: Vacation[]) {
  return vacations.some((vacation) => vacation.start_date <= date && vacation.end_date >= date);
}

function countPayableWorkingDaysInRange(
  startDate: string,
  endDate: string,
  workSchedule: "5/2" | "custom",
  offDays: OffDay[],
  vacations: Vacation[],
  productionCalendarDays?: ReadonlyMap<string, RussianProductionCalendarDay> | null,
) {
  if (startDate > endDate) return 0;

  let total = 0;
  const cursor = parseYmdLocal(startDate);
  const end = parseYmdLocal(endDate);

  while (cursor <= end) {
    const date = ymd(cursor);
    if (
      isEffectiveWorkingDay(date, workSchedule, offDays, productionCalendarDays) &&
      !isVacationDay(date, vacations)
    ) {
      total += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return total;
}

function previousMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function inferMonthlySalaryAmountFromHistory(
  salaryEvents: SalaryEvent[],
  accrualMonth: string,
  title: string,
  vacations: Vacation[],
  workSchedule: "5/2" | "custom",
  offDays: OffDay[],
  productionCalendarDays?: ReadonlyMap<string, RussianProductionCalendarDay> | null,
) {
  const normalizedTitle = title.trim().toLowerCase();

  function collectTotals(matchByTitle: boolean) {
    const totalsByMonth = new Map<string, number>();

    for (const salaryEvent of salaryEvents) {
      if (salaryEvent.generated) continue;
      if (normalizeSalaryEventKind(salaryEvent.kind) !== "regular") continue;
      if (matchByTitle && (salaryEvent.title ?? "").trim().toLowerCase() !== normalizedTitle) continue;

      const salaryEventAccrualMonth = getSalaryEventAccrualMonth(salaryEvent);
      if (!salaryEventAccrualMonth || salaryEventAccrualMonth >= accrualMonth) continue;

      totalsByMonth.set(
        salaryEventAccrualMonth,
        (totalsByMonth.get(salaryEventAccrualMonth) ?? 0) + salaryEvent.amount
      );
    }

    return totalsByMonth;
  }

  function getVacationWorkingDaysExcludedForMonth(month: string) {
    const monthDate = parseYmdLocal(`${month}-01`);
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(daysInMonth(monthDate.getFullYear(), monthDate.getMonth())).padStart(2, "0")}`;
    const monthWorkingDays = countWorkingDaysInRange(
      monthStart,
      monthEnd,
      workSchedule,
      offDays,
      productionCalendarDays,
    );
    const payableMonthWorkingDays = countPayableWorkingDaysInRange(
      monthStart,
      monthEnd,
      workSchedule,
      offDays,
      vacations,
      productionCalendarDays,
    );

    return monthWorkingDays - payableMonthWorkingDays;
  }

  function pickBestMonth(totalsByMonth: Map<string, number>) {
    const months = Array.from(totalsByMonth.keys()).sort((a, b) => b.localeCompare(a));
    const latestUnaffectedMonth = months.find((month) => getVacationWorkingDaysExcludedForMonth(month) === 0) ?? null;
    return latestUnaffectedMonth ?? months[0] ?? null;
  }

  const titledTotals = normalizedTitle ? collectTotals(true) : new Map<string, number>();
  const fallbackTotals = titledTotals.size > 0 ? titledTotals : collectTotals(false);
  const latestMonth = pickBestMonth(fallbackTotals);
  if (!latestMonth) {
    return null;
  }

  return fallbackTotals.get(latestMonth) ?? null;
}

export function estimateManualSalaryForDate(args: ManualSalaryEstimateArgs): ManualSalaryEstimate | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(args.payoutDate) ||
    !/^\d{4}-\d{2}$/.test(args.accrualMonth)
  ) {
    return null;
  }

  const excludedSalaryEventIds = new Set(args.excludedSalaryEventIds ?? []);
  const relevantSalaryEvents = args.salaryEvents.filter((salaryEvent) => !excludedSalaryEventIds.has(salaryEvent.id));

  const payout = parseYmdLocal(args.payoutDate);
  const payoutMonth = args.payoutDate.slice(0, 7);
  const payoutDay = payout.getDate();
  const previousPayoutMonth = previousMonth(payoutMonth);
  const normalizedTitle = args.title.trim().toLowerCase();
  const matchingRecordedEvents = relevantSalaryEvents.filter((salaryEvent) => {
    if (salaryEvent.generated) return false;
    if (normalizeSalaryEventKind(salaryEvent.kind) !== "regular") return false;
    const salaryEventAccrualMonth = getSalaryEventAccrualMonth(salaryEvent);
    if (salaryEventAccrualMonth !== args.accrualMonth) return false;
    if (salaryEvent.date >= args.payoutDate) return false;
    if (!normalizedTitle) return true;
    return (salaryEvent.title ?? "").trim().toLowerCase() === normalizedTitle;
  });
  const recordedEventsForAccrualMonth = matchingRecordedEvents.length > 0
    ? matchingRecordedEvents
    : relevantSalaryEvents.filter((salaryEvent) => {
        if (salaryEvent.generated) return false;
        if (normalizeSalaryEventKind(salaryEvent.kind) !== "regular") return false;
        const salaryEventAccrualMonth = getSalaryEventAccrualMonth(salaryEvent);
        return salaryEventAccrualMonth === args.accrualMonth && salaryEvent.date < args.payoutDate;
      });
  const payoutKind: ManualSalaryPayoutKind =
    args.payoutKindOverride
    ?? (
      payoutMonth === args.accrualMonth
        ? recordedEventsForAccrualMonth.length > 0
          ? "second_half"
          : "first_half"
        : previousPayoutMonth === args.accrualMonth
          ? "second_half"
          : payoutDay <= 15
            ? "second_half"
            : "first_half"
    );
  const payrollMonth = args.accrualMonth;
  const payrollMonthDate = parseYmdLocal(`${payrollMonth}-01`);
  const monthStart = `${payrollMonth}-01`;
  const monthEnd = `${payrollMonth}-${String(daysInMonth(payrollMonthDate.getFullYear(), payrollMonthDate.getMonth())).padStart(2, "0")}`;
  const firstHalfEnd = `${payrollMonth}-15`;
  const periodStart = payoutKind === "second_half" ? `${payrollMonth}-16` : monthStart;
  const periodEnd = payoutKind === "second_half" ? monthEnd : firstHalfEnd;

  const monthWorkingDays = countWorkingDaysInRange(
    monthStart,
    monthEnd,
    args.workSchedule,
    args.offDays,
    args.productionCalendarDays,
  );
  const periodWorkingDays = countWorkingDaysInRange(
    periodStart,
    periodEnd,
    args.workSchedule,
    args.offDays,
    args.productionCalendarDays,
  );

  if (monthWorkingDays <= 0 || periodWorkingDays <= 0) {
    return null;
  }

  const payableMonthWorkingDays = countPayableWorkingDaysInRange(
    monthStart,
    monthEnd,
    args.workSchedule,
    args.offDays,
    args.vacations,
    args.productionCalendarDays,
  );
  const payablePeriodWorkingDays = countPayableWorkingDaysInRange(
    periodStart,
    periodEnd,
    args.workSchedule,
    args.offDays,
    args.vacations,
    args.productionCalendarDays,
  );
  const payableFirstHalfWorkingDays = countPayableWorkingDaysInRange(
    monthStart,
    firstHalfEnd,
    args.workSchedule,
    args.offDays,
    args.vacations,
    args.productionCalendarDays,
  );
  const vacationWorkingDaysExcluded = monthWorkingDays - payableMonthWorkingDays;

  const monthlySalaryAmountFromConfig = findSalaryConfigForAccrualMonth(
    args.salaryConfigs,
    args.accrualMonth,
  )?.amount ?? null;
  const monthlySalaryAmountFromHistory = inferMonthlySalaryAmountFromHistory(
    relevantSalaryEvents,
    args.accrualMonth,
    args.title,
    args.vacations,
    args.workSchedule,
    args.offDays,
    args.productionCalendarDays,
  );
  const enteredAmount = args.enteredAmount > 0 ? args.enteredAmount : null;
  const monthlySalaryAmount = monthlySalaryAmountFromConfig ?? monthlySalaryAmountFromHistory ?? enteredAmount;
  if (monthlySalaryAmount === null || monthlySalaryAmount <= 0) {
    return null;
  }
  const source: "config" | "history" | "input_fallback" = monthlySalaryAmountFromConfig !== null
    ? "config"
    : monthlySalaryAmountFromHistory !== null
      ? "history"
      : "input_fallback";
  const firstHalfAmount = Math.round((monthlySalaryAmount * payableFirstHalfWorkingDays) / monthWorkingDays);
  const previouslyRecordedAmount = relevantSalaryEvents
    .filter((salaryEvent) => recordedEventsForAccrualMonth.includes(salaryEvent))
    .reduce((sum, salaryEvent) => sum + salaryEvent.amount, 0);
  const cumulativeTarget = payoutKind === "first_half"
    ? firstHalfAmount
    : Math.round((monthlySalaryAmount * payableMonthWorkingDays) / monthWorkingDays);
  const amount = Math.max(0, cumulativeTarget - previouslyRecordedAmount);

  return {
    amount,
    payoutKind,
    payrollMonth,
    periodStart,
    periodEnd,
    periodWorkingDays,
    monthWorkingDays,
    payablePeriodWorkingDays,
    payableMonthWorkingDays,
    vacationWorkingDaysExcluded,
    monthlySalaryAmount,
    previouslyRecordedAmount,
    enteredAmount,
    deltaFromEntered: enteredAmount === null ? null : enteredAmount - amount,
    source,
  };
}
