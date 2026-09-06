use crate::models::AppData;
use anyhow::Result;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
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
    save_to_path(&path, data)
}

fn save_to_path(path: &Path, data: &AppData) -> Result<()> {
    let raw = serde_json::to_string_pretty(data)?;
    // Keep the temporary file on the same filesystem so rename replaces the
    // complete snapshot atomically on both Windows and macOS.
    let temporary_path = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut temporary_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)?;
    let write_result = (|| {
        // Replacing a file must preserve any permissions the user restricted.
        match fs::metadata(path) {
            Ok(metadata) => temporary_file.set_permissions(metadata.permissions())?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        temporary_file.write_all(raw.as_bytes())?;
        temporary_file.sync_all()
    })();
    // Windows requires closing the handle before replacing the destination.
    drop(temporary_file);
    let result = write_result.and_then(|_| fs::rename(&temporary_path, path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result.map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomically_replaces_existing_data_and_preserves_utf8() {
        let directory =
            std::env::temp_dir().join(format!("sadmoney-storage-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("data.json");
        fs::write(&path, "old snapshot").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        }
        let mut data = AppData::default();
        data.settings.tx_categories = vec!["Продукты".to_string()];
        data.piggy_bank_amount = 12345;

        save_to_path(&path, &data).unwrap();

        let saved: AppData = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved.piggy_bank_amount, 12345);
        assert_eq!(saved.settings.tx_categories, vec!["Продукты"]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_replace_preserves_destination_and_removes_temporary_file() {
        let directory =
            std::env::temp_dir().join(format!("sadmoney-storage-{}", uuid::Uuid::new_v4()));
        let path = directory.join("data.json");
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("existing"), "preserve me").unwrap();

        assert!(save_to_path(&path, &AppData::default()).is_err());

        assert_eq!(
            fs::read_to_string(path.join("existing")).unwrap(),
            "preserve me"
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }
}
