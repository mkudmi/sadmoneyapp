import { useState } from "react";
import { RecurringPayment, Transaction } from "../lib/api";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { AppIcon } from "./AppIcon";
import { DateInputWithCalendar } from "./DateInputWithCalendar";
import type { DateFormat } from "../lib/date";
import { suggestRecurringPayments } from "../lib/recurringSuggestions";
import { toKop, rub } from "../lib/money";

type Props = {
  payments: RecurringPayment[];
  transactions: Transaction[];
  today: string;
  dateFormat: DateFormat;
  onSave: (payment: RecurringPayment) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
};

export function RecurringPaymentsModal({ payments, transactions, today, dateFormat, onSave, onDelete, onClose }: Props) {
  const dialogRef = useDialogFocus(true, "#recurring-payment-title");
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [frequency, setFrequency] = useState<RecurringPayment["frequency"]>("monthly");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function reset() { setId(""); setTitle(""); setAmount(""); setStartDate(today); setFrequency("monthly"); setError(""); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = toKop(amount);
    if (!title.trim() || !startDate || !Number.isSafeInteger(value) || value <= 0) { setError("Enter a title, date and positive amount."); return; }
    setBusy(true); setError("");
    try { await onSave({ id, title: title.trim(), amount: value, startDate, frequency }); reset(); }
    catch { setError("Could not save the payment. Check the values and try again."); }
    finally { setBusy(false); }
  }
  const suggestions = suggestRecurringPayments(transactions, payments, today);
  return <div className="modal-backdrop recurring-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={dialogRef} tabIndex={-1} className="modal-panel recurring-modal" role="dialog" aria-modal="true" aria-labelledby="recurring-title" onKeyDown={e => { if (e.key === "Escape") onClose(); }}>
      <div className="vacation-form-modal-head"><div><b id="recurring-title" className="vacation-form-modal-title">Recurring payments</b><div className="vacation-form-modal-subtitle">Plan regular bills and subscriptions.</div></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close recurring payments"><AppIcon name="close" /></button></div>
      <p className="recurring-help">Confirm each payment when paid. Monthly payments on the 29th–31st fall on the last day of shorter months.</p>
      {suggestions.length > 0 && <section className="recurring-section" aria-labelledby="suggestions-title">
        <h3 id="suggestions-title">Suggested from your history</h3>
        <p>Same category, amount and day of the month in at least three different months.</p>
        <ul className="recurring-list">{suggestions.map(suggestion => <li className="recurring-row" key={suggestion.title}><span>
          {suggestion.title} · {rub(suggestion.amount)} · day {suggestion.day} · {suggestion.count} occurrences</span> {" "}
          <button type="button" onClick={() => { setId(""); setTitle(suggestion.title); setAmount(String(suggestion.amount / 100)); setStartDate(suggestion.startDate); setFrequency("monthly"); setError(""); }}>Review suggestion</button>
        </li>)}</ul>
      </section>}
      <ul className="recurring-list">
        {payments.map(payment => <li className="recurring-row" key={payment.id}>
          <span>{payment.title} · {rub(payment.amount)} · {payment.frequency} · {payment.startDate}</span>{" "}
          <button type="button" onClick={() => { setId(payment.id); setTitle(payment.title); setAmount(String(payment.amount / 100)); setStartDate(payment.startDate); setFrequency(payment.frequency); setError(""); }}>Edit</button>{" "}
          <button type="button" disabled={busy} onClick={async () => { if (!window.confirm(`Delete recurring payment “${payment.title}”? Paid transactions remain.`)) return; setBusy(true); try { await onDelete(payment.id); if (id === payment.id) reset(); } catch { setError("Could not delete the payment."); } finally { setBusy(false); } }}>Delete</button>
        </li>)}
      </ul>
      <form onSubmit={submit} className="recurring-form">
        <b>{id ? "Edit payment" : "Add payment"}</b>
        <div className="recurring-fields">
          <label>Title<input id="recurring-payment-title" maxLength={120} required value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label>Amount (RUB)<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label>First payment<DateInputWithCalendar value={startDate} dateFormat={dateFormat} onChange={setStartDate} /></label>
          <label>Repeat<select value={frequency} onChange={e => setFrequency(e.target.value as RecurringPayment["frequency"])}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
        </div>
        {error && <div role="alert">{error}</div>}
        <div className="vacation-form-footer"><button disabled={busy} type="submit">{id ? "Save changes" : "Add payment"}</button>{id && <button type="button" onClick={reset}>Cancel editing</button>}</div>
      </form>
    </div>
  </div>;
}
