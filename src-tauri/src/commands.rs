use crate::models::{AppData, Debt, OffDay, SalaryEvent, Transaction, TxType, Vacation};
use crate::storage;
use anyhow::Result;
use chrono::NaiveDate;
use tauri::AppHandle;
use uuid::Uuid;

fn parse_date(s: &str) -> Result<NaiveDate> {
    Ok(NaiveDate::parse_from_str(s, "%Y-%m-%d")?)
}

fn normalize_category(s: &str) -> String {
    s.trim().to_string()
}

fn normalize_person(s: &str) -> String {
    normalize_category(s)
}

fn remember_category(settings: &mut crate::models::Settings, tx_type: &TxType, category: &str) {
    if category.trim().is_empty() {
        return;
    }
    match tx_type {
        TxType::Income => {
            if settings.income_categories.iter().any(|c| c == category) {
                return;
            }
            settings.income_categories.push(category.to_string());
        }
        TxType::Expense | TxType::PlannedExpense => {
            if settings.tx_categories.iter().any(|c| c == category) {
                return;
            }
            settings.tx_categories.push(category.to_string());
        }
    }
}

fn normalize_category_list(items: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in items {
        let normalized = normalize_category(&raw);
        if normalized.is_empty() {
            continue;
        }
        if out.iter().any(|c| c.eq_ignore_ascii_case(&normalized)) {
            continue;
        }
        out.push(normalized);
    }
    out
}

fn load(app: &AppHandle) -> Result<AppData, String> {
    storage::load_or_init(app).map_err(|e| e.to_string())
}

fn save(app: &AppHandle, data: &AppData) -> Result<(), String> {
    storage::save(app, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_data(app: AppHandle) -> Result<AppData, String> {
    load(&app)
}

#[tauri::command]
pub fn set_language(app: AppHandle, language: String) -> Result<AppData, String> {
    let mut data = load(&app)?;
    let normalized = language.trim().to_lowercase();
    if normalized != "en" && normalized != "ru" {
        return Err("language must be 'en' or 'ru'".to_string());
    }
    data.settings.language = normalized;
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn set_tx_categories(
    app: AppHandle,
    expense_categories: Vec<String>,
    income_categories: Vec<String>,
) -> Result<AppData, String> {
    let mut data = load(&app)?;
    data.settings.tx_categories = normalize_category_list(expense_categories);
    data.settings.income_categories = normalize_category_list(income_categories);
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn add_transaction(app: AppHandle, mut tx: Transaction) -> Result<AppData, String> {
    let mut data = load(&app)?;

    if tx.id.trim().is_empty() {
        tx.id = format!("tx_{}", Uuid::new_v4());
    }

    // простая нормализация: расход всегда положительный amount, тип решает знак
    tx.amount = tx.amount.saturating_abs();
    tx.category = normalize_category(&tx.category);
    remember_category(&mut data.settings, &tx.r#type, &tx.category);
    tx.debt_person = tx
        .debt_person
        .as_ref()
        .map(|p| normalize_person(p))
        .filter(|p| !p.is_empty());

    if let (TxType::Expense, Some(person)) = (&tx.r#type, tx.debt_person.as_ref()) {
        if let Some(d) = data
            .debts
            .iter_mut()
            .find(|d| d.person.eq_ignore_ascii_case(person))
        {
            d.amount = (d.amount - tx.amount).max(0);
        }
    }

    data.transactions.push(tx);
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn update_transaction(app: AppHandle, mut tx: Transaction) -> Result<AppData, String> {
    let mut data = load(&app)?;

    if tx.id.trim().is_empty() {
        return Err("transaction id is empty".to_string());
    }

    let idx = data.transactions.iter().position(|t| t.id == tx.id);
    let Some(i) = idx else {
        return Err("transaction not found".to_string());
    };

    tx.amount = tx.amount.saturating_abs();
    tx.category = normalize_category(&tx.category);
    remember_category(&mut data.settings, &tx.r#type, &tx.category);
    tx.debt_person = tx
        .debt_person
        .as_ref()
        .map(|p| normalize_person(p))
        .filter(|p| !p.is_empty());

    data.transactions[i] = tx;
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn delete_transaction(app: AppHandle, id: String) -> Result<AppData, String> {
    let mut data = load(&app)?;

    // If we delete an expense linked to a debt person, restore that amount back to the debt.
    if let Some(tx) = data.transactions.iter().find(|t| t.id == id).cloned() {
        if let (TxType::Expense, Some(person)) = (tx.r#type, tx.debt_person.as_ref()) {
            if let Some(d) = data
                .debts
                .iter_mut()
                .find(|d| d.person.eq_ignore_ascii_case(person))
            {
                d.amount = d.amount.saturating_add(tx.amount);
            } else {
                data.debts.push(Debt {
                    id: format!("debt_{}", Uuid::new_v4()),
                    person: normalize_person(person),
                    amount: tx.amount.saturating_abs(),
                });
            }
        }
    }

    data.transactions.retain(|t| t.id != id);
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn upsert_salary_event(app: AppHandle, mut ev: SalaryEvent) -> Result<AppData, String> {
    let mut data = load(&app)?;

    if ev.id.trim().is_empty() {
        ev.id = format!("sal_{}", Uuid::new_v4());
    }
    ev.amount = ev.amount.saturating_abs();

    let idx = data.salary_events.iter().position(|x| x.id == ev.id);
    match idx {
        Some(i) => data.salary_events[i] = ev,
        None => data.salary_events.push(ev),
    }

    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn delete_salary_event(app: AppHandle, id: String) -> Result<AppData, String> {
    let mut data = load(&app)?;
    data.salary_events.retain(|s| s.id != id);
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn set_piggy_bank_amount(app: AppHandle, amount: i64) -> Result<AppData, String> {
    let mut data = load(&app)?;
    data.piggy_bank_amount = amount.max(0);
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn upsert_vacation(app: AppHandle, mut ev: Vacation) -> Result<AppData, String> {
    let mut data = load(&app)?;

    if ev.id.trim().is_empty() {
        ev.id = format!("vac_{}", Uuid::new_v4());
    }

    // базовая валидация дат: start <= end
    let start = parse_date(&ev.start_date).map_err(|e| e.to_string())?;
    let end = parse_date(&ev.end_date).map_err(|e| e.to_string())?;
    if end < start {
        return Err("end_date must be >= start_date".to_string());
    }

    let idx = data.vacations.iter().position(|x| x.id == ev.id);
    match idx {
        Some(i) => data.vacations[i] = ev,
        None => data.vacations.push(ev),
    }

    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn delete_vacation(app: AppHandle, id: String) -> Result<AppData, String> {
    let mut data = load(&app)?;
    data.vacations.retain(|s| s.id != id);
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn upsert_off_day(app: AppHandle, mut ev: OffDay) -> Result<AppData, String> {
    let mut data = load(&app)?;

    if ev.id.trim().is_empty() {
        ev.id = format!("off_{}", Uuid::new_v4());
    }

    let idx = data.off_days.iter().position(|x| x.id == ev.id);
    match idx {
        Some(i) => data.off_days[i] = ev,
        None => data.off_days.push(ev),
    }

    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn delete_off_day(app: AppHandle, id: String) -> Result<AppData, String> {
    let mut data = load(&app)?;
    data.off_days.retain(|s| s.id != id);
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn upsert_debt(app: AppHandle, mut debt: Debt) -> Result<AppData, String> {
    let mut data = load(&app)?;

    debt.person = normalize_person(&debt.person);
    if debt.person.is_empty() {
        return Err("debt person is empty".to_string());
    }
    debt.amount = debt.amount.saturating_abs();
    if debt.amount <= 0 {
        return Err("debt amount must be > 0".to_string());
    }

    if debt.id.trim().is_empty() {
        if let Some(existing) = data
            .debts
            .iter_mut()
            .find(|d| d.person.eq_ignore_ascii_case(&debt.person))
        {
            existing.amount = existing.amount.saturating_add(debt.amount);
        } else {
            debt.id = format!("debt_{}", Uuid::new_v4());
            data.debts.push(debt);
        }
    } else if let Some(i) = data.debts.iter().position(|x| x.id == debt.id) {
        data.debts[i] = debt;
    } else {
        data.debts.push(debt);
    }

    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn delete_debt(app: AppHandle, id: String) -> Result<AppData, String> {
    let mut data = load(&app)?;
    data.debts.retain(|d| d.id != id);
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn export_backup(app: AppHandle) -> Result<String, String> {
    let data = load(&app)?;
    serde_json::to_string_pretty(&data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_backup_to_path(app: AppHandle, path: String) -> Result<(), String> {
    let backup = export_backup(app)?;
    std::fs::write(&path, backup).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_backup_to_dir(
    app: AppHandle,
    dir_path: String,
    file_name: String,
) -> Result<String, String> {
    let backup = export_backup(app)?;
    let mut full_path = std::path::PathBuf::from(dir_path);
    let file = if file_name.trim().is_empty() {
        "sadmoney-backup.json".to_string()
    } else {
        file_name
    };
    full_path.push(file);
    std::fs::write(&full_path, backup).map_err(|e| e.to_string())?;
    Ok(full_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn import_backup(app: AppHandle, backup_json: String) -> Result<AppData, String> {
    let data: AppData = serde_json::from_str(&backup_json).map_err(|e| e.to_string())?;
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn import_backup_from_path(app: AppHandle, path: String) -> Result<AppData, String> {
    let backup_json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    import_backup(app, backup_json)
}

#[derive(serde::Serialize)]
pub struct DailyBudgetResult {
    pub next_salary_date: Option<String>,
    pub days: i64,
    pub available: i64,
    pub per_day: i64,
}

/// Расчёт “сколько можно тратить в день” от указанной даты (YYYY-MM-DD)
#[tauri::command]
pub fn calc_daily_budget(app: AppHandle, from_date: String) -> Result<DailyBudgetResult, String> {
    let data = load(&app)?;
    let from = parse_date(&from_date).map_err(|e| e.to_string())?;

    // Найти ближайшую зарплату строго после from_date
    let next_date = data
        .salary_events
        .iter()
        .filter_map(|s| parse_date(&s.date).ok())
        .filter(|d| *d > from)
        .min();

    let Some(next_date) = next_date else {
        return Ok(DailyBudgetResult {
            next_salary_date: None,
            days: 0,
            available: 0,
            per_day: 0,
        });
    };

    // Диапазон: с сегодня по день перед зарплатой (чтобы в день зарплаты не “проедать” будущий приход)
    let start = from;
    let end = next_date.pred_opt().unwrap_or(next_date);

    let days = if end >= start {
        (end - start).num_days() + 1
    } else {
        0
    };

    // Баланс на from_date: считаем все операции <= from_date и зарплаты <= from_date
    let mut balance: i64 = 0;
    let mut balance_for_limit: i64 = 0;

    for s in &data.salary_events {
        if let Ok(d) = parse_date(&s.date) {
            if d <= from {
                balance += s.amount;
                balance_for_limit += s.amount;
            }
        }
    }

    for t in &data.transactions {
        if let Ok(d) = parse_date(&t.date) {
            if d <= from {
                match t.r#type {
                    TxType::Income => {
                        balance += t.amount;
                        balance_for_limit += t.amount;
                    }
                    TxType::Expense => {
                        balance -= t.amount;
                        if d < from {
                            balance_for_limit -= t.amount;
                        }
                    }
                    TxType::PlannedExpense => {}
                }
            }
        }
    }

    // Резервируем запланированные расходы до ближайшей зарплаты.
    let mut planned_reserve: i64 = 0;
    for t in &data.transactions {
        if let Ok(d) = parse_date(&t.date) {
            if d >= start && d <= end {
                if let TxType::PlannedExpense = t.r#type {
                    planned_reserve += t.amount;
                }
            }
        }
    }

    // Подушка и резерв по запланированным расходам.
    let blocked_amount = data.settings.min_balance + data.piggy_bank_amount + planned_reserve;

    let mut available = balance - blocked_amount;
    if available < 0 {
        available = 0;
    }

    let mut available_for_limit = balance_for_limit - blocked_amount;
    if available_for_limit < 0 {
        available_for_limit = 0;
    }

    let per_day = if days > 0 { available_for_limit / days } else { 0 };

    Ok(DailyBudgetResult {
        next_salary_date: Some(next_date.format("%Y-%m-%d").to_string()),
        days,
        available,
        per_day,
    })
}
