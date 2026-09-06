import type { SalaryEvent, Transaction } from "./api";
import { ymFromYmd } from "./date";
import { normalizeCategoryInput } from "./category";

export type MonthlyCategory = {
  category: string;
  amount: number;
  type: "income" | "expense";
};

export function buildMonthlyCategories(
  transactions: Transaction[],
  salaryEvents: SalaryEvent[],
  monthKey: string,
  today: string,
): MonthlyCategory[] {
  const categories = new Map<string, MonthlyCategory>();
  const add = (type: MonthlyCategory["type"], category: string, amount: number) => {
    const key = `${type}:${category}`;
    const previous = categories.get(key);
    categories.set(key, { type, category, amount: (previous?.amount ?? 0) + amount });
  };

  for (const tx of transactions) {
    if (ymFromYmd(tx.date) !== monthKey || tx.date > today) continue;
    if (tx.type !== "income" && tx.type !== "expense") continue;
    add(tx.type, normalizeCategoryInput(tx.category) || "No category", tx.amount);
  }
  for (const salary of salaryEvents) {
    if (ymFromYmd(salary.date) !== monthKey || salary.date > today) continue;
    add("income", normalizeCategoryInput(salary.title) || "Salary", salary.amount);
  }

  return [...categories.values()].sort((a, b) => b.amount - a.amount);
}
