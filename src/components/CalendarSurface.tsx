import { Dispatch, RefObject, SetStateAction } from "react";
import { AppData, OffDay, TxType } from "../lib/api";
import { rub } from "../lib/money";

type CalendarSurfaceProps = {
  calendarWeeks: number;
  gridCells: Array<string | null>;
  sumsByDate: Map<string, { inc: number; exp: number }>;
  today: string;
  selectedDate: string;
  data: AppData | null;
  workSchedule: "5/2" | "custom";
  isPickingCustomWorkDays: boolean;
  customWorkingDays: string[];
  isCalendarPickerFocus: boolean;
  locale: string;
  dayMenuOpen: string | null;
  dayMenuPos: { left: number; top: number };
  dayMenuRef: RefObject<HTMLDivElement | null>;
  setDayMenuOpen: Dispatch<SetStateAction<string | null>>;
  setDayMenuAnchorRect: Dispatch<SetStateAction<{ top: number; bottom: number } | null>>;
  openDayMenu: (date: string, anchor: HTMLElement) => void;
  onDayTileClick: (date: string) => void;
  onSelectDate: (date: string) => void;
  onOpenTx: (type: TxType, date: string) => void;
  onToggleWorkingDay: (params: {
    date: string;
    effectiveWorking: boolean;
    isWeekend: boolean;
    offForDay: OffDay | null;
  }) => Promise<void>;
};

export function CalendarSurface(props: CalendarSurfaceProps) {
  const {
    calendarWeeks,
    gridCells,
    sumsByDate,
    today,
    selectedDate,
    data,
    workSchedule,
    isPickingCustomWorkDays,
    customWorkingDays,
    isCalendarPickerFocus,
    locale,
    dayMenuOpen,
    dayMenuPos,
    dayMenuRef,
    setDayMenuOpen,
    setDayMenuAnchorRect,
    openDayMenu,
    onDayTileClick,
    onSelectDate,
    onOpenTx,
    onToggleWorkingDay,
  } = props;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gridTemplateRows: `repeat(${calendarWeeks}, minmax(0, 1fr))`,
        gap: 8,
        padding: 12,
        border: "1px solid #ddd",
        borderRadius: 12,
        flex: "2 1 520px",
        minWidth: 320,
        height: "100%",
        minHeight: 0,
        overflowY: "auto",
        boxSizing: "border-box",
        alignContent: "stretch",
        position: "relative",
        zIndex: isCalendarPickerFocus ? 4001 : 1,
        background: "#fff",
        boxShadow: isCalendarPickerFocus ? "0 12px 34px rgba(0,0,0,0.3)" : "none",
      }}
    >
      {gridCells.map((d, idx) => {
        if (!d) {
          return (
            <div
              key={`empty-${idx}`}
              style={{
                border: "1px solid transparent",
                borderRadius: 12,
                padding: 8,
                minHeight: 0,
                height: "100%",
                background: "transparent",
              }}
            />
          );
        }

        const s = sumsByDate.get(d) ?? { inc: 0, exp: 0 };
        const isToday = d === today;
        const isFutureDate = d > today;
        const isSel = d === selectedDate;
        const vacForDay = (data?.vacations ?? []).find((v) => v.start_date <= d && d <= v.end_date) ?? null;
        const offForDay = (data?.offDays ?? []).find((o) => o.date === d) ?? null;

        const dayOfWeek = new Date(d).getDay(); // 0 = Sunday, 6 = Saturday
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const defaultWorking = workSchedule === "5/2" ? !isWeekend : false;
        const effectiveWorking = offForDay ? !!offForDay.is_working : defaultWorking;
        const weekendHighlight = workSchedule === "5/2" && isWeekend && !effectiveWorking;
        const vacationHighlight = vacForDay !== null;
        const offDayHighlight = !effectiveWorking && !weekendHighlight;
        const isCustomMarkedWorking = isPickingCustomWorkDays && customWorkingDays.includes(d);
        const isCustomMainView = workSchedule === "custom" && !isPickingCustomWorkDays;
        const isCustomNonWorking = workSchedule === "custom" && !isPickingCustomWorkDays && !effectiveWorking;
        const isManuallyMarkedWorking = !!offForDay?.is_working;
        const tileBackground = isPickingCustomWorkDays
          ? (isCustomMarkedWorking ? "rgba(30, 160, 90, 0.18)" : "transparent")
          : vacationHighlight
            ? "rgba(255, 223, 99, 0.25)"
            : isCustomMainView
              ? (isCustomNonWorking ? "rgba(210, 20, 20, 0.10)" : "#fff")
              : isCustomNonWorking
                ? "rgba(210, 20, 20, 0.10)"
                : weekendHighlight
                  ? "rgba(255, 0, 0, 0.06)"
                  : isToday
                    ? (isManuallyMarkedWorking ? "#fff" : "rgba(0, 200, 120, 0.08)")
                    : offDayHighlight
                      ? "rgba(255, 0, 0, 0.06)"
                      : "transparent";
        const dayLabelColor = isPickingCustomWorkDays
          ? (isCustomMarkedWorking ? "#17653e" : undefined)
          : vacationHighlight
            ? "#7a5200"
            : isCustomMainView
              ? (isCustomNonWorking ? "#b10000" : undefined)
              : isCustomNonWorking
                ? "#b10000"
                : weekendHighlight
                  ? "#c00"
                  : offDayHighlight
                    ? "#c00"
                    : undefined;

        return (
          <div
            key={d}
            onClick={() => {
              setDayMenuOpen(null);
              setDayMenuAnchorRect(null);
              onDayTileClick(d);
            }}
            style={{
              position: "relative",
              cursor: "pointer",
              zIndex: dayMenuOpen === d ? 50 : 0,
              border: isPickingCustomWorkDays
                ? (isCustomMarkedWorking ? "2px solid #1c7f4d" : "1px solid #ddd")
                : isSel
                  ? "2px solid #333"
                  : isToday
                    ? "2px solid #1b7"
                    : "1px solid #ddd",
              background: tileBackground,
              borderRadius: 12,
              padding: 8,
              minHeight: 0,
              height: "100%",
            }}
          >
            {!isCalendarPickerFocus ? (
              <div style={{ position: "absolute", top: 6, right: 6, zIndex: 10 }} data-day-menu="true">
                <button
                  aria-label={"Menu"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectDate(d);
                    openDayMenu(d, e.currentTarget);
                  }}
                  style={{
                    minWidth: 28,
                    minHeight: 28,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    textAlign: "center",
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  {"\u22EF"}
                </button>

                {dayMenuOpen === d ? (
                  <div
                    ref={dayMenuRef}
                    data-day-menu="true"
                    style={{
                      position: "fixed",
                      top: dayMenuPos.top,
                      left: dayMenuPos.left,
                      zIndex: 2000,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      width: 220,
                      padding: 8,
                      borderRadius: 10,
                      border: "1px solid #ddd",
                      background: "#fff",
                      boxShadow: "0 8px 20px rgba(0,0,0,0.14)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      style={{ fontSize: 12, padding: "4px 8px" }}
                      onClick={() => {
                        onSelectDate(d);
                        onOpenTx("income", d);
                        setDayMenuOpen(null);
                      }}
                    >
                      {"Add income"}
                    </button>
                    {!isFutureDate ? (
                      <button
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        onClick={() => {
                          onSelectDate(d);
                          onOpenTx("expense", d);
                          setDayMenuOpen(null);
                        }}
                      >
                        {"Add expense"}
                      </button>
                    ) : null}
                    <button
                      style={{ fontSize: 12, padding: "4px 8px" }}
                      onClick={() => {
                        onSelectDate(d);
                        onOpenTx("planned_expense", d);
                        setDayMenuOpen(null);
                      }}
                    >
                      {"Planned expense"}
                    </button>
                    <div style={{ height: 1, background: "#eee", margin: "4px 0" }} />
                    <button
                      style={{ fontSize: 12, padding: "4px 8px" }}
                      onClick={async () => {
                        await onToggleWorkingDay({
                          date: d,
                          effectiveWorking,
                          isWeekend,
                          offForDay,
                        });
                        setDayMenuOpen(null);
                      }}
                    >
                      {effectiveWorking ? "Mark as day off" : "Mark as working"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ fontSize: 12, opacity: 0.7, fontWeight: isCustomMarkedWorking ? 700 : 400, color: dayLabelColor }}>{d.slice(8, 10)}</div>
              <div style={{ fontSize: 11, opacity: 0.7, color: dayLabelColor }}>{new Date(d).toLocaleDateString(locale, { weekday: "short" })}</div>
            </div>
            <div style={{ fontSize: 12 }}>+ {rub(s.inc)}</div>
            <div style={{ fontSize: 12 }}>- {rub(s.exp)}</div>
          </div>
        );
      })}
    </div>
  );
}
