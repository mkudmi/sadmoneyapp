import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { useDismissible } from "../hooks/useDismissible";
import { useDropdownPlacement } from "../hooks/useDropdownPlacement";
import { formatForeignAmount } from "../lib/money";
import { AppIcon } from "./AppIcon";

type Props = { amounts: [string, number][]; type: "income" | "expense" };

export function ForeignCurrencyPopover({ amounts, type }: Props) {
  const label = type === "income" ? "income" : "expenses";
  const [open, setOpen] = useState(false);
  const id = useId();
  const { anchorRef, dropdownStyle } = useDropdownPlacement(open, amounts.length + 1, true);
  useDismissible(open, () => setOpen(false), `[data-foreign-expenses="${id}"]`);
  const left = typeof dropdownStyle.left === "number" ? Math.max(8, Math.min(dropdownStyle.left, window.innerWidth - 200)) : dropdownStyle.left;

  return <div ref={anchorRef} data-foreign-expenses={id} className="foreign-expenses-anchor">
    <button type="button" className="foreign-expenses-trigger" aria-label={`Show ${label} in foreign currencies`} aria-expanded={open} aria-controls={open ? `${id}-popover` : undefined} onClick={() => setOpen((value) => !value)}>
      <AppIcon name="dollar" size={16} />
    </button>
    {open && createPortal(<div id={`${id}-popover`} data-foreign-expenses={id} className="menu-pop foreign-expenses-popover" style={{ ...dropdownStyle, left, width: 192 }}>
      <div className="foreign-expenses-title">Foreign currency {label}</div>
      {amounts.length ? <ul className="foreign-expenses-list">{amounts.map(([currency, amount]) => <li key={currency}><span>{currency}</span><b>{formatForeignAmount(amount, currency)}</b></li>)}</ul> : <div className="foreign-expenses-empty">No foreign currency {label} this month.</div>}
    </div>, document.body)}
  </div>;
}
