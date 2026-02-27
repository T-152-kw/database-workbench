use crate::backend::models::{FavoriteItem, FavoriteType};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

pub fn get_all() -> Result<Vec<FavoriteItem>, String> {
    load_store()
}

pub fn get_by_type(favorite_type: FavoriteType) -> Result<Vec<FavoriteItem>, String> {
    let mut items = load_store()?;
    items.retain(|item| item.favorite_type == favorite_type);
    sort_by_last_used(&mut items);
    Ok(items)
}

pub fn search(keyword: &str) -> Result<Vec<FavoriteItem>, String> {
    let keyword = keyword.to_ascii_lowercase();
    let mut items = load_store()?;
    items.retain(|item| matches_keyword(item, &keyword));
    sort_by_last_used(&mut items);
    Ok(items)
}

pub fn get(id: &str) -> Result<Option<FavoriteItem>, String> {
    let items = load_store()?;
    Ok(items
        .into_iter()
        .find(|item| item.id.as_deref() == Some(id)))
}

pub fn add(mut item: FavoriteItem) -> Result<FavoriteItem, String> {
    normalize_item(&mut item);
    let mut items = load_store()?;
    items.push(item.clone());
    save_store(&items)?;
    Ok(item)
}

pub fn update(mut item: FavoriteItem) -> Result<(), String> {
    if item.id.is_none() {
        return Err("Missing favorite id".to_string());
    }
    normalize_item(&mut item);

    let mut items = load_store()?;
    let mut updated = false;
    for entry in items.iter_mut() {
        if entry.id == item.id {
            *entry = item.clone();
            updated = true;
            break;
        }
    }
    if !updated {
        return Err("Favorite not found".to_string());
    }
    save_store(&items)
}

pub fn remove(id: &str) -> Result<(), String> {
    let mut items = load_store()?;
    items.retain(|item| item.id.as_deref() != Some(id));
    save_store(&items)
}

pub fn record_usage(id: &str) -> Result<(), String> {
    let mut items = load_store()?;
    let mut changed = false;
    for item in items.iter_mut() {
        if item.id.as_deref() == Some(id) {
            item.usage_count += 1;
            item.last_used_time = now_ms();
            changed = true;
            break;
        }
    }
    if changed {
        save_store(&items)?;
    }
    Ok(())
}

pub fn clear_all() -> Result<(), String> {
    save_store(&[])
}

pub fn total() -> Result<i32, String> {
    let items = load_store()?;
    Ok(items.len() as i32)
}

pub fn stats() -> Result<HashMap<FavoriteType, i32>, String> {
    let items = load_store()?;
    let mut map: HashMap<FavoriteType, i32> = HashMap::new();
    for item in items {
        let entry = map.entry(item.favorite_type).or_insert(0);
        *entry += 1;
    }
    Ok(map)
}

fn normalize_item(item: &mut FavoriteItem) {
    if item.id.is_none() {
        item.id = Some(generate_id());
        item.created_time = now_ms();
    }
    if item.last_used_time == 0 {
        item.last_used_time = item.created_time;
    }
}

fn matches_keyword(item: &FavoriteItem, keyword: &str) -> bool {
    let name = item.name.to_ascii_lowercase();
    if name.contains(keyword) {
        return true;
    }
    if let Some(desc) = &item.description {
        if desc.to_ascii_lowercase().contains(keyword) {
            return true;
        }
    }
    if let Some(content) = &item.content {
        if content.to_ascii_lowercase().contains(keyword) {
            return true;
        }
    }
    false
}

fn sort_by_last_used(items: &mut [FavoriteItem]) {
    items.sort_by(|a, b| b.last_used_time.cmp(&a.last_used_time));
}

fn load_store() -> Result<Vec<FavoriteItem>, String> {
    let path = store_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let mut file = fs::File::open(&path).map_err(|e| format!("Failed to open file: {e}"))?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("Failed to read file: {e}"))?;

    match serde_json::from_str::<Vec<FavoriteItem>>(&content) {
        Ok(items) => Ok(items),
        Err(_) => Ok(Vec::new()),
    }
}

fn save_store(items: &[FavoriteItem]) -> Result<(), String> {
    let path = store_path()?;
    ensure_parent_dir(&path)?;
    let json =
        serde_json::to_string(items).map_err(|e| format!("Failed to serialize favorites: {e}"))?;
    let mut file = fs::File::create(&path).map_err(|e| format!("Failed to write file: {e}"))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(())
}

fn store_path() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    Ok(home.join(".dbworkbench").join("favorites.dat"))
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }
    Ok(())
}

fn home_dir() -> Option<PathBuf> {
    if let Some(value) = env::var_os("USERPROFILE") {
        return Some(PathBuf::from(value));
    }
    if let Some(value) = env::var_os("HOME") {
        return Some(PathBuf::from(value));
    }
    env::current_dir().ok()
}

fn generate_id() -> String {
    let counter = ID_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("fav-{}-{}", now_ms(), counter)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
