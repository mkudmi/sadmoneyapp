import { useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { api, AppData, Debt, Transaction } from "./lib/api";
import { rub, toKop } from "./lib/money";

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ymFromYmd(s: string) {
  return s.slice(0, 7); // "YYYY-MM"
}

function parseYmdLocal(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function capitalizeFirst(s: string) {
  if (!s) return s;
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

function getRecurringSalaryDays(salaryDates: string[]) {
  return Array.from(
    new Set(
      salaryDates
        .map((date) => Number(date.slice(8, 10)))
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31)
    )
  ).sort((a, b) => a - b);
}

function findFollowingSalaryDate(nextSalaryDate: string, salaryDates: string[]) {
  const knownNext = salaryDates
    .filter((date) => date > nextSalaryDate)
    .sort((a, b) => a.localeCompare(b))[0] ?? null;
  if (knownNext) return knownNext;

  const recurringDays = getRecurringSalaryDays(salaryDates);
  if (recurringDays.length === 0) return null;

  const base = parseYmdLocal(nextSalaryDate);
  const candidates: string[] = [];

  for (let monthOffset = 0; monthOffset <= 2; monthOffset++) {
    const y = base.getFullYear();
    const m = base.getMonth() + monthOffset;
    const expectedMonth0 = ((m % 12) + 12) % 12;

    for (const day of recurringDays) {
      const candidate = new Date(y, m, day);
      if (candidate.getMonth() !== expectedMonth0) continue;

      const candidateYmd = ymd(candidate);
      if (candidateYmd > nextSalaryDate) candidates.push(candidateYmd);
    }
  }

  return candidates.sort((a, b) => a.localeCompare(b))[0] ?? null;
}


function daysInMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

export default function App() {
  type Lang = "en" | "ru";
  const [data, setData] = useState<AppData | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [year, setYear] = useState(new Date().getFullYear());
  const [month0, setMonth0] = useState(new Date().getMonth()); // 0..11
  const [selectedDate, setSelectedDate] = useState(ymd(new Date()));
  const today = ymd(new Date());
  const [budget, setBudget] = useState<{ per_day: number; days: number; next_salary_date: string | null; available: number } | null>(null);
  const monthKey = `${year}-${String(month0 + 1).padStart(2, "0")}`; // "YYYY-MM"
  const salaryThisMonth = (data?.salaryEvents ?? [])
    .filter(s => ymFromYmd(s.date) === monthKey)
    .sort((a, b) => a.date.localeCompare(b.date));
  const topExpenseCategoriesThisMonth = useMemo(() => {
    if (!data) return [] as Array<{ category: string; amount: number }>;

    const byCategory = new Map<string, number>();
    for (const t of data.transactions) {
      if (t.type !== "expense") continue;
      if (ymFromYmd(t.date) !== monthKey) continue;
      const category = (t.category || "").trim() || tr("No category", "Без категории");
      byCategory.set(category, (byCategory.get(category) ?? 0) + t.amount);
    }

    return Array.from(byCategory.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [data, monthKey]);

  const [workSchedule, setWorkSchedule] = useState<'5/2' | 'custom'>('5/2');
  const [vacationDaysCount, setVacationDaysCount] = useState("");
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const tr = (en: string, ru: string) => (lang === "ru" ? ru : en);
  const vacationDaysLeft = useMemo(() => {
    const total = Number.parseInt(vacationDaysCount, 10);
    if (!Number.isFinite(total) || total <= 0) return 0;
    if (!data) return total;

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const usedDays = new Set<string>();

    for (const v of data.vacations ?? []) {
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
      // считаем только операции не позже сегодняшней даты
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
    // Сумма зарплат/авансов за последние 12 месяцев, делённая на число отработанных дней
    // (исключаем выходные, отпуска и пользовательские нерабочие дни)
    if (!data) return 0;
    const end = new Date(today);
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);

    // Суммируем все зарплатные события в диапазоне
    let total = 0;
    for (const s of data.salaryEvents ?? []) {
      const sd = new Date(s.date);
      if (sd >= start && sd <= end) total += s.amount;
    }

    // Считаем количество рабочих дней в диапазоне
    const vacations = data.vacations ?? [];
    const offDays = data.offDays ?? [];
    let workedDays = 0;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const y = ymd(d);
      const day = d.getDay(); // 0 = Sun, 6 = Sat

      // исключаем отпуска в любом случае
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
        // Выходной по календарю: учитываем только если явно помечен как рабочий
        if (off && off.is_working) {
          workedDays++;
        } else {
          continue;
        }
      } else {
        // Рабочий день по календарю: исключаем только если явно помечен как нерабочий
        if (off && !off.is_working) continue;
        workedDays++;
      }
    }

    if (workedDays === 0) return 0;
    // Возвращаем средний в копейках
    return Math.round(total / workedDays);
  }, [data, today]);

  useEffect(() => {
    api.getData().then(setData);
  }, []);

  useEffect(() => {
    const saved = data?.settings?.language;
    if (saved === "ru" || saved === "en") setLang(saved);
  }, [data?.settings?.language]);

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

  // Формируем ячейки для сетки: делаем так, чтобы неделя начиналась с понедельника и заканчивалась воскресеньем
  const firstDayJs = new Date(year, month0, 1).getDay(); // 0 = Sun .. 6 = Sat
  const leadingEmpty = (firstDayJs + 6) % 7; // convert to Mon=0..Sun=6
  const totalCells = leadingEmpty + monthDays.length;
  const trailing = (7 - (totalCells % 7)) % 7;
  const gridCells = [
    ...Array(leadingEmpty).fill(null),
    ...monthDays,
    ...Array(trailing).fill(null),
  ];

  const sumsByDate = useMemo(() => {
    const map = new Map<string, { inc: number; exp: number }>();
    if (!data) return map;
    for (const t of data.transactions) {
      const cur = map.get(t.date) ?? { inc: 0, exp: 0 };
      if (t.type === "income") cur.inc += t.amount;
      if (t.type === "expense" || t.type === "planned_expense") cur.exp += t.amount;
      map.set(t.date, cur);
    }

    // Добавляем зарплатные события как доход того дня
    for (const s of data.salaryEvents ?? []) {
      const cur = map.get(s.date) ?? { inc: 0, exp: 0 };
      cur.inc += s.amount;
      map.set(s.date, cur);
    }

    return map;
  }, [data]);

  const salaryForSelectedDate = (data?.salaryEvents ?? []).find(s => s.date === selectedDate) ?? null;
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

  useEffect(() => {
    if (!txCategoryMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && tgt.closest("[data-tx-category]")) return;
      setTxCategoryMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setTxCategoryMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [txCategoryMenuOpen]);

  useEffect(() => {
    if (!settingsMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && tgt.closest("[data-settings-menu]")) return;
      setSettingsMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSettingsMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [settingsMenuOpen]);

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
      : [tr("Groceries", "Продукты"), tr("Fuel", "Бензин")];
  }, [data, lang]);

  const incomeCategories = useMemo(() => {
    const defaults = [
      tr("Salary", "Зарплата"),
      tr("Advance", "Аванс"),
      tr("Side job", "Подработка"),
      tr("Cashback", "Кэшбэк"),
    ];
    const fromTx = (data?.transactions ?? [])
      .filter((t) => t.type === "income")
      .map((t) => normalizeCategoryInput(t.category))
      .filter((c) => c.length > 0);

    return Array.from(new Set([...defaults, ...fromTx]));
  }, [data, lang]);

  const expenseCategoriesWithDebt = useMemo(() => {
    const debtCategory = tr("Debt", "Долг");
    if (expenseCategories.some((c) => normalizeCategoryInput(c).toLowerCase() === normalizeCategoryInput(debtCategory).toLowerCase())) {
      return expenseCategories;
    }
    return [...expenseCategories, debtCategory];
  }, [expenseCategories, lang]);

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

  function normalizeCategoryInput(raw: string) {
    const s0 = raw.trim().replace(/\s+/g, " ");
    if (!s0) return "";

    const cap = (seg: string) => {
      if (!seg) return "";
      return seg.slice(0, 1).toUpperCase() + seg.slice(1).toLowerCase();
    };

    return s0
      .split(" ")
      .map((w) => w.split("-").map(cap).join("-"))
      .join(" ");
  }

  function txModalTitle(type: "income" | "expense" | "planned_expense") {
    if (type === "income") return tr("Add income", "Добавить доход");
    if (type === "planned_expense") return tr("Add planned expense", "Добавить запланированный расход");
    return tr("Add expense", "Добавить расход");
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

  function isDebtCategory(categoryRaw: string) {
    const normalized = normalizeCategoryInput(categoryRaw).toLowerCase();
    const en = normalizeCategoryInput("Debt").toLowerCase();
    const ru = normalizeCategoryInput("Долг").toLowerCase();
    return normalized === en || normalized === ru;
  }

  async function submitTxModal() {
    const category = normalizeCategoryInput(txModalCategory);
    const debtPerson = normalizeCategoryInput(txModalDebtPerson);
    const shouldUseDebtPerson = txModalType === "expense" && isDebtCategory(category);
    if (!txModalAmount.trim()) return;
    if (!category) return;
    if (shouldUseDebtPerson && !debtPerson) return;

    try {
      const tx: Transaction = {
        id: "",
        date: txModalDate,
        type: txModalType,
        amount: toKop(txModalAmount),
        category,
        note: "",
        debt_person: shouldUseDebtPerson ? debtPerson : null,
      };

      if (tx.amount <= 0) return;

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
    setIsPickingCustomWorkDays(false);
    setSalaryModalOpen(false);
    setDayMenuOpen(null);
    setDayMenuAnchorRect(null);
  }

  function openSalaryModal(date: string) {
    setSalaryModalDate(date);
    setSalaryModalAmount("");
    setSalaryModalTitle(tr("Salary", "Зарплата"));
    setSalaryModalOpen(true);
  }

  function closeSalaryModal() {
    setSalaryModalOpen(false);
    setSalaryModalAmount("");
    setSalaryModalTitle(tr("Salary", "Зарплата"));
  }

  async function submitSalaryModal() {
    const amount = toKop(salaryModalAmount);
    const title = salaryModalTitle.trim() || tr("Salary", "Зарплата");
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

  async function beginAddVacation() {
    if (isPickingCustomWorkDays) {
      await saveCustomSchedule();
    }
    setIsPickingSalaryDate(false);
    setIsPickingVacationStart(true);
    setIsPickingVacationEnd(false);
    setVacationStartDate(null);
    setSalaryModalOpen(false);
    setVacationModalOpen(false);
    setIsPickingCustomWorkDays(false);
    setDayMenuOpen(null);
    setDayMenuAnchorRect(null);
  }

  function cancelVacationPicking() {
    setIsPickingVacationStart(false);
    setIsPickingVacationEnd(false);
    setVacationStartDate(null);
  }

  function openVacationModal(startDate: string, endDate: string) {
    const start = startDate <= endDate ? startDate : endDate;
    const end = startDate <= endDate ? endDate : startDate;
    setVacationModalStart(start);
    setVacationModalEnd(end);
    setVacationModalTitle(tr("Vacation", "Отпуск"));
    setVacationModalOpen(true);
  }

  function closeVacationModal() {
    setVacationModalOpen(false);
    setVacationModalTitle(tr("Vacation", "Отпуск"));
  }

  async function submitVacationModal() {
    const title = vacationModalTitle.trim() || tr("Vacation", "Отпуск");

    try {
      const updated = await api.upsertVacation({
        id: "",
        start_date: vacationModalStart,
        end_date: vacationModalEnd,
        title,
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
        title: tr("Select backup folder", "Выберите папку для бэкапа"),
      });
      if (!dir || Array.isArray(dir)) return;
      const savedPath = await api.saveBackupToDir(String(dir), `sadmoney-backup-${ts}.json`);
      alert(`${tr("Backup saved", "Бэкап сохранён")}: ${savedPath}`);
    } catch (err) {
      alert(String(err));
    }
  }

  async function importBackupFile() {
    try {
      const path = await open({
        directory: false,
        multiple: false,
        title: tr("Select backup file", "Выберите файл бэкапа"),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path || Array.isArray(path)) return;
      const updated = await api.importBackupFromPath(String(path));
      setData(updated);
      alert(tr("Backup imported", "Бэкап импортирован"));
    } catch (err) {
      alert(`${tr("Failed to import backup", "Не удалось импортировать бэкап")}: ${String(err)}`);
    }
  }

  async function checkForUpdates() {
    if (isCheckingUpdates) return;

    setIsCheckingUpdates(true);
    try {
      const update = await check();
      if (!update) {
        alert(tr("No updates found", "Обновлений не найдено"));
        return;
      }

      await update.downloadAndInstall();
      const shouldRelaunch = window.confirm(tr("Update downloaded. Restart to apply it?", "Обновление скачано. Перезапустить для обновления?"));
      if (shouldRelaunch) {
        await relaunch();
      }
    } catch (err) {
      alert(`${tr("Failed to check updates", "Не удалось проверить обновления")}: ${String(err)}`);
    } finally {
      setIsCheckingUpdates(false);
    }
  }

  
  async function changeLanguage(next: Lang) {
    setLang(next);
    try {
      const updated = await api.setLanguage(next);
      setData(updated);
    } catch (err) {
      alert(`${tr("Failed to change language", "Не удалось сменить язык")}: ${String(err)}`);
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

  return (


    <div
      style={{
        height: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: 12,
        boxSizing: "border-box",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <button onClick={prevMonth}>←</button>
        <h2 style={{ margin: 0 }}>
          {capitalizeFirst(new Date(year, month0, 1).toLocaleString(locale, { month: "long", year: "numeric" }))}
        </h2>
        <button onClick={nextMonth}>→</button>
        <div style={{ marginLeft: "auto", position: "relative" }} data-settings-menu="true">
          <button
            aria-label="Settings"
            onClick={() => setSettingsMenuOpen((v) => !v)}
            style={{ width: 36, height: 36, display: "grid", placeItems: "center" }}
          >
            {"\u2699"}
          </button>
          {settingsMenuOpen ? (
            <div
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
                padding: 8,
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "#fff",
                boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
              }}
            >
              <button
                onClick={async () => {
                  await exportBackupFile();
                  setSettingsMenuOpen(false);
                }}
              >
                {tr("Export backup", "Экспорт бэкапа")}
              </button>
              <button
                onClick={async () => {
                  await importBackupFile();
                  setSettingsMenuOpen(false);
                }}
              >
                {tr("Import backup", "Импорт бэкапа")}
              </button>
              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 2px" }}>
                <span style={{ fontSize: 12, opacity: 0.85 }}>{tr("Language", "Язык")}</span>
                <select
                  value={lang}
                  onChange={async (e) => {
                    await changeLanguage(e.target.value as Lang);
                  }}
                >
                  <option value="en">English</option>
                  <option value="ru">Русский</option>
                </select>
              </label>
              <button
                onClick={async () => {
                  setSettingsMenuOpen(false);
                  await checkForUpdates();
                }}
                disabled={isCheckingUpdates}
              >
                {isCheckingUpdates ? tr("Checking updates...", "Проверяем обновления...") : tr("Check for updates", "Проверить обновления")}
              </button>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                {tr("Version", "Версия")}: {appVersion}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 380px", minWidth: 320 }}>
          <div style={{ opacity: 0.9, marginBottom: 6 }}><b>{tr("Received this month (as of today):", "Получено в этом месяце (на сегодня):")}</b> {rub(monthTotals.inc)}</div>
          <div style={{ opacity: 0.9, marginBottom: 6 }}><b>{tr("Spent this month (as of today):", "Потрачено в этом месяце (на сегодня):")}</b> {rub(monthTotals.exp)}</div>
          <div style={{ opacity: 0.9, marginBottom: 6 }}><b>{tr("Average daily earnings:", "Среднедневной заработок:")}</b> {rub(avgDailyEarnings)}</div>
          <div style={{ opacity: 0.8 }}>
            <b>{tr("Today:", "Сегодня:")}</b>{" "}
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
              {tr("Go to today", "Перейти к сегодня")}
            </button>
          </div>
          <div
            style={{
              marginTop: 8,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "#f8f8f8",
            }}
          >
            <span style={{ fontSize: 12, opacity: 0.9 }}>{tr("Vacation days count", "Кол-во дней отпуска")}</span>
            <input
              type="number"
              min={0}
              step={1}
              value={vacationDaysCount}
              onChange={(e) => setVacationDaysCount(e.target.value)}
              style={{
                width: 56,
                padding: "4px 6px",
                borderRadius: 6,
                border: "1px solid #ccc",
                fontSize: 12,
              }}
            />
            <span style={{ fontSize: 12, opacity: 0.9, whiteSpace: "nowrap" }}>
              {tr("Days Left", "Осталось дней")}: <b>{vacationDaysLeft}</b>
            </span>
          </div>
        </div>

        <div style={{ flex: "0 0 auto", marginLeft: "auto", textAlign: "right" }}>
          <label style={{ opacity: 0.85 }}>
            <b>{tr("Work schedule:", "График работы:")}</b>{" "}
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
              <option value="custom">{tr("Custom", "Кастомный")}</option>
            </select>
          </label>
          {isPickingCustomWorkDays ? (
            <div style={{ marginTop: 8, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={saveCustomSchedule}>{tr("Exit", "Выйти")}</button>
              <button onClick={saveCustomSchedule}>{tr("Save", "Сохранить")}</button>
            </div>
          ) : null}
          {isPickingCustomWorkDays ? (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
              {tr("Mark working days in the calendar", "Отметьте рабочие дни в календаре")}
            </div>
          ) : null}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
          marginBottom: 12,
          alignItems: "start",
        }}
      >
        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <b>{tr("Debts", "Долги")}</b>
            <button
              onClick={() => openDebtModal()}
              title={tr("Add debt", "Добавить долг")}
              aria-label={tr("Add debt", "Добавить долг")}
              style={{ minWidth: 28, fontWeight: 700 }}
            >
              +
            </button>
          </div>
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            <b>{tr("Total:", "Итого:")}</b> {rub(totalDebt)}
          </div>
          {debts.length > 0 ? (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                maxHeight: 120,
                overflowY: "auto",
                paddingRight: 4,
              }}
            >
              {debts.map((d) => (
                <div
                  key={d.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    border: "1px solid #eee",
                    borderRadius: 8,
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
                      title={tr("Edit debt", "Редактировать долг")}
                      aria-label={tr("Edit debt", "Редактировать долг")}
                      style={{ color: "#444", fontWeight: 700 }}
                      onClick={() => openDebtModal(d)}
                    >
                      ✎
                    </button>
                    <button
                      title={tr("Delete debt", "Удалить долг")}
                      aria-label={tr("Delete debt", "Удалить долг")}
                      style={{ color: "#c51616", fontWeight: 700 }}
                      onClick={async () => {
                        const updated = await api.deleteDebt(d.id);
                        setData(updated);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              {tr("No debts yet.", "Пока нет долгов.")}
            </div>
          )}
        </div>

        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <b>{tr("Vacations this month", "Отпуска в этом месяце")}</b>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {isPickingVacationStart ? (
                <span style={{ fontSize: 12, opacity: 0.8 }}>{tr("Pick a start date in the calendar", "Выберите дату начала в календаре")}</span>
              ) : null}
              {isPickingVacationEnd ? (
                <span style={{ fontSize: 12, opacity: 0.8 }}>{tr("Pick an end date in the calendar", "Выберите дату окончания в календаре")}</span>
              ) : null}
              {(isPickingVacationStart || isPickingVacationEnd) ? (
                <button onClick={cancelVacationPicking}>{tr("Cancel", "Отмена")}</button>
              ) : null}
              <button
                onClick={beginAddVacation}
                title={tr("Add vacation", "Добавить отпуск")}
                aria-label={tr("Add vacation", "Добавить отпуск")}
                style={{ minWidth: 28, fontWeight: 700 }}
              >
                +
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            {((data?.vacations ?? []).filter(v => {
              const monthStart = `${monthKey}-01`;
              const monthEnd = `${monthKey}-${String(daysInMonth(year, month0)).padStart(2, "0")}`;
              return v.start_date <= monthEnd && v.end_date >= monthStart;
            })).length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {((data?.vacations ?? []).filter(v => {
                  const monthStart = `${monthKey}-01`;
                  const monthEnd = `${monthKey}-${String(daysInMonth(year, month0)).padStart(2, "0")}`;
                  return v.start_date <= monthEnd && v.end_date >= monthStart;
                })).map((v) => (
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
                        <b>{v.start_date}</b> — <b>{v.end_date}</b> — {v.title}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        title={tr("Edit vacation", "Редактировать отпуск")}
                        aria-label={tr("Edit vacation", "Редактировать отпуск")}
                        style={{ color: "#444", fontWeight: 700 }}
                        onClick={async () => {
                          const newStart = prompt(tr("Start date (YYYY-MM-DD):", "Дата начала (YYYY-MM-DD):"), v.start_date) ?? v.start_date;
                          const newEnd = prompt(tr("End date (YYYY-MM-DD):", "Дата окончания (YYYY-MM-DD):"), v.end_date) ?? v.end_date;
                          const newTitle = prompt(tr("Title:", "Название:"), v.title) ?? v.title;

                          const updated = await api.upsertVacation({
                            ...v,
                            start_date: newStart,
                            end_date: newEnd,
                            title: newTitle,
                          });
                          setData(updated);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        title={tr("Delete vacation", "Удалить отпуск")}
                        aria-label={tr("Delete vacation", "Удалить отпуск")}
                        style={{ color: "#c51616", fontWeight: 700 }}
                        onClick={async () => {
                          const updated = await api.deleteVacation(v.id);
                          setData(updated);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b>{tr("Salaries this month", "Зарплаты в этом месяце")}</b>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {isPickingSalaryDate ? (
                <span style={{ fontSize: 12, opacity: 0.8 }}>{tr("Pick a date in the calendar", "Выберите дату в календаре")}</span>
              ) : null}
              {isPickingSalaryDate ? (
                <button onClick={() => setIsPickingSalaryDate(false)}>{tr("Cancel", "Отмена")}</button>
              ) : null}
              <button
                onClick={beginAddSalary}
                title={tr("Add salary", "Добавить зарплату")}
                aria-label={tr("Add salary", "Добавить зарплату")}
                style={{ minWidth: 28, fontWeight: 700 }}
              >
                +
              </button>
            </div>
          </div>

          {salaryThisMonth.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {salaryThisMonth.map((s) => (
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
                      <b>{s.date}</b> — {s.title} — {rub(s.amount)}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      title={tr("Edit salary", "Редактировать зарплату")}
                      aria-label={tr("Edit salary", "Редактировать зарплату")}
                      style={{ color: "#444", fontWeight: 700 }}
                      onClick={async () => {
                        const newDate = prompt(tr("Date (YYYY-MM-DD):", "Дата (YYYY-MM-DD):"), s.date) ?? s.date;
                        const newAmountStr = prompt(tr("Amount (RUB):", "Сумма (руб):"), String(s.amount / 100)) ?? String(s.amount / 100);
                        const newTitle = prompt(tr("Title:", "Название:"), s.title) ?? s.title;

                        const updated = await api.upsertSalaryEvent({
                          ...s,
                          date: newDate,
                          amount: toKop(newAmountStr),
                          title: newTitle,
                        });
                        setData(updated);
                      }}
                    >
                      ✎
                    </button>

                    <button
                      title={tr("Delete salary", "Удалить зарплату")}
                      aria-label={tr("Delete salary", "Удалить зарплату")}
                      style={{ color: "#c51616", fontWeight: 700 }}
                      onClick={async () => {
                        if (!confirm(tr("Delete salary date?", "Удалить зарплатную дату?"))) return;
                        const updated = await api.deleteSalaryEvent(s.id);
                        setData(updated);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <b>{tr("Top categories this month", "Топ категорий за месяц")}</b>
          </div>

          {topExpenseCategoriesThisMonth.length > 0 ? (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                maxHeight: 120,
                overflowY: "auto",
                paddingRight: 4,
              }}
            >
              {topExpenseCategoriesThisMonth.map((item, idx) => (
                <div
                  key={item.category}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    border: "1px solid #eee",
                    borderRadius: 8,
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
              {tr("No category expenses yet this month.", "В этом месяце пока нет расходов по категориям.")}
            </div>
          )}
        </div>
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
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 12,
            marginBottom: 12,
            flex: "1 1 220px",
            minWidth: 240,
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
          }}
        >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div><b>{tr("Selected date:", "Выбранная дата:")}</b> {selectedDate}</div>
          <div
            style={{
              fontSize: 12,
              padding: "2px 8px",
              borderRadius: 999,
              border: `1px solid ${vacationForSelectedDate ? "#a37500" : (selectedDateIsWorking ? "#1c7f4d" : "#bf3a3a")}`,
              color: vacationForSelectedDate ? "#7a5200" : (selectedDateIsWorking ? "#1c7f4d" : "#bf3a3a"),
              background: vacationForSelectedDate ? "rgba(255, 223, 99, 0.25)" : (selectedDateIsWorking ? "rgba(30, 160, 90, 0.10)" : "rgba(210, 20, 20, 0.08)"),
            }}
          >
            {vacationForSelectedDate ? tr("Vacation", "Отпуск") : (selectedDateIsWorking ? tr("Working", "Рабочий") : tr("Day off", "Выходной"))}
          </div>
        </div>
        {budget && (
          <>
            <div><b>{tr("Until next salary:", "До следующей зарплаты:")}</b> {budget.next_salary_date ? (() => {
            const nd = new Date(budget.next_salary_date);
            const td = new Date();
            const nd0 = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate());
            const td0 = new Date(td.getFullYear(), td.getMonth(), td.getDate());
            const diff = Math.round((nd0.getTime() - td0.getTime()) / (1000 * 60 * 60 * 24));
            return diff >= 0 ? `${diff} ${tr("days", "дн.")}` : `0 ${tr("days", "дн.")}`;
          })() : tr("not set", "не задана")}</div>
            <div><b>{tr("Available:", "Доступно:")}</b> {rub(budget.available)}</div>
            <div><b>{tr("Daily spend limit:", "Можно тратить в день:")}</b> {rub(budget.per_day)}</div>
          </>
        )}
        <div style={{ marginTop: 12, flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <b>{tr("Transactions for", "Операции за")} {selectedDate}:</b>

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
                  padding: "8px 10px",
                  background: "#f8fdf8",
                }}
              >
                <div>
                  <div style={{ fontSize: 13 }}>
                    <b>+ </b> {salaryForSelectedDate.title} — {rub(salaryForSelectedDate.amount)}
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
                  padding: "8px 10px",
                  background: "#f7f9ff",
                }}
              >
                <div style={{ fontSize: 13 }}>
                  <b>{tr("After planned expenses", "После запланированных расходов")}</b>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  {rub(plannedAfterExpensesForSelectedDate)}
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
                      padding: "8px 10px",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13 }}>
                        <b>{t.type === "income" ? "+" : t.type === "planned_expense" ? "⏳" : "-"}</b> {rub(t.amount)} — {t.category}
                        {t.debt_person ? (
                          <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.75 }}>
                            {tr("to", "кому")}: {t.debt_person}
                          </span>
                        ) : null}
                        {t.type === "planned_expense" ? (
                          <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.75 }}>{tr("(planned)", "(запланировано)")}</span>
                        ) : null}
                      </div>
                      {t.note ? <div style={{ fontSize: 12, opacity: 0.7 }}>{t.note}</div> : null}
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                      {t.type === "planned_expense" ? (
                        <button
                          title={tr("Paid", "Оплачено")}
                          aria-label={tr("Paid", "Оплачено")}
                          style={{ color: "#138a36", fontWeight: 700 }}
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
                        title={tr("Edit", "Редактировать")}
                        aria-label={tr("Edit", "Редактировать")}
                        style={{ color: "#444", fontWeight: 700 }}
                        onClick={async () => {
                          if (!data) return;

                          const newAmountStr = prompt(tr("New amount (RUB):", "Новая сумма (руб):"), String(t.amount / 100));
                          if (!newAmountStr) return;

                          const newCategory = prompt(tr("Category:", "Категория:"), t.category) ?? t.category;
                          const newNote = prompt(tr("Comment:", "Комментарий:"), t.note) ?? t.note;

                          const updated = await api.updateTransaction({
                            ...t,
                            amount: toKop(newAmountStr),
                            category: newCategory,
                            note: newNote,
                          });
                          setData(updated);
                        }}
                      >
                        ✎
                      </button>

                      <button
                        title={tr("Delete", "Удалить")}
                        aria-label={tr("Delete", "Удалить")}
                        style={{ color: "#c51616", fontWeight: 700 }}
                        onClick={async () => {
                          const updated = await api.deleteTransaction(t.id);
                          setData(updated);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
              ))}
          </div>
        </div>


      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
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
          alignContent: "start",
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
                  minHeight: 68,
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
          const tileBackground = isPickingCustomWorkDays
            ? (isCustomMarkedWorking ? "rgba(30, 160, 90, 0.18)" : "transparent")
            : isCustomMainView
              ? (isCustomNonWorking ? "rgba(210, 20, 20, 0.10)" : "#fff")
            : isCustomNonWorking
                ? "rgba(210, 20, 20, 0.10)"
              : weekendHighlight
                ? "rgba(255, 0, 0, 0.06)"
              : isToday
                ? "rgba(0, 200, 120, 0.08)"
              : vacationHighlight
                ? "rgba(255, 223, 99, 0.25)"
                : offDayHighlight
                  ? "rgba(255, 0, 0, 0.06)"
                  : "transparent";

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
                minHeight: 68,
              }}

            >
              {!isCalendarPickerFocus ? (
              <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 10 }} data-day-menu="true">
                <button
                  aria-label={tr("Menu", "Меню")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedDate(d);
                    openDayMenu(d, e.currentTarget);
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
                      borderRadius: 8,
                      border: "1px solid #ddd",
                      background: "#fff",
                      boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        setSelectedDate(d);
                        openTxModal("income", d);
                        setDayMenuOpen(null);
                      }}
                    >
                      {tr("Add income", "Добавить доход")}
                    </button>
                    {!isFutureDate ? (
                      <button
                        onClick={() => {
                          setSelectedDate(d);
                          openTxModal("expense", d);
                          setDayMenuOpen(null);
                        }}
                      >
                        {tr("Add expense", "Добавить расход")}
                      </button>
                    ) : null}
                    <button
                      onClick={() => {
                        setSelectedDate(d);
                        openTxModal("planned_expense", d);
                        setDayMenuOpen(null);
                      }}
                    >
                      {tr("Planned expense", "Запланированный расход")}
                    </button>
                    <div style={{ height: 1, background: "#eee", margin: "4px 0" }} />
                    <button
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
                      {effectiveWorking ? tr("Mark as day off", "Установить как выходной") : tr("Mark as working", "Установить как рабочий")}
                    </button>
                  </div>
                ) : null}
              </div>
              ) : null}

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 12, opacity: 0.7, fontWeight: isCustomMarkedWorking ? 700 : 400, color: isPickingCustomWorkDays ? (isCustomMarkedWorking ? '#17653e' : undefined) : (isCustomMainView ? (isCustomNonWorking ? '#b10000' : undefined) : (isCustomNonWorking ? '#b10000' : (vacationHighlight ? '#7a5200' : (weekendHighlight ? '#c00' : (offDayHighlight ? '#c00' : undefined)))) ) }}>{d.slice(8, 10)}</div>
                <div style={{ fontSize: 11, opacity: 0.7, color: isPickingCustomWorkDays ? (isCustomMarkedWorking ? '#17653e' : undefined) : (isCustomMainView ? (isCustomNonWorking ? '#b10000' : undefined) : (isCustomNonWorking ? '#b10000' : (vacationHighlight ? '#7a5200' : (weekendHighlight ? '#c00' : (offDayHighlight ? '#c00' : undefined)))) ) }}>{new Date(d).toLocaleDateString(locale, { weekday: "short" })}</div>
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
            style={{
              width: "min(520px, 100%)",
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #ddd",
              padding: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <b style={{ fontSize: 14 }}>
                {txModalTitle(txModalType)} — {txModalDate}
              </b>
              <button onClick={closeTxModal} aria-label={tr("Close", "Закрыть")}>✕</button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{tr("Amount (RUB)", "Сумма (руб)")}</div>
                <input
                  value={txModalAmount}
                  onChange={(e) => setTxModalAmount(e.target.value)}
                  placeholder={txModalType === "income" ? "1000" : "100"}
                  inputMode="decimal"
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>

              <div style={{ minWidth: 0 }} data-tx-category="true">
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{tr("Category", "Категория")}</div>
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={txModalCategory}
                      onChange={(e) => setTxModalCategory(e.target.value)}
                      onFocus={() => setTxCategoryMenuOpen(true)}
                      placeholder={txModalType === "income" ? tr("e.g. Salary", "Например: Зарплата") : tr("e.g. Groceries", "Например: Продукты")}
                      style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                    />
                    <button
                      type="button"
                      onClick={() => setTxCategoryMenuOpen((v) => !v)}
                      aria-label={tr("Show category list", "Показать список категорий")}
                    >▾</button>
                  </div>

                  {txCategoryMenuOpen && txCategoryOptions.length > 0 ? (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 4px)",
                        left: 0,
                        right: 0,
                        zIndex: 20,
                        maxHeight: 180,
                        overflowY: "auto",
                        border: "1px solid #ddd",
                        borderRadius: 8,
                        background: "#fff",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
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
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{tr("To whom", "Кому")}</div>
                  <select
                    value={txModalDebtPerson}
                    onChange={(e) => setTxModalDebtPerson(e.target.value)}
                    style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                  >
                    <option value="">{tr("Select person", "Выберите человека")}</option>
                    {debtPeople.map((person) => (
                      <option key={person} value={person}>
                        {person}
                      </option>
                    ))}
                  </select>
                  {debtPeople.length === 0 ? (
                    <div style={{ marginTop: 4, fontSize: 11, opacity: 0.75 }}>
                      {tr("Add a debt in the Debts card first.", "Сначала добавьте долг в плашке «Долги».")}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={closeTxModal}>{tr("Cancel", "Отмена")}</button>
              <button onClick={submitTxModal}>{txModalTitle(txModalType)}</button>
            </div>
          </div>
        </div>
      ) : null}

      {debtModalOpen ? (
        <div
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
            style={{
              width: "min(460px, 100%)",
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #ddd",
              padding: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <b style={{ fontSize: 14 }}>
                {debtModalEditId ? tr("Edit debt", "Редактировать долг") : tr("Add debt", "Добавить долг")}
              </b>
              <button onClick={closeDebtModal} aria-label={tr("Close", "Закрыть")}>✕</button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{tr("Amount (RUB)", "Сумма (руб)")}</div>
                <input
                  value={debtModalAmount}
                  onChange={(e) => setDebtModalAmount(e.target.value)}
                  placeholder="1000"
                  inputMode="decimal"
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{tr("To whom you owe", "Кому должен")}</div>
                <input
                  value={debtModalPerson}
                  onChange={(e) => setDebtModalPerson(e.target.value)}
                  placeholder={tr("e.g. Ivan", "Например: Иван")}
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={closeDebtModal}>{tr("Cancel", "Отмена")}</button>
              <button onClick={submitDebtModal}>
                {debtModalEditId ? tr("Save", "Сохранить") : tr("Add debt", "Добавить долг")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {vacationModalOpen ? (
        <div
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
            style={{
              width: "min(520px, 100%)",
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #ddd",
              padding: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <b style={{ fontSize: 14 }}>
                {tr("Add vacation", "Добавить отпуск")} - {vacationModalStart} {"->"} {vacationModalEnd}
              </b>
              <button onClick={closeVacationModal} aria-label={tr("Close", "Закрыть")}>✕</button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{tr("Title", "Название")}</div>
                <input
                  value={vacationModalTitle}
                  onChange={(e) => setVacationModalTitle(e.target.value)}
                  placeholder={tr("Vacation", "Отпуск")}
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={closeVacationModal}>{tr("Cancel", "Отмена")}</button>
              <button onClick={submitVacationModal}>{tr("Add vacation", "Добавить отпуск")}</button>
            </div>
          </div>
        </div>
      ) : null}

      {salaryModalOpen ? (
        <div
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
            style={{
              width: "min(520px, 100%)",
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #ddd",
              padding: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <b style={{ fontSize: 14 }}>
                {tr("Add salary", "Добавить зарплату")} - {salaryModalDate}
              </b>
              <button onClick={closeSalaryModal} aria-label={tr("Close", "Закрыть")}>✕</button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{tr("Amount (RUB)", "Сумма (руб)")}</div>
                <input
                  value={salaryModalAmount}
                  onChange={(e) => setSalaryModalAmount(e.target.value)}
                  placeholder="80000"
                  inputMode="decimal"
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{tr("Title", "Название")}</div>
                <input
                  value={salaryModalTitle}
                  onChange={(e) => setSalaryModalTitle(e.target.value)}
                  placeholder={tr("Salary", "Зарплата")}
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={closeSalaryModal}>{tr("Cancel", "Отмена")}</button>
              <button onClick={submitSalaryModal}>{tr("Add salary", "Добавить зарплату")}</button>
            </div>
          </div>
        </div>
      ) : null}




    </div>
  );
}
