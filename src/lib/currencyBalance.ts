import type { Transaction } from "./api";

export const POPULAR_CURRENCIES = ["USD", "EUR", "CNY", "GBP", "JPY", "CHF", "AED", "TRY", "THB", "KZT", "GEL", "AMD"] as const;

export function currencyBalances(transactions: Transaction[], throughDate: string): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const tx of transactions) {
    if (!tx.currency || tx.date > throughDate) continue;
    if (tx.type === "currency_exchange") balances[tx.currency] = (balances[tx.currency] ?? 0) + (tx.foreign_amount ?? 0);
    if (tx.type === "income") balances[tx.currency] = (balances[tx.currency] ?? 0) + tx.amount;
    if (tx.type === "expense") balances[tx.currency] = (balances[tx.currency] ?? 0) - tx.amount;
  }
  return balances;
}

/** Newest first; entries on the same date follow their saved order. */
export function recentCurrencyExchanges(transactions: Transaction[], throughDate?: string): Record<string, Transaction[]> {
  const groups: Record<string, Transaction[]> = {};
  transactions.map((tx, index) => ({ tx, index }))
    .filter(({ tx }) => tx.type === "currency_exchange" && tx.currency && (tx.foreign_amount ?? 0) > 0 && (!throughDate || tx.date <= throughDate))
    .sort((a, b) => b.tx.date.localeCompare(a.tx.date) || b.index - a.index)
    .forEach(({ tx }) => {
      const group = groups[tx.currency!] ??= [];
      if (group.length < 5) group.push(tx);
    });
  return groups;
}

export function exchangeRate(tx: Transaction): string {
  if (!tx.currency || !tx.foreign_amount || tx.foreign_amount <= 0) return "";
  const rate = (tx.amount / tx.foreign_amount).toLocaleString("en-US", { maximumFractionDigits: 6 });
  return `1 ${tx.currency} = ${rate} RUB`;
}
