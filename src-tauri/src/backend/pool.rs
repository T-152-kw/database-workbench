use crate::backend::models::{ConnectionProfile, SqlParam};
use crate::backend::ssl::{
    apply_ssl_mode_to_builder, parse_ssl_mode, ssl_mode_to_session_value, SslMode,
};
use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use dashmap::DashMap;
use deadpool::managed::{Manager, Metrics, Object, Pool, RecycleError, RecycleResult, Timeouts};
use deadpool::Runtime as DeadpoolRuntime;
use mysql::params;
use mysql::prelude::*;
use mysql::{Conn, Opts, OptsBuilder, Params, Value};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::runtime::Runtime;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::interval;

static POOL_MANAGER: Lazy<RwLock<PoolManager>> = Lazy::new(|| RwLock::new(PoolManager::new()));
static TOKIO_RUNTIME: Lazy<Runtime> = Lazy::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .enable_time()
        .build()
        .expect("Failed to build tokio runtime")
});

// NEW: 全局心跳管理器，默认 30 秒间隔（类似 Navicat）
static KEEPALIVE_MANAGER: Lazy<KeepaliveManager> = Lazy::new(|| KeepaliveManager::new(30));

static CONN_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
static POOL_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Deserialize)]
pub struct PoolConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: Option<String>,
    pub charset: Option<String>,
    pub collation: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub ssl_mode: Option<String>,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub max_pool_size: Option<usize>,
    pub min_idle: Option<usize>,
    pub idle_timeout_ms: Option<u64>,
    pub max_lifetime_ms: Option<u64>,
    pub connection_timeout_ms: Option<u64>,
    pub create_timeout_ms: Option<u64>,
    pub recycle_timeout_ms: Option<u64>,
    pub current_database: Option<String>, // NEW: 跟踪当前数据库
    pub keepalive_interval_secs: Option<u64>, // NEW: 心跳间隔（秒），默认 30
    pub auto_reconnect: bool,             // NEW: 自动重连，默认 false（安全优先）
}

impl PoolConfig {
    pub fn from_profile(profile: &ConnectionProfile) -> Self {
        Self {
            host: profile.host.clone(),
            port: profile.port,
            username: profile.username.clone(),
            password: profile.password.clone(),
            database: profile.database.clone(),
            charset: profile.charset.clone(),
            collation: profile.collation.clone(),
            timeout_seconds: profile.timeout, // 空闲超时（wait_timeout）
            ssl_mode: profile.ssl_mode.clone(),
            ssl_ca_path: profile.ssl_ca_path.clone(),
            ssl_cert_path: profile.ssl_cert_path.clone(),
            ssl_key_path: profile.ssl_key_path.clone(),
            max_pool_size: Some(10),
            min_idle: Some(2),
            idle_timeout_ms: Some(600_000),
            max_lifetime_ms: Some(1_800_000),
            // MODIFIED: 使用 profile 中的 connection_timeout，默认 30 秒
            connection_timeout_ms: Some(profile.connection_timeout.unwrap_or(30) * 1000),
            create_timeout_ms: None,
            recycle_timeout_ms: None,
            current_database: profile.database.clone(), // NEW: 使用 profile 中的数据库作为初始值
            keepalive_interval_secs: Some(30),          // NEW: 默认 30 秒心跳间隔（类似 Navicat）
            auto_reconnect: profile.auto_reconnect.unwrap_or(false), // NEW: 默认 false（安全优先）
        }
    }

    pub fn connection_key(&self) -> String {
        format!(
            "{}:{}:{}:{}:{}:{}",
            self.host,
            self.port,
            self.username,
            self.password,
            self.ssl_mode.as_deref().unwrap_or(""),
            self.ssl_ca_path.as_deref().unwrap_or("")
        )
    }
}

struct MysqlManager {
    opts: Opts,
    fallback_opts: Option<Opts>,
    init_sqls: Vec<String>,
}

#[async_trait]
impl Manager for MysqlManager {
    type Type = Conn;
    type Error = mysql::Error;

    async fn create(&self) -> Result<Self::Type, Self::Error> {
        let mut conn = match Conn::new(self.opts.clone()) {
            Ok(conn) => conn,
            Err(primary_err) => {
                if let Some(fallback_opts) = &self.fallback_opts {
                    Conn::new(fallback_opts.clone()).map_err(|_| primary_err)?
                } else {
                    return Err(primary_err);
                }
            }
        };

        for sql in &self.init_sqls {
            if let Err(err) = conn.query_drop(sql) {
                if sql.starts_with("SET SESSION ssl_mode") {
                    continue;
                }
                return Err(err);
            }
        }

        Ok(conn)
    }

    async fn recycle(&self, conn: &mut Self::Type, _: &Metrics) -> RecycleResult<Self::Error> {
        conn.query_drop("SELECT 1").map_err(RecycleError::Backend)
    }
}

type DeadpoolObject = Object<MysqlManager>;

// NEW: 连接状态结构体，跟踪连接和当前数据库
struct ConnectionState {
    conn: DeadpoolObject,
    current_database: Option<String>,
    created_at: u64,         // NEW: 连接创建时间戳
    use_count: AtomicU64,    // NEW: 连接使用次数
    last_used_at: AtomicU64, // NEW: 最后使用时间戳
    // NEW: 安全检测状态跟踪
    in_transaction: AtomicU64,       // 事务嵌套计数（0表示不在事务中）
    has_temporary_tables: AtomicU64, // 临时表计数
    auto_reconnect: bool,            // 此连接是否启用自动重连
}

impl ConnectionState {
    fn new(conn: DeadpoolObject, current_database: Option<String>, auto_reconnect: bool) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        Self {
            conn,
            current_database,
            created_at: now,
            use_count: AtomicU64::new(0),
            last_used_at: AtomicU64::new(now),
            in_transaction: AtomicU64::new(0),
            has_temporary_tables: AtomicU64::new(0),
            auto_reconnect,
        }
    }

    // NEW: 记录连接使用
    fn record_use(&self) {
        self.use_count.fetch_add(1, Ordering::SeqCst);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.last_used_at.store(now, Ordering::SeqCst);
    }

    // NEW: 检查是否可以安全重连
    fn can_safely_reconnect(&self) -> (bool, Option<String>) {
        // 检查是否启用自动重连
        if !self.auto_reconnect {
            return (
                false,
                Some("Auto-reconnect is disabled for this connection".to_string()),
            );
        }

        // 检查是否在事务中
        let txn_count = self.in_transaction.load(Ordering::SeqCst);
        if txn_count > 0 {
            return (false, Some(format!("Active transaction detected (nesting level: {}). Auto-reconnect disabled to prevent data inconsistency.", txn_count)));
        }

        // 检查是否有临时表
        let temp_table_count = self.has_temporary_tables.load(Ordering::SeqCst);
        if temp_table_count > 0 {
            return (false, Some(format!("Temporary tables exist (count: {}). Auto-reconnect disabled to prevent data loss.", temp_table_count)));
        }

        (true, None)
    }

    // NEW: 开始事务（预留方法，用于未来跟踪事务状态）
    #[allow(dead_code)]
    fn begin_transaction(&self) {
        self.in_transaction.fetch_add(1, Ordering::SeqCst);
    }

    // NEW: 提交/回滚事务（预留方法，用于未来跟踪事务状态）
    #[allow(dead_code)]
    fn end_transaction(&self) {
        let current = self.in_transaction.load(Ordering::SeqCst);
        if current > 0 {
            self.in_transaction.fetch_sub(1, Ordering::SeqCst);
        }
    }

    // NEW: 创建临时表（预留方法，用于未来跟踪临时表状态）
    #[allow(dead_code)]
    fn add_temporary_table(&self) {
        self.has_temporary_tables.fetch_add(1, Ordering::SeqCst);
    }

    // NEW: 删除临时表（预留方法，用于未来跟踪临时表状态）
    #[allow(dead_code)]
    fn remove_temporary_table(&self) {
        let current = self.has_temporary_tables.load(Ordering::SeqCst);
        if current > 0 {
            self.has_temporary_tables.fetch_sub(1, Ordering::SeqCst);
        }
    }

    #[allow(dead_code)]
    fn get_stats(&self) -> ConnectionUsageStats {
        ConnectionUsageStats {
            use_count: self.use_count.load(Ordering::SeqCst),
            created_at: self.created_at,
            last_used_at: self.last_used_at.load(Ordering::SeqCst),
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct ConnectionUsageStats {
    pub use_count: u64,
    pub created_at: u64,
    pub last_used_at: u64,
}

// NEW: 心跳任务管理器
struct KeepaliveTask {
    handle: JoinHandle<()>,
}

struct KeepaliveManager {
    tasks: Mutex<DashMap<u64, KeepaliveTask>>,
    default_interval_secs: AtomicU64,
}

impl KeepaliveManager {
    fn new(default_interval_secs: u64) -> Self {
        Self {
            tasks: Mutex::new(DashMap::new()),
            default_interval_secs: AtomicU64::new(default_interval_secs),
        }
    }

    // 设置默认心跳间隔
    fn set_default_interval(&self, interval_secs: u64) {
        self.default_interval_secs
            .store(interval_secs, Ordering::SeqCst);
    }

    // 启动指定连接的心跳任务
    fn start(&self, pool_id: u64, conn_id: u64, custom_interval_secs: Option<u64>) {
        let interval_secs = custom_interval_secs
            .unwrap_or_else(|| self.default_interval_secs.load(Ordering::SeqCst));

        // 如果已存在该连接的心跳任务，先停止
        self.stop(conn_id);

        let handle = TOKIO_RUNTIME.spawn(async move {
            let mut ticker = interval(Duration::from_secs(interval_secs));
            
            loop {
                ticker.tick().await;
                
                // 获取连接池管理器
                let manager = match POOL_MANAGER.read() {
                    Ok(m) => m,
                    Err(_) => {
                        eprintln!("Keepalive: Failed to get pool manager");
                        break;
                    }
                };
                
                // 获取连接池
                let pool = match manager.get_pool(pool_id) {
                    Some(p) => p,
                    None => {
                        println!("Keepalive: Pool {} not found, stopping heartbeat for conn {}", pool_id, conn_id);
                        break;
                    }
                };
                
                // 执行心跳检测
                let should_stop = {
                    if let Some(mut entry) = pool.in_use.get_mut(&conn_id) {
                        match entry.conn.query_drop("SELECT 1") {
                            Ok(_) => {
                                // 心跳成功，继续
                                false
                            }
                            Err(err) => {
                                let err_str = err.to_string();
                                if is_connection_lost_error(&err_str) {
                                    // NEW: 检查是否可以安全重连
                                    let (can_reconnect, reconnect_reason) = entry.can_safely_reconnect();
                                    if !can_reconnect {
                                        let reason = reconnect_reason.unwrap_or_else(|| "Unknown safety check failure".to_string());
                                        eprintln!("[WARN] Keepalive: Auto-reconnect blocked for connection {}: {}", conn_id, reason);
                                        drop(entry);
                                        pool.in_use.remove(&conn_id);
                                        true // 停止心跳
                                    } else {
                                        // 连接已断开，尝试重连并恢复上下文
                                        let current_db = entry.current_database.clone();
                                        drop(entry); // 释放锁
                                        
                                        // 移除旧连接
                                        pool.in_use.remove(&conn_id);
                                        
                                        // 获取新连接
                                        match TOKIO_RUNTIME.block_on(pool.pool.get()) {
                                            Ok(new_conn) => {
                                                // 恢复数据库上下文
                                                let mut temp_conn = new_conn;
                                                let mut restored = true;
                                                if let Some(ref db) = current_db {
                                                    if let Err(e) = temp_conn.query_drop(format!("USE `{}`", escape_identifier(db))) {
                                                        eprintln!("Keepalive: Failed to restore database context '{}': {}", db, e);
                                                        restored = false;
                                                    }
                                                }
                                                
                                                if restored {
                                                    let new_state = ConnectionState::new(temp_conn, current_db.clone(), pool.auto_reconnect);
                                                    pool.in_use.insert(conn_id, new_state);
                                                    println!("Keepalive: Connection {} restored successfully", conn_id);
                                                    false // 继续心跳
                                                } else {
                                                    true // 停止心跳
                                                }
                                            }
                                            Err(e) => {
                                                eprintln!("Keepalive: Failed to reconnect connection {}: {}", conn_id, e);
                                                true // 停止心跳
                                            }
                                        }
                                    }
                                } else {
                                    // 其他错误，记录但继续
                                    eprintln!("Keepalive: Heartbeat failed for connection {}: {}", conn_id, err_str);
                                    false
                                }
                            }
                        }
                    } else {
                        // 连接不存在了，停止心跳
                        println!("Keepalive: Connection {} not found, stopping heartbeat", conn_id);
                        true
                    }
                };
                
                if should_stop {
                    break;
                }
            }
            
            // 清理任务记录（从全局 KEEPALIVE_MANAGER）
            KEEPALIVE_MANAGER.stop(conn_id);
        });

        let task = KeepaliveTask { handle };
        TOKIO_RUNTIME.block_on(async {
            let tasks = self.tasks.lock().await;
            tasks.insert(conn_id, task);
        });
    }

    // 停止指定连接的心跳任务
    fn stop(&self, conn_id: u64) {
        TOKIO_RUNTIME.block_on(async {
            let tasks = self.tasks.lock().await;
            if let Some((_, task)) = tasks.remove(&conn_id) {
                task.handle.abort();
            }
        });
    }

    // 停止所有心跳任务
    fn stop_all(&self) {
        TOKIO_RUNTIME.block_on(async {
            let tasks = self.tasks.lock().await;
            // 收集所有任务句柄
            let handles: Vec<_> = tasks.iter().map(|e| e.value().handle.abort()).collect();
            drop(handles); // 确保所有 abort 调用完成
            drop(tasks); // 释放锁
            self.tasks.lock().await.clear();
        });
    }
}

struct ConnectionPool {
    pool_id: u64,
    pool: Pool<MysqlManager>,
    in_use: DashMap<u64, ConnectionState>, // MODIFIED: 使用 ConnectionState 替代 DeadpoolObject
    auto_reconnect: bool,                  // NEW: 此连接池的自动重连配置
}

impl ConnectionPool {
    fn new(pool_id: u64, config: PoolConfig) -> Result<Self, String> {
        let max_size = config.max_pool_size.unwrap_or(10);
        let min_idle = config.min_idle.unwrap_or(0);

        if min_idle > max_size {
            return Err("min_idle cannot be greater than max_pool_size".to_string());
        }

        let mut builder = OptsBuilder::new()
            .ip_or_hostname(Some(config.host.clone()))
            .tcp_port(config.port)
            .user(Some(config.username.clone()))
            .pass(Some(config.password.clone()));

        if let Some(db) = &config.database {
            if !db.trim().is_empty() {
                builder = builder.db_name(Some(db.clone()));
            }
        }

        builder = builder.prefer_socket(false).stmt_cache_size(250);

        let ssl_mode = parse_ssl_mode(config.ssl_mode.as_deref());
        let fallback_opts = if matches!(ssl_mode, SslMode::Preferred) {
            Some(Opts::from(builder.clone()))
        } else {
            None
        };

        builder = apply_ssl_mode_to_builder(
            builder,
            &ConnectionProfile {
                name: None,
                host: config.host.clone(),
                port: config.port,
                username: config.username.clone(),
                password: config.password.clone(),
                database: config.database.clone(),
                charset: config.charset.clone(),
                collation: config.collation.clone(),
                timeout: config.timeout_seconds,
                connection_timeout: config.connection_timeout_ms.map(|ms| ms / 1000),
                auto_reconnect: Some(config.auto_reconnect), // NEW: 传递自动重连配置
                ssl: None,
                ssl_mode: config.ssl_mode.clone(),
                ssl_ca_path: config.ssl_ca_path.clone(),
                ssl_cert_path: config.ssl_cert_path.clone(),
                ssl_key_path: config.ssl_key_path.clone(),
            },
        )?;

        let init_sqls = build_session_init_sql(&config);

        let manager = MysqlManager {
            opts: Opts::from(builder),
            fallback_opts,
            init_sqls,
        };

        let (wait_ms, create_ms, recycle_ms) = derive_timeouts(&config);

        let mut timeouts = Timeouts::default();
        if let Some(ms) = wait_ms.filter(|v| *v > 0) {
            timeouts.wait = Some(Duration::from_millis(ms));
        }
        if let Some(ms) = create_ms.filter(|v| *v > 0) {
            timeouts.create = Some(Duration::from_millis(ms));
        }
        if let Some(ms) = recycle_ms.filter(|v| *v > 0) {
            timeouts.recycle = Some(Duration::from_millis(ms));
        }

        let pool = Pool::builder(manager)
            .max_size(max_size)
            .timeouts(timeouts)
            .runtime(DeadpoolRuntime::Tokio1)
            .build()
            .map_err(|e| format!("Failed to build pool: {e}"))?;

        if min_idle > 0 {
            let mut warm = Vec::with_capacity(min_idle);
            for _ in 0..min_idle {
                let conn = TOKIO_RUNTIME
                    .block_on(pool.get())
                    .map_err(|e| format!("Failed to warm connection: {e}"))?;
                warm.push(conn);
            }
        }

        let _ = config
            .idle_timeout_ms
            .filter(|ms| *ms > 0)
            .map(Duration::from_millis);
        let _ = config
            .max_lifetime_ms
            .filter(|ms| *ms > 0)
            .map(Duration::from_millis);

        Ok(Self {
            pool_id,
            pool,
            in_use: DashMap::new(),
            auto_reconnect: config.auto_reconnect, // NEW: 保存自动重连配置
        })
    }

    fn get_connection(&self, initial_database: Option<String>) -> Result<u64, String> {
        let conn = TOKIO_RUNTIME
            .block_on(self.pool.timeout_get(&self.pool.timeouts()))
            .map_err(|e| format!("Failed to get connection: {e}"))?;
        let conn_id = CONN_ID_COUNTER.fetch_add(1, Ordering::SeqCst);
        // NEW: 使用 ConnectionState::new 创建连接状态，传入 auto_reconnect 配置
        let state = ConnectionState::new(conn, initial_database, self.auto_reconnect);
        self.in_use.insert(conn_id, state);
        Ok(conn_id)
    }

    // NEW: 获取活跃连接列表
    fn get_active_connections(&self) -> Vec<ActiveConnectionInfo> {
        self.in_use
            .iter()
            .map(|entry| ActiveConnectionInfo {
                conn_id: *entry.key(),
                pool_id: self.pool_id,
                current_database: entry.value().current_database.clone(),
                created_at: entry.value().created_at,
            })
            .collect()
    }

    fn release_connection(&self, conn_id: u64) -> Result<(), String> {
        if self.in_use.remove(&conn_id).is_some() {
            Ok(())
        } else {
            Err("Connection not found".to_string())
        }
    }

    fn with_connection<T, F>(&self, conn_id: u64, mut action: F) -> Result<T, String>
    where
        F: FnMut(&mut Conn) -> Result<T, String>,
    {
        // MODIFIED: 先保存当前数据库状态，以便重连后恢复
        // MODIFIED: 获取当前数据库和检查是否可以安全重连
        let (current_db, can_reconnect, reconnect_reason) = {
            let entry = self
                .in_use
                .get(&conn_id)
                .ok_or_else(|| "Connection not found".to_string())?;
            let (can_reconnect, reason) = entry.can_safely_reconnect();
            (entry.current_database.clone(), can_reconnect, reason)
        };

        let should_reconnect_before_action = {
            let mut entry = self
                .in_use
                .get_mut(&conn_id)
                .ok_or_else(|| "Connection not found".to_string())?;

            match entry.conn.query_drop("SELECT 1") {
                Ok(_) => false,
                Err(err) => {
                    let probe_error = err.to_string();
                    if !is_connection_lost_error(&probe_error) {
                        return Err(format!("Connection health check failed: {probe_error}"));
                    }
                    true
                }
            }
        };

        if should_reconnect_before_action {
            // NEW: 检查是否可以安全重连
            if !can_reconnect {
                let reason =
                    reconnect_reason.unwrap_or_else(|| "Unknown safety check failure".to_string());
                eprintln!(
                    "[WARN] Auto-reconnect blocked for connection {}: {}",
                    conn_id, reason
                );
                return Err(format!(
                    "Connection lost and auto-reconnect is disabled: {}. Please check your connection and retry manually.",
                    reason
                ));
            }

            self.in_use.remove(&conn_id);

            let new_conn = TOKIO_RUNTIME
                .block_on(self.pool.timeout_get(&self.pool.timeouts()))
                .map_err(|e| format!("Connection was stale and reconnection failed: {e}"))?;

            // NEW: 恢复数据库上下文
            if let Some(ref db) = current_db {
                let mut temp_conn = new_conn;
                if let Err(err) = temp_conn.query_drop(format!("USE `{}`", escape_identifier(db))) {
                    return Err(format!(
                        "Reconnected but failed to restore database context '{}': {}",
                        db, err
                    ));
                }
                let state = ConnectionState::new(temp_conn, Some(db.clone()), self.auto_reconnect);
                self.in_use.insert(conn_id, state);
            } else {
                let state = ConnectionState::new(new_conn, None, self.auto_reconnect);
                self.in_use.insert(conn_id, state);
            }
        }

        let first_error = {
            let mut entry = self
                .in_use
                .get_mut(&conn_id)
                .ok_or_else(|| "Connection not found".to_string())?;

            match action(&mut entry.conn) {
                Ok(result) => return Ok(result),
                Err(err) => {
                    if !is_connection_lost_error(&err) {
                        return Err(err);
                    }
                    err
                }
            }
        };

        // NEW: 再次检查是否可以安全重连（第二次重连前）
        let (can_reconnect2, reconnect_reason2) = {
            let entry = self
                .in_use
                .get(&conn_id)
                .ok_or_else(|| "Connection not found".to_string())?;
            entry.can_safely_reconnect()
        };

        if !can_reconnect2 {
            let reason =
                reconnect_reason2.unwrap_or_else(|| "Unknown safety check failure".to_string());
            eprintln!(
                "[WARN] Auto-reconnect blocked for connection {} on retry: {}",
                conn_id, reason
            );
            return Err(format!(
                "Connection lost and auto-reconnect is disabled: {}. Original error: {}. Please check your connection and retry manually.",
                reason, first_error
            ));
        }

        self.in_use.remove(&conn_id);

        let new_conn = TOKIO_RUNTIME
            .block_on(self.pool.timeout_get(&self.pool.timeouts()))
            .map_err(|e| {
                format!(
                    "Connection was lost and reconnection failed: {first_error}; reconnect error: {e}"
                )
            })?;

        // NEW: 恢复数据库上下文（第二次重连）
        if let Some(ref db) = current_db {
            let mut temp_conn = new_conn;
            if let Err(err) = temp_conn.query_drop(format!("USE `{}`", escape_identifier(db))) {
                return Err(format!(
                    "Reconnected but failed to restore database context '{}': {}",
                    db, err
                ));
            }
            let state = ConnectionState::new(temp_conn, Some(db.clone()), self.auto_reconnect);
            self.in_use.insert(conn_id, state);
        } else {
            let state = ConnectionState::new(new_conn, None, self.auto_reconnect);
            self.in_use.insert(conn_id, state);
        }

        let mut entry = self
            .in_use
            .get_mut(&conn_id)
            .ok_or_else(|| "Reconnected connection not found".to_string())?;

        // NEW: 记录连接使用
        entry.record_use();

        action(&mut entry.conn).map_err(|retry_err| {
            format!("Connection was reset after error: {first_error}; retry failed: {retry_err}")
        })
    }

    fn with_pooled_connection<T, F>(&self, action: F) -> Result<T, String>
    where
        F: FnOnce(&mut Conn) -> Result<T, String>,
    {
        let mut conn = TOKIO_RUNTIME
            .block_on(self.pool.timeout_get(&self.pool.timeouts()))
            .map_err(|e| format!("Failed to get pooled connection: {e}"))?;
        action(&mut conn)
    }

    #[allow(dead_code)]
    fn detect_connection_leaks(&self, max_idle_secs: u64) -> Vec<u64> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        self.in_use
            .iter()
            .filter(|entry| {
                let last_used = entry.value().last_used_at.load(Ordering::SeqCst);
                now - last_used > max_idle_secs
            })
            .map(|entry| *entry.key())
            .collect()
    }

    fn get_stats(&self) -> PoolStats {
        let status = self.pool.status();
        let total = status.size;
        let idle = status.available;
        let active = total.saturating_sub(idle);

        PoolStats {
            pool_id: self.pool_id,
            total_connections: total,
            active_connections: active,
            idle_connections: idle,
            max_size: status.max_size,
            waiting_threads: status.waiting,
        }
    }

    fn close(&self) {
        self.in_use.clear();
        self.pool.close();
    }
}

struct PoolManager {
    pools: DashMap<u64, Arc<ConnectionPool>>,
    connection_key_to_pool_id: DashMap<String, u64>,
}

impl PoolManager {
    fn new() -> Self {
        Self {
            pools: DashMap::new(),
            connection_key_to_pool_id: DashMap::new(),
        }
    }

    fn create_pool(&self, config: PoolConfig) -> Result<u64, String> {
        let pool_id = POOL_ID_COUNTER.fetch_add(1, Ordering::SeqCst);
        let pool = ConnectionPool::new(pool_id, config.clone())?;
        self.pools.insert(pool_id, Arc::new(pool));
        self.connection_key_to_pool_id
            .insert(config.connection_key(), pool_id);
        Ok(pool_id)
    }

    fn get_pool(&self, pool_id: u64) -> Option<Arc<ConnectionPool>> {
        self.pools.get(&pool_id).map(|p| Arc::clone(&*p))
    }

    fn get_or_create_pool(&self, config: PoolConfig) -> Result<u64, String> {
        let key = config.connection_key();
        if let Some(pool_id) = self.connection_key_to_pool_id.get(&key).map(|v| *v) {
            if self.pools.contains_key(&pool_id) {
                return Ok(pool_id);
            }
        }
        self.create_pool(config)
    }

    fn close_pool(&self, pool_id: u64) {
        if let Some((_, pool)) = self.pools.remove(&pool_id) {
            pool.close();
        }
    }

    fn close_all(&self) {
        let keys: Vec<u64> = self.pools.iter().map(|e| *e.key()).collect();
        for key in keys {
            self.close_pool(key);
        }
    }
}

#[derive(Debug, Serialize)]
pub struct PoolStats {
    pub pool_id: u64,
    pub total_connections: usize,
    pub active_connections: usize,
    pub idle_connections: usize,
    pub max_size: usize,
    pub waiting_threads: usize,
}

#[derive(Debug, Serialize)]
pub struct DetailedPoolStats {
    pub pool_id: u64,
    pub total_connections: usize,
    pub active_connections: usize,
    pub idle_connections: usize,
    pub max_size: usize,
    pub waiting_threads: usize,
    pub active_connection_ids: Vec<u64>,
    pub created_at: String,
}

// NEW: 活跃连接信息
#[derive(Debug, Serialize)]
pub struct ActiveConnectionInfo {
    pub conn_id: u64,
    pub pool_id: u64,
    pub current_database: Option<String>,
    pub created_at: u64,
}

#[derive(Debug, Serialize)]
pub struct ColumnMeta {
    pub name: String,
    pub label: String,
    pub type_name: String,
}

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<JsonValue>>,
}

#[derive(Debug, Serialize)]
pub struct MultiQueryResult {
    pub result_sets: Vec<QueryResult>,
    pub affected_rows: u64,
    pub last_insert_id: u64,
}

#[derive(Debug, Serialize)]
pub struct ExecResult {
    pub affected_rows: u64,
    pub last_insert_id: u64,
}

#[derive(Debug, Serialize)]
pub struct ConnectionProperties {
    pub connection_status: bool,
    pub server_version: Option<String>,
    pub current_database: Option<String>,
    pub connection_charset: Option<String>,
    pub wait_timeout_seconds: Option<u64>,
    pub ssl_mode: Option<String>,
    pub table_count: Option<u64>,
    pub view_count: Option<u64>,
    pub function_count: Option<u64>,
    pub procedure_count: Option<u64>,
}

pub fn create_pool(profile: &ConnectionProfile) -> Result<u64, String> {
    let config = PoolConfig::from_profile(profile);

    // NEW: 设置心跳间隔（从配置中读取，默认 30 秒）
    let keepalive_interval = config.keepalive_interval_secs.unwrap_or(30);
    KEEPALIVE_MANAGER.set_default_interval(keepalive_interval);

    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    manager.create_pool(config)
}

pub fn get_connection(pool_id: u64, initial_database: Option<String>) -> Result<u64, String> {
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => {
            let conn_id = pool.get_connection(initial_database)?;
            // NEW: 启动心跳任务（使用默认间隔，传入 None）
            KEEPALIVE_MANAGER.start(pool_id, conn_id, None);
            Ok(conn_id)
        }
        None => Err("Pool not found".to_string()),
    }
}

// NEW: 设置连接的当前数据库
pub fn set_connection_database(
    pool_id: u64,
    conn_id: u64,
    database: Option<String>,
) -> Result<(), String> {
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => {
            if let Some(mut entry) = pool.in_use.get_mut(&conn_id) {
                entry.current_database = database;
                Ok(())
            } else {
                Err("Connection not found".to_string())
            }
        }
        None => Err("Pool not found".to_string()),
    }
}

pub fn release_connection(pool_id: u64, conn_id: u64) -> Result<bool, String> {
    // NEW: 停止心跳任务
    KEEPALIVE_MANAGER.stop(conn_id);

    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => pool.release_connection(conn_id).map(|_| true),
        None => Err("Pool not found".to_string()),
    }
}

pub fn test_connection(profile: &ConnectionProfile) -> Result<bool, String> {
    let ssl_mode = parse_ssl_mode(profile.ssl_mode.as_deref());

    let mut builder = OptsBuilder::new()
        .ip_or_hostname(Some(profile.host.clone()))
        .tcp_port(profile.port)
        .user(Some(profile.username.clone()))
        .pass(Some(profile.password.clone()));

    if let Some(db) = &profile.database {
        if !db.trim().is_empty() {
            builder = builder.db_name(Some(db.clone()));
        }
    }

    let fallback_opts = if matches!(ssl_mode, SslMode::Preferred) {
        Some(Opts::from(builder.clone()))
    } else {
        None
    };

    builder = apply_ssl_mode_to_builder(builder, profile)?;

    let opts = Opts::from(builder);
    let mut conn = match Conn::new(opts) {
        Ok(conn) => conn,
        Err(primary_err) => {
            if let Some(fallback) = fallback_opts {
                Conn::new(fallback).map_err(|e| {
                    format!("Connection failed (TLS and fallback): {primary_err}; fallback: {e}")
                })?
            } else {
                return Err(format!("Connection failed: {primary_err}"));
            }
        }
    };

    let init_sqls = build_session_init_sql(&PoolConfig::from_profile(profile));
    for sql in init_sqls {
        if let Err(err) = conn.query_drop(sql.clone()) {
            if sql.starts_with("SET SESSION ssl_mode") {
                continue;
            }
            return Err(format!("Connection init failed: {err}"));
        }
    }

    Ok(true)
}

pub fn get_stats(pool_id: u64) -> Result<PoolStats, String> {
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => Ok(pool.get_stats()),
        None => Err("Pool not found".to_string()),
    }
}

pub fn get_detailed_stats(pool_id: u64) -> Result<DetailedPoolStats, String> {
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => {
            let stats = pool.get_stats();
            let active_connections = pool.get_active_connections();
            let active_connection_ids: Vec<u64> =
                active_connections.iter().map(|c| c.conn_id).collect();

            Ok(DetailedPoolStats {
                pool_id,
                total_connections: stats.total_connections,
                active_connections: stats.active_connections,
                idle_connections: stats.idle_connections,
                max_size: stats.max_size,
                waiting_threads: stats.waiting_threads,
                active_connection_ids,
                created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            })
        }
        None => Err("Pool not found".to_string()),
    }
}

// NEW: 获取活跃连接列表
pub fn get_active_connections(pool_id: u64) -> Result<Vec<ActiveConnectionInfo>, String> {
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => Ok(pool.get_active_connections()),
        None => Err("Pool not found".to_string()),
    }
}

// NEW: 获取所有活跃连接（跨所有连接池）
pub fn get_all_active_connections() -> Vec<ActiveConnectionInfo> {
    let mut all_connections = Vec::new();

    if let Ok(manager) = POOL_MANAGER.read() {
        for entry in manager.pools.iter() {
            let pool = entry.value();
            let pool_connections = pool.get_active_connections();
            all_connections.extend(pool_connections);
        }
    }

    all_connections
}

#[allow(dead_code)]
pub fn detect_connection_leaks(pool_id: u64, max_idle_secs: u64) -> Result<Vec<u64>, String> {
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => Ok(pool.detect_connection_leaks(max_idle_secs)),
        None => Err("Pool not found".to_string()),
    }
}

#[allow(dead_code)]
pub fn force_release_leaked_connections(pool_id: u64, max_idle_secs: u64) -> Result<usize, String> {
    let leaked = detect_connection_leaks(pool_id, max_idle_secs)?;
    let count = leaked.len();

    for conn_id in leaked {
        let _ = release_connection(pool_id, conn_id);
    }

    Ok(count)
}

pub fn get_connection_properties(
    pool_id: u64,
    database: Option<&str>,
) -> Result<ConnectionProperties, String> {
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    let pool = manager
        .get_pool(pool_id)
        .ok_or_else(|| "Pool not found".to_string())?;

    pool.with_pooled_connection(|conn| {
        conn.query_drop("SELECT 1")
            .map_err(|e| format!("Health check failed: {e}"))?;

        let server_version = conn
            .query_first::<String, _>("SELECT VERSION()")
            .map_err(|e| format!("Failed to query server version: {e}"))?;

        let current_database = match database {
            Some(db) if !db.trim().is_empty() => Some(db.to_string()),
            _ => conn
                .query_first::<Option<String>, _>("SELECT DATABASE()")
                .map_err(|e| format!("Failed to query current database: {e}"))?
                .flatten(),
        };

        let connection_charset = conn
            .query_first::<String, _>("SELECT @@session.character_set_connection")
            .map_err(|e| format!("Failed to query charset: {e}"))?;

        let wait_timeout_seconds = conn
            .query_first::<u64, _>("SELECT @@session.wait_timeout")
            .map_err(|e| format!("Failed to query wait_timeout: {e}"))?;

        let ssl_mode = detect_ssl_mode(conn);

        let (table_count, view_count, function_count, procedure_count) =
            if let Some(ref schema) = current_database {
                let table_count = conn
                    .exec_first::<u64, _, _>(
                        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = :schema AND TABLE_TYPE = 'BASE TABLE'",
                        params! { "schema" => schema },
                    )
                    .map_err(|e| format!("Failed to query table count: {e}"))?;

                let view_count = conn
                    .exec_first::<u64, _, _>(
                        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = :schema AND TABLE_TYPE = 'VIEW'",
                        params! { "schema" => schema },
                    )
                    .map_err(|e| format!("Failed to query view count: {e}"))?;

                let function_count = conn
                    .exec_first::<u64, _, _>(
                        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = :schema AND ROUTINE_TYPE = 'FUNCTION'",
                        params! { "schema" => schema },
                    )
                    .map_err(|e| format!("Failed to query function count: {e}"))?;

                let procedure_count = conn
                    .exec_first::<u64, _, _>(
                        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = :schema AND ROUTINE_TYPE = 'PROCEDURE'",
                        params! { "schema" => schema },
                    )
                    .map_err(|e| format!("Failed to query procedure count: {e}"))?;

                (table_count, view_count, function_count, procedure_count)
            } else {
                (None, None, None, None)
            };

        Ok(ConnectionProperties {
            connection_status: true,
            server_version,
            current_database,
            connection_charset,
            wait_timeout_seconds,
            ssl_mode,
            table_count,
            view_count,
            function_count,
            procedure_count,
        })
    })
}

pub fn query(pool_id: u64, conn_id: u64, sql: &str) -> Result<QueryResult, String> {
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => pool.with_connection(conn_id, |conn| execute_query(conn, sql, None)),
        None => Err("Pool not found".to_string()),
    }
}

pub fn query_multi(pool_id: u64, conn_id: u64, sql: &str) -> Result<MultiQueryResult, String> {
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => pool.with_connection(conn_id, |conn| execute_query_multi(conn, sql, None)),
        None => Err("Pool not found".to_string()),
    }
}

pub fn query_prepared_multi(
    pool_id: u64,
    conn_id: u64,
    sql: &str,
    params: Vec<SqlParam>,
) -> Result<MultiQueryResult, String> {
    let params = convert_params(params)?;
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => pool.with_connection(conn_id, |conn| {
            execute_query_multi(conn, sql, Some(params.clone()))
        }),
        None => Err("Pool not found".to_string()),
    }
}

pub fn execute(pool_id: u64, conn_id: u64, sql: &str) -> Result<ExecResult, String> {
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => pool.with_connection(conn_id, |conn| execute_update(conn, sql, None)),
        None => Err("Pool not found".to_string()),
    }
}

pub fn query_prepared(
    pool_id: u64,
    conn_id: u64,
    sql: &str,
    params: Vec<SqlParam>,
) -> Result<QueryResult, String> {
    let params = convert_params(params)?;
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => pool.with_connection(conn_id, |conn| {
            execute_query(conn, sql, Some(params.clone()))
        }),
        None => Err("Pool not found".to_string()),
    }
}

pub fn execute_prepared(
    pool_id: u64,
    conn_id: u64,
    sql: &str,
    params: Vec<SqlParam>,
) -> Result<ExecResult, String> {
    let params = convert_params(params)?;
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => pool.with_connection(conn_id, |conn| {
            execute_update(conn, sql, Some(params.clone()))
        }),
        None => Err("Pool not found".to_string()),
    }
}

pub fn close_pool(pool_id: u64) {
    // NEW: 停止所有相关连接的心跳任务
    if let Ok(manager) = POOL_MANAGER.read() {
        if let Some(pool) = manager.get_pool(pool_id) {
            // 获取所有活跃连接的 ID 并停止它们的心跳
            let conn_ids: Vec<u64> = pool.in_use.iter().map(|e| *e.key()).collect();
            for conn_id in conn_ids {
                KEEPALIVE_MANAGER.stop(conn_id);
            }
        }
        manager.close_pool(pool_id);
    }
}

pub fn close_all_pools() {
    // NEW: 停止所有心跳任务
    KEEPALIVE_MANAGER.stop_all();

    if let Ok(manager) = POOL_MANAGER.read() {
        manager.close_all();
    }
}

pub fn get_or_create_pool(profile: &ConnectionProfile) -> Result<u64, String> {
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;

    let config = PoolConfig::from_profile(profile);

    let keepalive_interval = config.keepalive_interval_secs.unwrap_or(30);
    KEEPALIVE_MANAGER.set_default_interval(keepalive_interval);

    manager.get_or_create_pool(config)
}

pub fn with_temp_connection<T, F>(profile: &ConnectionProfile, action: F) -> Result<T, String>
where
    F: FnOnce(&mut Conn) -> Result<T, String>,
{
    let pool_id = get_or_create_pool(profile)?;
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => pool.with_pooled_connection(action),
        None => Err("Pool not found".to_string()),
    }
}

pub fn with_temp_connection_database<T, F>(
    profile: &ConnectionProfile,
    database: Option<&str>,
    action: F,
) -> Result<T, String>
where
    F: FnOnce(&mut Conn) -> Result<T, String>,
{
    let pool_id = get_or_create_pool(profile)?;
    let manager = POOL_MANAGER
        .read()
        .map_err(|_| "Pool manager lock failed".to_string())?;
    match manager.get_pool(pool_id) {
        Some(pool) => {
            if let Some(db) = database {
                if !db.trim().is_empty() {
                    pool.with_pooled_connection(|conn| {
                        conn.query_drop(format!("USE `{}`", escape_identifier(db)))
                            .map_err(|e| format!("Failed to use database: {e}"))?;
                        action(conn)
                    })
                } else {
                    pool.with_pooled_connection(action)
                }
            } else {
                pool.with_pooled_connection(action)
            }
        }
        None => Err("Pool not found".to_string()),
    }
}

fn detect_ssl_mode(conn: &mut Conn) -> Option<String> {
    if let Ok(mode) = conn.query_first::<String, _>("SELECT @@session.ssl_mode") {
        if mode.is_some() {
            return mode;
        }
    }

    if let Ok(row) =
        conn.query_first::<(String, Option<String>), _>("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
    {
        if let Some((_, value)) = row {
            if value.as_deref().unwrap_or("").trim().is_empty() {
                return Some("DISABLED".to_string());
            }
            return Some("ENABLED".to_string());
        }
    }

    None
}

// NEW: 转义 MySQL 标识符（防止 SQL 注入）
fn escape_identifier(identifier: &str) -> String {
    identifier.replace('`', "``")
}

fn build_session_init_sql(config: &PoolConfig) -> Vec<String> {
    let mut sqls = Vec::new();

    // NEW: 首先添加数据库选择（如果有）
    if let Some(db) = &config.current_database {
        if !db.trim().is_empty() {
            sqls.push(format!("USE `{}`", escape_identifier(db)));
        }
    }

    if let Some(charset) = config.charset.as_deref().and_then(sanitize_mysql_token) {
        if let Some(collation) = config.collation.as_deref().and_then(sanitize_mysql_token) {
            sqls.push(format!("SET NAMES {} COLLATE {}", charset, collation));
        } else {
            sqls.push(format!("SET NAMES {}", charset));
        }
    }

    if let Some(timeout) = config.timeout_seconds.filter(|v| *v > 0) {
        sqls.push(format!("SET SESSION wait_timeout = {}", timeout));
    }

    let mode = parse_ssl_mode(config.ssl_mode.as_deref());
    if !matches!(mode, crate::backend::ssl::SslMode::Disabled) {
        let mode_value = ssl_mode_to_session_value(mode);
        sqls.push(format!("SET SESSION ssl_mode = '{}'", mode_value));
    }

    sqls
}

fn sanitize_mysql_token(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn is_connection_lost_error(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();

    normalized.contains("server has gone away")
        || normalized.contains("lost connection")
        || normalized.contains("unexpected eof")
        || normalized.contains("timed out")
        || normalized.contains("timeout")
        || normalized.contains("broken pipe")
        || normalized.contains("connection reset")
        || normalized.contains("connection was killed")
        || normalized.contains("io error")
        || normalized.contains("os error 10053")
        || normalized.contains("os error 10054")
}

fn derive_timeouts(config: &PoolConfig) -> (Option<u64>, Option<u64>, Option<u64>) {
    (
        config.connection_timeout_ms,
        config.create_timeout_ms,
        config.recycle_timeout_ms,
    )
}

fn execute_query(
    conn: &mut Conn,
    sql: &str,
    params: Option<Vec<Value>>,
) -> Result<QueryResult, String> {
    let mut result = QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
    };

    let mut rows = if let Some(p) = params {
        conn.exec_iter(sql, Params::Positional(p))
            .map_err(|e| format!("Query failed: {e}"))?
    } else {
        conn.exec_iter(sql, Params::Empty)
            .map_err(|e| format!("Query failed: {e}"))?
    };

    result.columns = rows
        .columns()
        .as_ref()
        .iter()
        .map(|c: &mysql::Column| ColumnMeta {
            name: c.name_str().to_string(),
            label: c.name_str().to_string(),
            type_name: format!("{:?}", c.column_type()),
        })
        .collect();

    for row in rows.by_ref() {
        let row = row.map_err(|e| format!("Row read failed: {e}"))?;
        result.rows.push(row_to_json(row));
    }

    Ok(result)
}

fn execute_query_multi(
    conn: &mut Conn,
    sql: &str,
    params: Option<Vec<Value>>,
) -> Result<MultiQueryResult, String> {
    let mut result_sets: Vec<QueryResult> = Vec::new();

    // Use exec_iter to get a QueryResult that supports multiple result sets
    let mut rows = if let Some(p) = params {
        conn.exec_iter(sql, Params::Positional(p))
            .map_err(|e| format!("Query failed: {e}"))?
    } else {
        conn.exec_iter(sql, Params::Empty)
            .map_err(|e| format!("Query failed: {e}"))?
    };

    // Get affected rows and last insert id before processing result sets
    // These need to be retrieved before the rows iterator is consumed
    let affected_rows = rows.affected_rows();
    let last_insert_id = rows.last_insert_id().unwrap_or(0);

    // Use QueryResult::iter to iterate over all result sets
    // iter() returns Option<ResultSet>, iterating until None (no more result sets)
    while let Some(result_set) = rows.iter() {
        let mut result = QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
        };

        // Get columns for this result set
        result.columns = result_set
            .columns()
            .as_ref()
            .iter()
            .map(|c: &mysql::Column| ColumnMeta {
                name: c.name_str().to_string(),
                label: c.name_str().to_string(),
                type_name: format!("{:?}", c.column_type()),
            })
            .collect();

        // Collect all rows for this result set
        for row in result_set {
            let row = row.map_err(|e| format!("Row read failed: {e}"))?;
            result.rows.push(row_to_json(row));
        }

        // Skip empty result sets (no columns and no rows)
        // This can happen with stored procedures that have multiple SELECT statements
        if !result.columns.is_empty() || !result.rows.is_empty() {
            result_sets.push(result);
        }
    }

    Ok(MultiQueryResult {
        result_sets,
        affected_rows,
        last_insert_id,
    })
}

fn execute_update(
    conn: &mut Conn,
    sql: &str,
    params: Option<Vec<Value>>,
) -> Result<ExecResult, String> {
    if let Some(p) = params {
        conn.exec_drop(sql, Params::Positional(p))
            .map_err(|e| format!("Execute failed: {e}"))?;
    } else {
        conn.query_drop(sql)
            .map_err(|e| format!("Execute failed: {e}"))?;
    }

    Ok(ExecResult {
        affected_rows: conn.affected_rows(),
        last_insert_id: conn.last_insert_id(),
    })
}

fn row_to_json(row: mysql::Row) -> Vec<JsonValue> {
    row.unwrap().into_iter().map(value_to_json).collect()
}

fn value_to_json(value: Value) -> JsonValue {
    match value {
        Value::NULL => JsonValue::Null,
        Value::Bytes(bytes) => JsonValue::String(String::from_utf8_lossy(&bytes).to_string()),
        Value::Int(v) => JsonValue::Number(v.into()),
        Value::UInt(v) => JsonValue::Number(serde_json::Number::from(v)),
        Value::Float(v) => serde_json::Number::from_f64(v as f64)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Number(0.into())),
        Value::Double(v) => serde_json::Number::from_f64(v)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Number(0.into())),
        Value::Date(y, m, d, hh, mm, ss, us) => JsonValue::String(format!(
            "{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02}.{:06}",
            us
        )),
        Value::Time(neg, days, hours, mins, secs, us) => JsonValue::String(format!(
            "{}{:02}:{:02}:{:02}.{:06} ({} days)",
            if neg { "-" } else { "" },
            hours,
            mins,
            secs,
            us,
            days
        )),
    }
}

fn convert_params(params: Vec<SqlParam>) -> Result<Vec<Value>, String> {
    let mut result = Vec::with_capacity(params.len());
    for item in params {
        result.push(to_mysql_value(item)?);
    }
    Ok(result)
}

fn to_mysql_value(param: SqlParam) -> Result<Value, String> {
    let t = param.param_type.to_ascii_lowercase();
    match t.as_str() {
        "null" => Ok(Value::NULL),
        "string" => Ok(Value::Bytes(
            param.value.as_str().unwrap_or_default().as_bytes().to_vec(),
        )),
        "int" | "long" => param
            .value
            .as_i64()
            .map(Value::Int)
            .ok_or_else(|| "Invalid integer param".to_string()),
        "double" => param
            .value
            .as_f64()
            .map(Value::Double)
            .ok_or_else(|| "Invalid double param".to_string()),
        "bool" | "boolean" => param
            .value
            .as_bool()
            .map(|v| Value::Int(if v { 1 } else { 0 }))
            .ok_or_else(|| "Invalid boolean param".to_string()),
        "bytes" => {
            let s = param
                .value
                .as_str()
                .ok_or_else(|| "Invalid bytes param".to_string())?;
            let bytes = STANDARD
                .decode(s)
                .map_err(|e| format!("Invalid bytes base64: {e}"))?;
            Ok(Value::Bytes(bytes))
        }
        "timestamp" | "date" | "datetime" => {
            let s = param
                .value
                .as_str()
                .ok_or_else(|| "Invalid date param".to_string())?;
            parse_datetime_to_value(s)
        }
        _ => Ok(Value::Bytes(param.value.to_string().as_bytes().to_vec())),
    }
}

fn parse_datetime_to_value(text: &str) -> Result<Value, String> {
    let trimmed = text.trim();
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Invalid datetime param".to_string());
    }
    let date_parts: Vec<&str> = parts[0].split('-').collect();
    if date_parts.len() != 3 {
        return Err("Invalid date format".to_string());
    }
    let year: u16 = date_parts[0]
        .parse()
        .map_err(|_| "Invalid year".to_string())?;
    let month: u8 = date_parts[1]
        .parse()
        .map_err(|_| "Invalid month".to_string())?;
    let day: u8 = date_parts[2]
        .parse()
        .map_err(|_| "Invalid day".to_string())?;

    if parts.len() == 1 {
        return Ok(Value::Date(year, month, day, 0, 0, 0, 0));
    }

    let time_parts: Vec<&str> = parts[1].split(':').collect();
    if time_parts.len() < 2 {
        return Err("Invalid time format".to_string());
    }
    let hour: u8 = time_parts[0]
        .parse()
        .map_err(|_| "Invalid hour".to_string())?;
    let minute: u8 = time_parts[1]
        .parse()
        .map_err(|_| "Invalid minute".to_string())?;
    let mut second: u8 = 0;
    let mut micros: u32 = 0;
    if time_parts.len() >= 3 {
        let sec_parts: Vec<&str> = time_parts[2].split('.').collect();
        second = sec_parts[0]
            .parse()
            .map_err(|_| "Invalid second".to_string())?;
        if sec_parts.len() == 2 {
            let frac = sec_parts[1];
            let padded = format!("{:0<6}", frac);
            micros = padded[..6]
                .parse()
                .map_err(|_| "Invalid microseconds".to_string())?;
        }
    }

    Ok(Value::Date(year, month, day, hour, minute, second, micros))
}
