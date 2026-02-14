import { Vacation } from "../lib/api";
import { rub } from "../lib/money";
import { inclusiveDays } from "../lib/date";
import { normalizeVacationType, VacationType, vacationTypeLabel } from "../lib/vacation";

type VacationsPanelProps = {
  vacations: Vacation[];
  avgDailyEarnings: number;
  isPickingVacationStart: boolean;
  isPickingVacationEnd: boolean;
  vacationTypeMenuOpen: boolean;
  onToggleVacationTypeMenu: () => void;
  onSelectVacationType: (vacationType: VacationType) => void;
  onCancelVacationPicking: () => void;
  onEditVacation: (vacation: Vacation) => void;
  onDeleteVacation: (id: string) => void;
};

export function VacationsPanel(props: VacationsPanelProps) {
  const {
    vacations,
    avgDailyEarnings,
    isPickingVacationStart,
    isPickingVacationEnd,
    vacationTypeMenuOpen,
    onToggleVacationTypeMenu,
    onSelectVacationType,
    onCancelVacationPicking,
    onEditVacation,
    onDeleteVacation,
  } = props;

  return (
    <div style={{ flex: "1 1 460px", minWidth: 380, padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <b>{"Vacations this month"}</b>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isPickingVacationStart ? (
            <span style={{ fontSize: 12, opacity: 0.8 }}>{"Pick a start date in the calendar"}</span>
          ) : null}
          {isPickingVacationEnd ? (
            <span style={{ fontSize: 12, opacity: 0.8 }}>{"Pick an end date in the calendar"}</span>
          ) : null}
          {(isPickingVacationStart || isPickingVacationEnd) ? (
            <button onClick={onCancelVacationPicking}>{"Cancel"}</button>
          ) : null}
          <div style={{ position: "relative" }} data-vacation-type-menu="true">
            <button
              onClick={onToggleVacationTypeMenu}
              title={"Add vacation"}
              aria-label={"Add vacation"}
              style={{ minWidth: 28, fontWeight: 700 }}
            >
              +
            </button>
            {vacationTypeMenuOpen ? (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  right: 0,
                  zIndex: 100,
                  minWidth: 170,
                  padding: 6,
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: "#fff",
                  boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <button type="button" onClick={() => onSelectVacationType("paid")}>
                  {"Paid"}
                </button>
                <button type="button" onClick={() => onSelectVacationType("unpaid")}>
                  {"Unpaid"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        {vacations.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {vacations.map((v) => (
              <div
                key={v.id}
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
                    <b>{v.start_date}</b> - <b>{v.end_date}</b> - {v.title} - {vacationTypeLabel(normalizeVacationType(v.vacation_type))} - {normalizeVacationType(v.vacation_type) === "paid" ? rub(avgDailyEarnings * inclusiveDays(v.start_date, v.end_date)) : "No vacation payout"}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    title={"Edit vacation"}
                    aria-label={"Edit vacation"}
                    style={{ color: "#444", fontWeight: 700 }}
                    onClick={() => onEditVacation(v)}
                  >
                    {"Edit"}
                  </button>
                  <button
                    title={"Delete vacation"}
                    aria-label={"Delete vacation"}
                    style={{ color: "#c51616", fontWeight: 700 }}
                    onClick={() => onDeleteVacation(v.id)}
                  >
                    {"Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
