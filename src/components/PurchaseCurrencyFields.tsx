import { SelectInput } from "./SelectInput";
import { POPULAR_CURRENCIES } from "../lib/currencyBalance";

type Props = { currency: string; amount: string; sourceCurrency: string; extraCurrencies: string[]; onCurrencyChange: (value: string) => void; onAmountChange: (value: string) => void };

export function PurchaseCurrencyFields({ currency, amount, sourceCurrency, extraCurrencies, onCurrencyChange, onAmountChange }: Props) {
  const options = [...new Set(["RUB", ...POPULAR_CURRENCIES, ...extraCurrencies, ...(currency ? [currency] : [])])].filter((c) => c !== sourceCurrency).sort();
  return <div style={{ display: "grid", gap: 8 }}>
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input type="checkbox" style={{ width: 16, height: 16, minHeight: 0, padding: 0, margin: 0 }} checked={Boolean(currency)} onChange={(e) => { onCurrencyChange(e.target.checked ? (sourceCurrency === "ILS" ? "USD" : "ILS") : ""); if (!e.target.checked) onAmountChange(""); }} />
      <span>Record purchase in another currency</span>
    </label>
    {currency ? <>
      <SelectInput label="Purchase currency" value={currency} options={options} onChange={onCurrencyChange} />
      <label>Purchase amount ({currency})
        <input value={amount} onChange={(e) => onAmountChange(e.target.value)} inputMode="decimal" style={{ width: "100%", boxSizing: "border-box" }} />
      </label>
    </> : null}
  </div>;
}
