import { useState } from "react";
import { Debt, DebtDirection } from "../lib/api";
import { rub } from "../lib/money";
import { AppIcon } from "./AppIcon";

type DebtsSurfaceProps = {
  debts: Debt[];
  onAddDebt: (direction: DebtDirection) => void;
  onEditDebt: (debt: Debt) => void;
  onDeleteDebt: (debtId: string) => void;
  onClose: () => void;
};

export function DebtsSurface({ debts, onAddDebt, onEditDebt, onDeleteDebt, onClose }: DebtsSurfaceProps) {
  const [direction, setDirection] = useState<DebtDirection>(() =>
    debts.some((d) => d.direction !== "receivable") ? "payable" : debts.length > 0 ? "receivable" : "payable"
  );
  const payable = debts.filter((d) => d.direction !== "receivable");
  const receivable = debts.filter((d) => d.direction === "receivable");
  const visibleDebts = direction === "payable" ? payable : receivable;
  const totalPayable = payable.reduce((sum, d) => sum + d.amount, 0);
  const totalReceivable = receivable.reduce((sum, d) => sum + d.amount, 0);

  return (
    <section className="debts-manager" aria-labelledby="debts-title">
      <header className="debts-header">
        <div>
          <h2 id="debts-title">Debts</h2>
          <p>Track what you owe and what others owe you.</p>
        </div>
        <button onClick={onClose} aria-label="Close debts" className="icon-button"><AppIcon name="close" /></button>
      </header>

      <div className="debts-overview" role="group" aria-label="Debt direction">
        {([
          { value: "payable", label: "I owe", total: totalPayable, count: payable.length, hint: "To repay" },
          { value: "receivable", label: "Owed to me", total: totalReceivable, count: receivable.length, hint: "Awaiting repayment" },
        ] as const).map((item) => (
          <button key={item.value} className={`debt-summary debt-summary-${item.value}`} aria-pressed={direction === item.value} onClick={() => setDirection(item.value)}>
            <span className="debt-summary-label">{item.label}<span className="debt-count">{item.count}</span></span>
            <strong>{rub(item.total)}</strong>
            <span className="debt-summary-hint">{item.hint}</span>
          </button>
        ))}
      </div>

      <div className="debts-list-heading">
        <div>
          <h3>{direction === "payable" ? "People I owe" : "People who owe me"}</h3>
          <span>{visibleDebts.length > 0 ? `Records: ${visibleDebts.length} · Largest amount first` : "No outstanding debts"}</span>
        </div>
        <button className="debt-add-button" onClick={() => onAddDebt(direction)}><AppIcon name="add" />Add debt</button>
      </div>

      {visibleDebts.length > 0 ? (
        <ul className="debts-list">
          {visibleDebts.map((debt) => (
            <li className="debt-row" key={debt.id}>
              <span className="debt-avatar" aria-hidden="true">{Array.from(debt.person.trim())[0]?.toLocaleUpperCase()}</span>
              <div className="debt-person"><strong>{debt.person}</strong><span>{direction === "payable" ? "To repay" : "To receive"}</span></div>
              <strong className="debt-row-amount">{rub(debt.amount)}</strong>
              <div className="debt-row-actions">
                <button className="icon-button" title="Edit debt" aria-label={`Edit debt: ${debt.person}`} onClick={() => onEditDebt(debt)}><AppIcon name="edit" /></button>
                <button className="icon-button debt-delete" title="Delete debt" aria-label={`Delete debt: ${debt.person}`} onClick={() => onDeleteDebt(debt.id)}><AppIcon name="delete" /></button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="debts-empty">
          <AppIcon name="wallet" />
          <strong>{direction === "payable" ? "You have no outstanding debts" : "No one owes you money yet"}</strong>
          <p>{direction === "payable" ? "Add an amount and the person you need to repay." : "Add an amount and the person you expect repayment from."}</p>
        </div>
      )}
      <p className="debts-footnote">Adding a debt does not change your balance. Use Edit to update the remaining amount.</p>
    </section>
  );
}
