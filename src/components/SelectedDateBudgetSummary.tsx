import { parseYmdLocal } from "../lib/date";
import { rub } from "../lib/money";

type SelectedDateBudgetSummaryProps = {
  budget: { per_day: number; days: number; next_salary_date: string | null; available: number } | null;
  availableForSpending: number;
  dailySpendLimit: number;
  today: string;
};

export function SelectedDateBudgetSummary(props: SelectedDateBudgetSummaryProps) {
  const { budget, availableForSpending, dailySpendLimit, today } = props;

  if (!budget) return null;

  const untilNextSalary = budget.next_salary_date
    ? (() => {
        const nd = parseYmdLocal(budget.next_salary_date);
        const td = parseYmdLocal(today);
        const nd0 = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate());
        const td0 = new Date(td.getFullYear(), td.getMonth(), td.getDate());
        const diff = Math.round((nd0.getTime() - td0.getTime()) / (1000 * 60 * 60 * 24));
        return diff >= 0 ? `${diff} ${"days"}` : `0 ${"days"}`;
      })()
    : "not set";

  return (
    <>
      <div><b>{"Until next salary:"}</b> {untilNextSalary}</div>
      <div><b>{"Available:"}</b> {rub(availableForSpending)}</div>
      <div><b>{"Daily spend limit:"}</b> {rub(dailySpendLimit)}</div>
    </>
  );
}
