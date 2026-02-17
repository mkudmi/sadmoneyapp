import { useMemo } from "react";
import { Debt } from "../lib/api";
import { rub } from "../lib/money";

type DebtsSurfaceProps = {
  debts: Debt[];
  onAddDebt: () => void;
  onEditDebt: (debt: Debt) => void;
  onDeleteDebt: (debtId: string) => void;
};

export function DebtsSurface(props: DebtsSurfaceProps) {
  const { debts, onAddDebt, onEditDebt, onDeleteDebt } = props;
  const totalDebt = useMemo(() => debts.reduce((sum, d) => sum + d.amount, 0), [debts]);

  return (
    <div className="surface" style={{ minWidth: 0, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <b>{"Debts"}</b>
        <button
          onClick={onAddDebt}
          title={"Add debt"}
          aria-label={"Add debt"}
          style={{ minWidth: 24, minHeight: 24, padding: "0 6px", fontWeight: 700, lineHeight: 1 }}
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
                  onClick={() => onEditDebt(d)}
                >
                  <span aria-hidden="true">{"\u270E"}</span>
                </button>
                <button
                  title={"Delete debt"}
                  aria-label={"Delete debt"}
                  style={{ color: "var(--danger)", fontWeight: 700, minHeight: 26, padding: "0 8px", fontSize: 12 }}
                  onClick={() => onDeleteDebt(d.id)}
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
  );
}
