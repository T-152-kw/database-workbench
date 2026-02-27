use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub name: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: Option<String>,
    pub charset: Option<String>,
    pub collation: Option<String>,
    pub timeout: Option<u64>, // 空闲超时（wait_timeout），默认 28800 秒（8小时）
    #[serde(rename = "connectionTimeout")]
    pub connection_timeout: Option<u64>, // 连接超时，默认 30 秒
    #[serde(rename = "autoReconnect")]
    pub auto_reconnect: Option<bool>, // 自动重连，默认 None（使用全局设置）
    pub ssl: Option<bool>,
    #[serde(rename = "sslMode")]
    pub ssl_mode: Option<String>,
    #[serde(rename = "sslCaPath")]
    pub ssl_ca_path: Option<String>,
    #[serde(rename = "sslCertPath")]
    pub ssl_cert_path: Option<String>,
    #[serde(rename = "sslKeyPath")]
    pub ssl_key_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FavoriteType {
    SqlQuery,
    ConnectionProfile,
    DatabaseObject,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteItem {
    pub id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub favorite_type: FavoriteType,
    pub content: Option<String>,
    #[serde(rename = "createdTime")]
    pub created_time: i64,
    #[serde(rename = "lastUsedTime")]
    pub last_used_time: i64,
    #[serde(rename = "usageCount")]
    pub usage_count: i32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DbType {
    #[serde(rename = "MYSQL")]
    Mysql,
    #[serde(rename = "POSTGRESQL")]
    PostgreSql,
    #[serde(rename = "SQL_SERVER")]
    SqlServer,
    #[serde(rename = "ORACLE")]
    Oracle,
    #[serde(rename = "SQLITE")]
    Sqlite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlParam {
    #[serde(rename = "type")]
    pub param_type: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserModel {
    pub username: String,
    pub host: String,
    pub plugin: Option<String>,
    pub password: Option<String>,
    #[serde(rename = "serverPrivileges")]
    pub server_privileges: Vec<String>,
    #[serde(rename = "databasePrivileges")]
    pub database_privileges: BTreeMap<String, Vec<String>>,
}
