import { DateInputWithCalendar } from "./DateInputWithCalendar";
import { dateFormatPattern } from "../lib/date";
import type { DateFormat } from "../lib/date";
import { AppIcon } from "./AppIcon";

type EditSalaryModalProps = {
  open: boolean;
  date: string;
  dateFormat: DateFormat;
  amount: string;
  title: string;
  onDateChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function EditSalaryModal(props: EditSalaryModalProps) {
  const {
    open,
    date,
    dateFormat,
    amount,
    title,
    onDateChange,
    onAmountChange,
    onTitleChange,
    onClose,
    onSubmit,
  } = props;

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
          <b style={{ fontSize: 14 }}>{"Edit salary"}</b>
          <button onClick={onClose} aria-label={"Close"} className="icon-button">
            <AppIcon name="close" />
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{`Date (${dateFormatPattern(dateFormat)})`}</div>
            <DateInputWithCalendar value={date} dateFormat={dateFormat} onChange={onDateChange} />
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Amount (RUB)"}</div>
            <input
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              placeholder={"80000"}
              inputMode="decimal"
              style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Title"}</div>
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder={"Salary"}
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
