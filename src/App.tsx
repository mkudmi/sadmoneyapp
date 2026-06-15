import { useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { api, AppData, Debt, OffDay, SalaryConfig, SalaryEvent, Transaction, Vacation } from "./lib/api";
import { rub, toKop } from "./lib/money";
import { capitalizeFirst } from "./lib/text";
import {
  buildAutoSalaryEvents,
  estimateManualSalaryForDate,
  findFollowingSalaryDate,
  normalizeSalaryConfigs,
  type ManualSalaryEstimate,
} from "./lib/salary";
import {
  dateFormatPattern,
  daysInMonth,
  formatDateForDisplay,
  normalizeDateFormat,
  parseYmdLocal,
  ymd,
  ymFromYmd,
} from "./lib/date";
import type { DateFormat } from "./lib/date";
import { isDebtCategory, normalizeCategoryInput } from "./lib/category";
import { normalizeVacationType, VacationType } from "./lib/vacation";
import { useDismissible } from "./hooks/useDismissible";
import { useRussianProductionCalendar } from "./hooks/useRussianProductionCalendar";
import { useVacationDaysCount } from "./hooks/useVacationDaysCount";
import { VacationsPanel } from "./components/VacationsPanel";
import { SalariesPanel } from "./components/SalariesPanel";
import { PiggyBankModal, PiggyBankModalType } from "./components/PiggyBankModal";
import { SelectedDateBudgetSummary } from "./components/SelectedDateBudgetSummary";
import { SelectedDateTransactionsList } from "./components/SelectedDateTransactionsList";
import { TopCategoriesPanel } from "./components/TopCategoriesPanel";
import { EditTransactionModal } from "./components/EditTransactionModal";
import { EditSalaryModal } from "./components/EditSalaryModal";
import { GeneralStatsSurface } from "./components/GeneralStatsSurface";
import { DebtsSurface } from "./components/DebtsSurface";
import { CalendarSurface } from "./components/CalendarSurface";
import { TrendsCategoryComparisonPanel } from "./components/TrendsCategoryComparisonPanel";
import { useConfirmDialog } from "./hooks/useConfirmDialog";
import { usePiggyBankHotkeys } from "./hooks/usePiggyBankHotkeys";
import { buildTrendsData } from "./lib/trends";
import { AppIcon } from "./components/AppIcon";
import { DateInputWithCalendar } from "./components/DateInputWithCalendar";
import { calculateVacationAverageDailyPay, calculateVacationPayout, getVacationChargeableDays, isRussianPublicHoliday } from "./lib/russianVacation";
import {
  getRussianProductionCalendarDay,
  getRussianProductionCalendarDayLabel,
  getRussianProductionCalendarDayTone,
  isRussianProductionCalendarDayOff,
  isRussianWorkingWeekend,
} from "./lib/russianProductionCalendar";
import {
  inferSalaryEventAccrualMonth,
  normalizeSalaryEventAccrualMonth,
  normalizeSalaryEventKind,
  SalaryEventKind,
  salaryEventKindLabel,
} from "./lib/salaryEvent";

const VACATION_DAYS_COUNT_STORAGE_KEY = "sadmoneyapp.vacation_days_count";
const LEGACY_PIGGY_BANK_STORAGE_KEY = "sadmoneyapp.piggy_bank_amount";
const DEBUG_USE_CUSTOM_TODAY = false;
const DEBUG_CUSTOM_TODAY = "2026-03-06";

type SalaryConfigDraft = {
  id: string;
  effectiveFrom: string;
  amount: string;
  advancePercent: string;
  advanceDay: string;
  salaryDay: string;
};

function createEmptySalaryConfigDraft(today: string): SalaryConfigDraft {
  return {
    id: "",
    effectiveFrom: today,
    amount: "",
    advancePercent: "50",
    advanceDay: "20",
    salaryDay: "5",
  };
}

export default function App() {
  const today = DEBUG_USE_CUSTOM_TODAY ? DEBUG_CUSTOM_TODAY : ymd(new Date());
  const [data, setData] = useState<AppData | null>(null);
  const [year, setYear] = useState(() => parseYmdLocal(today).getFullYear());
  const [month0, setMonth0] = useState(() => parseYmdLocal(today).getMonth()); // 0..11
  const [selectedDate, setSelectedDate] = useState(today);
  const locale = "en-US";
  const [budget, setBudget] = useState<{ per_day: number; days: number; next_salary_date: string | null; available: number } | null>(null);
  const piggyBankAmount = Math.max(0, data?.piggyBankAmount ?? 0);
  const monthKey = `${year}-${String(month0 + 1).padStart(2, "0")}`; // "YYYY-MM"
  const displayedMonthStart = `${monthKey}-01`;
  const displayedMonthEnd = `${monthKey}-${String(daysInMonth(year, month0)).padStart(2, "0")}`;
  const salaryEventsRangeStart = useMemo(() => {
    const vacationWindowStart = new Date(parseYmdLocal(today).getFullYear(), parseYmdLocal(today).getMonth() - 12, 1);
    const yearStart = new Date(year, 0, 1);
    const displayedStart = parseYmdLocal(displayedMonthStart);
    const earliest = new Date(Math.min(vacationWindowStart.getTime(), yearStart.getTime(), displayedStart.getTime()));
    return ymd(earliest);
  }, [displayedMonthStart, today, year]);
  const salaryEventsRangeEnd = useMemo(() => {
    const todayPlusBudgetWindow = new Date(parseYmdLocal(today).getFullYear(), parseYmdLocal(today).getMonth(), parseYmdLocal(today).getDate() + 70);
    const yearEnd = new Date(year, 11, 31);
    const displayedEnd = parseYmdLocal(displayedMonthEnd);
    const latest = new Date(Math.max(todayPlusBudgetWindow.getTime(), yearEnd.getTime(), displayedEnd.getTime()));
    return ymd(latest);
  }, [displayedMonthEnd, today, year]);
  const autoSalaryEvents = useMemo(
    () => buildAutoSalaryEvents(data?.settings.salaryConfigs, salaryEventsRangeStart, salaryEventsRangeEnd),
    [data?.settings.salaryConfigs, salaryEventsRangeEnd, salaryEventsRangeStart]
  );
  const allSalaryEvents = useMemo(
    () =>
      [...(data?.salaryEvents ?? []), ...autoSalaryEvents].sort(
        (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
      ),
    [autoSalaryEvents, data?.salaryEvents]
  );
  const viewData = useMemo(
    () => (data ? { ...data, salaryEvents: allSalaryEvents } : null),
    [allSalaryEvents, data]
  );
  const salaryThisMonth = allSalaryEvents
    .filter((s) => ymFromYmd(s.date) === monthKey)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const vacationsThisMonth = useMemo(() => {
    const monthStart = `${monthKey}-01`;
    const monthEnd = `${monthKey}-${String(daysInMonth(year, month0)).padStart(2, "0")}`;
    return (data?.vacations ?? []).filter(v => v.start_date <= monthEnd && v.end_date >= monthStart);
  }, [data?.vacations, month0, monthKey, year]);
  const vacationsInManagerRange = useMemo(() => {
    const monthStart = `${monthKey}-01`;

    return [...(data?.vacations ?? [])]
      .filter((vacation) => vacation.end_date >= monthStart)
      .sort((a, b) => {
        if (a.start_date !== b.start_date) return a.start_date.localeCompare(b.start_date);
        if (a.end_date !== b.end_date) return a.end_date.localeCompare(b.end_date);
        return a.title.localeCompare(b.title);
      });
  }, [data?.vacations, monthKey]);
  const topCategoriesThisMonth = useMemo(() => {
    if (!data) return [] as Array<{ category: string; amount: number; type: "income" | "expense" }>;

    const monthStart = `${monthKey}-01`;
    const byCategory = new Map<string, { amount: number; type: "income" | "expense" }>();
    for (const t of data.transactions) {
      if (t.date < monthStart || t.date > today) continue;
      if (t.type !== "income" && t.type !== "expense") continue;
      const category = (t.category || "").trim() || "No category";
      const prev = byCategory.get(`${t.type}:${category}`);
      byCategory.set(`${t.type}:${category}`, {
        type: t.type,
        amount: (prev?.amount ?? 0) + t.amount,
      });
    }

    for (const s of allSalaryEvents) {
      if (s.date < monthStart || s.date > today) continue;
      const category = (s.title || "").trim() || "Salary";
      const key = `income:${category}`;
      const prev = byCategory.get(key);
      byCategory.set(key, {
        type: "income",
        amount: (prev?.amount ?? 0) + s.amount,
      });
    }

    return Array.from(byCategory.entries())
      .map(([key, value]) => ({
        category: key.split(":").slice(1).join(":"),
        amount: value.amount,
        type: value.type,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [allSalaryEvents, data, monthKey, today]);
  const trendsData = useMemo(
    () => buildTrendsData({ data: viewData, monthKey, year, month0, today, locale }),
    [locale, month0, monthKey, today, viewData, year]
  );

  const storedWorkSchedule = data?.settings.workSchedule === "custom" ? "custom" : "5/2";
  const [workSchedule, setWorkSchedule] = useState<'5/2' | 'custom'>('5/2');
  const saveRemainingDailyLimitToPiggyBank = Boolean(data?.settings.saveRemainingDailyLimitToPiggyBank);
  const lastDailyLimitCarryoverDate = data?.settings.lastDailyLimitCarryoverDate ?? "";
  const dateFormat = normalizeDateFormat(data?.settings.dateFormat);
  const productionCalendarYears = useMemo(() => {
    const years = new Set<number>([
      parseYmdLocal(today).getFullYear(),
      parseYmdLocal(selectedDate).getFullYear(),
      year - 1,
      year,
      year + 1,
    ]);

    for (const vacation of data?.vacations ?? []) {
      years.add(parseYmdLocal(vacation.start_date).getFullYear());
      years.add(parseYmdLocal(vacation.end_date).getFullYear());
    }

    return Array.from(years).sort((a, b) => a - b);
  }, [data?.vacations, selectedDate, today, year]);
  const productionCalendarDays = useRussianProductionCalendar(productionCalendarYears);
  const salaryConfigs = useMemo(
    () => normalizeSalaryConfigs(data?.settings.salaryConfigs),
    [data?.settings.salaryConfigs]
  );
  const { vacationDaysCount, handleVacationDaysCountChange, commitVacationDaysCount } =
    useVacationDaysCount(VACATION_DAYS_COUNT_STORAGE_KEY);
  const vacationDaysLeft = useMemo(() => {
    const total = Number.parseInt(vacationDaysCount, 10);
    if (!Number.isFinite(total) || total <= 0) return 0;
    if (!data) return total;

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const usedDays = new Set<string>();

    for (const v of data.vacations ?? []) {
      if (normalizeVacationType(v.vacation_type) !== "paid") continue;
      const start = v.start_date > yearStart ? v.start_date : yearStart;
      const end = v.end_date < yearEnd ? v.end_date : yearEnd;
      if (start > end) continue;

      const cur = parseYmdLocal(start);
      const endDate = parseYmdLocal(end);
      while (cur <= endDate) {
        const date = ymd(cur);
        if (!isRussianPublicHoliday(date, productionCalendarDays)) {
          usedDays.add(date);
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    return Math.max(total - usedDays.size, 0);
  }, [data, productionCalendarDays, vacationDaysCount, year]);

  const vacationAverageDailyPay = useMemo(() => {
    if (!viewData) return 0;
    return calculateVacationAverageDailyPay({
      salaryEvents: viewData.salaryEvents ?? [],
      vacations: viewData.vacations ?? [],
      vacationStartDate: today,
      productionCalendarDays,
    });
  }, [productionCalendarDays, today, viewData]);

  function focusOnDate(date: string) {
    const parsed = parseYmdLocal(date);
    setYear(parsed.getFullYear());
    setMonth0(parsed.getMonth());
    setSelectedDate(date);
  }

  useEffect(() => {
    api.getData().then(setData);
  }, []);

  useEffect(() => {
    setWorkSchedule(storedWorkSchedule);
  }, [storedWorkSchedule]);

  useEffect(() => {
    if (!data) return;
    if (!saveRemainingDailyLimitToPiggyBank) return;

    const currentDate = parseYmdLocal(today);
    const processedDate = lastDailyLimitCarryoverDate ? parseYmdLocal(lastDailyLimitCarryoverDate) : null;

    if (!processedDate) {
      api.setUserPreferences(storedWorkSchedule, true, today).then(setData).catch((err) => {
        console.error("user preferences init failed", err);
      });
      return;
    }

    const diffDays = Math.round((currentDate.getTime() - processedDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return;

    if (diffDays > 1) {
      api.applyDailyLimitCarryover(0, today).then(setData).catch((err) => {
        console.error("daily limit carryover sync failed", err);
      });
      return;
    }

    api.calcDailyBudget(lastDailyLimitCarryoverDate)
      .then((previousDayBudget) => {
        const spentOnPreviousDay = (data.transactions ?? [])
          .filter((t) => t.date === lastDailyLimitCarryoverDate && t.type === "expense")
          .reduce((sum, t) => sum + t.amount, 0);
        const carryoverAmount = Math.max(0, previousDayBudget.per_day - spentOnPreviousDay);
        return api.applyDailyLimitCarryover(carryoverAmount, today);
      })
      .then(setData)
      .catch((err) => {
        console.error("daily limit carryover failed", err);
      });
  }, [
    data,
    lastDailyLimitCarryoverDate,
    saveRemainingDailyLimitToPiggyBank,
    storedWorkSchedule,
    today,
  ]);

  useEffect(() => {
    api.calcDailyBudget(today).then(setBudget);
  }, [today, data]);

  const availableForSpending = budget?.available ?? 0;
  const spentToday = useMemo(
    () =>
      (data?.transactions ?? [])
        .filter((t) => t.date === today && t.type === "expense")
        .reduce((sum, t) => sum + t.amount, 0),
    [data?.transactions, today],
  );
  const dailySpendLimitFromAvailable = budget
    ? budget.per_day - spentToday
    : 0;


  const monthDays = useMemo(() => {
    const n = daysInMonth(year, month0);
    const out: string[] = [];
    for (let d = 1; d <= n; d++) {
      out.push(ymd(new Date(year, month0, d)));
    }
    return out;
  }, [year, month0]);

  const workDaysInMonth = useMemo(() => {
    const vacations = data?.vacations ?? [];
    const offDays = data?.offDays ?? [];
    let total = 0;

    for (const date of monthDays) {
      if (vacations.some((v) => v.start_date <= date && date <= v.end_date)) {
        continue;
      }

      const offForDay = offDays.find((o) => o.date === date) ?? null;
      const dayOfWeek = new Date(date).getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      if (workSchedule === "custom") {
        if (offForDay?.is_working) {
          total++;
        }
        continue;
      }

      const defaultWorking = isRussianWorkingWeekend(date, productionCalendarDays)
        ? true
        : isRussianProductionCalendarDayOff(date, productionCalendarDays)
          ? false
          : !isWeekend;
      const effectiveWorking = offForDay ? !!offForDay.is_working : defaultWorking;
      if (effectiveWorking) {
        total++;
      }
    }

    return total;
  }, [data?.offDays, data?.vacations, monthDays, productionCalendarDays, workSchedule]);

  // Build calendar grid cells so weeks start on Monday and end on Sunday
  const firstDayJs = new Date(year, month0, 1).getDay(); // 0 = Sun .. 6 = Sat
  const leadingEmpty = (firstDayJs + 6) % 7; // convert to Mon=0..Sun=6
  const totalCells = leadingEmpty + monthDays.length;
  const trailing = (7 - (totalCells % 7)) % 7;
  const gridCells = [
    ...Array(leadingEmpty).fill(null),
    ...monthDays,
    ...Array(trailing).fill(null),
  ];
  const calendarWeeks = gridCells.length / 7;

  const sumsByDate = useMemo(() => {
    const map = new Map<string, { inc: number; exp: number }>();
    if (!viewData) return map;
    for (const t of viewData.transactions) {
      const cur = map.get(t.date) ?? { inc: 0, exp: 0 };
      if (t.type === "income") cur.inc += t.amount;
      if (t.type === "expense" || t.type === "planned_expense") cur.exp += t.amount;
      map.set(t.date, cur);
    }

    // Add salary events as income for each day
    for (const s of viewData.salaryEvents ?? []) {
      const cur = map.get(s.date) ?? { inc: 0, exp: 0 };
      cur.inc += s.amount;
      map.set(s.date, cur);
    }

    return map;
  }, [viewData]);

  const salaryEventsForSelectedDate = allSalaryEvents.filter((s) => s.date === selectedDate);
  const salaryAmountForSelectedDate = salaryEventsForSelectedDate.reduce((sum, s) => sum + s.amount, 0);
  const transactionsForSelectedDate = (data?.transactions ?? []).filter((t) => t.date === selectedDate);
  const offForSelectedDate = (data?.offDays ?? []).find(o => o.date === selectedDate) ?? null;
  const vacationForSelectedDate = (data?.vacations ?? []).find(v => v.start_date <= selectedDate && v.end_date >= selectedDate) ?? null;
  const plannedAfterExpensesForSelectedDate = useMemo(() => {
    if (!viewData || !budget?.next_salary_date) return null;

    const nextSalaryDate = budget.next_salary_date;
    const salaryEvents = viewData.salaryEvents ?? [];
    const salaryDates = salaryEvents.map((s) => s.date);

    // End of period = day before the following salary date after nextSalaryDate.
    const followingSalaryDate = findFollowingSalaryDate(nextSalaryDate, salaryDates);

    if (!followingSalaryDate) return null;
    const periodEndDate = parseYmdLocal(followingSalaryDate);
    periodEndDate.setDate(periodEndDate.getDate() - 1);
    const periodEnd = ymd(periodEndDate);

    if (selectedDate < nextSalaryDate || selectedDate > periodEnd) return null;

    const nextSalaryAmount = salaryEvents
      .filter((s) => s.date === nextSalaryDate)
      .reduce((sum, s) => sum + s.amount, 0);

    if (nextSalaryAmount <= 0) return null;

    const plannedUntilSelected = (viewData.transactions ?? [])
      .filter(
        (t) =>
          t.type === "planned_expense" &&
          t.date >= nextSalaryDate &&
          t.date <= selectedDate
      )
      .reduce((sum, t) => sum + t.amount, 0);

    return nextSalaryAmount - plannedUntilSelected;
  }, [budget?.next_salary_date, selectedDate, viewData]);
  const afterVacationForSelectedDate = useMemo(() => {
    if (!data || salaryAmountForSelectedDate <= 0 || vacationAverageDailyPay <= 0) return null;

    const selected = parseYmdLocal(selectedDate);
    const selectedYear = selected.getFullYear();
    const selectedMonth0 = selected.getMonth();
    const selectedDay = selected.getDate();
    const selectedMonthKey = `${selectedYear}-${String(selectedMonth0 + 1).padStart(2, "0")}`;
    const vacationDatesForThisSalary = new Set<string>();

    for (const v of data.vacations ?? []) {
      const vacStart = parseYmdLocal(v.start_date);
      const vacEnd = parseYmdLocal(v.end_date);
      const cursor = new Date(vacStart.getFullYear(), vacStart.getMonth(), 1);
      const endMonthCursor = new Date(vacEnd.getFullYear(), vacEnd.getMonth(), 1);

      while (cursor <= endMonthCursor) {
        const y = cursor.getFullYear();
        const m0 = cursor.getMonth();
        const monthKey = `${y}-${String(m0 + 1).padStart(2, "0")}`;
        const monthDays = daysInMonth(y, m0);
        const monthStart = `${monthKey}-01`;
        const monthEnd = `${monthKey}-${String(monthDays).padStart(2, "0")}`;

        // First half (1..15) affects the salary in the second half (16..end) of the same month.
        if (selectedMonthKey === monthKey && selectedDay >= 16) {
          const firstHalfEnd = `${monthKey}-15`;
          const overlapStart = v.start_date > monthStart ? v.start_date : monthStart;
          const overlapEnd = v.end_date < firstHalfEnd ? v.end_date : firstHalfEnd;
          const cursorDate = parseYmdLocal(overlapStart);
          const overlapEndDate = parseYmdLocal(overlapEnd);
          while (cursorDate <= overlapEndDate) {
            const date = ymd(cursorDate);
            if (!isRussianPublicHoliday(date, productionCalendarDays)) {
              vacationDatesForThisSalary.add(date);
            }
            cursorDate.setDate(cursorDate.getDate() + 1);
          }
        }

        // Second half (16..end) affects the salary up to day 5 of the next month.
        const nextMonthDate = new Date(y, m0 + 1, 1);
        const nextMonthKey = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}`;
        if (selectedMonthKey === nextMonthKey && selectedDay <= 5) {
          const secondHalfStart = `${monthKey}-16`;
          const overlapStart = v.start_date > secondHalfStart ? v.start_date : secondHalfStart;
          const overlapEnd = v.end_date < monthEnd ? v.end_date : monthEnd;
          const cursorDate = parseYmdLocal(overlapStart);
          const overlapEndDate = parseYmdLocal(overlapEnd);
          while (cursorDate <= overlapEndDate) {
            const date = ymd(cursorDate);
            if (!isRussianPublicHoliday(date, productionCalendarDays)) {
              vacationDatesForThisSalary.add(date);
            }
            cursorDate.setDate(cursorDate.getDate() + 1);
          }
        }

        cursor.setMonth(cursor.getMonth() + 1);
      }
    }

    const vacationDaysForThisSalary = vacationDatesForThisSalary.size;
    if (vacationDaysForThisSalary <= 0) return null;

    const vacationDeduction = vacationDaysForThisSalary * vacationAverageDailyPay;
    const baseAmount = plannedAfterExpensesForSelectedDate ?? salaryAmountForSelectedDate;

    return {
      vacationDays: vacationDaysForThisSalary,
      vacationDeduction,
      baseAmount,
      amount: baseAmount - vacationDeduction,
      basedOnPlannedAfterExpenses: plannedAfterExpensesForSelectedDate !== null,
    };
  }, [
    data,
    selectedDate,
    salaryAmountForSelectedDate,
    vacationAverageDailyPay,
    productionCalendarDays,
    plannedAfterExpensesForSelectedDate,
  ]);
  const selectedDateWeekDay = new Date(selectedDate).getDay(); // 0 = Sunday, 6 = Saturday
  const selectedDateIsWeekend = selectedDateWeekDay === 0 || selectedDateWeekDay === 6;
  const selectedDateDefaultWorking = workSchedule === "5/2"
    ? (
        isRussianWorkingWeekend(selectedDate, productionCalendarDays)
          ? true
          : isRussianProductionCalendarDayOff(selectedDate, productionCalendarDays)
            ? false
            : !selectedDateIsWeekend
      )
    : false;
  const selectedDateIsWorking = offForSelectedDate
    ? !!offForSelectedDate.is_working
    : selectedDateDefaultWorking;
  const selectedProductionCalendarDay = getRussianProductionCalendarDay(selectedDate, productionCalendarDays);
  const selectedProductionCalendarTone = selectedProductionCalendarDay
    ? getRussianProductionCalendarDayTone(selectedProductionCalendarDay.type)
    : null;
  const selectedDateStatus = vacationForSelectedDate
    ? {
        label: "Vacation",
        border: "#a37500",
        color: "#7a5200",
        background: "#ffe07a",
      }
    : selectedProductionCalendarDay
      ? {
          label: getRussianProductionCalendarDayLabel(selectedProductionCalendarDay.type),
          border: selectedProductionCalendarTone?.border ?? "#4b83b6",
          color: selectedProductionCalendarTone?.color ?? "#1d5f91",
          background: selectedProductionCalendarTone?.background ?? "#d9efff",
        }
      : selectedDateIsWorking
        ? {
            label: "Working",
            border: "#1c7f4d",
            color: "#1c7f4d",
            background: "#cfead8",
          }
        : {
            label: "Day off",
            border: "#bf3a3a",
            color: "#bf3a3a",
            background: "#f2cfd3",
          };

  const [dayMenuOpen, setDayMenuOpen] = useState<string | null>(null);
  const [dayMenuPos, setDayMenuPos] = useState<{ left: number; top: number }>({ left: 8, top: 8 });
  const [dayMenuAnchorRect, setDayMenuAnchorRect] = useState<{ top: number; bottom: number } | null>(null);
  const dayMenuRef = useRef<HTMLDivElement | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [debtsPanelOpen, setDebtsPanelOpen] = useState(false);
  const [vacationsPanelOpen, setVacationsPanelOpen] = useState(false);
  const [trendsModalOpen, setTrendsModalOpen] = useState(false);
  const [trendsCategoryQuery, setTrendsCategoryQuery] = useState("");
  const [trendsIncomeCategoryQuery, setTrendsIncomeCategoryQuery] = useState("");
  const [settingsTab, setSettingsTab] = useState<"general" | "preferences" | "categories">("general");
  const [expenseCategoryDraft, setExpenseCategoryDraft] = useState<string>("");
  const [incomeCategoryDraft, setIncomeCategoryDraft] = useState<string>("");
  const [appVersion, setAppVersion] = useState<string>("-");
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [salaryConfigDraft, setSalaryConfigDraft] = useState<SalaryConfigDraft>(() => createEmptySalaryConfigDraft(today));
  const [salaryConfigEditId, setSalaryConfigEditId] = useState<string | null>(null);
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txModalType, setTxModalType] = useState<"income" | "expense" | "planned_expense">("expense");
  const [txModalDate, setTxModalDate] = useState<string>(today);
  const [txModalAmount, setTxModalAmount] = useState<string>("");
  const [txModalCategory, setTxModalCategory] = useState<string>("");
  const [txModalDebtPerson, setTxModalDebtPerson] = useState<string>("");
  const [txCategoryMenuOpen, setTxCategoryMenuOpen] = useState(false);
  const [debtModalOpen, setDebtModalOpen] = useState(false);
  const [debtModalAmount, setDebtModalAmount] = useState<string>("");
  const [debtModalPerson, setDebtModalPerson] = useState<string>("");
  const [debtModalEditId, setDebtModalEditId] = useState<string | null>(null);
  const [editTxModalOpen, setEditTxModalOpen] = useState(false);
  const [editTxModalId, setEditTxModalId] = useState<string | null>(null);
  const [editTxModalDate, setEditTxModalDate] = useState<string>(today);
  const [editTxModalAmount, setEditTxModalAmount] = useState<string>("");
  const [editTxModalCategory, setEditTxModalCategory] = useState<string>("");
  const [editTxModalNote, setEditTxModalNote] = useState<string>("");
  const [isPickingSalaryDate, setIsPickingSalaryDate] = useState(false);
  const [salaryModalOpen, setSalaryModalOpen] = useState(false);
  const [salaryModalDate, setSalaryModalDate] = useState<string>(today);
  const [salaryModalAmount, setSalaryModalAmount] = useState<string>("");
  const [salaryModalTitle, setSalaryModalTitle] = useState<string>("Salary");
  const [salaryModalKind, setSalaryModalKind] = useState<SalaryEventKind>("regular");
  const [salaryModalAccrualMonth, setSalaryModalAccrualMonth] = useState<string>("");
  const [salaryModalCheckResult, setSalaryModalCheckResult] = useState<ManualSalaryEstimate | null>(null);
  const [editSalaryModalOpen, setEditSalaryModalOpen] = useState(false);
  const [editSalaryModalId, setEditSalaryModalId] = useState<string | null>(null);
  const [editSalaryModalDate, setEditSalaryModalDate] = useState<string>(today);
  const [editSalaryModalAmount, setEditSalaryModalAmount] = useState<string>("");
  const [editSalaryModalTitle, setEditSalaryModalTitle] = useState<string>("Salary");
  const [editSalaryModalKind, setEditSalaryModalKind] = useState<SalaryEventKind>("regular");
  const [editSalaryModalAccrualMonth, setEditSalaryModalAccrualMonth] = useState<string>("");
  const [editSalaryModalCheckResult, setEditSalaryModalCheckResult] = useState<ManualSalaryEstimate | null>(null);
  const [piggyBankModalOpen, setPiggyBankModalOpen] = useState(false);
  const [piggyBankModalAmount, setPiggyBankModalAmount] = useState<string>("");
  const [piggyBankModalType, setPiggyBankModalType] = useState<PiggyBankModalType>("add");
  const [vacationModalEditId, setVacationModalEditId] = useState<string | null>(null);
  const [vacationModalOpen, setVacationModalOpen] = useState(false);
  const [vacationModalStart, setVacationModalStart] = useState<string>(today);
  const [vacationModalEnd, setVacationModalEnd] = useState<string>(today);
  const [vacationModalTitle, setVacationModalTitle] = useState<string>("Vacation");
  const [vacationModalType, setVacationModalType] = useState<VacationType>("paid");
  const [vacationTypeMenuOpen, setVacationTypeMenuOpen] = useState(false);
  const [isPickingCustomWorkDays, setIsPickingCustomWorkDays] = useState(false);
  const [customWorkingDays, setCustomWorkingDays] = useState<string[]>([]);
  const isCalendarPickerFocus =
    isPickingSalaryDate || isPickingCustomWorkDays;

  useEffect(() => {
    if (!dayMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && tgt.closest("[data-day-menu]")) return;
      setDayMenuOpen(null);
      setDayMenuAnchorRect(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDayMenuOpen(null);
        setDayMenuAnchorRect(null);
      }
    }
    function onViewportChange() {
      setDayMenuOpen(null);
      setDayMenuAnchorRect(null);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [dayMenuOpen]);

  useDismissible(txCategoryMenuOpen, () => setTxCategoryMenuOpen(false), "[data-tx-category]");
  useDismissible(vacationTypeMenuOpen, () => setVacationTypeMenuOpen(false), "[data-vacation-type-menu]");

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("-"));
  }, []);

  useEffect(() => {
    if (!settingsModalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSettingsModalOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsModalOpen]);

  useEffect(() => {
    if (!trendsModalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setTrendsModalOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [trendsModalOpen]);

  useEffect(() => {
    if (trendsModalOpen) return;
    setTrendsCategoryQuery("");
    setTrendsIncomeCategoryQuery("");
  }, [trendsModalOpen]);

  usePiggyBankHotkeys({
    open: piggyBankModalOpen,
    onClose: closePiggyBankModal,
    onSubmit: () => { void submitPiggyBankModal(); },
  });

  useEffect(() => {
    if (!data) return;
    if ((data.piggyBankAmount ?? 0) > 0) return;
    const raw = localStorage.getItem(LEGACY_PIGGY_BANK_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    api.setPiggyBankAmount(parsed)
      .then((updated) => {
        setData(updated);
        localStorage.removeItem(LEGACY_PIGGY_BANK_STORAGE_KEY);
      })
      .catch(() => {
        // Keep legacy value untouched if migration fails.
      });
  }, [data]);

  function openDayMenu(date: string, anchor: HTMLElement) {
    const menuWidth = 220;
    const pad = 8;
    const gap = 6;
    const rect = anchor.getBoundingClientRect();
    let left = rect.right - menuWidth;
    const top = rect.bottom + gap;

    if (left + menuWidth > window.innerWidth - pad) left = window.innerWidth - menuWidth - pad;
    if (left < pad) left = pad;

    setDayMenuPos({ left, top });
    setDayMenuAnchorRect({ top: rect.top, bottom: rect.bottom });
    setDayMenuOpen((cur) => (cur === date ? null : date));
  }

  useEffect(() => {
    if (!dayMenuOpen) return;
    const el = dayMenuRef.current;
    if (!el) return;
    if (!dayMenuAnchorRect) return;

    const pad = 8;
    const gap = 6;
    const rect = el.getBoundingClientRect();
    const menuHeight = rect.height;
    const canPlaceBelow = dayMenuAnchorRect.bottom + gap + menuHeight <= window.innerHeight - pad;
    const canPlaceAbove = dayMenuAnchorRect.top - gap - menuHeight >= pad;
    let nextTop = dayMenuAnchorRect.bottom + gap;

    if (canPlaceBelow) {
      nextTop = dayMenuAnchorRect.bottom + gap;
    } else if (canPlaceAbove) {
      nextTop = dayMenuAnchorRect.top - gap - menuHeight;
    } else {
      // fallback if viewport too tight: keep in-bounds without jumping
      nextTop = Math.max(pad, Math.min(dayMenuAnchorRect.bottom + gap, window.innerHeight - pad - menuHeight));
    }

    if (Math.abs(nextTop - dayMenuPos.top) > 0.5) {
      setDayMenuPos((prev) => ({ ...prev, top: nextTop }));
    }
  }, [dayMenuOpen, dayMenuPos.top, dayMenuAnchorRect]);

  async function handleToggleWorkingDay(params: {
    date: string;
    effectiveWorking: boolean;
    defaultWorking: boolean;
    offForDay: OffDay | null;
  }) {
    const { date, effectiveWorking, defaultWorking, offForDay } = params;

    try {
      const makeWorking = !effectiveWorking;
      if (workSchedule === "custom") {
        const updated = await api.upsertOffDay({
          id: offForDay?.id ?? "",
          date,
          note: offForDay?.note ?? "",
          is_working: makeWorking,
        });
        setData(updated);
      } else if (makeWorking !== defaultWorking) {
        const updated = await api.upsertOffDay({
          id: offForDay?.id ?? "",
          date,
          note: offForDay?.note ?? "",
          is_working: makeWorking,
        });
        setData(updated);
      } else if (offForDay) {
        const updated = await api.deleteOffDay(offForDay.id);
        setData(updated);
      }
    } catch (err) {
      console.error("day menu update failed", err);
      alert(String(err));
    }
  }

  const expenseCategories = useMemo(() => {
    const fromData = data?.settings?.txCategories ?? [];
    return fromData.length > 0
      ? fromData
      : ["Groceries", "Fuel"];
  }, [data]);

  const savedIncomeCategories = useMemo(() => {
    const defaults = data?.settings?.incomeCategories ?? [
      "Salary",
      "Advance",
      "Side job",
      "Cashback",
    ];
    return Array.from(new Set(defaults.map((c) => normalizeCategoryInput(c)).filter((c) => c.length > 0)));
  }, [data]);

  const incomeCategories = useMemo(() => {
    const fromTx = (data?.transactions ?? [])
      .filter((t) => t.type === "income")
      .map((t) => normalizeCategoryInput(t.category))
      .filter((c) => c.length > 0);
    const fromSalaryTitles = allSalaryEvents
      .map((s) => normalizeCategoryInput(s.title))
      .filter((c) => c.length > 0);

    return Array.from(new Set([...savedIncomeCategories, ...fromTx, ...fromSalaryTitles]));
  }, [allSalaryEvents, data, savedIncomeCategories]);

  useEffect(() => {
    if (!settingsModalOpen) return;
    setExpenseCategoryDraft("");
    setIncomeCategoryDraft("");
    setSalaryConfigDraft(createEmptySalaryConfigDraft(today));
    setSalaryConfigEditId(null);
  }, [settingsModalOpen, today]);

  const expenseCategoriesWithDebt = useMemo(() => {
    const debtCategory = "Debt";
    if (expenseCategories.some((c) => normalizeCategoryInput(c).toLowerCase() === normalizeCategoryInput(debtCategory).toLowerCase())) {
      return expenseCategories;
    }
    return [...expenseCategories, debtCategory];
  }, [expenseCategories]);

  const activeTxCategories = txModalType === "income" ? incomeCategories : expenseCategoriesWithDebt;
  const editTxOriginal = useMemo(
    () => (data?.transactions ?? []).find((t) => t.id === editTxModalId) ?? null,
    [data?.transactions, editTxModalId]
  );
  const editTxCategoryOptions = useMemo(() => {
    if (!editTxOriginal) return [] as string[];
    const base = editTxOriginal.type === "income" ? incomeCategories : expenseCategoriesWithDebt;
    const current = normalizeCategoryInput(editTxModalCategory);
    if (!current) return base;
    return base.includes(current) ? base : [current, ...base];
  }, [editTxOriginal, incomeCategories, expenseCategoriesWithDebt, editTxModalCategory]);

  const txCategoryOptions = useMemo(() => {
    const q = txModalCategory.trim().toLowerCase();
    if (!q) return activeTxCategories;
    return activeTxCategories.filter((c) => c.toLowerCase().includes(q));
  }, [activeTxCategories, txModalCategory]);

  const debts = useMemo(() => {
    return [...(data?.debts ?? [])].sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return a.person.localeCompare(b.person, locale);
    });
  }, [data?.debts, locale]);
  const totalDebt = useMemo(() => debts.reduce((sum, debt) => sum + debt.amount, 0), [debts]);
  const hasDebts = totalDebt > 0;

  const debtPeople = useMemo(() => {
    return Array.from(new Set(debts.map((d) => normalizeCategoryInput(d.person)).filter((p) => p.length > 0)));
  }, [debts]);
  const vacationModalRange = useMemo(() => {
    const start = vacationModalStart <= vacationModalEnd ? vacationModalStart : vacationModalEnd;
    const end = vacationModalStart <= vacationModalEnd ? vacationModalEnd : vacationModalStart;
    const days = getVacationChargeableDays(start, end, productionCalendarDays);
    return { start, end, days };
  }, [productionCalendarDays, vacationModalEnd, vacationModalStart]);
  const vacationModalPayoutAmount = useMemo(() => {
    if (!viewData || vacationModalType === "unpaid") return 0;
    return calculateVacationPayout({
      salaryEvents: viewData.salaryEvents ?? [],
      vacations: viewData.vacations ?? [],
      vacationStartDate: vacationModalRange.start,
      vacationEndDate: vacationModalRange.end,
      vacationType: vacationModalType,
      productionCalendarDays,
    });
  }, [productionCalendarDays, vacationModalRange.end, vacationModalRange.start, vacationModalType, viewData]);

  function txModalTitle(type: "income" | "expense" | "planned_expense") {
    if (type === "income") return "Add income";
    if (type === "planned_expense") return "Add planned expense";
    return "Add expense";
  }

  function openTxModal(type: "income" | "expense" | "planned_expense", date: string) {
    setTxModalType(type);
    setTxModalDate(date);
    setTxModalAmount("");
    setTxModalCategory("");
    setTxModalDebtPerson("");
    setTxCategoryMenuOpen(false);
    setTxModalOpen(true);
  }

  function closeTxModal() {
    setTxModalOpen(false);
    setTxModalAmount("");
    setTxModalCategory("");
    setTxModalDebtPerson("");
    setTxCategoryMenuOpen(false);
  }

  async function submitTxModal() {
    const category = normalizeCategoryInput(txModalCategory);
    const debtPerson = normalizeCategoryInput(txModalDebtPerson);
    const shouldUseDebtPerson = txModalType === "expense" && isDebtCategory(category);
    if (!txModalAmount.trim()) return;
    if (!category) return;
    if (shouldUseDebtPerson && !debtPerson) return;

    try {
      const amount = toKop(txModalAmount);
      if (amount <= 0) return;

      const tx: Transaction = {
        id: "",
        date: txModalDate,
        type: txModalType,
        amount,
        category,
        note: "",
        debt_person: shouldUseDebtPerson ? debtPerson : null,
      };

      const canMergeByCategory = tx.type === "income" || tx.type === "expense";
      const categoryKey = normalizeCategoryInput(tx.category).toLowerCase();
      const debtPersonKey = normalizeCategoryInput(tx.debt_person ?? "").toLowerCase();

      const existingTx = canMergeByCategory
        ? (data?.transactions ?? []).find((existing) => {
            if (existing.date !== tx.date || existing.type !== tx.type) return false;
            if (normalizeCategoryInput(existing.category).toLowerCase() !== categoryKey) return false;
            if (shouldUseDebtPerson) {
              return normalizeCategoryInput(existing.debt_person ?? "").toLowerCase() === debtPersonKey;
            }
            return true;
          })
        : null;

      if (existingTx) {
        const updated = await api.updateTransaction({
          ...existingTx,
          amount: existingTx.amount + tx.amount,
        });
        setData(updated);
        closeTxModal();
        return;
      }

      const updated = await api.addTransaction(tx);
      setData(updated);
      closeTxModal();
    } catch (err) {
      alert(String(err));
    }
  }

  function formatDebtAmountInput(amountKop: number) {
    const value = amountKop / 100;
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  function openDebtModal(debt?: Debt) {
    if (debt) {
      setDebtModalEditId(debt.id);
      setDebtModalAmount(formatDebtAmountInput(debt.amount));
      setDebtModalPerson(debt.person);
    } else {
      setDebtModalEditId(null);
      setDebtModalAmount("");
      setDebtModalPerson("");
    }
    setDebtModalOpen(true);
  }

  function closeDebtModal() {
    setDebtModalEditId(null);
    setDebtModalAmount("");
    setDebtModalPerson("");
    setDebtModalOpen(false);
  }

  async function submitDebtModal() {
    const amount = toKop(debtModalAmount);
    const person = normalizeCategoryInput(debtModalPerson);
    if (amount <= 0) return;
    if (!person) return;

    try {
      const updated = await api.upsertDebt({
        id: debtModalEditId ?? "",
        person,
        amount,
      });
      setData(updated);
      closeDebtModal();
    } catch (err) {
      alert(String(err));
    }
  }

  async function beginAddSalary() {
    if (isPickingCustomWorkDays) {
      await saveCustomSchedule();
    }
    setIsPickingSalaryDate(true);
    setVacationModalOpen(false);
    setVacationTypeMenuOpen(false);
    setIsPickingCustomWorkDays(false);
    setSalaryModalOpen(false);
    setDayMenuOpen(null);
    setDayMenuAnchorRect(null);
  }

  function openSalaryModal(date: string) {
    setSalaryModalDate(date);
    setSalaryModalAmount("");
    setSalaryModalTitle("Salary");
    setSalaryModalKind("regular");
    setSalaryModalAccrualMonth(inferSalaryEventAccrualMonth(date) ?? "");
    setSalaryModalCheckResult(null);
    setSalaryModalOpen(true);
  }

  function closeSalaryModal() {
    setSalaryModalOpen(false);
    setSalaryModalAmount("");
    setSalaryModalTitle("Salary");
    setSalaryModalKind("regular");
    setSalaryModalAccrualMonth("");
    setSalaryModalCheckResult(null);
  }

  function handleCheckSalaryModal() {
    const monthlySalaryAmount = toKop(salaryModalAmount);
    if (monthlySalaryAmount <= 0) {
      setSalaryModalCheckResult(null);
      return;
    }

    setSalaryModalCheckResult(
      estimateManualSalaryForDate({
        enteredAmount: monthlySalaryAmount,
        payoutDate: salaryModalDate,
        accrualMonth:
          normalizeSalaryEventAccrualMonth(salaryModalAccrualMonth)
          ?? inferSalaryEventAccrualMonth(salaryModalDate)
          ?? salaryModalDate.slice(0, 7),
        title: salaryModalTitle.trim() || "Salary",
        salaryEvents: allSalaryEvents,
        vacations: data?.vacations ?? [],
        workSchedule,
        offDays: data?.offDays ?? [],
        productionCalendarDays,
      })
    );
  }

  function applyCheckedSalaryAmount() {
    if (!salaryModalCheckResult) return;

    const rubles = (salaryModalCheckResult.amount / 100)
      .toFixed(2)
      .replace(/\.00$/, "")
      .replace(/(\.\d*[1-9])0$/, "$1");
    setSalaryModalAmount(rubles);
  }

  function handleCalendarDayTileClick(date: string) {
    setSelectedDate(date);

    if (isPickingCustomWorkDays) {
      toggleCustomWorkingDay(date);
      return;
    }

    if (isPickingSalaryDate) {
      setIsPickingSalaryDate(false);
      openSalaryModal(date);
    }
  }

  async function handleMarkPlannedTransactionPaid(tx: Transaction) {
    const updated = await api.updateTransaction({
      ...tx,
      type: "expense",
    });
    setData(updated);
  }

  async function handleEditTransaction(t: Transaction) {
    setEditTxModalId(t.id);
    setEditTxModalDate(t.date);
    setEditTxModalAmount(String(t.amount / 100));
    setEditTxModalCategory(t.category);
    setEditTxModalNote(t.note ?? "");
    setEditTxModalOpen(true);
  }

  async function handleDeleteTransaction(id: string) {
    if (!(await confirmAction())) return;
    const updated = await api.deleteTransaction(id);
    setData(updated);
  }

  function closeEditTxModal() {
    setEditTxModalOpen(false);
    setEditTxModalId(null);
    setEditTxModalDate(today);
    setEditTxModalAmount("");
    setEditTxModalCategory("");
    setEditTxModalNote("");
  }

  async function submitEditTxModal() {
    if (!data || !editTxModalId) return;

    const original = (data.transactions ?? []).find((t) => t.id === editTxModalId);
    if (!original) return;

    const amount = toKop(editTxModalAmount);
    if (amount <= 0) return;

    try {
      const updated = await api.updateTransaction({
        ...original,
        date: editTxModalDate,
        amount,
        category: editTxModalCategory,
        note: editTxModalNote,
      });
      setData(updated);
      closeEditTxModal();
    } catch (err) {
      alert(String(err));
    }
  }

  function openPiggyBankModal(type: "add" | "withdraw") {
    setPiggyBankModalType(type);
    setPiggyBankModalAmount("");
    setPiggyBankModalOpen(true);
  }

  function closePiggyBankModal() {
    setPiggyBankModalOpen(false);
    setPiggyBankModalAmount("");
  }

  async function submitPiggyBankModal() {
    if (!data) return;
    const amount = toKop(piggyBankModalAmount);
    if (amount <= 0) return;

    const current = Math.max(0, data.piggyBankAmount ?? 0);

    if (piggyBankModalType === "add") {
      try {
        const updated = await api.setPiggyBankAmount(current + amount);
        setData(updated);
        closePiggyBankModal();
      } catch (err) {
        alert(String(err));
      }
      return;
    }

    if (amount > current) {
      alert("Not enough money in piggy bank.");
      return;
    }

    try {
      const updated = await api.setPiggyBankAmount(current - amount);
      setData(updated);
      closePiggyBankModal();
    } catch (err) {
      alert(String(err));
    }
  }

  async function withdrawAllFromPiggyBank() {
    if (!data) return;
    const current = Math.max(0, data.piggyBankAmount ?? 0);
    if (current <= 0) return;

    try {
      const updated = await api.setPiggyBankAmount(0);
      setData(updated);
      closePiggyBankModal();
    } catch (err) {
      alert(String(err));
    }
  }

  async function submitSalaryModal() {
    const amount = toKop(salaryModalAmount);
    const title = salaryModalTitle.trim() || "Salary";
    if (amount <= 0) return;

    try {
      const updated = await api.upsertSalaryEvent({
        id: "",
        date: salaryModalDate,
        amount,
        title,
        kind: salaryModalKind,
        accrualMonth: normalizeSalaryEventAccrualMonth(salaryModalAccrualMonth),
      });

      setData(updated);
      closeSalaryModal();
    } catch (err) {
      alert(String(err));
    }
  }

  async function beginAddVacation(vacationType: VacationType) {
    if (isPickingCustomWorkDays) {
      await saveCustomSchedule();
    }
    setIsPickingSalaryDate(false);
    setSalaryModalOpen(false);
    setVacationTypeMenuOpen(false);
    setIsPickingCustomWorkDays(false);
    setDayMenuOpen(null);
    setDayMenuAnchorRect(null);
    setVacationModalEditId(null);
    setVacationModalType(vacationType);
    setVacationModalStart(selectedDate);
    setVacationModalEnd(selectedDate);
    setVacationModalTitle("Vacation");
    setVacationModalOpen(true);
  }

  function closeVacationModal() {
    setVacationModalEditId(null);
    setVacationModalOpen(false);
    setVacationModalStart(today);
    setVacationModalEnd(today);
    setVacationModalTitle("Vacation");
    setVacationModalType("paid");
  }

  async function submitVacationModal() {
    const startDate = vacationModalStart <= vacationModalEnd ? vacationModalStart : vacationModalEnd;
    const endDate = vacationModalStart <= vacationModalEnd ? vacationModalEnd : vacationModalStart;
    const title = vacationModalTitle.trim() || "Vacation";

    try {
      const updated = await api.upsertVacation({
        id: vacationModalEditId ?? "",
        start_date: startDate,
        end_date: endDate,
        title,
        vacation_type: vacationModalType,
      });
      setData(updated);
      closeVacationModal();
    } catch (e) {
      alert(String(e));
    }
  }

  function beginCustomSchedulePick() {
    // In edit mode we start from a neutral calendar: user marks working days explicitly.
    setCustomWorkingDays([]);
    setIsPickingCustomWorkDays(true);
    setIsPickingSalaryDate(false);
    setVacationTypeMenuOpen(false);
    setDayMenuOpen(null);
    setDayMenuAnchorRect(null);
  }

  function cancelCustomSchedulePick() {
    setIsPickingCustomWorkDays(false);
    setCustomWorkingDays([]);
  }

  function toggleCustomWorkingDay(date: string) {
    setCustomWorkingDays((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]
    );
  }

  async function persistWorkSchedule(isWorkingByDate: (date: string) => boolean) {
    let latest = await api.getData();

    for (const date of monthDays) {
      const existing = (latest.offDays ?? []).find((o) => o.date === date) ?? null;
      latest = await api.upsertOffDay({
        id: existing?.id ?? "",
        date,
        note: existing?.note ?? "",
        is_working: isWorkingByDate(date),
      });
    }

    const reloaded = await api.getData();
    setData(reloaded);
  }

  async function saveCustomSchedule() {
    const selected = new Set(customWorkingDays);

    try {
      await persistWorkSchedule((date) => selected.has(date));
      setIsPickingCustomWorkDays(false);
      setCustomWorkingDays([]);
    } catch (err) {
      alert(String(err));
    }
  }

  async function saveFiveTwoSchedule() {
    await persistWorkSchedule((date) => {
      const dayOfWeek = new Date(date).getDay(); // 0 = Sunday, 6 = Saturday
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      return !isWeekend;
    });
  }

  async function persistUserPreferences(
    nextWorkSchedule: "5/2" | "custom",
    nextSaveRemainingDailyLimitToPiggyBank: boolean,
    nextLastDailyLimitCarryoverDate: string = lastDailyLimitCarryoverDate,
  ) {
    const updated = await api.setUserPreferences(
      nextWorkSchedule,
      nextSaveRemainingDailyLimitToPiggyBank,
      nextLastDailyLimitCarryoverDate,
    );
    setData(updated);
    return updated;
  }

  async function handleWorkScheduleChange(next: "5/2" | "custom") {
    try {
      if (next === "5/2") {
        await saveFiveTwoSchedule();
      }
      await persistUserPreferences(
        next,
        saveRemainingDailyLimitToPiggyBank,
        saveRemainingDailyLimitToPiggyBank ? (lastDailyLimitCarryoverDate || today) : lastDailyLimitCarryoverDate,
      );
      setWorkSchedule(next);
      if (next === "custom") {
        closeSettingsModal();
        beginCustomSchedulePick();
      } else {
        cancelCustomSchedulePick();
      }
    } catch (err) {
      alert(String(err));
    }
  }

  async function handleSaveRemainingDailyLimitToPiggyBankChange(checked: boolean) {
    try {
      await persistUserPreferences(workSchedule, checked, today);
    } catch (err) {
      alert(String(err));
    }
  }

  async function handleDateFormatChange(next: DateFormat) {
    try {
      const updated = await api.setDateFormat(next);
      setData(updated);
    } catch (err) {
      alert(String(err));
    }
  }

  function beginEditSalaryConfig(config: SalaryConfig) {
    setSalaryConfigDraft({
      id: config.id,
      effectiveFrom: config.effectiveFrom,
      amount: String(config.amount / 100),
      advancePercent: String(config.advancePercent),
      advanceDay: String(config.advanceDay),
      salaryDay: String(config.salaryDay),
    });
    setSalaryConfigEditId(config.id);
  }

  function resetSalaryConfigDraft() {
    setSalaryConfigDraft(createEmptySalaryConfigDraft(today));
    setSalaryConfigEditId(null);
  }

  async function saveSalaryConfig() {
    const amount = Math.max(0, toKop(salaryConfigDraft.amount));
    const effectiveFrom = salaryConfigDraft.effectiveFrom;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      alert("Pick the date from which the salary starts.");
      return;
    }

    if (amount <= 0) {
      alert("Enter the monthly salary amount.");
      return;
    }

    const advancePercent = Math.min(100, Math.max(0, Number.parseInt(salaryConfigDraft.advancePercent || "0", 10)));
    const advanceDay = Math.min(31, Math.max(1, Number.parseInt(salaryConfigDraft.advanceDay || "1", 10)));
    const salaryDay = Math.min(31, Math.max(1, Number.parseInt(salaryConfigDraft.salaryDay || "1", 10)));

    const nextConfig: SalaryConfig = {
      ...salaryConfigDraft,
      id: salaryConfigEditId ?? salaryConfigDraft.id,
      amount,
      advancePercent,
      advanceDay,
      salaryDay,
    };

    const nextConfigs = salaryConfigEditId
      ? salaryConfigs.map((config) => (config.id === salaryConfigEditId ? nextConfig : config))
      : [...salaryConfigs, { ...nextConfig, id: "" }];

    try {
      const updated = await api.setSalaryConfigs(nextConfigs);
      setData(updated);
      resetSalaryConfigDraft();
    } catch (err) {
      alert(String(err));
    }
  }

  async function handleDeleteSalaryConfig(id: string) {
    try {
      const updated = await api.setSalaryConfigs(salaryConfigs.filter((config) => config.id !== id));
      setData(updated);
      if (salaryConfigEditId === id) {
        resetSalaryConfigDraft();
      }
    } catch (err) {
      alert(String(err));
    }
  }

  async function exportBackupFile() {
    try {
      const ts = ymd(new Date());
      const dir = await open({
        directory: true,
        multiple: false,
        title: "Select backup folder",
      });
      if (!dir || Array.isArray(dir)) return;
      const savedPath = await api.saveBackupToDir(String(dir), `sadmoney-backup-${ts}.json`);
      alert(`${"Backup saved"}: ${savedPath}`);
    } catch (err) {
      alert(String(err));
    }
  }

  async function importBackupFile() {
    try {
      const path = await open({
        directory: false,
        multiple: false,
        title: "Select backup file",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path || Array.isArray(path)) return;
      const updated = await api.importBackupFromPath(String(path));
      setData(updated);
      alert("Backup imported");
    } catch (err) {
      alert(`${"Failed to import backup"}: ${String(err)}`);
    }
  }

  async function checkForUpdates() {
    if (isCheckingUpdates) return;

    setIsCheckingUpdates(true);
    try {
      const update = await check();
      if (!update) {
        alert("No updates found");
        return;
      }

      await update.downloadAndInstall();
      const shouldRelaunch = window.confirm("Update downloaded. Restart to apply it?");
      if (shouldRelaunch) {
        await relaunch();
      }
    } catch (err) {
      alert(`${"Failed to check updates"}: ${String(err)}`);
    } finally {
      setIsCheckingUpdates(false);
    }
  }

  function openSettingsModal() {
    setSettingsTab("general");
    setExpenseCategoryDraft("");
    setIncomeCategoryDraft("");
    setSettingsModalOpen(true);
  }

  function closeSettingsModal() {
    setSettingsModalOpen(false);
  }

  async function saveCategories(nextExpense: string[], nextIncome: string[]) {
    try {
      const updated = await api.setTxCategories(nextExpense, nextIncome);
      setData(updated);
    } catch (err) {
      alert(String(err));
    }
  }

  async function addExpenseCategory() {
    const value = normalizeCategoryInput(expenseCategoryDraft);
    if (!value) return;
    if (expenseCategories.some((c) => normalizeCategoryInput(c).toLowerCase() === value.toLowerCase())) {
      setExpenseCategoryDraft("");
      return;
    }
    await saveCategories([...expenseCategories, value], savedIncomeCategories);
    setExpenseCategoryDraft("");
  }

  async function addIncomeCategory() {
    const value = normalizeCategoryInput(incomeCategoryDraft);
    if (!value) return;
    if (savedIncomeCategories.some((c) => normalizeCategoryInput(c).toLowerCase() === value.toLowerCase())) {
      setIncomeCategoryDraft("");
      return;
    }
    await saveCategories(expenseCategories, [...savedIncomeCategories, value]);
    setIncomeCategoryDraft("");
  }

  async function removeExpenseCategory(category: string) {
    const next = expenseCategories.filter((c) => normalizeCategoryInput(c).toLowerCase() !== normalizeCategoryInput(category).toLowerCase());
    await saveCategories(next, savedIncomeCategories);
  }

  async function removeIncomeCategory(category: string) {
    const next = savedIncomeCategories.filter((c) => normalizeCategoryInput(c).toLowerCase() !== normalizeCategoryInput(category).toLowerCase());
    await saveCategories(expenseCategories, next);
  }

  function focusMonth(targetYear: number, targetMonth0: number) {
    setYear(targetYear);
    setMonth0(targetMonth0);

    const todayDate = parseYmdLocal(today);
    const isCurrentMonth = todayDate.getFullYear() === targetYear && todayDate.getMonth() === targetMonth0;

    if (isCurrentMonth) {
      setSelectedDate(today);
      return;
    }

    setSelectedDate(ymd(new Date(targetYear, targetMonth0, 1)));
  }

  function prevMonth() {
    const d = new Date(year, month0, 1);
    d.setMonth(d.getMonth() - 1);
    focusMonth(d.getFullYear(), d.getMonth());
  }

  function nextMonth() {
    const d = new Date(year, month0, 1);
    d.setMonth(d.getMonth() + 1);
    focusMonth(d.getFullYear(), d.getMonth());
  }

  async function handleEditVacation(v: Vacation) {
    setVacationModalEditId(v.id);
    setVacationModalStart(v.start_date);
    setVacationModalEnd(v.end_date);
    setVacationModalTitle(v.title);
    setVacationModalType(normalizeVacationType(v.vacation_type));
    setVacationModalOpen(true);
  }

  async function handleDeleteVacation(id: string) {
    if (!(await confirmAction())) return;
    const updated = await api.deleteVacation(id);
    setData(updated);
  }

  async function handleEditSalary(s: SalaryEvent) {
    setEditSalaryModalId(s.id);
    setEditSalaryModalDate(s.date);
    setEditSalaryModalAmount(String(s.amount / 100));
    setEditSalaryModalTitle(s.title);
    setEditSalaryModalKind(normalizeSalaryEventKind(s.kind));
    setEditSalaryModalAccrualMonth(
      normalizeSalaryEventAccrualMonth(s.accrualMonth) ?? inferSalaryEventAccrualMonth(s.date) ?? "",
    );
    setEditSalaryModalCheckResult(null);
    setEditSalaryModalOpen(true);
  }

  async function handleDeleteSalary(id: string) {
    if (!(await confirmAction())) return;
    const updated = await api.deleteSalaryEvent(id);
    setData(updated);
  }

  function closeEditSalaryModal() {
    setEditSalaryModalOpen(false);
    setEditSalaryModalId(null);
    setEditSalaryModalDate(today);
    setEditSalaryModalAmount("");
    setEditSalaryModalTitle("Salary");
    setEditSalaryModalKind("regular");
    setEditSalaryModalAccrualMonth("");
    setEditSalaryModalCheckResult(null);
  }

  function handleCheckEditSalaryModal() {
    if (!editSalaryModalId) return;

    const monthlySalaryAmount = toKop(editSalaryModalAmount);
    if (monthlySalaryAmount <= 0) {
      setEditSalaryModalCheckResult(null);
      return;
    }

    setEditSalaryModalCheckResult(
      estimateManualSalaryForDate({
        enteredAmount: monthlySalaryAmount,
        payoutDate: editSalaryModalDate,
        accrualMonth:
          normalizeSalaryEventAccrualMonth(editSalaryModalAccrualMonth)
          ?? inferSalaryEventAccrualMonth(editSalaryModalDate)
          ?? editSalaryModalDate.slice(0, 7),
        title: editSalaryModalTitle.trim() || "Salary",
        salaryEvents: allSalaryEvents,
        excludedSalaryEventIds: [editSalaryModalId],
        vacations: data?.vacations ?? [],
        workSchedule,
        offDays: data?.offDays ?? [],
        productionCalendarDays,
      })
    );
  }

  function applyCheckedEditSalaryAmount() {
    if (!editSalaryModalCheckResult) return;

    const rubles = (editSalaryModalCheckResult.amount / 100)
      .toFixed(2)
      .replace(/\.00$/, "")
      .replace(/(\.\d*[1-9])0$/, "$1");
    setEditSalaryModalAmount(rubles);
  }

  async function submitEditSalaryModal() {
    if (!editSalaryModalId) return;
    const amount = toKop(editSalaryModalAmount);
    const title = editSalaryModalTitle.trim() || "Salary";
    if (amount <= 0) return;

    try {
      const updated = await api.upsertSalaryEvent({
        id: editSalaryModalId,
        date: editSalaryModalDate,
        amount,
        title,
        kind: editSalaryModalKind,
        accrualMonth: normalizeSalaryEventAccrualMonth(editSalaryModalAccrualMonth),
      });
      setData(updated);
      closeEditSalaryModal();
    } catch (err) {
      alert(String(err));
    }
  }

  const topbarControlStyle = {
    minHeight: 40,
    padding: "0 12px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box" as const,
  };

  const filteredTrendCategories = useMemo(() => {
    const q = trendsCategoryQuery.trim().toLowerCase();
    if (!q) return trendsData.categoryComparison;
    return trendsData.categoryComparison.filter((item) => item.category.toLowerCase().includes(q));
  }, [trendsCategoryQuery, trendsData.categoryComparison]);
  const filteredIncomeTrendCategories = useMemo(() => {
    const q = trendsIncomeCategoryQuery.trim().toLowerCase();
    if (!q) return trendsData.incomeCategoryComparison;
    return trendsData.incomeCategoryComparison.filter((item) => item.category.toLowerCase().includes(q));
  }, [trendsIncomeCategoryQuery, trendsData.incomeCategoryComparison]);

  return (


    <div
      className="app-shell"
      style={{
        height: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: 12,
        boxSizing: "border-box",
              }}
    >
      <div className="topbar topbar-layout" style={{ marginBottom: 12, zIndex: 3000 }}>
        <div className="topbar-main-row">
          <div className="topbar-nav-group">
            <button onClick={prevMonth} style={topbarControlStyle} aria-label="Previous month">
              <AppIcon name="chevronLeft" />
            </button>
            <h2 className="summary-title">
              {capitalizeFirst(new Date(year, month0, 1).toLocaleString(locale, { month: "long", year: "numeric" }))}
            </h2>
            <button onClick={nextMonth} style={topbarControlStyle} aria-label="Next month">
              <AppIcon name="chevronRight" />
            </button>
            <button
              onClick={() => {
                focusOnDate(today);
              }}
              style={topbarControlStyle}
            >
              {"Go to today"}
            </button>
            <div className="topbar-workdays-chip">
              <span className="topbar-workdays-label">{"Work days"}</span>
              <span className="topbar-workdays-value">{workDaysInMonth}</span>
            </div>
          </div>

          <div className="topbar-action-group">
            {isPickingCustomWorkDays ? (
              <div className="topbar-inline-notice">
                <div style={{ fontSize: 12, opacity: 0.8, whiteSpace: "nowrap" }}>
                  {"Mark working days in the calendar"}
                </div>
                <button onClick={cancelCustomSchedulePick} style={topbarControlStyle}>{"Cancel"}</button>
                <button onClick={saveCustomSchedule} style={topbarControlStyle}>{"Save"}</button>
              </div>
            ) : null}

            <button onClick={() => openPiggyBankModal("add")} className="topbar-action-button">
              <AppIcon name="piggyBank" />
              <span className="topbar-action-copy">
                <span>{"Piggy bank"}</span>
                <span className="topbar-action-meta">{rub(piggyBankAmount)}</span>
              </span>
            </button>

            <button
              onClick={() => setDebtsPanelOpen(true)}
              className={hasDebts ? "topbar-action-button topbar-action-button-danger" : "topbar-action-button"}
            >
              <AppIcon name="wallet" />
              <span className="topbar-action-copy">
                <span>{"Debts"}</span>
                <span className="topbar-action-meta">{hasDebts ? rub(totalDebt) : "No debts"}</span>
              </span>
            </button>

            <button onClick={() => setVacationsPanelOpen(true)} className="topbar-action-button">
              <AppIcon name="beach" />
              <span className="topbar-action-copy">
                <span>{"Vacations"}</span>
                <span className="topbar-action-meta">
                  {vacationsThisMonth.length > 0 ? `${vacationsThisMonth.length} this month` : `${vacationDaysLeft} days left`}
                </span>
              </span>
            </button>

            <button onClick={() => setTrendsModalOpen(true)} className="topbar-action-button">
              <AppIcon name="chart" />
              <span className="topbar-action-copy">
                <span>{"Trends"}</span>
                <span className="topbar-action-meta">{"Month comparison"}</span>
              </span>
            </button>

            <button
              aria-label="Settings"
              onClick={openSettingsModal}
              style={{ width: 40, height: 40, display: "grid", placeItems: "center", boxSizing: "border-box" }}
            >
              <AppIcon name="settings" />
            </button>
          </div>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gridAutoRows: "1fr",
          gap: 12,
          marginBottom: 12,
          alignItems: "stretch",
        }}
      >
        <GeneralStatsSurface
          data={viewData}
          monthKey={monthKey}
          year={year}
          today={today}
          vacationAverageDailyPay={vacationAverageDailyPay}
          dateFormat={dateFormat}
        />
        <SalariesPanel
          salaries={salaryThisMonth}
          dateFormat={dateFormat}
          isPickingSalaryDate={isPickingSalaryDate}
          onCancelPickingSalary={() => setIsPickingSalaryDate(false)}
          onBeginAddSalary={beginAddSalary}
          onEditSalary={handleEditSalary}
          onDeleteSalary={handleDeleteSalary}
        />
      </div>
      <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "stretch",
            flexDirection: "row-reverse",
            flexWrap: "wrap",
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
        <div
          style={{
            flex: "0 0 320px",
            width: "100%",
            maxWidth: 320,
            minWidth: 320,
            height: "100%",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
        <div
          style={{
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "#fff",
            position: "relative",
            zIndex: 1,
            width: "100%",
            flex: "1 1 auto",
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
          }}
        >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div><b>{"Selected date:"}</b> {formatDateForDisplay(selectedDate, dateFormat)}</div>
          <div
            style={{
              fontSize: 12,
              padding: "2px 8px",
              borderRadius: 999,
              border: `1px solid ${selectedDateStatus.border}`,
              color: selectedDateStatus.color,
              background: selectedDateStatus.background,
            }}
          >
            {selectedDateStatus.label}
          </div>
        </div>
        <SelectedDateBudgetSummary
          budget={budget}
          availableForSpending={availableForSpending}
          dailySpendLimit={dailySpendLimitFromAvailable}
          today={today}
        />
        <SelectedDateTransactionsList
          selectedDate={selectedDate}
          dateFormat={dateFormat}
          salaryEventsForSelectedDate={salaryEventsForSelectedDate}
          plannedAfterExpensesForSelectedDate={plannedAfterExpensesForSelectedDate}
          afterVacationForSelectedDate={afterVacationForSelectedDate}
          transactionsForSelectedDate={transactionsForSelectedDate}
          onMarkPlannedAsPaid={(tx) => { void handleMarkPlannedTransactionPaid(tx); }}
          onEditTransaction={(tx) => { void handleEditTransaction(tx); }}
          onDeleteTransaction={(id) => { void handleDeleteTransaction(id); }}
        />
        </div>
        <TopCategoriesPanel categories={topCategoriesThisMonth} />


      </div>

      <CalendarSurface
        calendarWeeks={calendarWeeks}
        gridCells={gridCells}
        sumsByDate={sumsByDate}
        today={today}
        selectedDate={selectedDate}
        data={data}
        workSchedule={workSchedule}
        productionCalendarDays={productionCalendarDays}
        isPickingCustomWorkDays={isPickingCustomWorkDays}
        customWorkingDays={customWorkingDays}
        isCalendarPickerFocus={isCalendarPickerFocus}
        locale={locale}
        dayMenuOpen={dayMenuOpen}
        dayMenuPos={dayMenuPos}
        dayMenuRef={dayMenuRef}
        setDayMenuOpen={setDayMenuOpen}
        setDayMenuAnchorRect={setDayMenuAnchorRect}
        openDayMenu={openDayMenu}
        onDayTileClick={handleCalendarDayTileClick}
        onSelectDate={setSelectedDate}
        onOpenTx={openTxModal}
        onToggleWorkingDay={handleToggleWorkingDay}
      />
      </div>
      </div>

      {debtsPanelOpen ? (
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
            if (e.target === e.currentTarget) setDebtsPanelOpen(false);
          }}
        >
          <div
            className="modal-panel"
            style={{
              width: "min(720px, 100%)",
              maxHeight: "80vh",
              overflowY: "auto",
              padding: 12,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <button onClick={() => setDebtsPanelOpen(false)} aria-label={"Close"} className="icon-button">
                <AppIcon name="close" />
              </button>
            </div>
            <DebtsSurface
              debts={debts}
              onAddDebt={() => openDebtModal()}
              onEditDebt={(debt) => openDebtModal(debt)}
              onDeleteDebt={(debtId) => {
                void (async () => {
                  if (!(await confirmAction())) return;
                  const updated = await api.deleteDebt(debtId);
                  setData(updated);
                })();
              }}
            />
          </div>
        </div>
      ) : null}

      {vacationsPanelOpen ? (
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
            if (e.target === e.currentTarget) setVacationsPanelOpen(false);
          }}
        >
          <div
            className="modal-panel"
            style={{
              width: "min(560px, 100%)",
              maxHeight: "80vh",
              overflowY: "auto",
              padding: 18,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="vacations-manager-modal-head">
              <div>
                <b className="vacations-manager-modal-title">{"Vacation manager"}</b>
              </div>
              <button onClick={() => setVacationsPanelOpen(false)} aria-label={"Close"} className="icon-button vacations-manager-close">
                <AppIcon name="close" />
              </button>
            </div>
            <VacationsPanel
              vacations={vacationsInManagerRange}
              allVacations={viewData?.vacations ?? []}
              dateFormat={dateFormat}
              salaryEvents={allSalaryEvents}
              productionCalendarDays={productionCalendarDays}
              vacationDaysCount={vacationDaysCount}
              vacationDaysLeft={vacationDaysLeft}
              vacationTypeMenuOpen={vacationTypeMenuOpen}
              onVacationDaysCountChange={handleVacationDaysCountChange}
              onVacationDaysCountCommit={commitVacationDaysCount}
              onToggleVacationTypeMenu={() => setVacationTypeMenuOpen((v) => !v)}
              onSelectVacationType={beginAddVacation}
              onEditVacation={handleEditVacation}
              onDeleteVacation={handleDeleteVacation}
            />
          </div>
        </div>
      ) : null}

      {isCalendarPickerFocus ? (
        <div
          className="modal-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.56)",
            zIndex: 4000,
          }}
          onClick={async () => {
            setIsPickingSalaryDate(false);
            if (isPickingCustomWorkDays) {
              await saveCustomSchedule();
            } else {
              cancelCustomSchedulePick();
            }
          }}
        />
      ) : null}

      {trendsModalOpen ? (
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
            if (e.target === e.currentTarget) setTrendsModalOpen(false);
          }}
        >
          <div
            className="modal-panel"
            style={{
              width: "min(820px, 100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: 12,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <b style={{ fontSize: 14 }}>{"Trends"}</b>
              <button onClick={() => setTrendsModalOpen(false)} aria-label={"Close"} className="icon-button">
                <AppIcon name="close" />
              </button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
              <div className="surface" style={{ padding: 10 }}>
                <div style={{ marginBottom: 6, fontSize: 13 }}><b>{"Month comparison"}</b></div>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
                  {trendsData.currentLabel} {"vs"} {trendsData.previousLabel}
                </div>
                <div style={{ marginBottom: 4 }}><b>{"Income:"}</b> {rub(trendsData.currentIncome)} {" / "} {rub(trendsData.previousIncome)}</div>
                <div style={{ marginBottom: 4 }}><b>{"Expense:"}</b> {rub(trendsData.currentExpense)} {" / "} {rub(trendsData.previousExpense)}</div>
                <div>
                  <b>{"Net:"}</b> {rub(trendsData.currentIncome - trendsData.currentExpense)} {" / "} {rub(trendsData.previousIncome - trendsData.previousExpense)}
                </div>
              </div>

              <div className="surface" style={{ padding: 10 }}>
                <div style={{ marginBottom: 6, fontSize: 13 }}><b>{"Average check"}</b></div>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
                  {trendsData.currentLabel} {"vs"} {trendsData.previousLabel}
                </div>
                <div style={{ marginBottom: 4 }}><b>{"Current:"}</b> {rub(trendsData.currentAvgCheck)}</div>
                <div style={{ marginBottom: 4 }}><b>{"Previous:"}</b> {rub(trendsData.previousAvgCheck)}</div>
                <div>
                  <b>{"Delta:"}</b> {rub(trendsData.currentAvgCheck - trendsData.previousAvgCheck)}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
              <TrendsCategoryComparisonPanel
                title={"All expense categories"}
                currentLabel={trendsData.currentLabel}
                previousLabel={trendsData.previousLabel}
                items={filteredTrendCategories}
                hasAnyItems={trendsData.categoryComparison.length > 0}
                searchQuery={trendsCategoryQuery}
                onSearchQueryChange={setTrendsCategoryQuery}
                searchPlaceholder={"Search category"}
                emptyForPeriodMessage={"No expense categories for this period."}
                variant="expense"
              />

              <TrendsCategoryComparisonPanel
                title={"All income categories"}
                currentLabel={trendsData.currentLabel}
                previousLabel={trendsData.previousLabel}
                items={filteredIncomeTrendCategories}
                hasAnyItems={trendsData.incomeCategoryComparison.length > 0}
                searchQuery={trendsIncomeCategoryQuery}
                onSearchQueryChange={setTrendsIncomeCategoryQuery}
                searchPlaceholder={"Search income category"}
                emptyForPeriodMessage={"No income categories for this period."}
                variant="income"
              />
            </div>
          </div>
        </div>
      ) : null}

      {settingsModalOpen ? (
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
            if (e.target === e.currentTarget) closeSettingsModal();
          }}
        >
          <div
            className="modal-panel"
            style={{
              width: "min(760px, 100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: 12,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <b style={{ fontSize: 14 }}>{"Settings"}</b>
              <button onClick={closeSettingsModal} aria-label={"Close"} className="icon-button">
                <AppIcon name="close" />
              </button>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button
                onClick={() => setSettingsTab("general")}
                style={{ opacity: settingsTab === "general" ? 1 : 0.75 }}
              >
                {"General"}
              </button>
              <button
                onClick={() => setSettingsTab("preferences")}
                style={{ opacity: settingsTab === "preferences" ? 1 : 0.75 }}
              >
                {"User preferences"}
              </button>
              <button
                onClick={() => setSettingsTab("categories")}
                style={{ opacity: settingsTab === "categories" ? 1 : 0.75 }}
              >
                {"Categories"}
              </button>
            </div>

            {settingsTab === "general" ? (
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                <button onClick={() => { void exportBackupFile(); }}>
                  {"Export backup"}
                </button>
                <button onClick={() => { void importBackupFile(); }}>
                  {"Import backup"}
                </button>
                <button
                  onClick={() => { void checkForUpdates(); }}
                  disabled={isCheckingUpdates}
                >
                  {isCheckingUpdates ? "Checking updates..." : "Check for updates"}
                </button>
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                  {"Version"}: {appVersion}
                </div>
              </div>
            ) : settingsTab === "preferences" ? (
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                <div className="surface" style={{ padding: 10 }}>
                  <div style={{ fontSize: 13, marginBottom: 8 }}><b>{"Work schedule"}</b></div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      value={workSchedule}
                      onChange={(e) => {
                        void handleWorkScheduleChange(e.target.value as "5/2" | "custom");
                      }}
                    >
                      <option value="5/2">5/2</option>
                      <option value="custom">{"Custom"}</option>
                    </select>
                    {workSchedule === "custom" ? (
                      <button
                        onClick={() => {
                          closeSettingsModal();
                          beginCustomSchedulePick();
                        }}
                      >
                        {"Edit in calendar"}
                      </button>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                    {workSchedule === "custom"
                      ? "Custom mode uses the days you mark in the calendar."
                      : "5/2 marks weekdays as working days automatically."}
                  </div>
                </div>

                <div className="surface" style={{ padding: 10 }}>
                  <div style={{ fontSize: 13, marginBottom: 8 }}><b>{"Date format"}</b></div>
                  <select
                    value={dateFormat}
                    onChange={(e) => {
                      void handleDateFormatChange(e.target.value as DateFormat);
                    }}
                  >
                    <option value="dd-mm-yyyy">{"DD-MM-YYYY"}</option>
                    <option value="mm-dd-yyyy">{"MM-DD-YYYY"}</option>
                    <option value="yyyy-mm-dd">{"YYYY-MM-DD"}</option>
                  </select>
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                    {"Applies to all displayed dates. Internal storage stays in YYYY-MM-DD."}
                  </div>
                </div>

                <div className="surface" style={{ padding: 10 }}>
                  <div style={{ fontSize: 13, marginBottom: 8 }}><b>{"Fixed salary schedule"}</b></div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, opacity: 0.75 }}>{"Effective from"}</span>
                      <DateInputWithCalendar
                        value={salaryConfigDraft.effectiveFrom}
                        dateFormat={dateFormat}
                        onChange={(value) => setSalaryConfigDraft((draft) => ({ ...draft, effectiveFrom: value }))}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, opacity: 0.75 }}>{"Monthly salary"}</span>
                      <input
                        value={salaryConfigDraft.amount}
                        onChange={(e) => setSalaryConfigDraft((draft) => ({ ...draft, amount: e.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, opacity: 0.75 }}>{"Advance share, %"}</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={salaryConfigDraft.advancePercent}
                        onChange={(e) => setSalaryConfigDraft((draft) => ({ ...draft, advancePercent: e.target.value }))}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, opacity: 0.75 }}>{"Advance day"}</span>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={salaryConfigDraft.advanceDay}
                        onChange={(e) => setSalaryConfigDraft((draft) => ({ ...draft, advanceDay: e.target.value }))}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, opacity: 0.75 }}>{"Salary day"}</span>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={salaryConfigDraft.salaryDay}
                        onChange={(e) => setSalaryConfigDraft((draft) => ({ ...draft, salaryDay: e.target.value }))}
                      />
                    </label>
                  </div>

                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                    {`Split preview: ${salaryConfigDraft.advancePercent || "0"}/${Math.max(
                      0,
                      100 - (Number.parseInt(salaryConfigDraft.advancePercent || "0", 10) || 0)
                    )}. If a payout date lands on Saturday or Sunday, it moves to Friday.`}
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => { void saveSalaryConfig(); }}>
                      {salaryConfigEditId ? "Update salary schedule" : "Add salary schedule"}
                    </button>
                    {salaryConfigEditId ? (
                      <button onClick={resetSalaryConfigDraft}>
                        {"Cancel edit"}
                      </button>
                    ) : null}
                  </div>

                  <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                    {"Manual salary entries stay untouched and are added on top of this automatic schedule."}
                  </div>

                  {salaryConfigs.length > 0 ? (
                    <div className="panel-list" style={{ marginTop: 10 }}>
                      {salaryConfigs.map((config) => (
                        <div
                          className="panel-item"
                          key={config.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 10,
                            border: "1px solid #eee",
                            borderRadius: 10,
                            padding: "8px 10px",
                          }}
                        >
                          <div style={{ fontSize: 12 }}>
                            <div>
                              <b>{formatDateForDisplay(config.effectiveFrom, dateFormat)}</b>
                              {` • ${rub(config.amount)} • ${config.advancePercent}/${100 - config.advancePercent}`}
                            </div>
                            <div style={{ opacity: 0.75, marginTop: 2 }}>
                              {`Advance: ${config.advanceDay}, salary: ${config.salaryDay}`}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              className="edit-pencil-btn"
                              style={{ width: 26, minWidth: 26, minHeight: 26, borderRadius: 8 }}
                              onClick={() => beginEditSalaryConfig(config)}
                              aria-label="Edit fixed salary"
                              title="Edit fixed salary"
                            >
                              <AppIcon name="edit" />
                            </button>
                            <button
                              title="Delete fixed salary"
                              aria-label="Delete fixed salary"
                              className="icon-button"
                              style={{ color: "var(--danger)", minHeight: 26, padding: 0, width: 26, minWidth: 26 }}
                              onClick={() => { void handleDeleteSalaryConfig(config.id); }}
                            >
                              <AppIcon name="delete" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <label className="surface" style={{ padding: 10, display: "block" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <input
                      type="checkbox"
                      checked={saveRemainingDailyLimitToPiggyBank}
                      onChange={(e) => {
                        void handleSaveRemainingDailyLimitToPiggyBankChange(e.target.checked);
                      }}
                    />
                    <div>
                      <div style={{ fontSize: 13, marginBottom: 4 }}>
                        <b>{"Save remaining daily spend limit to piggy bank"}</b>
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>
                        {"At the start of the next day, the unused part of yesterday's daily spend limit is added to the piggy bank."}
                      </div>
                    </div>
                  </div>
                </label>
              </div>
            ) : (
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                <div className="surface" style={{ padding: 10 }}>
                  <div style={{ fontSize: 13, marginBottom: 8 }}><b>{"Expense categories"}</b></div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input
                      value={expenseCategoryDraft}
                      onChange={(e) => setExpenseCategoryDraft(e.target.value)}
                      placeholder={"e.g. Groceries"}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void addExpenseCategory();
                        }
                      }}
                      style={{ width: "100%" }}
                    />
                    <button onClick={() => { void addExpenseCategory(); }}>{"Add"}</button>
                  </div>
                  <div className="panel-list">
                    {expenseCategories.length > 0 ? expenseCategories.map((category) => (
                      <div key={`expense:${category}`} className="panel-item" style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>{category}</div>
                        <button
                          onClick={() => { void removeExpenseCategory(category); }}
                          aria-label={`Delete ${category}`}
                        >
                          {"Delete"}
                        </button>
                      </div>
                    )) : (
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{"No expense categories."}</div>
                    )}
                  </div>
                </div>

                <div className="surface" style={{ padding: 10 }}>
                  <div style={{ fontSize: 13, marginBottom: 8 }}><b>{"Income categories"}</b></div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input
                      value={incomeCategoryDraft}
                      onChange={(e) => setIncomeCategoryDraft(e.target.value)}
                      placeholder={"e.g. Salary"}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void addIncomeCategory();
                        }
                      }}
                      style={{ width: "100%" }}
                    />
                    <button onClick={() => { void addIncomeCategory(); }}>{"Add"}</button>
                  </div>
                  <div className="panel-list">
                    {savedIncomeCategories.length > 0 ? savedIncomeCategories.map((category) => (
                      <div key={`income:${category}`} className="panel-item" style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>{category}</div>
                        <button
                          onClick={() => { void removeIncomeCategory(category); }}
                          aria-label={`Delete ${category}`}
                        >
                          {"Delete"}
                        </button>
                      </div>
                    )) : (
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{"No income categories."}</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {txModalOpen ? (
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
            if (e.target === e.currentTarget) closeTxModal();
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
              <b style={{ fontSize: 14 }}>
                {txModalTitle(txModalType)}  -  {formatDateForDisplay(txModalDate, dateFormat)}
              </b>
              <button onClick={closeTxModal} aria-label={"Close"} className="icon-button">
                <AppIcon name="close" />
              </button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Amount (RUB)"}</div>
                <input
                  value={txModalAmount}
                  onChange={(e) => setTxModalAmount(e.target.value)}
                  placeholder={txModalType === "income" ? "1000" : "100"}
                  inputMode="decimal"
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>

              <div style={{ minWidth: 0 }} data-tx-category="true">
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Category"}</div>
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={txModalCategory}
                      onChange={(e) => setTxModalCategory(e.target.value)}
                      onFocus={() => setTxCategoryMenuOpen(true)}
                      placeholder={txModalType === "income" ? "e.g. Salary" : "e.g. Groceries"}
                      style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                    />
                    <button
                      type="button"
                      onClick={() => setTxCategoryMenuOpen((v) => !v)}
                      aria-label={"Show category list"}
                      className="icon-button"
                      style={{ minWidth: 34, padding: 0 }}
                    >
                      <AppIcon name="chevronDown" />
                    </button>
                  </div>

                  {txCategoryMenuOpen && txCategoryOptions.length > 0 ? (
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
                      {txCategoryOptions.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => {
                            setTxModalCategory(c);
                            setTxCategoryMenuOpen(false);
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
              {txModalType === "expense" && isDebtCategory(txModalCategory) ? (
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"To whom"}</div>
                  <select
                    value={txModalDebtPerson}
                    onChange={(e) => setTxModalDebtPerson(e.target.value)}
                    style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                  >
                    <option value="">{"Select person"}</option>
                    {debtPeople.map((person) => (
                      <option key={person} value={person}>
                        {person}
                      </option>
                    ))}
                  </select>
                  {debtPeople.length === 0 ? (
                    <div style={{ marginTop: 4, fontSize: 11, opacity: 0.75 }}>
                      {"Add a debt in the Debts card first."}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={closeTxModal}>{"Cancel"}</button>
              <button onClick={submitTxModal}>{txModalTitle(txModalType)}</button>
            </div>
          </div>
        </div>
      ) : null}

      {debtModalOpen ? (
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
            if (e.target === e.currentTarget) closeDebtModal();
          }}
        >
          <div
            className="modal-panel"
            style={{
              width: "min(460px, 100%)",
              padding: 12,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <b style={{ fontSize: 14 }}>
                {debtModalEditId ? "Edit debt" : "Add debt"}
              </b>
              <button onClick={closeDebtModal} aria-label={"Close"} className="icon-button">
                <AppIcon name="close" />
              </button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Amount (RUB)"}</div>
                <input
                  value={debtModalAmount}
                  onChange={(e) => setDebtModalAmount(e.target.value)}
                  placeholder="1000"
                  inputMode="decimal"
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"To whom you owe"}</div>
                <input
                  value={debtModalPerson}
                  onChange={(e) => setDebtModalPerson(e.target.value)}
                  placeholder={"e.g. Ivan"}
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={closeDebtModal}>{"Cancel"}</button>
              <button onClick={submitDebtModal}>
                {debtModalEditId ? "Save" : "Add debt"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <EditTransactionModal
        open={editTxModalOpen}
        date={editTxModalDate}
        dateFormat={dateFormat}
        showDateField={Boolean(editTxOriginal)}
        amount={editTxModalAmount}
        category={editTxModalCategory}
        note={editTxModalNote}
        categoryOptions={editTxCategoryOptions}
        onDateChange={setEditTxModalDate}
        onAmountChange={setEditTxModalAmount}
        onCategoryChange={setEditTxModalCategory}
        onNoteChange={setEditTxModalNote}
        onClose={closeEditTxModal}
        onSubmit={() => { void submitEditTxModal(); }}
      />

      {vacationModalOpen ? (
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
            if (e.target === e.currentTarget) closeVacationModal();
          }}
        >
          <div
            className="modal-panel"
            style={{
              width: "min(620px, 100%)",
              padding: 18,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="vacation-form-modal-head">
              <div>
                <b className="vacation-form-modal-title">
                  {vacationModalEditId ? "Edit vacation" : "Add vacation"}
                </b>
                <div className="vacation-form-modal-subtitle">
                  {"Choose dates, set the type, and confirm the details below."}
                </div>
              </div>
              <button onClick={closeVacationModal} aria-label={"Close"} className="icon-button vacations-manager-close">
                <AppIcon name="close" />
              </button>
            </div>

            <div className="vacation-form-layout">
              <div
                className="vacation-form-fields"
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{`Start date (${dateFormatPattern(dateFormat)})`}</div>
                  <DateInputWithCalendar
                    value={vacationModalStart}
                    dateFormat={dateFormat}
                    onChange={setVacationModalStart}
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{`End date (${dateFormatPattern(dateFormat)})`}</div>
                  <DateInputWithCalendar
                    value={vacationModalEnd}
                    dateFormat={dateFormat}
                    onChange={setVacationModalEnd}
                  />
                </div>
              </div>

              <div className="vacation-form-main">
                <div className="vacation-form-fields vacation-form-fields-secondary">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Title"}</div>
                    <input
                      value={vacationModalTitle}
                      onChange={(e) => setVacationModalTitle(e.target.value)}
                      placeholder={"Vacation"}
                      style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                    />
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>{"Type"}</div>
                    <div className="vacation-type-toggle">
                      <button
                        type="button"
                        onClick={() => setVacationModalType("paid")}
                        className={vacationModalType === "paid" ? "vacation-type-option vacation-type-option-active" : "vacation-type-option"}
                      >
                        {"Paid"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setVacationModalType("unpaid")}
                        className={vacationModalType === "unpaid" ? "vacation-type-option vacation-type-option-active" : "vacation-type-option"}
                      >
                        {"Unpaid"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="vacation-form-summary-card">
                  <div className="vacation-form-summary-title">{"Summary"}</div>
                  <div className="vacation-form-summary-grid">
                    <div className="vacation-form-summary-item">
                      <span className="vacation-form-summary-label">{"Vacation days"}</span>
                      <b>{vacationModalRange.days} {"days"}</b>
                    </div>
                    <div className="vacation-form-summary-item">
                      <span className="vacation-form-summary-label">{"Range"}</span>
                      <b>{formatDateForDisplay(vacationModalRange.start, dateFormat)} {"->"} {formatDateForDisplay(vacationModalRange.end, dateFormat)}</b>
                    </div>
                    <div className="vacation-form-summary-item">
                      <span className="vacation-form-summary-label">{"Type"}</span>
                      <b>{vacationModalType === "paid" ? "Paid" : "Unpaid"}</b>
                    </div>
                    <div className="vacation-form-summary-item vacation-form-summary-item-payout">
                      <span className="vacation-form-summary-label">{"Estimated payout"}</span>
                      <b>
                        {vacationModalType === "paid" ? rub(vacationModalPayoutAmount) : "No payout"}
                      </b>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="vacation-form-footer">
              <button onClick={closeVacationModal}>{"Cancel"}</button>
              <button onClick={submitVacationModal} className="vacation-form-submit">
                {vacationModalEditId ? "Save vacation" : "Add vacation"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {salaryModalOpen ? (
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
            if (e.target === e.currentTarget) closeSalaryModal();
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
              <b style={{ fontSize: 14 }}>
                {"Add salary"} - {formatDateForDisplay(salaryModalDate, dateFormat)}
              </b>
              <button onClick={closeSalaryModal} aria-label={"Close"} className="icon-button">
                <AppIcon name="close" />
              </button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Amount (RUB)"}</div>
                <input
                  value={salaryModalAmount}
                  onChange={(e) => {
                    setSalaryModalAmount(e.target.value);
                    setSalaryModalCheckResult(null);
                  }}
                  placeholder="80000"
                  inputMode="decimal"
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Title"}</div>
                <input
                  value={salaryModalTitle}
                  onChange={(e) => {
                    setSalaryModalTitle(e.target.value);
                    setSalaryModalCheckResult(null);
                  }}
                  placeholder={"Salary"}
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Accrual month"}</div>
                <input
                  type="month"
                  value={salaryModalAccrualMonth}
                  onChange={(e) => {
                    setSalaryModalAccrualMonth(e.target.value);
                    setSalaryModalCheckResult(null);
                  }}
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Vacation pay calculation"}</div>
                <select
                  value={salaryModalKind}
                  onChange={(e) => {
                    setSalaryModalKind(e.target.value as SalaryEventKind);
                    setSalaryModalCheckResult(null);
                  }}
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                >
                  <option value="regular">{salaryEventKindLabel("regular")}</option>
                  <option value="vacation_pay">{salaryEventKindLabel("vacation_pay")}</option>
                  <option value="excluded">{salaryEventKindLabel("excluded")}</option>
                </select>
              </div>

              <div
                style={{
                  border: "1px solid #eee",
                  borderRadius: 10,
                  padding: 10,
                  background: "#fafafa",
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {"Estimate the payout for this date from the monthly amount, using workdays and public holidays."}
                  </div>
                  <button type="button" onClick={handleCheckSalaryModal}>
                    {"Check salary"}
                  </button>
                </div>
                {salaryModalCheckResult ? (
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontSize: 12 }}>
                      <b>
                        {salaryModalCheckResult.payoutKind === "first_half"
                          ? "Estimated first-half payout"
                          : "Estimated second-half payout"}
                      </b>
                      <span style={{ marginLeft: 8 }}>{rub(salaryModalCheckResult.amount)}</span>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {`${salaryModalCheckResult.payablePeriodWorkingDays} payable working days in the period, ${salaryModalCheckResult.payableMonthWorkingDays} payable of ${salaryModalCheckResult.monthWorkingDays} working days for ${salaryModalCheckResult.payrollMonth}`}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {`${formatDateForDisplay(salaryModalCheckResult.periodStart, dateFormat)} -> ${formatDateForDisplay(salaryModalCheckResult.periodEnd, dateFormat)}`}
                    </div>
                    {salaryModalCheckResult.vacationWorkingDaysExcluded > 0 ? (
                      <div style={{ fontSize: 12, opacity: 0.8 }}>
                        {`Vacation excluded ${salaryModalCheckResult.vacationWorkingDaysExcluded} working day(s) from the month salary calculation.`}
                      </div>
                    ) : null}
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {`Monthly base: ${rub(salaryModalCheckResult.monthlySalaryAmount)} (${salaryModalCheckResult.source === "history" ? "from previous payouts" : "from entered amount"})`}
                    </div>
                    {salaryModalCheckResult.previouslyRecordedAmount > 0 ? (
                      <div style={{ fontSize: 12, opacity: 0.8 }}>
                        {`Already recorded for ${salaryModalCheckResult.payrollMonth}: ${rub(salaryModalCheckResult.previouslyRecordedAmount)}`}
                      </div>
                    ) : null}
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {salaryModalCheckResult.deltaFromEntered === 0
                        ? "Entered amount matches the estimate."
                        : salaryModalCheckResult.deltaFromEntered > 0
                          ? `Entered amount is ${rub(salaryModalCheckResult.deltaFromEntered)} above the estimate.`
                          : `Entered amount is ${rub(Math.abs(salaryModalCheckResult.deltaFromEntered))} below the estimate.`}
                    </div>
                    <div>
                      <button type="button" onClick={applyCheckedSalaryAmount}>
                        {"Use estimated amount"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={closeSalaryModal}>{"Cancel"}</button>
              <button onClick={submitSalaryModal}>{"Add salary"}</button>
            </div>
          </div>
        </div>
      ) : null}

      <EditSalaryModal
        open={editSalaryModalOpen}
        date={editSalaryModalDate}
        dateFormat={dateFormat}
        amount={editSalaryModalAmount}
        title={editSalaryModalTitle}
        kind={editSalaryModalKind}
        accrualMonth={editSalaryModalAccrualMonth}
        checkResult={editSalaryModalCheckResult}
        onDateChange={(value) => {
          setEditSalaryModalDate(value);
          setEditSalaryModalCheckResult(null);
        }}
        onAmountChange={(value) => {
          setEditSalaryModalAmount(value);
          setEditSalaryModalCheckResult(null);
        }}
        onTitleChange={(value) => {
          setEditSalaryModalTitle(value);
          setEditSalaryModalCheckResult(null);
        }}
        onKindChange={(value) => {
          setEditSalaryModalKind(value);
          setEditSalaryModalCheckResult(null);
        }}
        onAccrualMonthChange={(value) => {
          setEditSalaryModalAccrualMonth(value);
          setEditSalaryModalCheckResult(null);
        }}
        onCheck={handleCheckEditSalaryModal}
        onUseEstimatedAmount={applyCheckedEditSalaryAmount}
        onClose={closeEditSalaryModal}
        onSubmit={() => { void submitEditSalaryModal(); }}
      />

      <PiggyBankModal
        open={piggyBankModalOpen}
        type={piggyBankModalType}
        amountInput={piggyBankModalAmount}
        balance={piggyBankAmount}
        onClose={closePiggyBankModal}
        onTypeChange={setPiggyBankModalType}
        onAmountInputChange={setPiggyBankModalAmount}
        onSubmit={() => { void submitPiggyBankModal(); }}
        onWithdrawAll={() => { void withdrawAllFromPiggyBank(); }}
      />
      {confirmDialog}




    </div>
  );
}
