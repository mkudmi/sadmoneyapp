export type SalaryEventKind = "regular" | "vacation_pay" | "excluded";

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
