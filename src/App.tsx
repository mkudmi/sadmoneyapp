import { useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { api, AppData, Debt, SalaryEvent, Transaction, Vacation } from "./lib/api";
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

const VACATION_DAYS_COUNT_STORAGE_KEY = "sadmoneyapp.vacation_days_count";

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month0, setMonth0] = useState(new Date().getMonth()); // 0..11
  const [selectedDate, setSelectedDate] = useState(ymd(new Date()));
  const today = ymd(new Date());
  const [budget, setBudget] = useState<{ per_day: number; days: number; next_salary_date: string | null; available: number } | null>(null);
  const monthKey = `${year}-${String(month0 + 1).padStart(2, "0")}`; // "YYYY-MM"
  const salaryThisMonth = (data?.salaryEvents ?? [])
    .filter(s => ymFromYmd(s.date) === monthKey)
    .sort((a, b) => a.date.localeCompare(b.date));
  const vacationsThisMonth = useMemo(() => {
    const monthStart = `${monthKey}-01`;
    const monthEnd = `${monthKey}-${String(daysInMonth(year, month0)).padStart(2, "0")}`;
    return (data?.vacations ?? []).filter(v => v.start_date <= monthEnd && v.end_date >= monthStart);
  }, [data?.vacations, month0, monthKey, year]);
  const topExpenseCategoriesThisMonth = useMemo(() => {
    if (!data) return [] as Array<{ category: string; amount: number }>;

    const byCategory = new Map<string, number>();
    for (const t of data.transactions) {
      if (t.type !== "expense") continue;
      if (ymFromYmd(t.date) !== monthKey) continue;
      const category = (t.category || "").trim() || "No category";
      byCategory.set(category, (byCategory.get(category) ?? 0) + t.amount);
    }

    return Array.from(byCategory.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [data, monthKey]);

  const [workSchedule, setWorkSchedule] = useState<'5/2' | 'custom'>('5/2');
  const { vacationDaysCount, handleVacationDaysCountChange, commitVacationDaysCount } =
    useVacationDaysCount(VACATION_DAYS_COUNT_STORAGE_KEY);
  const locale = "en-US";
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

  const monthTotals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    if (!data) return { inc, exp };

    for (const t of data.transactions) {
      if (ymFromYmd(t.date) !== monthKey) continue;
      // count only operations up to today
      if (t.date > today) continue;
      if (t.type === "income") inc += t.amount;
      if (t.type === "expense") exp += t.amount;
    }

    for (const s of data.salaryEvents ?? []) {
      if (ymFromYmd(s.date) === monthKey && s.date <= today) inc += s.amount;
    }

    return { inc, exp };
  }, [data, monthKey]);

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

  useEffect(() => {
    api.getData().then(setData);
  }, []);

  useEffect(() => {
    api.calcDailyBudget(today).then(setBudget);
  }, [today, data]);


  const monthDays = useMemo(() => {
    const n = daysInMonth(year, month0);
    const out: string[] = [];
    for (let d = 1; d <= n; d++) {
      out.push(ymd(new Date(year, month0, d)));
    }
    return out;
  }, [year, month0]);

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
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("-");
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
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
  const [isPickingSalaryDate, setIsPickingSalaryDate] = useState(false);
  const [salaryModalOpen, setSalaryModalOpen] = useState(false);
  const [salaryModalDate, setSalaryModalDate] = useState<string>(today);
  const [salaryModalAmount, setSalaryModalAmount] = useState<string>("");
  const [salaryModalTitle, setSalaryModalTitle] = useState<string>("Salary");
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
  useDismissible(settingsMenuOpen, () => setSettingsMenuOpen(false), "[data-settings-menu]");

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("-"));
  }, []);

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

  const expenseCategories = useMemo(() => {
    const fromData = data?.settings?.txCategories ?? [];
    return fromData.length > 0
      ? fromData
      : ["Groceries", "Fuel"];
  }, [data]);

  const incomeCategories = useMemo(() => {
    const defaults = [
      "Salary",
      "Advance",
      "Side job",
      "Cashback",
    ];
    const fromTx = (data?.transactions ?? [])
      .filter((t) => t.type === "income")
      .map((t) => normalizeCategoryInput(t.category))
      .filter((c) => c.length > 0);

    return Array.from(new Set([...defaults, ...fromTx]));
  }, [data]);

  const expenseCategoriesWithDebt = useMemo(() => {
    const debtCategory = "Debt";
    if (expenseCategories.some((c) => normalizeCategoryInput(c).toLowerCase() === normalizeCategoryInput(debtCategory).toLowerCase())) {
      return expenseCategories;
    }
    return [...expenseCategories, debtCategory];
  }, [expenseCategories]);

  const activeTxCategories = txModalType === "income" ? incomeCategories : expenseCategoriesWithDebt;

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

  const totalDebt = useMemo(() => debts.reduce((sum, d) => sum + d.amount, 0), [debts]);

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

  function prevMonth() {
    const d = new Date(year, month0, 1);
    d.setMonth(d.getMonth() - 1);
    setYear(d.getFullYear());
    setMonth0(d.getMonth());
    setSelectedDate(ymd(d));
  }

  function nextMonth() {
    const d = new Date(year, month0, 1);
    d.setMonth(d.getMonth() + 1);
    setYear(d.getFullYear());
    setMonth0(d.getMonth());
    setSelectedDate(ymd(d));
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
    const updated = await api.deleteVacation(id);
    setData(updated);
  }

  async function handleEditSalary(s: SalaryEvent) {
    const newDate = prompt("Date (YYYY-MM-DD):", s.date) ?? s.date;
    const newAmountStr = prompt("Amount (RUB):", String(s.amount / 100)) ?? String(s.amount / 100);
    const newTitle = prompt("Title:", s.title) ?? s.title;

    const updated = await api.upsertSalaryEvent({
      ...s,
      date: newDate,
      amount: toKop(newAmountStr),
      title: newTitle,
    });
    setData(updated);
  }

  async function handleDeleteSalary(id: string) {
    if (!confirm("Delete salary date?")) return;
    const updated = await api.deleteSalaryEvent(id);
    setData(updated);
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
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ opacity: 0.85, whiteSpace: "nowrap" }}>
            <b>{"Work schedule:"}</b>{" "}
            <select
              value={workSchedule}
              onChange={async (e) => {
                const next = e.target.value as "5/2" | "custom";
                if (next === "5/2") {
                  await saveFiveTwoSchedule();
                }
                setWorkSchedule(next);
                if (next === "custom") {
                  beginCustomSchedulePick();
                } else {
                  cancelCustomSchedulePick();
                }
              }}
            >
              <option value="5/2">5/2</option>
              <option value="custom">{"Custom"}</option>
            </select>
          </label>
          {isPickingCustomWorkDays ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={saveCustomSchedule}>{"Exit"}</button>
              <button onClick={saveCustomSchedule}>{"Save"}</button>
              <div style={{ fontSize: 12, opacity: 0.8, whiteSpace: "nowrap" }}>
                {"Mark working days in the calendar"}
              </div>
            </div>
          ) : null}
        </div>
        <div style={{ position: "relative" }} data-settings-menu="true">
          <button
            aria-label="Settings"
            onClick={() => setSettingsMenuOpen((v) => !v)}
            style={{ width: 36, height: 36, display: "grid", placeItems: "center" }}
          >
            {"\u2699"}
          </button>
          {settingsMenuOpen ? (
            <div
              className="menu-pop"
              ref={settingsMenuRef}
              data-settings-menu="true"
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 6px)",
                zIndex: 2200,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 180,
                padding: 8,              }}
            >
              <button
                onClick={async () => {
                  await exportBackupFile();
                  setSettingsMenuOpen(false);
                }}
              >
                {"Export backup"}
              </button>
              <button
                onClick={async () => {
                  await importBackupFile();
                  setSettingsMenuOpen(false);
                }}
              >
                {"Import backup"}
              </button>
              <button
                onClick={async () => {
                  setSettingsMenuOpen(false);
                  await checkForUpdates();
                }}
                disabled={isCheckingUpdates}
              >
                {isCheckingUpdates ? "Checking updates..." : "Check for updates"}
              </button>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                {"Version"}: {appVersion}
              </div>
            </div>
          ) : null}
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
        <div className="surface" style={{ minWidth: 0, height: "100%" }}>
          <div style={{ opacity: 0.9, marginBottom: 6 }}><b>{"Received this month (as of today):"}</b> {rub(monthTotals.inc)}</div>
          <div style={{ opacity: 0.9, marginBottom: 6 }}><b>{"Spent this month (as of today):"}</b> {rub(monthTotals.exp)}</div>
          <div style={{ opacity: 0.9, marginBottom: 6 }}><b>{"Average daily earnings:"}</b> {rub(avgDailyEarnings)}</div>
          <div style={{ opacity: 0.8 }}>
            <b>{"Today:"}</b>{" "}
            {new Date().toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric" })}
            <button
              style={{ marginLeft: 12 }}
              onClick={() => {
                const d = new Date();
                setYear(d.getFullYear());
                setMonth0(d.getMonth());
                setSelectedDate(ymd(d));
              }}
            >
              {"Go to today"}
            </button>
          </div>
          <div className="metric-chip" style={{
              marginTop: 8,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
            }}>
            <span style={{ fontSize: 12, opacity: 0.9 }}>{"Vacation days count"}</span>
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
            <span style={{ fontSize: 12, opacity: 0.9, whiteSpace: "nowrap" }}>
              {"Days Left"}: <b>{vacationDaysLeft}</b>
            </span>
          </div>
        </div>
        <div className="surface" style={{ minWidth: 0, height: "100%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <b>{"Debts"}</b>
            <button
              onClick={() => openDebtModal()}
              title={"Add debt"}
              aria-label={"Add debt"}
              style={{ minWidth: 28, fontWeight: 700 }}
            >
              +
            </button>
          </div>
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            <b>{"Total:"}</b> {rub(totalDebt)}
          </div>
          {debts.length > 0 ? (
            <div className="panel-list"
              style={{
                marginTop: 8,
                maxHeight: 120,
                overflowY: "auto",
                paddingRight: 4,
              }}
            >
              {debts.map((d) => (
                <div className="panel-item"
                  key={d.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    border: "1px solid #eee",
                    borderRadius: 10,
                    padding: "6px 8px",
                    fontSize: 12,
                  }}
                >
                  <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <b>{d.person}</b>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flexShrink: 0 }}>
                      <b>{rub(d.amount)}</b>
                    </div>
                    <button
                      className="edit-pencil-btn"
                      title={"Edit debt"}
                      aria-label={"Edit debt"}
                      style={{ width: 26, minWidth: 26, minHeight: 26, borderRadius: 8 }}
                      onClick={() => openDebtModal(d)}
                    >
                      <span aria-hidden="true">✎</span>
                    </button>
                    <button
                      title={"Delete debt"}
                      aria-label={"Delete debt"}
                      style={{ color: "var(--danger)", fontWeight: 700, minHeight: 26, padding: "0 8px", fontSize: 12 }}
                      onClick={async () => {
                        const updated = await api.deleteDebt(d.id);
                        setData(updated);
                      }}
                    >
                      {"x"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              {"No debts yet."}
            </div>
          )}
        </div>
        <VacationsPanel
          vacations={vacationsThisMonth}
          avgDailyEarnings={avgDailyEarnings}
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
        {budget && (
          <>
            <div><b>{"Until next salary:"}</b> {budget.next_salary_date ? (() => {
            const nd = new Date(budget.next_salary_date);
            const td = new Date();
            const nd0 = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate());
            const td0 = new Date(td.getFullYear(), td.getMonth(), td.getDate());
            const diff = Math.round((nd0.getTime() - td0.getTime()) / (1000 * 60 * 60 * 24));
            return diff >= 0 ? `${diff} ${"days"}` : `0 ${"days"}`;
          })() : "not set"}</div>
            <div><b>{"Available:"}</b> {rub(budget.available)}</div>
            <div><b>{"Daily spend limit:"}</b> {rub(budget.per_day)}</div>
          </>
        )}
        <div style={{ marginTop: 12, flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <b>{"Transactions for"} {selectedDate}:</b>

          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              flex: "1 1 auto",
              minHeight: 0,
              overflowY: "auto",
              paddingRight: 6,
            }}
          >
            {salaryForSelectedDate ? (
              <div
                key={"salary"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  border: "1px solid #eee",
                  borderRadius: 10,
                  padding: "6px 8px",
                  background: "#fff",
                }}
              >
                <div>
                  <div style={{ fontSize: 12 }}>
                    <b>+ </b> {salaryForSelectedDate.title}  -  {rub(salaryForSelectedDate.amount)}
                  </div>
                </div>

              </div>
            ) : null}

            {plannedAfterExpensesForSelectedDate !== null ? (
              <div
                key={"planned-after-expenses"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  border: "1px solid #eee",
                  borderRadius: 10,
                  padding: "6px 8px",
                  background: "#fff",
                }}
              >
                <div style={{ fontSize: 12 }}>
                  <b>{"After planned expenses"}</b>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {rub(plannedAfterExpensesForSelectedDate)}
                </div>
              </div>
            ) : null}

            {afterVacationForSelectedDate !== null ? (
              <div
                key={"after-vacation"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  border: "1px solid #eee",
                  borderRadius: 10,
                  padding: "6px 8px",
                  background: "#fff",
                }}
              >
                <div style={{ fontSize: 12 }}>
                  <b>{"After vacation"}</b>
                  <span style={{ marginLeft: 8, opacity: 0.75 }}>
                    {`(-${rub(afterVacationForSelectedDate.vacationDeduction)}, ${afterVacationForSelectedDate.vacationDays}d${afterVacationForSelectedDate.basedOnPlannedAfterExpenses ? ", incl. planned" : ""})`}
                  </span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {rub(afterVacationForSelectedDate.amount)}
                </div>
              </div>
            ) : null}

            {(data?.transactions ?? [])
              .filter((t) => t.date === selectedDate)
              .map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      border: "1px solid #eee",
                      borderRadius: 10,
                      padding: "6px 8px",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12 }}>
                        <b>{t.type === "income" ? "+" : t.type === "planned_expense" ? "P" : "-"}</b> {rub(t.amount)}  -  {t.category}
                        {t.debt_person ? (
                          <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.75 }}>
                            {"to"}: {t.debt_person}
                          </span>
                        ) : null}
                        {t.type === "planned_expense" ? (
                          <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.75 }}>{"(planned)"}</span>
                        ) : null}
                      </div>
                      {t.note ? <div style={{ fontSize: 12, opacity: 0.7 }}>{t.note}</div> : null}
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                      {t.type === "planned_expense" ? (
                        <button
                          title={"Paid"}
                          aria-label={"Paid"}
                          style={{ color: "#138a36", fontWeight: 700, minHeight: 26, padding: "0 8px", fontSize: 16, lineHeight: 1 }}
                          onClick={async () => {
                            const updated = await api.updateTransaction({
                              ...t,
                              type: "expense",
                            });
                            setData(updated);
                          }}
                        >
                          ✓
                        </button>
                      ) : null}
                      <button
                        className="edit-pencil-btn"
                        title={"Edit"}
                        aria-label={"Edit"}
                        style={{ width: 26, minWidth: 26, minHeight: 26, borderRadius: 8 }}
                        onClick={async () => {
                          if (!data) return;

                          const newAmountStr = prompt("New amount (RUB):", String(t.amount / 100));
                          if (!newAmountStr) return;

                          const newCategory = prompt("Category:", t.category) ?? t.category;
                          const newNote = prompt("Comment:", t.note) ?? t.note;

                          const updated = await api.updateTransaction({
                            ...t,
                            amount: toKop(newAmountStr),
                            category: newCategory,
                            note: newNote,
                          });
                          setData(updated);
                        }}
                      >
                        <span aria-hidden="true">✎</span>
                      </button>

                      <button
                        title={"Delete"}
                        aria-label={"Delete"}
                        style={{ color: "var(--danger)", fontWeight: 700, minHeight: 26, padding: "0 8px", fontSize: 12 }}
                        onClick={async () => {
                          const updated = await api.deleteTransaction(t.id);
                          setData(updated);
                        }}
                      >
                        x
                      </button>
                    </div>
                  </div>
              ))}
          </div>
        </div>
        </div>

        <div className="surface" style={{ width: "100%", boxSizing: "border-box" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <b>{"Top categories this month"}</b>
          </div>

          {topExpenseCategoriesThisMonth.length > 0 ? (
            <div className="panel-list"
              style={{
                marginTop: 8,
                maxHeight: 120,
                overflowY: "auto",
                paddingRight: 4,
              }}
            >
              {topExpenseCategoriesThisMonth.map((item, idx) => (
                <div className="panel-item"
                  key={item.category}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 8px",
                    fontSize: 12,
                  }}
                >
                  <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <b>{idx + 1}.</b> {item.category}
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <b>{rub(item.amount)}</b>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              {"No category expenses yet this month."}
            </div>
          )}
        </div>


      </div>

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
          const vacForDay = (data?.vacations ?? []).find(v => v.start_date <= d && d <= v.end_date) ?? null;
          const offForDay = (data?.offDays ?? []).find(o => o.date === d) ?? null;

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
                setSelectedDate(d);
                setDayMenuOpen(null);
                setDayMenuAnchorRect(null);
                if (isPickingCustomWorkDays) {
                  toggleCustomWorkingDay(d);
                  return;
                }
                if (isPickingVacationStart) {
                  setIsPickingVacationStart(false);
                  setIsPickingVacationEnd(true);
                  setVacationStartDate(d);
                  return;
                }
                if (isPickingVacationEnd) {
                  if (!vacationStartDate) {
                    setIsPickingVacationEnd(false);
                    return;
                  }
                  setIsPickingVacationEnd(false);
                  setVacationStartDate(null);
                  openVacationModal(vacationStartDate, d);
                  return;
                }
                if (isPickingSalaryDate) {
                  setIsPickingSalaryDate(false);
                  openSalaryModal(d);
                }
              }}
              style={{
                position: 'relative',
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
              <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 10 }} data-day-menu="true">
                <button
                  aria-label={"Menu"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedDate(d);
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
                  ⋯
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
                        setSelectedDate(d);
                        openTxModal("income", d);
                        setDayMenuOpen(null);
                      }}
                    >
                      {"Add income"}
                    </button>
                    {!isFutureDate ? (
                      <button
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        onClick={() => {
                          setSelectedDate(d);
                          openTxModal("expense", d);
                          setDayMenuOpen(null);
                        }}
                      >
                        {"Add expense"}
                      </button>
                    ) : null}
                    <button
                      style={{ fontSize: 12, padding: "4px 8px" }}
                      onClick={() => {
                        setSelectedDate(d);
                        openTxModal("planned_expense", d);
                        setDayMenuOpen(null);
                      }}
                    >
                      {"Planned expense"}
                    </button>
                    <div style={{ height: 1, background: "#eee", margin: "4px 0" }} />
                    <button
                      style={{ fontSize: 12, padding: "4px 8px" }}
                      onClick={async () => {
                        try {
                          const makeWorking = !effectiveWorking;
                          if (workSchedule === "custom") {
                            const updated = await api.upsertOffDay({
                              id: offForDay?.id ?? "",
                              date: d,
                              note: offForDay?.note ?? "",
                              is_working: makeWorking,
                            });
                            setData(updated);
                          } else {
                            if (isWeekend) {
                              if (makeWorking) {
                                const updated = await api.upsertOffDay({ id: offForDay?.id ?? "", date: d, note: offForDay?.note ?? "", is_working: true });
                                setData(updated);
                              } else if (offForDay) {
                                const updated = await api.deleteOffDay(offForDay.id);
                                setData(updated);
                              }
                            } else {
                              if (!makeWorking) {
                                const updated = await api.upsertOffDay({ id: offForDay?.id ?? "", date: d, note: offForDay?.note ?? "", is_working: false });
                                setData(updated);
                              } else if (offForDay) {
                                const updated = await api.deleteOffDay(offForDay.id);
                                setData(updated);
                              }
                            }
                          }
                        } catch (err) {
                          console.error('day menu update failed', err);
                          alert(String(err));
                        }
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




    </div>
  );
}
