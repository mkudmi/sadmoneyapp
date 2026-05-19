import { Vacation } from "../lib/api";
import { rub } from "../lib/money";
import { formatDateForDisplay, inclusiveDays } from "../lib/date";
import type { DateFormat } from "../lib/date";
import { normalizeVacationType, VacationType, vacationTypeLabel } from "../lib/vacation";
import { AppIcon } from "./AppIcon";

type VacationsPanelProps = {
  vacations: Vacation[];
  dateFormat: DateFormat;
  avgDailyEarnings: number;
  vacationDaysLeft: number;
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
    dateFormat,
    avgDailyEarnings,
    vacationDaysLeft,
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
    <div className="surface" style={{ minWidth: 0, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <b>{`Vacations this month (Days left: ${vacationDaysLeft})`}</b>
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
              className="icon-button"
              style={{ minWidth: 24, minHeight: 24, padding: 0 }}
            >
              <AppIcon name="add" />
            </button>
            {vacationTypeMenuOpen ? (
              <div
                className="menu-pop"
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  right: 0,
                  zIndex: 100,
                  minWidth: 170,
                  padding: 6,
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
          <div className="panel-list" style={{ marginTop: 8 }}>
            {vacations.map((v) => (
              <div
                className="panel-item"
                key={v.id}
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
                    <b>{formatDateForDisplay(v.start_date, dateFormat)}</b> - <b>{formatDateForDisplay(v.end_date, dateFormat)}</b> - {v.title} - {vacationTypeLabel(normalizeVacationType(v.vacation_type))} - {normalizeVacationType(v.vacation_type) === "paid" ? rub(avgDailyEarnings * inclusiveDays(v.start_date, v.end_date)) : "No vacation payout"}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="edit-pencil-btn"
                    title={"Edit vacation"}
                    aria-label={"Edit vacation"}
                    style={{ width: 26, minWidth: 26, minHeight: 26, borderRadius: 8 }}
                    onClick={() => onEditVacation(v)}
                  >
                    <AppIcon name="edit" />
                  </button>
                  <button
                    title={"Delete vacation"}
                    aria-label={"Delete vacation"}
                    className="icon-button"
                    style={{ color: "var(--danger)", minHeight: 26, padding: 0, width: 26, minWidth: 26 }}
                    onClick={() => onDeleteVacation(v.id)}
                  >
                    <AppIcon name="delete" />
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
