use once_cell::sync::Lazy;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

static CONFIG_CACHE: Lazy<RwLock<Option<BTreeMap<String, String>>>> =
    Lazy::new(|| RwLock::new(None));

pub fn get_property(key: &str, default_value: &str) -> Result<String, String> {
    let map = load_config()?;
    Ok(map
        .get(key)
        .cloned()
        .unwrap_or_else(|| default_value.to_string()))
}

pub fn set_property(key: &str, value: &str) -> Result<(), String> {
    update_config(key, value)
}

pub fn flush() -> Result<(), String> {
    let map = {
        let guard = CONFIG_CACHE
            .read()
            .map_err(|_| "Config lock failed".to_string())?;
        guard.clone().unwrap_or_default()
    };
    save_config(&map)
}

fn load_config() -> Result<BTreeMap<String, String>, String> {
    {
        let guard = CONFIG_CACHE
            .read()
            .map_err(|_| "Config lock failed".to_string())?;
        if let Some(map) = guard.clone() {
            return Ok(map);
        }
    }

    let path = config_path()?;
    if !path.exists() {
        let mut guard = CONFIG_CACHE
            .write()
            .map_err(|_| "Config lock failed".to_string())?;
        *guard = Some(BTreeMap::new());
        return Ok(BTreeMap::new());
    }

    let mut file = fs::File::open(&path).map_err(|e| format!("Failed to open file: {e}"))?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("Failed to read file: {e}"))?;

    let map = parse_properties(&content);
    let mut guard = CONFIG_CACHE
        .write()
        .map_err(|_| "Config lock failed".to_string())?;
    *guard = Some(map.clone());
    Ok(map)
}

fn update_config(key: &str, value: &str) -> Result<(), String> {
    let mut map = load_config()?;
    map.insert(key.to_string(), value.to_string());
    save_config(&map)?;
    let mut guard = CONFIG_CACHE
        .write()
        .map_err(|_| "Config lock failed".to_string())?;
    *guard = Some(map);
    Ok(())
}

fn save_config(map: &BTreeMap<String, String>) -> Result<(), String> {
    let path = config_path()?;
    ensure_parent_dir(&path)?;

    let mut content = String::new();
    for (key, value) in map {
        content.push_str(&format!(
            "{}={}\n",
            escape_property_value(key),
            escape_property_value(value)
        ));
    }

    let mut file = fs::File::create(&path).map_err(|e| format!("Failed to write file: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(())
}

fn config_path() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    Ok(home.join(".dbworkbench").join("app.properties"))
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

fn parse_properties(content: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    let mut current = String::new();

    for line in content.lines() {
        let mut line = line.trim_end().to_string();
        if line.ends_with('\\') {
            line.pop();
            current.push_str(&line);
            continue;
        }

        if !current.is_empty() {
            current.push_str(&line);
            line = current.clone();
            current.clear();
        }

        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
            continue;
        }

        let (key, value) = split_property_line(trimmed);
        map.insert(unescape_property_value(key), unescape_property_value(value));
    }

    map
}

fn split_property_line(line: &str) -> (&str, &str) {
    let mut chars = line.char_indices();
    while let Some((idx, ch)) = chars.next() {
        if ch == '=' || ch == ':' {
            return (&line[..idx], line[idx + 1..].trim_start());
        }
        if ch.is_whitespace() {
            let mut rest = line[idx..].trim_start();
            if rest.starts_with('=') || rest.starts_with(':') {
                rest = rest[1..].trim_start();
            }
            return (&line[..idx], rest);
        }
    }
    (line, "")
}

fn unescape_property_value(value: &str) -> String {
    let mut result = String::new();
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            result.push(ch);
            continue;
        }
        let next = match chars.next() {
            Some(v) => v,
            None => break,
        };
        match next {
            't' => result.push('\t'),
            'n' => result.push('\n'),
            'r' => result.push('\r'),
            'f' => result.push('\u{000C}'),
            'u' => {
                let mut hex = String::new();
                for _ in 0..4 {
                    if let Some(h) = chars.next() {
                        hex.push(h);
                    }
                }
                if let Ok(code) = u16::from_str_radix(&hex, 16) {
                    if let Some(c) = char::from_u32(code as u32) {
                        result.push(c);
                    }
                }
            }
            other => result.push(other),
        }
    }
    result
}

fn escape_property_value(value: &str) -> String {
    let mut result = String::new();
    for ch in value.chars() {
        match ch {
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            '\u{000C}' => result.push_str("\\f"),
            '=' => result.push_str("\\="),
            ':' => result.push_str("\\:"),
            '#' => result.push_str("\\#"),
            '!' => result.push_str("\\!"),
            _ => result.push(ch),
        }
    }
    result
}
