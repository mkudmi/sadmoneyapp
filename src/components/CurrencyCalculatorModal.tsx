import { useId, useState } from "react";
import type { Transaction } from "../lib/api";
import type { DateFormat } from "../lib/date";
import { formatDateForDisplay } from "../lib/date";
import { currencyConversionRate, recentCrossRates, recentCurrencyExchanges } from "../lib/currencyBalance";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { AppIcon } from "./AppIcon";
import { SelectInput } from "./SelectInput";

type Props = { transactions: Transaction[]; today: string; dateFormat: DateFormat; onClose: () => void };

export function CurrencyCalculatorModal({ transactions, today, dateFormat, onClose }: Props) {
  const ref = useDialogFocus(true, "#currency-calculator-amount");
  const titleId = useId();
  const exchangeCurrencies = Object.keys(recentCurrencyExchanges(transactions, today));
  const crossRates = recentCrossRates(transactions, today);
  const currencies = [...new Set(["RUB", ...exchangeCurrencies, ...crossRates.flatMap(({ source, target }) => [source, target])])].sort();
  const [from, setFrom] = useState("RUB");
  const [to, setTo] = useState(() => currencies.find((currency) => currency !== "RUB") ?? "RUB");
  const [amount, setAmount] = useState("1");
  const normalized = amount.trim().replace(/\s/g, "").replace(",", ".");
  const valid = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) && Number.isFinite(Number(normalized));
  const rate = currencyConversionRate(transactions, today, from, to);
  const result = valid && rate ? Number(normalized) * rate.rate : null;
  const format = (value: number, digits = 2) => value.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits === 2 ? 2 : 0 });
  return <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 5100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="modal-panel" style={{ width: "min(440px, 100%)", padding: 16, maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}><b id={titleId}>Currency calculator</b><button type="button" className="icon-button" aria-label="Close calculator" onClick={onClose}><AppIcon name="close" /></button></div>
      <p style={{ fontSize: 12, opacity: 0.75 }}>Estimated using your recorded exchanges and purchases, not live market rates.</p>
      <div style={{ display: "grid", gap: 12 }}>
        <label htmlFor="currency-calculator-amount" style={{ display: "grid", gap: 4, fontSize: 12 }}>Amount<input id="currency-calculator-amount" type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={amount !== "" && !valid} /></label>
        <SelectInput label="From" value={from} options={currencies} onChange={setFrom} />
        <SelectInput label="To" value={to} options={currencies} onChange={setTo} />
        <button type="button" onClick={() => { setFrom(to); setTo(from); }}><AppIcon name="currency" /> Swap currencies</button>
        <div className="panel-item" aria-live="polite" style={{ padding: "12px", overflowWrap: "anywhere" }}>
          {amount === "" ? "Enter an amount." : !valid ? "Enter a valid non-negative amount." : !rate ? "No recorded rate connects these currencies." : result !== null && Number.isFinite(result) ? <><div style={{ fontSize: 12, opacity: 0.7 }}>Estimated amount</div><b style={{ fontSize: 20 }}>≈ {format(result)} {to}</b><div style={{ fontSize: 12, opacity: 0.75, marginTop: 5 }}>1 {from} ≈ {format(rate.rate, 6)} {to}{from !== to && ` · Oldest rate: ${formatDateForDisplay(rate.date, dateFormat)}`}</div></> : "Amount is too large to calculate."}
        </div>
      </div>
    </div>
  </div>;
}
