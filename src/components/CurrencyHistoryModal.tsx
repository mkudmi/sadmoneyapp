import { useId } from "react";
import type { Transaction } from "../lib/api";
import type { DateFormat } from "../lib/date";
import { formatDateForDisplay } from "../lib/date";
import { currencyBalances, exchangeRate, recentCrossRates, recentCurrencyExchanges } from "../lib/currencyBalance";
import { rub } from "../lib/money";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { AppIcon } from "./AppIcon";
import { CurrencyRateChart } from "./CurrencyRateChart";

type Props = { open: boolean; transactions: Transaction[]; today: string; dateFormat: DateFormat; onClose: () => void };

export function CurrencyHistoryModal({ open, transactions, today, dateFormat, onClose }: Props) {
  const dialogRef = useDialogFocus(open);
  const titleId = useId();
  if (!open) return null;
  const groups = recentCurrencyExchanges(transactions);
  const currencies = Object.keys(groups).sort();
  const crossRates = recentCrossRates(transactions, today);
  const balances = currencyBalances(transactions, today);
  return <div className="modal-backdrop"
    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 5000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
      className="modal-panel" style={{ width: "min(520px, 100%)", padding: 16, maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <b id={titleId}>Currency</b>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><AppIcon name="close" /></button>
      </div>
      <CurrencyRateChart transactions={transactions} today={today} dateFormat={dateFormat} />
      {crossRates.length > 0 ? <section style={{ marginTop: 16 }}>
        <b>Cross rates from purchases</b>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Estimated from your most recent purchase for each currency pair.</div>
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {crossRates.map(({ source, target, rate, date }) => <div key={`${source}:${target}`} className="panel-item" style={{ padding: "8px 10px" }}>
            <b>1 {source} ≈ {rate.toLocaleString("en-US", { maximumFractionDigits: 6 })} {target}</b>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>Last purchase: {formatDateForDisplay(date, dateFormat)}</div>
            {balances[source] !== undefined ? <div style={{ fontSize: 12, marginTop: 4 }}>Balance estimate: ≈ {(balances[source] / 100 * rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {target}</div> : null}
          </div>)}
        </div>
      </section> : null}
      {currencies.length === 0 ? <p>No currency exchanges yet.</p> : currencies.map((currency) => <section key={currency} style={{ marginTop: 16 }}>
        <b>{currency}</b>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Last rate: {exchangeRate(groups[currency][0])}</div>
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {groups[currency].map((tx) => <div key={tx.id} className="panel-item" style={{ padding: "8px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span>{formatDateForDisplay(tx.date, dateFormat)}</span><b>{exchangeRate(tx)}</b>
            </div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{rub(tx.amount)} → {((tx.foreign_amount ?? 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} {currency}</div>
          </div>)}
        </div>
      </section>)}
    </div>
  </div>;
}
