export type SalaryEventKind = "regular" | "vacation_pay" | "excluded";

type SalaryEventForAccrualMonth = {
  date: string;
  accrualMonth?: string | null;
};

export function normalizeSalaryEventKind(raw?: string | null): SalaryEventKind {
  if (raw === "vacation_pay" || raw === "excluded") {
    return raw;
  }
  return "regular";
}

export function salaryEventKindLabel(kind: SalaryEventKind) {
  switch (kind) {
    case "vacation_pay":
      return "Vacation pay";
    case "excluded":
      return "Excluded from average";
    case "regular":
    default:
      return "Regular pay";
  }
}

export function isSalaryEventIncludedInVacationAverage(kind: SalaryEventKind) {
  return kind === "regular";
}

export function normalizeSalaryEventAccrualMonth(raw?: string | null) {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    return raw;
  }
  return null;
}

export function inferSalaryEventAccrualMonth(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const [year, month, day] = date.split("-").map(Number);
  if (day <= 10) {
    const inferred = new Date(year, month - 2, 1);
    return `${inferred.getFullYear()}-${String(inferred.getMonth() + 1).padStart(2, "0")}`;
  }

  return date.slice(0, 7);
}

export function getSalaryEventAccrualMonth(event: SalaryEventForAccrualMonth) {
  return normalizeSalaryEventAccrualMonth(event.accrualMonth) ?? inferSalaryEventAccrualMonth(event.date);
}
