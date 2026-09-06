import assert from "node:assert/strict";
import test from "node:test";
import { loadAppModule } from "./loadAppModule.mjs";

const { buildMonthlyCategories } = await loadAppModule("/src/lib/monthlySummary.ts");
const { buildTrendsData } = await loadAppModule("/src/lib/trends.ts");
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
