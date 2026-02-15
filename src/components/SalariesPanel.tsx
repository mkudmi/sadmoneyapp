import { SalaryEvent } from "../lib/api";
import { rub } from "../lib/money";

type SalariesPanelProps = {
  salaries: SalaryEvent[];
  isPickingSalaryDate: boolean;
  onCancelPickingSalary: () => void;
  onBeginAddSalary: () => void;
  onEditSalary: (salary: SalaryEvent) => void;
  onDeleteSalary: (id: string) => void;
};

export function SalariesPanel(props: SalariesPanelProps) {
  const {
    salaries,
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
            style={{ minWidth: 28, fontWeight: 700 }}
          >
            +
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
                  <b>{s.date}</b> - {s.title} - {rub(s.amount)}
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
                  <span aria-hidden="true">✎</span>
                </button>

                <button
                  title={"Delete salary"}
                  aria-label={"Delete salary"}
                  style={{ color: "var(--danger)", fontWeight: 700, minHeight: 26, padding: "0 8px", fontSize: 12 }}
                  onClick={() => onDeleteSalary(s.id)}
                >
                  {"x"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
