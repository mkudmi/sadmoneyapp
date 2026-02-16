import { useEffect, useMemo, useState } from "react";
import { daysInMonth, parseYmdLocal, ymd } from "../lib/date";
import { useDismissible } from "../hooks/useDismissible";

type DateInputWithCalendarProps = {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
};

export function DateInputWithCalendar({ value, placeholder = "DD-MM-YYYY", onChange }: DateInputWithCalendarProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth0, setViewMonth0] = useState(new Date().getMonth());

  useDismissible(open, () => setOpen(false), "[data-date-picker]");

  useEffect(() => {
    if (!open) return;
    const parsed = parseYmdSafe(value);
    if (!parsed) return;
    setViewYear(parsed.getFullYear());
    setViewMonth0(parsed.getMonth());
  }, [open, value]);

  const monthDays = useMemo(() => {
    const n = daysInMonth(viewYear, viewMonth0);
    return Array.from({ length: n }, (_, idx) => idx + 1);
  }, [viewYear, viewMonth0]);

  const firstDayJs = new Date(viewYear, viewMonth0, 1).getDay();
  const leadingEmpty = (firstDayJs + 6) % 7; // Mon..Sun
  const totalCells = leadingEmpty + monthDays.length;
  const trailing = (7 - (totalCells % 7)) % 7;
  const gridCells: Array<number | null> = [
    ...Array(leadingEmpty).fill(null),
    ...monthDays,
    ...Array(trailing).fill(null),
  ];

  function prevMonth() {
    const d = new Date(viewYear, viewMonth0, 1);
    d.setMonth(d.getMonth() - 1);
    setViewYear(d.getFullYear());
    setViewMonth0(d.getMonth());
  }

  function nextMonth() {
    const d = new Date(viewYear, viewMonth0, 1);
    d.setMonth(d.getMonth() + 1);
    setViewYear(d.getFullYear());
    setViewMonth0(d.getMonth());
  }

  return (
    <div style={{ position: "relative" }} data-date-picker="true">
      <input
        value={formatYmdToDmy(value)}
        readOnly
        placeholder={placeholder}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}
      />

      {open ? (
        <div
          className="menu-pop"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 30,
            width: "min(320px, 100%)",
            maxWidth: "100%",
            padding: 8,
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <button type="button" onClick={prevMonth}>{"<"}</button>
            <b style={{ fontSize: 13 }}>
              {new Date(viewYear, viewMonth0, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </b>
            <button type="button" onClick={nextMonth}>{">"}</button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gap: 4,
              fontSize: 12,
              width: "100%",
              minWidth: 0,
            }}
          >
            {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
              <div key={d} style={{ textAlign: "center", opacity: 0.7 }}>{d}</div>
            ))}
            {gridCells.map((day, idx) => {
              if (!day) return <div key={`empty-${idx}`} />;
              const picked = ymd(new Date(viewYear, viewMonth0, day));
              const isActive = picked === value;
              return (
                <button
                  key={`day-${day}`}
                  type="button"
                  onClick={() => {
                    onChange(picked);
                    setOpen(false);
                  }}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    height: 28,
                    borderRadius: 6,
                    border: isActive ? "1px solid #138a36" : "1px solid #eee",
                    background: isActive ? "rgba(19,138,54,0.1)" : "#fff",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function parseYmdSafe(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = parseYmdLocal(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatYmdToDmy(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [y, m, d] = value.split("-");
  return `${d}-${m}-${y}`;
}
