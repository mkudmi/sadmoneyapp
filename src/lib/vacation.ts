export type VacationType = "paid" | "unpaid";

export function normalizeVacationType(raw: string | undefined): VacationType {
  return raw === "unpaid" ? "unpaid" : "paid";
}

export function vacationTypeLabel(vacationType: VacationType) {
  return vacationType === "unpaid" ? "Unpaid" : "Paid";
}
