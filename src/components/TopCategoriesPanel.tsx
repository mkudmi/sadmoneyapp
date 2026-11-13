import { useMemo, useState } from "react";
import { formatForeignAmount, rub } from "../lib/money";
import type { MonthlyCategory } from "../lib/monthlySummary";
import { AppIcon } from "./AppIcon";

function CategoryAmounts({ item }: { item: MonthlyCategory }) {
  const sign = item.type === "income" ? "+" : "-";
  const foreignAmounts = Object.entries(item.foreignAmounts ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const amounts = [
    ...((item.amount !== 0 || foreignAmounts.length === 0) ? [rub(item.amount)] : []),
    ...foreignAmounts.map(([currency, amount]) => formatForeignAmount(amount, currency)),
  ];
  if (amounts.length === 1) return <b>{sign} {amounts[0]}</b>;
  return (
    <div className="category-amounts" aria-label={amounts.map((amount) => `${sign} ${amount}`).join(", ")}>
      {amounts.map((amount, index) => (
        <span key={index} className={item.amount !== 0 && index === 0 ? "category-amount-primary" : "category-amount-secondary"}>
          <span className="category-amount-sign" aria-hidden="true">{sign}</span> {amount}
        </span>
      ))}
    </div>
  );
}

type TopCategoriesPanelProps = {
  categories: MonthlyCategory[];
};

export function TopCategoriesPanel({ categories }: TopCategoriesPanelProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const incomeCategories = useMemo(
    () => categories.filter((item) => item.type === "income"),
    [categories]
  );
  const expenseCategories = useMemo(
    () => categories.filter((item) => item.type === "expense"),
    [categories]
  );

  return (
    <>
      <div className="surface" style={{ width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <b>{"Top categories this month"}</b>
          <button
            onClick={() => setModalOpen(true)}
            title={"Expand"}
            aria-label={"Expand"}
            style={{ width: 28, minWidth: 28, minHeight: 28, padding: 0, display: "inline-grid", placeItems: "center", borderRadius: 8 }}
          >
            <AppIcon name="expand" size={14} />
          </button>
        </div>

        {categories.length > 0 ? (
          <div className="panel-list"
            style={{
              marginTop: 8,
              maxHeight: 120,
              overflowY: "auto",
              paddingRight: 4,
            }}
          >
            {categories.map((item, idx) => (
              <div className="panel-item"
                key={`${item.type}:${item.category}`}
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
                <div style={{ minWidth: 0, maxWidth: "60%", color: item.type === "income" ? "#138a36" : "var(--danger)" }}>
                  <CategoryAmounts item={item} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            {"No category operations yet this month."}
          </div>
        )}
      </div>

      {modalOpen ? (
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
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            className="modal-panel"
            style={{
              width: "min(860px, 100%)",
              maxHeight: "min(70vh, 720px)",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <b style={{ fontSize: 14 }}>{"Top categories this month"}</b>
              <button onClick={() => setModalOpen(false)} aria-label={"Close"} className="icon-button">
                <AppIcon name="close" />
              </button>
            </div>
            {categories.length > 0 ? (
              <div
                style={{
                  marginTop: 10,
                  minHeight: 0,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "#138a36" }}>
                    {"Income"}
                  </div>
                  <div className="panel-list" style={{ overflowY: "auto", paddingRight: 4, minHeight: 0 }}>
                    {incomeCategories.length > 0 ? incomeCategories.map((item, idx) => (
                      <div
                        className="panel-item"
                        key={`modal:income:${item.category}`}
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
                          <b>{idx + 1}.</b> {item.category}
                        </div>
                        <div style={{ minWidth: 0, maxWidth: "60%", color: "#138a36" }}>
                          <CategoryAmounts item={item} />
                        </div>
                      </div>
                    )) : (
                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>{"No income categories."}</div>
                    )}
                  </div>
                </div>

                <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--danger)" }}>
                    {"Expense"}
                  </div>
                  <div className="panel-list" style={{ overflowY: "auto", paddingRight: 4, minHeight: 0 }}>
                    {expenseCategories.length > 0 ? expenseCategories.map((item, idx) => (
                      <div
                        className="panel-item"
                        key={`modal:expense:${item.category}`}
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
                          <b>{idx + 1}.</b> {item.category}
                        </div>
                        <div style={{ minWidth: 0, maxWidth: "60%", color: "var(--danger)" }}>
                          <CategoryAmounts item={item} />
                        </div>
                      </div>
                    )) : (
                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>{"No expense categories."}</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                {"No category operations yet this month."}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
