import { SalaryEvent, Vacation } from "../lib/api";
import { formatDateForDisplay } from "../lib/date";
import type { DateFormat } from "../lib/date";
import { rub } from "../lib/money";
import { calculateVacationPayout, getVacationChargeableDays } from "../lib/russianVacation";
import type { RussianProductionCalendarDay } from "../lib/russianProductionCalendar";
import { normalizeVacationType, VacationType, vacationTypeLabel } from "../lib/vacation";
import { AppIcon } from "./AppIcon";

type VacationsPanelProps = {
  vacations: Vacation[];
  dateFormat: DateFormat;
  salaryEvents: SalaryEvent[];
  productionCalendarDays?: ReadonlyMap<string, RussianProductionCalendarDay> | null;
  vacationDaysCount: string;
  vacationDaysLeft: number;
  vacationTypeMenuOpen: boolean;
  onVacationDaysCountChange: (value: string) => void;
  onVacationDaysCountCommit: (value: string) => void;
  onToggleVacationTypeMenu: () => void;
  onSelectVacationType: (vacationType: VacationType) => void;
  onEditVacation: (vacation: Vacation) => void;
  onDeleteVacation: (id: string) => void;
};

export function VacationsPanel(props: VacationsPanelProps) {
  const {
    vacations,
    dateFormat,
    salaryEvents,
    productionCalendarDays,
    vacationDaysCount,
    vacationDaysLeft,
    vacationTypeMenuOpen,
    onVacationDaysCountChange,
    onVacationDaysCountCommit,
    onToggleVacationTypeMenu,
    onSelectVacationType,
    onEditVacation,
    onDeleteVacation,
  } = props;

  return (
    <div className="vacations-panel">
      <div className="vacations-panel-toolbar">
        <div className="vacations-panel-toolbar-main">
          <div className="vacations-panel-title-row">
            <b className="vacations-panel-title">{"Vacations in this view"}</b>
            <span className="vacations-panel-subtle-count">{`${vacations.length} planned`}</span>
          </div>

          <div className="vacations-panel-summary">
            <label className="vacations-panel-stat vacations-panel-stat-editable">
              <span className="vacations-panel-stat-label">{"Vacation days count"}</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={vacationDaysCount}
                onChange={(e) => onVacationDaysCountChange(e.target.value)}
                onBlur={(e) => onVacationDaysCountCommit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onVacationDaysCountCommit((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="vacations-panel-count-input"
              />
            </label>

            <div className="vacations-panel-stat vacations-panel-stat-strong">
              <span className="vacations-panel-stat-label">{"Days left"}</span>
              <b className="vacations-panel-stat-value">{vacationDaysLeft}</b>
            </div>
          </div>
        </div>

        <div style={{ position: "relative" }} data-vacation-type-menu="true">
          <button
            onClick={onToggleVacationTypeMenu}
            title={"Add vacation"}
            aria-label={"Add vacation"}
            className="vacations-panel-add-button"
          >
            <AppIcon name="add" />
            <span>{"Add vacation"}</span>
          </button>
          {vacationTypeMenuOpen ? (
            <div
              className="menu-pop"
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                zIndex: 100,
                minWidth: 180,
                padding: 6,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <button type="button" onClick={() => onSelectVacationType("paid")}>
                {"Paid vacation"}
              </button>
              <button type="button" onClick={() => onSelectVacationType("unpaid")}>
                {"Unpaid vacation"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="vacations-panel-list-wrap">
        {vacations.length > 0 ? (
          <div className="vacations-panel-list">
            {vacations.map((vacation) => {
              const normalizedType = normalizeVacationType(vacation.vacation_type);
              const daysCount = getVacationChargeableDays(
                vacation.start_date,
                vacation.end_date,
                productionCalendarDays,
              );
              const payoutLabel = normalizedType === "paid"
                ? rub(
                    calculateVacationPayout({
                      salaryEvents,
                      vacations,
                      vacationStartDate: vacation.start_date,
                      vacationEndDate: vacation.end_date,
                      vacationType: normalizedType,
                      productionCalendarDays,
                    }),
                  )
                : "No payout";

              return (
                <div className="vacations-entry" key={vacation.id}>
                  <div className="vacations-entry-month">
                    {formatVacationPlannedMonths(vacation.start_date, vacation.end_date)}
                  </div>

                  <div className="vacations-entry-main">
                    <div className="vacations-entry-head">
                      <b>{vacation.title}</b>
                      <span
                        className={
                          normalizedType === "paid"
                            ? "vacations-entry-type vacations-entry-type-paid"
                            : "vacations-entry-type"
                        }
                      >
                        {vacationTypeLabel(normalizedType)}
                      </span>
                    </div>

                    <div className="vacations-entry-meta">
                      <span>
                        <b>{formatDateForDisplay(vacation.start_date, dateFormat)}</b>
                        {" -> "}
                        <b>{formatDateForDisplay(vacation.end_date, dateFormat)}</b>
                      </span>
                      <span>{`${daysCount} days`}</span>
                      <span>{payoutLabel}</span>
                    </div>
                  </div>

                  <div className="vacations-entry-actions">
                    <button
                      className="edit-pencil-btn"
                      title={"Edit vacation"}
                      aria-label={"Edit vacation"}
                      style={{ width: 28, minWidth: 28, minHeight: 28, borderRadius: 10 }}
                      onClick={() => onEditVacation(vacation)}
                    >
                      <AppIcon name="edit" />
                    </button>
                    <button
                      title={"Delete vacation"}
                      aria-label={"Delete vacation"}
                      className="icon-button"
                      style={{ color: "var(--danger)", minHeight: 28, padding: 0, width: 28, minWidth: 28 }}
                      onClick={() => onDeleteVacation(vacation.id)}
                    >
                      <AppIcon name="delete" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="vacations-panel-empty">
            <div className="vacations-panel-empty-title">{"No vacations in this view"}</div>
            <div className="vacations-panel-empty-text">
              {"Create or switch months to review vacations inside the current view period."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatVacationPlannedMonths(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const startMonth = start.toLocaleString("en-US", { month: "long" });
  const endMonth = end.toLocaleString("en-US", { month: "long" });
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();

  if (startYear === endYear && startMonth === endMonth) {
    return startMonth;
  }

  if (startYear === endYear) {
    return `${startMonth}-${endMonth}`;
  }

  return `${startMonth} ${startYear}-${endMonth} ${endYear}`;
}
