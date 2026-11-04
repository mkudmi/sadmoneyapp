import { useId } from "react";
import type { Transaction } from "../lib/api";
import type { DateFormat } from "../lib/date";
import { formatDateForDisplay } from "../lib/date";
import { currencyBalances, rubCurrencyRates } from "../lib/currencyBalance";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { AppIcon } from "./AppIcon";

type Props = {
  transactions: Transaction[];
  today: string;
  budgetDate: string;
  dateFormat: DateFormat;
  available: number | null;
  dailyLimit: number | null;
  onClose: () => void;
};

export function CurrencyBudgetModal({ transactions, today, budgetDate, dateFormat, available, dailyLimit, onClose }: Props) {
  const dialogRef = useDialogFocus(true);
  const titleId = useId();
  const rates = rubCurrencyRates(transactions, today);
  const balances = currencyBalances(transactions, today);
  const format = (amount: number) => amount.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="modal-panel" style={{ width: "min(460px, 100%)", padding: 16, maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <b id={titleId}>Budget in currencies</b>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><AppIcon name="close" /></button>
      </div>
      <p style={{ fontSize: 12, opacity: 0.75 }}>Ruble budget for {formatDateForDisplay(budgetDate, dateFormat)}, estimated using your recorded exchange and purchase rates. Foreign balances are shown separately as of {formatDateForDisplay(today, dateFormat)}.</p>
      {rates.length === 0 ? <p>No recorded rates connected to RUB yet.</p> : <div style={{ display: "grid", gap: 8 }}>
        {rates.map(({ target, rate, date }) => <section key={target} className="panel-item" style={{ padding: "10px 12px" }}>
          <b>{target}</b>
          <div><b>Available:</b> {available === null ? "—" : `≈ ${format(available / 100 * rate)} ${target}`}</div>
          <div><b>Daily spend limit:</b> {dailyLimit === null ? "—" : `≈ ${format(dailyLimit / 100 * rate)} ${target}`}</div>
          {balances[target] !== undefined && <div>Currency balance: {format(balances[target] / 100)} {target}</div>}
          <div style={{ fontSize: 12, opacity: 0.7 }}>Rate based on records through {formatDateForDisplay(date, dateFormat)}</div>
        </section>)}
      </div>}
    </div>
  </div>;
}
