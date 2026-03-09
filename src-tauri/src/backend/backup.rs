use crate::backend::models::ConnectionProfile;
use chrono::{DateTime, Local};
use cron::Schedule;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use mysql::prelude::*;
use mysql::params;
use mysql::Value;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Read, Write};
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use crate::backend::pool;

#[derive(Clone)]
struct DumpServerInfo {
    source_server: String,
    source_server_type: String,
    source_server_version: String,
    source_host: String,
    source_schema: String,
    target_server_type: String,
    target_server_version: String,
    file_encoding: String,
}

#[derive(Clone, Default)]
struct TableOptionsMeta {
    engine: Option<String>,
    table_collation: Option<String>,
    row_format: Option<String>,
    table_comment: Option<String>,
    auto_increment: Option<u64>,
}

#[derive(Clone, Default)]
struct ColumnCharsetMeta {
    charset: Option<String>,
    collation: Option<String>,
}

#[derive(Deserialize, Clone, Default)]
pub struct BackupOptions {
    pub include_structure: bool,
    pub include_data: bool,
    pub include_views: bool,
    pub include_routines: bool,
    pub include_triggers: bool,
    pub add_drop_table: bool,
    pub use_transaction: bool,
    pub compress_output: bool,
    pub compression_level: Option<u32>,
    pub insert_batch_size: Option<usize>,
}

#[derive(Deserialize, Clone)]
pub struct BackupRequest {
    pub conn: ConnectionProfile,
    pub schema: String,
    pub output_path: String,
    #[serde(default)]
    pub selected_tables: Vec<String>,
    #[serde(default)]
    pub selected_views: Vec<String>,
    #[serde(default)]
    pub selected_routines: Vec<String>,
    pub options: BackupOptions,
}

#[derive(Deserialize)]
pub struct RestoreRequest {
    pub conn: ConnectionProfile,
    pub target_schema: String,
    pub input_path: String,
    pub create_schema: bool,
    #[serde(default)]
    pub continue_on_error: bool,
    #[serde(default)]
    pub use_transaction: bool,
}

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct IncrementalRequest {
    pub conn: ConnectionProfile,
    pub schema: String,
    pub output_dir: String,
    pub binlog_index_path: String,
    pub mysqlbinlog_path: Option<String>,
}

#[derive(Deserialize)]
pub struct ScheduleRequest {
    pub schedule_id: String,
    pub cron: String,
    pub backup: BackupRequest,
}

#[derive(Serialize)]
pub struct BackupResult {
    pub output_path: String,
    pub duration_ms: u64,
}

#[derive(Serialize)]
pub struct RestoreResult {
    pub duration_ms: u64,
}

#[derive(Serialize)]
pub struct IncrementalResult {
    pub output_file: String,
    pub duration_ms: u64,
}

#[derive(Clone)]
struct ScheduleTask {
    id: String,
    schedule: Schedule,
    backup: BackupRequest,
    next_run: Arc<Mutex<DateTime<Local>>>,
}

struct Scheduler {
    tasks: Mutex<HashMap<String, ScheduleTask>>,
    running: AtomicBool,
}

static SCHEDULER: OnceLock<Arc<Scheduler>> = OnceLock::new();

pub fn backup_execute(req: BackupRequest) -> Result<BackupResult, String> {
    let start = Instant::now();
    let output_path = run_sql_backup(&req)?;
    Ok(BackupResult {
        output_path,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

pub fn restore_execute(req: RestoreRequest) -> Result<RestoreResult, String> {
    let start = Instant::now();
    if req.create_schema {
        create_schema(&req)?;
    }
    run_sql_restore(&req)?;
    Ok(RestoreResult {
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

pub fn incremental_backup(req: IncrementalRequest) -> Result<IncrementalResult, String> {
    let _ = req;
    Err("Incremental backup via mysqlbinlog has been deprecated. Use full SQL backup profiles instead.".to_string())
}

pub fn schedule_add(req: ScheduleRequest) -> Result<bool, String> {
    let schedule = Schedule::from_str(&req.cron).map_err(|e| format!("Invalid cron: {e}"))?;
    let next = schedule
        .upcoming(Local)
        .next()
        .ok_or_else(|| "No upcoming schedule time".to_string())?;

    let task = ScheduleTask {
        id: req.schedule_id.clone(),
        schedule,
        backup: req.backup,
        next_run: Arc::new(Mutex::new(next)),
    };

    let scheduler = ensure_scheduler();
    scheduler
        .tasks
        .lock()
        .unwrap()
        .insert(task.id.clone(), task);
    Ok(true)
}

pub fn schedule_remove(schedule_id: &str) -> Result<bool, String> {
    let scheduler = ensure_scheduler();
    scheduler.tasks.lock().unwrap().remove(schedule_id);
    Ok(true)
}

pub fn schedule_list() -> Result<Vec<String>, String> {
    let scheduler = ensure_scheduler();
    let tasks = scheduler.tasks.lock().unwrap();
    Ok(tasks.keys().cloned().collect())
}

fn ensure_scheduler() -> Arc<Scheduler> {
    SCHEDULER
        .get_or_init(|| {
            let scheduler = Arc::new(Scheduler {
                tasks: Mutex::new(HashMap::new()),
                running: AtomicBool::new(true),
            });
            spawn_scheduler_loop(Arc::clone(&scheduler));
            scheduler
        })
        .clone()
}

fn spawn_scheduler_loop(scheduler: Arc<Scheduler>) {
    thread::spawn(move || loop {
        if !scheduler.running.load(Ordering::SeqCst) {
            break;
        }

        let tasks_snapshot: Vec<ScheduleTask> = {
            let guard = scheduler.tasks.lock().unwrap();
            guard.values().cloned().collect()
        };

        let now = Local::now();
        for task in tasks_snapshot {
            let mut next = task.next_run.lock().unwrap();
            if now >= *next {
                let backup = task.backup.clone();
                let _ = thread::spawn(move || {
                    let _ = run_sql_backup(&backup);
                });
                if let Some(next_time) = task.schedule.upcoming(Local).next() {
                    *next = next_time;
                }
            }
        }

        thread::sleep(Duration::from_secs(30));
    });
}

fn run_sql_backup(req: &BackupRequest) -> Result<String, String> {
    if req.schema.trim().is_empty() {
        return Err("Schema name is required".to_string());
    }

    let resolved_output = resolve_output_path(&req.output_path);
    ensure_parent_dir(&resolved_output)?;

    let include_structure = req.options.include_structure || !req.options.include_data;
    let include_data = req.options.include_data;
    let include_views = req.options.include_views;
    let include_routines = req.options.include_routines;
    let include_triggers = req.options.include_triggers;
    let add_drop = req.options.add_drop_table;
    let use_transaction = req.options.use_transaction && include_data;
    let compress_output = req.options.compress_output || resolved_output.ends_with(".gz");
    let compression_level = req.options.compression_level.unwrap_or(6).min(9);
    let insert_batch_size = req.options.insert_batch_size.unwrap_or(200).max(1).min(5000);

    let file = File::create(&resolved_output).map_err(|e| format!("Create backup file failed: {e}"))?;
    let mut writer: Box<dyn Write> = if compress_output {
        Box::new(BufWriter::new(GzEncoder::new(
            file,
            Compression::new(compression_level),
        )))
    } else {
        Box::new(BufWriter::new(file))
    };

    pool::with_temp_connection_database(&req.conn, Some(&req.schema), |conn| {
        let server_info = fetch_dump_server_info(conn, req)?;
        write_dump_header(&mut writer, &server_info)?;

        if use_transaction {
            conn.query_drop("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                .map_err(|e| format!("Set transaction level failed: {e}"))?;
            conn.query_drop("START TRANSACTION WITH CONSISTENT SNAPSHOT")
                .map_err(|e| format!("Start transaction failed: {e}"))?;
        }

        let tables = resolve_object_list(
            conn,
            &req.schema,
            "BASE TABLE",
            &req.selected_tables,
        )?;

        if include_structure {
            for table in &tables {
                dump_table_structure(conn, &mut writer, &req.schema, table, add_drop)?;
            }
        }

        if include_data {
            for table in &tables {
                dump_table_data(conn, &mut writer, table, insert_batch_size)?;
            }
        }

        if include_triggers {
            for table in &tables {
                dump_table_triggers(conn, &mut writer, &req.schema, table)?;
            }
        }

        if include_views {
            let views = resolve_object_list(conn, &req.schema, "VIEW", &req.selected_views)?;
            for view in &views {
                dump_view_definition(conn, &mut writer, view, add_drop)?;
            }
        }

        if include_routines {
            let routines = resolve_routine_list(conn, &req.schema, &req.selected_routines)?;
            for (routine_type, routine_name) in &routines {
                dump_routine_definition(conn, &mut writer, routine_type, routine_name)?;
            }
        }

        if use_transaction {
            conn.query_drop("COMMIT")
                .map_err(|e| format!("Commit transaction failed: {e}"))?;
        }

        write_dump_footer(&mut writer)?;

        Ok(())
    })?;

    writer.flush().map_err(|e| format!("Flush backup file failed: {e}"))?;
    Ok(resolved_output)
}

fn create_schema(req: &RestoreRequest) -> Result<(), String> {
    pool::with_temp_connection(&req.conn, |conn| {
        conn.query_drop(format!(
            "CREATE DATABASE IF NOT EXISTS `{}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
            escape_identifier(&req.target_schema)
        ))
        .map_err(|e| format!("Create schema failed: {e}"))?;
        Ok(())
    })
}

fn run_sql_restore(req: &RestoreRequest) -> Result<(), String> {
    let input_path = PathBuf::from(&req.input_path);
    if !input_path.exists() {
        return Err("SQL file not found".to_string());
    }

    let sql_text = read_sql_file(&input_path)?;
    let statements = split_sql_statements(&sql_text);
    if statements.is_empty() {
        return Err("No executable SQL statements found".to_string());
    }

    pool::with_temp_connection_database(&req.conn, Some(&req.target_schema), |conn| {
        if req.use_transaction {
            conn.query_drop("START TRANSACTION")
                .map_err(|e| format!("Start transaction failed: {e}"))?;
        }

        let mut first_error: Option<String> = None;

        for statement in statements.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            // Use text protocol for restore SQL to support statements not available in prepared mode.
            let exec_result = conn.query_drop(statement);
            if let Err(err) = exec_result {
                let msg = format!("Restore statement failed: {err}");
                if req.continue_on_error {
                    if first_error.is_none() {
                        first_error = Some(msg);
                    }
                    continue;
                }

                if req.use_transaction {
                    let _ = conn.query_drop("ROLLBACK");
                }
                return Err(msg);
            }
        }

        if req.use_transaction {
            conn.query_drop("COMMIT")
                .map_err(|e| format!("Commit transaction failed: {e}"))?;
        }

        if let Some(err) = first_error {
            return Err(err);
        }

        Ok(())
    })
}

fn resolve_output_path(path: &str) -> String {
    if path.contains("{timestamp}") {
        let ts = Local::now().format("%Y%m%d_%H%M%S").to_string();
        path.replace("{timestamp}", &ts)
    } else {
        path.to_string()
    }
}

fn ensure_parent_dir(path: &str) -> Result<(), String> {
    let parent = PathBuf::from(path).parent().map(|p| p.to_path_buf());
    if let Some(parent) = parent {
        std::fs::create_dir_all(parent).map_err(|e| format!("Create directory failed: {e}"))?;
    }
    Ok(())
}

fn write_dump_header(writer: &mut dyn Write, info: &DumpServerInfo) -> Result<(), String> {
    let header = format!(
        "/*\n Database Workbench SQL Backup\n Source Server: {}\n Source Server Type: {}\n Source Server Version: {}\n Source Host: {}\n Source Schema: {}\n\n Target Server Type: {}\n Target Server Version: {}\n File Encoding: {}\n\n Generated At: {}\n Engine: Native SQL Driver\n */\n\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n",
        info.source_server,
        info.source_server_type,
        info.source_server_version,
        info.source_host,
        info.source_schema,
        info.target_server_type,
        info.target_server_version,
        info.file_encoding,
        Local::now().format("%Y-%m-%d %H:%M:%S")
    );
    writer
        .write_all(header.as_bytes())
        .map_err(|e| format!("Write backup header failed: {e}"))
}

fn write_dump_footer(writer: &mut dyn Write) -> Result<(), String> {
    writer
        .write_all(b"\nSET FOREIGN_KEY_CHECKS = 1;\n")
        .map_err(|e| format!("Write backup footer failed: {e}"))
}

fn fetch_dump_server_info(conn: &mut mysql::Conn, req: &BackupRequest) -> Result<DumpServerInfo, String> {
    let version_row: Option<(String, Option<String>)> = conn
        .query_first("SELECT VERSION() AS version, @@version_comment AS version_comment")
        .map_err(|e| format!("Query server version failed: {e}"))?;

    let (version, comment) = version_row.ok_or_else(|| "Server version not available".to_string())?;
    let comment_text = comment.unwrap_or_default();
    let version_text = if comment_text.trim().is_empty() {
        version.clone()
    } else {
        format!("{} ({})", version, comment_text.trim())
    };

    let server_type = detect_server_type(&version, &comment_text);
    let source_server = req
        .conn
        .name
        .clone()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| format!("{}:{}", req.conn.host, req.conn.port));

    Ok(DumpServerInfo {
        source_server,
        source_server_type: server_type.clone(),
        source_server_version: version_text.clone(),
        source_host: format!("{}:{}", req.conn.host, req.conn.port),
        source_schema: req.schema.clone(),
        target_server_type: server_type,
        target_server_version: version_text,
        file_encoding: "UTF-8".to_string(),
    })
}

fn detect_server_type(version: &str, comment: &str) -> String {
    let combined = format!("{} {}", version, comment).to_ascii_lowercase();
    if combined.contains("mariadb") {
        "MariaDB".to_string()
    } else {
        "MySQL".to_string()
    }
}

fn resolve_object_list(
    conn: &mut mysql::Conn,
    schema: &str,
    table_type: &str,
    selected: &[String],
) -> Result<Vec<String>, String> {
    if !selected.is_empty() {
        return Ok(selected
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect());
    }

    let sql = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = :schema AND TABLE_TYPE = :table_type ORDER BY TABLE_NAME";
    conn.exec_map(
        sql,
        mysql::params! {
            "schema" => schema,
            "table_type" => table_type,
        },
        |name: String| name,
    )
    .map_err(|e| format!("List objects failed: {e}"))
}

fn resolve_routine_list(
    conn: &mut mysql::Conn,
    schema: &str,
    selected: &[String],
) -> Result<Vec<(String, String)>, String> {
    let all_sql = "SELECT ROUTINE_TYPE, ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = :schema ORDER BY ROUTINE_TYPE, ROUTINE_NAME";
    let routines: Vec<(String, String)> = conn
        .exec(all_sql, mysql::params! { "schema" => schema })
        .map_err(|e| format!("List routines failed: {e}"))?;

    if selected.is_empty() {
        return Ok(routines);
    }

    let selected_lower: Vec<String> = selected.iter().map(|v| v.to_ascii_lowercase()).collect();
    Ok(routines
        .into_iter()
        .filter(|(_, name)| selected_lower.contains(&name.to_ascii_lowercase()))
        .collect())
}

fn dump_table_structure(
    conn: &mut mysql::Conn,
    writer: &mut dyn Write,
    schema: &str,
    table_name: &str,
    add_drop: bool,
) -> Result<(), String> {
    let sql = format!("SHOW CREATE TABLE `{}`", escape_identifier(table_name));
    let row: Option<(String, String)> = conn
        .query_first(sql)
        .map_err(|e| format!("SHOW CREATE TABLE failed for {}: {e}", table_name))?;

    let (_, create_stmt) = row.ok_or_else(|| format!("Table {} does not exist", table_name))?;

    let table_options_meta = load_table_options_meta(conn, schema, table_name)?;
    let column_charset_meta = load_column_charset_meta(conn, schema, table_name)?;
    let enriched_create_stmt = enrich_create_table_statement(
        &create_stmt,
        &table_options_meta,
        &column_charset_meta,
    );

    let mut body = String::new();
    body.push_str(&format!("--\n-- Structure for table `{}`\n--\n", table_name));
    if add_drop {
        body.push_str(&format!("DROP TABLE IF EXISTS `{}`;\n", escape_identifier(table_name)));
    }
    body.push_str(&enriched_create_stmt);
    body.push_str(";\n\n");

    writer
        .write_all(body.as_bytes())
        .map_err(|e| format!("Write table structure failed: {e}"))
}

fn load_table_options_meta(
    conn: &mut mysql::Conn,
    schema: &str,
    table_name: &str,
) -> Result<TableOptionsMeta, String> {
    let sql = "SELECT ENGINE, TABLE_COLLATION, ROW_FORMAT, TABLE_COMMENT, AUTO_INCREMENT FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table_name";
    let row: Option<(Option<String>, Option<String>, Option<String>, Option<String>, Option<u64>)> = conn
        .exec_first(
            sql,
            mysql::params! {
                "schema" => schema,
                "table_name" => table_name,
            },
        )
        .map_err(|e| format!("Read table options failed for {}: {e}", table_name))?;

    let (engine, table_collation, row_format, table_comment, auto_increment) = row
        .ok_or_else(|| format!("Table metadata not found for {}", table_name))?;

    Ok(TableOptionsMeta {
        engine,
        table_collation,
        row_format,
        table_comment,
        auto_increment,
    })
}

fn load_column_charset_meta(
    conn: &mut mysql::Conn,
    schema: &str,
    table_name: &str,
) -> Result<HashMap<String, ColumnCharsetMeta>, String> {
    let sql = "SELECT COLUMN_NAME, CHARACTER_SET_NAME, COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table_name ORDER BY ORDINAL_POSITION";
    let rows: Vec<(String, Option<String>, Option<String>)> = conn
        .exec(
            sql,
            mysql::params! {
                "schema" => schema,
                "table_name" => table_name,
            },
        )
        .map_err(|e| format!("Read column charset metadata failed for {}: {e}", table_name))?;

    let mut map = HashMap::new();
    for (column_name, charset, collation) in rows {
        map.insert(
            column_name.to_ascii_lowercase(),
            ColumnCharsetMeta { charset, collation },
        );
    }
    Ok(map)
}

fn enrich_create_table_statement(
    create_stmt: &str,
    options_meta: &TableOptionsMeta,
    column_meta: &HashMap<String, ColumnCharsetMeta>,
) -> String {
    let mut lines: Vec<String> = create_stmt
        .lines()
        .map(|line| enrich_column_definition_line(line, column_meta))
        .collect();

    if let Some(last_line) = lines.last_mut() {
        if last_line.trim_start().starts_with(')') {
            *last_line = build_table_options_line(last_line, options_meta);
        }
    }

    lines.join("\n")
}

fn enrich_column_definition_line(
    line: &str,
    column_meta: &HashMap<String, ColumnCharsetMeta>,
) -> String {
    let trimmed = line.trim_start();
    if !trimmed.starts_with('`') {
        return line.to_string();
    }

    let first_tick = match line.find('`') {
        Some(idx) => idx,
        None => return line.to_string(),
    };
    let second_tick = match line[first_tick + 1..].find('`') {
        Some(idx) => first_tick + 1 + idx,
        None => return line.to_string(),
    };

    let column_name = &line[first_tick + 1..second_tick];
    let meta = match column_meta.get(&column_name.to_ascii_lowercase()) {
        Some(v) => v,
        None => return line.to_string(),
    };

    if meta.charset.is_none() && meta.collation.is_none() {
        return line.to_string();
    }

    let upper = line.to_ascii_uppercase();
    let missing_charset = meta.charset.is_some() && !upper.contains(" CHARACTER SET ");
    let missing_collation = meta.collation.is_some() && !upper.contains(" COLLATE ");
    if !missing_charset && !missing_collation {
        return line.to_string();
    }

    let insert_pos = find_column_type_end(line, second_tick + 1);
    if insert_pos >= line.len() {
        return line.to_string();
    }

    let mut insertion = String::new();
    if missing_charset {
        if let Some(charset) = &meta.charset {
            insertion.push_str(&format!(" CHARACTER SET {}", charset));
        }
    }
    if missing_collation {
        if let Some(collation) = &meta.collation {
            insertion.push_str(&format!(" COLLATE {}", collation));
        }
    }

    if insertion.is_empty() {
        return line.to_string();
    }

    let mut out = String::with_capacity(line.len() + insertion.len());
    out.push_str(&line[..insert_pos]);
    out.push_str(&insertion);
    out.push_str(&line[insert_pos..]);
    out
}

fn find_column_type_end(line: &str, mut index: usize) -> usize {
    let bytes = line.as_bytes();
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }

    let mut depth = 0i32;
    let mut in_single = false;
    let mut in_double = false;
    let mut i = index;

    while i < bytes.len() {
        let ch = bytes[i] as char;

        if ch == '\'' && !in_double {
            in_single = !in_single;
            i += 1;
            continue;
        }
        if ch == '"' && !in_single {
            in_double = !in_double;
            i += 1;
            continue;
        }

        if !in_single && !in_double {
            if ch == '(' {
                depth += 1;
            } else if ch == ')' {
                depth = (depth - 1).max(0);
            } else if ch.is_ascii_whitespace() && depth == 0 {
                break;
            }
        }

        i += 1;
    }

    i
}

fn build_table_options_line(original_last_line: &str, options: &TableOptionsMeta) -> String {
    let engine = match &options.engine {
        Some(v) if !v.trim().is_empty() => v.trim(),
        _ => return original_last_line.to_string(),
    };
    let table_collation = match &options.table_collation {
        Some(v) if !v.trim().is_empty() => v.trim(),
        _ => return original_last_line.to_string(),
    };
    let row_format = match &options.row_format {
        Some(v) if !v.trim().is_empty() => v.trim(),
        _ => return original_last_line.to_string(),
    };

    let table_charset = derive_charset_from_collation(table_collation)
        .unwrap_or_else(|| "utf8mb4".to_string());

    let mut option_parts = vec![
        format!("ENGINE = {}", engine),
        format!("CHARACTER SET = {}", table_charset),
        format!("COLLATE = {}", table_collation),
        format!("ROW_FORMAT = {}", row_format),
    ];

    if let Some(auto_increment) = options.auto_increment {
        option_parts.push(format!("AUTO_INCREMENT = {}", auto_increment));
    }

    if let Some(comment) = &options.table_comment {
        if !comment.trim().is_empty() {
            option_parts.push(format!("COMMENT = '{}'", escape_sql_string(comment.trim())));
        }
    }

    format!(") {}", option_parts.join(" "))
}

fn derive_charset_from_collation(collation: &str) -> Option<String> {
    let trimmed = collation.trim();
    if trimmed.is_empty() {
        return None;
    }
    trimmed.split('_').next().map(|v| v.to_string())
}

fn dump_table_data(
    conn: &mut mysql::Conn,
    writer: &mut dyn Write,
    table_name: &str,
    batch_size: usize,
) -> Result<(), String> {
    let sql = format!("SELECT * FROM `{}`", escape_identifier(table_name));
    let mut rows = conn
        .query_iter(sql)
        .map_err(|e| format!("Read table data failed for {}: {e}", table_name))?;

    let columns_binding = rows.columns();
    let columns = columns_binding.as_ref();
    let column_list = columns
        .iter()
        .map(|c| format!("`{}`", escape_identifier(c.name_str().as_ref())))
        .collect::<Vec<_>>()
        .join(", ");

    let mut values_batch: Vec<String> = Vec::with_capacity(batch_size);
    let mut has_any_row = false;

    for row in rows.by_ref() {
        let row = row.map_err(|e| format!("Read row failed for {}: {e}", table_name))?;
        let values = row
            .unwrap()
            .into_iter()
            .map(|v| to_sql_literal(&v))
            .collect::<Vec<_>>()
            .join(", ");
        values_batch.push(format!("({})", values));
        has_any_row = true;

        if values_batch.len() >= batch_size {
            flush_insert_batch(writer, table_name, &column_list, &values_batch)?;
            values_batch.clear();
        }
    }

    if !values_batch.is_empty() {
        flush_insert_batch(writer, table_name, &column_list, &values_batch)?;
    }

    if has_any_row {
        writer
            .write_all(b"\n")
            .map_err(|e| format!("Write data separator failed: {e}"))?;
    }

    Ok(())
}

fn flush_insert_batch(
    writer: &mut dyn Write,
    table_name: &str,
    column_list: &str,
    values_batch: &[String],
) -> Result<(), String> {
    for values in values_batch {
        let stmt = format!(
            "INSERT INTO `{}` ({}) VALUES {};\n",
            escape_identifier(table_name),
            column_list,
            values
        );
        writer
            .write_all(stmt.as_bytes())
            .map_err(|e| format!("Write insert batch failed: {e}"))?;
    }
    Ok(())
}

fn dump_table_triggers(
    conn: &mut mysql::Conn,
    writer: &mut dyn Write,
    schema: &str,
    table_name: &str,
) -> Result<(), String> {
    let trigger_sql = "SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = :schema AND EVENT_OBJECT_TABLE = :table_name ORDER BY TRIGGER_NAME";
    let trigger_names: Vec<String> = conn
        .exec(
            trigger_sql,
            mysql::params! {
                "schema" => schema,
                "table_name" => table_name,
            },
        )
        .map_err(|e| format!("List triggers failed for {}: {e}", table_name))?;

    for trigger_name in trigger_names {
        let show_sql = format!(
            "SHOW CREATE TRIGGER `{}`.`{}`",
            escape_identifier(schema),
            escape_identifier(&trigger_name)
        );
        let row = conn
            .query_first::<mysql::Row, _>(show_sql)
            .map_err(|e| format!("SHOW CREATE TRIGGER failed for {}: {e}", trigger_name))?
            .ok_or_else(|| format!("Trigger {} not found", trigger_name))?;

        if let Some(create_sql) = row_get_string(&row, &["SQL Original Statement", "Create Trigger"]) {
            let normalized = create_sql.trim().trim_end_matches(';');
            let body = format!(
                "--\n-- Trigger `{}`\n--\nDROP TRIGGER IF EXISTS `{}`;\nDELIMITER $$\n{}$$\nDELIMITER ;\n\n",
                trigger_name,
                escape_identifier(&trigger_name),
                normalized
            );
            writer
                .write_all(body.as_bytes())
                .map_err(|e| format!("Write trigger definition failed: {e}"))?;
        }
    }

    Ok(())
}

fn dump_view_definition(
    conn: &mut mysql::Conn,
    writer: &mut dyn Write,
    view_name: &str,
    add_drop: bool,
) -> Result<(), String> {
    let sql = format!("SHOW CREATE VIEW `{}`", escape_identifier(view_name));
    let row = conn
        .query_first::<mysql::Row, _>(sql)
        .map_err(|e| format!("SHOW CREATE VIEW failed for {}: {e}", view_name))?
        .ok_or_else(|| format!("View {} not found", view_name))?;

    let create_stmt = row_get_string(&row, &["Create View"])
        .ok_or_else(|| format!("Missing Create View statement for {}", view_name))?;
    let formatted_create_stmt = format_view_ddl_for_backup(&create_stmt);

    let mut body = String::new();
    body.push_str(&format!("--\n-- View `{}`\n--\n", view_name));
    if add_drop {
        body.push_str(&format!("DROP VIEW IF EXISTS `{}`;\n", escape_identifier(view_name)));
    }
    body.push_str(&formatted_create_stmt);
    body.push_str(";\n\n");

    writer
        .write_all(body.as_bytes())
        .map_err(|e| format!("Write view definition failed: {e}"))
}

fn dump_routine_definition(
    conn: &mut mysql::Conn,
    writer: &mut dyn Write,
    routine_type: &str,
    routine_name: &str,
) -> Result<(), String> {
    let show_sql = if routine_type.eq_ignore_ascii_case("PROCEDURE") {
        format!("SHOW CREATE PROCEDURE `{}`", escape_identifier(routine_name))
    } else {
        format!("SHOW CREATE FUNCTION `{}`", escape_identifier(routine_name))
    };

    let row = conn
        .query_first::<mysql::Row, _>(show_sql)
        .map_err(|e| format!("SHOW CREATE {} failed for {}: {e}", routine_type, routine_name))?
        .ok_or_else(|| format!("{} {} not found", routine_type, routine_name))?;

    let create_stmt = if routine_type.eq_ignore_ascii_case("PROCEDURE") {
        row_get_string(&row, &["Create Procedure"])
    } else {
        row_get_string(&row, &["Create Function"])
    }
    .ok_or_else(|| format!("Missing routine DDL for {} {}", routine_type, routine_name))?;

    let normalized = normalize_routine_statement(&create_stmt);
    let normalized = normalized.trim_end_matches(';').to_string();

    let body = format!(
        "--\n-- {} `{}`\n--\nDROP {} IF EXISTS `{}`;\nDELIMITER $$\n{}$$\nDELIMITER ;\n\n",
        routine_type,
        routine_name,
        routine_type,
        escape_identifier(routine_name),
        normalized
    );

    writer
        .write_all(body.as_bytes())
        .map_err(|e| format!("Write routine definition failed: {e}"))
}

fn normalize_routine_statement(stmt: &str) -> String {
    let s = stmt.trim();
    if s.ends_with(';') {
        s.to_string()
    } else {
        format!("{};", s)
    }
}

fn format_view_ddl_for_backup(ddl: &str) -> String {
    let mut formatted = collapse_whitespace(ddl);
    if formatted.is_empty() {
        return formatted;
    }

    // Keep behavior aligned with the View Definition dialog: break list items and clauses.
    formatted = replace_case_insensitive(&formatted, ", ", ",\n  ");

    let clause_keywords = [
        "SELECT",
        "FROM",
        "WHERE",
        "GROUP BY",
        "HAVING",
        "ORDER BY",
        "LIMIT",
        "OFFSET",
        "UNION",
        "LEFT JOIN",
        "RIGHT JOIN",
        "INNER JOIN",
        "OUTER JOIN",
        "JOIN",
        "ON",
        "AND",
        "OR",
    ];

    for keyword in clause_keywords {
        let needle = format!(" {} ", keyword);
        let replacement = format!("\n{}\n  ", keyword);
        formatted = replace_case_insensitive(&formatted, &needle, &replacement);
    }

    formatted = collapse_blank_lines(&formatted);
    formatted.trim().to_string()
}

fn collapse_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn collapse_blank_lines(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_newline = false;

    for ch in input.chars() {
        if ch == '\n' {
            if prev_newline {
                continue;
            }
            prev_newline = true;
            out.push(ch);
            continue;
        }

        prev_newline = false;
        out.push(ch);
    }

    out
}

fn replace_case_insensitive(source: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() {
        return source.to_string();
    }

    let source_upper = source.to_ascii_uppercase();
    let needle_upper = needle.to_ascii_uppercase();

    let mut result = String::with_capacity(source.len());
    let mut start = 0usize;

    while let Some(pos) = source_upper[start..].find(&needle_upper) {
        let abs_pos = start + pos;
        result.push_str(&source[start..abs_pos]);
        result.push_str(replacement);
        start = abs_pos + needle.len();
    }

    result.push_str(&source[start..]);
    result
}

fn row_get_string(row: &mysql::Row, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = row.get::<String, _>(*key) {
            return Some(v);
        }
    }
    None
}

fn to_sql_literal(value: &Value) -> String {
    match value {
        Value::NULL => "NULL".to_string(),
        Value::Bytes(bytes) => {
            let s = String::from_utf8_lossy(bytes);
            format!("'{}'", escape_sql_string(&s))
        }
        Value::Int(v) => v.to_string(),
        Value::UInt(v) => v.to_string(),
        Value::Float(v) => {
            if v.is_finite() {
                v.to_string()
            } else {
                "NULL".to_string()
            }
        }
        Value::Double(v) => {
            if v.is_finite() {
                v.to_string()
            } else {
                "NULL".to_string()
            }
        }
        Value::Date(year, month, day, hour, minute, second, micros) => {
            if *hour == 0 && *minute == 0 && *second == 0 && *micros == 0 {
                format!("'{:04}-{:02}-{:02}'", year, month, day)
            } else if *micros > 0 {
                format!(
                    "'{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:06}'",
                    year, month, day, hour, minute, second, micros
                )
            } else {
                format!(
                    "'{:04}-{:02}-{:02} {:02}:{:02}:{:02}'",
                    year, month, day, hour, minute, second
                )
            }
        }
        Value::Time(is_neg, days, hour, minute, second, micros) => {
            let sign = if *is_neg { "-" } else { "" };
            let total_hour = (*days as u32) * 24 + (*hour as u32);
            if *micros > 0 {
                format!(
                    "'{}{:02}:{:02}:{:02}.{:06}'",
                    sign, total_hour, minute, second, micros
                )
            } else {
                format!("'{}{:02}:{:02}:{:02}'", sign, total_hour, minute, second)
            }
        }
    }
}

fn escape_sql_string(raw: &str) -> String {
    raw.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\0', "\\0")
}

fn escape_identifier(identifier: &str) -> String {
    identifier.replace('`', "``")
}

fn read_sql_file(path: &PathBuf) -> Result<String, String> {
    let mut content = String::new();
    if path
        .extension()
        .and_then(|v| v.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("gz"))
    {
        let file = File::open(path).map_err(|e| format!("Open SQL file failed: {e}"))?;
        let mut decoder = GzDecoder::new(file);
        decoder
            .read_to_string(&mut content)
            .map_err(|e| format!("Read gzip SQL failed: {e}"))?;
    } else {
        let mut file = File::open(path).map_err(|e| format!("Open SQL file failed: {e}"))?;
        file.read_to_string(&mut content)
            .map_err(|e| format!("Read SQL file failed: {e}"))?;
    }
    Ok(content)
}

fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut statements: Vec<String> = Vec::new();
    let mut delimiter = ";".to_string();
    let mut current = String::new();
    let mut in_block_comment = false;

    for raw_line in sql.lines() {
        let line = raw_line.trim_end();
        let line_trimmed = line.trim();

        if in_block_comment {
            if line_trimmed.contains("*/") {
                in_block_comment = false;
            }
            continue;
        }

        if line_trimmed.starts_with("/*") {
            if !line_trimmed.contains("*/") {
                in_block_comment = true;
            }
            continue;
        }

        if line_trimmed.is_empty()
            || line_trimmed.starts_with("--")
            || line_trimmed.starts_with("#")
        {
            continue;
        }

        if line_trimmed.to_ascii_uppercase().starts_with("DELIMITER ") {
            delimiter = line_trimmed[10..].trim().to_string();
            continue;
        }

        current.push_str(line);
        current.push('\n');

        let current_trimmed = current.trim_end();
        let should_finalize = if delimiter == ";" {
            if is_compound_create_statement(current_trimmed) {
                ends_with_compound_terminator(current_trimmed)
            } else {
                current_trimmed.ends_with(&delimiter)
            }
        } else {
            current_trimmed.ends_with(&delimiter)
        };

        if should_finalize {
            let statement = current_trimmed[..current_trimmed.len() - delimiter.len()]
                .trim()
                .to_string();
            if !statement.is_empty() {
                statements.push(statement);
            }
            current.clear();
        }
    }

    let trailing = current.trim();
    if !trailing.is_empty() {
        statements.push(trailing.to_string());
    }

    statements
}

fn is_compound_create_statement(statement: &str) -> bool {
    let upper = statement.trim_start().to_ascii_uppercase();
    let is_create_routine = upper.starts_with("CREATE ")
        && (upper.contains(" TRIGGER ")
            || upper.contains(" PROCEDURE ")
            || upper.contains(" FUNCTION "));

    is_create_routine && upper.contains("BEGIN")
}

fn ends_with_compound_terminator(statement: &str) -> bool {
    let upper = statement.trim_end().to_ascii_uppercase();
    upper.ends_with("END;")
}
