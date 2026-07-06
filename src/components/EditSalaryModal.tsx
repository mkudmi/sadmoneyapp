import { DateInputWithCalendar } from "./DateInputWithCalendar";
import { dateFormatPattern } from "../lib/date";
import type { DateFormat } from "../lib/date";
import { AppIcon } from "./AppIcon";
import type { SalaryEventKind } from "../lib/salaryEvent";
import { salaryEventKindLabel } from "../lib/salaryEvent";
import type { ManualSalaryEstimate, ManualSalaryPayoutKind } from "../lib/salary";
import { rub } from "../lib/money";
import { formatDateForDisplay } from "../lib/date";

type EditSalaryModalProps = {
  open: boolean;
  date: string;
  dateFormat: DateFormat;
  amount: string;
  title: string;
  kind: SalaryEventKind;
  accrualMonth: string;
  payoutKind: "auto" | ManualSalaryPayoutKind;
  checkResult: ManualSalaryEstimate | null;
  onDateChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onKindChange: (value: SalaryEventKind) => void;
  onAccrualMonthChange: (value: string) => void;
  onPayoutKindChange: (value: "auto" | ManualSalaryPayoutKind) => void;
  onCheck: () => void;
  onUseEstimatedAmount: () => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function EditSalaryModal(props: EditSalaryModalProps) {
  const {
    open,
    date,
    dateFormat,
    amount,
    title,
    kind,
    accrualMonth,
    payoutKind,
    checkResult,
    onDateChange,
    onAmountChange,
    onTitleChange,
    onKindChange,
    onAccrualMonthChange,
    onPayoutKindChange,
    onCheck,
    onUseEstimatedAmount,
    onClose,
    onSubmit,
  } = props;

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 5000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel"
        style={{
          width: "min(520px, 100%)",
          padding: 12,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <b style={{ fontSize: 14 }}>{"Edit salary"}</b>
          <button onClick={onClose} aria-label={"Close"} className="icon-button">
            <AppIcon name="close" />
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{`Date (${dateFormatPattern(dateFormat)})`}</div>
            <DateInputWithCalendar value={date} dateFormat={dateFormat} onChange={onDateChange} />
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Amount (RUB)"}</div>
            <input
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              placeholder={"80000"}
              inputMode="decimal"
              style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Title"}</div>
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder={"Salary"}
              style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Accrual month"}</div>
            <input
              type="month"
              value={accrualMonth}
              onChange={(e) => onAccrualMonthChange(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{"Vacation pay calculation"}</div>
            <select
              value={kind}
              onChange={(e) => onKindChange(e.target.value as SalaryEventKind)}
              style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            >
              <option value="regular">{salaryEventKindLabel("regular")}</option>
              <option value="vacation_pay">{salaryEventKindLabel("vacation_pay")}</option>
              <option value="excluded">{salaryEventKindLabel("excluded")}</option>
            </select>
          </div>

          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 10,
              padding: 10,
              background: "#fafafa",
              display: "grid",
              gap: 6,
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>{"Salary period for check"}</div>
              <select
                value={payoutKind}
                onChange={(e) => onPayoutKindChange(e.target.value as "auto" | ManualSalaryPayoutKind)}
                style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
              >
                <option value="auto">{"Auto detect"}</option>
                <option value="first_half">{"First half / advance"}</option>
                <option value="second_half">{"Second half / final payout"}</option>
              </select>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {"Estimate the payout for this date from the monthly amount, using workdays, vacations and public holidays."}
              </div>
              <button type="button" onClick={onCheck}>
                {"Check salary"}
              </button>
            </div>
            {checkResult ? (
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12 }}>
                  <b>
                    {checkResult.payoutKind === "first_half"
                      ? "Estimated first-half payout"
                      : "Estimated second-half payout"}
                  </b>
                  <span style={{ marginLeft: 8 }}>{rub(checkResult.amount)}</span>
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {`${checkResult.payablePeriodWorkingDays} payable working days in the period, ${checkResult.payableMonthWorkingDays} payable of ${checkResult.monthWorkingDays} working days for ${checkResult.payrollMonth}`}
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {`${formatDateForDisplay(checkResult.periodStart, dateFormat)} -> ${formatDateForDisplay(checkResult.periodEnd, dateFormat)}`}
                </div>
                {checkResult.vacationWorkingDaysExcluded > 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {`Vacation excluded ${checkResult.vacationWorkingDaysExcluded} working day(s) from the month salary calculation.`}
                  </div>
                ) : null}
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {`Monthly base: ${rub(checkResult.monthlySalaryAmount)} (${checkResult.source === "history" ? "from previous payouts" : "from entered amount"})`}
                </div>
                {checkResult.previouslyRecordedAmount > 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {`Already recorded for ${checkResult.payrollMonth}: ${rub(checkResult.previouslyRecordedAmount)}`}
                  </div>
                ) : null}
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {checkResult.deltaFromEntered === 0
                    ? "Entered amount matches the estimate."
                    : checkResult.deltaFromEntered > 0
                      ? `Entered amount is ${rub(checkResult.deltaFromEntered)} above the estimate.`
                      : `Entered amount is ${rub(Math.abs(checkResult.deltaFromEntered))} below the estimate.`}
                </div>
                <div>
                  <button type="button" onClick={onUseEstimatedAmount}>
                    {"Use estimated amount"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button onClick={onClose}>{"Cancel"}</button>
          <button onClick={onSubmit}>{"Save"}</button>
        </div>
      </div>
    </div>
  );
}
