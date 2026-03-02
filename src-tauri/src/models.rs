use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppData {
    pub version: i32,
    pub settings: Settings,
    #[serde(rename = "piggyBankAmount")]
    #[serde(default)]
    pub piggy_bank_amount: i64,
    #[serde(rename = "salaryEvents")]
    pub salary_events: Vec<SalaryEvent>,
    pub vacations: Vec<Vacation>,
    #[serde(rename = "offDays")]
    pub off_days: Vec<OffDay>,
    #[serde(default)]
    pub debts: Vec<Debt>,
    pub transactions: Vec<Transaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OffDay {
    pub id: String,
    pub date: String, // YYYY-MM-DD
    pub note: String,
    #[serde(default)]
    pub is_working: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vacation {
    pub id: String,
    pub start_date: String, // YYYY-MM-DD
    pub end_date: String,   // YYYY-MM-DD
    pub title: String,
    #[serde(default = "default_vacation_type")]
    pub vacation_type: VacationType,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VacationType {
    #[default]
    Paid,
    Unpaid,
}

fn default_vacation_type() -> VacationType {
    VacationType::Paid
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub currency: String,
    /// "подушка", копейки
    #[serde(rename = "minBalance")]
    pub min_balance: i64,
    /// exclude_payday | include_payday
    #[serde(rename = "dailyCalcMode")]
    #[serde(default)]
    pub daily_calc_mode: DailyCalcMode,
    #[serde(rename = "txCategories")]
    #[serde(default = "default_tx_categories")]
    pub tx_categories: Vec<String>,
    #[serde(rename = "incomeCategories")]
    #[serde(default = "default_income_categories")]
    pub income_categories: Vec<String>,
    #[serde(rename = "workSchedule")]
    #[serde(default)]
    pub work_schedule: WorkSchedule,
    #[serde(rename = "saveRemainingDailyLimitToPiggyBank")]
    #[serde(default)]
    pub save_remaining_daily_limit_to_piggy_bank: bool,
    #[serde(rename = "lastDailyLimitCarryoverDate")]
    #[serde(default)]
    pub last_daily_limit_carryover_date: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(rename = "dateFormat")]
    #[serde(default = "default_date_format")]
    pub date_format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DailyCalcMode {
    #[default]
    ExcludePayday,
    IncludePayday,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum WorkSchedule {
    #[default]
    #[serde(rename = "5/2")]
    FiveTwo,
    #[serde(rename = "custom")]
    Custom,
}

fn default_tx_categories() -> Vec<String> {
    vec![
        "Groceries".to_string(),
        "Fuel".to_string(),
        "Debt".to_string(),
    ]
}

fn default_language() -> String {
    "en".to_string()
}

fn default_date_format() -> String {
    "dd-mm-yyyy".to_string()
}

fn default_income_categories() -> Vec<String> {
    vec![
        "Salary".to_string(),
        "Advance".to_string(),
        "Side Job".to_string(),
        "Cashback".to_string(),
    ]
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            currency: "RUB".to_string(),
            min_balance: 0,
            daily_calc_mode: DailyCalcMode::default(),
            tx_categories: default_tx_categories(),
            income_categories: default_income_categories(),
            work_schedule: WorkSchedule::default(),
            save_remaining_daily_limit_to_piggy_bank: false,
            last_daily_limit_carryover_date: String::new(),
            language: default_language(),
            date_format: default_date_format(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalaryEvent {
    pub id: String,
    pub date: String, // YYYY-MM-DD
    pub amount: i64,  // копейки
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TxType {
    Income,
    Expense,
    PlannedExpense,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    pub date: String, // YYYY-MM-DD
    pub r#type: TxType,
    pub amount: i64, // копейки
    pub category: String,
    pub note: String,
    #[serde(default)]
    pub debt_person: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Debt {
    pub id: String,
    pub person: String,
    pub amount: i64,
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            version: 1,
            settings: Settings::default(),
            piggy_bank_amount: 0,
            salary_events: vec![],
            vacations: vec![],
            off_days: vec![],
            debts: vec![],
            transactions: vec![],
        }
    }
}
