use crate::backend::models::ConnectionProfile;
use crate::backend::pool;
use mysql::prelude::*;
use rust_xlsxwriter::{Format, FormatAlign, Workbook};
use serde::Serialize;
use serde_json::json;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::time::Instant;

#[derive(Serialize)]
pub struct ExportResult {
    pub success: bool,
    #[serde(rename = "rowsExported")]
    pub rows_exported: u64,
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    pub error: Option<String>,
}

#[derive(Clone, Copy)]
pub enum ExportFormat {
    Csv,
    Txt,
    Json,
    Html,
    Xml,
    Sql,
    Jsonl,
    Xlsx,
}

impl ExportFormat {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "csv" => Some(ExportFormat::Csv),
            "txt" => Some(ExportFormat::Txt),
            "json" => Some(ExportFormat::Json),
            "html" => Some(ExportFormat::Html),
            "xml" => Some(ExportFormat::Xml),
            "sql" => Some(ExportFormat::Sql),
            "jsonl" => Some(ExportFormat::Jsonl),
            "xlsx" => Some(ExportFormat::Xlsx),
            _ => None,
        }
    }

    #[allow(dead_code)]
    pub fn file_extension(&self) -> &'static str {
        match self {
            ExportFormat::Csv => "csv",
            ExportFormat::Txt => "txt",
            ExportFormat::Json => "json",
            ExportFormat::Html => "html",
            ExportFormat::Xml => "xml",
            ExportFormat::Sql => "sql",
            ExportFormat::Jsonl => "jsonl",
            ExportFormat::Xlsx => "xlsx",
        }
    }
}

pub fn export_table(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
    format: ExportFormat,
) -> ExportResult {
    let start = Instant::now();
    let result = match format {
        ExportFormat::Csv => do_export_csv(profile, schema, table, file_path),
        ExportFormat::Txt => do_export_txt(profile, schema, table, file_path),
        ExportFormat::Json => do_export_json(profile, schema, table, file_path),
        ExportFormat::Html => do_export_html(profile, schema, table, file_path),
        ExportFormat::Xml => do_export_xml(profile, schema, table, file_path),
        ExportFormat::Sql => do_export_sql(profile, schema, table, file_path),
        ExportFormat::Jsonl => do_export_jsonl(profile, schema, table, file_path),
        ExportFormat::Xlsx => do_export_xlsx(profile, schema, table, file_path),
    };

    match result {
        Ok(rows) => ExportResult {
            success: true,
            rows_exported: rows,
            file_path: file_path.to_string_lossy().to_string(),
            duration_ms: start.elapsed().as_millis() as u64,
            error: None,
        },
        Err(err) => ExportResult {
            success: false,
            rows_exported: 0,
            file_path: file_path.to_string_lossy().to_string(),
            duration_ms: start.elapsed().as_millis() as u64,
            error: Some(err),
        },
    }
}

// Legacy functions for backward compatibility
pub fn export_table_to_csv(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> ExportResult {
    export_table(profile, schema, table, file_path, ExportFormat::Csv)
}

pub fn export_table_to_jsonl(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> ExportResult {
    export_table(profile, schema, table, file_path, ExportFormat::Jsonl)
}

pub fn export_query_result(
    file_path: &Path,
    headers: &[String],
    rows: &[Vec<String>],
    format: ExportFormat,
    table_name: Option<&str>,
) -> Result<ExportResult, String> {
    let start = Instant::now();
    let result = match format {
        ExportFormat::Csv => do_export_query_csv(file_path, headers, rows),
        ExportFormat::Txt => do_export_query_txt(file_path, headers, rows),
        ExportFormat::Json => do_export_query_json(file_path, headers, rows),
        ExportFormat::Html => do_export_query_html(file_path, headers, rows, table_name),
        ExportFormat::Xml => do_export_query_xml(file_path, headers, rows),
        ExportFormat::Sql => do_export_query_sql(file_path, headers, rows, table_name),
        ExportFormat::Jsonl => do_export_query_jsonl(file_path, headers, rows),
        ExportFormat::Xlsx => do_export_query_xlsx(file_path, headers, rows, table_name),
    };

    match result {
        Ok(row_count) => Ok(ExportResult {
            success: true,
            rows_exported: row_count,
            file_path: file_path.to_string_lossy().to_string(),
            duration_ms: start.elapsed().as_millis() as u64,
            error: None,
        }),
        Err(err) => Ok(ExportResult {
            success: false,
            rows_exported: 0,
            file_path: file_path.to_string_lossy().to_string(),
            duration_ms: start.elapsed().as_millis() as u64,
            error: Some(err),
        }),
    }
}

fn do_export_csv(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let schema = schema.to_string();
    let table = table.to_string();

    pool::with_temp_connection(profile, |conn| {
        let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
        let mut writer = BufWriter::with_capacity(64 * 1024, file);

        writer
            .write_all(&[0xEF, 0xBB, 0xBF])
            .map_err(|e| format!("Failed to write BOM: {e}"))?;

        let sql = format!(
            "SELECT * FROM `{}`.`{}`",
            escape_identifier(&schema),
            escape_identifier(&table)
        );

        let mut result_set = conn
            .query_iter(sql)
            .map_err(|e| format!("Query failed: {e}"))?;

        let mut rows_exported: u64 = 0;
        let mut columns: Vec<String> = Vec::new();
        let mut is_first_row = true;

        for row_result in result_set.by_ref() {
            let row: mysql::Row = row_result.map_err(|e| format!("Row read error: {e}"))?;

            if is_first_row {
                columns = row
                    .columns_ref()
                    .iter()
                    .map(|c| c.name_str().to_string())
                    .collect();

                if columns.is_empty() {
                    return Ok(0);
                }

                let header: Vec<String> = columns.iter().map(|c| escape_csv_field(c)).collect();
                writer
                    .write_all(header.join(",").as_bytes())
                    .map_err(|e| format!("Failed to write header: {e}"))?;
                writer
                    .write_all(b"\n")
                    .map_err(|e| format!("Failed to write newline: {e}"))?;

                is_first_row = false;
            }

            let mut record: Vec<String> = Vec::with_capacity(columns.len());
            for idx in 0..columns.len() {
                let value: mysql::Value = row.get(idx).unwrap_or(mysql::Value::NULL);
                let str_val = value_to_string(&value);
                record.push(escape_csv_field(&str_val));
            }

            writer
                .write_all(record.join(",").as_bytes())
                .map_err(|e| format!("File write error: {e}"))?;
            writer
                .write_all(b"\n")
                .map_err(|e| format!("Failed to write newline: {e}"))?;

            rows_exported += 1;
        }

        writer
            .flush()
            .map_err(|e| format!("Failed to flush file: {e}"))?;
        Ok(rows_exported)
    })
}

fn do_export_txt(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let schema = schema.to_string();
    let table = table.to_string();

    pool::with_temp_connection(profile, |conn| {
        let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
        let mut writer = BufWriter::with_capacity(64 * 1024, file);

        writer
            .write_all(&[0xEF, 0xBB, 0xBF])
            .map_err(|e| format!("Failed to write BOM: {e}"))?;

        let sql = format!(
            "SELECT * FROM `{}`.`{}`",
            escape_identifier(&schema),
            escape_identifier(&table)
        );

        let mut result_set = conn
            .query_iter(sql)
            .map_err(|e| format!("Query failed: {e}"))?;

        let mut rows_exported: u64 = 0;
        let mut columns: Vec<String> = Vec::new();
        let mut is_first_row = true;

        for row_result in result_set.by_ref() {
            let row: mysql::Row = row_result.map_err(|e| format!("Row read error: {e}"))?;

            if is_first_row {
                columns = row
                    .columns_ref()
                    .iter()
                    .map(|c| c.name_str().to_string())
                    .collect();

                if columns.is_empty() {
                    return Ok(0);
                }

                // Write header with quoted column names
                let header: Vec<String> = columns.iter().map(|c| format!("\"{}\"", c)).collect();
                writer
                    .write_all(header.join("\t").as_bytes())
                    .map_err(|e| format!("Failed to write header: {e}"))?;
                writer
                    .write_all(b"\n")
                    .map_err(|e| format!("Failed to write newline: {e}"))?;

                is_first_row = false;
            }

            let mut record: Vec<String> = Vec::with_capacity(columns.len());
            for idx in 0..columns.len() {
                let value: mysql::Value = row.get(idx).unwrap_or(mysql::Value::NULL);
                let str_val = value_to_string(&value);
                record.push(format!("\"{}\"", str_val));
            }

            writer
                .write_all(record.join("\t").as_bytes())
                .map_err(|e| format!("File write error: {e}"))?;
            writer
                .write_all(b"\n")
                .map_err(|e| format!("Failed to write newline: {e}"))?;

            rows_exported += 1;
        }

        writer
            .flush()
            .map_err(|e| format!("Failed to flush file: {e}"))?;
        Ok(rows_exported)
    })
}

fn do_export_json(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let schema = schema.to_string();
    let table = table.to_string();

    pool::with_temp_connection(profile, |conn| {
        let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
        let mut writer = BufWriter::with_capacity(64 * 1024, file);

        let sql = format!(
            "SELECT * FROM `{}`.`{}`",
            escape_identifier(&schema),
            escape_identifier(&table)
        );

        let mut result_set = conn
            .query_iter(sql)
            .map_err(|e| format!("Query failed: {e}"))?;

        let mut rows_exported: u64 = 0;
        let mut columns: Vec<String> = Vec::new();
        let mut is_first_row = true;

        // Write JSON array start
        writer
            .write_all(b"[\n")
            .map_err(|e| format!("Write error: {e}"))?;

        for row_result in result_set.by_ref() {
            let row: mysql::Row = row_result.map_err(|e| format!("Row read error: {e}"))?;

            if is_first_row {
                columns = row
                    .columns_ref()
                    .iter()
                    .map(|c| c.name_str().to_string())
                    .collect();
                is_first_row = false;
            }

            // Write comma before each object except the first
            if rows_exported > 0 {
                writer
                    .write_all(b",\n")
                    .map_err(|e| format!("Write error: {e}"))?;
            }

            // Write object start
            writer
                .write_all(b"  {\n")
                .map_err(|e| format!("Write error: {e}"))?;

            // Write fields in column order
            for (idx, col) in columns.iter().enumerate() {
                let value: mysql::Value = row.get(idx).unwrap_or(mysql::Value::NULL);
                let json_value = mysql_value_to_json(&value);

                // Write field name
                writer
                    .write_all(format!("    \"{}\": ", escape_json_string(col)).as_bytes())
                    .map_err(|e| format!("Write error: {e}"))?;

                // Write field value
                let value_str = match json_value {
                    serde_json::Value::Null => "null".to_string(),
                    serde_json::Value::Bool(b) => b.to_string(),
                    serde_json::Value::Number(n) => n.to_string(),
                    serde_json::Value::String(s) => format!("\"{}\"", escape_json_string(&s)),
                    _ => format!("\"{}\"", escape_json_string(&json_value.to_string())),
                };
                writer
                    .write_all(value_str.as_bytes())
                    .map_err(|e| format!("Write error: {e}"))?;

                // Write comma after each field except the last
                if idx < columns.len() - 1 {
                    writer
                        .write_all(b",")
                        .map_err(|e| format!("Write error: {e}"))?;
                }
                writer
                    .write_all(b"\n")
                    .map_err(|e| format!("Write error: {e}"))?;
            }

            // Write object end
            writer
                .write_all(b"  }")
                .map_err(|e| format!("Write error: {e}"))?;

            rows_exported += 1;
        }

        // Write JSON array end
        if rows_exported > 0 {
            writer
                .write_all(b"\n")
                .map_err(|e| format!("Write error: {e}"))?;
        }
        writer
            .write_all(b"]\n")
            .map_err(|e| format!("Write error: {e}"))?;

        writer
            .flush()
            .map_err(|e| format!("Failed to flush file: {e}"))?;
        Ok(rows_exported)
    })
}

fn do_export_html(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let schema = schema.to_string();
    let table = table.to_string();

    pool::with_temp_connection(profile, |conn| {
        let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
        let mut writer = BufWriter::with_capacity(64 * 1024, file);

        let sql = format!(
            "SELECT * FROM `{}`.`{}`",
            escape_identifier(&schema),
            escape_identifier(&table)
        );

        let mut result_set = conn
            .query_iter(sql)
            .map_err(|e| format!("Query failed: {e}"))?;

        let mut rows_exported: u64 = 0;
        let mut columns: Vec<String> = Vec::new();
        let mut is_first_row = true;

        // Write HTML header
        writer
            .write_all(HTML_HEADER.replace("{table_name}", &table).as_bytes())
            .map_err(|e| format!("Failed to write HTML header: {e}"))?;

        for row_result in result_set.by_ref() {
            let row: mysql::Row = row_result.map_err(|e| format!("Row read error: {e}"))?;

            if is_first_row {
                columns = row
                    .columns_ref()
                    .iter()
                    .map(|c| c.name_str().to_string())
                    .collect();

                if columns.is_empty() {
                    writer
                        .write_all(HTML_FOOTER.as_bytes())
                        .map_err(|e| format!("Failed to write HTML footer: {e}"))?;
                    writer
                        .flush()
                        .map_err(|e| format!("Failed to flush file: {e}"))?;
                    return Ok(0);
                }

                // Write table header
                writer
                    .write_all(b"    <thead>\n      <tr>\n")
                    .map_err(|e| format!("Write error: {e}"))?;
                for col in &columns {
                    writer
                        .write_all(format!("        <th>{}</th>\n", html_escape(col)).as_bytes())
                        .map_err(|e| format!("Write error: {e}"))?;
                }
                writer
                    .write_all(b"      </tr>\n    </thead>\n    <tbody>\n")
                    .map_err(|e| format!("Write error: {e}"))?;

                is_first_row = false;
            }

            // Write table row
            writer
                .write_all(b"      <tr>\n")
                .map_err(|e| format!("Write error: {e}"))?;
            for idx in 0..columns.len() {
                let value: mysql::Value = row.get(idx).unwrap_or(mysql::Value::NULL);
                let str_val = value_to_string(&value);
                let display_val = if str_val.is_empty() {
                    "&nbsp;".to_string()
                } else {
                    html_escape(&str_val)
                };
                writer
                    .write_all(format!("        <td>{}</td>\n", display_val).as_bytes())
                    .map_err(|e| format!("Write error: {e}"))?;
            }
            writer
                .write_all(b"      </tr>\n")
                .map_err(|e| format!("Write error: {e}"))?;
            rows_exported += 1;
        }

        // Write HTML footer
        writer
            .write_all(b"    </tbody>\n")
            .map_err(|e| format!("Write error: {e}"))?;
        writer
            .write_all(HTML_FOOTER.as_bytes())
            .map_err(|e| format!("Failed to write HTML footer: {e}"))?;

        writer
            .flush()
            .map_err(|e| format!("Failed to flush file: {e}"))?;
        Ok(rows_exported)
    })
}

fn do_export_xml(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let schema = schema.to_string();
    let table = table.to_string();

    pool::with_temp_connection(profile, |conn| {
        let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
        let mut writer = BufWriter::with_capacity(64 * 1024, file);

        let sql = format!(
            "SELECT * FROM `{}`.`{}`",
            escape_identifier(&schema),
            escape_identifier(&table)
        );

        let mut result_set = conn
            .query_iter(sql)
            .map_err(|e| format!("Query failed: {e}"))?;

        let mut rows_exported: u64 = 0;
        let mut columns: Vec<String> = Vec::new();
        let mut is_first_row = true;

        // Write XML header
        writer
            .write_all(b"<?xml version=\"1.0\" standalone=\"yes\"?>\n")
            .map_err(|e| format!("Failed to write XML header: {e}"))?;
        writer
            .write_all(b"<RECORDS>\n")
            .map_err(|e| format!("Failed to write XML root: {e}"))?;

        for row_result in result_set.by_ref() {
            let row: mysql::Row = row_result.map_err(|e| format!("Row read error: {e}"))?;

            if is_first_row {
                columns = row
                    .columns_ref()
                    .iter()
                    .map(|c| c.name_str().to_string())
                    .collect();
                is_first_row = false;
            }

            writer
                .write_all(b"\t<RECORD>\n")
                .map_err(|e| format!("Write error: {e}"))?;
            for (idx, col) in columns.iter().enumerate() {
                let value: mysql::Value = row.get(idx).unwrap_or(mysql::Value::NULL);
                let str_val = value_to_string(&value);
                let escaped_val = xml_escape(&str_val);
                writer
                    .write_all(
                        format!(
                            "\t\t<{}>{}</{}>\n",
                            xml_escape_name(col),
                            escaped_val,
                            xml_escape_name(col)
                        )
                        .as_bytes(),
                    )
                    .map_err(|e| format!("Write error: {e}"))?;
            }
            writer
                .write_all(b"\t</RECORD>\n")
                .map_err(|e| format!("Write error: {e}"))?;
            rows_exported += 1;
        }

        writer
            .write_all(b"</RECORDS>\n")
            .map_err(|e| format!("Failed to write XML footer: {e}"))?;

        writer
            .flush()
            .map_err(|e| format!("Failed to flush file: {e}"))?;
        Ok(rows_exported)
    })
}

fn do_export_sql(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let schema = schema.to_string();
    let table = table.to_string();

    pool::with_temp_connection(profile, |conn| {
        let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
        let mut writer = BufWriter::with_capacity(64 * 1024, file);

        let sql = format!(
            "SELECT * FROM `{}`.`{}`",
            escape_identifier(&schema),
            escape_identifier(&table)
        );

        let mut result_set = conn
            .query_iter(sql)
            .map_err(|e| format!("Query failed: {e}"))?;

        let mut rows_exported: u64 = 0;
        let mut columns: Vec<String> = Vec::new();
        let mut is_first_row = true;

        for row_result in result_set.by_ref() {
            let row: mysql::Row = row_result.map_err(|e| format!("Row read error: {e}"))?;

            if is_first_row {
                columns = row
                    .columns_ref()
                    .iter()
                    .map(|c| c.name_str().to_string())
                    .collect();
                is_first_row = false;
            }

            let mut values: Vec<String> = Vec::with_capacity(columns.len());
            for idx in 0..columns.len() {
                let value: mysql::Value = row.get(idx).unwrap_or(mysql::Value::NULL);
                values.push(mysql_value_to_sql(&value));
            }

            let col_names: Vec<String> = columns
                .iter()
                .map(|c| format!("`{}`", escape_identifier(c)))
                .collect();
            let insert_sql = format!(
                "INSERT INTO `{}`.`{}` ({}) VALUES ({});\n",
                escape_identifier(&schema),
                escape_identifier(&table),
                col_names.join(", "),
                values.join(", ")
            );

            writer
                .write_all(insert_sql.as_bytes())
                .map_err(|e| format!("Write error: {e}"))?;
            rows_exported += 1;
        }

        writer
            .flush()
            .map_err(|e| format!("Failed to flush file: {e}"))?;
        Ok(rows_exported)
    })
}

fn do_export_jsonl(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let schema = schema.to_string();
    let table = table.to_string();

    pool::with_temp_connection(profile, |conn| {
        let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
        let mut writer = BufWriter::with_capacity(64 * 1024, file);

        let sql = format!(
            "SELECT * FROM `{}`.`{}`",
            escape_identifier(&schema),
            escape_identifier(&table)
        );

        let mut result_set = conn
            .query_iter(sql)
            .map_err(|e| format!("Query failed: {e}"))?;

        let mut rows_exported: u64 = 0;
        let mut columns: Vec<String> = Vec::new();
        let mut is_first_row = true;

        for row_result in result_set.by_ref() {
            let row: mysql::Row = row_result.map_err(|e| format!("Row read error: {e}"))?;

            if is_first_row {
                columns = row
                    .columns_ref()
                    .iter()
                    .map(|c| c.name_str().to_string())
                    .collect();

                if columns.is_empty() {
                    return Ok(0);
                }

                is_first_row = false;
            }

            let mut obj = serde_json::Map::new();
            for (idx, col) in columns.iter().enumerate() {
                let value: mysql::Value = row.get(idx).unwrap_or(mysql::Value::NULL);
                obj.insert(col.clone(), json!(value_to_string(&value)));
            }
            let line =
                serde_json::to_string(&obj).map_err(|e| format!("JSON serialize failed: {e}"))?;
            writer
                .write_all(line.as_bytes())
                .map_err(|e| format!("File write error: {e}"))?;
            writer
                .write_all(b"\n")
                .map_err(|e| format!("Failed to write newline: {e}"))?;

            rows_exported += 1;
        }

        writer
            .flush()
            .map_err(|e| format!("Failed to flush file: {e}"))?;
        Ok(rows_exported)
    })
}

// Query result export functions
fn do_export_query_csv(
    file_path: &Path,
    headers: &[String],
    rows: &[Vec<String>],
) -> Result<u64, String> {
    let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
    let mut writer = BufWriter::with_capacity(64 * 1024, file);

    writer
        .write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {e}"))?;

    // Write headers
    let header: Vec<String> = headers.iter().map(|c| escape_csv_field(c)).collect();
    writer
        .write_all(header.join(",").as_bytes())
        .map_err(|e| format!("Failed to write header: {e}"))?;
    writer
        .write_all(b"\n")
        .map_err(|e| format!("Failed to write newline: {e}"))?;

    // Write rows
    for row in rows {
        let record: Vec<String> = row.iter().map(|v| escape_csv_field(v)).collect();
        writer
            .write_all(record.join(",").as_bytes())
            .map_err(|e| format!("File write error: {e}"))?;
        writer
            .write_all(b"\n")
            .map_err(|e| format!("Failed to write newline: {e}"))?;
    }

    writer
        .flush()
        .map_err(|e| format!("Failed to flush file: {e}"))?;
    Ok(rows.len() as u64)
}

fn do_export_query_txt(
    file_path: &Path,
    headers: &[String],
    rows: &[Vec<String>],
) -> Result<u64, String> {
    let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
    let mut writer = BufWriter::with_capacity(64 * 1024, file);

    writer
        .write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {e}"))?;

    // Write headers with quotes
    let header: Vec<String> = headers.iter().map(|c| format!("\"{}\"", c)).collect();
    writer
        .write_all(header.join("\t").as_bytes())
        .map_err(|e| format!("Failed to write header: {e}"))?;
    writer
        .write_all(b"\n")
        .map_err(|e| format!("Failed to write newline: {e}"))?;

    // Write rows
    for row in rows {
        let record: Vec<String> = row.iter().map(|v| format!("\"{}\"", v)).collect();
        writer
            .write_all(record.join("\t").as_bytes())
            .map_err(|e| format!("File write error: {e}"))?;
        writer
            .write_all(b"\n")
            .map_err(|e| format!("Failed to write newline: {e}"))?;
    }

    writer
        .flush()
        .map_err(|e| format!("Failed to flush file: {e}"))?;
    Ok(rows.len() as u64)
}

fn do_export_query_json(
    file_path: &Path,
    headers: &[String],
    rows: &[Vec<String>],
) -> Result<u64, String> {
    let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
    let mut writer = BufWriter::with_capacity(64 * 1024, file);

    // Write JSON array start
    writer
        .write_all(b"[\n")
        .map_err(|e| format!("Write error: {e}"))?;

    for (row_idx, row) in rows.iter().enumerate() {
        // Write comma before each object except the first
        if row_idx > 0 {
            writer
                .write_all(b",\n")
                .map_err(|e| format!("Write error: {e}"))?;
        }

        // Write object start
        writer
            .write_all(b"  {\n")
            .map_err(|e| format!("Write error: {e}"))?;

        // Write fields in header order
        for (idx, header) in headers.iter().enumerate() {
            let value = row.get(idx).map(|s| s.as_str()).unwrap_or("");

            // Write field name
            writer
                .write_all(format!("    \"{}\": ", escape_json_string(header)).as_bytes())
                .map_err(|e| format!("Write error: {e}"))?;

            // Write field value - try to parse as number for proper JSON types
            let value_str = if let Ok(n) = value.parse::<i64>() {
                n.to_string()
            } else if let Ok(n) = value.parse::<f64>() {
                n.to_string()
            } else if value.is_empty() {
                "null".to_string()
            } else {
                format!("\"{}\"", escape_json_string(value))
            };

            writer
                .write_all(value_str.as_bytes())
                .map_err(|e| format!("Write error: {e}"))?;

            // Write comma after each field except the last
            if idx < headers.len() - 1 {
                writer
                    .write_all(b",")
                    .map_err(|e| format!("Write error: {e}"))?;
            }
            writer
                .write_all(b"\n")
                .map_err(|e| format!("Write error: {e}"))?;
        }

        // Write object end
        writer
            .write_all(b"  }")
            .map_err(|e| format!("Write error: {e}"))?;
    }

    // Write JSON array end
    if !rows.is_empty() {
        writer
            .write_all(b"\n")
            .map_err(|e| format!("Write error: {e}"))?;
    }
    writer
        .write_all(b"]\n")
        .map_err(|e| format!("Write error: {e}"))?;

    writer
        .flush()
        .map_err(|e| format!("Failed to flush file: {e}"))?;
    Ok(rows.len() as u64)
}

fn do_export_query_html(
    file_path: &Path,
    headers: &[String],
    rows: &[Vec<String>],
    table_name: Option<&str>,
) -> Result<u64, String> {
    let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
    let mut writer = BufWriter::with_capacity(64 * 1024, file);

    let name = table_name.unwrap_or("Query Result");
    writer
        .write_all(HTML_HEADER.replace("{table_name}", name).as_bytes())
        .map_err(|e| format!("Failed to write HTML header: {e}"))?;

    // Write table header
    writer
        .write_all(b"    <thead>\n      <tr>\n")
        .map_err(|e| format!("Write error: {e}"))?;
    for header in headers {
        writer
            .write_all(format!("        <th>{}</th>\n", html_escape(header)).as_bytes())
            .map_err(|e| format!("Write error: {e}"))?;
    }
    writer
        .write_all(b"      </tr>\n    </thead>\n    <tbody>\n")
        .map_err(|e| format!("Write error: {e}"))?;

    // Write rows
    for row in rows {
        writer
            .write_all(b"      <tr>\n")
            .map_err(|e| format!("Write error: {e}"))?;
        for cell in row {
            let display_val = if cell.is_empty() {
                "&nbsp;".to_string()
            } else {
                html_escape(cell)
            };
            writer
                .write_all(format!("        <td>{}</td>\n", display_val).as_bytes())
                .map_err(|e| format!("Write error: {e}"))?;
        }
        writer
            .write_all(b"      </tr>\n")
            .map_err(|e| format!("Write error: {e}"))?;
    }

    writer
        .write_all(b"    </tbody>\n")
        .map_err(|e| format!("Write error: {e}"))?;
    writer
        .write_all(HTML_FOOTER.as_bytes())
        .map_err(|e| format!("Failed to write HTML footer: {e}"))?;

    writer
        .flush()
        .map_err(|e| format!("Failed to flush file: {e}"))?;
    Ok(rows.len() as u64)
}

fn do_export_query_xml(
    file_path: &Path,
    headers: &[String],
    rows: &[Vec<String>],
) -> Result<u64, String> {
    let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
    let mut writer = BufWriter::with_capacity(64 * 1024, file);

    writer
        .write_all(b"<?xml version=\"1.0\" standalone=\"yes\"?>\n")
        .map_err(|e| format!("Failed to write XML header: {e}"))?;
    writer
        .write_all(b"<RECORDS>\n")
        .map_err(|e| format!("Failed to write XML root: {e}"))?;

    for row in rows {
        writer
            .write_all(b"\t<RECORD>\n")
            .map_err(|e| format!("Write error: {e}"))?;
        for (idx, header) in headers.iter().enumerate() {
            let value = row.get(idx).map(|s| s.as_str()).unwrap_or("");
            writer
                .write_all(
                    format!(
                        "\t\t<{}>{}</{}>\n",
                        xml_escape_name(header),
                        xml_escape(value),
                        xml_escape_name(header)
                    )
                    .as_bytes(),
                )
                .map_err(|e| format!("Write error: {e}"))?;
        }
        writer
            .write_all(b"\t</RECORD>\n")
            .map_err(|e| format!("Write error: {e}"))?;
    }

    writer
        .write_all(b"</RECORDS>\n")
        .map_err(|e| format!("Failed to write XML footer: {e}"))?;

    writer
        .flush()
        .map_err(|e| format!("Failed to flush file: {e}"))?;
    Ok(rows.len() as u64)
}

fn do_export_query_sql(
    file_path: &Path,
    headers: &[String],
    rows: &[Vec<String>],
    table_name: Option<&str>,
) -> Result<u64, String> {
    let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
    let mut writer = BufWriter::with_capacity(64 * 1024, file);

    let table = table_name.unwrap_or("table_name");
    let col_names: Vec<String> = headers
        .iter()
        .map(|c| format!("`{}`", escape_identifier(c)))
        .collect();

    for row in rows {
        let values: Vec<String> = row
            .iter()
            .map(|v| {
                if v.is_empty() {
                    "NULL".to_string()
                } else {
                    format!("'{}'", escape_sql_string(v))
                }
            })
            .collect();

        let insert_sql = format!(
            "INSERT INTO `{}` ({}) VALUES ({});\n",
            escape_identifier(table),
            col_names.join(", "),
            values.join(", ")
        );

        writer
            .write_all(insert_sql.as_bytes())
            .map_err(|e| format!("Write error: {e}"))?;
    }

    writer
        .flush()
        .map_err(|e| format!("Failed to flush file: {e}"))?;
    Ok(rows.len() as u64)
}

fn do_export_query_jsonl(
    file_path: &Path,
    headers: &[String],
    rows: &[Vec<String>],
) -> Result<u64, String> {
    let file = File::create(file_path).map_err(|e| format!("Failed to create file: {e}"))?;
    let mut writer = BufWriter::with_capacity(64 * 1024, file);

    for row in rows {
        let mut obj = serde_json::Map::new();
        for (idx, header) in headers.iter().enumerate() {
            let value = row.get(idx).map(|s| s.as_str()).unwrap_or("");
            obj.insert(header.clone(), json!(value));
        }
        let line =
            serde_json::to_string(&obj).map_err(|e| format!("JSON serialize failed: {e}"))?;
        writer
            .write_all(line.as_bytes())
            .map_err(|e| format!("File write error: {e}"))?;
        writer
            .write_all(b"\n")
            .map_err(|e| format!("Failed to write newline: {e}"))?;
    }

    writer
        .flush()
        .map_err(|e| format!("Failed to flush file: {e}"))?;
    Ok(rows.len() as u64)
}

fn do_export_query_xlsx(
    file_path: &Path,
    headers: &[String],
    rows: &[Vec<String>],
    _table_name: Option<&str>,
) -> Result<u64, String> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();

    // Create header format (bold)
    let header_format = Format::new().set_bold().set_align(FormatAlign::Center);

    // Write headers
    for (col_idx, header) in headers.iter().enumerate() {
        worksheet
            .write_string_with_format(0, col_idx as u16, header, &header_format)
            .map_err(|e| format!("Failed to write header: {e}"))?;
    }

    // Write data rows
    for (row_idx, row) in rows.iter().enumerate() {
        for (col_idx, value) in row.iter().enumerate() {
            // Try to parse as number
            if let Ok(n) = value.parse::<f64>() {
                worksheet
                    .write_number((row_idx + 1) as u32, col_idx as u16, n)
                    .map_err(|e| format!("Failed to write number: {e}"))?;
            } else {
                worksheet
                    .write_string((row_idx + 1) as u32, col_idx as u16, value)
                    .map_err(|e| format!("Failed to write string: {e}"))?;
            }
        }
    }

    // Auto-adjust column widths
    for (idx, header) in headers.iter().enumerate() {
        let width = (header.len() + 5) as f64;
        worksheet
            .set_column_width(idx as u16, width)
            .map_err(|e| format!("Failed to set column width: {e}"))?;
    }

    workbook
        .save(file_path)
        .map_err(|e| format!("Failed to save Excel file: {e}"))?;

    Ok(rows.len() as u64)
}

// HTML template
const HTML_HEADER: &str = r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{table_name} - 数据导出</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        h1 {
            color: #333;
            text-align: center;
            margin-bottom: 20px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            background-color: white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        th, td {
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
        }
        th {
            background-color: #4CAF50;
            color: white;
            font-weight: 600;
        }
        tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        tr:hover {
            background-color: #f1f1f1;
        }
        .null-value {
            color: #999;
            font-style: italic;
        }
    </style>
</head>
<body>
    <h1>{table_name}</h1>
    <table>
"#;

const HTML_FOOTER: &str = r#"    </table>
</body>
</html>
"#;

// Helper functions
fn escape_identifier(input: &str) -> String {
    input.replace('`', "``")
}

fn escape_csv_field(value: &str) -> String {
    let mut needs_quote = false;
    for ch in value.chars() {
        if ch == ',' || ch == '"' || ch == '\n' || ch == '\r' {
            needs_quote = true;
            break;
        }
    }
    if !needs_quote {
        return value.to_string();
    }
    let escaped = value.replace('"', "\"\"");
    format!("\"{}\"", escaped)
}

fn escape_sql_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

fn escape_json_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn xml_escape_name(input: &str) -> String {
    // XML element names have restrictions
    let mut result = String::new();
    for (i, c) in input.chars().enumerate() {
        if i == 0 {
            if c.is_ascii_alphabetic() || c == '_' {
                result.push(c);
            } else {
                result.push('_');
            }
        } else if c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' {
            result.push(c);
        } else {
            result.push('_');
        }
    }
    if result.is_empty() {
        result = "field".to_string();
    }
    result
}

fn value_to_string(value: &mysql::Value) -> String {
    match value {
        mysql::Value::NULL => "".to_string(),
        mysql::Value::Bytes(bytes) => String::from_utf8_lossy(bytes).to_string(),
        mysql::Value::Int(v) => v.to_string(),
        mysql::Value::UInt(v) => v.to_string(),
        mysql::Value::Float(v) => v.to_string(),
        mysql::Value::Double(v) => v.to_string(),
        mysql::Value::Date(y, m, d, hh, mm, ss, us) => {
            format!("{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02}.{:06}", us)
        }
        mysql::Value::Time(neg, days, hours, mins, secs, us) => {
            format!(
                "{}{:02}:{:02}:{:02}.{:06} ({} days)",
                if *neg { "-" } else { "" },
                hours,
                mins,
                secs,
                us,
                days
            )
        }
    }
}

fn do_export_xlsx(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
    file_path: &Path,
) -> Result<u64, String> {
    let schema = schema.to_string();
    let table = table.to_string();

    pool::with_temp_connection(profile, |conn| {
        let sql = format!(
            "SELECT * FROM `{}`.`{}`",
            escape_identifier(&schema),
            escape_identifier(&table)
        );

        let mut result_set = conn
            .query_iter(sql)
            .map_err(|e| format!("Query failed: {e}"))?;

        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet();

        // Create header format (bold)
        let header_format = Format::new().set_bold().set_align(FormatAlign::Center);

        let mut rows_exported: u64 = 0;
        let mut columns: Vec<String> = Vec::new();
        let mut is_first_row = true;
        let mut row_index: u32 = 0;

        for row_result in result_set.by_ref() {
            let row: mysql::Row = row_result.map_err(|e| format!("Row read error: {e}"))?;

            if is_first_row {
                columns = row
                    .columns_ref()
                    .iter()
                    .map(|c| c.name_str().to_string())
                    .collect();

                if columns.is_empty() {
                    return Ok(0);
                }

                // Write headers with bold format
                for (col_idx, col_name) in columns.iter().enumerate() {
                    worksheet
                        .write_string_with_format(
                            row_index,
                            col_idx as u16,
                            col_name,
                            &header_format,
                        )
                        .map_err(|e| format!("Failed to write header: {e}"))?;
                }
                row_index += 1;
                is_first_row = false;
            }

            // Write data rows
            for (idx, _col) in columns.iter().enumerate() {
                let value: mysql::Value = row.get(idx).unwrap_or(mysql::Value::NULL);
                write_excel_value(worksheet, row_index, idx as u16, &value)
                    .map_err(|e| format!("Failed to write cell: {e}"))?;
            }

            row_index += 1;
            rows_exported += 1;
        }

        // Auto-adjust column widths
        for (idx, col_name) in columns.iter().enumerate() {
            let width = (col_name.len() + 5) as f64;
            worksheet
                .set_column_width(idx as u16, width)
                .map_err(|e| format!("Failed to set column width: {e}"))?;
        }

        workbook
            .save(file_path)
            .map_err(|e| format!("Failed to save Excel file: {e}"))?;

        Ok(rows_exported)
    })
}

fn write_excel_value(
    worksheet: &mut rust_xlsxwriter::Worksheet,
    row: u32,
    col: u16,
    value: &mysql::Value,
) -> Result<(), rust_xlsxwriter::XlsxError> {
    match value {
        mysql::Value::NULL => {
            worksheet.write_string(row, col, "")?;
        }
        mysql::Value::Bytes(bytes) => {
            let s = String::from_utf8_lossy(bytes);
            worksheet.write_string(row, col, &*s)?;
        }
        mysql::Value::Int(v) => {
            worksheet.write_number(row, col, *v as f64)?;
        }
        mysql::Value::UInt(v) => {
            worksheet.write_number(row, col, *v as f64)?;
        }
        mysql::Value::Float(v) => {
            worksheet.write_number(row, col, *v as f64)?;
        }
        mysql::Value::Double(v) => {
            worksheet.write_number(row, col, *v)?;
        }
        mysql::Value::Date(y, m, d, hh, mm, ss, _us) => {
            let date_str = format!("{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02}");
            worksheet.write_string(row, col, &date_str)?;
        }
        mysql::Value::Time(_neg, days, hours, mins, secs, _us) => {
            let time_str = format!("{:02}:{:02}:{:02}", days * 24 + *hours as u32, mins, secs);
            worksheet.write_string(row, col, &time_str)?;
        }
    }
    Ok(())
}

fn mysql_value_to_json(value: &mysql::Value) -> serde_json::Value {
    match value {
        mysql::Value::NULL => serde_json::Value::Null,
        mysql::Value::Bytes(bytes) => {
            // Always treat bytes as string to preserve original format
            // e.g., "001" should remain "001", not become 1
            let s = String::from_utf8_lossy(bytes);
            json!(s.to_string())
        }
        mysql::Value::Int(v) => json!(v),
        mysql::Value::UInt(v) => json!(v),
        mysql::Value::Float(v) => json!(v),
        mysql::Value::Double(v) => json!(v),
        mysql::Value::Date(y, m, d, hh, mm, ss, _us) => {
            json!(format!("{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02}"))
        }
        mysql::Value::Time(neg, days, hours, mins, secs, _us) => {
            json!(format!(
                "{}{:02}:{:02}:{:02}",
                if *neg { "-" } else { "" },
                days * 24 + *hours as u32,
                mins,
                secs
            ))
        }
    }
}

fn mysql_value_to_sql(value: &mysql::Value) -> String {
    match value {
        mysql::Value::NULL => "NULL".to_string(),
        mysql::Value::Bytes(bytes) => {
            let s = String::from_utf8_lossy(bytes);
            format!("'{}'", escape_sql_string(&s))
        }
        mysql::Value::Int(v) => v.to_string(),
        mysql::Value::UInt(v) => v.to_string(),
        mysql::Value::Float(v) => v.to_string(),
        mysql::Value::Double(v) => v.to_string(),
        mysql::Value::Date(y, m, d, hh, mm, ss, _us) => {
            format!("'{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02}'")
        }
        mysql::Value::Time(neg, days, hours, mins, secs, _us) => {
            format!(
                "'{}{:02}:{:02}:{:02}'",
                if *neg { "-" } else { "" },
                days * 24 + *hours as u32,
                mins,
                secs
            )
        }
    }
}
