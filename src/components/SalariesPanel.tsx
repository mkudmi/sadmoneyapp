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
    <div style={{ flex: "1 1 460px", minWidth: 380, padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
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
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {salaries.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                border: "1px solid #eee",
                borderRadius: 8,
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
                  title={"Edit salary"}
                  aria-label={"Edit salary"}
                  style={{ color: "#444", fontWeight: 700 }}
                  onClick={() => onEditSalary(s)}
                >
                  {"Edit"}
                </button>

                <button
                  title={"Delete salary"}
                  aria-label={"Delete salary"}
                  style={{ color: "#c51616", fontWeight: 700 }}
                  onClick={() => onDeleteSalary(s.id)}
                >
                  {"Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
