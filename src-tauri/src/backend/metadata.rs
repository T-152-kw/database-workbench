use crate::backend::models::{ConnectionProfile, DbType, UserModel};
use crate::backend::pool;
use crate::backend::sqlutils;
use mysql::params;
use mysql::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Serialize, Deserialize, Clone)]
pub struct TableDetail {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Rows")]
    pub rows: Option<u64>,
    #[serde(rename = "DataLength")]
    pub data_length: Option<u64>,
    #[serde(rename = "Engine")]
    pub engine: Option<String>,
    #[serde(rename = "UpdateTime")]
    pub update_time: Option<String>,
    #[serde(rename = "Comment")]
    pub comment: Option<String>,
}

#[derive(Serialize)]
pub struct ViewDetail {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Definition")]
    pub definition: Option<String>,
    #[serde(rename = "CheckOption")]
    pub check_option: Option<String>,
    #[serde(rename = "IsUpdatable")]
    pub is_updatable: Option<String>,
    #[serde(rename = "Definer")]
    pub definer: Option<String>,
    #[serde(rename = "SecurityType")]
    pub security_type: Option<String>,
    #[serde(rename = "CreateTime")]
    pub create_time: Option<String>,
    #[serde(rename = "UpdateTime")]
    pub update_time: Option<String>,
}

#[derive(Serialize)]
pub struct FunctionDetail {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Type")]
    pub routine_type: String,
    #[serde(rename = "DataType")]
    pub data_type: Option<String>,
    #[serde(rename = "Definition")]
    pub definition: Option<String>,
    #[serde(rename = "IsDeterministic")]
    pub is_deterministic: Option<String>,
    #[serde(rename = "SqlDataAccess")]
    pub sql_data_access: Option<String>,
    #[serde(rename = "SecurityType")]
    pub security_type: Option<String>,
    #[serde(rename = "Definer")]
    pub definer: Option<String>,
    #[serde(rename = "CreateTime")]
    pub create_time: Option<String>,
    #[serde(rename = "UpdateTime")]
    pub update_time: Option<String>,
    #[serde(rename = "Comment")]
    pub comment: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct RoutineParam {
    pub name: String,
    #[serde(rename = "type")]
    pub param_type: String,
    pub mode: Option<String>,
}

#[derive(Serialize)]
pub struct ErDiagramData {
    pub tables: Vec<String>,
    pub columns: Vec<ErColumnRecord>,
    #[serde(rename = "foreignKeys")]
    pub foreign_keys: Vec<ErForeignKeyRecord>,
}

#[derive(Serialize)]
pub struct ErColumnRecord {
    #[serde(rename = "tableName")]
    pub table_name: String,
    #[serde(rename = "columnName")]
    pub column_name: String,
    #[serde(rename = "columnType")]
    pub column_type: String,
    #[serde(rename = "dataType")]
    pub data_type: String,
    #[serde(rename = "columnKey")]
    pub column_key: String,
}

#[derive(Serialize)]
pub struct ErForeignKeyRecord {
    #[serde(rename = "tableName")]
    pub table_name: String,
    #[serde(rename = "columnName")]
    pub column_name: String,
    #[serde(rename = "referencedTableName")]
    pub referenced_table_name: String,
    #[serde(rename = "referencedColumnName")]
    pub referenced_column_name: String,
    #[serde(rename = "constraintName")]
    pub constraint_name: String,
}

#[derive(Serialize, Clone)]
pub struct RoutineDetail {
    pub name: String,
    #[serde(rename = "type")]
    pub routine_type: String,
    #[serde(rename = "returnType")]
    pub return_type: Option<String>,
    pub params: Vec<RoutineParam>,
}

#[derive(Serialize)]
pub struct UserSummary {
    pub username: String,
    pub host: String,
    pub plugin: Option<String>,
    pub status: String,
}

#[derive(Serialize)]
pub struct UserModelPayload {
    pub username: String,
    pub host: String,
    pub plugin: Option<String>,
    #[serde(rename = "serverPrivileges")]
    pub server_privileges: Vec<String>,
    #[serde(rename = "databasePrivileges")]
    pub database_privileges: BTreeMap<String, Vec<String>>,
}

#[derive(Deserialize)]
struct UserSqlPayload {
    username: String,
    host: String,
    plugin: Option<String>,
    password: Option<String>,
    #[serde(rename = "serverPrivileges")]
    server_privileges: Vec<String>,
    #[serde(rename = "databasePrivileges")]
    database_privileges: BTreeMap<String, Vec<String>>,
}

const SERVER_PRIVILEGES: [&str; 32] = [
    "Alter",
    "Alter Routine",
    "Create",
    "Create Role",
    "Create Routine",
    "Create Tablespace",
    "Create Temporary Tables",
    "Create User",
    "Create View",
    "Delete",
    "Drop",
    "Drop Role",
    "Event",
    "Execute",
    "File",
    "Grant Option",
    "Index",
    "Insert",
    "Lock Tables",
    "Process",
    "References",
    "Reload",
    "Replication Client",
    "Replication Slave",
    "Select",
    "Show Databases",
    "Show View",
    "Shutdown",
    "Super",
    "System User",
    "Trigger",
    "Update",
];

const DB_PRIVILEGES: [&str; 19] = [
    "Select",
    "Insert",
    "Update",
    "Delete",
    "Create",
    "Drop",
    "Grant Option",
    "References",
    "Index",
    "Alter",
    "Create Temporary Tables",
    "Lock Tables",
    "Execute",
    "Create View",
    "Show View",
    "Create Routine",
    "Alter Routine",
    "Event",
    "Trigger",
];

const COLUMN_LEVEL_PRIVILEGES: [&str; 4] = ["Select", "Insert", "Update", "References"];

pub fn list_databases(profile: &ConnectionProfile) -> Result<Vec<String>, String> {
    pool::with_temp_connection(profile, |conn| {
        conn.query_map("SHOW DATABASES", |db: String| db)
            .map_err(|e| format!("Query failed: {e}"))
    })
}

pub fn list_tables(profile: &ConnectionProfile, schema: &str) -> Result<Vec<String>, String> {
    let schema = schema.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = :schema AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME";
        conn.exec_map(sql, params! {"schema" => &schema}, |name: String| name)
            .map_err(|e| format!("Query failed: {e}"))
    })
}

pub fn list_table_details(
    profile: &ConnectionProfile,
    schema: &str,
) -> Result<Vec<TableDetail>, String> {
    let schema = schema.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = "SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, ENGINE, DATE_FORMAT(UPDATE_TIME, '%Y-%m-%d %H:%i:%s') AS UPDATE_TIME, TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = :schema AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME";
        let rows: Vec<(
            String,
            Option<u64>,
            Option<u64>,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = conn
            .exec(sql, params! {"schema" => &schema})
            .map_err(|e| format!("Query failed: {e}"))?;
        Ok(rows
            .into_iter()
            .map(
                |(name, rows, data_length, engine, update_time, comment)| TableDetail {
                    name,
                    rows,
                    data_length,
                    engine,
                    update_time,
                    comment,
                },
            )
            .collect())
    })
}

pub fn list_views(profile: &ConnectionProfile, schema: &str) -> Result<Vec<String>, String> {
    let schema = schema.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = :schema AND TABLE_TYPE = 'VIEW' ORDER BY TABLE_NAME";
        conn.exec_map(sql, params! {"schema" => &schema}, |name: String| name)
            .map_err(|e| format!("Query failed: {e}"))
    })
}

pub fn list_view_details(
    profile: &ConnectionProfile,
    schema: &str,
) -> Result<Vec<ViewDetail>, String> {
    let schema = schema.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = "SELECT v.TABLE_NAME, v.VIEW_DEFINITION, v.CHECK_OPTION, v.IS_UPDATABLE, v.DEFINER, v.SECURITY_TYPE, DATE_FORMAT(t.CREATE_TIME, '%Y-%m-%d %H:%i:%s') AS CREATE_TIME, DATE_FORMAT(t.UPDATE_TIME, '%Y-%m-%d %H:%i:%s') AS UPDATE_TIME FROM INFORMATION_SCHEMA.VIEWS v LEFT JOIN INFORMATION_SCHEMA.TABLES t ON v.TABLE_SCHEMA = t.TABLE_SCHEMA AND v.TABLE_NAME = t.TABLE_NAME WHERE v.TABLE_SCHEMA = :schema ORDER BY v.TABLE_NAME";
        let rows: Vec<(
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = conn
            .exec(sql, params! {"schema" => &schema})
            .map_err(|e| format!("Query failed: {e}"))?;
        Ok(rows
            .into_iter()
            .map(
                |(
                    name,
                    definition,
                    check_option,
                    is_updatable,
                    definer,
                    security_type,
                    create_time,
                    update_time,
                )| {
                    ViewDetail {
                        name,
                        definition,
                        check_option,
                        is_updatable,
                        definer,
                        security_type,
                        create_time,
                        update_time,
                    }
                },
            )
            .collect())
    })
}

pub fn list_functions(profile: &ConnectionProfile, schema: &str) -> Result<Vec<String>, String> {
    let schema = schema.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = "SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = :schema ORDER BY ROUTINE_NAME";
        conn.exec_map(sql, params! {"schema" => &schema}, |name: String| name)
            .map_err(|e| format!("Query failed: {e}"))
    })
}

pub fn list_routines_with_details(
    profile: &ConnectionProfile,
    schema: &str,
) -> Result<Vec<RoutineDetail>, String> {
    let schema = schema.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql_routine = "SELECT ROUTINE_NAME, ROUTINE_TYPE, DATA_TYPE, DTD_IDENTIFIER FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = :schema ORDER BY ROUTINE_NAME";
        let routines: Vec<(String, String, Option<String>, Option<String>)> = conn
            .exec(sql_routine, params! {"schema" => &schema})
            .map_err(|e| format!("Query failed: {e}"))?;

        let mut routine_map: BTreeMap<String, RoutineDetail> = BTreeMap::new();
        for (name, routine_type, data_type, dtd) in routines {
            let return_type = dtd.or(data_type);
            routine_map.insert(
                name.clone(),
                RoutineDetail {
                    name,
                    routine_type,
                    return_type,
                    params: Vec::new(),
                },
            );
        }

        let sql_param = "SELECT SPECIFIC_NAME, PARAMETER_NAME, DATA_TYPE, DTD_IDENTIFIER, PARAMETER_MODE, ORDINAL_POSITION FROM INFORMATION_SCHEMA.PARAMETERS WHERE SPECIFIC_SCHEMA = :schema ORDER BY SPECIFIC_NAME, ORDINAL_POSITION";
        let params_rows: Vec<(
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<u32>,
        )> = conn
            .exec(sql_param, params! {"schema" => &schema})
            .map_err(|e| format!("Query failed: {e}"))?;

        for (routine_name, param_name, data_type, dtd, mode, _) in params_rows {
            if let Some(param_name) = param_name {
                if let Some(routine) = routine_map.get_mut(&routine_name) {
                    let param_type = dtd.or(data_type).unwrap_or_default();
                    routine.params.push(RoutineParam {
                        name: param_name,
                        param_type,
                        mode,
                    });
                }
            }
        }

        Ok(routine_map.into_values().collect())
    })
}

pub fn list_function_details(
    profile: &ConnectionProfile,
    schema: &str,
) -> Result<Vec<FunctionDetail>, String> {
    let schema = schema.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = "SELECT ROUTINE_NAME, ROUTINE_TYPE, DATA_TYPE, ROUTINE_DEFINITION, IS_DETERMINISTIC, SQL_DATA_ACCESS, SECURITY_TYPE, DEFINER, DATE_FORMAT(CREATED, '%Y-%m-%d %H:%i:%s') AS CREATED, DATE_FORMAT(LAST_ALTERED, '%Y-%m-%d %H:%i:%s') AS LAST_ALTERED, ROUTINE_COMMENT FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = :schema AND ROUTINE_TYPE IN ('FUNCTION', 'PROCEDURE') ORDER BY ROUTINE_NAME";
        let rows: Vec<(
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = conn
            .exec(sql, params! {"schema" => &schema})
            .map_err(|e| format!("Query failed: {e}"))?;
        Ok(rows
            .into_iter()
            .map(
                |(
                    name,
                    routine_type,
                    data_type,
                    definition,
                    is_deterministic,
                    sql_data_access,
                    security_type,
                    definer,
                    created,
                    last_altered,
                    comment,
                )| FunctionDetail {
                    name,
                    routine_type,
                    data_type,
                    definition,
                    is_deterministic,
                    sql_data_access,
                    security_type,
                    definer,
                    create_time: created,
                    update_time: last_altered,
                    comment,
                },
            )
            .collect())
    })
}

pub fn get_function_ddl(
    profile: &ConnectionProfile,
    schema: &str,
    name: &str,
    routine_type: &str,
) -> Result<String, String> {
    let schema = schema.to_string();
    let name = name.to_string();
    let routine_type = routine_type.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = format!(
            "SHOW CREATE {} `{}`.`{}`",
            routine_type,
            escape_identifier(&schema),
            escape_identifier(&name)
        );
        let row: Option<mysql::Row> = conn
            .query_first(&sql)
            .map_err(|e| format!("Query failed: {e}"))?;

        if let Some(row) = row {
            let ddl_index = if routine_type == "FUNCTION" { 1 } else { 2 };
            if row.len() > ddl_index {
                let ddl: Option<String> = row.get(ddl_index);
                Ok(ddl.unwrap_or_default())
            } else {
                Ok(String::new())
            }
        } else {
            Ok(String::new())
        }
    })
}

pub fn get_routine_params(
    profile: &ConnectionProfile,
    schema: &str,
    name: &str,
) -> Result<Vec<RoutineParam>, String> {
    let schema = schema.to_string();
    let name = name.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = "SELECT PARAMETER_NAME, DATA_TYPE, DTD_IDENTIFIER, PARAMETER_MODE FROM INFORMATION_SCHEMA.PARAMETERS WHERE SPECIFIC_SCHEMA = :schema AND SPECIFIC_NAME = :name AND PARAMETER_NAME IS NOT NULL ORDER BY ORDINAL_POSITION";
        let rows: Vec<(
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = conn
            .exec(sql, params! {"schema" => &schema, "name" => &name})
            .map_err(|e| format!("Query failed: {e}"))?;

        Ok(rows
            .into_iter()
            .filter_map(|(param_name, data_type, dtd, mode)| {
                param_name.map(|name| RoutineParam {
                    name,
                    param_type: dtd.or(data_type).unwrap_or_default(),
                    mode,
                })
            })
            .collect())
    })
}

pub fn list_columns(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
) -> Result<Vec<BTreeMap<String, String>>, String> {
    let schema = schema.to_string();
    let table = table.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, COLUMN_COMMENT, CHARACTER_SET_NAME, COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table ORDER BY ORDINAL_POSITION";
        let rows: Vec<mysql::Row> = conn
            .exec(sql, params! {"schema" => &schema, "table" => &table})
            .map_err(|e| format!("Query failed: {e}"))?;
        let mut result = Vec::new();
        for row in rows {
            let mut map = BTreeMap::new();
            map.insert(
                "COLUMN_NAME".to_string(),
                row.get::<String, _>("COLUMN_NAME").unwrap_or_default(),
            );
            map.insert(
                "DATA_TYPE".to_string(),
                row.get::<String, _>("DATA_TYPE").unwrap_or_default(),
            );
            map.insert(
                "COLUMN_TYPE".to_string(),
                row.get::<String, _>("COLUMN_TYPE").unwrap_or_default(),
            );
            map.insert(
                "IS_NULLABLE".to_string(),
                row.get::<String, _>("IS_NULLABLE").unwrap_or_default(),
            );
            map.insert(
                "COLUMN_DEFAULT".to_string(),
                row.get::<Option<String>, _>("COLUMN_DEFAULT")
                    .unwrap_or_default()
                    .unwrap_or_default(),
            );
            map.insert(
                "COLUMN_KEY".to_string(),
                row.get::<Option<String>, _>("COLUMN_KEY")
                    .unwrap_or_default()
                    .unwrap_or_default(),
            );
            map.insert(
                "EXTRA".to_string(),
                row.get::<Option<String>, _>("EXTRA")
                    .unwrap_or_default()
                    .unwrap_or_default(),
            );
            map.insert(
                "CHARACTER_MAXIMUM_LENGTH".to_string(),
                row.get::<Option<i64>, _>("CHARACTER_MAXIMUM_LENGTH")
                    .unwrap_or_default()
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
            );
            map.insert(
                "NUMERIC_PRECISION".to_string(),
                row.get::<Option<i64>, _>("NUMERIC_PRECISION")
                    .unwrap_or_default()
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
            );
            map.insert(
                "NUMERIC_SCALE".to_string(),
                row.get::<Option<i64>, _>("NUMERIC_SCALE")
                    .unwrap_or_default()
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
            );
            map.insert(
                "COLUMN_COMMENT".to_string(),
                row.get::<Option<String>, _>("COLUMN_COMMENT")
                    .unwrap_or_default()
                    .unwrap_or_default(),
            );
            map.insert(
                "CHARACTER_SET_NAME".to_string(),
                row.get::<Option<String>, _>("CHARACTER_SET_NAME")
                    .unwrap_or_default()
                    .unwrap_or_default(),
            );
            map.insert(
                "COLLATION_NAME".to_string(),
                row.get::<Option<String>, _>("COLLATION_NAME")
                    .unwrap_or_default()
                    .unwrap_or_default(),
            );
            result.push(map);
        }
        Ok(result)
    })
}

pub fn list_foreign_keys(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
) -> Result<Vec<BTreeMap<String, String>>, String> {
    let schema = schema.to_string();
    let table = table.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = "SELECT COLUMN_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table AND REFERENCED_TABLE_NAME IS NOT NULL";
        let rows: Vec<(String, String, String, String, String)> = conn
            .exec(sql, params! {"schema" => &schema, "table" => &table})
            .map_err(|e| format!("Query failed: {e}"))?;
        let mut result = Vec::new();
        for (column_name, ref_schema, ref_table, ref_col, constraint) in rows {
            let mut map = BTreeMap::new();
            map.insert("COLUMN_NAME".to_string(), column_name);
            map.insert("REFERENCED_TABLE_SCHEMA".to_string(), ref_schema);
            map.insert("REFERENCED_TABLE_NAME".to_string(), ref_table);
            map.insert("REFERENCED_COLUMN_NAME".to_string(), ref_col);
            map.insert("CONSTRAINT_NAME".to_string(), constraint);
            result.push(map);
        }
        Ok(result)
    })
}

pub fn get_er_diagram_data(
    profile: &ConnectionProfile,
    schema: &str,
) -> Result<ErDiagramData, String> {
    let schema = schema.to_string();
    pool::with_temp_connection(profile, |conn| {
        let tables_sql = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = :schema AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME";
        let tables: Vec<String> = conn
            .exec_map(tables_sql, params! {"schema" => &schema}, |name: String| {
                name
            })
            .map_err(|e| format!("Query failed: {e}"))?;

        let columns_sql = "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = :schema ORDER BY TABLE_NAME, ORDINAL_POSITION";
        let columns_rows: Vec<(
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = conn
            .exec(columns_sql, params! {"schema" => &schema})
            .map_err(|e| format!("Query failed: {e}"))?;
        let columns = columns_rows
            .into_iter()
            .map(
                |(table_name, column_name, column_type, data_type, column_key)| ErColumnRecord {
                    table_name,
                    column_name,
                    column_type: column_type.unwrap_or_default(),
                    data_type: data_type.unwrap_or_default(),
                    column_key: column_key.unwrap_or_default(),
                },
            )
            .collect();

        let fk_sql = "SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = :schema AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION";
        let fk_rows: Vec<(
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = conn
            .exec(fk_sql, params! {"schema" => &schema})
            .map_err(|e| format!("Query failed: {e}"))?;
        let foreign_keys = fk_rows
            .into_iter()
            .filter_map(
                |(
                    table_name,
                    column_name,
                    referenced_table_name,
                    referenced_column_name,
                    constraint_name,
                )| {
                    let referenced_table_name = referenced_table_name?;
                    let referenced_column_name = referenced_column_name?;
                    Some(ErForeignKeyRecord {
                        table_name,
                        column_name,
                        referenced_table_name,
                        referenced_column_name,
                        constraint_name: constraint_name.unwrap_or_default(),
                    })
                },
            )
            .collect();

        Ok(ErDiagramData {
            tables,
            columns,
            foreign_keys,
        })
    })
}

pub fn list_indexes(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
) -> Result<Vec<BTreeMap<String, String>>, String> {
    let schema = schema.to_string();
    let table = table.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = "SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS, INDEX_TYPE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = :schema AND TABLE_NAME = :table GROUP BY INDEX_NAME, NON_UNIQUE, INDEX_TYPE";
        let rows: Vec<(String, i64, Option<String>, Option<String>)> = conn
            .exec(sql, params! {"schema" => &schema, "table" => &table})
            .map_err(|e| format!("Query failed: {e}"))?;
        let mut result = Vec::new();
        for (index_name, non_unique, columns, index_type) in rows {
            let mut map = BTreeMap::new();
            map.insert("INDEX_NAME".to_string(), index_name);
            map.insert("NON_UNIQUE".to_string(), non_unique.to_string());
            map.insert("COLUMNS".to_string(), columns.unwrap_or_default());
            map.insert("INDEX_TYPE".to_string(), index_type.unwrap_or_default());
            result.push(map);
        }
        Ok(result)
    })
}

pub fn list_triggers(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
) -> Result<Vec<BTreeMap<String, String>>, String> {
    let schema = schema.to_string();
    let table = table.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = "SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT FROM INFORMATION_SCHEMA.TRIGGERS WHERE EVENT_OBJECT_SCHEMA = :schema AND EVENT_OBJECT_TABLE = :table";
        let rows: Vec<(String, String, String, String)> = conn
            .exec(sql, params! {"schema" => &schema, "table" => &table})
            .map_err(|e| format!("Query failed: {e}"))?;
        let mut result = Vec::new();
        for (name, timing, event, statement) in rows {
            let mut map = BTreeMap::new();
            map.insert("TRIGGER_NAME".to_string(), name);
            map.insert("ACTION_TIMING".to_string(), timing);
            map.insert("EVENT_MANIPULATION".to_string(), event);
            map.insert("ACTION_STATEMENT".to_string(), statement);
            result.push(map);
        }
        Ok(result)
    })
}

pub fn list_checks(
    profile: &ConnectionProfile,
    schema: &str,
    table: &str,
) -> Result<Vec<BTreeMap<String, String>>, String> {
    let schema = schema.to_string();
    let table = table.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = "SELECT tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE, tc.ENFORCED FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA = :schema AND tc.TABLE_NAME = :table AND tc.CONSTRAINT_TYPE = 'CHECK'";
        let rows: Vec<(String, String, String)> = conn
            .exec(sql, params! {"schema" => &schema, "table" => &table})
            .map_err(|e| format!("Query failed: {e}"))?;
        let mut result = Vec::new();
        for (name, clause, enforced) in rows {
            let mut map = BTreeMap::new();
            map.insert("CONSTRAINT_NAME".to_string(), name);
            map.insert("CHECK_CLAUSE".to_string(), clause);
            map.insert("ENFORCED".to_string(), enforced);
            result.push(map);
        }
        Ok(result)
    })
}

pub fn load_ddl(profile: &ConnectionProfile, schema: &str, table: &str) -> Result<String, String> {
    let schema = schema.to_string();
    let table = table.to_string();
    pool::with_temp_connection(profile, |conn| {
        let sql = format!(
            "SHOW CREATE TABLE `{}`.`{}`",
            escape_identifier(&schema),
            escape_identifier(&table)
        );
        let row: Option<(String, String)> = conn
            .query_first(sql)
            .map_err(|e| format!("Query failed: {e}"))?;
        Ok(row.map(|(_, ddl)| ddl).unwrap_or_default())
    })
}

/// 生成ER图的SQL导出（通用SQL格式）
pub fn export_er_diagram_sql(profile: &ConnectionProfile, schema: &str) -> Result<String, String> {
    let schema = schema.to_string();
    pool::with_temp_connection(profile, |conn| {
        let mut sql_output = String::new();

        // 添加文件头注释
        sql_output.push_str("-- ER Diagram SQL Export\n");
        sql_output.push_str(&format!("-- Database: {}\n", &schema));
        sql_output.push_str(&format!(
            "-- Generated at: {}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
        ));
        sql_output.push_str("-- \n\n");

        // 获取所有表
        let tables_sql = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = :schema AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME";
        let tables: Vec<String> = conn
            .exec_map(tables_sql, params! {"schema" => &schema}, |name: String| {
                name
            })
            .map_err(|e| format!("Query failed: {e}"))?;

        if tables.is_empty() {
            return Ok("-- No tables found in database\n".to_string());
        }

        // 为每个表生成CREATE TABLE语句
        sql_output.push_str("-- Create Tables\n");
        sql_output.push_str("SET FOREIGN_KEY_CHECKS = 0;\n\n");

        for table in &tables {
            // 获取表的CREATE语句
            let show_create_sql = format!(
                "SHOW CREATE TABLE `{}`.`{}`",
                escape_identifier(&schema),
                escape_identifier(table)
            );
            let row: Option<(String, String)> = conn
                .query_first(show_create_sql)
                .map_err(|e| format!("Query failed: {e}"))?;

            if let Some((_, ddl)) = row {
                sql_output.push_str(&format!("-- Table: {}\n", table));
                sql_output.push_str(&ddl);
                sql_output.push_str(";\n\n");
            }
        }

        // 获取所有外键关系并生成ALTER TABLE语句
        sql_output.push_str("-- Foreign Keys\n");

        let fk_sql = "SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = :schema AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION";
        let fk_rows: Vec<(
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = conn
            .exec(fk_sql, params! {"schema" => &schema})
            .map_err(|e| format!("Query failed: {e}"))?;

        // 按约束名分组外键
        let mut fk_groups: BTreeMap<String, Vec<(String, String, String, String)>> =
            BTreeMap::new();
        for (
            table_name,
            column_name,
            referenced_table_name,
            referenced_column_name,
            constraint_name,
        ) in fk_rows
        {
            if let (Some(ref_table), Some(ref_column), Some(constraint)) = (
                referenced_table_name,
                referenced_column_name,
                constraint_name,
            ) {
                let key = format!("{}.{}", table_name, constraint);
                fk_groups.entry(key).or_default().push((
                    table_name,
                    column_name,
                    ref_table,
                    ref_column,
                ));
            }
        }

        // 生成ALTER TABLE ADD FOREIGN KEY语句
        for (key, columns) in fk_groups {
            if columns.is_empty() {
                continue;
            }
            let table_name = &columns[0].0;
            let constraint_name = key.split('.').nth(1).unwrap_or("fk");

            let column_names: Vec<String> = columns.iter().map(|c| c.1.clone()).collect();
            let ref_column_names: Vec<String> = columns.iter().map(|c| c.3.clone()).collect();
            let ref_table = &columns[0].2;

            sql_output.push_str(&format!(
                "ALTER TABLE `{}` ADD CONSTRAINT `{}` FOREIGN KEY ({}) REFERENCES `{}` ({});\n",
                table_name,
                constraint_name,
                column_names
                    .iter()
                    .map(|c| format!("`{}`", c))
                    .collect::<Vec<_>>()
                    .join(", "),
                ref_table,
                ref_column_names
                    .iter()
                    .map(|c| format!("`{}`", c))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }

        sql_output.push_str("\nSET FOREIGN_KEY_CHECKS = 1;\n");

        Ok(sql_output)
    })
}

pub fn get_current_user_info(profile: &ConnectionProfile) -> Result<String, String> {
    pool::with_temp_connection(profile, |conn| {
        let mut info = String::new();
        if let Some(user) = conn
            .query_first::<String, _>("SELECT CURRENT_USER()")
            .map_err(|e| format!("Query failed: {e}"))?
        {
            info.push_str("Current user: ");
            info.push_str(&user);
            info.push('\n');
        }
        if let Some(conn_id) = conn
            .query_first::<String, _>("SELECT CONNECTION_ID()")
            .map_err(|e| format!("Query failed: {e}"))?
        {
            info.push_str("Connection ID: ");
            info.push_str(&conn_id);
            info.push('\n');
        }
        if let Some(db) = conn
            .query_first::<Option<String>, _>("SELECT DATABASE()")
            .map_err(|e| format!("Query failed: {e}"))?
        {
            info.push_str("Current database: ");
            info.push_str(db.as_deref().unwrap_or(""));
            info.push('\n');
        }
        if let Some(version) = conn
            .query_first::<String, _>("SELECT VERSION()")
            .map_err(|e| format!("Query failed: {e}"))?
        {
            info.push_str("MySQL version: ");
            info.push_str(&version);
            info.push('\n');
        }
        let grants: Vec<String> = conn
            .query_map("SHOW GRANTS FOR CURRENT_USER()", |g: String| g)
            .map_err(|e| format!("Query failed: {e}"))?;
        if !grants.is_empty() {
            info.push_str("\nUser grants:\n");
            for grant in grants {
                info.push_str(&grant);
                info.push('\n');
            }
        }
        Ok(info)
    })
}

pub fn get_all_users(profile: &ConnectionProfile) -> Result<Vec<UserSummary>, String> {
    pool::with_temp_connection(profile, |conn| {
        let rows: Vec<(
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = conn
            .query("SELECT User, Host, plugin, account_locked, password_expired FROM mysql.user")
            .map_err(|e| format!("Query failed: {e}"))?;

        Ok(rows
            .into_iter()
            .map(
                |(username, host, plugin, account_locked, password_expired)| UserSummary {
                    username,
                    host,
                    plugin,
                    status: build_account_status(
                        account_locked.as_deref(),
                        password_expired.as_deref(),
                    ),
                },
            )
            .collect())
    })
}

pub fn get_user_detail(
    profile: &ConnectionProfile,
    username: &str,
    host: &str,
) -> Result<String, String> {
    let username = username.to_string();
    let host = host.to_string();
    pool::with_temp_connection(profile, |conn| {
        let mut detail = String::new();
        detail.push_str("Username: ");
        detail.push_str(&username);
        detail.push('\n');
        detail.push_str("Host: ");
        detail.push_str(&host);
        detail.push_str("\n\n");

        let grants_sql = format!(
            "SHOW GRANTS FOR '{}'@'{}'",
            escape_string(&username),
            escape_string(&host)
        );
        let grants: Vec<String> = conn
            .query_map(grants_sql, |g: String| g)
            .map_err(|e| format!("Query failed: {e}"))?;
        detail.push_str("Grants:\n");
        detail.push_str("----------------------------\n");
        for grant in grants {
            detail.push_str(&grant);
            detail.push('\n');
        }

        let auth_sql = "SELECT plugin, authentication_string FROM mysql.user WHERE User = :user AND Host = :host";
        let row: Option<(Option<String>, Option<String>)> = conn
            .exec_first(auth_sql, params! {"user" => &username, "host" => &host})
            .map_err(|e| format!("Query failed: {e}"))?;
        if let Some((plugin, auth)) = row {
            detail.push_str("\nAuthentication:\n");
            detail.push_str("----------------------------\n");
            detail.push_str("Plugin: ");
            detail.push_str(plugin.as_deref().unwrap_or(""));
            detail.push('\n');
            detail.push_str("Password set: ");
            let has_pwd = auth.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
            detail.push_str(if has_pwd { "Yes" } else { "No" });
            detail.push('\n');
        }

        Ok(detail)
    })
}

pub fn get_user_model(
    profile: &ConnectionProfile,
    username: &str,
    host: &str,
) -> Result<UserModelPayload, String> {
    let username = username.to_string();
    let host = host.to_string();
    pool::with_temp_connection(profile, |conn| {
        let plugin_sql = "SELECT plugin FROM mysql.user WHERE User = :user AND Host = :host";
        let plugin: Option<String> = conn
            .exec_first(plugin_sql, params! {"user" => &username, "host" => &host})
            .map_err(|e| format!("Query failed: {e}"))?;

        let server_privs = load_server_privileges(conn, &username, &host)
            .map_err(|e| format!("Query failed: {e}"))?;
        let db_privs = load_database_privileges(conn, &username, &host)
            .map_err(|e| format!("Query failed: {e}"))?;

        Ok(UserModelPayload {
            username,
            host,
            plugin,
            server_privileges: server_privs,
            database_privileges: db_privs,
        })
    })
}

pub fn get_all_databases(profile: &ConnectionProfile) -> Result<Vec<String>, String> {
    pool::with_temp_connection(profile, |conn| {
        let dbs: Vec<String> = conn
            .query_map("SHOW DATABASES", |db: String| db)
            .map_err(|e| format!("Query failed: {e}"))?;
        Ok(dbs
            .into_iter()
            .filter(|db| {
                !matches!(
                    db.to_ascii_lowercase().as_str(),
                    "information_schema" | "mysql" | "performance_schema" | "sys"
                )
            })
            .collect())
    })
}

pub fn generate_user_sql(
    current: &UserModel,
    is_new_user: bool,
    original: Option<&UserModel>,
) -> String {
    let current_payload = to_payload(current);
    let original_payload = original.map(to_payload);
    generate_user_sql_payload(&current_payload, is_new_user, original_payload.as_ref())
}

pub fn execute_sql(
    profile: &ConnectionProfile,
    sql: &str,
    database_override: Option<&str>,
) -> Result<(), String> {
    let sql = sql.to_string();
    pool::with_temp_connection_database(profile, database_override, |conn| {
        let statements = sqlutils::split_sql_statements(&sql, DbType::Mysql);

        for stmt in statements {
            let trimmed = stmt.trim();
            if trimmed.is_empty() {
                continue;
            }
            conn.query_drop(trimmed)
                .map_err(|e| format!("Execute failed: {e}\nStatement: {trimmed}"))?;
        }

        Ok(())
    })
}

fn escape_identifier(input: &str) -> String {
    input.replace('`', "``")
}

fn escape_string(input: &str) -> String {
    input.replace('\\', "\\\\").replace('\'', "''")
}

fn build_account_status(account_locked: Option<&str>, password_expired: Option<&str>) -> String {
    let locked = matches!(account_locked, Some("Y") | Some("y"));
    let expired = matches!(password_expired, Some("Y") | Some("y"));

    match (locked, expired) {
        (true, true) => "锁定/过期".to_string(),
        (true, false) => "锁定".to_string(),
        (false, true) => "过期".to_string(),
        (false, false) => "正常".to_string(),
    }
}

fn load_server_privileges(
    conn: &mut mysql::Conn,
    username: &str,
    host: &str,
) -> Result<Vec<String>, mysql::Error> {
    let sql = "SELECT * FROM mysql.user WHERE User = :user AND Host = :host";
    let row: Option<mysql::Row> =
        conn.exec_first(sql, params! {"user" => username, "host" => host})?;
    let mut result = Vec::new();
    if let Some(row) = row {
        for (column, display) in server_privilege_mapping() {
            if let Some(value) = row.get::<Option<String>, _>(column) {
                if value.as_deref() == Some("Y") {
                    result.push(display.to_string());
                }
            }
        }
    }

    let global_sql = "SELECT Priv FROM mysql.global_grants WHERE User = :user AND Host = :host";
    if let Ok(mut result_set) =
        conn.exec_iter(global_sql, params! {"user" => username, "host" => host})
    {
        while let Some(row) = result_set.next() {
            let row: mysql::Row = row?;
            if let Some(priv_name) = row.get::<String, _>(0) {
                if let Some(mapped) = convert_global_priv_to_display(priv_name.as_str()) {
                    result.push(mapped.to_string());
                } else {
                    result.push(priv_name);
                }
            }
        }
    }

    Ok(result)
}

fn load_database_privileges(
    conn: &mut mysql::Conn,
    username: &str,
    host: &str,
) -> Result<BTreeMap<String, Vec<String>>, mysql::Error> {
    let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();

    let db_sql = "SELECT * FROM mysql.db WHERE User = :user AND Host = :host";
    let db_result_set = conn.exec_iter(db_sql, params! {"user" => username, "host" => host})?;
    for row_result in db_result_set {
        let row: mysql::Row = row_result?;
        let db_name: Option<String> = row.get("Db");
        if let Some(db_name) = db_name {
            let scope = format!("{}.*.*", db_name);
            for (column, display) in db_privilege_mapping() {
                if let Some(value) = row.get::<Option<String>, _>(column) {
                    if value.as_deref() == Some("Y") {
                        add_scope_privilege(&mut map, &scope, display);
                    }
                }
            }
        }
    }

    let table_sql = "SELECT Db, Table_name, Table_priv FROM mysql.tables_priv WHERE User = :user AND Host = :host";
    let table_rows: Vec<(String, String, Option<String>)> =
        conn.exec(table_sql, params! {"user" => username, "host" => host})?;
    for (db_name, table_name, table_priv) in table_rows {
        let scope = format!("{}.{}.*", db_name, table_name);
        if let Some(table_priv) = table_priv {
            for priv_name in split_set_privileges(&table_priv) {
                add_scope_privilege(&mut map, &scope, &priv_name);
            }
        }
    }

    let column_sql = "SELECT Db, Table_name, Column_name, Column_priv FROM mysql.columns_priv WHERE User = :user AND Host = :host";
    let column_rows: Vec<(String, String, String, Option<String>)> =
        conn.exec(column_sql, params! {"user" => username, "host" => host})?;
    for (db_name, table_name, column_name, column_priv) in column_rows {
        let scope = format!("{}.{}.{}", db_name, table_name, column_name);
        if let Some(column_priv) = column_priv {
            for priv_name in split_set_privileges(&column_priv) {
                add_scope_privilege(&mut map, &scope, &priv_name);
            }
        }
    }

    Ok(map)
}

fn server_privilege_mapping() -> Vec<(&'static str, &'static str)> {
    vec![
        ("Alter_priv", "Alter"),
        ("Alter_routine_priv", "Alter Routine"),
        ("Create_priv", "Create"),
        ("Create_role_priv", "Create Role"),
        ("Create_routine_priv", "Create Routine"),
        ("Create_tablespace_priv", "Create Tablespace"),
        ("Create_tmp_table_priv", "Create Temporary Tables"),
        ("Create_user_priv", "Create User"),
        ("Create_view_priv", "Create View"),
        ("Delete_priv", "Delete"),
        ("Drop_priv", "Drop"),
        ("Drop_role_priv", "Drop Role"),
        ("Event_priv", "Event"),
        ("Execute_priv", "Execute"),
        ("File_priv", "File"),
        ("Grant_priv", "Grant Option"),
        ("Index_priv", "Index"),
        ("Insert_priv", "Insert"),
        ("Lock_tables_priv", "Lock Tables"),
        ("Process_priv", "Process"),
        ("References_priv", "References"),
        ("Reload_priv", "Reload"),
        ("Repl_client_priv", "Replication Client"),
        ("Repl_slave_priv", "Replication Slave"),
        ("Select_priv", "Select"),
        ("Show_db_priv", "Show Databases"),
        ("Show_view_priv", "Show View"),
        ("Shutdown_priv", "Shutdown"),
        ("Super_priv", "Super"),
        ("Trigger_priv", "Trigger"),
        ("Update_priv", "Update"),
    ]
}

fn db_privilege_mapping() -> Vec<(&'static str, &'static str)> {
    vec![
        ("Select_priv", "Select"),
        ("Insert_priv", "Insert"),
        ("Update_priv", "Update"),
        ("Delete_priv", "Delete"),
        ("Create_priv", "Create"),
        ("Drop_priv", "Drop"),
        ("Grant_priv", "Grant Option"),
        ("References_priv", "References"),
        ("Index_priv", "Index"),
        ("Alter_priv", "Alter"),
        ("Create_tmp_table_priv", "Create Temporary Tables"),
        ("Lock_tables_priv", "Lock Tables"),
        ("Execute_priv", "Execute"),
        ("Create_view_priv", "Create View"),
        ("Show_view_priv", "Show View"),
        ("Create_routine_priv", "Create Routine"),
        ("Alter_routine_priv", "Alter Routine"),
        ("Event_priv", "Event"),
        ("Trigger_priv", "Trigger"),
    ]
}

fn add_scope_privilege(map: &mut BTreeMap<String, Vec<String>>, scope: &str, privilege: &str) {
    let normalized = normalize_privilege_name(privilege);
    if !DB_PRIVILEGES.iter().any(|p| privilege_eq(p, &normalized)) {
        return;
    }

    let entry = map.entry(scope.to_string()).or_default();
    if !entry.iter().any(|p| privilege_eq(p, &normalized)) {
        entry.push(normalized);
    }
}

fn split_set_privileges(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(normalize_privilege_name)
        .collect()
}

fn parse_scope_key(scope: &str) -> Option<(String, String, String)> {
    let parts: Vec<&str> = scope.split('.').collect();
    match parts.as_slice() {
        [db] if !db.trim().is_empty() => {
            Some((db.trim().to_string(), "*".to_string(), "*".to_string()))
        }
        [db, table] if !db.trim().is_empty() && !table.trim().is_empty() => Some((
            db.trim().to_string(),
            table.trim().to_string(),
            "*".to_string(),
        )),
        [db, table, column]
            if !db.trim().is_empty() && !table.trim().is_empty() && !column.trim().is_empty() =>
        {
            Some((
                db.trim().to_string(),
                table.trim().to_string(),
                column.trim().to_string(),
            ))
        }
        _ => None,
    }
}

fn normalize_privilege_name(input: &str) -> String {
    let normalized = input
        .trim()
        .replace('_', " ")
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ");

    let upper = normalized.to_ascii_uppercase();
    match upper.as_str() {
        "ALTER" => "Alter".to_string(),
        "ALTER ROUTINE" => "Alter Routine".to_string(),
        "CREATE" => "Create".to_string(),
        "CREATE ROUTINE" => "Create Routine".to_string(),
        "CREATE TEMPORARY TABLES" => "Create Temporary Tables".to_string(),
        "CREATE USER" => "Create User".to_string(),
        "CREATE VIEW" => "Create View".to_string(),
        "DELETE" => "Delete".to_string(),
        "DROP" => "Drop".to_string(),
        "EVENT" => "Event".to_string(),
        "EXECUTE" => "Execute".to_string(),
        "FILE" => "File".to_string(),
        "GRANT" | "GRANT OPTION" => "Grant Option".to_string(),
        "INDEX" => "Index".to_string(),
        "INSERT" => "Insert".to_string(),
        "LOCK TABLES" => "Lock Tables".to_string(),
        "PROCESS" => "Process".to_string(),
        "REFERENCES" => "References".to_string(),
        "RELOAD" => "Reload".to_string(),
        "REPLICATION CLIENT" => "Replication Client".to_string(),
        "REPLICATION SLAVE" => "Replication Slave".to_string(),
        "SELECT" => "Select".to_string(),
        "SHOW DATABASES" => "Show Databases".to_string(),
        "SHOW VIEW" => "Show View".to_string(),
        "SHUTDOWN" => "Shutdown".to_string(),
        "SUPER" => "Super".to_string(),
        "SYSTEM USER" => "System User".to_string(),
        "TRIGGER" => "Trigger".to_string(),
        "UPDATE" => "Update".to_string(),
        _ => normalized,
    }
}

fn privilege_eq(left: &str, right: &str) -> bool {
    normalize_privilege_name(left) == normalize_privilege_name(right)
}

fn is_dynamic_privilege(priv_name: &str) -> bool {
    // Dynamic privileges are stored in mysql.global_grants table
    // and need to be granted/revoked separately
    matches!(
        priv_name.to_ascii_lowercase().as_str(),
        "system user"
            | "system variables admin"
            | "table encryption admin"
            | "version token admin"
            | "xa recover admin"
    )
}

fn convert_global_priv_to_display(priv_name: &str) -> Option<&'static str> {
    match priv_name {
        "SYSTEM_USER" => Some("System User"),
        "SYSTEM_VARIABLES_ADMIN" => Some("System Variables Admin"),
        "TABLE_ENCRYPTION_ADMIN" => Some("Table Encryption Admin"),
        "VERSION_TOKEN_ADMIN" => Some("Version Token Admin"),
        "XA_RECOVER_ADMIN" => Some("XA Recover Admin"),
        _ => None,
    }
}

fn to_payload(model: &UserModel) -> UserSqlPayload {
    UserSqlPayload {
        username: model.username.clone(),
        host: model.host.clone(),
        plugin: model.plugin.clone(),
        password: model.password.clone(),
        server_privileges: model.server_privileges.clone(),
        database_privileges: model.database_privileges.clone(),
    }
}

fn generate_user_sql_payload(
    current: &UserSqlPayload,
    is_new_user: bool,
    original: Option<&UserSqlPayload>,
) -> String {
    let mut sql = String::new();
    let user_identity = format!("'{}'@'{}'", current.username, current.host);
    let plugin = current.plugin.as_deref().unwrap_or("caching_sha2_password");
    let password = current.password.as_deref().unwrap_or("");

    if is_new_user {
        sql.push_str("CREATE USER ");
        sql.push_str(&user_identity);
        if !password.is_empty() {
            sql.push_str(" IDENTIFIED WITH ");
            sql.push_str(plugin);
            sql.push_str(" BY '");
            sql.push_str(&escape_sql(password));
            sql.push_str("'");
        }
        sql.push_str(";\n\n");
    } else if let Some(original) = original {
        if current.username != original.username || current.host != original.host {
            let original_identity = format!("'{}'@'{}'", original.username, original.host);
            sql.push_str("RENAME USER ");
            sql.push_str(&original_identity);
            sql.push_str(" TO ");
            sql.push_str(&user_identity);
            sql.push_str(";\n\n");
        }

        let original_plugin = original
            .plugin
            .as_deref()
            .unwrap_or("caching_sha2_password");
        if plugin != original_plugin || !password.is_empty() {
            sql.push_str("ALTER USER ");
            sql.push_str(&user_identity);
            sql.push_str(" IDENTIFIED WITH ");
            sql.push_str(plugin);
            if !password.is_empty() {
                sql.push_str(" BY '");
                sql.push_str(&escape_sql(password));
                sql.push_str("'");
            }
            sql.push_str(";\n\n");
        }
    }

    // Separate static privileges (from mysql.user table) and dynamic privileges (from mysql.global_grants table)
    let static_privileges: Vec<&str> = SERVER_PRIVILEGES
        .iter()
        .filter(|p| !is_dynamic_privilege(p))
        .copied()
        .collect();
    let dynamic_privileges: Vec<&str> = SERVER_PRIVILEGES
        .iter()
        .filter(|p| is_dynamic_privilege(p))
        .copied()
        .collect();

    // Handle static privileges
    let mut grants: Vec<String> = Vec::new();
    let mut revokes: Vec<String> = Vec::new();

    for priv_name in static_privileges {
        let current_has = current
            .server_privileges
            .iter()
            .any(|p| privilege_eq(p, priv_name));
        let original_has = original
            .map(|o| {
                o.server_privileges
                    .iter()
                    .any(|p| privilege_eq(p, priv_name))
            })
            .unwrap_or(false);

        if current_has && !original_has {
            grants.push(priv_name.to_string());
        } else if !current_has && original_has {
            revokes.push(priv_name.to_string());
        }
    }

    if !grants.is_empty() {
        sql.push_str("GRANT ");
        sql.push_str(&grants.join(", "));
        sql.push_str(" ON *.* TO ");
        sql.push_str(&user_identity);
        sql.push_str(";\n");
    }

    if !revokes.is_empty() {
        sql.push_str("REVOKE ");
        sql.push_str(&revokes.join(", "));
        sql.push_str(" ON *.* FROM ");
        sql.push_str(&user_identity);
        sql.push_str(";\n");
    }

    // Handle dynamic privileges (e.g., SYSTEM_USER)
    for priv_name in dynamic_privileges {
        let current_has = current
            .server_privileges
            .iter()
            .any(|p| privilege_eq(p, priv_name));
        let original_has = original
            .map(|o| {
                o.server_privileges
                    .iter()
                    .any(|p| privilege_eq(p, priv_name))
            })
            .unwrap_or(false);

        if current_has && !original_has {
            sql.push_str("GRANT ");
            sql.push_str(priv_name);
            sql.push_str(" ON *.* TO ");
            sql.push_str(&user_identity);
            sql.push_str(";\n");
        } else if !current_has && original_has {
            sql.push_str("REVOKE ");
            sql.push_str(priv_name);
            sql.push_str(" ON *.* FROM ");
            sql.push_str(&user_identity);
            sql.push_str(";\n");
        }
    }

    let mut scope_keys: BTreeSet<String> = current.database_privileges.keys().cloned().collect();
    if let Some(original) = original {
        scope_keys.extend(original.database_privileges.keys().cloned());
    }

    for scope_key in scope_keys {
        let Some((db_name, table_name, column_name)) = parse_scope_key(&scope_key) else {
            continue;
        };

        let current_privs = current
            .database_privileges
            .get(&scope_key)
            .cloned()
            .unwrap_or_default();
        let original_privs = original
            .and_then(|o| o.database_privileges.get(&scope_key))
            .cloned()
            .unwrap_or_default();

        let mut db_grants: Vec<String> = Vec::new();
        let mut db_revokes: Vec<String> = Vec::new();

        for priv_name in DB_PRIVILEGES {
            let current_has = current_privs.iter().any(|p| privilege_eq(p, priv_name));
            let original_has = original_privs.iter().any(|p| privilege_eq(p, priv_name));

            if current_has && !original_has {
                db_grants.push(priv_name.to_string());
            } else if !current_has && original_has {
                db_revokes.push(priv_name.to_string());
            }
        }

        let target = if table_name == "*" {
            format!("`{}`.*", escape_identifier(&db_name))
        } else {
            format!(
                "`{}`.`{}`",
                escape_identifier(&db_name),
                escape_identifier(&table_name)
            )
        };

        if column_name == "*" {
            if !db_grants.is_empty() {
                sql.push_str("GRANT ");
                sql.push_str(&db_grants.join(", "));
                sql.push_str(" ON ");
                sql.push_str(&target);
                sql.push_str(" TO ");
                sql.push_str(&user_identity);
                sql.push_str(";\n");
            }

            if !db_revokes.is_empty() {
                sql.push_str("REVOKE ");
                sql.push_str(&db_revokes.join(", "));
                sql.push_str(" ON ");
                sql.push_str(&target);
                sql.push_str(" FROM ");
                sql.push_str(&user_identity);
                sql.push_str(";\n");
            }
            continue;
        }

        for priv_name in db_grants {
            if COLUMN_LEVEL_PRIVILEGES
                .iter()
                .any(|p| privilege_eq(p, &priv_name))
            {
                sql.push_str("GRANT ");
                sql.push_str(&priv_name);
                sql.push_str(" (`");
                sql.push_str(&escape_identifier(&column_name));
                sql.push_str("`) ON ");
                sql.push_str(&target);
                sql.push_str(" TO ");
                sql.push_str(&user_identity);
                sql.push_str(";\n");
            } else {
                sql.push_str("GRANT ");
                sql.push_str(&priv_name);
                sql.push_str(" ON ");
                sql.push_str(&target);
                sql.push_str(" TO ");
                sql.push_str(&user_identity);
                sql.push_str(";\n");
            }
        }

        for priv_name in db_revokes {
            if COLUMN_LEVEL_PRIVILEGES
                .iter()
                .any(|p| privilege_eq(p, &priv_name))
            {
                sql.push_str("REVOKE ");
                sql.push_str(&priv_name);
                sql.push_str(" (`");
                sql.push_str(&escape_identifier(&column_name));
                sql.push_str("`) ON ");
                sql.push_str(&target);
                sql.push_str(" FROM ");
                sql.push_str(&user_identity);
                sql.push_str(";\n");
            } else {
                sql.push_str("REVOKE ");
                sql.push_str(&priv_name);
                sql.push_str(" ON ");
                sql.push_str(&target);
                sql.push_str(" FROM ");
                sql.push_str(&user_identity);
                sql.push_str(";\n");
            }
        }
    }

    sql
}

fn escape_sql(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "''")
}
