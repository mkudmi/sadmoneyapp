import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAppModule } from "./loadAppModule.mjs";

const dates = await loadAppModule("/src/lib/date.ts");
const money = await loadAppModule("/src/lib/money.ts");
const salary = await loadAppModule("/src/lib/salary.ts");

function config(overrides = {}) {
  return {
    id: "scheduled",
    effectiveFrom: "2026-01-01",
    amount: 10_000_000,
    autoGenerate: true,
    advancePercent: 50,
    advanceDay: 20,
    salaryDay: 5,
    ...overrides,
  };
}

test("decimal amounts round to kopecks without binary floating point errors", () => {
  for (const [input, expected] of [
    ["1.005", 101],
    ["10.075", 1008],
    ["-1.005", -101],
    ["1 234,56", 123456],
    ["1\u00a0234,56", 123456],
    ["1\u202f234,56", 123456],
    ["0,01", 1],
    [".50", 50],
    ["42", 4200],
    ["0", 0],
  ]) {
    assert.equal(money.toKop(input), expected, input);
  }
});

test("invalid and unsafe amounts cannot enter integer money calculations", () => {
  for (const input of ["", "Infinity", "NaN", "0x10", "1,2,3", "100 rubles", "90071992547409.92"]) {
    assert.equal(money.toKop(input), 0, input);
  }
  assert.equal(money.toKop("90071992547409.91"), Number.MAX_SAFE_INTEGER);
});

test("date parsing validates ISO dates and dates in the selected display format", () => {
  for (const format of ["dd-mm-yyyy", "mm-dd-yyyy", "yyyy-mm-dd"]) {
    assert.equal(dates.parseDisplayDate("2026-02-31", format), null);
    assert.equal(dates.parseDisplayDate("2026-13-01", format), null);
    assert.equal(dates.parseDisplayDate("2026-02-29", format), null);
    assert.equal(dates.parseDisplayDate("2024-02-29", format), "2024-02-29");
  }
  assert.equal(dates.parseDisplayDate("31-02-2026", "dd-mm-yyyy"), null);
  assert.equal(dates.parseDisplayDate("02-29-2024", "mm-dd-yyyy"), "2024-02-29");
  assert.equal(dates.parseDisplayDate(" 05-09-2026 ", "dd-mm-yyyy"), "2026-09-05");
});

test("inclusive calendar days do not change at daylight saving transitions", () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ["America/New_York", "Europe/Berlin", "Europe/Moscow"]) {
      process.env.TZ = timezone;
      assert.equal(dates.inclusiveDays("2026-03-07", "2026-03-09"), 3, timezone);
      assert.equal(dates.inclusiveDays("2026-03-28", "2026-03-30"), 3, timezone);
      assert.equal(dates.inclusiveDays("2026-10-31", "2026-11-02"), 3, timezone);
      assert.equal(dates.overlapInclusiveDays("2026-03-01", "2026-03-31", "2026-03-07", "2026-03-09"), 3, timezone);
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
  assert.equal(dates.inclusiveDays("2026-09-05", "2026-09-05"), 1);
  assert.equal(dates.inclusiveDays("2026-09-06", "2026-09-05"), 0);
  assert.equal(dates.inclusiveDays("2026-02-31", "2026-03-05"), 0);
});

test("an advance moved out of the next month remains visible at the end of the range", () => {
  for (const [effectiveFrom, date] of [["2026-02-01", "2026-01-30"], ["2023-01-01", "2022-12-30"]]) {
    const events = salary.buildAutoSalaryEvents([config({ effectiveFrom, advanceDay: 1 })], date, date);
    assert.equal(events.length, 1);
    assert.equal(events[0].date, date);
    assert.equal(events[0].amount, 5_000_000);
    assert.equal(events[0].accrualMonth, effectiveFrom.slice(0, 7));
    assert.equal(events[0].payoutType, "advance");
  }
});

test("salary changes apply to the accrual month and preserve the previous month's final payout", () => {
  const events = salary.buildAutoSalaryEvents([
    config({ id: "old", amount: 16_008_000 }),
    config({ id: "raise", effectiveFrom: "2026-09-01", amount: 20_000_000 }),
  ], "2026-09-01", "2026-10-10");
  assert.deepEqual(events.map(({ date, amount, accrualMonth }) => [date, amount, accrualMonth]), [
    ["2026-09-04", 8_004_000, "2026-08"],
    ["2026-09-18", 10_000_000, "2026-09"],
    ["2026-10-05", 10_000_000, "2026-09"],
  ]);
});

test("invalid payroll dates are rejected before they roll into another month", () => {
  assert.deepEqual(salary.buildAutoSalaryEvents([config()], "2026-02-31", "2026-03-31"), []);
  assert.deepEqual(salary.normalizeSalaryConfigs([config({ effectiveFrom: "2026-02-31" })]), []);
  assert.equal(salary.findSalaryConfigForAccrualMonth([config()], "2026-13"), null);
  const estimate = {
    enteredAmount: 10_000_000,
    payoutDate: "2026-09-20",
    accrualMonth: "2026-09",
    title: "Salary",
    salaryConfigs: [config()],
    salaryEvents: [],
    vacations: [],
    workSchedule: "5/2",
    offDays: [],
  };
  assert.equal(salary.estimateManualSalaryForDate({ ...estimate, payoutDate: "2026-02-31" }), null);
  assert.equal(salary.estimateManualSalaryForDate({ ...estimate, accrualMonth: "2026-13" }), null);
});
