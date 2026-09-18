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
          <h2 id="debts-title">Долги</h2>
          <p>Кому нужно вернуть деньги и кто должен вам.</p>
        </div>
        <button onClick={onClose} aria-label="Закрыть долги" className="icon-button"><AppIcon name="close" /></button>
      </header>

      <div className="debts-overview" role="group" aria-label="Направление долга">
        {([
          { value: "payable", label: "Я должен", total: totalPayable, count: payable.length, hint: "Нужно вернуть" },
          { value: "receivable", label: "Мне должны", total: totalReceivable, count: receivable.length, hint: "Ожидаю возврата" },
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
          <h3>{direction === "payable" ? "Кому я должен" : "Кто мне должен"}</h3>
          <span>{visibleDebts.length > 0 ? `Записей: ${visibleDebts.length} · По убыванию суммы` : "Нет открытых долгов"}</span>
        </div>
        <button className="debt-add-button" onClick={() => onAddDebt(direction)}><AppIcon name="add" />Добавить долг</button>
      </div>

      {visibleDebts.length > 0 ? (
        <ul className="debts-list">
          {visibleDebts.map((debt) => (
            <li className="debt-row" key={debt.id}>
              <span className="debt-avatar" aria-hidden="true">{Array.from(debt.person.trim())[0]?.toLocaleUpperCase()}</span>
              <div className="debt-person"><strong>{debt.person}</strong><span>{direction === "payable" ? "Вернуть" : "Получить обратно"}</span></div>
              <strong className="debt-row-amount">{rub(debt.amount)}</strong>
              <div className="debt-row-actions">
                <button className="icon-button" title="Изменить долг" aria-label={`Изменить долг: ${debt.person}`} onClick={() => onEditDebt(debt)}><AppIcon name="edit" /></button>
                <button className="icon-button debt-delete" title="Удалить долг" aria-label={`Удалить долг: ${debt.person}`} onClick={() => onDeleteDebt(debt.id)}><AppIcon name="delete" /></button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="debts-empty">
          <AppIcon name="wallet" />
          <strong>{direction === "payable" ? "Вы никому не должны" : "Вам пока никто не должен"}</strong>
          <p>{direction === "payable" ? "Добавьте сумму и человека, которому нужно вернуть деньги." : "Добавьте сумму и человека, от которого ждёте возврата."}</p>
        </div>
      )}
      <p className="debts-footnote">Запись долга не меняет баланс. Остаток можно изменить через кнопку редактирования.</p>
    </section>
  );
}
