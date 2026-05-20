import { useMemo } from "react";
import { AppData } from "../lib/api";
import { formatDateForDisplay, ymFromYmd } from "../lib/date";
import type { DateFormat } from "../lib/date";
import { rub } from "../lib/money";

type GeneralStatsSurfaceProps = {
  data: AppData | null;
  monthKey: string;
  year: number;
  today: string;
  vacationAverageDailyPay: number;
  dateFormat: DateFormat;
};

export function GeneralStatsSurface(props: GeneralStatsSurfaceProps) {
  const { data, monthKey, year, today, vacationAverageDailyPay, dateFormat } = props;
  const monthLabel = useMemo(
    () =>
      capitalizeMonth(
        new Date(`${monthKey}-01`).toLocaleString("en-US", {
          month: "long",
          year: "numeric",
        })
      ),
    [monthKey]
  );

  const monthTotals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    if (!data) return { inc, exp };

    for (const t of data.transactions) {
      if (ymFromYmd(t.date) !== monthKey) continue;
      if (t.date > today) continue;
      if (t.type === "income") inc += t.amount;
      if (t.type === "expense") exp += t.amount;
    }

    for (const s of data.salaryEvents ?? []) {
      if (ymFromYmd(s.date) === monthKey && s.date <= today) inc += s.amount;
    }

    return { inc, exp };
  }, [data, monthKey, today]);

  const yearTotals = useMemo(() => {
    let incomeTotal = 0;
    let salaryAndVacationIncome = 0;
    if (!data) return { incomeTotal, salaryAndVacationIncome };

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const salaryVacationPattern = /(salary|advance|vacation|зарп|аванс|отпуск)/i;

    for (const t of data.transactions) {
      if (t.date < yearStart || t.date > yearEnd || t.date > today) continue;
      if (t.type !== "income") continue;
      incomeTotal += t.amount;

      const salaryHint = `${t.category ?? ""} ${t.note ?? ""}`;
      if (salaryVacationPattern.test(salaryHint)) {
        salaryAndVacationIncome += t.amount;
      }
    }

    for (const s of data.salaryEvents ?? []) {
      if (s.date < yearStart || s.date > yearEnd || s.date > today) continue;
      incomeTotal += s.amount;
      salaryAndVacationIncome += s.amount;
    }

    return { incomeTotal, salaryAndVacationIncome };
  }, [data, today, year]);

  return (
    <div className="surface general-stats-surface" style={{ minWidth: 0, height: "100%" }}>
      <div className="general-stats-header">
        <div>
          <div className="general-stats-eyebrow">{"Overview"}</div>
          <b className="general-stats-title">{monthLabel}</b>
        </div>
        <div className="general-stats-date">
          <span className="general-stats-date-label">{"As of today"}</span>
          <b>{formatDateForDisplay(today, dateFormat)}</b>
        </div>
      </div>

      <div className="general-stats-highlight-grid">
        <div className="general-stats-highlight-card general-stats-highlight-card-income">
          <div className="general-stats-metric-label">{"Received this month"}</div>
          <div className="general-stats-metric-value">{rub(monthTotals.inc)}</div>
        </div>
        <div className="general-stats-highlight-card general-stats-highlight-card-expense">
          <div className="general-stats-metric-label">{"Spent this month"}</div>
          <div className="general-stats-metric-value">{rub(monthTotals.exp)}</div>
        </div>
      </div>

      <div className="general-stats-secondary-grid">
        <div className="general-stats-secondary-card">
          <div className="general-stats-secondary-label">{"Year salary + vacation"}</div>
          <div className="general-stats-secondary-value">{rub(yearTotals.salaryAndVacationIncome)}</div>
        </div>
        <div className="general-stats-secondary-card">
          <div className="general-stats-secondary-label">{"Year total income"}</div>
          <div className="general-stats-secondary-value">{rub(yearTotals.incomeTotal)}</div>
        </div>
        <div className="general-stats-secondary-card">
          <div className="general-stats-secondary-label">{"Vacation average per day"}</div>
          <div className="general-stats-secondary-value">{rub(vacationAverageDailyPay)}</div>
        </div>
      </div>
    </div>
  );
}

function capitalizeMonth(value: string) {
  if (!value) return value;
  return value[0].toUpperCase() + value.slice(1);
}
