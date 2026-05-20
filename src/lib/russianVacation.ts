import { SalaryEvent, Vacation } from "./api";
import { daysInMonth, parseYmdLocal, ymd } from "./date";
import { isSalaryEventIncludedInVacationAverage, normalizeSalaryEventKind } from "./salaryEvent";

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
};

type VacationPayoutArgs = VacationPayAverageArgs & {
  vacationEndDate: string;
  vacationType?: string;
};

export function isRussianPublicHoliday(date: string) {
  return RUSSIAN_PUBLIC_HOLIDAYS.has(date.slice(5));
}

export function getVacationChargeableDays(startDate: string, endDate: string) {
  if (startDate > endDate) return 0;

  let total = 0;
  const cursor = parseYmdLocal(startDate);
  const end = parseYmdLocal(endDate);

  while (cursor <= end) {
    const date = ymd(cursor);
    if (!isRussianPublicHoliday(date)) {
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

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const periodEnd = new Date(anchorPeriodEnd.getFullYear(), anchorPeriodEnd.getMonth(), anchorPeriodEnd.getDate());
    const periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth() - 11, 1);

    const earningsTotal = args.salaryEvents.reduce((sum, event) => {
      const kind = normalizeSalaryEventKind(event.kind);
      if (!isSalaryEventIncludedInVacationAverage(kind)) return sum;
      if (event.date < ymd(periodStart) || event.date > ymd(periodEnd)) return sum;
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
          excludedDates.add(ymd(cursor));
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
      return Math.round(earningsTotal / denominator);
    }

    anchorPeriodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth(), 0);
  }

  return 0;
}

export function calculateVacationPayout(args: VacationPayoutArgs) {
  if (args.vacationType === "unpaid") return 0;
  const averageDailyPay = calculateVacationAverageDailyPay(args);
  const chargeableDays = getVacationChargeableDays(args.vacationStartDate, args.vacationEndDate);
  return averageDailyPay * chargeableDays;
}
