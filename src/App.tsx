import { useEffect, useMemo, useState } from "react";
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
    // Берём зарплаты за последние 12 месяцев (от today назад ровно на год)
    if (!data) return 0;
    const end = new Date(today);
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);

    let total = 0;
    for (const s of data.salaryEvents ?? []) {
      const sd = new Date(s.date);
      if (sd >= start && sd <= end) total += s.amount;
    }

    const avgMonthly = total / 12; // в копейках
    const avgDaily = Math.round(avgMonthly / 29.3);
    return avgDaily; // в копейках
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

  async function addQuickExpense() {
    console.log('addQuickExpense clicked', { selectedDate });
    try {
      const amountStr = prompt("Расход (руб):", "100");
      if (!amountStr) return;

      const tx: Transaction = {
        id: "",
        date: selectedDate,
        type: "expense",
        amount: toKop(amountStr),
        category: "Прочее",
        note: "",
      };

      const updated = await api.addTransaction(tx);
      setData(updated);
    } catch (err) {
      console.error('addQuickExpense failed', err);
      alert('Ошибка добавления расхода: ' + String(err));
    }
  }

  async function addQuickIncome() {
    console.log('addQuickIncome clicked', { selectedDate });
    try {
      const amountStr = prompt("Доход (руб):", "1000");
      if (!amountStr) return;

      const tx: Transaction = {
        id: "",
        date: selectedDate,
        type: "income",
        amount: toKop(amountStr),
        category: "Доход",
        note: "",
      };

      const updated = await api.addTransaction(tx);
      setData(updated);
    } catch (err) {
      console.error('addQuickIncome failed', err);
      alert('Ошибка добавления дохода: ' + String(err));
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


    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <button onClick={prevMonth}>←</button>
        <h2 style={{ margin: 0 }}>
          {new Date(year, month0, 1).toLocaleString("ru-RU", { month: "long", year: "numeric" })}
        </h2>
        <button onClick={nextMonth}>→</button>
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
        <div style={{ fontSize: 12, opacity: 0.7 }}>(сумма зарплат за 12 мес / 12) / 29.3</div>
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

      <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b>Зарплаты в этом месяце</b>
          <button onClick={addSalaryEvent}>Добавить</button>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
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

        {salaryThisMonth.length === 0 ? (
          <div style={{ marginTop: 8, opacity: 0.7 }}>Пока нет зарплатных дат в этом месяце.</div>
        ) : (
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

        <div style={{ marginTop: 10 }}>
          {((data?.vacations ?? []).filter(v => {
            const monthStart = `${monthKey}-01`;
            const monthEnd = `${monthKey}-${String(daysInMonth(year, month0)).padStart(2, "0")}`;
            return v.start_date <= monthEnd && v.end_date >= monthStart;
          })).length === 0 ? (
            <div style={{ marginTop: 8, opacity: 0.7 }}>Пока нет отпусков в этом месяце.</div>
          ) : (
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



      <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12, marginBottom: 12 }}>
        <div><b>Выбранная дата:</b> {selectedDate}</div>
        {budget && (
          <>
            <div><b>До следующей зарплаты:</b> {budget.next_salary_date ?? "не задана"}</div>
            <div><b>Дней:</b> {budget.days}</div>
            <div><b>Доступно:</b> {rub(budget.available)}</div>
            <div><b>Можно тратить в день:</b> {rub(budget.per_day)}</div>
          </>
        )}
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button type="button" onClick={addQuickIncome}>+ Доход</button>
          <button type="button" onClick={addQuickExpense}>− Расход</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <b>Операции за {selectedDate}:</b>

          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
        {gridCells.map((d, idx) => {
          if (!d) {
            return (
              <div
                key={`empty-${idx}`}
                style={{
                  border: "1px solid transparent",
                  borderRadius: 12,
                  padding: 10,
                  minHeight: 78,
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

          const dayOfWeek = new Date(d).getDay(); // 0 = Sunday, 6 = Saturday
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const weekendHighlight = workSchedule === '5/2' && isWeekend;
          const vacationHighlight = vacForDay !== null;
          const tileBackground = isToday
            ? "rgba(0, 200, 120, 0.08)"
            : vacationHighlight
              ? "rgba(255, 223, 99, 0.25)"
              : weekendHighlight
                ? "rgba(255, 0, 0, 0.06)"
                : "transparent";

          return (
            <div
              key={d}
              onClick={() => setSelectedDate(d)}
              style={{
                cursor: "pointer",
                border: isSel ? "2px solid #333" : isToday ? "2px solid #1b7" : "1px solid #ddd",
                background: tileBackground,
                borderRadius: 12,
                padding: 10,
                minHeight: 78,
              }}

            >
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
                <div style={{ fontSize: 12, opacity: 0.7, color: vacationHighlight ? '#7a5200' : (weekendHighlight ? '#c00' : undefined) }}>{d.slice(8, 10)}</div>
                <div style={{ fontSize: 11, opacity: 0.7, color: vacationHighlight ? '#7a5200' : (weekendHighlight ? '#c00' : undefined) }}>{new Date(d).toLocaleDateString("ru-RU", { weekday: "short" })}</div>
              </div>
              <div style={{ fontSize: 12 }}>+ {rub(s.inc)}</div>
              <div style={{ fontSize: 12 }}>- {rub(s.exp)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
