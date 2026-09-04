import { invoke } from "@tauri-apps/api/core";
import type { DateFormat } from "./date";
import type { SalaryEventKind } from "./salaryEvent";
import type { RussianProductionCalendarYear } from "./russianProductionCalendar";

export type TxType = "income" | "expense" | "planned_expense";

export type Transaction = {
  id: string;
  date: string; // YYYY-MM-DD
  type: TxType;
  amount: number; // kopecks
  category: string;
  note: string;
  debt_person?: string | null;
};

export type SalaryEvent = {
  id: string;
  date: string;
  amount: number; // kopecks
  title: string;
  kind?: SalaryEventKind;
  accrualMonth?: string | null;
  generated?: boolean;
  sourceConfigId?: string | null;
  payoutType?: "advance" | "salary" | null;
};

export type SalaryConfig = {
  id: string;
  effectiveFrom: string;
  amount: number;
  autoGenerate?: boolean;
  advancePercent: number;
  advanceDay: number;
  salaryDay: number;
};

export type Vacation = {
  id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  title: string;
  vacation_type?: "paid" | "unpaid";
};

export type OffDay = {
  id: string;
  date: string; // YYYY-MM-DD
  note: string;
  is_working?: boolean;
};

export type Debt = {
  id: string;
  person: string;
  amount: number; // kopecks
};

export type AppData = {
  version: number;
  settings: {
    currency: string;
    minBalance: number;
    dailyCalcMode: "exclude_payday" | "include_payday";
    txCategories: string[];
    incomeCategories?: string[];
    workSchedule?: "5/2" | "custom";
    saveRemainingDailyLimitToPiggyBank?: boolean;
    lastDailyLimitCarryoverDate?: string;
    language?: "ru" | "en";
    dateFormat?: DateFormat;
    salaryConfigs?: SalaryConfig[];
  };
  piggyBankAmount?: number;
  salaryEvents: SalaryEvent[];
  vacations: Vacation[];
  offDays: OffDay[];
  debts?: Debt[];
  transactions: Transaction[];
};

export type DailyBudgetResult = {
  next_salary_date: string | null;
  days: number;
  available: number;
  per_day: number;
};

export const api = {
  getData: () => invoke<AppData>("get_data"),
  addTransaction: (tx: Transaction) => invoke<AppData>("add_transaction", { tx }),
  updateTransaction: (tx: Transaction) => invoke<AppData>("update_transaction", { tx }),
  deleteTransaction: (id: string) => invoke<AppData>("delete_transaction", { id }),
  upsertSalaryEvent: (ev: SalaryEvent) => invoke<AppData>("upsert_salary_event", { ev }),
  deleteSalaryEvent: (id: string) => invoke<AppData>("delete_salary_event", { id }),
  setPiggyBankAmount: (amount: number) => invoke<AppData>("set_piggy_bank_amount", { amount }),
  upsertVacation: (vac: Vacation) => invoke<AppData>("upsert_vacation", { ev: vac }),
  deleteVacation: (id: string) => invoke<AppData>("delete_vacation", { id }),
  upsertOffDay: (od: OffDay) => invoke<AppData>("upsert_off_day", { ev: od }),
  deleteOffDay: (id: string) => invoke<AppData>("delete_off_day", { id }),
  upsertDebt: (debt: Debt) => invoke<AppData>("upsert_debt", { debt }),
  deleteDebt: (id: string) => invoke<AppData>("delete_debt", { id }),
  exportBackup: () => invoke<string>("export_backup"),
  saveBackupToPath: (path: string) => invoke<void>("save_backup_to_path", { path }),
  saveBackupToDir: (dirPath: string, fileName: string) =>
    invoke<string>("save_backup_to_dir", { dirPath, fileName }),
  importBackup: (backupJson: string) => invoke<AppData>("import_backup", { backupJson }),
  importBackupFromPath: (path: string) => invoke<AppData>("import_backup_from_path", { path }),
  setLanguage: (language: "ru" | "en") => invoke<AppData>("set_language", { language }),
  setDateFormat: (dateFormat: DateFormat) => invoke<AppData>("set_date_format", { dateFormat }),
  setTxCategories: (expenseCategories: string[], incomeCategories: string[]) =>
    invoke<AppData>("set_tx_categories", { expenseCategories, incomeCategories }),
  setUserPreferences: (
    workSchedule: "5/2" | "custom",
    saveRemainingDailyLimitToPiggyBank: boolean,
    lastDailyLimitCarryoverDate: string,
  ) =>
    invoke<AppData>("set_user_preferences", {
      workSchedule,
      saveRemainingDailyLimitToPiggyBank,
      lastDailyLimitCarryoverDate,
    }),
  setSalaryConfigs: (salaryConfigs: SalaryConfig[]) =>
    invoke<AppData>("set_salary_configs", { salaryConfigs }),
  applyDailyLimitCarryover: (amount: number, processedDate: string) =>
    invoke<AppData>("apply_daily_limit_carryover", { amount, processedDate }),
  calcDailyBudget: (fromDate: string) => invoke<DailyBudgetResult>("calc_daily_budget", { fromDate }),
  loadConsultantProductionCalendar: (year: number) =>
    invoke<RussianProductionCalendarYear>("load_consultant_production_calendar", { year }),
};
