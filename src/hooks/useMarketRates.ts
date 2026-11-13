import { useEffect, useRef, useState } from "react";
import { impliedRubRateHistory } from "../lib/currencyBalance";
import type { Transaction } from "../lib/api";
import { fetchMarketSnapshots, readMarketSnapshots, transactionMarketPair } from "../lib/marketRates";

export function useMarketRates(transactions: Transaction[] | undefined, today: string) {
  const [snapshots, setSnapshots] = useState(readMarketSnapshots);
  const [error, setError] = useState("");
  const previous = useRef<Transaction[] | null>(null);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    if (!transactions) return;
    const old = previous.current ?? [];
    previous.current = transactions;
    const savedToday = new Set(readMarketSnapshots().filter((item) => {
      const [year, month, day] = today.split("-").map(Number);
      const date = new Date(item.fetchedAt);
      return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
    }).map((item) => item.pair));
    const existingIds = new Set(old.map((item) => item.id));
    const existingDays = new Set(old.flatMap((item) => {
      const pair = transactionMarketPair(item);
      return pair ? [`${item.date}:${pair}`] : [];
    }));
    const pairs = new Map<string, { key: string; source: string; target: string }>();
    for (const item of transactions) {
      const pair = transactionMarketPair(item);
      if (!pair || item.date !== today || existingIds.has(item.id) || existingDays.has(`${item.date}:${pair}`)) continue;
      const [source, target] = pair.split(":");
      const key = item.type === "currency_exchange" ? `exchange:${source}` : `purchase:${pair}`;
      if (!savedToday.has(key)) pairs.set(key, { key, source, target });
    }
    const oldImplied = impliedRubRateHistory(old, today);
    const newImplied = impliedRubRateHistory(transactions, today);
    for (const [pair, points] of Object.entries(newImplied)) {
      if (!points.some((point) => point.date === today) || oldImplied[pair]?.some((point) => point.date === today)) continue;
      const [source] = pair.split(":");
      const key = `implied:${pair}`;
      if (!savedToday.has(key)) pairs.set(key, { key, source, target: "RUB" });
    }
    if (!pairs.size) return;
    queue.current = queue.current.then(async () => {
      try { setSnapshots(await fetchMarketSnapshots([...pairs.values()])); setError(""); }
      catch (err) { setError(err instanceof Error ? err.message : "Could not load market rates."); }
    });
  }, [transactions, today]);
  return { snapshots, error };
}
