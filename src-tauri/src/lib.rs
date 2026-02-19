mod commands;
mod models;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::get_data,
            commands::set_language,
            commands::set_tx_categories,
            commands::add_transaction,
            commands::update_transaction,
            commands::delete_transaction,
            commands::upsert_salary_event,
            commands::upsert_vacation,
            commands::upsert_off_day,
            commands::export_backup,
            commands::save_backup_to_path,
            commands::save_backup_to_dir,
            commands::import_backup,
            commands::import_backup_from_path,
            commands::calc_daily_budget,
            commands::delete_salary_event,
            commands::set_piggy_bank_amount,
            commands::delete_vacation,
            commands::delete_off_day,
            commands::upsert_debt,
            commands::delete_debt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
