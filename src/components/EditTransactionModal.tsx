import { useState } from "react";
import { useDismissible } from "../hooks/useDismissible";
import { DateInputWithCalendar } from "./DateInputWithCalendar";
import type { DateFormat } from "../lib/date";

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

  useDismissible(categoryMenuOpen, () => setCategoryMenuOpen(false), "[data-edit-tx-category]");

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
        className="modal-panel"
        style={{
          width: "min(520px, 100%)",
          padding: 12,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <b style={{ fontSize: 14 }}>{"Edit transaction"}</b>
          <button onClick={onClose} aria-label={"Close"}>x</button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          {showDateField && onDateChange ? (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Date"}</div>
              <DateInputWithCalendar value={date} dateFormat={dateFormat} onChange={onDateChange} />
            </div>
          ) : null}

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Amount (RUB)"}</div>
            <input
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              placeholder={"1000"}
              inputMode="decimal"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSubmit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
              }}
              style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ minWidth: 0 }} data-edit-tx-category="true">
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Category"}</div>
            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={category}
                  onChange={(e) => onCategoryChange(e.target.value)}
                  onFocus={() => setCategoryMenuOpen(true)}
                  placeholder={"e.g. Groceries"}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onSubmit();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      onClose();
                    }
                  }}
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
                <button
                  type="button"
                  onClick={() => setCategoryMenuOpen((v) => !v)}
                  aria-label={"Show category list"}
                >v</button>
              </div>

              {categoryMenuOpen && categoryOptions.length > 0 ? (
                <div
                  className="menu-pop"
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
                        setCategoryMenuOpen(false);
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
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Comment"}</div>
            <input
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder={"Optional"}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSubmit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
              }}
              style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button onClick={onClose}>{"Cancel"}</button>
          <button onClick={onSubmit}>{"Save"}</button>
        </div>
      </div>
    </div>
  );
}
