import type { RecurringPayment, Transaction } from "./api";
import { isValidYmd, parseYmdLocal, ymd } from "./date";

export type RecurringSuggestion = { title: string; amount: number; day: number; count: number; startDate: string };

export function suggestRecurringPayments(transactions: Transaction[], payments: RecurringPayment[], today: string): RecurringSuggestion[] {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.type !== "expense" || tx.currency || tx.purchase_currency || tx.id.startsWith("recurring_") || tx.date > today || !isValidYmd(tx.date) || !tx.category.trim()) continue;
    const key = tx.category.trim().toLocaleLowerCase();
    const group = groups.get(key) ?? [];
    group.push(tx); groups.set(key, group);
  }
  const result: RecurringSuggestion[] = [];
  for (const [key, group] of groups) {
    if (payments.some(p => p.title.trim().toLocaleLowerCase() === key)) continue;
    const first = group[0];
    const day = Number(first.date.slice(8));
    const months = new Set(group.map(tx => tx.date.slice(0, 7)));
    if (months.size < 3 || months.size !== group.length || first.amount <= 0 || group.some(tx => tx.amount !== first.amount || Number(tx.date.slice(8)) !== day)) continue;
    const now = parseYmdLocal(today);
    const year = now.getFullYear();
    let month = now.getMonth();
    let candidate = new Date(year, month, day);
    while (candidate.getMonth() !== ((month % 12) + 12) % 12 || ymd(candidate) <= today) {
      month++;
      candidate = new Date(year, month, day);
    }
    result.push({ title: first.category.trim(), amount: first.amount, day, count: group.length, startDate: ymd(candidate) });
  }
  return result.sort((a, b) => a.title.localeCompare(b.title));
}
