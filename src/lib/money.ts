export function rub(kop: number) {
  const v = kop / 100;
  return v.toLocaleString("ru-RU", { style: "currency", currency: "RUB" });
}

export function toKop(rubles: string) {
  const n = Number(rubles.replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}
