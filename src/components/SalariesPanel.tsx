import { SalaryEvent } from "../lib/api";
import { formatDateForDisplay } from "../lib/date";
import type { DateFormat } from "../lib/date";
import { rub } from "../lib/money";
import { AppIcon } from "./AppIcon";

type SalariesPanelProps = {
  salaries: SalaryEvent[];
  dateFormat: DateFormat;
  isPickingSalaryDate: boolean;
  onCancelPickingSalary: () => void;
  onBeginAddSalary: () => void;
  onEditSalary: (salary: SalaryEvent) => void;
  onDeleteSalary: (id: string) => void;
};

export function SalariesPanel(props: SalariesPanelProps) {
  const {
    salaries,
    dateFormat,
    isPickingSalaryDate,
    onCancelPickingSalary,
    onBeginAddSalary,
    onEditSalary,
    onDeleteSalary,
  } = props;

  return (
    <div className="surface" style={{ minWidth: 0, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b>{"Salaries this month"}</b>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isPickingSalaryDate ? (
            <span style={{ fontSize: 12, opacity: 0.8 }}>{"Pick a date in the calendar"}</span>
          ) : null}
          {isPickingSalaryDate ? (
            <button onClick={onCancelPickingSalary}>{"Cancel"}</button>
          ) : null}
          <button
            onClick={onBeginAddSalary}
            title={"Add salary"}
            aria-label={"Add salary"}
            className="icon-button"
            style={{ minWidth: 24, minHeight: 24, padding: 0 }}
          >
            <AppIcon name="add" />
          </button>
        </div>
      </div>

      {salaries.length > 0 && (
        <div className="panel-list" style={{ marginTop: 8 }}>
          {salaries.map((s) => (
            <div
              className="panel-item"
              key={s.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                border: "1px solid #eee",
                borderRadius: 10,
                padding: "6px 8px",
              }}
            >
              <div>
                <div style={{ fontSize: 12 }}>
                  <b>{formatDateForDisplay(s.date, dateFormat)}</b> - {s.title} - {rub(s.amount)}
                </div>
              </div>

              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="edit-pencil-btn"
                  title={"Edit salary"}
                  aria-label={"Edit salary"}
                  style={{ width: 26, minWidth: 26, minHeight: 26, borderRadius: 8 }}
                  onClick={() => onEditSalary(s)}
                >
                  <AppIcon name="edit" />
                </button>

                <button
                  title={"Delete salary"}
                  aria-label={"Delete salary"}
                  className="icon-button"
                  style={{ color: "var(--danger)", minHeight: 26, padding: 0, width: 26, minWidth: 26 }}
                  onClick={() => onDeleteSalary(s.id)}
                >
                  <AppIcon name="delete" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
