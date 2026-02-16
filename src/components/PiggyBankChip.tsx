import { rub } from "../lib/money";

type PiggyBankChipProps = {
  amount: number;
  onAdd: () => void;
  onWithdraw: () => void;
};

export function PiggyBankChip({ amount, onAdd, onWithdraw }: PiggyBankChipProps) {
  return (
    <div
      className="metric-chip"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
      }}
    >
      <span style={{ fontSize: 12, opacity: 0.9, whiteSpace: "nowrap" }}>
        {"Piggy bank"}
      </span>
      <b style={{ fontSize: 12, whiteSpace: "nowrap" }}>{rub(amount)}</b>
      <button
        title={"Add to piggy bank"}
        aria-label={"Add to piggy bank"}
        style={{ minWidth: 22, minHeight: 22, padding: 0, fontWeight: 700, lineHeight: 1 }}
        onClick={onAdd}
      >
        {"+"}
      </button>
      <button
        title={"Withdraw from piggy bank"}
        aria-label={"Withdraw from piggy bank"}
        style={{ minWidth: 22, minHeight: 22, padding: 0, fontWeight: 700, lineHeight: 1 }}
        onClick={onWithdraw}
      >
        {"-"}
      </button>
    </div>
  );
}
