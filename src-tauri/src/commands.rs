use crate::models::{AppData, Debt, OffDay, SalaryConfig, SalaryEvent, Transaction, TxType, Vacation, WorkSchedule};
use crate::storage;
use anyhow::Result;
use chrono::{Datelike, Duration, NaiveDate, Weekday};
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

fn normalize_date_format(s: &str) -> Option<String> {
    match s.trim().to_lowercase().as_str() {
        "dd-mm-yyyy" => Some("dd-mm-yyyy".to_string()),
        "mm-dd-yyyy" => Some("mm-dd-yyyy".to_string()),
        "yyyy-mm-dd" => Some("yyyy-mm-dd".to_string()),
        _ => None,
    }
}

fn normalize_accrual_month(s: &str) -> Option<String> {
    let trimmed = s.trim();
    let mut parts = trimmed.split('-');
    let year = parts.next()?.parse::<i32>().ok()?;
    let month = parts.next()?.parse::<u32>().ok()?;
    if parts.next().is_some() || !(1..=12).contains(&month) {
        return None;
    }
    Some(format!("{year:04}-{month:02}"))
}

fn clamp_salary_day(year: i32, month: u32, day: u32) -> u32 {
    let mut candidate = day.clamp(1, 31);
    while NaiveDate::from_ymd_opt(year, month, candidate).is_none() && candidate > 1 {
        candidate -= 1;
    }
    candidate
}

fn shift_to_previous_workday(date: NaiveDate) -> NaiveDate {
    match date.weekday() {
        Weekday::Sat => date - Duration::days(1),
        Weekday::Sun => date - Duration::days(2),
        _ => date,
    }
}

fn normalize_salary_config(raw: SalaryConfig) -> Result<SalaryConfig, String> {
    let effective_from = raw.effective_from.trim().to_string();
    parse_date(&effective_from).map_err(|e| e.to_string())?;

    let advance_percent = raw.advance_percent.clamp(0, 100);
    let advance_day = raw.advance_day.clamp(1, 31);
    let salary_day = raw.salary_day.clamp(1, 31);
    let amount = raw.amount.max(0);

    Ok(SalaryConfig {
        id: if raw.id.trim().is_empty() {
            format!("salary_cfg_{}", Uuid::new_v4())
        } else {
            raw.id.trim().to_string()
        },
        effective_from,
        amount,
        auto_generate: raw.auto_generate,
        advance_percent,
        advance_day,
        salary_day,
    })
}

fn normalized_salary_configs(configs: &[SalaryConfig]) -> Result<Vec<SalaryConfig>, String> {
    let mut out = Vec::with_capacity(configs.len());
    for config in configs {
        out.push(normalize_salary_config(config.clone())?);
    }
    out.sort_by(|a, b| {
        a.effective_from
            .cmp(&b.effective_from)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(out)
}

fn generated_salary_events_between(
    configs: &[SalaryConfig],
    range_start: NaiveDate,
    range_end: NaiveDate,
) -> Vec<SalaryEvent> {
    if configs.is_empty() || range_end < range_start {
        return Vec::new();
    }

    let normalized = match normalized_salary_configs(configs) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let mut events = Vec::new();

    // The final payout for an accrual month is paid in the following calendar
    // month, so include the month immediately before the requested range.
    let mut cursor = if range_start.month() == 1 {
        NaiveDate::from_ymd_opt(range_start.year() - 1, 12, 1)
    } else {
        NaiveDate::from_ymd_opt(range_start.year(), range_start.month() - 1, 1)
    }
    .unwrap_or(range_start);
    let last_accrual_month =
        NaiveDate::from_ymd_opt(range_end.year(), range_end.month(), 1).unwrap_or(range_end);

    while cursor <= last_accrual_month {
        let year = cursor.year();
        let month = cursor.month();
        let accrual_month = cursor.format("%Y-%m").to_string();
        let config = normalized
            .iter()
            .rev()
            .find(|candidate| candidate.effective_from.get(..7) <= Some(accrual_month.as_str()));

        if let Some(config) = config.filter(|candidate| candidate.auto_generate && candidate.amount > 0) {
            let advance_base_day = clamp_salary_day(year, month, config.advance_day);
            let salary_month = if month == 12 {
                NaiveDate::from_ymd_opt(year + 1, 1, 1)
            } else {
                NaiveDate::from_ymd_opt(year, month + 1, 1)
            };

            if let Some(salary_month) = salary_month {
                let salary_base_day =
                    clamp_salary_day(salary_month.year(), salary_month.month(), config.salary_day);
                let advance_amount =
                    ((config.amount as i128) * (config.advance_percent as i128) / 100) as i64;
                let candidates = [
                    (
                        "Advance",
                        "advance",
                        shift_to_previous_workday(
                            NaiveDate::from_ymd_opt(year, month, advance_base_day)
                                .unwrap_or(cursor),
                        ),
                        advance_amount,
                    ),
                    (
                        "Salary",
                        "salary",
                        shift_to_previous_workday(
                            NaiveDate::from_ymd_opt(
                                salary_month.year(),
                                salary_month.month(),
                                salary_base_day,
                            )
                            .unwrap_or(salary_month),
                        ),
                        config.amount - advance_amount,
                    ),
                ];

                for (title, payout_type, date, amount) in candidates {
                    if amount <= 0 || date < range_start || date > range_end {
                        continue;
                    }

                    events.push(SalaryEvent {
                        id: format!("auto_{}_{}_{}", config.id, payout_type, accrual_month),
                        date: date.format("%Y-%m-%d").to_string(),
                        amount,
                        title: title.to_string(),
                        accrual_month: Some(accrual_month.clone()),
                        kind: crate::models::SalaryEventKind::Regular,
                    });
                }
            }
        }

        let next_month = if month == 12 {
            NaiveDate::from_ymd_opt(year + 1, 1, 1)
        } else {
            NaiveDate::from_ymd_opt(year, month + 1, 1)
        };
        let Some(next_month) = next_month else {
            break;
        };
        cursor = next_month;
    }

    events.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.title.cmp(&b.title)));
    events
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

fn reduce_debt(data: &mut AppData, person: &str, amount: i64) {
    let normalized_person = normalize_person(person);
    if normalized_person.is_empty() || amount <= 0 {
        return;
    }

    if let Some(index) = data
        .debts
        .iter()
        .position(|d| d.person.eq_ignore_ascii_case(&normalized_person))
    {
        let remaining = data.debts[index].amount.saturating_sub(amount);
        if remaining <= 0 {
            data.debts.remove(index);
        } else {
            data.debts[index].amount = remaining;
        }
    }
}

fn restore_debt(data: &mut AppData, person: &str, amount: i64) {
    let normalized_person = normalize_person(person);
    if normalized_person.is_empty() || amount <= 0 {
        return;
    }

    if let Some(debt) = data
        .debts
        .iter_mut()
        .find(|d| d.person.eq_ignore_ascii_case(&normalized_person))
    {
        debt.amount = debt.amount.saturating_add(amount);
    } else {
        data.debts.push(Debt {
            id: format!("debt_{}", Uuid::new_v4()),
            person: normalized_person,
            amount,
        });
    }
}

fn apply_debt_payment(data: &mut AppData, tx: &Transaction) {
    if let (TxType::Expense, Some(person)) = (&tx.r#type, tx.debt_person.as_deref()) {
        reduce_debt(data, person, tx.amount.saturating_abs());
    }
}

fn rollback_debt_payment(data: &mut AppData, tx: &Transaction) {
    if let (TxType::Expense, Some(person)) = (&tx.r#type, tx.debt_person.as_deref()) {
        restore_debt(data, person, tx.amount.saturating_abs());
    }
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
pub fn set_date_format(app: AppHandle, date_format: String) -> Result<AppData, String> {
    let mut data = load(&app)?;
    let Some(normalized) = normalize_date_format(&date_format) else {
        return Err("date_format must be 'dd-mm-yyyy', 'mm-dd-yyyy', or 'yyyy-mm-dd'".to_string());
    };
    data.settings.date_format = normalized;
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
pub fn set_user_preferences(
    app: AppHandle,
    work_schedule: String,
    save_remaining_daily_limit_to_piggy_bank: bool,
    last_daily_limit_carryover_date: String,
) -> Result<AppData, String> {
    let mut data = load(&app)?;
    let normalized = work_schedule.trim().to_lowercase();
    data.settings.work_schedule = match normalized.as_str() {
        "5/2" => WorkSchedule::FiveTwo,
        "custom" => WorkSchedule::Custom,
        _ => return Err("work_schedule must be '5/2' or 'custom'".to_string()),
    };
    data.settings.save_remaining_daily_limit_to_piggy_bank = save_remaining_daily_limit_to_piggy_bank;
    data.settings.last_daily_limit_carryover_date = last_daily_limit_carryover_date.trim().to_string();
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn set_salary_configs(app: AppHandle, salary_configs: Vec<SalaryConfig>) -> Result<AppData, String> {
    let mut data = load(&app)?;
    data.settings.salary_configs = normalized_salary_configs(&salary_configs)?;
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn apply_daily_limit_carryover(
    app: AppHandle,
    amount: i64,
    processed_date: String,
) -> Result<AppData, String> {
    let mut data = load(&app)?;
    data.piggy_bank_amount = data.piggy_bank_amount.saturating_add(amount.max(0));
    data.settings.last_daily_limit_carryover_date = processed_date.trim().to_string();
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

    apply_debt_payment(&mut data, &tx);
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

    let previous_tx = data.transactions[i].clone();

    tx.amount = tx.amount.saturating_abs();
    tx.category = normalize_category(&tx.category);
    remember_category(&mut data.settings, &tx.r#type, &tx.category);
    tx.debt_person = tx
        .debt_person
        .as_ref()
        .map(|p| normalize_person(p))
        .filter(|p| !p.is_empty());

    rollback_debt_payment(&mut data, &previous_tx);
    apply_debt_payment(&mut data, &tx);
    data.transactions[i] = tx;
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn delete_transaction(app: AppHandle, id: String) -> Result<AppData, String> {
    let mut data = load(&app)?;

    if let Some(tx) = data.transactions.iter().find(|t| t.id == id).cloned() {
        rollback_debt_payment(&mut data, &tx);
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
    ev.accrual_month = match ev.accrual_month.as_deref() {
        Some(raw) if raw.trim().is_empty() => None,
        Some(raw) => normalize_accrual_month(raw)
            .ok_or_else(|| "accrualMonth must be in YYYY-MM format".to_string())
            .map(Some)?,
        None => None,
    };

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
    let generated_start = data
        .settings
        .salary_configs
        .iter()
        .filter_map(|config| parse_date(&config.effective_from).ok())
        .min()
        .unwrap_or(from);
    let generated_salary_events = generated_salary_events_between(
        &data.settings.salary_configs,
        generated_start,
        from + Duration::days(400),
    );
    let mut all_salary_events = data.salary_events.clone();
    all_salary_events.extend(generated_salary_events);

    // Найти ближайшую зарплату строго после from_date
    let next_date = all_salary_events
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

    for s in &all_salary_events {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_salary_config_defaults_to_manual_payouts() {
        let config: SalaryConfig = serde_json::from_str(
            r#"{
                "id": "manual",
                "effectiveFrom": "2026-09-01",
                "amount": 20000000,
                "advancePercent": 50,
                "advanceDay": 20,
                "salaryDay": 5
            }"#,
        )
        .unwrap();

        assert!(!config.auto_generate);
        assert!(generated_salary_events_between(
            &[config],
            NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 10, 10).unwrap(),
        )
        .is_empty());
    }

    #[test]
    fn salary_raise_applies_to_accrual_month_not_payout_month() {
        let configs = vec![
            SalaryConfig {
                id: "old".to_string(),
                effective_from: "2026-01-01".to_string(),
                amount: 16_008_000,
                auto_generate: true,
                advance_percent: 50,
                advance_day: 20,
                salary_day: 5,
            },
            SalaryConfig {
                id: "raise".to_string(),
                effective_from: "2026-09-01".to_string(),
                amount: 20_000_000,
                auto_generate: true,
                advance_percent: 50,
                advance_day: 20,
                salary_day: 5,
            },
        ];

        let events = generated_salary_events_between(
            &configs,
            NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 10, 10).unwrap(),
        );
        let actual = events
            .iter()
            .map(|event| {
                (
                    event.date.as_str(),
                    event.amount,
                    event.accrual_month.as_deref(),
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            actual,
            vec![
                ("2026-09-04", 8_004_000, Some("2026-08")),
                ("2026-09-18", 10_000_000, Some("2026-09")),
                ("2026-10-05", 10_000_000, Some("2026-09")),
            ]
        );
    }
}
