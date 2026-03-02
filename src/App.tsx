import { useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { api, AppData, Debt, OffDay, SalaryEvent, Transaction, Vacation } from "./lib/api";
import { rub, toKop } from "./lib/money";
import { capitalizeFirst } from "./lib/text";
import { findFollowingSalaryDate } from "./lib/salary";
import { daysInMonth, overlapInclusiveDays, parseYmdLocal, ymd, ymFromYmd } from "./lib/date";
import { isDebtCategory, normalizeCategoryInput } from "./lib/category";
import { normalizeVacationType, vacationTypeLabel, VacationType } from "./lib/vacation";
import { useDismissible } from "./hooks/useDismissible";
import { useVacationDaysCount } from "./hooks/useVacationDaysCount";
import { VacationsPanel } from "./components/VacationsPanel";
import { SalariesPanel } from "./components/SalariesPanel";
import { PiggyBankChip } from "./components/PiggyBankChip";
import { PiggyBankModal, PiggyBankModalType } from "./components/PiggyBankModal";
import { SelectedDateBudgetSummary } from "./components/SelectedDateBudgetSummary";
import { SelectedDateTransactionsList } from "./components/SelectedDateTransactionsList";
import { TopCategoriesPanel } from "./components/TopCategoriesPanel";
import { EditTransactionModal } from "./components/EditTransactionModal";
import { EditSalaryModal } from "./components/EditSalaryModal";
import { GeneralStatsSurface } from "./components/GeneralStatsSurface";
import { DebtsSurface } from "./components/DebtsSurface";
import { CalendarSurface } from "./components/CalendarSurface";
import { useConfirmDialog } from "./hooks/useConfirmDialog";
import { usePiggyBankHotkeys } from "./hooks/usePiggyBankHotkeys";

const VACATION_DAYS_COUNT_STORAGE_KEY = "sadmoneyapp.vacation_days_count";
const LEGACY_PIGGY_BANK_STORAGE_KEY = "sadmoneyapp.piggy_bank_amount";
const DEBUG_USE_CUSTOM_TODAY = false;
const DEBUG_CUSTOM_TODAY = "2026-03-03";

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
  const salaryThisMonth = (data?.salaryEvents ?? [])
    .filter(s => ymFromYmd(s.date) === monthKey)
    .sort((a, b) => a.date.localeCompare(b.date));
  const vacationsThisMonth = useMemo(() => {
    const monthStart = `${monthKey}-01`;
    const monthEnd = `${monthKey}-${String(daysInMonth(year, month0)).padStart(2, "0")}`;
    return (data?.vacations ?? []).filter(v => v.start_date <= monthEnd && v.end_date >= monthStart);
  }, [data?.vacations, month0, monthKey, year]);
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

    for (const s of data.salaryEvents ?? []) {
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
  }, [data, monthKey, today]);
  const trendsData = useMemo(() => {
    if (!data) {
      return {
        currentLabel: "",
        previousLabel: "",
        currentIncome: 0,
        previousIncome: 0,
        currentExpense: 0,
        previousExpense: 0,
        currentAvgCheck: 0,
        previousAvgCheck: 0,
        topGrowth: [] as Array<{ category: string; delta: number; current: number; previous: number }>,
      };
    }

    const currentMonthStart = `${monthKey}-01`;
    const prevMonthDate = new Date(year, month0 - 1, 1);
    const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
    const previousMonthStart = `${prevMonthKey}-01`;

    const currentLabel = capitalizeFirst(new Date(year, month0, 1).toLocaleString(locale, { month: "long", year: "numeric" }));
    const previousLabel = capitalizeFirst(prevMonthDate.toLocaleString(locale, { month: "long", year: "numeric" }));

    let currentIncome = 0;
    let previousIncome = 0;
    let currentExpense = 0;
    let previousExpense = 0;
    let currentExpenseOps = 0;
    let previousExpenseOps = 0;

    const currentExpenseByCategory = new Map<string, number>();
    const previousExpenseByCategory = new Map<string, number>();

    for (const t of data.transactions ?? []) {
      const ym = ymFromYmd(t.date);
      if (t.type === "income") {
        if (ym === monthKey) currentIncome += t.amount;
        if (ym === prevMonthKey) previousIncome += t.amount;
      }
      if (t.type === "expense") {
        if (ym === monthKey) {
          currentExpense += t.amount;
          currentExpenseOps += 1;
          currentExpenseByCategory.set(t.category, (currentExpenseByCategory.get(t.category) ?? 0) + t.amount);
        }
        if (ym === prevMonthKey) {
          previousExpense += t.amount;
          previousExpenseOps += 1;
          previousExpenseByCategory.set(t.category, (previousExpenseByCategory.get(t.category) ?? 0) + t.amount);
        }
      }
    }

    for (const s of data.salaryEvents ?? []) {
      if (s.date >= currentMonthStart && s.date <= today) {
        currentIncome += s.amount;
      }
      if (s.date >= previousMonthStart && s.date < currentMonthStart) {
        previousIncome += s.amount;
      }
    }

    const categories = new Set<string>([
      ...Array.from(currentExpenseByCategory.keys()),
      ...Array.from(previousExpenseByCategory.keys()),
    ]);

    const topGrowth = Array.from(categories)
      .map((category) => {
        const current = currentExpenseByCategory.get(category) ?? 0;
        const previous = previousExpenseByCategory.get(category) ?? 0;
        return { category, current, previous, delta: current - previous };
      })
      .filter((item) => item.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 5);

    return {
      currentLabel,
      previousLabel,
      currentIncome,
      previousIncome,
      currentExpense,
      previousExpense,
      currentAvgCheck: currentExpenseOps > 0 ? Math.round(currentExpense / currentExpenseOps) : 0,
      previousAvgCheck: previousExpenseOps > 0 ? Math.round(previousExpense / previousExpenseOps) : 0,
      topGrowth,
    };
  }, [data, locale, month0, monthKey, today, year]);

  const storedWorkSchedule = data?.settings.workSchedule === "custom" ? "custom" : "5/2";
  const [workSchedule, setWorkSchedule] = useState<'5/2' | 'custom'>('5/2');
  const saveRemainingDailyLimitToPiggyBank = Boolean(data?.settings.saveRemainingDailyLimitToPiggyBank);
  const lastDailyLimitCarryoverDate = data?.settings.lastDailyLimitCarryoverDate ?? "";
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
        usedDays.add(ymd(cur));
        cur.setDate(cur.getDate() + 1);
      }
    }

    return Math.max(total - usedDays.size, 0);
  }, [data, vacationDaysCount, year]);

  const avgDailyEarnings = useMemo(() => {
    // Salary/advance sum for the last 12 months divided by worked days
    // (excluding weekends, vacations, and user-defined non-working days)
    if (!data) return 0;
    const end = new Date(today);
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);

    // Sum all salary events in range
    let total = 0;
    for (const s of data.salaryEvents ?? []) {
      const sd = new Date(s.date);
      if (sd >= start && sd <= end) total += s.amount;
    }

    // Count worked days in range
    const vacations = data.vacations ?? [];
    const offDays = data.offDays ?? [];
    let workedDays = 0;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const y = ymd(d);
      const day = d.getDay(); // 0 = Sun, 6 = Sat

      // always exclude vacation days
      let inVacation = false;
      for (const v of vacations) {
        if (v.start_date <= y && y <= v.end_date) {
          inVacation = true;
          break;
        }
      }
      if (inVacation) continue;

      const off = offDays.find(o => o.date === y) ?? null;

      if (day === 0 || day === 6) {
        // Weekend by calendar: count only when explicitly marked as working
        if (off && off.is_working) {
          workedDays++;
        } else {
          continue;
        }
      } else {
        // Weekday by calendar: exclude only when explicitly marked as non-working
        if (off && !off.is_working) continue;
        workedDays++;
      }
    }

    if (workedDays === 0) return 0;
    // Return average in kopecks
    return Math.round(total / workedDays);
  }, [data, today]);

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

      if (isWeekend) {
        if (offForDay?.is_working) {
          total++;
        }
        continue;
      }

      if (offForDay && !offForDay.is_working) {
        continue;
      }

      total++;
    }

    return total;
  }, [data?.offDays, data?.vacations, monthDays, workSchedule]);

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
    if (!data) return map;
    for (const t of data.transactions) {
      const cur = map.get(t.date) ?? { inc: 0, exp: 0 };
      if (t.type === "income") cur.inc += t.amount;
      if (t.type === "expense" || t.type === "planned_expense") cur.exp += t.amount;
      map.set(t.date, cur);
    }

    // Add salary events as income for each day
    for (const s of data.salaryEvents ?? []) {
      const cur = map.get(s.date) ?? { inc: 0, exp: 0 };
      cur.inc += s.amount;
      map.set(s.date, cur);
    }

    return map;
  }, [data]);

  const salaryEventsForSelectedDate = (data?.salaryEvents ?? []).filter((s) => s.date === selectedDate);
  const salaryForSelectedDate = salaryEventsForSelectedDate[0] ?? null;
  const salaryAmountForSelectedDate = salaryEventsForSelectedDate.reduce((sum, s) => sum + s.amount, 0);
  const transactionsForSelectedDate = (data?.transactions ?? []).filter((t) => t.date === selectedDate);
  const offForSelectedDate = (data?.offDays ?? []).find(o => o.date === selectedDate) ?? null;
  const vacationForSelectedDate = (data?.vacations ?? []).find(v => v.start_date <= selectedDate && v.end_date >= selectedDate) ?? null;
  const plannedAfterExpensesForSelectedDate = useMemo(() => {
    if (!data || !budget?.next_salary_date) return null;

    const nextSalaryDate = budget.next_salary_date;
    const salaryEvents = data.salaryEvents ?? [];
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

    const plannedUntilSelected = (data.transactions ?? [])
      .filter(
        (t) =>
          t.type === "planned_expense" &&
          t.date >= nextSalaryDate &&
          t.date <= selectedDate
      )
      .reduce((sum, t) => sum + t.amount, 0);

    return nextSalaryAmount - plannedUntilSelected;
  }, [data, budget?.next_salary_date, selectedDate]);
  const afterVacationForSelectedDate = useMemo(() => {
    if (!data || salaryAmountForSelectedDate <= 0 || avgDailyEarnings <= 0) return null;

    const selected = parseYmdLocal(selectedDate);
    const selectedYear = selected.getFullYear();
    const selectedMonth0 = selected.getMonth();
    const selectedDay = selected.getDate();
    const selectedMonthKey = `${selectedYear}-${String(selectedMonth0 + 1).padStart(2, "0")}`;
    let vacationDaysForThisSalary = 0;

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
          vacationDaysForThisSalary += overlapInclusiveDays(v.start_date, v.end_date, monthStart, firstHalfEnd);
        }

        // Second half (16..end) affects the salary up to day 5 of the next month.
        const nextMonthDate = new Date(y, m0 + 1, 1);
        const nextMonthKey = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}`;
        if (selectedMonthKey === nextMonthKey && selectedDay <= 5) {
          const secondHalfStart = `${monthKey}-16`;
          vacationDaysForThisSalary += overlapInclusiveDays(v.start_date, v.end_date, secondHalfStart, monthEnd);
        }

        cursor.setMonth(cursor.getMonth() + 1);
      }
    }

    if (vacationDaysForThisSalary <= 0) return null;

    const vacationDeduction = vacationDaysForThisSalary * avgDailyEarnings;
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
    avgDailyEarnings,
    plannedAfterExpensesForSelectedDate,
  ]);
  const selectedDateWeekDay = new Date(selectedDate).getDay(); // 0 = Sunday, 6 = Saturday
  const selectedDateIsWeekend = selectedDateWeekDay === 0 || selectedDateWeekDay === 6;
  const selectedDateDefaultWorking = workSchedule === "5/2" ? !selectedDateIsWeekend : false;
  const selectedDateIsWorking = offForSelectedDate
    ? !!offForSelectedDate.is_working
    : selectedDateDefaultWorking;

  const [dayMenuOpen, setDayMenuOpen] = useState<string | null>(null);
  const [dayMenuPos, setDayMenuPos] = useState<{ left: number; top: number }>({ left: 8, top: 8 });
  const [dayMenuAnchorRect, setDayMenuAnchorRect] = useState<{ top: number; bottom: number } | null>(null);
  const dayMenuRef = useRef<HTMLDivElement | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [trendsModalOpen, setTrendsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "preferences" | "categories">("general");
  const [expenseCategoryDraft, setExpenseCategoryDraft] = useState<string>("");
  const [incomeCategoryDraft, setIncomeCategoryDraft] = useState<string>("");
  const [appVersion, setAppVersion] = useState<string>("-");
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
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
  const [editSalaryModalOpen, setEditSalaryModalOpen] = useState(false);
  const [editSalaryModalId, setEditSalaryModalId] = useState<string | null>(null);
  const [editSalaryModalDate, setEditSalaryModalDate] = useState<string>(today);
  const [editSalaryModalAmount, setEditSalaryModalAmount] = useState<string>("");
  const [editSalaryModalTitle, setEditSalaryModalTitle] = useState<string>("Salary");
  const [piggyBankModalOpen, setPiggyBankModalOpen] = useState(false);
  const [piggyBankModalAmount, setPiggyBankModalAmount] = useState<string>("");
  const [piggyBankModalType, setPiggyBankModalType] = useState<PiggyBankModalType>("add");
  const [isPickingVacationStart, setIsPickingVacationStart] = useState(false);
  const [isPickingVacationEnd, setIsPickingVacationEnd] = useState(false);
  const [vacationStartDate, setVacationStartDate] = useState<string | null>(null);
  const [vacationModalOpen, setVacationModalOpen] = useState(false);
  const [vacationModalStart, setVacationModalStart] = useState<string>(today);
  const [vacationModalEnd, setVacationModalEnd] = useState<string>(today);
  const [vacationModalTitle, setVacationModalTitle] = useState<string>("Vacation");
  const [vacationModalType, setVacationModalType] = useState<VacationType>("paid");
  const [vacationTypeMenuOpen, setVacationTypeMenuOpen] = useState(false);
  const [isPickingCustomWorkDays, setIsPickingCustomWorkDays] = useState(false);
  const [customWorkingDays, setCustomWorkingDays] = useState<string[]>([]);
  const isCalendarPickerFocus =
    isPickingSalaryDate || isPickingVacationStart || isPickingVacationEnd || isPickingCustomWorkDays;

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
    isWeekend: boolean;
    offForDay: OffDay | null;
  }) {
    const { date, effectiveWorking, isWeekend, offForDay } = params;

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
      } else if (isWeekend) {
        if (makeWorking) {
          const updated = await api.upsertOffDay({
            id: offForDay?.id ?? "",
            date,
            note: offForDay?.note ?? "",
            is_working: true,
          });
          setData(updated);
        } else if (offForDay) {
          const updated = await api.deleteOffDay(offForDay.id);
          setData(updated);
        }
      } else {
        if (!makeWorking) {
          const updated = await api.upsertOffDay({
            id: offForDay?.id ?? "",
            date,
            note: offForDay?.note ?? "",
            is_working: false,
          });
          setData(updated);
        } else if (offForDay) {
          const updated = await api.deleteOffDay(offForDay.id);
          setData(updated);
        }
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
    const fromSalaryTitles = (data?.salaryEvents ?? [])
      .map((s) => normalizeCategoryInput(s.title))
      .filter((c) => c.length > 0);

    return Array.from(new Set([...savedIncomeCategories, ...fromTx, ...fromSalaryTitles]));
  }, [data, savedIncomeCategories]);

  useEffect(() => {
    if (!settingsModalOpen) return;
    setExpenseCategoryDraft("");
    setIncomeCategoryDraft("");
  }, [settingsModalOpen]);

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

  const debtPeople = useMemo(() => {
    return Array.from(new Set(debts.map((d) => normalizeCategoryInput(d.person)).filter((p) => p.length > 0)));
  }, [debts]);

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
    setIsPickingVacationStart(false);
    setIsPickingVacationEnd(false);
    setVacationStartDate(null);
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
    setSalaryModalOpen(true);
  }

  function closeSalaryModal() {
    setSalaryModalOpen(false);
    setSalaryModalAmount("");
    setSalaryModalTitle("Salary");
  }

  function handleCalendarDayTileClick(date: string) {
    setSelectedDate(date);

    if (isPickingCustomWorkDays) {
      toggleCustomWorkingDay(date);
      return;
    }

    if (isPickingVacationStart) {
      setIsPickingVacationStart(false);
      setIsPickingVacationEnd(true);
      setVacationStartDate(date);
      return;
    }

    if (isPickingVacationEnd) {
      if (!vacationStartDate) {
        setIsPickingVacationEnd(false);
        return;
      }
      setIsPickingVacationEnd(false);
      setVacationStartDate(null);
      openVacationModal(vacationStartDate, date);
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
    setVacationModalType(vacationType);
    setIsPickingSalaryDate(false);
    setIsPickingVacationStart(true);
    setIsPickingVacationEnd(false);
    setVacationStartDate(null);
    setSalaryModalOpen(false);
    setVacationModalOpen(false);
    setVacationTypeMenuOpen(false);
    setIsPickingCustomWorkDays(false);
    setDayMenuOpen(null);
    setDayMenuAnchorRect(null);
  }

  function cancelVacationPicking() {
    setIsPickingVacationStart(false);
    setIsPickingVacationEnd(false);
    setVacationStartDate(null);
    setVacationTypeMenuOpen(false);
  }

  function openVacationModal(startDate: string, endDate: string) {
    const start = startDate <= endDate ? startDate : endDate;
    const end = startDate <= endDate ? endDate : startDate;
    setVacationModalStart(start);
    setVacationModalEnd(end);
    setVacationModalTitle("Vacation");
    setVacationModalOpen(true);
  }

  function closeVacationModal() {
    setVacationModalOpen(false);
    setVacationModalTitle("Vacation");
    setVacationModalType("paid");
  }

  async function submitVacationModal() {
    const title = vacationModalTitle.trim() || "Vacation";

    try {
      const updated = await api.upsertVacation({
        id: "",
        start_date: vacationModalStart,
        end_date: vacationModalEnd,
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
    setIsPickingVacationStart(false);
    setIsPickingVacationEnd(false);
    setVacationStartDate(null);
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
    const newStart = prompt("Start date (YYYY-MM-DD):", v.start_date) ?? v.start_date;
    const newEnd = prompt("End date (YYYY-MM-DD):", v.end_date) ?? v.end_date;
    const newTitle = prompt("Title:", v.title) ?? v.title;
    const currentType = normalizeVacationType(v.vacation_type);
    const newTypeRaw = prompt('Type ("paid" | "unpaid"):', currentType) ?? currentType;
    const newType = normalizeVacationType(newTypeRaw.trim().toLowerCase());

    const updated = await api.upsertVacation({
      ...v,
      start_date: newStart,
      end_date: newEnd,
      title: newTitle,
      vacation_type: newType,
    });
    setData(updated);
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
      });
      setData(updated);
      closeEditSalaryModal();
    } catch (err) {
      alert(String(err));
    }
  }

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
      <div className="topbar" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap", zIndex: 3000 }}>
        <button onClick={prevMonth}>{"<"}</button>
        <h2 className="summary-title">
          {capitalizeFirst(new Date(year, month0, 1).toLocaleString(locale, { month: "long", year: "numeric" }))}
        </h2>
        <button onClick={nextMonth}>{">"}</button>
        <button
          onClick={() => {
            focusOnDate(today);
          }}
        >
          {"Go to today"}
        </button>
        <div className="metric-chip" style={{ padding: "6px 10px", fontSize: 12 }}>
          {`Work days: ${workDaysInMonth}`}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <PiggyBankChip
            amount={piggyBankAmount}
            onAdd={() => openPiggyBankModal("add")}
            onWithdraw={() => openPiggyBankModal("withdraw")}
          />
          <div className="metric-chip" style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
            }}>
            <span style={{ fontSize: 12, opacity: 0.9, whiteSpace: "nowrap" }}>{"Vacation days count"}</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={vacationDaysCount}
              onChange={(e) => handleVacationDaysCountChange(e.target.value)}
              onBlur={(e) => commitVacationDaysCount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitVacationDaysCount((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              style={{
                width: 56,
                padding: "4px 6px",
                borderRadius: 6,
                border: "1px solid #ccc",
                fontSize: 12,
              }}
            />
          </div>
          {isPickingCustomWorkDays ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={cancelCustomSchedulePick}>{"Cancel"}</button>
              <button onClick={saveCustomSchedule}>{"Save"}</button>
              <div style={{ fontSize: 12, opacity: 0.8, whiteSpace: "nowrap" }}>
                {"Mark working days in the calendar"}
              </div>
            </div>
          ) : null}
        </div>
        <button onClick={() => setTrendsModalOpen(true)}>
          {"Trends"}
        </button>
        <button
          aria-label="Settings"
          onClick={openSettingsModal}
          style={{ width: 36, height: 36, display: "grid", placeItems: "center" }}
        >
          {"\u2699"}
        </button>
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
          data={data}
          monthKey={monthKey}
          year={year}
          today={today}
          avgDailyEarnings={avgDailyEarnings}
          locale={locale}
        />
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
        <VacationsPanel
          vacations={vacationsThisMonth}
          avgDailyEarnings={avgDailyEarnings}
          vacationDaysLeft={vacationDaysLeft}
          isPickingVacationStart={isPickingVacationStart}
          isPickingVacationEnd={isPickingVacationEnd}
          vacationTypeMenuOpen={vacationTypeMenuOpen}
          onToggleVacationTypeMenu={() => setVacationTypeMenuOpen((v) => !v)}
          onSelectVacationType={beginAddVacation}
          onCancelVacationPicking={cancelVacationPicking}
          onEditVacation={handleEditVacation}
          onDeleteVacation={handleDeleteVacation}
        />
        <SalariesPanel
          salaries={salaryThisMonth}
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
          <div><b>{"Selected date:"}</b> {selectedDate}</div>
          <div
            style={{
              fontSize: 12,
              padding: "2px 8px",
              borderRadius: 999,
              border: `1px solid ${vacationForSelectedDate ? "#a37500" : (selectedDateIsWorking ? "#1c7f4d" : "#bf3a3a")}`,
              color: vacationForSelectedDate ? "#7a5200" : (selectedDateIsWorking ? "#1c7f4d" : "#bf3a3a"),
              background: vacationForSelectedDate ? "#ffe07a" : (selectedDateIsWorking ? "#cfead8" : "#f2cfd3"),
            }}
          >
            {vacationForSelectedDate ? "Vacation" : (selectedDateIsWorking ? "Working" : "Day off")}
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
          salaryForSelectedDate={salaryForSelectedDate}
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
            cancelVacationPicking();
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
              <button onClick={() => setTrendsModalOpen(false)} aria-label={"Close"}>x</button>
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

            <div className="surface" style={{ marginTop: 10, padding: 10 }}>
              <div style={{ marginBottom: 8, fontSize: 13 }}><b>{"Top expense growth categories"}</b></div>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
                {trendsData.currentLabel} {"vs"} {trendsData.previousLabel}
              </div>
              {trendsData.topGrowth.length > 0 ? (
                <div className="panel-list">
                  {trendsData.topGrowth.map((item, idx) => (
                    <div key={`trend-growth:${item.category}`} className="panel-item" style={{ padding: "8px 10px", display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div><b>{idx + 1}.</b> {item.category}</div>
                        <div style={{ fontSize: 11, opacity: 0.75 }}>
                          {rub(item.current)} {" / "} {rub(item.previous)}
                        </div>
                      </div>
                      <div style={{ flexShrink: 0, color: "var(--danger)" }}>
                        <b>{"+ "} {rub(item.delta)}</b>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  {"No expense growth categories for this period."}
                </div>
              )}
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
              <button onClick={closeSettingsModal} aria-label={"Close"}>x</button>
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
                {txModalTitle(txModalType)}  -  {txModalDate}
              </b>
              <button onClick={closeTxModal} aria-label={"Close"}>x</button>
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
                    >v</button>
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
              <button onClick={closeDebtModal} aria-label={"Close"}>x</button>
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
              width: "min(520px, 100%)",
              padding: 12,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <b style={{ fontSize: 14 }}>
                {"Add vacation"} - {vacationModalStart} {"->"} {vacationModalEnd}
              </b>
              <button onClick={closeVacationModal} aria-label={"Close"}>x</button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Type"}</div>
                <input
                  value={vacationTypeLabel(vacationModalType)}
                  readOnly
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd", background: "#f7f7f7" }}
                />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Title"}</div>
                <input
                  value={vacationModalTitle}
                  onChange={(e) => setVacationModalTitle(e.target.value)}
                  placeholder={"Vacation"}
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={closeVacationModal}>{"Cancel"}</button>
              <button onClick={submitVacationModal}>{"Add vacation"}</button>
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
                {"Add salary"} - {salaryModalDate}
              </b>
              <button onClick={closeSalaryModal} aria-label={"Close"}>x</button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Amount (RUB)"}</div>
                <input
                  value={salaryModalAmount}
                  onChange={(e) => setSalaryModalAmount(e.target.value)}
                  placeholder="80000"
                  inputMode="decimal"
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Title"}</div>
                <input
                  value={salaryModalTitle}
                  onChange={(e) => setSalaryModalTitle(e.target.value)}
                  placeholder={"Salary"}
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
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
        amount={editSalaryModalAmount}
        title={editSalaryModalTitle}
        onDateChange={setEditSalaryModalDate}
        onAmountChange={setEditSalaryModalAmount}
        onTitleChange={setEditSalaryModalTitle}
        onClose={closeEditSalaryModal}
        onSubmit={() => { void submitEditSalaryModal(); }}
      />

      <PiggyBankModal
        open={piggyBankModalOpen}
        type={piggyBankModalType}
        amountInput={piggyBankModalAmount}
        balance={piggyBankAmount}
        onClose={closePiggyBankModal}
        onAmountInputChange={setPiggyBankModalAmount}
        onSubmit={() => { void submitPiggyBankModal(); }}
        onWithdrawAll={() => { void withdrawAllFromPiggyBank(); }}
      />
      {confirmDialog}




    </div>
  );
}
