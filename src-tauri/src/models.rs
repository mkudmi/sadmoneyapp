use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppData {
    pub version: i32,
    pub settings: Settings,
    #[serde(rename = "salaryEvents")]
    pub salary_events: Vec<SalaryEvent>,
    pub vacations: Vec<Vacation>,
    #[serde(rename = "offDays")]
    pub off_days: Vec<OffDay>,
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
    #[serde(default = "default_language")]
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DailyCalcMode {
    #[default]
    ExcludePayday,
    IncludePayday,
}

fn default_tx_categories() -> Vec<String> {
    vec!["Groceries".to_string(), "Fuel".to_string()]
}

fn default_language() -> String {
    "en".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            currency: "RUB".to_string(),
            min_balance: 0,
            daily_calc_mode: DailyCalcMode::default(),
            tx_categories: default_tx_categories(),
            language: default_language(),
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
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            version: 1,
            settings: Settings::default(),
            salary_events: vec![],
            vacations: vec![],
            off_days: vec![],
            transactions: vec![],
        }
    }
}
