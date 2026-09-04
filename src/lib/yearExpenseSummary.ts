import type { Transaction } from "./api";
import { normalizeCategoryInput } from "./category";
import { capitalizeFirst } from "./text";

export type YearExpenseCategory = {
  category: string;
  amount: number;
  previousAmount: number;
  delta: number;
  count: number;
  share: number;
};

export type YearExpenseMonth = {
  month: number;
  label: string;
  amount: number;
};

export type YearExpenseSummary = {
  year: number;
  previousYear: number;
  total: number;
  previousTotal: number;
  yearDelta: number;
  yearDeltaPercent: number | null;
  transactionCount: number;
  averageTransaction: number;
  averageMonth: number;
  noSpendMonths: number;
  peakMonth: YearExpenseMonth | null;
  categories: YearExpenseCategory[];
  months: YearExpenseMonth[];
};

function transactionYear(date: string) {
  const parsed = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildYearExpenseSummary(
  transactions: Transaction[],
  year: number,
  locale: string,
): YearExpenseSummary {
  const previousYear = year - 1;
  const months = Array.from({ length: 12 }, (_, month) => ({
    month,
    label: capitalizeFirst(
      new Date(year, month, 1).toLocaleString(locale, { month: "short" }),
    ),
    amount: 0,
  }));
  const currentByCategory = new Map<string, { amount: number; count: number }>();
  const previousByCategory = new Map<string, number>();
  let total = 0;
  let previousTotal = 0;
  let transactionCount = 0;

  for (const transaction of transactions) {
    if (transaction.type !== "expense" || transaction.amount <= 0) continue;
    const txYear = transactionYear(transaction.date);
    const category = normalizeCategoryInput(transaction.category) || "No category";

    if (txYear === year) {
      const month = Number.parseInt(transaction.date.slice(5, 7), 10) - 1;
      if (month < 0 || month > 11) continue;
      total += transaction.amount;
      transactionCount += 1;
      months[month].amount += transaction.amount;
      const current = currentByCategory.get(category) ?? { amount: 0, count: 0 };
      current.amount += transaction.amount;
      current.count += 1;
      currentByCategory.set(category, current);
    } else if (txYear === previousYear) {
      previousTotal += transaction.amount;
      previousByCategory.set(
        category,
        (previousByCategory.get(category) ?? 0) + transaction.amount,
      );
    }
  }

  const categories = Array.from(currentByCategory.entries())
    .map(([category, current]) => {
      const previousAmount = previousByCategory.get(category) ?? 0;
      return {
        category,
        amount: current.amount,
        previousAmount,
        delta: current.amount - previousAmount,
        count: current.count,
        share: total > 0 ? current.amount / total : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, locale));

  const peakMonth = total > 0
    ? months.reduce((peak, month) => (month.amount > peak.amount ? month : peak), months[0])
    : null;
  const yearDelta = total - previousTotal;

  return {
    year,
    previousYear,
    total,
    previousTotal,
    yearDelta,
    yearDeltaPercent: previousTotal > 0 ? yearDelta / previousTotal : null,
    transactionCount,
    averageTransaction: transactionCount > 0 ? Math.round(total / transactionCount) : 0,
    averageMonth: Math.round(total / 12),
    noSpendMonths: months.filter((month) => month.amount === 0).length,
    peakMonth,
    categories,
    months,
  };
}
