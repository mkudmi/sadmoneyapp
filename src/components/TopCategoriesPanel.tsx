import { useMemo, useState } from "react";
import { rub } from "../lib/money";

export type TopCategoryItem = {
  category: string;
  amount: number;
  type: "income" | "expense";
};

type TopCategoriesPanelProps = {
  categories: TopCategoryItem[];
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
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M5 1H1V5M9 1H13V5M13 9V13H9M1 9V13H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M1.5 1.5L5 5M12.5 1.5L9 5M12.5 12.5L9 9M1.5 12.5L5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
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
                <div style={{ flexShrink: 0, color: item.type === "income" ? "#138a36" : "var(--danger)" }}>
                  <b>{item.type === "income" ? "+" : "-"} {rub(item.amount)}</b>
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
              <button onClick={() => setModalOpen(false)} aria-label={"Close"}>x</button>
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
                        <div style={{ flexShrink: 0, color: "#138a36" }}>
                          <b>{"+ "} {rub(item.amount)}</b>
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
                        <div style={{ flexShrink: 0, color: "var(--danger)" }}>
                          <b>{"- "} {rub(item.amount)}</b>
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
