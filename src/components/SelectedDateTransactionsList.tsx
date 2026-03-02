import { SalaryEvent, Transaction } from "../lib/api";
import { formatDateForDisplay } from "../lib/date";
import type { DateFormat } from "../lib/date";
import { rub } from "../lib/money";

type AfterVacationSummary = {
  vacationDays: number;
  vacationDeduction: number;
  amount: number;
  basedOnPlannedAfterExpenses: boolean;
};

type SelectedDateTransactionsListProps = {
  selectedDate: string;
  dateFormat: DateFormat;
  salaryForSelectedDate: SalaryEvent | null;
  plannedAfterExpensesForSelectedDate: number | null;
  afterVacationForSelectedDate: AfterVacationSummary | null;
  transactionsForSelectedDate: Transaction[];
  onMarkPlannedAsPaid: (tx: Transaction) => void;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
};

export function SelectedDateTransactionsList(props: SelectedDateTransactionsListProps) {
  const {
    selectedDate,
    dateFormat,
    salaryForSelectedDate,
    plannedAfterExpensesForSelectedDate,
    afterVacationForSelectedDate,
    transactionsForSelectedDate,
    onMarkPlannedAsPaid,
    onEditTransaction,
    onDeleteTransaction,
  } = props;

  return (
    <div style={{ marginTop: 12, flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <b>{"Transactions for"} {formatDateForDisplay(selectedDate, dateFormat)}:</b>

      <div
        style={{
          marginTop: 8,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          paddingRight: 6,
        }}
      >
        {salaryForSelectedDate ? (
          <div
            key={"salary"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              border: "1px solid #eee",
              borderRadius: 10,
              padding: "6px 8px",
              background: "#fff",
            }}
          >
            <div>
              <div style={{ fontSize: 12 }}>
                <b>+ </b> {salaryForSelectedDate.title}  -  {rub(salaryForSelectedDate.amount)}
              </div>
            </div>
          </div>
        ) : null}

        {plannedAfterExpensesForSelectedDate !== null ? (
          <div
            key={"planned-after-expenses"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              border: "1px solid #eee",
              borderRadius: 10,
              padding: "6px 8px",
              background: "#fff",
            }}
          >
            <div style={{ fontSize: 12 }}>
              <b>{"After planned expenses"}</b>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>
              {rub(plannedAfterExpensesForSelectedDate)}
            </div>
          </div>
        ) : null}

        {afterVacationForSelectedDate !== null ? (
          <div
            key={"after-vacation"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              border: "1px solid #eee",
              borderRadius: 10,
              padding: "6px 8px",
              background: "#fff",
            }}
          >
            <div style={{ fontSize: 12 }}>
              <b>{"After vacation"}</b>
              <span style={{ marginLeft: 8, opacity: 0.75 }}>
                {`(-${rub(afterVacationForSelectedDate.vacationDeduction)}, ${afterVacationForSelectedDate.vacationDays}d${afterVacationForSelectedDate.basedOnPlannedAfterExpenses ? ", incl. planned" : ""})`}
              </span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>
              {rub(afterVacationForSelectedDate.amount)}
            </div>
          </div>
        ) : null}

        {transactionsForSelectedDate.map((t) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              border: "1px solid #eee",
              borderRadius: 10,
              padding: "6px 8px",
            }}
          >
            <div>
              <div style={{ fontSize: 12 }}>
                <b>{t.type === "income" ? "+" : t.type === "planned_expense" ? "P" : "-"}</b> {rub(t.amount)}  -  {t.category}
                {t.debt_person ? (
                  <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.75 }}>
                    {"to"}: {t.debt_person}
                  </span>
                ) : null}
                {t.type === "planned_expense" ? (
                  <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.75 }}>{"(planned)"}</span>
                ) : null}
              </div>
              {t.note ? <div style={{ fontSize: 12, opacity: 0.7 }}>{t.note}</div> : null}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {t.type === "planned_expense" ? (
                <button
                  title={"Paid"}
                  aria-label={"Paid"}
                  style={{ color: "#138a36", fontWeight: 700, minHeight: 26, padding: "0 8px", fontSize: 16, lineHeight: 1 }}
                  onClick={() => onMarkPlannedAsPaid(t)}
                >
                  {"\u2713"}
                </button>
              ) : null}
              <button
                className="edit-pencil-btn"
                title={"Edit"}
                aria-label={"Edit"}
                style={{ width: 26, minWidth: 26, minHeight: 26, borderRadius: 8 }}
                onClick={() => onEditTransaction(t)}
              >
                <span aria-hidden="true">{"\u270E"}</span>
              </button>

              <button
                title={"Delete"}
                aria-label={"Delete"}
                style={{ color: "var(--danger)", fontWeight: 700, minHeight: 26, padding: "0 8px", fontSize: 12 }}
                onClick={() => onDeleteTransaction(t.id)}
              >
                {"x"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
