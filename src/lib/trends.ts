import type { AppData } from "./api";
import { capitalizeFirst } from "./text";
import { daysInMonth, ymFromYmd } from "./date";
import { normalizeCategoryInput } from "./category";

export type CategoryComparisonItem = {
  category: string;
  current: number;
  previous: number;
  delta: number;
};

export type TrendsData = {
  currentLabel: string;
  previousLabel: string;
  currentIncome: number;
  previousIncome: number;
  currentExpense: number;
  previousExpense: number;
  currentAvgCheck: number;
  previousAvgCheck: number;
  categoryComparison: CategoryComparisonItem[];
  incomeCategoryComparison: CategoryComparisonItem[];
};

export function buildTrendsData(params: {
  data: AppData | null;
  monthKey: string;
  year: number;
  month0: number;
  today: string;
  locale: string;
}): TrendsData {
  const { data, monthKey, year, month0, today, locale } = params;
  if (!data) {
    return {
      currentLabel: "",
      previousLabel: "",
      currentIncome: 0,
      previousIncome: 0,
      currentExpense: 0,
      previousExpense: 0,
      currentAvgCheck: 0,
      previousAvgCheck: 0,
      categoryComparison: [],
      incomeCategoryComparison: [],
    };
  }

  const prevMonthDate = new Date(year, month0 - 1, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;

  const currentLabel = capitalizeFirst(new Date(year, month0, 1).toLocaleString(locale, { month: "long", year: "numeric" }));
  const previousLabel = capitalizeFirst(prevMonthDate.toLocaleString(locale, { month: "long", year: "numeric" }));

  let currentIncome = 0;
  let previousIncome = 0;
  let currentExpense = 0;
  let previousExpense = 0;

  const currentExpenseByCategory = new Map<string, number>();
  const previousExpenseByCategory = new Map<string, number>();
  const currentIncomeByCategory = new Map<string, number>();
  const previousIncomeByCategory = new Map<string, number>();

  for (const t of data.transactions ?? []) {
    if (t.date > today) continue;
    const ym = ymFromYmd(t.date);
    if (t.type === "income") {
      const category = normalizeCategoryInput(t.category) || "No category";
      if (ym === monthKey) {
        currentIncome += t.amount;
        currentIncomeByCategory.set(category, (currentIncomeByCategory.get(category) ?? 0) + t.amount);
      }
      if (ym === prevMonthKey) {
        previousIncome += t.amount;
        previousIncomeByCategory.set(category, (previousIncomeByCategory.get(category) ?? 0) + t.amount);
      }
    }
    if (t.type === "expense") {
      const category = normalizeCategoryInput(t.category) || "No category";
      if (ym === monthKey) {
        currentExpense += t.amount;
        currentExpenseByCategory.set(category, (currentExpenseByCategory.get(category) ?? 0) + t.amount);
      }
      if (ym === prevMonthKey) {
        previousExpense += t.amount;
        previousExpenseByCategory.set(category, (previousExpenseByCategory.get(category) ?? 0) + t.amount);
      }
    }
  }

  for (const s of data.salaryEvents ?? []) {
    if (s.date > today) continue;
    const category = normalizeCategoryInput(s.title) || "Salary";
    if (ymFromYmd(s.date) === monthKey) {
      currentIncome += s.amount;
      currentIncomeByCategory.set(category, (currentIncomeByCategory.get(category) ?? 0) + s.amount);
    }
    if (ymFromYmd(s.date) === prevMonthKey) {
      previousIncome += s.amount;
      previousIncomeByCategory.set(category, (previousIncomeByCategory.get(category) ?? 0) + s.amount);
    }
  }

  const expenseCategoryNames = new Set<string>(
    (data.settings?.txCategories ?? [])
      .map((c) => normalizeCategoryInput(c))
      .filter((c) => c.length > 0)
  );
  for (const category of currentExpenseByCategory.keys()) expenseCategoryNames.add(category);
  for (const category of previousExpenseByCategory.keys()) expenseCategoryNames.add(category);

  const categoryComparison = Array.from(expenseCategoryNames)
    .map((category) => {
      const current = currentExpenseByCategory.get(category) ?? 0;
      const previous = previousExpenseByCategory.get(category) ?? 0;
      return { category, current, previous, delta: current - previous };
    })
    .sort((a, b) => {
      if (Math.abs(b.delta) !== Math.abs(a.delta)) return Math.abs(b.delta) - Math.abs(a.delta);
      if (b.current !== a.current) return b.current - a.current;
      return a.category.localeCompare(b.category, locale);
    });

  const incomeCategoryNames = new Set<string>(
    (data.settings?.incomeCategories ?? [])
      .map((c) => normalizeCategoryInput(c))
      .filter((c) => c.length > 0)
  );
  for (const category of currentIncomeByCategory.keys()) incomeCategoryNames.add(category);
  for (const category of previousIncomeByCategory.keys()) incomeCategoryNames.add(category);

  const incomeCategoryComparison = Array.from(incomeCategoryNames)
    .map((category) => {
      const current = currentIncomeByCategory.get(category) ?? 0;
      const previous = previousIncomeByCategory.get(category) ?? 0;
      return { category, current, previous, delta: current - previous };
    })
    .sort((a, b) => {
      if (Math.abs(b.delta) !== Math.abs(a.delta)) return Math.abs(b.delta) - Math.abs(a.delta);
      if (b.current !== a.current) return b.current - a.current;
      return a.category.localeCompare(b.category, locale);
    });

  const currentMonthDays = daysInMonth(year, month0);
  const previousMonthDays = daysInMonth(prevMonthDate.getFullYear(), prevMonthDate.getMonth());

  return {
    currentLabel,
    previousLabel,
    currentIncome,
    previousIncome,
    currentExpense,
    previousExpense,
    currentAvgCheck: currentMonthDays > 0 ? Math.round(currentExpense / currentMonthDays) : 0,
    previousAvgCheck: previousMonthDays > 0 ? Math.round(previousExpense / previousMonthDays) : 0,
    categoryComparison,
    incomeCategoryComparison,
  };
}
