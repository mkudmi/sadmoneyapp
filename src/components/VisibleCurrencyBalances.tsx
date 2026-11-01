import type { Transaction } from "../lib/api";
import { currencyBalances, recentCrossRates } from "../lib/currencyBalance";
import { formatDateForDisplay } from "../lib/date";
import type { DateFormat } from "../lib/date";

type Props = { transactions: Transaction[]; today: string; currencies: string[]; dateFormat: DateFormat };
export function VisibleCurrencyBalances({ transactions, today, currencies, dateFormat }: Props) {
  const balances = currencyBalances(transactions, today);
  const rates = recentCrossRates(transactions, today);
  const format = (value: number) => value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <div>{currencies.map((currency) => {
    const estimates = rates.filter((rate) => rate.target === currency && balances[rate.source] !== undefined);
    return <div key={currency} style={{ marginTop: 2 }}>
      {balances[currency] !== undefined ? <div><b>Balance {currency}:</b> {format(balances[currency] / 100)} {currency}</div> : null}
      {estimates.map(({ source, rate, date }) => <div key={source} title={`Based on purchase on ${formatDateForDisplay(date, dateFormat)}; 1 ${source} ≈ ${rate.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${currency}`}>
        <b>Est. {currency}:</b> ≈ {format(balances[source] / 100 * rate)} {currency} <span style={{ fontSize: 11, opacity: 0.7 }}>(from {source})</span>
      </div>)}
      {balances[currency] === undefined && estimates.length === 0 ? <div><b>Balance {currency}:</b> —</div> : null}
    </div>;
  })}</div>;
}
