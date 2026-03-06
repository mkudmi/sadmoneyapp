import type { CategoryComparisonItem } from "../lib/trends";
import { rub } from "../lib/money";

type TrendsCategoryComparisonPanelProps = {
  title: string;
  currentLabel: string;
  previousLabel: string;
  items: CategoryComparisonItem[];
  hasAnyItems: boolean;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchPlaceholder: string;
  emptyForPeriodMessage: string;
  variant: "expense" | "income";
};

export function TrendsCategoryComparisonPanel(props: TrendsCategoryComparisonPanelProps) {
  const {
    title,
    currentLabel,
    previousLabel,
    items,
    hasAnyItems,
    searchQuery,
    onSearchQueryChange,
    searchPlaceholder,
    emptyForPeriodMessage,
    variant,
  } = props;

  return (
    <div className="surface" style={{ padding: 10 }}>
      <div style={{ marginBottom: 8, fontSize: 13 }}><b>{title}</b></div>
      <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
        {currentLabel} {"vs"} {previousLabel}
      </div>
      <div style={{ marginBottom: 8 }}>
        <input
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
        />
      </div>
      {items.length > 0 ? (
        <div className="panel-list">
          {items.map((item) => (
            <div key={`${variant}:${item.category}`} className="panel-item" style={{ padding: "8px 10px", display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div><b>{item.category}</b></div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>
                  <span
                    style={{
                      color:
                        variant === "expense"
                          ? (item.delta < 0 ? "#15803d" : "inherit")
                          : (item.delta > 0 ? "#15803d" : "inherit"),
                    }}
                  >
                    {rub(item.current)}
                  </span>
                  {" / "}
                  <span>{rub(item.previous)}</span>
                </div>
              </div>
              <div
                style={{
                  flexShrink: 0,
                  color:
                    variant === "expense"
                      ? (item.delta > 0 ? "var(--danger)" : item.delta < 0 ? "#15803d" : "inherit")
                      : (item.delta > 0 ? "#15803d" : item.delta < 0 ? "var(--danger)" : "inherit"),
                }}
              >
                <b>
                  {item.delta > 0 ? "+" : item.delta < 0 ? "-" : ""}
                  {rub(Math.abs(item.delta))}
                </b>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          {hasAnyItems ? "No categories found." : emptyForPeriodMessage}
        </div>
      )}
    </div>
  );
}
