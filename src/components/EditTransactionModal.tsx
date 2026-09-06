import { useEffect, useId, useRef, useState } from "react";
import { useDismissible } from "../hooks/useDismissible";
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
    onAmountChange,
    onCategoryChange,
    onNoteChange,
    onDateChange,
    onClose,
    onSubmit,
  } = props;

  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const dialogRef = useDialogFocus(open, "[data-edit-tx-amount]");
  const categoryInputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  useDismissible(open && categoryMenuOpen, () => setCategoryMenuOpen(false), "[data-edit-tx-category]");

  useEffect(() => {
    if (!open) setCategoryMenuOpen(false);
  }, [open]);

  function closeCategoryMenu() {
    categoryInputRef.current?.focus();
    setCategoryMenuOpen(false);
  }

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

          <div
            style={{ minWidth: 0 }}
            data-edit-tx-category="true"
            onBlur={(e) => {
              if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setCategoryMenuOpen(false);
            }}
            onKeyDown={(e) => {
              if (categoryMenuOpen && e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeCategoryMenu();
              }
            }}
          >
            <label htmlFor={`${fieldId}-category`} style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Category"}</label>
            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  ref={categoryInputRef}
                  id={`${fieldId}-category`}
                  value={category}
                  onChange={(e) => onCategoryChange(e.target.value)}
                  onFocus={() => setCategoryMenuOpen(true)}
                  placeholder={"e.g. Groceries"}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      onSubmit();
                    }
                  }}
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setCategoryMenuOpen((v) => !v)}
                  aria-label={"Show category list"}
                  aria-expanded={categoryMenuOpen && categoryOptions.length > 0}
                  className="icon-button"
                  style={{ minWidth: 34, padding: 0 }}
                >
                  <AppIcon name="chevronDown" />
                </button>
              </div>

              {categoryMenuOpen && categoryOptions.length > 0 ? (
                <div
                  className="menu-pop"
                  // Keep WebKit from closing the menu on blur before the option click.
                  onMouseDown={(event) => event.preventDefault()}
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    zIndex: 20,
                    maxHeight: 180,
                    overflowY: "auto",
                    padding: 4,
                    boxSizing: "border-box",
                  }}
                >
                  {categoryOptions.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        onCategoryChange(c);
                        closeCategoryMenu();
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 8px",
                        border: "none",
                        borderRadius: 6,
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

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
