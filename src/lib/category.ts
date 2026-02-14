export function normalizeCategoryInput(raw: string) {
  const s0 = raw.trim().replace(/\s+/g, " ");
  if (!s0) return "";

  const cap = (seg: string) => {
    if (!seg) return "";
    return seg.slice(0, 1).toUpperCase() + seg.slice(1).toLowerCase();
  };

  return s0
    .split(" ")
    .map((w) => w.split("-").map(cap).join("-"))
    .join(" ");
}

export function isDebtCategory(categoryRaw: string) {
  const normalized = normalizeCategoryInput(categoryRaw).toLowerCase();
  const en = normalizeCategoryInput("Debt").toLowerCase();
  return normalized === en;
}
