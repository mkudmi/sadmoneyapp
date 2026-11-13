import type { SalaryEvent, Transaction } from "./api";
import { ymFromYmd } from "./date";
import { normalizeCategoryInput } from "./category";

export type MonthlyCategory = {
  category: string;
  amount: number;
  type: "income" | "expense";
  foreignAmounts?: Record<string, number>;
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
    categories.set(key, { ...previous, type, category, amount: (previous?.amount ?? 0) + amount });
  };

  for (const tx of transactions) {
    if (tx.exclude_from_statistics) continue;
    if (ymFromYmd(tx.date) !== monthKey || tx.date > today) continue;
    if (tx.type === "currency_exchange") {
      add("expense", normalizeCategoryInput(tx.category) || "Currency exchange", tx.amount);
      continue;
    }
    if (tx.type !== "income" && tx.type !== "expense") continue;
    const category = normalizeCategoryInput(tx.category) || "No category";
    if (tx.currency) {
      if (tx.type !== "expense") continue;
      const key = `expense:${category}`;
      const item = categories.get(key) ?? { type: "expense" as const, category, amount: 0 };
      const foreignAmounts = item.foreignAmounts ?? {};
      foreignAmounts[tx.currency] = (foreignAmounts[tx.currency] ?? 0) + tx.amount;
      categories.set(key, { ...item, foreignAmounts });
    } else {
      add(tx.type, category, tx.amount);
    }
  }
  for (const salary of salaryEvents) {
    if (ymFromYmd(salary.date) !== monthKey || salary.date > today) continue;
    add("income", normalizeCategoryInput(salary.title) || "Salary", salary.amount);
  }

  return [...categories.values()].sort((a, b) => b.amount - a.amount);
}
