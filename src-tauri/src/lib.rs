mod commands;
mod models;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_data,
            commands::add_transaction,
            commands::update_transaction,
            commands::delete_transaction,
            commands::upsert_salary_event,
            commands::upsert_vacation,
            commands::upsert_off_day,
            commands::calc_daily_budget,
            commands::delete_salary_event,
            commands::delete_vacation,
            commands::delete_off_day,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
