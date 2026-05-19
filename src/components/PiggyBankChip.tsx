import { rub } from "../lib/money";
import { AppIcon } from "./AppIcon";

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
        minHeight: 36,
        padding: "6px 10px",
        boxSizing: "border-box",
      }}
    >
      <span style={{ fontSize: 12, opacity: 0.9, whiteSpace: "nowrap" }}>
        {"Piggy bank"}
      </span>
      <b style={{ fontSize: 12, whiteSpace: "nowrap" }}>{rub(amount)}</b>
      <button
        title={"Add to piggy bank"}
        aria-label={"Add to piggy bank"}
        className="icon-button"
        style={{ minWidth: 24, minHeight: 24, padding: 0 }}
        onClick={onAdd}
      >
        <AppIcon name="add" />
      </button>
      <button
        title={"Withdraw from piggy bank"}
        aria-label={"Withdraw from piggy bank"}
        className="icon-button"
        style={{ minWidth: 24, minHeight: 24, padding: 0 }}
        onClick={onWithdraw}
      >
        <AppIcon name="remove" />
      </button>
    </div>
  );
}
