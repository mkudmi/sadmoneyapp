import { SalaryEvent, Vacation } from "./api";
import { daysInMonth, parseYmdLocal, ymd } from "./date";
import type { RussianProductionCalendarDay } from "./russianProductionCalendar";
import {
  getSalaryEventAccrualMonth,
  isSalaryEventIncludedInVacationAverage,
  normalizeSalaryEventKind,
} from "./salaryEvent";

const AVERAGE_MONTH_CALENDAR_DAYS = 29.3;
const RUSSIAN_PUBLIC_HOLIDAYS = new Set([
  "01-01",
  "01-02",
  "01-03",
  "01-04",
  "01-05",
  "01-06",
  "01-07",
  "01-08",
  "02-23",
  "03-08",
  "05-01",
  "05-09",
  "06-12",
  "11-04",
]);

type VacationPayAverageArgs = {
  salaryEvents: SalaryEvent[];
  vacations: Vacation[];
  vacationStartDate: string;
  productionCalendarDays?: ReadonlyMap<string, RussianProductionCalendarDay> | null;
};

type VacationPayoutArgs = VacationPayAverageArgs & {
  vacationEndDate: string;
  vacationType?: string;
};

export type LatestPaidVacationAverageReference = {
  vacation: Vacation;
  vacationPayEvent: SalaryEvent;
  chargeableDays: number;
  averageDailyPay: number;
};

export function isRussianPublicHoliday(
  date: string,
  productionCalendarDays?: ReadonlyMap<string, RussianProductionCalendarDay> | null,
) {
  const calendarDay = productionCalendarDays?.get(date);
  if (calendarDay) {
    return calendarDay.type === "public_holiday";
  }

  return RUSSIAN_PUBLIC_HOLIDAYS.has(date.slice(5));
}

function shouldExcludeVacationDateFromAverage(
  vacation: Vacation,
  date: string,
  productionCalendarDays?: ReadonlyMap<string, RussianProductionCalendarDay> | null,
) {
  if (vacation.vacation_type === "unpaid") {
    return true;
  }

  // Paid vacation excludes only the days preserved by average earnings.
  // Public holidays inside the vacation period are not paid as vacation days.
  return !isRussianPublicHoliday(date, productionCalendarDays);
}

export function getVacationChargeableDays(
  startDate: string,
  endDate: string,
  productionCalendarDays?: ReadonlyMap<string, RussianProductionCalendarDay> | null,
) {
  if (startDate > endDate) return 0;

  let total = 0;
  const cursor = parseYmdLocal(startDate);
  const end = parseYmdLocal(endDate);

  while (cursor <= end) {
    const date = ymd(cursor);
    if (!isRussianPublicHoliday(date, productionCalendarDays)) {
      total += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return total;
}

export function calculateVacationAverageDailyPay(args: VacationPayAverageArgs) {
  const initialPeriodEnd = new Date(
    parseYmdLocal(args.vacationStartDate).getFullYear(),
    parseYmdLocal(args.vacationStartDate).getMonth(),
    0,
  );

  let anchorPeriodEnd = initialPeriodEnd;
  const earliestSalaryDate = args.salaryEvents
    .map((event) => event.date)
    .sort((a, b) => a.localeCompare(b))[0] ?? null;

  for (;;) {
    const periodEnd = new Date(anchorPeriodEnd.getFullYear(), anchorPeriodEnd.getMonth(), anchorPeriodEnd.getDate());
    const periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth() - 11, 1);

    const earningsTotal = args.salaryEvents.reduce((sum, event) => {
      const kind = normalizeSalaryEventKind(event.kind);
      if (!isSalaryEventIncludedInVacationAverage(kind)) return sum;
      const accrualMonth = getSalaryEventAccrualMonth(event);
      if (accrualMonth) {
        const eventMonthStart = `${accrualMonth}-01`;
        if (eventMonthStart < ymd(periodStart) || eventMonthStart > ymd(periodEnd)) return sum;
      } else if (event.date < ymd(periodStart) || event.date > ymd(periodEnd)) {
        return sum;
      }
      return sum + event.amount;
    }, 0);

    let denominator = 0;

    for (let monthOffset = 0; monthOffset < 12; monthOffset += 1) {
      const monthDate = new Date(periodStart.getFullYear(), periodStart.getMonth() + monthOffset, 1);
      const monthYear = monthDate.getFullYear();
      const month0 = monthDate.getMonth();
      const monthLength = daysInMonth(monthYear, month0);
      const monthStart = ymd(monthDate);
      const monthEnd = ymd(new Date(monthYear, month0, monthLength));
      const excludedDates = new Set<string>();
      for (const vacation of args.vacations) {
        const overlapStart = vacation.start_date > monthStart ? vacation.start_date : monthStart;
        const overlapEnd = vacation.end_date < monthEnd ? vacation.end_date : monthEnd;
        if (overlapStart > overlapEnd) continue;
        const cursor = parseYmdLocal(overlapStart);
        const overlapEndDate = parseYmdLocal(overlapEnd);
        while (cursor <= overlapEndDate) {
          const date = ymd(cursor);
          if (shouldExcludeVacationDateFromAverage(vacation, date, args.productionCalendarDays)) {
            excludedDates.add(date);
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      }

      const countedCalendarDays = Math.max(monthLength - excludedDates.size, 0);
      if (countedCalendarDays <= 0) continue;

      if (countedCalendarDays === monthLength) {
        denominator += AVERAGE_MONTH_CALENDAR_DAYS;
      } else {
        denominator += (AVERAGE_MONTH_CALENDAR_DAYS / monthLength) * countedCalendarDays;
      }
    }

    if (earningsTotal > 0 && denominator > 0) {
      return earningsTotal / denominator;
    }

    if (earliestSalaryDate === null || ymd(periodStart) <= earliestSalaryDate) {
      break;
    }

    anchorPeriodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth(), 0);
  }

  return 0;
}

export function calculateVacationPayout(args: VacationPayoutArgs) {
  if (args.vacationType === "unpaid") return 0;
  const averageDailyPay = calculateVacationAverageDailyPay(args);
  const chargeableDays = getVacationChargeableDays(
    args.vacationStartDate,
    args.vacationEndDate,
    args.productionCalendarDays,
  );
  return Math.round(averageDailyPay * chargeableDays);
}

export function getLatestPaidVacationAverageReference(args: {
  salaryEvents: SalaryEvent[];
  vacations: Vacation[];
  today: string;
  productionCalendarDays?: ReadonlyMap<string, RussianProductionCalendarDay> | null;
}): LatestPaidVacationAverageReference | null {
  const paidVacations = [...args.vacations]
    .filter((vacation) => vacation.vacation_type !== "unpaid" && vacation.start_date <= args.today)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));

  const vacationPayEvents = [...args.salaryEvents]
    .filter((event) => normalizeSalaryEventKind(event.kind) === "vacation_pay" && event.date <= args.today)
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const vacation of paidVacations) {
    const matchingEvent = vacationPayEvents.find((event) => {
      if (event.date > vacation.start_date) return false;
      const diffMs = parseYmdLocal(vacation.start_date).getTime() - parseYmdLocal(event.date).getTime();
      const diffDays = diffMs / (24 * 60 * 60 * 1000);
      return diffDays >= 0 && diffDays <= 31;
    });
    if (!matchingEvent) continue;

    const chargeableDays = getVacationChargeableDays(
      vacation.start_date,
      vacation.end_date,
      args.productionCalendarDays,
    );
    if (chargeableDays <= 0) continue;

    return {
      vacation,
      vacationPayEvent: matchingEvent,
      chargeableDays,
      averageDailyPay: matchingEvent.amount / chargeableDays,
    };
  }

  return null;
}
