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
pub struct Settings {
    pub currency: String,
    /// "подушка", копейки
    #[serde(rename = "minBalance")]
    pub min_balance: i64,
    /// exclude_payday | include_payday
    #[serde(rename = "dailyCalcMode")]
    pub daily_calc_mode: DailyCalcMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DailyCalcMode {
    ExcludePayday,
    IncludePayday,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalaryEvent {
    pub id: String,
    pub date: String,  // YYYY-MM-DD
    pub amount: i64,   // копейки
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TxType {
    Income,
    Expense,
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
            settings: Settings {
                currency: "RUB".to_string(),
                min_balance: 0,
                daily_calc_mode: DailyCalcMode::ExcludePayday,
            },
            salary_events: vec![],
            vacations: vec![],
            off_days: vec![],
            transactions: vec![],
        }
    }
}
