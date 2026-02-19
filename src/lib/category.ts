export function normalizeCategoryInput(raw: string) {
  return raw.trim().replace(/\s+/g, " ");
}

export function isDebtCategory(categoryRaw: string) {
  const normalized = normalizeCategoryInput(categoryRaw).toLowerCase();
  const en = normalizeCategoryInput("Debt").toLowerCase();
  return normalized === en;
}
