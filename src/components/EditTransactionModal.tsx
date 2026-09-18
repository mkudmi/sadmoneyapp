import { useId } from "react";
import { AutocompleteInput } from "./AutocompleteInput";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { DateInputWithCalendar } from "./DateInputWithCalendar";
import type { DateFormat } from "../lib/date";
import { AppIcon } from "./AppIcon";

type EditTransactionModalProps = {
  open: boolean;
  amount: string;
  category: string;
  note: string;
  date?: string;
  dateFormat?: DateFormat;
  showDateField?: boolean;
  categoryOptions: string[];
  showWasPlanned: boolean;
  wasPlanned: boolean;
  excludeFromStatistics: boolean;
  onExcludeFromStatisticsChange: (value: boolean) => void;
  onWasPlannedChange: (value: boolean) => void;
  onAmountChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onDateChange?: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function EditTransactionModal(props: EditTransactionModalProps) {
  const {
    open,
    amount,
    category,
    note,
    date = "",
    dateFormat = "dd-mm-yyyy",
    showDateField = false,
    categoryOptions,
    showWasPlanned,
    wasPlanned,
    excludeFromStatistics,
    onExcludeFromStatisticsChange,
    onWasPlannedChange,
    onAmountChange,
    onCategoryChange,
    onNoteChange,
    onDateChange,
    onClose,
    onSubmit,
  } = props;

  const dialogRef = useDialogFocus(open, "[data-edit-tx-amount]");
  const fieldId = useId();

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 5000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${fieldId}-title`}
        tabIndex={-1}
        className="modal-panel"
        style={{
          width: "min(520px, 100%)",
          padding: 12,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <b id={`${fieldId}-title`} style={{ fontSize: 14 }}>{"Edit transaction"}</b>
          <button type="button" onClick={onClose} aria-label={"Close"} className="icon-button">
            <AppIcon name="close" />
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          {showDateField && onDateChange ? (
            <div style={{ minWidth: 0 }}>
              <label htmlFor={`${fieldId}-date`} style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Date"}</label>
              <DateInputWithCalendar id={`${fieldId}-date`} value={date} dateFormat={dateFormat} onChange={onDateChange} />
            </div>
          ) : null}

          <div style={{ minWidth: 0 }}>
            <label htmlFor={`${fieldId}-amount`} style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Amount (RUB)"}</label>
            <input
              id={`${fieldId}-amount`}
              data-edit-tx-amount
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              placeholder={"1000"}
              inputMode="decimal"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>

          <AutocompleteInput id={`${fieldId}-category`} label="Category" value={category} options={categoryOptions}
            onChange={onCategoryChange} placeholder="e.g. Groceries" onSubmit={onSubmit} />

          {showWasPlanned ? (
            <div className="transaction-options">
              <label className="transaction-option">
                <span className="transaction-option-copy">
                  <span className="transaction-option-title">Was planned</span>
                  <span id={`${fieldId}-was-planned-help`} className="transaction-option-help">
                    Does not use the daily spend limit.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={wasPlanned}
                  onChange={(e) => onWasPlannedChange(e.target.checked)}
                  aria-label="Was planned"
                  aria-describedby={`${fieldId}-was-planned-help`}
                />
              </label>
              <label className="transaction-option">
                <span className="transaction-option-copy">
                  <span className="transaction-option-title">Exclude from statistics</span>
                  <span id={`${fieldId}-statistics-help`} className="transaction-option-help">
                    Hidden from reports; still affects the balance.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={excludeFromStatistics}
                  onChange={(e) => onExcludeFromStatisticsChange(e.target.checked)}
                  aria-label="Exclude from statistics"
                  aria-describedby={`${fieldId}-statistics-help`}
                />
              </label>
            </div>
          ) : null}

          <div style={{ minWidth: 0 }}>
            <label htmlFor={`${fieldId}-note`} style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Comment"}</label>
            <input
              id={`${fieldId}-note`}
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder={"Optional"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={onClose}>{"Cancel"}</button>
          <button type="button" onClick={onSubmit}>{"Save"}</button>
        </div>
      </div>
    </div>
  );
}
