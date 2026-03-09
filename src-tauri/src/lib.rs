mod backend;

use backend::app_config;
use backend::backup;
use backend::config;
use backend::executor;
use backend::export as export_mod;
use backend::favorites;
use backend::import as import_mod;
use backend::json as json_mod;
use backend::metadata;
use backend::models::{ConnectionProfile, DbType, FavoriteItem, FavoriteType, SqlParam, UserModel};
use backend::pool;
use backend::sqlutils;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use std::io::Write;
use tauri::Emitter;
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
struct CsvExportInfo {
    file_path: String,
    exported_at: String,
    row_count: usize,
}

const GITHUB_LATEST_ENDPOINT: &str =
    "https://raw.githubusercontent.com/T-152-kw/database-workbench/main/latest.json";
const GITEE_LATEST_ENDPOINT: &str =
    "https://gitee.com/nick4487617348/database-workbench/raw/master/latest.json";

#[derive(Deserialize)]
struct IpApiCoResponse {
    country_code: Option<String>,
}

#[derive(Deserialize)]
struct IpWhoIsResponse {
    success: Option<bool>,
    country_code: Option<String>,
}

#[derive(Deserialize)]
struct IpInfoResponse {
    country: Option<String>,
}

#[derive(Serialize)]
struct RegionUpdateInfo {
    available: bool,
    version: Option<String>,
    date: Option<String>,
    body: Option<String>,
    preferred_source: String,
    country_code: Option<String>,
}

#[derive(Serialize, Clone)]
struct UpdaterDownloadProgressEvent {
    event: String,
    content_length: Option<u64>,
    chunk_length: Option<u64>,
    downloaded: u64,
    total: Option<u64>,
    percentage: Option<u8>,
}

struct UpdaterDownloadProgressState {
    started: bool,
    downloaded: u64,
    total: Option<u64>,
}

static COUNTRY_CODE_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static SQL_SPLIT_SESSIONS: OnceLock<Mutex<HashMap<u64, Vec<String>>>> = OnceLock::new();
static SQL_SPLIT_SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);
const SQL_SPLIT_PAGE_SIZE_DEFAULT: u64 = 120;
const SQL_SPLIT_PAGE_SIZE_MAX: u64 = 1000;

#[derive(Serialize)]
struct SqlSplitSessionInfo {
    session_id: u64,
    total: u64,
}

#[derive(Serialize)]
struct SqlSplitStatementsPage {
    statements: Vec<String>,
    page: u64,
    page_size: u64,
    total: u64,
    total_pages: u64,
    has_more: bool,
}

fn sql_split_sessions() -> &'static Mutex<HashMap<u64, Vec<String>>> {
    SQL_SPLIT_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn updater_endpoints_for_country(country_code: Option<&str>) -> (String, Vec<&'static str>) {
    if country_code == Some("CN") {
        (
            "gitee".to_string(),
            vec![GITEE_LATEST_ENDPOINT, GITHUB_LATEST_ENDPOINT],
        )
    } else {
        (
            "github".to_string(),
            vec![GITHUB_LATEST_ENDPOINT, GITEE_LATEST_ENDPOINT],
        )
    }
}

fn parse_update_endpoints(endpoints: &[&'static str]) -> Result<Vec<reqwest::Url>, String> {
    endpoints
        .iter()
        .map(|endpoint| {
            endpoint
                .parse::<reqwest::Url>()
                .map_err(|e| format!("Invalid updater endpoint {endpoint}: {e}"))
        })
        .collect()
}

fn country_cache() -> &'static Mutex<Option<String>> {
    COUNTRY_CODE_CACHE.get_or_init(|| Mutex::new(None))
}

fn get_cached_country_code() -> Option<String> {
    country_cache().lock().ok().and_then(|g| g.clone())
}

fn set_cached_country_code(country_code: Option<String>) {
    if let Ok(mut g) = country_cache().lock() {
        *g = country_code;
    }
}

async fn detect_country_code_from_ipapi(client: reqwest::Client) -> Option<String> {
    let resp = client
        .get("https://ipapi.co/json/")
        .send()
        .await
        .and_then(|res| res.error_for_status())
        .ok()?;

    resp.json::<IpApiCoResponse>().await.ok()?.country_code
}

async fn detect_country_code_from_ipwhois(client: reqwest::Client) -> Option<String> {
    let resp = client
        .get("https://ipwho.is/")
        .send()
        .await
        .and_then(|res| res.error_for_status())
        .ok()?;

    let payload = resp.json::<IpWhoIsResponse>().await.ok()?;
    if payload.success.unwrap_or(true) {
        payload.country_code
    } else {
        None
    }
}

async fn detect_country_code_from_ipinfo(client: reqwest::Client) -> Option<String> {
    let resp = client
        .get("https://ipinfo.io/json")
        .send()
        .await
        .and_then(|res| res.error_for_status())
        .ok()?;

    resp.json::<IpInfoResponse>().await.ok()?.country
}

async fn detect_country_code() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1200))
        .build()
        .ok()?;

    let mut tasks = tokio::task::JoinSet::new();
    tasks.spawn(detect_country_code_from_ipapi(client.clone()));
    tasks.spawn(detect_country_code_from_ipwhois(client.clone()));
    tasks.spawn(detect_country_code_from_ipinfo(client));

    while let Some(result) = tasks.join_next().await {
        if let Ok(Some(code)) = result {
            tasks.abort_all();
            return Some(code.to_uppercase());
        }
    }

    None
}

async fn get_or_detect_country_code() -> Option<String> {
    if let Some(code) = get_cached_country_code() {
        return Some(code);
    }

    // Keep country lookup bounded to avoid long spinning on slow networks.
    let detected = tokio::time::timeout(Duration::from_millis(1600), detect_country_code())
        .await
        .ok()
        .flatten();

    if let Some(code) = detected.clone() {
        set_cached_country_code(Some(code));
    }

    detected
}

async fn warmup_country_detection_cache() {
    let _ = get_or_detect_country_code().await;
}

#[tauri::command]
fn pool_create(profile: ConnectionProfile) -> Result<u64, String> {
    pool::create_pool(&profile)
}

#[tauri::command]
fn pool_get_connection(pool_id: u64, initial_database: Option<String>) -> Result<u64, String> {
    pool::get_connection(pool_id, initial_database)
}

#[tauri::command]
fn pool_set_database(pool_id: u64, conn_id: u64, database: Option<String>) -> Result<(), String> {
    pool::set_connection_database(pool_id, conn_id, database)
}

#[tauri::command]
fn pool_release_connection(pool_id: u64, conn_id: u64) -> Result<bool, String> {
    pool::release_connection(pool_id, conn_id)
}

#[tauri::command]
fn pool_test_connection(profile: ConnectionProfile) -> Result<bool, String> {
    pool::test_connection(&profile)
}

#[tauri::command]
fn pool_get_stats(pool_id: u64) -> Result<pool::PoolStats, String> {
    pool::get_stats(pool_id)
}

// NEW: 获取详细统计信息
#[tauri::command]
fn pool_get_detailed_stats(pool_id: u64) -> Result<pool::DetailedPoolStats, String> {
    pool::get_detailed_stats(pool_id)
}

// NEW: 获取活跃连接列表
#[tauri::command]
fn pool_get_active_connections(pool_id: u64) -> Result<Vec<pool::ActiveConnectionInfo>, String> {
    pool::get_active_connections(pool_id)
}

// NEW: 获取所有活跃连接
#[tauri::command]
fn pool_get_all_active_connections() -> Vec<pool::ActiveConnectionInfo> {
    pool::get_all_active_connections()
}

#[tauri::command]
fn pool_get_connection_properties(
    pool_id: u64,
    database: Option<String>,
) -> Result<pool::ConnectionProperties, String> {
    let res = pool::get_connection_properties(pool_id, database.as_deref());

    match &res {
        Ok(props) => {
            if let Ok(s) = serde_json::to_string(props) {
                let _ = writeln!(
                    std::io::stdout(),
                    "DEBUG pool_get_connection_properties: {}",
                    s
                );
            }
        }
        Err(err) => {
            let _ = writeln!(
                std::io::stderr(),
                "DEBUG pool_get_connection_properties error: {}",
                err
            );
        }
    }

    res
}

#[tauri::command]
fn pool_query(pool_id: u64, conn_id: u64, sql: String) -> Result<pool::QueryResult, String> {
    pool::query(pool_id, conn_id, &sql)
}

#[tauri::command]
fn pool_query_page(
    pool_id: u64,
    conn_id: u64,
    sql: String,
    page: Option<u64>,
    page_size: Option<u64>,
    include_total: Option<bool>,
) -> Result<pool::QueryPageResult, String> {
    pool::query_page(pool_id, conn_id, &sql, page, page_size, include_total)
}

#[tauri::command]
fn pool_query_multi(
    pool_id: u64,
    conn_id: u64,
    sql: String,
) -> Result<pool::MultiQueryResult, String> {
    pool::query_multi(pool_id, conn_id, &sql)
}

#[tauri::command]
fn pool_execute(pool_id: u64, conn_id: u64, sql: String) -> Result<pool::ExecResult, String> {
    pool::execute(pool_id, conn_id, &sql)
}

#[tauri::command]
fn pool_query_prepared(
    pool_id: u64,
    conn_id: u64,
    sql: String,
    params: Vec<SqlParam>,
) -> Result<pool::QueryResult, String> {
    pool::query_prepared(pool_id, conn_id, &sql, params)
}

#[tauri::command]
fn pool_query_prepared_multi(
    pool_id: u64,
    conn_id: u64,
    sql: String,
    params: Vec<SqlParam>,
) -> Result<pool::MultiQueryResult, String> {
    pool::query_prepared_multi(pool_id, conn_id, &sql, params)
}

#[tauri::command]
fn pool_execute_prepared(
    pool_id: u64,
    conn_id: u64,
    sql: String,
    params: Vec<SqlParam>,
) -> Result<pool::ExecResult, String> {
    pool::execute_prepared(pool_id, conn_id, &sql, params)
}

#[tauri::command]
fn pool_close(pool_id: u64) {
    pool::close_pool(pool_id);
}

#[tauri::command]
fn pool_close_all() {
    pool::close_all_pools();
}

#[tauri::command]
fn metadata_list_databases(profile: ConnectionProfile) -> Result<Vec<String>, String> {
    metadata::list_databases(&profile)
}

#[tauri::command]
fn metadata_list_tables(
    profile: ConnectionProfile,
    database: String,
) -> Result<Vec<String>, String> {
    metadata::list_tables(&profile, &database)
}

#[tauri::command]
fn metadata_list_table_details(
    profile: ConnectionProfile,
    database: String,
) -> Result<Vec<metadata::TableDetail>, String> {
    metadata::list_table_details(&profile, &database)
}

#[tauri::command]
fn metadata_list_views(
    profile: ConnectionProfile,
    database: String,
) -> Result<Vec<String>, String> {
    metadata::list_views(&profile, &database)
}

#[tauri::command]
fn metadata_list_view_details(
    profile: ConnectionProfile,
    database: String,
) -> Result<Vec<metadata::ViewDetail>, String> {
    metadata::list_view_details(&profile, &database)
}

#[tauri::command]
fn metadata_list_functions(
    profile: ConnectionProfile,
    database: String,
) -> Result<Vec<String>, String> {
    metadata::list_functions(&profile, &database)
}

#[tauri::command]
fn metadata_list_routines_with_details(
    profile: ConnectionProfile,
    database: String,
) -> Result<Vec<metadata::RoutineDetail>, String> {
    metadata::list_routines_with_details(&profile, &database)
}

#[tauri::command]
fn metadata_list_function_details(
    profile: ConnectionProfile,
    database: String,
) -> Result<Vec<metadata::FunctionDetail>, String> {
    metadata::list_function_details(&profile, &database)
}

#[tauri::command]
fn metadata_list_columns(
    profile: ConnectionProfile,
    database: String,
    table: String,
) -> Result<Vec<std::collections::BTreeMap<String, String>>, String> {
    metadata::list_columns(&profile, &database, &table)
}

#[tauri::command]
fn metadata_list_foreign_keys(
    profile: ConnectionProfile,
    database: String,
    table: String,
) -> Result<Vec<std::collections::BTreeMap<String, String>>, String> {
    metadata::list_foreign_keys(&profile, &database, &table)
}

#[tauri::command]
fn metadata_get_er_diagram_data(
    profile: ConnectionProfile,
    database: String,
) -> Result<metadata::ErDiagramData, String> {
    metadata::get_er_diagram_data(&profile, &database)
}

#[tauri::command]
fn metadata_export_er_diagram_sql(
    profile: ConnectionProfile,
    database: String,
) -> Result<String, String> {
    metadata::export_er_diagram_sql(&profile, &database)
}

#[tauri::command]
fn metadata_list_indexes(
    profile: ConnectionProfile,
    database: String,
    table: String,
) -> Result<Vec<std::collections::BTreeMap<String, String>>, String> {
    metadata::list_indexes(&profile, &database, &table)
}

#[tauri::command]
fn metadata_list_triggers(
    profile: ConnectionProfile,
    database: String,
    table: String,
) -> Result<Vec<std::collections::BTreeMap<String, String>>, String> {
    metadata::list_triggers(&profile, &database, &table)
}

#[tauri::command]
fn metadata_list_checks(
    profile: ConnectionProfile,
    database: String,
    table: String,
) -> Result<Vec<std::collections::BTreeMap<String, String>>, String> {
    metadata::list_checks(&profile, &database, &table)
}

#[tauri::command]
fn metadata_load_ddl(
    profile: ConnectionProfile,
    database: String,
    table: String,
) -> Result<String, String> {
    metadata::load_ddl(&profile, &database, &table)
}

#[tauri::command]
fn metadata_get_current_user_info(profile: ConnectionProfile) -> Result<String, String> {
    metadata::get_current_user_info(&profile)
}

#[tauri::command]
fn metadata_get_all_users(
    profile: ConnectionProfile,
) -> Result<Vec<metadata::UserSummary>, String> {
    metadata::get_all_users(&profile)
}

#[tauri::command]
fn metadata_get_user_detail(
    profile: ConnectionProfile,
    username: String,
    host: String,
) -> Result<String, String> {
    metadata::get_user_detail(&profile, &username, &host)
}

#[tauri::command]
fn metadata_get_user_model(
    profile: ConnectionProfile,
    username: String,
    host: String,
) -> Result<metadata::UserModelPayload, String> {
    metadata::get_user_model(&profile, &username, &host)
}

#[tauri::command]
fn metadata_get_all_databases(profile: ConnectionProfile) -> Result<Vec<String>, String> {
    metadata::get_all_databases(&profile)
}

#[tauri::command]
fn metadata_generate_user_sql(
    user: UserModel,
    is_new_user: bool,
    original: Option<UserModel>,
) -> String {
    metadata::generate_user_sql(&user, is_new_user, original.as_ref())
}

#[tauri::command]
fn metadata_execute_sql(
    profile: ConnectionProfile,
    sql: String,
    database: Option<String>,
) -> Result<(), String> {
    metadata::execute_sql(&profile, &sql, database.as_deref())
}

#[tauri::command]
fn metadata_get_function_ddl(
    profile: ConnectionProfile,
    database: String,
    name: String,
    routine_type: String,
) -> Result<String, String> {
    metadata::get_function_ddl(&profile, &database, &name, &routine_type)
}

#[tauri::command]
fn metadata_get_routine_params(
    profile: ConnectionProfile,
    database: String,
    name: String,
) -> Result<Vec<metadata::RoutineParam>, String> {
    metadata::get_routine_params(&profile, &database, &name)
}

#[tauri::command]
fn config_load_connections() -> Result<Vec<ConnectionProfile>, String> {
    config::load_connections()
}

#[tauri::command]
fn config_save_connections(profiles: Vec<ConnectionProfile>) -> Result<(), String> {
    config::save_connections(&profiles)
}

#[tauri::command]
fn config_import_connections(file_path: String) -> Result<Vec<ConnectionProfile>, String> {
    config::import_connections(std::path::Path::new(&file_path))
}

#[tauri::command]
fn config_export_connections(
    file_path: String,
    profiles: Vec<ConnectionProfile>,
) -> Result<(), String> {
    config::export_connections(std::path::Path::new(&file_path), &profiles)
}

#[tauri::command]
fn app_config_get(key: String, default_value: String) -> Result<String, String> {
    app_config::get_property(&key, &default_value)
}

#[tauri::command]
fn app_config_set(key: String, value: String) -> Result<(), String> {
    app_config::set_property(&key, &value)
}

#[tauri::command]
fn app_config_flush() -> Result<(), String> {
    app_config::flush()
}

#[tauri::command]
fn favorites_get_all() -> Result<Vec<FavoriteItem>, String> {
    favorites::get_all()
}

#[tauri::command]
fn favorites_get_by_type(favorite_type: FavoriteType) -> Result<Vec<FavoriteItem>, String> {
    favorites::get_by_type(favorite_type)
}

#[tauri::command]
fn favorites_search(keyword: String) -> Result<Vec<FavoriteItem>, String> {
    favorites::search(&keyword)
}

#[tauri::command]
fn favorites_get(id: String) -> Result<Option<FavoriteItem>, String> {
    favorites::get(&id)
}

#[tauri::command]
fn favorites_add(item: FavoriteItem) -> Result<FavoriteItem, String> {
    favorites::add(item)
}

#[tauri::command]
fn favorites_update(item: FavoriteItem) -> Result<(), String> {
    favorites::update(item)
}

#[tauri::command]
fn favorites_remove(id: String) -> Result<(), String> {
    favorites::remove(&id)
}

#[tauri::command]
fn favorites_record_usage(id: String) -> Result<(), String> {
    favorites::record_usage(&id)
}

#[tauri::command]
fn favorites_clear() -> Result<(), String> {
    favorites::clear_all()
}

#[tauri::command]
fn favorites_total() -> Result<i32, String> {
    favorites::total()
}

#[tauri::command]
fn favorites_stats() -> Result<std::collections::HashMap<FavoriteType, i32>, String> {
    favorites::stats()
}

#[tauri::command]
fn sql_format(sql: String, db_type: DbType) -> Result<String, String> {
    sqlutils::format_sql(&sql, db_type)
}

#[tauri::command]
fn sql_extract_view_select(ddl: String, db_type: DbType) -> Result<Option<String>, String> {
    sqlutils::extract_view_select(&ddl, db_type)
}

#[tauri::command]
fn sql_split_statements(sql: String, db_type: DbType) -> Vec<String> {
    sqlutils::split_sql_statements(&sql, db_type)
}

#[tauri::command]
fn sql_split_statements_create(sql: String, db_type: DbType) -> Result<SqlSplitSessionInfo, String> {
    let statements: Vec<String> = sqlutils::split_sql_statements(&sql, db_type)
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let session_id = SQL_SPLIT_SESSION_COUNTER.fetch_add(1, Ordering::SeqCst);
    let total = statements.len() as u64;

    let mut sessions = sql_split_sessions()
        .lock()
        .map_err(|_| "SQL split session lock failed".to_string())?;
    sessions.insert(session_id, statements);

    Ok(SqlSplitSessionInfo { session_id, total })
}

#[tauri::command]
fn sql_split_statements_page(
    session_id: u64,
    page: Option<u64>,
    page_size: Option<u64>,
) -> Result<SqlSplitStatementsPage, String> {
    let safe_page = page.unwrap_or(1).max(1);
    let safe_page_size = page_size
        .unwrap_or(SQL_SPLIT_PAGE_SIZE_DEFAULT)
        .clamp(1, SQL_SPLIT_PAGE_SIZE_MAX);

    let sessions = sql_split_sessions()
        .lock()
        .map_err(|_| "SQL split session lock failed".to_string())?;
    let statements = sessions
        .get(&session_id)
        .ok_or_else(|| "SQL split session not found".to_string())?;

    let total = statements.len() as u64;
    let total_pages = if total == 0 {
        0
    } else {
        total.div_ceil(safe_page_size)
    };

    let start = ((safe_page - 1) * safe_page_size) as usize;
    let end = (start + safe_page_size as usize).min(statements.len());

    let page_statements = if start >= statements.len() {
        Vec::new()
    } else {
        statements[start..end].to_vec()
    };

    Ok(SqlSplitStatementsPage {
        statements: page_statements,
        page: safe_page,
        page_size: safe_page_size,
        total,
        total_pages,
        has_more: end < statements.len(),
    })
}

#[tauri::command]
fn sql_split_statements_release(session_id: u64) -> bool {
    if let Ok(mut sessions) = sql_split_sessions().lock() {
        sessions.remove(&session_id).is_some()
    } else {
        false
    }
}

#[tauri::command]
fn json_parse_canonical(json: String) -> Result<String, String> {
    json_mod::parse_to_canonical_json(&json)
}

// Legacy import/export commands for backward compatibility
#[tauri::command]
fn import_from_csv(
    profile: ConnectionProfile,
    database: String,
    table: String,
    file_path: String,
) -> import_mod::ImportResult {
    import_mod::import_from_csv(
        &profile,
        &database,
        &table,
        std::path::Path::new(&file_path),
    )
}

#[tauri::command]
fn import_from_json(
    profile: ConnectionProfile,
    database: String,
    table: String,
    file_path: String,
) -> import_mod::ImportResult {
    import_mod::import_from_json(
        &profile,
        &database,
        &table,
        std::path::Path::new(&file_path),
    )
}

#[tauri::command]
fn import_from_jsonl(
    profile: ConnectionProfile,
    database: String,
    table: String,
    file_path: String,
) -> import_mod::ImportResult {
    import_mod::import_from_jsonl(
        &profile,
        &database,
        &table,
        std::path::Path::new(&file_path),
    )
}

// New unified import command
#[tauri::command]
fn import_table(
    profile: ConnectionProfile,
    database: String,
    table: String,
    file_path: String,
    format: String,
) -> import_mod::ImportResult {
    let import_format =
        import_mod::ImportFormat::from_str(&format).unwrap_or(import_mod::ImportFormat::Csv);
    import_mod::import_table(
        &profile,
        &database,
        &table,
        std::path::Path::new(&file_path),
        import_format,
    )
}

#[tauri::command]
fn export_to_csv(
    profile: ConnectionProfile,
    database: String,
    table: String,
    file_path: String,
) -> export_mod::ExportResult {
    export_mod::export_table_to_csv(
        &profile,
        &database,
        &table,
        std::path::Path::new(&file_path),
    )
}

#[tauri::command]
fn export_to_jsonl(
    profile: ConnectionProfile,
    database: String,
    table: String,
    file_path: String,
) -> export_mod::ExportResult {
    export_mod::export_table_to_jsonl(
        &profile,
        &database,
        &table,
        std::path::Path::new(&file_path),
    )
}

// New unified export commands
#[tauri::command]
fn export_table(
    profile: ConnectionProfile,
    database: String,
    table: String,
    file_path: String,
    format: String,
) -> export_mod::ExportResult {
    let export_format =
        export_mod::ExportFormat::from_str(&format).unwrap_or(export_mod::ExportFormat::Csv);
    export_mod::export_table(
        &profile,
        &database,
        &table,
        std::path::Path::new(&file_path),
        export_format,
    )
}

#[tauri::command]
fn export_query_result(
    file_path: String,
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
    format: String,
    table_name: Option<String>,
) -> Result<export_mod::ExportResult, String> {
    let export_format =
        export_mod::ExportFormat::from_str(&format).unwrap_or(export_mod::ExportFormat::Csv);

    if file_path.trim().is_empty() {
        return Err("导出路径不能为空".to_string());
    }

    let path = std::path::Path::new(&file_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建导出目录失败: {e}"))?;
        }
    }

    export_mod::export_query_result(path, &headers, &rows, export_format, table_name.as_deref())
}

// Legacy export command for backward compatibility
#[tauri::command]
fn export_query_result_csv(
    file_path: String,
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
) -> Result<CsvExportInfo, String> {
    if file_path.trim().is_empty() {
        return Err("导出路径不能为空".to_string());
    }

    let path = std::path::Path::new(&file_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建导出目录失败: {e}"))?;
        }
    }

    let mut file = std::fs::File::create(path).map_err(|e| format!("创建CSV文件失败: {e}"))?;

    file.write_all(b"\xEF\xBB\xBF")
        .map_err(|e| format!("写入CSV编码头失败: {e}"))?;

    let mut writer = csv::WriterBuilder::new()
        .has_headers(false)
        .from_writer(file);

    writer
        .write_record(headers.iter())
        .map_err(|e| format!("写入CSV表头失败: {e}"))?;

    for row in &rows {
        writer
            .write_record(row.iter())
            .map_err(|e| format!("写入CSV数据失败: {e}"))?;
    }

    writer
        .flush()
        .map_err(|e| format!("刷新CSV文件失败: {e}"))?;

    Ok(CsvExportInfo {
        file_path,
        exported_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        row_count: rows.len(),
    })
}

#[tauri::command]
fn backup_execute(req: backup::BackupRequest) -> Result<backup::BackupResult, String> {
    backup::backup_execute(req)
}

#[tauri::command]
fn restore_execute(req: backup::RestoreRequest) -> Result<backup::RestoreResult, String> {
    backup::restore_execute(req)
}

#[tauri::command]
fn incremental_backup(
    req: backup::IncrementalRequest,
) -> Result<backup::IncrementalResult, String> {
    backup::incremental_backup(req)
}

#[tauri::command]
fn schedule_add(req: backup::ScheduleRequest) -> Result<bool, String> {
    backup::schedule_add(req)
}

#[tauri::command]
fn schedule_remove(schedule_id: String) -> Result<bool, String> {
    backup::schedule_remove(&schedule_id)
}

#[tauri::command]
fn schedule_list() -> Result<Vec<String>, String> {
    backup::schedule_list()
}

#[tauri::command]
fn executor_init(core_threads: u32, max_threads: u32, queue_capacity: u32) -> Result<bool, String> {
    executor::init(core_threads, max_threads, queue_capacity)
}

#[tauri::command]
fn executor_submit(app_handle: tauri::AppHandle, context_id: i64) -> Result<bool, String> {
    executor::submit(app_handle, context_id)
}

#[tauri::command]
fn executor_shutdown() -> Result<bool, String> {
    executor::shutdown()
}

#[tauri::command]
async fn updater_check_by_region(app_handle: tauri::AppHandle) -> Result<RegionUpdateInfo, String> {
    let country_code = get_or_detect_country_code().await;
    let (preferred_source, endpoint_strings) = updater_endpoints_for_country(country_code.as_deref());
    let endpoints = parse_update_endpoints(&endpoint_strings)?;

    let updater = app_handle
        .updater_builder()
        .timeout(Duration::from_secs(3))
        .endpoints(endpoints)
        .map_err(|e| format!("Configure updater endpoints failed: {e}"))?
        .build()
        .map_err(|e| format!("Build updater failed: {e}"))?;

    match updater.check().await {
        Ok(Some(update)) => Ok(RegionUpdateInfo {
            available: true,
            version: Some(update.version),
            date: update.date.map(|d| d.to_string()),
            body: update.body,
            preferred_source,
            country_code,
        }),
        Ok(None) => Ok(RegionUpdateInfo {
            available: false,
            version: None,
            date: None,
            body: None,
            preferred_source,
            country_code,
        }),
        Err(e) => Err(format!("Check update failed: {e}")),
    }
}

#[tauri::command]
async fn updater_download_and_install_by_region(
    app_handle: tauri::AppHandle,
    window: tauri::Window,
) -> Result<(), String> {
    let country_code = get_or_detect_country_code().await;
    let (_, endpoint_strings) = updater_endpoints_for_country(country_code.as_deref());
    let endpoints = parse_update_endpoints(&endpoint_strings)?;

    let updater = app_handle
        .updater_builder()
        .timeout(Duration::from_secs(3))
        .endpoints(endpoints)
        .map_err(|e| format!("Configure updater endpoints failed: {e}"))?
        .build()
        .map_err(|e| format!("Build updater failed: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Check update failed: {e}"))?
        .ok_or_else(|| "No update available".to_string())?;

    let progress_state = Arc::new(Mutex::new(UpdaterDownloadProgressState {
        started: false,
        downloaded: 0,
        total: None,
    }));

    let window_for_progress = window.clone();
    let window_for_finish = window.clone();
    let progress_state_for_progress = Arc::clone(&progress_state);
    let progress_state_for_finish = Arc::clone(&progress_state);

    update
        .download_and_install(
            move |chunk_len, content_len| {
                let mut state = match progress_state_for_progress.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };

                if !state.started {
                    state.started = true;
                    state.total = content_len;
                    let _ = window_for_progress.emit(
                        "updater-download-progress",
                        UpdaterDownloadProgressEvent {
                            event: "Started".to_string(),
                            content_length: content_len,
                            chunk_length: None,
                            downloaded: state.downloaded,
                            total: content_len,
                            percentage: Some(0),
                        },
                    );
                }

                state.downloaded = state.downloaded.saturating_add(chunk_len as u64);
                let percentage = state
                    .total
                    .filter(|t| *t > 0)
                    .map(|t| ((state.downloaded.saturating_mul(100)) / t).min(100) as u8);

                let _ = window_for_progress.emit(
                    "updater-download-progress",
                    UpdaterDownloadProgressEvent {
                        event: "Progress".to_string(),
                        content_length: state.total,
                        chunk_length: Some(chunk_len as u64),
                        downloaded: state.downloaded,
                        total: state.total,
                        percentage,
                    },
                );
            },
            move || {
                let (downloaded, total) = match progress_state_for_finish.lock() {
                    Ok(state) => (state.downloaded, state.total),
                    Err(_) => (0, None),
                };

                let _ = window_for_finish.emit(
                    "updater-download-progress",
                    UpdaterDownloadProgressEvent {
                        event: "Finished".to_string(),
                        content_length: total,
                        chunk_length: None,
                        downloaded,
                        total,
                        percentage: Some(100),
                    },
                );
            },
        )
        .await
        .map_err(|e| format!("Download and install failed: {e}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            tauri::async_runtime::spawn(async move {
                warmup_country_detection_cache().await;
            });
            Ok(())
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            pool_create,
            pool_get_connection,
            pool_set_database,
            pool_release_connection,
            pool_test_connection,
            pool_get_stats,
            pool_get_detailed_stats,
            pool_get_active_connections,
            pool_get_all_active_connections,
            pool_get_connection_properties,
            pool_query,
            pool_query_page,
            pool_query_multi,
            pool_execute,
            pool_query_prepared,
            pool_query_prepared_multi,
            pool_execute_prepared,
            pool_close,
            pool_close_all,
            metadata_list_databases,
            metadata_list_tables,
            metadata_list_table_details,
            metadata_list_views,
            metadata_list_view_details,
            metadata_list_functions,
            metadata_list_routines_with_details,
            metadata_list_function_details,
            metadata_list_columns,
            metadata_list_foreign_keys,
            metadata_get_er_diagram_data,
            metadata_export_er_diagram_sql,
            metadata_list_indexes,
            metadata_list_triggers,
            metadata_list_checks,
            metadata_load_ddl,
            metadata_get_current_user_info,
            metadata_get_all_users,
            metadata_get_user_detail,
            metadata_get_user_model,
            metadata_get_all_databases,
            metadata_generate_user_sql,
            metadata_execute_sql,
            metadata_get_function_ddl,
            metadata_get_routine_params,
            config_load_connections,
            config_save_connections,
            config_import_connections,
            config_export_connections,
            app_config_get,
            app_config_set,
            app_config_flush,
            favorites_get_all,
            favorites_get_by_type,
            favorites_search,
            favorites_get,
            favorites_add,
            favorites_update,
            favorites_remove,
            favorites_record_usage,
            favorites_clear,
            favorites_total,
            favorites_stats,
            sql_format,
            sql_extract_view_select,
            sql_split_statements,
            sql_split_statements_create,
            sql_split_statements_page,
            sql_split_statements_release,
            json_parse_canonical,
            import_from_csv,
            import_from_json,
            import_from_jsonl,
            import_table,
            export_to_csv,
            export_to_jsonl,
            export_table,
            export_query_result,
            export_query_result_csv,
            backup_execute,
            restore_execute,
            incremental_backup,
            schedule_add,
            schedule_remove,
            schedule_list,
            executor_init,
            executor_submit,
            executor_shutdown,
            updater_check_by_region,
            updater_download_and_install_by_region
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
