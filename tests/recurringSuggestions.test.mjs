import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAppModule } from "./loadAppModule.mjs";
const { suggestRecurringPayments } = await loadAppModule("/src/lib/recurringSuggestions.ts");
const tx = (date, amount = 10000, category = "Internet") => ({ id: date, date, type: "expense", amount, category, note: "" });
const dates = ["2026-01-15", "2026-02-15", "2026-03-15"];
test("suggests only a consistent expense in three different months", () => {
  const history = dates.map(date => tx(date));
  assert.deepEqual(suggestRecurringPayments(history, [], "2026-03-20"), [{ title: "Internet", amount: 10000, day: 15, count: 3, startDate: "2026-04-15" }]);
  assert.equal(suggestRecurringPayments(history.slice(0, 2), [], "2026-03-20").length, 0);
  assert.equal(suggestRecurringPayments([...history, tx("2026-04-15", 12000)], [], "2026-05-01").length, 0);
  assert.equal(suggestRecurringPayments([...history, tx("2026-04-16")], [], "2026-05-01").length, 0);
  assert.equal(suggestRecurringPayments([...history, tx("2026-03-15")], [], "2026-05-01").length, 0);
  assert.equal(suggestRecurringPayments(history, [{ title: " internet " }], "2026-03-20").length, 0);
});
test("keeps the original day when the next month is shorter", () => {
  const history = ["2025-10-31", "2025-12-31", "2026-01-31"].map(date => tx(date));
  assert.equal(suggestRecurringPayments(history, [], "2026-02-01")[0].startDate, "2026-03-31");
});
