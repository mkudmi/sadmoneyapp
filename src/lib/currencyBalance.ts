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

export type ExchangeRatePoint = { id: string; date: string; rate: number };

/** Actual RUB exchange rates in saved chronological order. */
export function exchangeRateHistory(transactions: Transaction[], throughDate: string): Record<string, ExchangeRatePoint[]> {
  const groups: Record<string, ExchangeRatePoint[]> = {};
  transactions.map((tx, index) => ({ tx, index }))
    .filter(({ tx }) => tx.type === "currency_exchange" && tx.currency && tx.currency !== "RUB" && tx.date <= throughDate && tx.amount > 0 && (tx.foreign_amount ?? 0) > 0)
    .sort((a, b) => a.tx.date.localeCompare(b.tx.date) || a.index - b.index)
    .forEach(({ tx }) => {
      (groups[tx.currency!] ??= []).push({ id: tx.id, date: tx.date, rate: tx.amount / tx.foreign_amount! });
    });
  return groups;
}

/** Rates observed in purchases, in the direction paid currency → purchase currency. */
export function crossRateHistory(transactions: Transaction[], throughDate: string): Record<string, ExchangeRatePoint[]> {
  const groups: Record<string, ExchangeRatePoint[]> = {};
  transactions.map((tx, index) => ({ tx, index }))
    .filter(({ tx }) => tx.type === "expense" && tx.date <= throughDate && tx.amount > 0 && tx.purchase_currency && (tx.purchase_amount ?? 0) > 0 && tx.purchase_currency !== (tx.currency ?? "RUB"))
    .sort((a, b) => a.tx.date.localeCompare(b.tx.date) || a.index - b.index)
    .forEach(({ tx }) => {
      const key = `${tx.currency ?? "RUB"}:${tx.purchase_currency}`;
      (groups[key] ??= []).push({ id: tx.id, date: tx.date, rate: tx.purchase_amount! / tx.amount });
    });
  return groups;
}

/** Implied RUB rates using the latest recorded direct exchange and purchase for each pair. */
export function impliedRubRateHistory(transactions: Transaction[], throughDate: string): Record<string, ExchangeRatePoint[]> {
  const history: Record<string, ExchangeRatePoint[]> = {};
  const direct = new Map<string, number>();
  const pairs = new Map<string, { source: string; target: string; rate: number }>();
  const events = transactions.map((tx, index) => ({ tx, index }))
    .filter(({ tx }) => tx.date <= throughDate)
    .sort((a, b) => a.tx.date.localeCompare(b.tx.date) || a.index - b.index);
  for (const { tx } of events) {
    let changedSource: string;
    let changedTarget: string | undefined;
    if (tx.type === "currency_exchange" && tx.currency && tx.currency !== "RUB" && tx.amount > 0 && (tx.foreign_amount ?? 0) > 0) {
      changedSource = tx.currency;
      direct.set(changedSource, tx.amount / tx.foreign_amount!);
    } else if (tx.type === "expense" && tx.currency && tx.currency !== "RUB" && tx.purchase_currency && tx.purchase_currency !== "RUB" && tx.purchase_currency !== tx.currency && tx.amount > 0 && (tx.purchase_amount ?? 0) > 0) {
      changedSource = tx.currency;
      changedTarget = tx.purchase_currency;
      pairs.set(`${changedSource}:${changedTarget}`, { source: changedSource, target: changedTarget, rate: tx.purchase_amount! / tx.amount });
    } else continue;
    for (const pair of pairs.values()) {
      if (pair.source !== changedSource || (changedTarget && pair.target !== changedTarget)) continue;
      const rubRate = direct.get(pair.source);
      if (rubRate === undefined) continue;
      const key = `${pair.target}:${pair.source}`;
      (history[key] ??= []).push({ id: `${tx.id}:${key}`, date: tx.date, rate: rubRate / pair.rate });
    }
  }
  return history;
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

/** Most recent recorded rates reachable from RUB, with direct conversions preferred. */
export function rubCurrencyRates(transactions: Transaction[], throughDate: string): CrossRate[] {
  const exchanges = Object.entries(recentCurrencyExchanges(transactions, throughDate)).flatMap(([currency, items]) => {
    const tx = items[0];
    return tx.amount > 0 && tx.foreign_amount ? [{ source: "RUB", target: currency, rate: tx.foreign_amount / tx.amount, date: tx.date }] : [];
  });
  const edges = [...exchanges, ...recentCrossRates(transactions, throughDate)]
    .flatMap((rate) => [rate, { source: rate.target, target: rate.source, rate: 1 / rate.rate, date: rate.date }])
    .sort((a, b) => b.date.localeCompare(a.date));
  const found = new Map<string, CrossRate>([["RUB", { source: "RUB", target: "RUB", rate: 1, date: throughDate }]]);
  const queue = ["RUB"];
  for (let index = 0; index < queue.length; index++) {
    const source = queue[index];
    const base = found.get(source)!;
    for (const edge of edges) {
      if (edge.source !== source || found.has(edge.target)) continue;
      found.set(edge.target, { source: "RUB", target: edge.target, rate: base.rate * edge.rate, date: base.date < edge.date ? base.date : edge.date });
      queue.push(edge.target);
    }
  }
  return [...found.values()].filter((rate) => rate.target !== "RUB").sort((a, b) => a.target.localeCompare(b.target));
}

/** Find a recorded conversion path, preferring the fewest currency pairs. */
export function currencyConversionRate(transactions: Transaction[], throughDate: string, source: string, target: string): CrossRate | null {
  if (source === target) return { source, target, rate: 1, date: throughDate };
  const exchanges = Object.entries(recentCurrencyExchanges(transactions, throughDate)).flatMap(([currency, items]) => {
    const tx = items[0];
    return currency !== "RUB" && tx.amount > 0 && tx.foreign_amount ? [{ source: "RUB", target: currency, rate: tx.foreign_amount / tx.amount, date: tx.date }] : [];
  });
  const edges = [...exchanges, ...recentCrossRates(transactions, throughDate)]
    .flatMap((item) => [item, { source: item.target, target: item.source, rate: 1 / item.rate, date: item.date }])
    .sort((a, b) => b.date.localeCompare(a.date));
  const queue: CrossRate[] = [{ source, target: source, rate: 1, date: throughDate }];
  const visited = new Set([source]);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const edge of edges) {
      if (edge.source !== current.target || visited.has(edge.target)) continue;
      const next = { source, target: edge.target, rate: current.rate * edge.rate, date: current.date < edge.date ? current.date : edge.date };
      if (edge.target === target) return next;
      visited.add(edge.target);
      queue.push(next);
    }
  }
  return null;
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
