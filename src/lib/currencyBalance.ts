import type { Transaction } from "./api";

export const POPULAR_CURRENCIES = ["USD", "EUR", "CNY", "GBP", "JPY", "CHF", "AED", "TRY", "THB", "ILS", "KZT", "GEL", "AMD"] as const;

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

export type CrossRate = { source: string; target: string; rate: number; date: string };

/** Rates are inferred from the most recent recorded expense for each currency pair. */
export function recentCrossRates(transactions: Transaction[], throughDate: string): CrossRate[] {
  const latest = new Map<string, CrossRate>();
  transactions.map((tx, index) => ({ tx, index }))
    .filter(({ tx }) => tx.type === "expense" && tx.date <= throughDate && tx.amount > 0 && tx.purchase_currency && (tx.purchase_amount ?? 0) > 0 && tx.purchase_currency !== (tx.currency ?? "RUB"))
    .sort((a, b) => b.tx.date.localeCompare(a.tx.date) || b.index - a.index)
    .forEach(({ tx }) => {
      const source = tx.currency ?? "RUB";
      const target = tx.purchase_currency!;
      const key = `${source}:${target}`;
      if (!latest.has(key)) latest.set(key, { source, target, rate: tx.purchase_amount! / tx.amount, date: tx.date });
    });
  return [...latest.values()].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
}

export function balanceCurrencyOptions(transactions: Transaction[], throughDate: string): string[] {
  const observed = transactions.filter((tx) => tx.date <= throughDate).flatMap((tx) => [tx.currency, tx.purchase_currency].filter((value): value is string => Boolean(value) && value !== "RUB"));
  return [...new Set([...POPULAR_CURRENCIES, ...observed])].sort();
}

export function defaultBalanceCurrencies(transactions: Transaction[], throughDate: string): string[] {
  const balances = currencyBalances(transactions, throughDate);
  const targets = recentCrossRates(transactions, throughDate).filter((rate) => balances[rate.source] !== undefined).map((rate) => rate.target);
  return [...new Set([...Object.keys(balances), ...targets])].filter((currency) => currency !== "RUB").sort();
}
