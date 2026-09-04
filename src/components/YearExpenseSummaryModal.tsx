import type { YearExpenseSummary } from "../lib/yearExpenseSummary";
import { rub } from "../lib/money";
import { AppIcon } from "./AppIcon";

type YearExpenseSummaryModalProps = {
  summary: YearExpenseSummary;
  onClose: () => void;
};

function signedMoney(amount: number) {
  if (amount === 0) return rub(0);
  return `${amount > 0 ? "+" : "−"}${rub(Math.abs(amount))}`;
}

export function YearExpenseSummaryModal({ summary, onClose }: YearExpenseSummaryModalProps) {
  const maxMonthAmount = Math.max(...summary.months.map((month) => month.amount), 0);
  const topCategory = summary.categories[0] ?? null;

  return (
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
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal-panel year-summary-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="year-summary-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="year-summary-header">
          <div>
            <b id="year-summary-title">Year summary — {summary.year}</b>
            <div className="year-summary-subtitle">Actual expenses; planned expenses are excluded</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="icon-button">
            <AppIcon name="close" />
          </button>
        </div>

        <div className="year-summary-metrics">
          <div className="surface year-summary-metric">
            <span>Total expenses</span>
            <b>{rub(summary.total)}</b>
          </div>
          <div className="surface year-summary-metric">
            <span>Transactions</span>
            <b>{summary.transactionCount}</b>
            <small>Average {rub(summary.averageTransaction)}</small>
          </div>
          <div className="surface year-summary-metric">
            <span>Monthly average</span>
            <b>{rub(summary.averageMonth)}</b>
          </div>
          <div className="surface year-summary-metric">
            <span>Compared with {summary.previousYear}</span>
            <b className={summary.yearDelta > 0 ? "year-summary-negative" : "year-summary-positive"}>
              {signedMoney(summary.yearDelta)}
            </b>
            <small>
              {summary.yearDeltaPercent === null
                ? "No expenses in the previous year"
                : `${summary.yearDeltaPercent > 0 ? "+" : ""}${(summary.yearDeltaPercent * 100).toFixed(1)}%`}
            </small>
          </div>
        </div>

        <div className="year-summary-insights">
          <div>
            <span>Most expensive month</span>
            <b>{summary.peakMonth ? `${summary.peakMonth.label} — ${rub(summary.peakMonth.amount)}` : "No expenses"}</b>
          </div>
          <div>
            <span>Largest category</span>
            <b>{topCategory ? `${topCategory.category} — ${(topCategory.share * 100).toFixed(1)}%` : "No expenses"}</b>
          </div>
          <div>
            <span>Months without expenses</span>
            <b>{summary.noSpendMonths}</b>
          </div>
        </div>

        <div className="surface year-summary-section">
          <b>Expenses by month</b>
          <div className="year-summary-months">
            {summary.months.map((month) => (
              <div key={month.month} className="year-summary-month">
                <div className="year-summary-month-label">
                  <span>{month.label}</span>
                  <span>{rub(month.amount)}</span>
                </div>
                <div className="year-summary-bar-track" aria-hidden="true">
                  <div
                    className="year-summary-bar"
                    style={{ width: `${maxMonthAmount > 0 ? (month.amount / maxMonthAmount) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="surface year-summary-section">
          <div className="year-summary-category-heading">
            <b>Expenses by category</b>
            <span>{summary.categories.length} categories</span>
          </div>
          {summary.categories.length > 0 ? (
            <div className="year-summary-categories">
              {summary.categories.map((item, index) => (
                <div key={item.category} className="year-summary-category">
                  <span className="year-summary-rank">{index + 1}</span>
                  <div className="year-summary-category-main">
                    <div className="year-summary-category-title">
                      <b>{item.category}</b>
                      <b>{rub(item.amount)}</b>
                    </div>
                    <div className="year-summary-category-meta">
                      <span>{(item.share * 100).toFixed(1)}% · {item.count} transactions</span>
                      <span className={item.delta > 0 ? "year-summary-negative" : "year-summary-positive"}>
                        {signedMoney(item.delta)} vs {summary.previousYear}
                      </span>
                    </div>
                    <div className="year-summary-bar-track" aria-hidden="true">
                      <div className="year-summary-bar" style={{ width: `${item.share * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="year-summary-empty">No actual expenses for {summary.year}.</div>
          )}
        </div>
      </section>
    </div>
  );
}
