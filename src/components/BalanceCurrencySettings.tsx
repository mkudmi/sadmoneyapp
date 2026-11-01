import { useId, useState } from "react";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { AppIcon } from "./AppIcon";

type Props = { options: string[]; selected: string[]; onSave: (currencies: string[]) => Promise<void>; onClose: () => void };
export function BalanceCurrencySettings({ options, selected, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(selected);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const titleId = useId();
  const ref = useDialogFocus(true);
  async function save() {
    setSaving(true); setError(false);
    try { await onSave(draft); onClose(); } catch { setError(true); } finally { setSaving(false); }
  }
  return <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onMouseDown={(e) => { if (!saving && e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="modal-panel" style={{ width: "min(420px, 100%)", padding: 16, maxHeight: "90vh", overflowY: "auto", boxSizing: "border-box" }} onKeyDown={(e) => { if (!saving && e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <b id={titleId}>Balance currencies</b><button type="button" className="icon-button" aria-label="Close" disabled={saving} onClick={onClose}><AppIcon name="close" /></button>
      </div>
      <p style={{ fontSize: 12, opacity: 0.75 }}>Choose currencies to show in the balance panel.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 8 }}>
        {options.map((currency) => <label key={currency} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={draft.includes(currency)} style={{ width: 16, height: 16, minHeight: 0, padding: 0, margin: 0 }} onChange={(e) => setDraft((current) => e.target.checked ? [...current, currency] : current.filter((c) => c !== currency))} />{currency}
        </label>)}
      </div>
      {error ? <p role="alert">Unable to save balance settings. Please try again.</p> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button type="button" disabled={saving} onClick={() => { void save(); }}>Save</button></div>
    </div>
  </div>;
}
