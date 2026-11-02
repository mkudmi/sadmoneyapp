import assert from "node:assert/strict";
import test from "node:test";
import { loadAppModule } from "./loadAppModule.mjs";

const { buildMonthlyCategories } = await loadAppModule("/src/lib/monthlySummary.ts");
const { buildTrendsData } = await loadAppModule("/src/lib/trends.ts");
const { buildYearExpenseSummary } = await loadAppModule("/src/lib/yearExpenseSummary.ts");
const transaction = (date, amount, type = "expense", category = "Food") => ({
  id: `${date}-${type}`, date, amount, type, category, note: "",
});
const salaries = [
  { id: "july", date: "2026-07-05", amount: 7000000, title: "Salary" },
  { id: "august", date: "2026-08-05", amount: 8000000, title: "Salary" },
  { id: "september", date: "2026-09-04", amount: 9000000, title: "Salary" },
  { id: "future", date: "2026-09-20", amount: 3000000, title: "Advance" },
];
const transactions = [
  transaction("2026-07-10", 100000),
  transaction("2026-08-10", 123450),
  transaction("2026-09-04", 250000),
  transaction("2026-09-25", 500000),
  transaction("2026-08-10", 750000, "planned_expense"),
];
const data = { settings: { txCategories: [], incomeCategories: [] }, transactions, salaryEvents: salaries };
const trends = (monthKey, month0) => buildTrendsData({
  data, monthKey, month0, year: 2026, today: "2026-09-05", locale: "en-US",
});

test("historical top categories contain only the displayed month's actual operations", () => {
  assert.deepEqual(buildMonthlyCategories(transactions, salaries, "2026-08", "2026-09-05"), [
    { type: "income", category: "Salary", amount: 8000000 },
    { type: "expense", category: "Food", amount: 123450 },
  ]);
});

test("current categories exclude future income, expenses and planned expenses", () => {
  assert.deepEqual(buildMonthlyCategories(transactions, salaries, "2026-09", "2026-09-05"), [
    { type: "income", category: "Salary", amount: 9000000 },
    { type: "expense", category: "Food", amount: 250000 },
  ]);
  assert.deepEqual(buildMonthlyCategories(transactions, salaries, "2026-10", "2026-09-05"), []);
});

test("category names with colons and matching income/expense labels remain separate", () => {
  const entries = [transaction("2026-08-10", 100, "income", " Shared: label "), transaction("2026-08-11", 200, "expense", "Shared: label")];
  assert.deepEqual(buildMonthlyCategories(entries, [], "2026-08", "2026-09-05"), [
    { type: "expense", category: "Shared: label", amount: 200 },
    { type: "income", category: "Shared: label", amount: 100 },
  ]);
});

test("historical trends do not accumulate subsequent salary months", () => {
  const result = trends("2026-08", 7);
  assert.equal(result.currentIncome, 8000000);
  assert.equal(result.previousIncome, 7000000);
  assert.equal(result.currentExpense, 123450);
  assert.equal(result.previousExpense, 100000);
});

test("trends match actual month-to-date income and expense categories", () => {
  const result = trends("2026-09", 8);
  const categories = buildMonthlyCategories(transactions, salaries, "2026-09", "2026-09-05");
  assert.equal(result.currentIncome, categories.filter(c => c.type === "income").reduce((sum, c) => sum + c.amount, 0));
  assert.equal(result.currentExpense, categories.filter(c => c.type === "expense").reduce((sum, c) => sum + c.amount, 0));
  assert.equal(result.currentExpense, 250000);
  assert.equal(result.previousIncome, 8000000);
});


test("balance adjustments do not distort yearly or monthly expense statistics", () => {
  const entries = [
    transaction("2026-01-01", 175000000, "expense", "Imported total"),
    transaction("2026-01-02", 10000),
    transaction("2025-01-01", 90000000, "expense", "Imported total"),
    transaction("2025-01-02", 5000),
  ].map(tx => ({ ...tx, exclude_from_statistics: tx.category === "Imported total" }));
  const result = buildYearExpenseSummary(entries, 2026, "en-US");
  assert.equal(result.total, 10000);
  assert.equal(result.previousTotal, 5000);
  assert.equal(result.transactionCount, 1);
  assert.equal(result.averageTransaction, 10000);
  assert.equal(result.months[0].amount, 10000);
  assert.deepEqual(result.categories.map(c => c.category), ["Food"]);
  assert.deepEqual(buildMonthlyCategories(entries, [], "2026-01", "2026-09-18"), [
    { type: "expense", category: "Food", amount: 10000 },
  ]);
  const trendsResult = buildTrendsData({
    data: { transactions: entries, salaryEvents: [] }, monthKey: "2026-01",
    month0: 0, year: 2026, today: "2026-09-18", locale: "en-US",
  });
  assert.equal(trendsResult.currentExpense, 10000);
  entries[0].exclude_from_statistics = false;
  assert.equal(buildYearExpenseSummary(entries, 2026, "en-US").total, 175010000);
});


test("exchange purchases count in the annual report while foreign spending updates its balance", async () => {
  const { currencyBalances } = await loadAppModule("/src/lib/currencyBalance.ts");
  const entries = [
    { ...transaction("2026-08-01", 900000, "currency_exchange"), currency: "USD", foreign_amount: 10000 },
    { ...transaction("2026-08-02", 2500), currency: "USD" },
    { ...transaction("2026-09-01", 1000), currency: "USD" },
  ];
  assert.deepEqual(currencyBalances(entries, "2026-08-31"), { USD: 7500 });
  assert.deepEqual(currencyBalances(entries, "2026-09-01"), { USD: 6500 });
  assert.deepEqual(buildMonthlyCategories(entries, [], "2026-08", "2026-08-31"), []);
  assert.equal(buildYearExpenseSummary(entries, 2026, "en-US").total, 900000);
});


test("exchange history groups currencies, keeps five newest and calculates the actual rate", async () => {
  const { recentCurrencyExchanges, exchangeRate } = await loadAppModule("/src/lib/currencyBalance.ts");
  const exchanges = Array.from({ length: 6 }, (_, i) => ({
    ...transaction(`2026-08-0${i + 1}`, 900000 + i * 10000, "currency_exchange"),
    id: `usd-${i}`, currency: "USD", foreign_amount: 10000,
  }));
  exchanges.push({ ...transaction("2026-08-06", 400000, "currency_exchange"), id: "eur", currency: "EUR", foreign_amount: 5000 });
  exchanges.push({ ...transaction("2026-08-06", 100), currency: "USD" });
  const groups = recentCurrencyExchanges(exchanges);
  assert.deepEqual(groups.USD.map((tx) => tx.id), ["usd-5", "usd-4", "usd-3", "usd-2", "usd-1"]);
  assert.equal(exchangeRate(groups.USD[0]), "1 USD = 95 RUB");
  assert.equal(exchangeRate(groups.EUR[0]), "1 EUR = 80 RUB");
  assert.equal(recentCurrencyExchanges(exchanges, "2026-08-03").USD[0].id, "usd-2");
  assert.equal(recentCurrencyExchanges(exchanges.slice(0, 2).reverse()).USD[0].id, "usd-1");
});


test("foreign income changes its currency balance without affecting ruble reports", async () => {
  const { currencyBalances } = await loadAppModule("/src/lib/currencyBalance.ts");
  const income = { ...transaction("2026-08-01", 10000, "income"), currency: "EUR" };
  const expense = { ...transaction("2026-08-02", 2500), currency: "EUR" };
  assert.deepEqual(currencyBalances([income, expense], "2026-08-02"), { EUR: 7500 });
  assert.deepEqual(currencyBalances([{ ...income, amount: 20000 }, expense], "2026-08-02"), { EUR: 17500 });
  assert.deepEqual(currencyBalances([expense], "2026-08-02"), { EUR: -2500 });
  assert.deepEqual(buildMonthlyCategories([income, expense], [], "2026-08", "2026-08-02"), []);
});


test("cross rates use the last eligible expense for each pair without changing balances", async () => {
  const { recentCrossRates, currencyBalances } = await loadAppModule("/src/lib/currencyBalance.ts");
  const items = [
    { ...transaction("2026-08-01", 10000, "income"), currency: "USD" },
    { ...transaction("2026-08-02", 800), currency: "USD", purchase_currency: "ILS", purchase_amount: 2500 },
    { ...transaction("2026-08-03", 400), currency: "USD", purchase_currency: "ILS", purchase_amount: 1400 },
    { ...transaction("2026-08-04", 300), currency: "USD", purchase_currency: "EUR", purchase_amount: 270 },
    { ...transaction("2026-09-01", 400), currency: "USD", purchase_currency: "ILS", purchase_amount: 2000 },
  ];
  const rates = recentCrossRates(items, "2026-08-31");
  assert.equal(rates.find((rate) => rate.target === "ILS").rate, 3.5);
  assert.equal(rates.find((rate) => rate.target === "ILS").date, "2026-08-03");
  assert.equal(rates.find((rate) => rate.target === "EUR").rate, 0.9);
  assert.deepEqual(currencyBalances(items, "2026-08-31"), { USD: 8500 });
  assert.equal(recentCrossRates(items.filter((item) => item.date !== "2026-08-03"), "2026-08-31").find((rate) => rate.target === "ILS").rate, 3.125);
});


test("default balance currencies include holdings and purchase estimates", async () => {
  const { defaultBalanceCurrencies, balanceCurrencyOptions } = await loadAppModule("/src/lib/currencyBalance.ts");
  const items = [
    { ...transaction("2026-08-01", 10000, "income"), currency: "USD" },
    { ...transaction("2026-08-02", 800), currency: "USD", purchase_currency: "ILS", purchase_amount: 2500 },
    { ...transaction("2026-09-01", 100), currency: "USD", purchase_currency: "EUR", purchase_amount: 100 },
  ];
  assert.deepEqual(defaultBalanceCurrencies(items, "2026-08-31"), ["ILS", "USD"]);
  assert.ok(balanceCurrencyOptions(items, "2026-08-31").includes("ILS"));
});


test("yearly expenses include rubles spent on exchanges, including previous year", () => {
  const entries = [
    transaction("2026-11-02", 860898),
    { ...transaction("2026-11-02", 1200000, "currency_exchange", "Currency exchange"), currency: "USD", foreign_amount: 10000 },
    { ...transaction("2026-11-03", 800), currency: "USD", purchase_currency: "ILS", purchase_amount: 2500 },
    { ...transaction("2025-11-02", 500000, "currency_exchange", "Currency exchange"), currency: "EUR", foreign_amount: 5000 },
    { ...transaction("2026-11-02", 300000, "currency_exchange", "Currency exchange"), currency: "USD", foreign_amount: 3000, exclude_from_statistics: true },
  ];
  const summary = buildYearExpenseSummary(entries, 2026, "en-US");
  assert.equal(summary.total, 2060898);
  assert.equal(summary.months[10].amount, 2060898);
  assert.equal(summary.previousTotal, 500000);
  assert.equal(summary.transactionCount, 2);
  assert.equal(summary.categories.find((c) => c.category === "Currency exchange").amount, 1200000);
});
