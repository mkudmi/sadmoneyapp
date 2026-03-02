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
  avgDailyEarnings: number;
  dateFormat: DateFormat;
};

export function GeneralStatsSurface(props: GeneralStatsSurfaceProps) {
  const { data, monthKey, year, today, avgDailyEarnings, dateFormat } = props;

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
    <div className="surface" style={{ minWidth: 0, height: "100%" }}>
      <div style={{ opacity: 0.9, marginBottom: 6 }}><b>{"Received this month (as of today):"}</b> {rub(monthTotals.inc)}</div>
      <div style={{ opacity: 0.9, marginBottom: 6 }}><b>{"Received this year (salary + vacation):"}</b> {rub(yearTotals.salaryAndVacationIncome)}</div>
      <div style={{ opacity: 0.9, marginBottom: 6 }}><b>{"Received this year (total):"}</b> {rub(yearTotals.incomeTotal)}</div>
      <div style={{ opacity: 0.9, marginBottom: 6 }}><b>{"Spent this month (as of today):"}</b> {rub(monthTotals.exp)}</div>
      <div style={{ opacity: 0.9, marginBottom: 6 }}><b>{"Average daily earnings:"}</b> {rub(avgDailyEarnings)}</div>
      <div style={{ opacity: 0.8 }}>
        <b>{"Today:"}</b>{" "}
        {formatDateForDisplay(today, dateFormat)}
      </div>
    </div>
  );
}
