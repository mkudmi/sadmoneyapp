import { useId, useState } from "react";
import type { Transaction } from "../lib/api";
import type { DateFormat } from "../lib/date";
import { formatDateForDisplay } from "../lib/date";
import { crossRateHistory, exchangeRateHistory, impliedRubRateHistory } from "../lib/currencyBalance";
import { SelectInput } from "./SelectInput";

type Props = { transactions: Transaction[]; today: string; dateFormat: DateFormat };

export function CurrencyRateChart({ transactions, today, dateFormat }: Props) {
  const [selected, setSelected] = useState("");
  const gradientId = useId();
  const exchanges = exchangeRateHistory(transactions, today);
  const crossRates = crossRateHistory(transactions, today);
  const impliedRates = impliedRubRateHistory(transactions, today);
  const series = [
    ...Object.entries(exchanges).map(([currency, points]) => ({ key: `exchange:${currency}`, source: currency, target: "RUB", points, kind: "exchange" })),
    ...Object.entries(impliedRates).map(([pair, points]) => {
      const [source, via] = pair.split(":");
      return { key: `implied:${pair}`, source, target: "RUB", points, kind: `estimated via ${via}` };
    }),
    ...Object.entries(crossRates).map(([pair, points]) => {
      const [source, target] = pair.split(":");
      return { key: `purchase:${pair}`, source, target, points, kind: "purchase" };
    }),
  ];
  const labelForSeries = (item: typeof series[number]) => `${item.source} / ${item.target} (${item.kind === "purchase" ? "purchases" : item.kind === "exchange" ? "exchanges" : item.kind})`;
  const current = series.find((item) => item.key === selected) ?? series[0];
  const points = current?.points ?? [];
  const rates = points.map((point) => point.rate);
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const padding = Math.max((max - min) * 0.18, max * 0.01, 0.01);
  const bottom = min - padding;
  const top = max + padding;
  const coordinates = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? 200 : 12 + index / (points.length - 1) * 376,
    y: 112 - (point.rate - bottom) / (top - bottom) * 100,
  }));
  const path = coordinates.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  const formatRate = (rate: number) => rate.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
  const latest = points[points.length - 1]?.rate;
  const previous = points[points.length - 2]?.rate;
  const change = previous && latest !== undefined ? (latest - previous) / previous * 100 : null;
  const beneficial = change !== null && (current?.kind === "purchase" ? change > 0 : change < 0);

  return <section style={{ marginTop: 20 }} aria-labelledby="currency-rate-chart-title">
    <div style={{ display: "grid", gap: 12 }}>
      <div><b id="currency-rate-chart-title">Exchange rate history</b><div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Based on your exchanges and purchases</div></div>
      {current && <div style={{ width: "min(100%, 300px)", minWidth: 0 }}><SelectInput label="Pair" value={labelForSeries(current)} options={series.map(labelForSeries)} onChange={(label) => {
        const choice = series.find((item) => labelForSeries(item) === label);
        if (choice) setSelected(choice.key);
      }} /></div>}
    </div>
    {points.length === 0 ? <p style={{ fontSize: 12, opacity: 0.7 }}>Add an exchange or a purchase in another currency to see its rate history.</p> : <div className="panel-item" style={{ marginTop: 10, padding: "12px 14px", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div><span style={{ fontSize: 12, opacity: 0.7 }}>{current.kind.startsWith("estimated") ? `Estimated rate · ${current.kind}` : "Latest recorded rate"}</span><div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{formatRate(points[points.length - 1].rate)} {current.target} <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.7 }}>/ {current.source}</span></div></div>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{points.length} {points.length === 1 ? "operation" : "operations"}</span>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: change === null || change === 0 ? "inherit" : beneficial ? "#138a36" : "var(--danger)" }}>
        {change === null ? "Add another operation to compare rates." : change === 0 ? "Unchanged from previous operation" : <><b>{change > 0 ? "↑" : "↓"} {Math.abs(change).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}% · {beneficial ? "More favorable" : "Less favorable"}</b><span style={{ color: "var(--text-muted, inherit)", opacity: 0.75 }}> vs previous operation</span></>}
      </div>
      <div style={{ fontSize: 11, opacity: 0.65, marginTop: 3 }}>{current.kind === "purchase" ? `More ${current.target} per ${current.source} is favorable` : `Fewer RUB per ${current.source} is favorable`}</div>
      <svg viewBox="0 0 400 124" role="img" aria-label={`${current.source} to ${current.target} exchange rates from ${formatDateForDisplay(points[0].date, dateFormat)} to ${formatDateForDisplay(points[points.length - 1].date, dateFormat)}`} style={{ display: "block", width: "100%", height: 140, marginTop: 8, overflow: "visible" }}>
        <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#5b78ed" stopOpacity="0.25" /><stop offset="100%" stopColor="#5b78ed" stopOpacity="0.01" /></linearGradient></defs>
        {[12, 62, 112].map((y) => <line key={y} x1="12" x2="388" y1={y} y2={y} stroke="currentColor" opacity="0.09" />)}
        {coordinates.length > 1 && <><path d={`${path} L 388 112 L 12 112 Z`} fill={`url(#${gradientId})`} /><path d={path} fill="none" stroke="#5b78ed" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></>}
        {coordinates.map((point) => <circle key={point.id} cx={point.x} cy={point.y} r="3.5" fill="#5b78ed" stroke="white" strokeWidth="1.5"><title>{formatDateForDisplay(point.date, dateFormat)}: 1 {current.source} = {formatRate(point.rate)} {current.target}</title></circle>)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11, opacity: 0.7 }}><span>{formatDateForDisplay(points[0].date, dateFormat)}</span><span>{formatDateForDisplay(points[points.length - 1].date, dateFormat)}</span></div>
    </div>}
  </section>;
}
