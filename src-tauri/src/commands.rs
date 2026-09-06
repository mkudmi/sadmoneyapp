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
    // An advance at the start of the next month may be paid in the requested
    // month when its scheduled date falls on a weekend.
    let last_accrual_month = if range_end.month() == 12 {
        NaiveDate::from_ymd_opt(range_end.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(range_end.year(), range_end.month() + 1, 1)
    }
    .unwrap_or(range_end);

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

fn same_person(left: &str, right: &str) -> bool {
    normalize_person(left).to_lowercase() == normalize_person(right).to_lowercase()
}

fn reduce_debt(data: &mut AppData, person: &str, amount: i64) -> i64 {
    let normalized_person = normalize_person(person);
    if normalized_person.is_empty() || amount <= 0 {
        return 0;
    }

    if let Some(index) = data
        .debts
        .iter()
        .position(|d| same_person(&d.person, &normalized_person))
    {
        let repaid = amount.min(data.debts[index].amount.max(0));
        let remaining = data.debts[index].amount - repaid;
        if remaining <= 0 {
            data.debts.remove(index);
        } else {
            data.debts[index].amount = remaining;
        }
        return repaid;
    }
    0
}

fn restore_debt(data: &mut AppData, person: &str, amount: i64) {
    let normalized_person = normalize_person(person);
    if normalized_person.is_empty() || amount <= 0 {
        return;
    }

    if let Some(debt) = data
        .debts
        .iter_mut()
        .find(|d| same_person(&d.person, &normalized_person))
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

fn apply_debt_payment(data: &mut AppData, tx: &mut Transaction) {
    // Repayment bookkeeping is derived here, never accepted from the frontend.
    tx.debt_repaid_amount = None;
    if let (TxType::Expense, Some(person)) = (&tx.r#type, tx.debt_person.as_deref()) {
        tx.debt_repaid_amount = Some(reduce_debt(data, person, tx.amount));
    }
}

fn repaid_amount(tx: &Transaction) -> i64 {
    // Preserve the previous behavior for existing records without bookkeeping.
    tx.debt_repaid_amount
        .unwrap_or(tx.amount)
        .clamp(0, tx.amount.max(0))
}

fn rollback_debt_payment(data: &mut AppData, tx: &Transaction) {
    if let (TxType::Expense, Some(person)) = (&tx.r#type, tx.debt_person.as_deref()) {
        restore_debt(data, person, repaid_amount(tx));
    }
}

fn update_debt_payment(data: &mut AppData, previous: &Transaction, tx: &mut Transaction) {
    if let (TxType::Expense, TxType::Expense, Some(previous_person), Some(person)) = (
        &previous.r#type,
        &tx.r#type,
        previous.debt_person.as_deref(),
        tx.debt_person.as_deref(),
    ) {
        if same_person(previous_person, person) {
            let previous_repaid = repaid_amount(previous);
            if tx.amount > previous.amount {
                let additional_repaid = reduce_debt(data, person, tx.amount - previous.amount);
                tx.debt_repaid_amount = Some(previous_repaid.saturating_add(additional_repaid));
            } else {
                let retained_repayment = previous_repaid.min(tx.amount);
                restore_debt(data, person, previous_repaid - retained_repayment);
                tx.debt_repaid_amount = Some(retained_repayment);
            }
            return;
        }
    }

    rollback_debt_payment(data, previous);
    apply_debt_payment(data, tx);
}

fn apply_carryover(data: &mut AppData, amount: i64, processed_date: &str) -> Result<(), String> {
    let processed = parse_date(processed_date.trim())
        .map_err(|_| "processed_date must be a valid date in YYYY-MM-DD format".to_string())?;
    let previous = data.settings.last_daily_limit_carryover_date.trim();
    if !previous.is_empty() {
        let previous =
            parse_date(previous).map_err(|_| "stored carryover date is invalid".to_string())?;
        // Effects and retries can submit the same day more than once. Never
        // credit a processed day twice or move the checkpoint backwards.
        if processed <= previous {
            return Ok(());
        }
    }
    if !data.settings.save_remaining_daily_limit_to_piggy_bank {
        return Ok(());
    }
    data.piggy_bank_amount = data.piggy_bank_amount.saturating_add(amount.max(0));
    data.settings.last_daily_limit_carryover_date = processed.format("%Y-%m-%d").to_string();
    Ok(())
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
    let carryover_date = last_daily_limit_carryover_date.trim();
    data.settings.last_daily_limit_carryover_date = if carryover_date.is_empty() {
        String::new()
    } else {
        parse_date(carryover_date)
            .map_err(|_| "last_daily_limit_carryover_date must be a valid date".to_string())?
            .format("%Y-%m-%d")
            .to_string()
    };
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
    apply_carryover(&mut data, amount, &processed_date)?;
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn add_transaction(app: AppHandle, mut tx: Transaction) -> Result<AppData, String> {
    let mut data = load(&app)?;

    if tx.id.trim().is_empty() {
        tx.id = format!("tx_{}", Uuid::new_v4());
    }
    if data.transactions.iter().any(|existing| existing.id == tx.id) {
        return Err("transaction id already exists".to_string());
    }
    tx.date = parse_date(tx.date.trim())
        .map_err(|_| "transaction date must be a valid date".to_string())?
        .format("%Y-%m-%d")
        .to_string();

    // простая нормализация: расход всегда положительный amount, тип решает знак
    tx.amount = tx.amount.saturating_abs();
    tx.category = normalize_category(&tx.category);
    remember_category(&mut data.settings, &tx.r#type, &tx.category);
    tx.debt_person = tx
        .debt_person
        .as_ref()
        .map(|p| normalize_person(p))
        .filter(|p| !p.is_empty());

    apply_debt_payment(&mut data, &mut tx);
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

    tx.date = parse_date(tx.date.trim())
        .map_err(|_| "transaction date must be a valid date".to_string())?
        .format("%Y-%m-%d")
        .to_string();
    tx.amount = tx.amount.saturating_abs();
    tx.category = normalize_category(&tx.category);
    remember_category(&mut data.settings, &tx.r#type, &tx.category);
    tx.debt_person = tx
        .debt_person
        .as_ref()
        .map(|p| normalize_person(p))
        .filter(|p| !p.is_empty());

    update_debt_payment(&mut data, &previous_tx, &mut tx);
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
            .find(|d| same_person(&d.person, &debt.person))
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
    let data = parse_backup(&backup_json)?;
    save(&app, &data)?;
    Ok(data)
}

fn parse_backup(raw: &str) -> Result<AppData, String> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "backup is not valid JSON".to_string())?;
    // AppData has serde defaults for migrations. Without a format check even
    // `{}` or an unrelated JSON document would silently replace all user data.
    if !value.get("settings").is_some_and(|v| v.is_object())
        || !value.get("transactions").is_some_and(|v| v.is_array())
        || !value.get("salaryEvents").is_some_and(|v| v.is_array())
        || value.get("version").and_then(|v| v.as_i64()).is_none()
    {
        return Err("file is not a SadMoney backup".to_string());
    }
    if value["version"].as_i64() != Some(1) {
        return Err("backup version is not supported".to_string());
    }
    let data: AppData = serde_json::from_value(value)
        .map_err(|_| "backup contains invalid data".to_string())?;

    let dates = data
        .transactions
        .iter()
        .map(|v| v.date.as_str())
        .chain(data.salary_events.iter().map(|v| v.date.as_str()))
        .chain(data.off_days.iter().map(|v| v.date.as_str()))
        .chain(
            data.vacations
                .iter()
                .flat_map(|v| [v.start_date.as_str(), v.end_date.as_str()]),
        )
        .chain(
            data.settings
                .salary_configs
                .iter()
                .map(|v| v.effective_from.as_str()),
        )
        .chain(
            std::iter::once(data.settings.last_daily_limit_carryover_date.as_str())
                .filter(|v| !v.is_empty()),
        );
    for date in dates {
        let parsed = parse_date(date).map_err(|_| "backup contains invalid dates".to_string())?;
        if parsed.format("%Y-%m-%d").to_string() != date {
            return Err("backup dates must use YYYY-MM-DD format".to_string());
        }
    }
    if data.vacations.iter().any(|v| v.end_date < v.start_date) {
        return Err("backup contains an invalid vacation range".to_string());
    }
    let amounts = data
        .transactions
        .iter()
        .map(|v| v.amount)
        .chain(data.salary_events.iter().map(|v| v.amount))
        .chain(data.debts.iter().map(|v| v.amount))
        .chain(data.settings.salary_configs.iter().map(|v| v.amount))
        .chain([data.piggy_bank_amount, data.settings.min_balance]);
    if amounts.into_iter().any(|amount| amount < 0)
        || data.transactions.iter().any(|tx| {
            tx.debt_repaid_amount
                .is_some_and(|v| v < 0 || v > tx.amount)
        })
    {
        return Err("backup contains invalid amounts".to_string());
    }
    let mut transaction_ids = std::collections::HashSet::new();
    if data
        .transactions
        .iter()
        .any(|tx| tx.id.trim().is_empty() || !transaction_ids.insert(&tx.id))
    {
        return Err("backup contains empty or duplicate transaction ids".to_string());
    }
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

    fn debt_expense(amount: i64) -> Transaction {
        Transaction {
            id: "repayment".to_string(),
            date: "2026-09-05".to_string(),
            r#type: TxType::Expense,
            amount,
            category: "Debt".to_string(),
            note: String::new(),
            debt_person: Some("Алексей".to_string()),
            debt_repaid_amount: None,
        }
    }

    #[test]
    fn deleting_overpayment_restores_only_the_original_debt() {
        let mut data = AppData::default();
        restore_debt(&mut data, "Алексей", 10_000);
        let mut tx = debt_expense(15_000);

        apply_debt_payment(&mut data, &mut tx);
        assert!(data.debts.is_empty());
        assert_eq!(tx.debt_repaid_amount, Some(10_000));
        rollback_debt_payment(&mut data, &tx);

        assert_eq!(data.debts[0].amount, 10_000);
    }

    #[test]
    fn deleting_expense_without_outstanding_debt_does_not_create_a_debt() {
        let mut data = AppData::default();
        let mut tx = debt_expense(15_000);
        // Frontend-supplied bookkeeping must not be trusted.
        tx.debt_repaid_amount = Some(15_000);

        apply_debt_payment(&mut data, &mut tx);
        rollback_debt_payment(&mut data, &tx);

        assert_eq!(tx.debt_repaid_amount, Some(0));
        assert!(data.debts.is_empty());
    }

    #[test]
    fn editing_or_merging_an_overpayment_does_not_repay_new_debt_twice() {
        let mut data = AppData::default();
        restore_debt(&mut data, "Алексей", 10_000);
        let mut previous = debt_expense(15_000);
        apply_debt_payment(&mut data, &mut previous);
        restore_debt(&mut data, "Алексей", 8_000);

        let mut edited = previous.clone();
        edited.note = "Updated note".to_string();
        update_debt_payment(&mut data, &previous, &mut edited);
        assert_eq!(data.debts[0].amount, 8_000);

        let mut merged = edited.clone();
        merged.amount += 5_000;
        update_debt_payment(&mut data, &edited, &mut merged);
        assert_eq!(data.debts[0].amount, 3_000);
        assert_eq!(merged.debt_repaid_amount, Some(15_000));
        rollback_debt_payment(&mut data, &merged);
        assert_eq!(data.debts[0].amount, 18_000);
    }

    #[test]
    fn reducing_an_overpayment_restores_only_the_repayment_difference() {
        let mut data = AppData::default();
        restore_debt(&mut data, "Алексей", 10_000);
        let mut previous = debt_expense(15_000);
        apply_debt_payment(&mut data, &mut previous);

        let mut edited = previous.clone();
        edited.amount = 12_000;
        update_debt_payment(&mut data, &previous, &mut edited);
        assert!(data.debts.is_empty());
        assert_eq!(edited.debt_repaid_amount, Some(10_000));

        let mut reduced = edited.clone();
        reduced.amount = 8_000;
        update_debt_payment(&mut data, &edited, &mut reduced);
        assert_eq!(data.debts[0].amount, 2_000);
        assert_eq!(reduced.debt_repaid_amount, Some(8_000));
    }

    #[test]
    fn changing_expense_to_income_restores_its_repayment() {
        let mut data = AppData::default();
        restore_debt(&mut data, "Алексей", 10_000);
        let mut previous = debt_expense(15_000);
        apply_debt_payment(&mut data, &mut previous);
        let mut edited = previous.clone();
        edited.r#type = TxType::Income;

        update_debt_payment(&mut data, &previous, &mut edited);

        assert_eq!(data.debts[0].amount, 10_000);
        assert_eq!(edited.debt_repaid_amount, None);
    }

    #[test]
    fn debt_names_match_case_insensitively_in_russian() {
        let mut data = AppData::default();
        restore_debt(&mut data, "алексей", 10_000);
        let mut tx = debt_expense(3_000);

        apply_debt_payment(&mut data, &mut tx);

        assert_eq!(data.debts.len(), 1);
        assert_eq!(data.debts[0].amount, 7_000);
    }

    #[test]
    fn carryover_is_idempotent_and_never_moves_backwards() {
        let mut data = AppData::default();
        data.settings.save_remaining_daily_limit_to_piggy_bank = true;
        data.settings.last_daily_limit_carryover_date = "2026-09-04".to_string();

        apply_carryover(&mut data, 1_000, "2026-09-05").unwrap();
        apply_carryover(&mut data, 1_000, "2026-09-05").unwrap();
        apply_carryover(&mut data, 9_000, "2026-09-04").unwrap();

        assert_eq!(data.piggy_bank_amount, 1_000);
        assert_eq!(data.settings.last_daily_limit_carryover_date, "2026-09-05");
    }

    #[test]
    fn carryover_rejects_invalid_dates_and_ignores_disabled_saving() {
        let mut data = AppData::default();
        assert!(apply_carryover(&mut data, 1_000, "2026-02-30").is_err());
        apply_carryover(&mut data, 1_000, "2026-09-05").unwrap();
        assert_eq!(data.piggy_bank_amount, 0);
        assert!(data.settings.last_daily_limit_carryover_date.is_empty());
    }

    #[test]
    fn import_rejects_unrelated_json_and_unsupported_versions() {
        assert!(parse_backup("{}").is_err());
        assert!(
            parse_backup(r#"{"settings":{},"transactions":[],"salaryEvents":[]}"#).is_err()
        );
        let mut backup = serde_json::to_value(AppData::default()).unwrap();
        backup["version"] = serde_json::json!(2);
        assert!(parse_backup(&backup.to_string()).is_err());
    }

    #[test]
    fn import_accepts_legacy_backups_without_repayment_bookkeeping() {
        let mut data = AppData::default();
        data.transactions.push(debt_expense(10_000));
        let raw = serde_json::to_string(&data).unwrap();
        assert!(!raw.contains("debt_repaid_amount"));

        let imported = parse_backup(&raw).unwrap();

        assert_eq!(imported.transactions[0].debt_repaid_amount, None);
        assert_eq!(repaid_amount(&imported.transactions[0]), 10_000);
    }

    #[test]
    fn import_rejects_invalid_dates_amounts_and_duplicate_transactions() {
        let mut data = AppData::default();
        let mut tx = debt_expense(10_000);
        tx.date = "2026-02-30".to_string();
        data.transactions.push(tx);
        assert!(parse_backup(&serde_json::to_string(&data).unwrap()).is_err());

        data.transactions[0].date = "2026-09-05".to_string();
        data.transactions[0].amount = -1;
        assert!(parse_backup(&serde_json::to_string(&data).unwrap()).is_err());

        data.transactions[0].amount = 10_000;
        data.transactions.push(data.transactions[0].clone());
        assert!(parse_backup(&serde_json::to_string(&data).unwrap()).is_err());
    }

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

    #[test]
    fn next_month_advance_shifted_back_is_included_in_range() {
        for (effective_from, payout_date) in [
            ("2026-02-01", "2026-01-30"),
            ("2023-01-01", "2022-12-30"),
        ] {
            let config = SalaryConfig {
                id: "scheduled".to_string(),
                effective_from: effective_from.to_string(),
                amount: 10_000_000,
                auto_generate: true,
                advance_percent: 50,
                advance_day: 1,
                salary_day: 5,
            };
            let date = parse_date(payout_date).unwrap();
            let events = generated_salary_events_between(&[config], date, date);

            assert_eq!(events.len(), 1);
            assert_eq!(events[0].date, payout_date);
            assert_eq!(events[0].amount, 5_000_000);
            assert_eq!(events[0].accrual_month.as_deref(), effective_from.get(..7));
        }
    }
}
