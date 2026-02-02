use crate::models::AppData;
use anyhow::Result;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn data_file_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("app_data_dir error: {e}"))?;

    fs::create_dir_all(&dir)?;
    Ok(dir.join("data.json"))
}

pub fn load_or_init(app: &AppHandle) -> Result<AppData> {
    let path = data_file_path(app)?;
    if !path.exists() {
        let data = AppData::default();
        save(app, &data)?;
        return Ok(data);
    }

    let raw = fs::read_to_string(path)?;
    let data: AppData = serde_json::from_str(&raw)?;
    Ok(data)
}

pub fn save(app: &AppHandle, data: &AppData) -> Result<()> {
    let path = data_file_path(app)?;
    let raw = serde_json::to_string_pretty(data)?;
    fs::write(path, raw)?;
    Ok(())
}
