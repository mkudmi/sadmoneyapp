import type { AppData, SalaryEvent, SavingsGoal } from "./api";

export type SavingsPlan = { maxCardAmount: number };

export function buildSavingsPlan(data: AppData, salaryEvents: SalaryEvent[], today: string): SavingsPlan {
  const [year, month] = today.slice(0, 7).split("-").map(Number);
  const months = Array.from({ length: 3 }, (_, index) => {
    const date = new Date(year, month - 2 - index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
  const latestConfig = [...(data.settings.salaryConfigs ?? [])]
    .filter((config) => config.effectiveFrom <= today && config.amount > 0)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const monthlyIncomes = months.map((monthKey) => {
    const salaries = salaryEvents.filter((event) => event.date.startsWith(monthKey));
    const manual = salaries.filter((event) => !event.generated).reduce((sum, event) => sum + event.amount, 0);
    const generated = salaries.filter((event) => event.generated).reduce((sum, event) => sum + event.amount, 0);
    const recorded = data.transactions.filter((tx) => tx.type === "income" && tx.date.startsWith(monthKey))
      .reduce((sum, tx) => sum + tx.amount, 0);
    return Math.max(manual, generated, recorded);
  }).filter((value) => value > 0);
  const income = latestConfig?.amount ?? (monthlyIncomes.length ? Math.min(...monthlyIncomes) : 0);
  const maxCardAmount = income > 0
    ? Math.min(500_000, Math.max(100_000, Math.floor(income * 0.03 / 10_000) * 10_000))
    : 100_000;
  return { maxCardAmount };
}

function utcDay(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function estimateSavingsDays(goal: SavingsGoal, balance: number, today: string): number | null {
  const observedDays = utcDay(today) - utcDay(goal.createdAt) + 1;
  if (!Number.isFinite(observedDays) || observedDays < 2) return null;
  const windowDays = Math.min(30, observedDays);
  const recent = goal.cards.filter((card) => card.completed && card.completedAt
    && utcDay(card.completedAt) > utcDay(today) - windowDays
    && utcDay(card.completedAt) <= utcDay(today));
  if (new Set(recent.map((card) => card.completedAt)).size < 2) return null;
  const recentAmount = recent.reduce((sum, card) => sum + card.amount, 0);
  if (recentAmount <= 0) return null;
  return Math.ceil(Math.max(0, goal.targetAmount - balance) * windowDays / recentAmount);
}
