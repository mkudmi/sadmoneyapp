import { useState } from "react";
import type { SavingsGoal } from "../lib/api";
import type { SavingsPlan } from "../lib/savingsPlan";
import { estimateSavingsDays } from "../lib/savingsPlan";
import { rub, toKop } from "../lib/money";

type Props = {
  goal: SavingsGoal | null;
  balance: number;
  plan: SavingsPlan;
  today: string;
  onSave: (title: string, note: string, targetAmount: number, maxCardAmount: number) => Promise<void>;
  onClear: () => Promise<void>;
  onToggleCard: (index: number) => Promise<void>;
};

export function SavingsGoalSection({ goal, balance, plan, today, onSave, onClear, onToggleCard }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remaining = goal ? Math.max(0, goal.targetAmount - balance) : 0;
  const forecastDays = goal ? estimateSavingsDays(goal, balance, today) : null;
  const forecastMonths = forecastDays === null ? null : Math.max(1, Math.ceil(forecastDays / 30));
  const forecastLabel = forecastMonths === null ? "" : forecastMonths >= 24
    ? `${Math.floor(forecastMonths / 12)} yr ${forecastMonths % 12} mo`
    : `${forecastMonths} month${forecastMonths === 1 ? "" : "s"}`;
  const completedCount = goal?.cards.filter((card) => card.completed).length ?? 0;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    setTitle(goal?.title ?? "");
    setNote(goal?.note ?? "");
    setTarget(goal ? String(goal.targetAmount / 100) : "");
    setError("");
    setEditing(true);
  }

  async function saveGoal() {
    const amount = toKop(target);
    if (!title.trim() || amount < 100) {
      setError("Enter a goal name and target amount of at least 1 ₽.");
      return;
    }
    if (goal && (goal.targetAmount !== amount || goal.maxCardAmount !== plan.maxCardAmount)
      && !window.confirm("Rebuild the remaining cards? Closed cards and your piggy bank balance stay the same.")) return;
    await run(async () => {
      await onSave(title.trim(), note.trim(), amount, plan.maxCardAmount);
      setEditing(false);
    });
  }

  return (
    <section style={{ marginTop: 18, borderTop: "1px solid var(--border, #ddd)", paddingTop: 14 }} aria-label="Savings goal">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <b>Savings goal</b>
        {!editing ? <button type="button" onClick={startEdit} disabled={busy}>{goal ? "Change goal" : "Set a goal"}</button> : null}
      </div>

      {editing ? (
        <div style={{ display: "grid", gap: 9, marginTop: 10 }}>
          <label style={{ display: "grid", gap: 4 }}>What are you saving for?
            <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="A bicycle for summer" />
          </label>
          <label style={{ display: "grid", gap: 4 }}>Why this goal matters (optional)
            <textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Rides outside the city on weekends" />
          </label>
          <label style={{ display: "grid", gap: 4 }}>Goal amount (RUB)
            <input value={target} onChange={(event) => setTarget(event.target.value)} inputMode="decimal" placeholder="30000" />
          </label>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {`Cards will cover the whole remaining goal. Amounts start at 500 ₽ and go up to ${rub(plan.maxCardAmount)} based on recorded income (maximum 5,000 ₽). You choose when and which cards to close.`}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => { void saveGoal(); }} disabled={busy}>{goal ? "Save goal" : "Create all cards"}</button>
            <button type="button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          </div>
        </div>
      ) : goal ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{goal.title}</div>
          {goal.note ? <div style={{ fontSize: 12, opacity: 0.8, whiteSpace: "pre-wrap", marginTop: 3 }}>{goal.note}</div> : null}
          <div style={{ marginTop: 4 }}>{rub(Math.min(balance, goal.targetAmount))} of {rub(goal.targetAmount)}</div>
          <progress value={Math.min(balance, goal.targetAmount)} max={goal.targetAmount} style={{ width: "100%", marginTop: 8 }} />
          {remaining > 0 ? (
            <div style={{ fontSize: 12, margin: "8px 0" }}>
              {forecastDays === null
                ? "Close cards on two different days within 30 days to see an estimate based on your pace."
                : `At your recent pace, roughly ${forecastLabel} remain.`}
            </div>
          ) : <p style={{ margin: "8px 0", color: "#138a36" }}>Goal reached! 🎉</p>}
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
            {completedCount} of {goal.cards.length} cards closed. Choose any order and pace. Tap a crossed-out card again to undo it. Cards record savings in this app; move the money yourself.
          </div>
          {goal.cards.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(82px, 1fr))", gap: 7, maxHeight: 340, overflowY: "auto" }}>
              {goal.cards.map((card, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => { void run(() => onToggleCard(index)); }}
                  disabled={busy || (!card.completed && card.amount > remaining)}
                  aria-pressed={card.completed}
                  aria-label={`${card.completed ? "Undo saving" : "Save"} ${rub(card.amount)}`}
                  style={{ padding: "9px 4px", borderRadius: 9, textDecoration: card.completed ? "line-through" : "none", opacity: card.completed ? 0.55 : 1 }}
                >{rub(card.amount)}</button>
              ))}
            </div>
          ) : null}
          <button type="button" onClick={() => {
            if (window.confirm("Remove this goal? Your piggy bank balance will stay the same.")) void run(onClear);
          }} disabled={busy} style={{ marginTop: 12 }}>Remove goal</button>
        </div>
      ) : (
        <p style={{ fontSize: 12, opacity: 0.75, marginBottom: 0 }}>Give your savings a purpose and mark off small contributions at your own pace.</p>
      )}
      {error ? <div role="alert" style={{ color: "var(--danger, #b00020)", fontSize: 12, marginTop: 8 }}>{error}</div> : null}
    </section>
  );
}
