export function rub(kop: number) {
  const v = kop / 100;
  return v.toLocaleString("ru-RU", { style: "currency", currency: "RUB" });
}

export function toKop(rubles: string) {
  const normalized = rubles.trim().replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return 0;

  const negative = normalized.startsWith("-");
  const unsigned = normalized.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  // Parse the decimal digits directly: multiplying a binary float can turn
  // 1.005 rubles into 100.499999... kopecks and round down incorrectly.
  let kopecks = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  if (Number(fraction[2] ?? "0") >= 5) kopecks += 1n;

  const result = Number(negative ? -kopecks : kopecks);
  return Number.isSafeInteger(result) ? result : 0;
}
