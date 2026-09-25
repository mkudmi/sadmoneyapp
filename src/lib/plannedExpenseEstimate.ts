import type { Transaction } from "./api";
import { normalizeCategoryInput } from "./category";
import { isValidYmd, parseYmdLocal } from "./date";

export function averageExpenseAmount(transactions: Transaction[], category: string, date: string): number | null {
  const categoryKey = normalizeCategoryInput(category).toLocaleLowerCase();
  if (!categoryKey || !isValidYmd(date)) return null;

  const plannedDate = parseYmdLocal(date);
  const plannedWeekday = plannedDate.getDay();
  const plannedWeekOfMonth = Math.floor((plannedDate.getDate() - 1) / 7);

  const matchingExpenses = transactions.filter((transaction) =>
    transaction.type === "expense" &&
    !transaction.exclude_from_statistics &&
    isValidYmd(transaction.date) &&
    transaction.date < date &&
    normalizeCategoryInput(transaction.category).toLocaleLowerCase() === categoryKey
  );

  const sameWeekday = matchingExpenses.filter((transaction) =>
    parseYmdLocal(transaction.date).getDay() === plannedWeekday
  );
  const sameWeekdayAndWeekOfMonth = sameWeekday.filter((transaction) =>
    Math.floor((parseYmdLocal(transaction.date).getDate() - 1) / 7) === plannedWeekOfMonth
  );
  const sample = sameWeekdayAndWeekOfMonth.length > 0
    ? sameWeekdayAndWeekOfMonth
    : sameWeekday.length > 0 ? sameWeekday : matchingExpenses;

  return sample.length > 0
    ? Math.round(sample.reduce((total, transaction) => total + transaction.amount, 0) / sample.length)
    : null;
}
