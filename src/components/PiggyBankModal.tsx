import { rub } from "../lib/money";

export type PiggyBankModalType = "add" | "withdraw";

type PiggyBankModalProps = {
  open: boolean;
  type: PiggyBankModalType;
  amountInput: string;
  balance: number;
  onClose: () => void;
  onAmountInputChange: (value: string) => void;
  onSubmit: () => void;
};

export function PiggyBankModal(props: PiggyBankModalProps) {
  const {
    open,
    type,
    amountInput,
    balance,
    onClose,
    onAmountInputChange,
    onSubmit,
  } = props;

  if (!open) return null;

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
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel"
        style={{
          width: "min(420px, 100%)",
          padding: 12,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <b style={{ fontSize: 14 }}>
            {type === "add" ? "Add to piggy bank" : "Withdraw from piggy bank"}
          </b>
          <button onClick={onClose} aria-label={"Close"}>x</button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Amount (RUB)"}</div>
            <input
              value={amountInput}
              onChange={(e) => onAmountInputChange(e.target.value)}
              placeholder={"1000"}
              inputMode="decimal"
              style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
            {type === "withdraw" ? (
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                <b>{"Available in piggy bank:"}</b> {rub(balance)}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button onClick={onClose}>{"Cancel"}</button>
          <button onClick={onSubmit}>
            {type === "add" ? "Add" : "Withdraw"}
          </button>
        </div>
      </div>
    </div>
  );
}
