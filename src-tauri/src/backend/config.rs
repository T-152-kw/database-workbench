use crate::backend::models::ConnectionProfile;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub fn load_connections() -> Result<Vec<ConnectionProfile>, String> {
    let path = default_store_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    load_profiles_from_properties(&path)
}

pub fn save_connections(profiles: &[ConnectionProfile]) -> Result<(), String> {
    let path = default_store_path()?;
    ensure_parent_dir(&path)?;
    save_profiles_to_properties(&path, profiles)
}

pub fn import_connections(path: &Path) -> Result<Vec<ConnectionProfile>, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "csv" => import_from_csv(path),
        "properties" => load_profiles_from_properties(path),
        _ => Err("Only CSV and Properties files are supported".to_string()),
    }
}

pub fn export_connections(path: &Path, profiles: &[ConnectionProfile]) -> Result<(), String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "csv" => export_to_csv(path, profiles),
        "properties" => save_profiles_to_properties(path, profiles),
        _ => Err("Only CSV and Properties files are supported".to_string()),
    }
}

fn default_store_path() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    Ok(home.join(".dbworkbench").join("connections.properties"))
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

fn load_profiles_from_properties(path: &Path) -> Result<Vec<ConnectionProfile>, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open file: {e}"))?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("Failed to read file: {e}"))?;

    let props = parse_properties(&content);
    let count: usize = props.get("count").and_then(|v| v.parse().ok()).unwrap_or(0);

    let mut profiles = Vec::with_capacity(count);
    for i in 0..count {
        let prefix = format!("conn.{i}.");
        let name = props
            .get(&(prefix.clone() + "name"))
            .cloned()
            .unwrap_or_else(|| "Unnamed".to_string());
        let host = props
            .get(&(prefix.clone() + "host"))
            .cloned()
            .unwrap_or_else(|| "localhost".to_string());
        let port = props
            .get(&(prefix.clone() + "port"))
            .and_then(|v| v.parse().ok())
            .unwrap_or(3306);
        let username = props
            .get(&(prefix.clone() + "user"))
            .cloned()
            .unwrap_or_else(|| "root".to_string());
        let password = props
            .get(&(prefix.clone() + "pwd"))
            .cloned()
            .unwrap_or_default();
        let database = props.get(&(prefix + "db")).cloned().unwrap_or_default();
        let charset = props
            .get(&(format!("conn.{i}.charset")))
            .cloned()
            .unwrap_or_default();
        let collation = props
            .get(&(format!("conn.{i}.collation")))
            .cloned()
            .unwrap_or_default();
        let timeout = props
            .get(&(format!("conn.{i}.timeout")))
            .and_then(|v| v.parse::<u64>().ok());
        let ssl_mode = props
            .get(&(format!("conn.{i}.sslMode")))
            .cloned()
            .unwrap_or_default();
        let ssl_ca_path = props
            .get(&(format!("conn.{i}.sslCaPath")))
            .cloned()
            .unwrap_or_default();
        let ssl_cert_path = props
            .get(&(format!("conn.{i}.sslCertPath")))
            .cloned()
            .unwrap_or_default();
        let ssl_key_path = props
            .get(&(format!("conn.{i}.sslKeyPath")))
            .cloned()
            .unwrap_or_default();

        profiles.push(ConnectionProfile {
            name: Some(name),
            host,
            port,
            username,
            password,
            database: if database.is_empty() {
                None
            } else {
                Some(database)
            },
            charset: if charset.is_empty() {
                None
            } else {
                Some(charset)
            },
            collation: if collation.is_empty() {
                None
            } else {
                Some(collation)
            },
            timeout,
            connection_timeout: None, // 从配置文件加载时默认为 None，后续使用默认值
            auto_reconnect: None,     // NEW: 从配置文件加载时默认为 None，后续使用默认值（false）
            ssl: None,
            ssl_mode: if ssl_mode.is_empty() {
                None
            } else {
                Some(ssl_mode)
            },
            ssl_ca_path: if ssl_ca_path.is_empty() {
                None
            } else {
                Some(ssl_ca_path)
            },
            ssl_cert_path: if ssl_cert_path.is_empty() {
                None
            } else {
                Some(ssl_cert_path)
            },
            ssl_key_path: if ssl_key_path.is_empty() {
                None
            } else {
                Some(ssl_key_path)
            },
        });
    }

    Ok(profiles)
}

fn save_profiles_to_properties(path: &Path, profiles: &[ConnectionProfile]) -> Result<(), String> {
    let mut content = String::new();
    content.push_str(&format!("count={}\n", profiles.len()));

    for (i, profile) in profiles.iter().enumerate() {
        let prefix = format!("conn.{i}.");
        content.push_str(&format!(
            "{}name={}\n",
            prefix,
            escape_property_value(profile.name.as_deref().unwrap_or(""))
        ));
        content.push_str(&format!(
            "{}host={}\n",
            prefix,
            escape_property_value(&profile.host)
        ));
        content.push_str(&format!("{}port={}\n", prefix, profile.port));
        content.push_str(&format!(
            "{}user={}\n",
            prefix,
            escape_property_value(&profile.username)
        ));
        content.push_str(&format!(
            "{}pwd={}\n",
            prefix,
            escape_property_value(&profile.password)
        ));
        content.push_str(&format!(
            "{}db={}\n",
            prefix,
            escape_property_value(profile.database.as_deref().unwrap_or(""))
        ));
        content.push_str(&format!(
            "{}charset={}\n",
            prefix,
            escape_property_value(profile.charset.as_deref().unwrap_or(""))
        ));
        content.push_str(&format!(
            "{}collation={}\n",
            prefix,
            escape_property_value(profile.collation.as_deref().unwrap_or(""))
        ));
        content.push_str(&format!(
            "{}timeout={}\n",
            prefix,
            profile.timeout.unwrap_or(30)
        ));
        content.push_str(&format!(
            "{}sslMode={}\n",
            prefix,
            escape_property_value(profile.ssl_mode.as_deref().unwrap_or(""))
        ));
        content.push_str(&format!(
            "{}sslCaPath={}\n",
            prefix,
            escape_property_value(profile.ssl_ca_path.as_deref().unwrap_or(""))
        ));
        content.push_str(&format!(
            "{}sslCertPath={}\n",
            prefix,
            escape_property_value(profile.ssl_cert_path.as_deref().unwrap_or(""))
        ));
        content.push_str(&format!(
            "{}sslKeyPath={}\n",
            prefix,
            escape_property_value(profile.ssl_key_path.as_deref().unwrap_or(""))
        ));
    }

    ensure_parent_dir(path)?;
    let mut file = fs::File::create(path).map_err(|e| format!("Failed to write file: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(())
}

fn parse_properties(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
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

fn import_from_csv(path: &Path) -> Result<Vec<ConnectionProfile>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(path)
        .map_err(|e| format!("Failed to read CSV: {e}"))?;

    let headers = reader
        .headers()
        .map_err(|e| format!("Failed to read CSV headers: {e}"))?
        .clone();

    let mut results = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|e| format!("Failed to read CSV record: {e}"))?;
        let mut map = HashMap::new();
        for (idx, value) in record.iter().enumerate() {
            if let Some(key) = headers.get(idx) {
                map.insert(key.to_string(), value.to_string());
            }
        }

        let profile = ConnectionProfile {
            name: map.get("name").cloned(),
            host: map
                .get("host")
                .cloned()
                .unwrap_or_else(|| "localhost".to_string()),
            port: map.get("port").and_then(|v| v.parse().ok()).unwrap_or(3306),
            username: map
                .get("username")
                .cloned()
                .unwrap_or_else(|| "root".to_string()),
            password: map.get("password").cloned().unwrap_or_default(),
            database: map.get("database").cloned(),
            charset: map.get("charset").cloned(),
            collation: map.get("collation").cloned(),
            timeout: map.get("timeout").and_then(|v| v.parse::<u64>().ok()),
            connection_timeout: map
                .get("connectionTimeout")
                .and_then(|v| v.parse::<u64>().ok()),
            auto_reconnect: map
                .get("autoReconnect")
                .and_then(|v| v.parse::<bool>().ok()), // NEW: 从 CSV 加载自动重连配置
            ssl: None,
            ssl_mode: map
                .get("sslMode")
                .cloned()
                .or_else(|| map.get("ssl_mode").cloned()),
            ssl_ca_path: map
                .get("sslCaPath")
                .cloned()
                .or_else(|| map.get("ssl_ca_path").cloned()),
            ssl_cert_path: map
                .get("sslCertPath")
                .cloned()
                .or_else(|| map.get("ssl_cert_path").cloned()),
            ssl_key_path: map
                .get("sslKeyPath")
                .cloned()
                .or_else(|| map.get("ssl_key_path").cloned()),
        };
        results.push(profile);
    }

    Ok(results)
}

fn export_to_csv(path: &Path, profiles: &[ConnectionProfile]) -> Result<(), String> {
    let mut writer = csv::WriterBuilder::new()
        .has_headers(true)
        .from_path(path)
        .map_err(|e| format!("Failed to create CSV: {e}"))?;

    writer
        .write_record([
            "name",
            "host",
            "port",
            "username",
            "password",
            "database",
            "charset",
            "collation",
            "timeout",
            "sslMode",
            "sslCaPath",
            "sslCertPath",
            "sslKeyPath",
        ])
        .map_err(|e| format!("Failed to write CSV headers: {e}"))?;

    for profile in profiles {
        writer
            .write_record([
                profile.name.as_deref().unwrap_or(""),
                profile.host.as_str(),
                &profile.port.to_string(),
                profile.username.as_str(),
                profile.password.as_str(),
                profile.database.as_deref().unwrap_or(""),
                profile.charset.as_deref().unwrap_or(""),
                profile.collation.as_deref().unwrap_or(""),
                &profile.timeout.unwrap_or(30).to_string(),
                profile.ssl_mode.as_deref().unwrap_or(""),
                profile.ssl_ca_path.as_deref().unwrap_or(""),
                profile.ssl_cert_path.as_deref().unwrap_or(""),
                profile.ssl_key_path.as_deref().unwrap_or(""),
            ])
            .map_err(|e| format!("Failed to write CSV record: {e}"))?;
    }

    writer
        .flush()
        .map_err(|e| format!("Failed to flush CSV: {e}"))
}
