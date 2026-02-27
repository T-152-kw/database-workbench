use crate::backend::models::ConnectionProfile;
use crate::backend::pool;
use calamine::{open_workbook, Reader};
use chrono::{Datelike, NaiveDate, NaiveDateTime, NaiveTime, Timelike};
use csv::ReaderBuilder;
use mysql::prelude::*;
use mysql::Value;
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::time::Instant;

#[derive(Serialize)]
pub struct ImportResult {
    pub success: bool,
    #[serde(rename = "rowsImported")]
    pub rows_imported: u64,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    pub error: Option<String>,
}

#[derive(Clone)]
struct ColumnInfo {
    name: String,
    data_type: String,
    nullable: bool,
}

#[derive(Clone, Copy)]
enum ColumnType {
    Integer,
    Float,
    Boolean,
    Date,
    DateTime,
    Time,
    Json,
    String,
}

#[derive(Clone, Copy)]
pub enum ImportFormat {
    Csv,
    Txt,
    Json,
    Jsonl,
    Xml,
    Xlsx,
    Xls,
}

impl ImportFormat {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "csv" => Some(ImportFormat::Csv),
            "txt" => Some(ImportFormat::Txt),
            "json" => Some(ImportFormat::Json),
            "jsonl" => Some(ImportFormat::Jsonl),
            "xml" => Some(ImportFormat::Xml),
            "xlsx" => Some(ImportFormat::Xlsx),
            "xls" => Some(ImportFormat::Xls),
            _ => None,
        }
    }
}

pub fn import_table(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
    format: ImportFormat,
) -> ImportResult {
    let start = Instant::now();
    let result = match format {
        ImportFormat::Csv => do_import_csv(profile, schema, table, file_path),
        ImportFormat::Txt => do_import_txt(profile, schema, table, file_path),
        ImportFormat::Json => do_import_json(profile, schema, table, file_path),
        ImportFormat::Jsonl => do_import_jsonl(profile, schema, table, file_path),
        ImportFormat::Xml => do_import_xml(profile, schema, table, file_path),
        ImportFormat::Xlsx => do_import_excel(profile, schema, table, file_path),
        ImportFormat::Xls => do_import_excel(profile, schema, table, file_path),
    };

    match result {
        Ok(rows_imported) => ImportResult {
            success: true,
            rows_imported,
            duration_ms: start.elapsed().as_millis() as u64,
            error: None,
        },
        Err(err) => ImportResult {
            success: false,
            rows_imported: 0,
            duration_ms: start.elapsed().as_millis() as u64,
            error: Some(err),
        },
    }
}

// Legacy functions for backward compatibility
pub fn import_from_csv(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> ImportResult {
    import_table(profile, schema, table, file_path, ImportFormat::Csv)
}

pub fn import_from_json(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> ImportResult {
    import_table(profile, schema, table, file_path, ImportFormat::Json)
}

pub fn import_from_jsonl(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> ImportResult {
    import_table(profile, schema, table, file_path, ImportFormat::Jsonl)
}

fn do_import_csv(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let schema = schema.to_string();
    let table = table.to_string();

    pool::with_temp_connection(profile, |conn| {
        let columns = load_columns(conn, &schema, &table)?;
        let (header_map, ordered_columns) =
            build_column_mapping_from_csv_header(file_path, &columns)?;

        let insert_sql = build_insert_sql(&schema, &table, &ordered_columns);
        let stmt = conn
            .prep(insert_sql)
            .map_err(|e| format!("Prepare failed: {e}"))?;
        let mut tx = conn
            .start_transaction(Default::default())
            .map_err(|e| format!("Transaction start failed: {e}"))?;

        let mut reader = ReaderBuilder::new()
            .has_headers(true)
            .flexible(false)
            .from_path(file_path)
            .map_err(|e| format!("Read CSV failed: {e}"))?;

        let mut params_batch: Vec<Vec<Value>> = Vec::with_capacity(500);
        let mut rows_imported = 0u64;

        for (index, record) in reader.records().enumerate() {
            let record = record.map_err(|e| format!("CSV parse failed: {e}"))?;
            let expected = header_map.len();
            let actual = record.len();
            if actual != expected {
                return Err(format!(
                    "Row {} column mismatch, expected {}, got {}",
                    index + 2,
                    expected,
                    actual
                ));
            }

            let values = build_values_from_csv(&record, &header_map, &ordered_columns, index + 2)?;
            params_batch.push(values);
            rows_imported += 1;

            if params_batch.len() >= 500 {
                tx.exec_batch(&stmt, params_batch.drain(..))
                    .map_err(|e| format!("Batch insert failed: {e}"))?;
            }
        }

        if !params_batch.is_empty() {
            tx.exec_batch(&stmt, params_batch)
                .map_err(|e| format!("Batch insert failed: {e}"))?;
        }

        tx.commit().map_err(|e| format!("Commit failed: {e}"))?;
        Ok(rows_imported)
    })
}

fn do_import_txt(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let schema = schema.to_string();
    let table = table.to_string();

    pool::with_temp_connection(profile, |conn| {
        let columns = load_columns(conn, &schema, &table)?;

        let file = File::open(file_path).map_err(|e| format!("Read TXT failed: {e}"))?;
        let reader = BufReader::new(file);
        let mut lines = reader.lines();

        // Read header line
        let header_line = lines
            .next()
            .ok_or("TXT file is empty")?
            .map_err(|e| format!("Read header failed: {e}"))?;

        // Remove BOM if present
        let header_line = header_line.trim_start_matches('\u{FEFF}');

        let headers = parse_txt_line(header_line);
        if headers.is_empty() {
            return Err("TXT header is empty".to_string());
        }

        // Build column mapping
        let mut header_map = HashMap::new();
        for (idx, raw) in headers.iter().enumerate() {
            let name = normalize_column_name(raw.trim_matches('"'));
            if name.is_empty() {
                return Err("TXT header contains empty column name".to_string());
            }
            header_map.insert(name, idx);
        }

        // Validate column count
        if header_map.len() != columns.len() {
            return Err(format!(
                "Column count mismatch, expected {}, got {}",
                columns.len(),
                header_map.len()
            ));
        }

        // Map columns
        let mut ordered_columns: Vec<ColumnInfo> = Vec::with_capacity(columns.len());
        for column in &columns {
            let key = normalize_column_name(&column.name);
            if !header_map.contains_key(&key) {
                return Err(format!("TXT missing column: {}", column.name));
            }
            ordered_columns.push(column.clone());
        }

        let insert_sql = build_insert_sql(&schema, &table, &ordered_columns);
        let stmt = conn
            .prep(insert_sql)
            .map_err(|e| format!("Prepare failed: {e}"))?;
        let mut tx = conn
            .start_transaction(Default::default())
            .map_err(|e| format!("Transaction start failed: {e}"))?;

        let mut params_batch: Vec<Vec<Value>> = Vec::with_capacity(500);
        let mut rows_imported = 0u64;

        for (index, line_result) in lines.enumerate() {
            let line = line_result.map_err(|e| format!("Read line {} failed: {e}", index + 2))?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let values_str = parse_txt_line(&line);
            let values =
                build_values_from_txt(&values_str, &header_map, &ordered_columns, index + 2)?;
            params_batch.push(values);
            rows_imported += 1;

            if params_batch.len() >= 500 {
                tx.exec_batch(&stmt, params_batch.drain(..))
                    .map_err(|e| format!("Batch insert failed: {e}"))?;
            }
        }

        if !params_batch.is_empty() {
            tx.exec_batch(&stmt, params_batch)
                .map_err(|e| format!("Batch insert failed: {e}"))?;
        }

        tx.commit().map_err(|e| format!("Commit failed: {e}"))?;
        Ok(rows_imported)
    })
}

fn parse_txt_line(line: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                if in_quotes && chars.peek() == Some(&'"') {
                    // Escaped quote
                    current.push('"');
                    chars.next();
                } else {
                    in_quotes = !in_quotes;
                }
            }
            '\t' if !in_quotes => {
                // Trim quotes from the value if present
                let trimmed = current.trim();
                let value =
                    if trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2 {
                        trimmed[1..trimmed.len() - 1].to_string()
                    } else {
                        trimmed.to_string()
                    };
                result.push(value);
                current.clear();
            }
            _ => {
                current.push(ch);
            }
        }
    }

    if !current.is_empty() || line.ends_with('\t') {
        // Trim quotes from the last value if present
        let trimmed = current.trim();
        let value = if trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2 {
            trimmed[1..trimmed.len() - 1].to_string()
        } else {
            trimmed.to_string()
        };
        result.push(value);
    }

    result
}

fn build_values_from_txt(
    values_str: &[String],
    header_map: &HashMap<String, usize>,
    columns: &[ColumnInfo],
    row_index: usize,
) -> Result<Vec<Value>, String> {
    let mut values = Vec::with_capacity(columns.len());
    for column in columns {
        let key = normalize_column_name(&column.name);
        let index = header_map
            .get(&key)
            .ok_or_else(|| format!("Row {row_index} missing column: {}", column.name))?;
        let raw = values_str.get(*index).map(|s| s.as_str()).unwrap_or("");
        let value = parse_value(raw, column)?;
        values.push(value);
    }
    Ok(values)
}

fn do_import_json(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let mut file = File::open(file_path).map_err(|e| format!("Read JSON failed: {e}"))?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("Read JSON failed: {e}"))?;

    let json: JsonValue =
        serde_json::from_str(&content).map_err(|e| format!("JSON parse failed: {e}"))?;

    let mut rows: Vec<JsonValue> = Vec::new();
    match json {
        JsonValue::Array(arr) => rows = arr,
        JsonValue::Object(_) => rows.push(json),
        _ => return Err("JSON must be array or object".to_string()),
    }

    import_json_rows(profile, schema, table, rows)
}

fn do_import_jsonl(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let file = File::open(file_path).map_err(|e| format!("Read JSONL failed: {e}"))?;
    let reader = BufReader::new(file);
    let mut rows: Vec<JsonValue> = Vec::new();

    for (index, line) in reader.lines().enumerate() {
        let line = line.map_err(|e| format!("Read JSONL failed: {e}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value: JsonValue = serde_json::from_str(trimmed)
            .map_err(|e| format!("JSONL row {} parse failed: {e}", index + 1))?;
        rows.push(value);
    }

    import_json_rows(profile, schema, table, rows)
}

fn do_import_xml(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let schema = schema.to_string();
    let table = table.to_string();

    let mut file = File::open(file_path).map_err(|e| format!("Read XML failed: {e}"))?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("Read XML failed: {e}"))?;

    // Parse XML records
    let mut rows: Vec<HashMap<String, String>> = Vec::new();

    // Simple XML parsing for <RECORDS><RECORD>...</RECORD></RECORDS> format
    let content_trimmed = content.trim();
    if !content_trimmed.starts_with("<?xml") && !content_trimmed.starts_with("<RECORDS") {
        return Err("Invalid XML format: expected <?xml or <RECORDS>".to_string());
    }

    // Extract RECORD elements
    let mut pos = 0;
    while let Some(record_start) = content[pos..].find("<RECORD>") {
        let start_idx = pos + record_start + 8; // Skip "<RECORD>"
        if let Some(record_end) = content[start_idx..].find("</RECORD>") {
            let record_content = &content[start_idx..start_idx + record_end];

            // Parse fields within the record
            let mut row = HashMap::new();
            let mut field_pos = 0;

            while let Some(field_start) = record_content[field_pos..].find('<') {
                let field_start_idx = field_pos + field_start + 1;
                if let Some(field_end) = record_content[field_start_idx..].find('>') {
                    let field_name = &record_content[field_start_idx..field_start_idx + field_end];

                    // Skip if it's a closing tag
                    if field_name.starts_with('/') {
                        field_pos = field_start_idx + field_end + 1;
                        continue;
                    }

                    let value_start = field_start_idx + field_end + 1;
                    let close_tag = format!("</{}>", field_name);

                    if let Some(value_end) = record_content[value_start..].find(&close_tag) {
                        let value = &record_content[value_start..value_start + value_end];
                        row.insert(field_name.to_string(), xml_unescape(value));
                        field_pos = value_start + value_end + close_tag.len();
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }

            if !row.is_empty() {
                rows.push(row);
            }

            pos = start_idx + record_end + 9; // Skip "</RECORD>"
        } else {
            break;
        }
    }

    if rows.is_empty() {
        return Err("No valid records found in XML".to_string());
    }

    // Import rows
    pool::with_temp_connection(profile, |conn| {
        let columns = load_columns(conn, &schema, &table)?;

        // Build column mapping from XML fields
        let mut header_map = HashMap::new();
        if let Some(first_row) = rows.first() {
            for (idx, key) in first_row.keys().enumerate() {
                let normalized = normalize_column_name(key);
                header_map.insert(normalized, idx);
            }
        }

        // Validate columns
        if header_map.len() != columns.len() {
            return Err(format!(
                "Column count mismatch, expected {}, got {}",
                columns.len(),
                header_map.len()
            ));
        }

        let mut ordered_columns: Vec<ColumnInfo> = Vec::with_capacity(columns.len());
        for column in &columns {
            let key = normalize_column_name(&column.name);
            if !header_map.contains_key(&key) {
                // Try to find matching field with different normalization
                let mut found = false;
                for (field_name, _) in header_map.iter() {
                    if field_name.eq_ignore_ascii_case(&column.name) {
                        found = true;
                        break;
                    }
                }
                if !found {
                    return Err(format!("XML missing column: {}", column.name));
                }
            }
            ordered_columns.push(column.clone());
        }

        let insert_sql = build_insert_sql(&schema, &table, &ordered_columns);
        let stmt = conn
            .prep(insert_sql)
            .map_err(|e| format!("Prepare failed: {e}"))?;
        let mut tx = conn
            .start_transaction(Default::default())
            .map_err(|e| format!("Transaction start failed: {e}"))?;

        let mut params_batch: Vec<Vec<Value>> = Vec::with_capacity(500);
        let mut rows_imported = 0u64;

        for (_index, row) in rows.iter().enumerate() {
            let mut values = Vec::with_capacity(columns.len());
            for column in &ordered_columns {
                let key = normalize_column_name(&column.name);
                let raw = row
                    .get(&key)
                    .or_else(|| {
                        // Try case-insensitive match
                        for (k, v) in row.iter() {
                            if normalize_column_name(k) == key {
                                return Some(v);
                            }
                        }
                        None
                    })
                    .map(|s| s.as_str())
                    .unwrap_or("");
                let value = parse_value(raw, column)?;
                values.push(value);
            }

            params_batch.push(values);
            rows_imported += 1;

            if params_batch.len() >= 500 {
                tx.exec_batch(&stmt, params_batch.drain(..))
                    .map_err(|e| format!("Batch insert failed: {e}"))?;
            }
        }

        if !params_batch.is_empty() {
            tx.exec_batch(&stmt, params_batch)
                .map_err(|e| format!("Batch insert failed: {e}"))?;
        }

        tx.commit().map_err(|e| format!("Commit failed: {e}"))?;
        Ok(rows_imported)
    })
}

fn xml_unescape(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn do_import_excel(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let schema = schema.to_string();
    let table = table.to_string();

    pool::with_temp_connection(profile, |conn| {
        let columns = load_columns(conn, &schema, &table)?;

        // Open workbook using calamine
        let mut workbook: calamine::Xlsx<_> =
            open_workbook(file_path).map_err(|e| format!("Failed to open Excel file: {e}"))?;

        // Get the first sheet
        let sheet_name = workbook
            .sheet_names()
            .get(0)
            .ok_or("Excel file has no sheets")?
            .clone();

        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(|e| format!("Failed to read worksheet: {e}"))?;

        // Read header row
        let mut rows_iter = range.rows();
        let header_row = rows_iter.next().ok_or("Excel file is empty")?;

        let mut header_map = HashMap::new();
        for (idx, cell) in header_row.iter().enumerate() {
            let cell_str = match cell {
                calamine::Data::String(s) => s.clone(),
                calamine::Data::Float(f) => f.to_string(),
                calamine::Data::Int(i) => i.to_string(),
                calamine::Data::Bool(b) => b.to_string(),
                calamine::Data::DateTime(d) => d.to_string(),
                calamine::Data::Error(e) => e.to_string(),
                calamine::Data::Empty => String::new(),
                _ => cell.to_string(),
            };
            let name = normalize_column_name(&cell_str);
            if name.is_empty() {
                return Err("Excel header contains empty column name".to_string());
            }
            header_map.insert(name, idx);
        }

        // Validate column count
        if header_map.len() != columns.len() {
            return Err(format!(
                "Column count mismatch, expected {}, got {}",
                columns.len(),
                header_map.len()
            ));
        }

        // Map columns
        let mut ordered_columns: Vec<ColumnInfo> = Vec::with_capacity(columns.len());
        for column in &columns {
            let key = normalize_column_name(&column.name);
            if !header_map.contains_key(&key) {
                return Err(format!("Excel missing column: {}", column.name));
            }
            ordered_columns.push(column.clone());
        }

        let insert_sql = build_insert_sql(&schema, &table, &ordered_columns);
        let stmt = conn
            .prep(insert_sql)
            .map_err(|e| format!("Prepare failed: {e}"))?;
        let mut tx = conn
            .start_transaction(Default::default())
            .map_err(|e| format!("Transaction start failed: {e}"))?;

        let mut params_batch: Vec<Vec<Value>> = Vec::with_capacity(500);
        let mut rows_imported = 0u64;

        for (row_index, row) in rows_iter.enumerate() {
            let mut values = Vec::with_capacity(columns.len());
            for column in &ordered_columns {
                let key = normalize_column_name(&column.name);
                let index = header_map.get(&key).ok_or_else(|| {
                    format!("Row {} missing column: {}", row_index + 2, column.name)
                })?;

                let cell_value: Option<&calamine::Data> = row.get(*index);
                let raw = match cell_value {
                    Some(calamine::Data::String(s)) => s.clone(),
                    Some(calamine::Data::Float(f)) => f.to_string(),
                    Some(calamine::Data::Int(i)) => i.to_string(),
                    Some(calamine::Data::Bool(b)) => b.to_string(),
                    Some(calamine::Data::DateTime(d)) => d.to_string(),
                    Some(calamine::Data::Error(e)) => e.to_string(),
                    Some(calamine::Data::Empty) => String::new(),
                    Some(cell) => cell.to_string(),
                    None => String::new(),
                };
                let value = parse_value(&raw, column)?;
                values.push(value);
            }

            params_batch.push(values);
            rows_imported += 1;

            if params_batch.len() >= 500 {
                tx.exec_batch(&stmt, params_batch.drain(..))
                    .map_err(|e| format!("Batch insert failed: {e}"))?;
            }
        }

        if !params_batch.is_empty() {
            tx.exec_batch(&stmt, params_batch)
                .map_err(|e| format!("Batch insert failed: {e}"))?;
        }

        tx.commit().map_err(|e| format!("Commit failed: {e}"))?;
        Ok(rows_imported)
    })
}

fn import_json_rows(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    rows: Vec<JsonValue>,
) -> Result<u64, String> {
    let schema = schema.to_string();
    let table = table.to_string();

    pool::with_temp_connection(profile, |conn| {
        let columns = load_columns(conn, &schema, &table)?;
        let insert_sql = build_insert_sql(&schema, &table, &columns);
        let stmt = conn
            .prep(insert_sql)
            .map_err(|e| format!("Prepare failed: {e}"))?;
        let mut tx = conn
            .start_transaction(Default::default())
            .map_err(|e| format!("Transaction start failed: {e}"))?;

        let mut params_batch: Vec<Vec<Value>> = Vec::with_capacity(500);
        let mut rows_imported = 0u64;

        for (index, row) in rows.into_iter().enumerate() {
            let obj = match row {
                JsonValue::Object(map) => map,
                _ => return Err(format!("Row {} is not object", index + 1)),
            };
            let values = build_values_from_json(obj, &columns, index + 1)?;
            params_batch.push(values);
            rows_imported += 1;

            if params_batch.len() >= 500 {
                tx.exec_batch(&stmt, params_batch.drain(..))
                    .map_err(|e| format!("Batch insert failed: {e}"))?;
            }
        }

        if !params_batch.is_empty() {
            tx.exec_batch(&stmt, params_batch)
                .map_err(|e| format!("Batch insert failed: {e}"))?;
        }

        tx.commit().map_err(|e| format!("Commit failed: {e}"))?;
        Ok(rows_imported)
    })
}

fn load_columns(
    conn: &mut mysql::Conn,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let sql = r#"SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_schema = ? AND table_name = ?
                ORDER BY ordinal_position"#;
    let rows: Vec<(String, String, String)> = conn
        .exec(sql, (schema, table))
        .map_err(|e| format!("Load columns failed: {e}"))?;

    if rows.is_empty() {
        return Err("No table columns found".to_string());
    }

    Ok(rows
        .into_iter()
        .map(|(name, data_type, nullable)| ColumnInfo {
            name,
            data_type,
            nullable: nullable.eq_ignore_ascii_case("YES"),
        })
        .collect())
}

fn build_column_mapping_from_csv_header(
    file_path: &Path,
    columns: &[ColumnInfo],
) -> Result<(HashMap<String, usize>, Vec<ColumnInfo>), String> {
    let mut reader = ReaderBuilder::new()
        .has_headers(true)
        .from_path(file_path)
        .map_err(|e| format!("Read CSV failed: {e}"))?;
    let headers = reader
        .headers()
        .map_err(|e| format!("Read CSV headers failed: {e}"))?;

    if headers.is_empty() {
        return Err("CSV must include headers".to_string());
    }

    let mut header_map = HashMap::new();
    let mut header_set = HashSet::new();
    for (idx, raw) in headers.iter().enumerate() {
        let name = normalize_column_name(raw);
        if name.is_empty() {
            return Err("CSV header contains empty column name".to_string());
        }
        if !header_set.insert(name.clone()) {
            return Err(format!("CSV header contains duplicate column: {raw}"));
        }
        header_map.insert(name, idx);
    }

    if header_map.len() != columns.len() {
        return Err(format!(
            "Column count mismatch, expected {}, got {}",
            columns.len(),
            header_map.len()
        ));
    }

    let mut ordered_columns: Vec<ColumnInfo> = Vec::with_capacity(columns.len());
    for column in columns {
        let key = normalize_column_name(&column.name);
        if !header_map.contains_key(&key) {
            return Err(format!("CSV missing column: {}", column.name));
        }
        ordered_columns.push(column.clone());
    }

    Ok((header_map, ordered_columns))
}

fn build_insert_sql(schema: &str, table: &str, columns: &[ColumnInfo]) -> String {
    let mut sql = String::new();
    sql.push_str("INSERT INTO `");
    sql.push_str(&escape_identifier(schema));
    sql.push_str("`.`");
    sql.push_str(&escape_identifier(table));
    sql.push_str("` (");
    for (idx, col) in columns.iter().enumerate() {
        if idx > 0 {
            sql.push_str(", ");
        }
        sql.push('`');
        sql.push_str(&escape_identifier(&col.name));
        sql.push('`');
    }
    sql.push_str(") VALUES (");
    for idx in 0..columns.len() {
        if idx > 0 {
            sql.push_str(", ");
        }
        sql.push('?');
    }
    sql.push(')');
    sql
}

fn build_values_from_csv(
    record: &csv::StringRecord,
    header_map: &HashMap<String, usize>,
    columns: &[ColumnInfo],
    row_index: usize,
) -> Result<Vec<Value>, String> {
    let mut values = Vec::with_capacity(columns.len());
    for column in columns {
        let key = normalize_column_name(&column.name);
        let index = header_map
            .get(&key)
            .ok_or_else(|| format!("Row {row_index} missing column: {}", column.name))?;
        let raw = record.get(*index).unwrap_or("");
        let value = parse_value(raw, column)?;
        values.push(value);
    }
    Ok(values)
}

fn build_values_from_json(
    obj: serde_json::Map<String, JsonValue>,
    columns: &[ColumnInfo],
    row_index: usize,
) -> Result<Vec<Value>, String> {
    let mut values = Vec::with_capacity(columns.len());
    for column in columns {
        let key = normalize_column_name(&column.name);
        let value = obj
            .get(&key)
            .or_else(|| obj.get(&column.name))
            .cloned()
            .unwrap_or(JsonValue::Null);
        values.push(json_to_value(value, column, row_index)?);
    }
    Ok(values)
}

fn parse_value(raw: &str, column: &ColumnInfo) -> Result<Value, String> {
    if raw.trim().is_empty() {
        return if column.nullable {
            Ok(Value::NULL)
        } else {
            Ok(Value::Bytes(Vec::new()))
        };
    }

    let column_type = detect_column_type(&column.data_type);
    match column_type {
        ColumnType::Integer => raw
            .parse::<i64>()
            .map(Value::Int)
            .map_err(|_| format!("Invalid integer: {raw}")),
        ColumnType::Float => raw
            .parse::<f64>()
            .map(Value::Double)
            .map_err(|_| format!("Invalid float: {raw}")),
        ColumnType::Boolean => Ok(Value::Int(
            if raw.eq_ignore_ascii_case("true") || raw == "1" {
                1
            } else {
                0
            },
        )),
        ColumnType::Date => parse_date(raw),
        ColumnType::DateTime => parse_datetime(raw),
        ColumnType::Time => parse_time(raw),
        ColumnType::Json => Ok(Value::Bytes(raw.as_bytes().to_vec())),
        ColumnType::String => Ok(Value::Bytes(raw.as_bytes().to_vec())),
    }
}

fn json_to_value(value: JsonValue, column: &ColumnInfo, row_index: usize) -> Result<Value, String> {
    if value.is_null() {
        return if column.nullable {
            Ok(Value::NULL)
        } else {
            Ok(Value::Bytes(Vec::new()))
        };
    }

    let column_type = detect_column_type(&column.data_type);
    match column_type {
        ColumnType::Integer => {
            // Try as i64 first, then try parsing from string
            if let Some(n) = value.as_i64() {
                Ok(Value::Int(n))
            } else if let Some(s) = value.as_str() {
                s.parse::<i64>()
                    .map(Value::Int)
                    .map_err(|_| format!("Row {row_index} invalid integer: {s}"))
            } else {
                Err(format!("Row {row_index} invalid integer"))
            }
        }
        ColumnType::Float => {
            // Try as f64 first, then try parsing from string
            if let Some(n) = value.as_f64() {
                Ok(Value::Double(n))
            } else if let Some(s) = value.as_str() {
                s.parse::<f64>()
                    .map(Value::Double)
                    .map_err(|_| format!("Row {row_index} invalid float: {s}"))
            } else {
                Err(format!("Row {row_index} invalid float"))
            }
        }
        ColumnType::Boolean => {
            if let Some(b) = value.as_bool() {
                Ok(Value::Int(if b { 1 } else { 0 }))
            } else if let Some(s) = value.as_str() {
                Ok(Value::Int(if s.eq_ignore_ascii_case("true") || s == "1" {
                    1
                } else {
                    0
                }))
            } else {
                Err(format!("Row {row_index} invalid boolean"))
            }
        }
        ColumnType::Date => value
            .as_str()
            .ok_or_else(|| format!("Row {row_index} invalid date"))
            .and_then(parse_date),
        ColumnType::DateTime => value
            .as_str()
            .ok_or_else(|| format!("Row {row_index} invalid datetime"))
            .and_then(parse_datetime),
        ColumnType::Time => value
            .as_str()
            .ok_or_else(|| format!("Row {row_index} invalid time"))
            .and_then(parse_time),
        ColumnType::Json => Ok(Value::Bytes(value.to_string().as_bytes().to_vec())),
        ColumnType::String => {
            // For strings, use the raw string value without JSON quotes
            if let Some(s) = value.as_str() {
                Ok(Value::Bytes(s.as_bytes().to_vec()))
            } else {
                Ok(Value::Bytes(value.to_string().as_bytes().to_vec()))
            }
        }
    }
}

fn detect_column_type(data_type: &str) -> ColumnType {
    match data_type.to_ascii_lowercase().as_str() {
        "int" | "integer" | "bigint" | "smallint" | "mediumint" | "tinyint" => ColumnType::Integer,
        "decimal" | "numeric" | "float" | "double" => ColumnType::Float,
        "boolean" | "bool" => ColumnType::Boolean,
        "date" => ColumnType::Date,
        "datetime" | "timestamp" => ColumnType::DateTime,
        "time" => ColumnType::Time,
        "json" => ColumnType::Json,
        _ => ColumnType::String,
    }
}

fn parse_date(text: &str) -> Result<Value, String> {
    // Try multiple date formats
    let date = NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .or_else(|_| NaiveDate::parse_from_str(text, "%Y/%m/%d"))
        .or_else(|_| NaiveDate::parse_from_str(text, "%d/%m/%Y"))
        .or_else(|_| NaiveDate::parse_from_str(text, "%m/%d/%Y"))
        .map_err(|_| format!("Invalid date: {text}"))?;
    Ok(Value::Date(
        date.year() as u16,
        date.month() as u8,
        date.day() as u8,
        0,
        0,
        0,
        0,
    ))
}

fn parse_datetime(text: &str) -> Result<Value, String> {
    let dt = NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S%.f"))
        .or_else(|_| NaiveDateTime::parse_from_str(text, "%Y/%m/%d %H:%M:%S"))
        .map_err(|_| format!("Invalid datetime: {text}"))?;
    Ok(Value::Date(
        dt.date().year() as u16,
        dt.date().month() as u8,
        dt.date().day() as u8,
        dt.time().hour() as u8,
        dt.time().minute() as u8,
        dt.time().second() as u8,
        dt.time().nanosecond() / 1000,
    ))
}

fn parse_time(text: &str) -> Result<Value, String> {
    let time = NaiveTime::parse_from_str(text, "%H:%M:%S")
        .or_else(|_| NaiveTime::parse_from_str(text, "%H:%M:%S%.f"))
        .map_err(|_| format!("Invalid time: {text}"))?;
    Ok(Value::Time(
        false,
        0,
        time.hour() as u8,
        time.minute() as u8,
        time.second() as u8,
        time.nanosecond() / 1000,
    ))
}

fn normalize_column_name(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}

fn escape_identifier(input: &str) -> String {
    input.replace('`', "``")
}
