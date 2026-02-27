use crate::backend::models::ConnectionProfile;
use chrono::{DateTime, Local};
use cron::Schedule;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Deserialize, Clone)]
pub struct BackupOptions {
    pub include_data: bool,
    pub include_views: bool,
    pub include_routines: bool,
    pub add_drop_table: bool,
}

#[derive(Deserialize, Clone)]
pub struct BackupRequest {
    pub conn: ConnectionProfile,
    pub schema: String,
    pub mysqldump_path: String,
    pub output_path: String,
    pub options: BackupOptions,
}

#[derive(Deserialize)]
pub struct RestoreRequest {
    pub conn: ConnectionProfile,
    pub target_schema: String,
    pub mysql_path: String,
    pub input_path: String,
    pub create_schema: bool,
}

#[derive(Deserialize)]
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
    let output_path = run_mysqldump(&req)?;
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
    run_mysql_restore(&req)?;
    Ok(RestoreResult {
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

pub fn incremental_backup(req: IncrementalRequest) -> Result<IncrementalResult, String> {
    let start = Instant::now();
    let output = run_binlog_backup(&req)?;
    Ok(IncrementalResult {
        output_file: output,
        duration_ms: start.elapsed().as_millis() as u64,
    })
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
                    let _ = run_mysqldump(&backup);
                });
                if let Some(next_time) = task.schedule.upcoming(Local).next() {
                    *next = next_time;
                }
            }
        }

        thread::sleep(Duration::from_secs(30));
    });
}

fn run_mysqldump(req: &BackupRequest) -> Result<String, String> {
    if req.mysqldump_path.trim().is_empty() {
        return Err("mysqldump path is required".to_string());
    }
    if req.schema.trim().is_empty() {
        return Err("Schema name is required".to_string());
    }

    let resolved_output = resolve_output_path(&req.output_path);
    ensure_parent_dir(&resolved_output)?;

    let mut cmd = Command::new(&req.mysqldump_path);
    cmd.arg("-h")
        .arg(&req.conn.host)
        .arg("-P")
        .arg(req.conn.port.to_string())
        .arg("-u")
        .arg(&req.conn.username)
        .arg(&req.schema)
        .arg(format!("--result-file={}", resolved_output));

    cmd.env("MYSQL_PWD", &req.conn.password);

    if !req.options.include_data {
        cmd.arg("--no-data");
    }
    if !req.options.include_views {
        let _ = req.options.include_views;
    }
    if req.options.include_routines {
        cmd.arg("--routines").arg("--events");
    }
    if req.options.add_drop_table {
        cmd.arg("--add-drop-table");
    }

    let output = cmd.output().map_err(|e| format!("mysqldump failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("mysqldump error: {stderr}"));
    }
    Ok(resolved_output)
}

fn create_schema(req: &RestoreRequest) -> Result<(), String> {
    let mut cmd = Command::new(&req.mysql_path);
    cmd.arg("-h")
        .arg(&req.conn.host)
        .arg("-P")
        .arg(req.conn.port.to_string())
        .arg("-u")
        .arg(&req.conn.username)
        .arg("-e")
        .arg(format!(
            "CREATE DATABASE IF NOT EXISTS `{}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
            req.target_schema
        ));
    cmd.env("MYSQL_PWD", &req.conn.password);
    let output = cmd
        .output()
        .map_err(|e| format!("Create schema failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("Create schema error: {stderr}"));
    }
    Ok(())
}

fn run_mysql_restore(req: &RestoreRequest) -> Result<(), String> {
    let mut cmd = Command::new(&req.mysql_path);
    cmd.arg("-h")
        .arg(&req.conn.host)
        .arg("-P")
        .arg(req.conn.port.to_string())
        .arg("-u")
        .arg(&req.conn.username)
        .arg(&req.target_schema);

    cmd.env("MYSQL_PWD", &req.conn.password);

    let input_path = PathBuf::from(&req.input_path);
    if !input_path.exists() {
        return Err("SQL file not found".to_string());
    }

    let file = std::fs::File::open(input_path).map_err(|e| format!("Open SQL failed: {e}"))?;
    cmd.stdin(file);

    let output = cmd.output().map_err(|e| format!("mysql failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("Restore failed: {stderr}"));
    }
    Ok(())
}

fn run_binlog_backup(req: &IncrementalRequest) -> Result<String, String> {
    let binlog_path = req
        .mysqlbinlog_path
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "mysqlbinlog".to_string());

    let mut cmd = Command::new(binlog_path);
    cmd.arg("--read-from-remote-server")
        .arg("--host")
        .arg(&req.conn.host)
        .arg("--port")
        .arg(req.conn.port.to_string())
        .arg("--user")
        .arg(&req.conn.username);

    cmd.env("MYSQL_PWD", &req.conn.password);

    if req.binlog_index_path.trim().is_empty() {
        return Err("binlog index path is required".to_string());
    }

    let output_dir = PathBuf::from(&req.output_dir);
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("Create output dir failed: {e}"))?;

    let index_path = PathBuf::from(&req.binlog_index_path);
    if !index_path.exists() {
        return Err("binlog index file not found".to_string());
    }

    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let output_file = output_dir.join(format!("{}_binlog_{}.sql", req.schema, timestamp));
    let _ = std::fs::File::create(&output_file)
        .map_err(|e| format!("Create binlog file failed: {e}"))?;

    cmd.arg("--result-file").arg(&output_file);
    cmd.arg("--binlog-index").arg(index_path);
    cmd.arg("--database").arg(&req.schema);

    let output = cmd
        .output()
        .map_err(|e| format!("mysqlbinlog failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("mysqlbinlog error: {stderr}"));
    }

    Ok(output_file.to_string_lossy().to_string())
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
