import { useEffect, useRef, useState } from "react";
import type { MarketPairRequest } from "../lib/marketRates";
import type { Transaction } from "../lib/api";
import { fetchMarketSnapshots, pendingMarketPairs, readMarketSnapshots } from "../lib/marketRates";

const RETRY_DELAY_MS = 5 * 60 * 1000;

export function useMarketRates(transactions: Transaction[] | undefined, today: string) {
  const [snapshots, setSnapshots] = useState(readMarketSnapshots);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    if (!transactions) return;
    const pairs = pendingMarketPairs(transactions, today, readMarketSnapshots());
    if (!pairs.length) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    queue.current = queue.current.then(async () => {
      if (cancelled) return;
      const pending = pendingMarketPairs(transactions, today, readMarketSnapshots());
      if (!pending.length) return;
      try {
        const updated = await fetchMarketSnapshots(pending);
        if (!cancelled) { setSnapshots(updated); setError(""); }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load market rates.");
          timer = setTimeout(() => setRetry((value) => value + 1), RETRY_DELAY_MS);
        }
      }
    });
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [transactions, today, retry]);
  function refresh(pair: MarketPairRequest) {
    setRefreshing(true);
    queue.current = queue.current.then(async () => {
      try { setSnapshots(await fetchMarketSnapshots([pair], true)); setError(""); }
      catch (err) { setError(err instanceof Error ? err.message : "Could not load market rates."); }
      finally { setRefreshing(false); }
    });
  }
  return { snapshots, error, refreshing, refresh };

}
