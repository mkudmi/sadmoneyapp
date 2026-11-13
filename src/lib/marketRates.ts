import { ymd } from "./date";
import type { Transaction } from "./api";

const STORAGE_KEY = "sadmoneyapp.market-rates.v2";
const CACHE_KEY = "sadmoneyapp.market-rate-cache.v1";
const API_URL = "https://www.live-rates.com/rates";
export type MarketQuote = { source: string; target: string; rate: number; timestamp: number };
export type MarketSnapshot = { fetchedAt: number; quotes: MarketQuote[]; pair: string };
export type MarketPoint = { date: string; rate: number; timestamp: number };

export function parseMarketQuotes(input: unknown): MarketQuote[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const pair = typeof value.currency === "string" ? /^([A-Z]{3})\/([A-Z]{3})$/.exec(value.currency) : null;
    const bid = Number(value.bid), ask = Number(value.ask), timestamp = Number(value.timestamp);
    if (!pair || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid || !Number.isFinite(timestamp) || timestamp < 1_000_000_000_000 || timestamp > Date.now() + 300_000) return [];
    return [{ source: pair[1], target: pair[2], rate: (bid + ask) / 2, timestamp }];
  });
}

export function marketRateForPair(snapshot: MarketSnapshot, source: string, target: string): MarketPoint | null {
  const edges = snapshot.quotes.flatMap((quote) => [quote, { ...quote, source: quote.target, target: quote.source, rate: 1 / quote.rate }]).sort((a, b) => b.timestamp - a.timestamp);
  const queue = [{ currency: source, rate: 1, timestamp: snapshot.fetchedAt }];
  const visited = new Set([source]);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const edge of edges) {
      if (edge.source !== current.currency || visited.has(edge.target)) continue;
      const next = { currency: edge.target, rate: current.rate * edge.rate, timestamp: Math.min(current.timestamp, edge.timestamp) };
      if (edge.target === target) return { date: ymd(new Date(next.timestamp)), rate: next.rate, timestamp: next.timestamp };
      visited.add(edge.target);
      queue.push(next);
    }
  }
  return null;
}

export function readMarketSnapshots(): MarketSnapshot[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is MarketSnapshot => item && typeof item.pair === "string" && /^(?:exchange:[A-Z]{3}|purchase:[A-Z]{3}:[A-Z]{3}|implied:[A-Z]{3}:[A-Z]{3})$/.test(item.pair) && typeof item.fetchedAt === "number" && Number.isFinite(item.fetchedAt) && Array.isArray(item.quotes) && item.quotes.every((quote: MarketQuote) => quote && /^[A-Z]{3}$/.test(quote.source) && /^[A-Z]{3}$/.test(quote.target) && Number.isFinite(quote.rate) && quote.rate > 0 && Number.isFinite(quote.timestamp))).slice(-1000);
  } catch { return []; }
}

export function transactionMarketPair(tx: Transaction): string | null {
  if (tx.type === "currency_exchange" && tx.currency && tx.currency !== "RUB" && tx.amount > 0 && (tx.foreign_amount ?? 0) > 0) return `${tx.currency}:RUB`;
  if (tx.type === "expense" && tx.purchase_currency && tx.purchase_currency !== (tx.currency ?? "RUB") && tx.amount > 0 && (tx.purchase_amount ?? 0) > 0) return `${tx.currency ?? "RUB"}:${tx.purchase_currency}`;
  return null;
}

export async function fetchMarketSnapshots(pairs: { key: string; source: string; target: string }[]): Promise<MarketSnapshot[]> {
  const now = Date.now();
  let cached: { fetchedAt: number; quotes: MarketQuote[] } | null = null;
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (value && typeof value.fetchedAt === "number" && Number.isFinite(value.fetchedAt) && value.fetchedAt <= now && ymd(new Date(value.fetchedAt)) === ymd(new Date(now)) && Array.isArray(value.quotes) && value.quotes.length > 0 && value.quotes.every((quote: MarketQuote) => quote && /^[A-Z]{3}$/.test(quote.source) && /^[A-Z]{3}$/.test(quote.target) && Number.isFinite(quote.rate) && quote.rate > 0 && Number.isFinite(quote.timestamp))) cached = value;
  } catch { /* Ignore an invalid cache and request fresh data. */ }
  if (!cached) {
    const response = await fetch(API_URL, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(response.status === 503 || response.status === 429 ? "Market rate limit reached; the next new operation may retry." : "Could not load market rates.");
    const payload: unknown = await response.json();
    if (Array.isArray(payload) && payload.some((item) => item && typeof item.error === "string" && /limit/i.test(item.error))) {
      throw new Error("Market rate limit reached (3 requests per hour). Try again later.");
    }
    const quotes = parseMarketQuotes(payload);
    if (!quotes.length) throw new Error("No valid market rates were returned.");
    cached = { fetchedAt: Date.now(), quotes };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  }
  const { fetchedAt, quotes } = cached;
  const snapshots = pairs.flatMap(({ key, source, target }) => {
    const point = marketRateForPair({ fetchedAt, quotes, pair: key }, source, target);
    return point ? [{ fetchedAt, pair: key, quotes: [{ source, target, rate: point.rate, timestamp: point.timestamp }] }] : [];
  });
  if (!snapshots.length) throw new Error("No market rates available for these currencies.");
  const updated = [...readMarketSnapshots(), ...snapshots].slice(-1000);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}
