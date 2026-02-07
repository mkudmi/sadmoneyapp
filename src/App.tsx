import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, AppData, Transaction } from "./lib/api";
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


function daysInMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

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

  const [workSchedule, setWorkSchedule] = useState<'5/2' | 'custom'>('5/2');

  const monthTotals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    if (!data) return { inc, exp };

    for (const t of data.transactions) {
      if (ymFromYmd(t.date) !== monthKey) continue;
      // считаем только операции не позже сегодняшней даты
      if (t.date > today) continue;
      if (t.type === "income") inc += t.amount;
      else exp += t.amount;
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
      else cur.exp += t.amount;
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
  const isSelectedToday = selectedDate === today;

  const [dayMenuOpen, setDayMenuOpen] = useState<string | null>(null);
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txModalType, setTxModalType] = useState<"income" | "expense">("expense");
  const [txModalDate, setTxModalDate] = useState<string>(today);
  const [txModalAmount, setTxModalAmount] = useState<string>("");
  const [txModalCategory, setTxModalCategory] = useState<string>("");
  const [txCategoryMenuOpen, setTxCategoryMenuOpen] = useState(false);

  useEffect(() => {
    if (!dayMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && tgt.closest("[data-day-menu]")) return;
      setDayMenuOpen(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDayMenuOpen(null);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
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

  const expenseCategories = useMemo(() => {
    const fromData = data?.settings?.txCategories ?? [];
    return fromData.length > 0 ? fromData : ["Продукты", "Бензин"];
  }, [data]);

  const incomeCategories = useMemo(() => {
    const defaults = ["Зарплата", "Аванс", "Подработка", "Кэшбэк"];
    const fromTx = (data?.transactions ?? [])
      .filter((t) => t.type === "income")
      .map((t) => normalizeCategoryInput(t.category))
      .filter((c) => c.length > 0);

    return Array.from(new Set([...defaults, ...fromTx]));
  }, [data]);

  const activeTxCategories = txModalType === "income" ? incomeCategories : expenseCategories;

  const txCategoryOptions = useMemo(() => {
    const q = txModalCategory.trim().toLowerCase();
    if (!q) return activeTxCategories;
    return activeTxCategories.filter((c) => c.toLowerCase().includes(q));
  }, [activeTxCategories, txModalCategory]);

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

  function openTxModal(type: "income" | "expense", date: string) {
    setTxModalType(type);
    setTxModalDate(date);
    setTxModalAmount("");
    setTxModalCategory("");
    setTxCategoryMenuOpen(false);
    setTxModalOpen(true);
  }

  function closeTxModal() {
    setTxModalOpen(false);
    setTxModalAmount("");
    setTxModalCategory("");
    setTxCategoryMenuOpen(false);
  }

  async function submitTxModal() {
    const category = normalizeCategoryInput(txModalCategory);
    if (!txModalAmount.trim()) return;
    if (!category) return;

    try {
      const tx: Transaction = {
        id: "",
        date: txModalDate,
        type: txModalType,
        amount: toKop(txModalAmount),
        category,
        note: "",
      };

      if (tx.amount <= 0) return;

      const updated = await api.addTransaction(tx);
      setData(updated);
      closeTxModal();
    } catch (err) {
      alert(String(err));
    }
  }

  async function addSalaryEvent() {
    if (!data) return;

    const date = prompt("Дата зарплаты (YYYY-MM-DD):", `${monthKey}-05`);
    if (!date) return;

    const amountStr = prompt("Сумма (руб):", "80000");
    if (!amountStr) return;

    const title = prompt("Название (например: Зарплата/Аванс):", "Зарплата") ?? "Зарплата";

    const updated = await api.upsertSalaryEvent({
      id: "",
      date,
      amount: toKop(amountStr),
      title,
    });

    setData(updated);
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
      alert(`Backup saved: ${savedPath}`);
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
      alert(`Failed to import backup: ${String(err)}`);
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
          {new Date(year, month0, 1).toLocaleString("ru-RU", { month: "long", year: "numeric" })}
        </h2>
        <button onClick={nextMonth}>→</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={exportBackupFile}>Экспорт бекапа</button>
          <button onClick={importBackupFile}>Импорт бекапа</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
        <div style={{ opacity: 0.9 }}><b>Получено в этом месяце (на сегодня):</b> {rub(monthTotals.inc)}</div>
        <div style={{ opacity: 0.9 }}><b>Потрачено в этом месяце (на сегодня):</b> {rub(monthTotals.exp)}</div>
      </div>

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ opacity: 0.85 }}><b>График работы:</b></div>
        <select value={workSchedule} onChange={(e) => setWorkSchedule(e.target.value as any)}>
          <option value="5/2">5/2</option>
          <option value="custom">Кастомный (пока недоступен)</option>
        </select>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ opacity: 0.9 }}><b>Среднедневной заработок:</b> {rub(avgDailyEarnings)}</div>
      </div>

      <div style={{ marginBottom: 12, opacity: 0.8 }}>
        <b>Сегодня:</b>{" "}
        {new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })}
        <button
          style={{ marginLeft: 12 }}
          onClick={() => {
            const d = new Date();
            setYear(d.getFullYear());
            setMonth0(d.getMonth());
            setSelectedDate(ymd(d));
          }}
        >
          Перейти к сегодня
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 12,
          marginBottom: 12,
          alignItems: "start",
        }}
      >
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <b>Отпуска в этом месяце</b>
            <button onClick={async () => {
              if (!data) return;
              const start = prompt("Дата начала (YYYY-MM-DD):", `${monthKey}-10`);
              if (!start) return;
              const end = prompt("Дата окончания (YYYY-MM-DD):", `${monthKey}-14`);
              if (!end) return;
              const title = prompt("Название (например: Отпуск):", "Отпуск") ?? "Отпуск";

              try {
                const updated = await api.upsertVacation({ id: "", start_date: start, end_date: end, title });
                setData(updated);
              } catch (e) {
                alert(String(e));
              }
            }}>Добавить</button>
          </div>

          <div style={{ marginTop: 10 }}>
            {((data?.vacations ?? []).filter(v => {
              const monthStart = `${monthKey}-01`;
              const monthEnd = `${monthKey}-${String(daysInMonth(year, month0)).padStart(2, "0")}`;
              return v.start_date <= monthEnd && v.end_date >= monthStart;
            })).length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
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
                      borderRadius: 10,
                      padding: "8px 10px",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13 }}>
                        <b>{v.start_date}</b> — <b>{v.end_date}</b> — {v.title}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={async () => {
                          const newStart = prompt("Дата начала (YYYY-MM-DD):", v.start_date) ?? v.start_date;
                          const newEnd = prompt("Дата окончания (YYYY-MM-DD):", v.end_date) ?? v.end_date;
                          const newTitle = prompt("Название:", v.title) ?? v.title;

                          const updated = await api.upsertVacation({
                            ...v,
                            start_date: newStart,
                            end_date: newEnd,
                            title: newTitle,
                          });
                          setData(updated);
                        }}
                      >
                        Редактировать
                      </button>

                      <button
                        onClick={async () => {
                          if (!confirm("Удалить отпуск?")) return;
                          const updated = await api.deleteVacation(v.id);
                          setData(updated);
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b>Зарплаты в этом месяце</b>
            <button onClick={addSalaryEvent}>Добавить</button>
          </div>

          {salaryThisMonth.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {salaryThisMonth.map((s) => (
                <div
                  key={s.id}
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
                  <div>
                    <div style={{ fontSize: 13 }}>
                      <b>{s.date}</b> — {s.title} — {rub(s.amount)}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={async () => {
                        const newDate = prompt("Дата (YYYY-MM-DD):", s.date) ?? s.date;
                        const newAmountStr = prompt("Сумма (руб):", String(s.amount / 100)) ?? String(s.amount / 100);
                        const newTitle = prompt("Название:", s.title) ?? s.title;

                        const updated = await api.upsertSalaryEvent({
                          ...s,
                          date: newDate,
                          amount: toKop(newAmountStr),
                          title: newTitle,
                        });
                        setData(updated);
                      }}
                    >
                      Редактировать
                    </button>

                    <button
                      onClick={async () => {
                        if (!confirm("Удалить зарплатную дату?")) return;
                        const updated = await api.deleteSalaryEvent(s.id);
                        setData(updated);
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
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
            overflowY: "auto",
            boxSizing: "border-box",
          }}
        >
        <div><b>Выбранная дата:</b> {selectedDate}</div>
        {budget && (
          <>
            <div><b>До следующей зарплаты:</b> {budget.next_salary_date ? (() => {
            const nd = new Date(budget.next_salary_date);
            const td = new Date();
            const nd0 = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate());
            const td0 = new Date(td.getFullYear(), td.getMonth(), td.getDate());
            const diff = Math.round((nd0.getTime() - td0.getTime()) / (1000 * 60 * 60 * 24));
            return diff >= 0 ? `${diff} дн.` : `0 дн.`;
          })() : "не задана"}</div>
            <div><b>Доступно:</b> {rub(budget.available)}</div>
            <div><b>Можно тратить в день:</b> {rub(budget.per_day)}</div>
          </>
        )}
        <div style={{ marginTop: 12 }}>
          <b>Операции за {selectedDate}:</b>

          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              ...(isSelectedToday ? { maxHeight: 340, overflowY: "auto", paddingRight: 6 } : {}),
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

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={async () => {
                      if (!data || !salaryForSelectedDate) return;

                      const newDate = prompt("Дата (YYYY-MM-DD):", salaryForSelectedDate.date) ?? salaryForSelectedDate.date;
                      const newAmountStr = prompt("Сумма (руб):", String(salaryForSelectedDate.amount / 100)) ?? String(salaryForSelectedDate.amount / 100);
                      const newTitle = prompt("Название:", salaryForSelectedDate.title) ?? salaryForSelectedDate.title;

                      const updated = await api.upsertSalaryEvent({
                        ...salaryForSelectedDate,
                        date: newDate,
                        amount: toKop(newAmountStr),
                        title: newTitle,
                      });
                      setData(updated);
                    }}
                  >
                    Редактировать
                  </button>

                  <button
                    onClick={async () => {
                      if (!salaryForSelectedDate) return;
                      if (!confirm("Удалить зарплатную дату?")) return;
                      const updated = await api.deleteSalaryEvent(salaryForSelectedDate.id);
                      setData(updated);
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ) : null}

            {offForSelectedDate ? (
              <div
                key={"off"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  border: "1px solid #eee",
                  borderRadius: 10,
                  padding: "8px 10px",
                  background: "#eef8ff",
                }}
              >
                <div>
                  <div style={{ fontSize: 13 }}>
                    {offForSelectedDate.is_working ? (
                      <><b>💼 Рабочий день</b> {offForSelectedDate.note ? `— ${offForSelectedDate.note}` : null}</>
                    ) : (
                      <><b>🚫 Нерабочий день</b> {offForSelectedDate.note ? `— ${offForSelectedDate.note}` : null}</>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={async () => {
                      const newNote = prompt("Комментарий:", offForSelectedDate.note) ?? offForSelectedDate.note;
                      const makeWorking = confirm("Сделать рабочим (перевести в рабочий день)?");
                      const updated = await api.upsertOffDay({ ...offForSelectedDate, note: newNote, is_working: makeWorking });
                      setData(updated);
                    }}
                  >
                    Редактировать
                  </button>

                  <button
                    onClick={async () => {
                      if (!confirm("Удалить нерабочий день?")) return;
                      const updated = await api.deleteOffDay(offForSelectedDate.id);
                      setData(updated);
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ) : null}

            {((data?.vacations ?? []).filter(v => v.start_date <= selectedDate && v.end_date >= selectedDate)).map((v) => (
              <div
                key={v.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  border: "1px solid #eee",
                  borderRadius: 10,
                  padding: "8px 10px",
                  background: "#fff8e1",
                }}
              >
                <div>
                  <div style={{ fontSize: 13 }}>
                    <b>🏖 {v.title}</b> — {v.start_date} → {v.end_date}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={async () => {
                      const newStart = prompt("Дата начала (YYYY-MM-DD):", v.start_date) ?? v.start_date;
                      const newEnd = prompt("Дата окончания (YYYY-MM-DD):", v.end_date) ?? v.end_date;
                      const newTitle = prompt("Название:", v.title) ?? v.title;

                      const updated = await api.upsertVacation({
                        ...v,
                        start_date: newStart,
                        end_date: newEnd,
                        title: newTitle,
                      });
                      setData(updated);
                    }}
                  >
                    Редактировать
                  </button>

                  <button
                    onClick={async () => {
                      if (!confirm("Удалить отпуск?")) return;
                      const updated = await api.deleteVacation(v.id);
                      setData(updated);
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}



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
                      <b>{t.type === "income" ? "+" : "-"}</b> {rub(t.amount)} — {t.category}
                    </div>
                    {t.note ? <div style={{ fontSize: 12, opacity: 0.7 }}>{t.note}</div> : null}
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={async () => {
                        if (!data) return;

                        const newAmountStr = prompt("Новая сумма (руб):", String(t.amount / 100));
                        if (!newAmountStr) return;

                        const newCategory = prompt("Категория:", t.category) ?? t.category;
                        const newNote = prompt("Комментарий:", t.note) ?? t.note;

                        const updated = await api.updateTransaction({
                          ...t,
                          amount: toKop(newAmountStr),
                          category: newCategory,
                          note: newNote,
                        });
                        setData(updated);
                      }}
                    >
                      Редактировать
                    </button>

                    <button
                      onClick={async () => {
                        if (!confirm("Удалить операцию?")) return;
                        const updated = await api.deleteTransaction(t.id);
                        setData(updated);
                      }}
                    >
                      Удалить
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
          const isSel = d === selectedDate;
          const salaryForDay = (data?.salaryEvents ?? []).find(s => s.date === d);
          const vacForDay = (data?.vacations ?? []).find(v => v.start_date <= d && d <= v.end_date) ?? null;
          const offForDay = (data?.offDays ?? []).find(o => o.date === d) ?? null;

          const dayOfWeek = new Date(d).getDay(); // 0 = Sunday, 6 = Saturday
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const workingOverride = offForDay?.is_working ?? false;
          const effectiveWeekend = isWeekend && !workingOverride;
          const weekendHighlight = workSchedule === '5/2' && effectiveWeekend;
          const vacationHighlight = vacForDay !== null;
          const offDayHighlight = offForDay !== null && !(offForDay?.is_working);
          const effectiveWorking = isWeekend ? workingOverride : !(offForDay && !offForDay.is_working);
          const tileBackground = isToday
            ? "rgba(0, 200, 120, 0.08)"
            : vacationHighlight
              ? "rgba(255, 223, 99, 0.25)"
              : offDayHighlight
                ? "rgba(0, 120, 255, 0.06)"
                : weekendHighlight
                  ? "rgba(255, 0, 0, 0.06)"
                  : "transparent";

          return (
            <div
              key={d}
              onClick={() => { setSelectedDate(d); setDayMenuOpen(null); }}
              style={{
                position: 'relative',
                cursor: "pointer",
                zIndex: dayMenuOpen === d ? 50 : 0,
                border: isSel ? "2px solid #333" : isToday ? "2px solid #1b7" : "1px solid #ddd",
                background: tileBackground,
                borderRadius: 12,
                padding: 8,
                minHeight: 68,
              }}

            >
              <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 10 }} data-day-menu="true">
                <button
                  aria-label="Меню"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedDate(d);
                    setDayMenuOpen((cur) => (cur === d ? null : d));
                  }}
                >
                  ⋯
                </button>

                {dayMenuOpen === d ? (
                  <div
                    data-day-menu="true"
                    style={{
                      position: "absolute",
                      top: 26,
                      right: 0,
                      zIndex: 2000,
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
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        setSelectedDate(d);
                        openTxModal("income", d);
                        setDayMenuOpen(null);
                      }}
                    >
                      Добавить доход
                    </button>
                    <button
                      onClick={() => {
                        setSelectedDate(d);
                        openTxModal("expense", d);
                        setDayMenuOpen(null);
                      }}
                    >
                      Добавить расход
                    </button>
                    <div style={{ height: 1, background: "#eee", margin: "4px 0" }} />
                    <button
                      onClick={async () => {
                        try {
                          const makeWorking = !effectiveWorking;
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
                        } catch (err) {
                          console.error('day menu update failed', err);
                          alert(String(err));
                        }
                        setDayMenuOpen(null);
                      }}
                    >
                      {effectiveWorking ? "Установить как выходной" : "Установить как рабочий"}
                    </button>
                  </div>
                ) : null}
              </div>

              {vacForDay ? (
                <div style={{ fontSize: 12, marginTop: 4, opacity: 0.95 }}>
                  🏖️ {vacForDay.title}
                </div>
              ) : salaryForDay ? (
                <div style={{ fontSize: 12, marginTop: 4, opacity: 0.9 }}>
                  💰 {salaryForDay.title}: {rub(salaryForDay.amount)}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 12, opacity: 0.7, color: vacationHighlight ? '#7a5200' : (weekendHighlight ? '#c00' : (offDayHighlight ? '#0b5' : undefined)) }}>{d.slice(8, 10)}</div>
                <div style={{ fontSize: 11, opacity: 0.7, color: vacationHighlight ? '#7a5200' : (weekendHighlight ? '#c00' : (offDayHighlight ? '#0b5' : undefined)) }}>{new Date(d).toLocaleDateString("ru-RU", { weekday: "short" })}</div>
              </div>
              <div style={{ fontSize: 12 }}>+ {rub(s.inc)}</div>
              <div style={{ fontSize: 12 }}>- {rub(s.exp)}</div>
              {offForDay ? (
                offForDay.is_working ? (
                  <div style={{ fontSize: 12, color: '#0a66ff' }}>💼 Рабочий день{offForDay.note ? ` — ${offForDay.note}` : ''}</div>
                ) : (
                  <div style={{ fontSize: 12, color: '#0b5' }}>🚫 Выходной{offForDay.note ? ` — ${offForDay.note}` : ''}</div>
                )
              ) : null}
            </div>
          );
        })}
      </div>
      </div>
      </div>

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
                {txModalType === "income" ? "Добавить доход" : "Добавить расход"} — {txModalDate}
              </b>
              <button onClick={closeTxModal} aria-label="Закрыть">✕</button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Сумма (руб)</div>
                <input
                  value={txModalAmount}
                  onChange={(e) => setTxModalAmount(e.target.value)}
                  placeholder={txModalType === "income" ? "1000" : "100"}
                  inputMode="decimal"
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </div>

              <div style={{ minWidth: 0 }} data-tx-category="true">
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Категория</div>
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={txModalCategory}
                      onChange={(e) => setTxModalCategory(e.target.value)}
                      onFocus={() => setTxCategoryMenuOpen(true)}
                      placeholder={txModalType === "income" ? "Например: Зарплата" : "Например: Продукты"}
                      style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                    />
                    <button
                      type="button"
                      onClick={() => setTxCategoryMenuOpen((v) => !v)}
                      aria-label="Показать список категорий"
                    >
                      â–¾
                    </button>
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
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={closeTxModal}>Отмена</button>
              <button onClick={submitTxModal}>{txModalType === "income" ? "Добавить доход" : "Добавить расход"}</button>
            </div>
          </div>
        </div>
      ) : null}




    </div>
  );
}
