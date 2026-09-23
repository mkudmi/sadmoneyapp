use crate::models::{AppData, Debt, DebtDirection, OffDay, SalaryConfig, SalaryEvent, SavingsCard, SavingsGoal, Transaction, TxType, Vacation, WorkSchedule};
use crate::storage;
use anyhow::Result;
use chrono::{Datelike, Duration, Local, NaiveDate, Weekday};
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
    let mut data = storage::load_or_init(app).map_err(|e| e.to_string())?;
    let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
    let monthly_income = data.settings.salary_configs.iter()
        .filter(|config| config.amount > 0 && config.effective_from.as_str() <= today.as_str())
        .max_by_key(|config| &config.effective_from)
        .map(|config| config.amount)
        .unwrap_or(0);
    let suggested_card_limit = (monthly_income.saturating_mul(3) / 100 / 10_000 * 10_000).clamp(100_000, 500_000);
    if let Some(goal) = data.savings_goal.as_mut() {
        if migrate_savings_goal_cards(goal, data.piggy_bank_amount, suggested_card_limit, &today) {
            save(app, &data)?;
        }
    }
    Ok(data)
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
        .position(|d| d.direction == DebtDirection::Payable && same_person(&d.person, &normalized_person))
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
        .find(|d| d.direction == DebtDirection::Payable && same_person(&d.person, &normalized_person))
    {
        debt.amount = debt.amount.saturating_add(amount);
    } else {
        data.debts.push(Debt {
            direction: DebtDirection::Payable,
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
    tx.was_planned = matches!(tx.r#type, TxType::Expense)
        && (tx.was_planned || matches!(previous_tx.r#type, TxType::PlannedExpense));

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
    if let Some(goal) = data.savings_goal.as_mut() {
        goal.starting_amount = goal.starting_amount.min(data.piggy_bank_amount);
        let mut card_total: i64 = goal.cards.iter().filter(|card| card.completed).map(|card| card.amount).sum();
        for card in goal.cards.iter_mut().rev() {
            if card_total <= data.piggy_bank_amount - goal.starting_amount {
                break;
            }
            if card.completed {
                card.completed = false;
                card.completed_at = None;
                card_total -= card.amount;
            }
        }
    }
    save(&app, &data)?;
    Ok(data)
}

fn split_completed_card(card: &SavingsCard, max_card_amount: i64) -> Vec<SavingsCard> {
    if card.amount > max_card_amount.saturating_mul(600) {
        return vec![card.clone()];
    }
    let mut remaining = card.amount;
    let mut cards = Vec::new();
    while remaining > 0 {
        let amount = remaining.min(max_card_amount);
        cards.push(SavingsCard { amount, completed: true, completed_at: card.completed_at.clone() });
        remaining -= amount;
    }
    cards
}

fn migrate_savings_goal_cards(goal: &mut SavingsGoal, balance: i64, suggested_card_limit: i64, today: &str) -> bool {
    if goal.card_scheme_version >= 3 {
        return false;
    }
    let max_card_amount = if goal.max_card_amount == 0 { suggested_card_limit } else { goal.max_card_amount };
    if let Ok(pending) = savings_cards(goal.target_amount.saturating_sub(balance), max_card_amount) {
        let mut completed: Vec<SavingsCard> = goal.cards.iter().filter(|card| card.completed)
            .flat_map(|card| split_completed_card(card, max_card_amount)).collect();
        completed.extend(pending);
        goal.cards = completed;
    }
    goal.max_card_amount = max_card_amount;
    if goal.created_at.is_empty() {
        goal.created_at = today.to_string();
    }
    goal.card_scheme_version = 3;
    true
}

fn savings_cards(amount: i64, max_card_amount: i64) -> Result<Vec<SavingsCard>, String> {
    savings_cards_with_seed(amount, max_card_amount, Uuid::new_v4().as_u128() as u64)
}

fn next_card_random(seed: &mut u64) -> u64 {
    *seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
    *seed >> 32
}

fn shuffle_card_values<T>(items: &mut [T], seed: &mut u64) {
    for index in (1..items.len()).rev() {
        let other = (next_card_random(seed) as usize) % (index + 1);
        items.swap(index, other);
    }
}

fn savings_cards_with_seed(amount: i64, max_card_amount: i64, mut seed: u64) -> Result<Vec<SavingsCard>, String> {
    if amount <= 0 {
        return Ok(vec![]);
    }
    const MIN_CARD: i64 = 50_000;
    if max_card_amount < MIN_CARD {
        return Err("Card limit is too small".to_string());
    }
    if amount < MIN_CARD {
        return Ok(vec![SavingsCard { amount, completed: false, completed_at: None }]);
    }
    let minimum_count = (amount + max_card_amount - 1) / max_card_amount;
    if minimum_count > 600 {
        return Err("Goal needs more than 600 cards at this card size".to_string());
    }
    let maximum_count = (amount / MIN_CARD).min(600);
    let average = (MIN_CARD + max_card_amount) / 2;
    let count = ((amount + average / 2) / average).clamp(minimum_count, maximum_count) as usize;
    let steps = (max_card_amount - MIN_CARD) / 10_000;
    let mut values: Vec<i64> = (0..count)
        .map(|_| MIN_CARD + (next_card_random(&mut seed) % (steps as u64 + 1)) as i64 * 10_000)
        .collect();
    let mut difference = amount - values.iter().sum::<i64>();
    let mut order: Vec<usize> = (0..count).collect();
    shuffle_card_values(&mut order, &mut seed);
    for index in order {
        if difference > 0 {
            let added = difference.min(max_card_amount - values[index]);
            values[index] += added;
            difference -= added;
        } else if difference < 0 {
            let removed = (-difference).min(values[index] - MIN_CARD);
            values[index] -= removed;
            difference += removed;
        }
    }
    if difference != 0 {
        return Err("Could not distribute savings cards".to_string());
    }
    for _ in 0..128 {
        shuffle_card_values(&mut values, &mut seed);
        if values.windows(2).all(|pair| pair[0] != pair[1]) {
            break;
        }
    }
    if values.windows(2).any(|pair| pair[0] == pair[1]) {
        let mut counts = std::collections::HashMap::new();
        for value in values {
            *counts.entry(value).or_insert(0usize) += 1;
        }
        let mut heap: std::collections::BinaryHeap<(usize, u64, i64)> = counts.into_iter()
            .map(|(value, count)| (count, next_card_random(&mut seed), value)).collect();
        values = Vec::with_capacity(count);
        while let Some(mut selected) = heap.pop() {
            if values.last().is_some_and(|last| *last == selected.2) {
                if let Some(alternative) = heap.pop() {
                    heap.push(selected);
                    selected = alternative;
                }
            }
            values.push(selected.2);
            selected.0 -= 1;
            if selected.0 > 0 {
                selected.1 = next_card_random(&mut seed);
                heap.push(selected);
            }
        }
    }
    Ok(values.into_iter().map(|amount| SavingsCard { amount, completed: false, completed_at: None }).collect())
}

#[tauri::command]
pub fn set_savings_goal(app: AppHandle, title: String, note: String, target_amount: i64, max_card_amount: i64) -> Result<AppData, String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 120 {
        return Err("Goal title must contain 1–120 characters".to_string());
    }
    if note.chars().count() > 500 {
        return Err("Goal note is too long".to_string());
    }
    if !(100..=100_000_000_000).contains(&target_amount) {
        return Err("Goal amount is out of range".to_string());
    }
    if !(100_000..=500_000).contains(&max_card_amount) {
        return Err("Card limit must be between 1,000 and 5,000 rubles".to_string());
    }
    let mut data = load(&app)?;
    if let Some(goal) = data.savings_goal.as_mut() {
        if goal.target_amount == target_amount {
            if goal.max_card_amount != max_card_amount {
                let mut completed: Vec<SavingsCard> = goal.cards.iter().filter(|card| card.completed)
                    .flat_map(|card| split_completed_card(card, max_card_amount)).collect();
                if completed.len() > 600 {
                    completed = completed.split_off(completed.len() - 600);
                }
                completed.extend(savings_cards(target_amount.saturating_sub(data.piggy_bank_amount), max_card_amount)?);
                goal.cards = completed;
                goal.max_card_amount = max_card_amount;
            }
            goal.title = title.to_string();
            goal.note = note.trim().to_string();
            save(&app, &data)?;
            return Ok(data);
        }
    }
    let remaining = (target_amount - data.piggy_bank_amount).max(0);
    let mut cards = data.savings_goal.as_ref().map(|goal| goal.cards.iter()
        .filter(|card| card.completed)
        .flat_map(|card| split_completed_card(card, max_card_amount))
        .collect::<Vec<_>>()).unwrap_or_default();
    if cards.len() > 600 {
        cards = cards.split_off(cards.len() - 600);
    }
    cards.extend(savings_cards(remaining, max_card_amount)?);
    let starting_amount = data.savings_goal.as_ref()
        .map(|goal| goal.starting_amount.min(data.piggy_bank_amount))
        .unwrap_or(data.piggy_bank_amount);
    let created_at = data.savings_goal.as_ref()
        .map(|goal| goal.created_at.clone())
        .filter(|date| !date.is_empty())
        .unwrap_or_else(|| Local::now().date_naive().format("%Y-%m-%d").to_string());
    data.savings_goal = Some(SavingsGoal {
        title: title.to_string(),
        note: note.trim().to_string(),
        target_amount,
        starting_amount,
        max_card_amount,
        created_at,
        card_scheme_version: 3,
        cards,
    });
    save(&app, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn clear_savings_goal(app: AppHandle) -> Result<AppData, String> {
    let mut data = load(&app)?;
    data.savings_goal = None;
    save(&app, &data)?;
    Ok(data)
}

fn toggle_savings_card_in_data(data: &mut AppData, index: usize, today: &str) -> Result<(), String> {
    let goal = data.savings_goal.as_mut().ok_or("Savings goal is missing")?;
    let card = goal.cards.get_mut(index).ok_or("Savings card is missing")?;
    if card.amount <= 0 {
        return Err("Savings card is unavailable".to_string());
    }
    if card.completed {
        data.piggy_bank_amount = data.piggy_bank_amount.checked_sub(card.amount)
            .filter(|amount| *amount >= 0).ok_or("Savings balance is too low to undo this card")?;
        card.completed = false;
        card.completed_at = None;
    } else {
        if card.amount > goal.target_amount.saturating_sub(data.piggy_bank_amount) {
            return Err("Savings card is unavailable".to_string());
        }
        data.piggy_bank_amount = data.piggy_bank_amount.checked_add(card.amount)
            .ok_or("Savings amount is too large")?;
        card.completed = true;
        card.completed_at = Some(today.to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_savings_card(app: AppHandle, index: usize) -> Result<AppData, String> {
    let mut data = load(&app)?;
    let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
    toggle_savings_card_in_data(&mut data, index, &today)?;
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
            .find(|d| d.direction == debt.direction && same_person(&d.person, &debt.person))
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
        .chain([data.piggy_bank_amount, data.settings.min_balance])
        .chain(data.savings_goal.iter().flat_map(|goal| {
            [goal.target_amount, goal.max_card_amount, goal.starting_amount]
                .into_iter()
                .chain(goal.cards.iter().map(|card| card.amount))
        }));
    if amounts.into_iter().any(|amount| amount < 0)
        || data.transactions.iter().any(|tx| {
            tx.debt_repaid_amount
                .is_some_and(|v| v < 0 || v > tx.amount)
        })
    {
        return Err("backup contains invalid amounts".to_string());
    }
    if let Some(goal) = &data.savings_goal {
        if goal.title.trim().is_empty()
            || goal.title.chars().count() > 120
            || goal.note.chars().count() > 500
            || !(100..=100_000_000_000).contains(&goal.target_amount)
            || (goal.max_card_amount != 0 && !(100_000..=500_000).contains(&goal.max_card_amount))
            || goal.starting_amount > data.piggy_bank_amount
            || goal.cards.len() > 1200
            || goal.cards.iter().any(|card| card.amount <= 0)
            || (goal.max_card_amount > 0 && goal.cards.iter().any(|card| card.amount > goal.max_card_amount))
            || (!goal.created_at.is_empty() && parse_date(&goal.created_at).is_err())
            || goal.cards.iter().any(|card| card.completed_at.as_ref().is_some_and(|date| parse_date(date).is_err()))
        {
            return Err("backup contains an invalid savings goal".to_string());
        }
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
    calculate_daily_budget(&data, from)
}

fn calculate_daily_budget(data: &AppData, from: NaiveDate) -> Result<DailyBudgetResult, String> {
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
                        if d < from || t.was_planned {
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
    fn legacy_debts_default_to_payable_and_directions_round_trip() {
        let legacy: Debt = serde_json::from_str(r#"{"id":"old","person":"Иван","amount":100}"#).unwrap();
        assert_eq!(legacy.direction, DebtDirection::Payable);
        let receivable = Debt { direction: DebtDirection::Receivable, ..legacy };
        let restored: Debt = serde_json::from_str(&serde_json::to_string(&receivable).unwrap()).unwrap();
        assert_eq!(restored.direction, DebtDirection::Receivable);
        assert!(serde_json::from_str::<Debt>(r#"{"id":"bad","person":"Иван","amount":100,"direction":"invalid"}"#).is_err());
    }

    #[test]
    fn expense_repayment_and_rollback_leave_receivables_unchanged() {
        let mut data = AppData::default();
        data.debts.push(Debt {
            id: "receivable".to_string(),
            person: "Алексей".to_string(),
            amount: 20_000,
            direction: DebtDirection::Receivable,
        });
        restore_debt(&mut data, "Алексей", 10_000);
        let mut tx = debt_expense(15_000);
        apply_debt_payment(&mut data, &mut tx);
        assert_eq!(data.debts.len(), 1);
        assert_eq!(data.debts[0].amount, 20_000);
        assert_eq!(tx.debt_repaid_amount, Some(10_000));
        rollback_debt_payment(&mut data, &tx);
        assert_eq!(data.debts.len(), 2);
        assert_eq!(data.debts[0].amount, 20_000);
        assert_eq!(data.debts[1].direction, DebtDirection::Payable);
        assert_eq!(data.debts[1].amount, 10_000);
    }

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
            was_planned: false,
            exclude_from_statistics: false,
        }
    }

    #[test]
    fn paying_planned_expense_preserves_daily_allowance() {
        let mut data = AppData::default();
        data.settings.min_balance = 0;
        let mut income = debt_expense(100_000);
        income.r#type = TxType::Income;
        let mut planned = debt_expense(30_000);
        planned.r#type = TxType::PlannedExpense;
        data.transactions = vec![income, planned];
        data.salary_events.push(SalaryEvent {
            id: "next".to_string(),
            date: "2026-09-15".to_string(),
            amount: 100_000,
            title: "Salary".to_string(),
            kind: Default::default(),
            accrual_month: None,
        });
        let date = parse_date("2026-09-05").unwrap();
        let before = calculate_daily_budget(&data, date).unwrap();
        data.transactions[1].r#type = TxType::Expense;
        data.transactions[1].was_planned = true;
        let after = calculate_daily_budget(&data, date).unwrap();
        assert_eq!(before.available, 70_000);
        assert_eq!(after.available, before.available);
        assert_eq!(before.per_day, 7_000);
        assert_eq!(after.per_day, before.per_day);
        let mut ordinary = debt_expense(2_000);
        ordinary.id = "ordinary".to_string();
        data.transactions.push(ordinary);
        let with_spending = calculate_daily_budget(&data, date).unwrap();
        assert_eq!(with_spending.available, 68_000);
        assert_eq!(with_spending.per_day - 2_000, 5_000);
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

    #[test]
    fn savings_cards_cover_the_goal_without_exceeding_the_limit() {
        for amount in [100, 5_000, 50_000, 300_000, 12_000_000] {
            let cards = savings_cards_with_seed(amount, 100_000, 42).unwrap();
            assert!(!cards.is_empty());
            assert!(cards.len() <= 600);
            assert!(cards.iter().all(|card| card.amount > 0 && card.amount <= 100_000 && !card.completed));
            if amount >= 50_000 {
                assert!(cards.iter().all(|card| card.amount >= 50_000));
            }
            assert_eq!(cards.iter().map(|card| card.amount).sum::<i64>(), amount);
        }
        assert!(savings_cards(12_000_000, 270_000).unwrap().len() > 12);
        assert!(savings_cards(1_000_000_000, 100_000).is_err());
    }

    #[test]
    fn savings_cards_have_varied_order_without_repeating_rows() {
        for seed in 0..256 {
            let cards = savings_cards_with_seed(12_000_000, 500_000, seed).unwrap();
            let amounts: Vec<i64> = cards.iter().map(|card| card.amount).collect();
            assert!(amounts.iter().collect::<std::collections::HashSet<_>>().len() > 10);
            assert!(amounts.windows(2).all(|pair| pair[0] != pair[1]), "seed {seed}");
            assert_ne!(&amounts[..6], &amounts[6..12]);
            assert_eq!(amounts.iter().sum::<i64>(), 12_000_000);
        }
    }

    #[test]
    fn tapping_a_savings_card_twice_restores_the_balance_and_card() {
        let mut data = AppData::default();
        data.savings_goal = Some(SavingsGoal {
            title: "Bike".to_string(),
            note: String::new(),
            target_amount: 100_000,
            starting_amount: 0,
            max_card_amount: 100_000,
            created_at: "2026-09-23".to_string(),
            card_scheme_version: 3,
            cards: vec![SavingsCard { amount: 50_000, completed: false, completed_at: None }],
        });

        toggle_savings_card_in_data(&mut data, 0, "2026-09-23").unwrap();
        assert_eq!(data.piggy_bank_amount, 50_000);
        assert_eq!(data.savings_goal.as_ref().unwrap().cards[0].completed_at.as_deref(), Some("2026-09-23"));

        toggle_savings_card_in_data(&mut data, 0, "2026-09-24").unwrap();
        assert_eq!(data.piggy_bank_amount, 0);
        let card = &data.savings_goal.as_ref().unwrap().cards[0];
        assert!(!card.completed);
        assert!(card.completed_at.is_none());
    }

    #[test]
    fn saved_old_card_board_is_rebuilt_with_small_cards() {
        let mut goal = SavingsGoal {
            title: "Phone".to_string(),
            note: String::new(),
            target_amount: 12_000_000,
            starting_amount: 0,
            max_card_amount: 500_000,
            created_at: "2026-09-23".to_string(),
            card_scheme_version: 2,
            cards: vec![SavingsCard { amount: 250_000, completed: false, completed_at: None }],
        };

        assert!(migrate_savings_goal_cards(&mut goal, 0, 100_000, "2026-09-23"));
        assert_eq!(goal.card_scheme_version, 3);
        assert!(goal.cards.iter().map(|card| card.amount).collect::<std::collections::HashSet<_>>().len() > 10);
        assert_eq!(goal.cards.iter().map(|card| card.amount).sum::<i64>(), 12_000_000);
        assert!(!migrate_savings_goal_cards(&mut goal, 0, 100_000, "2026-09-23"));
    }

    #[test]
    fn savings_goal_backup_is_backward_compatible_and_validated() {
        let mut legacy = serde_json::to_value(AppData::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("savingsGoal");
        assert!(parse_backup(&legacy.to_string()).unwrap().savings_goal.is_none());

        legacy["savingsGoal"] = serde_json::json!({
            "title": "Bike", "targetAmount": 30_000_00,
            "startingAmount": 0, "maxCardAmount": 100_000,
            "createdAt": "2026-09-23", "cards": [{"amount": 4_000_00, "completed": false}]
        });
        assert!(parse_backup(&legacy.to_string()).is_err());
    }
}
