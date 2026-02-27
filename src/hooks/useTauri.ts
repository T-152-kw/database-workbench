import { invoke } from '@tauri-apps/api/core';
import type {
  ConnectionProfile,
  PoolStats,
  ConnectionProperties,
  QueryResult,
  ExecResult,
  SqlParam,
  TableDetail,
  ViewDetail,
  FunctionDetail,
  RoutineDetail,
  RoutineParamInfo,
  MetadataRecord,
  UserSummary,
  UserModelPayload,
  UserModel,
  FavoriteItem,
  FavoriteType,
  DbType,
  BackupRequest,
  BackupResult,
  RestoreRequest,
  RestoreResult,
  IncrementalRequest,
  IncrementalResult,
  ScheduleRequest,
  ExportResult,
  ImportResult,
} from '../types';

export interface ErDiagramColumnRecord {
  tableName: string;
  columnName: string;
  columnType: string;
  dataType: string;
  columnKey: string;
}

export interface ErDiagramForeignKeyRecord {
  tableName: string;
  columnName: string;
  referencedTableName: string;
  referencedColumnName: string;
  constraintName: string;
}

export interface ErDiagramData {
  tables: string[];
  columns: ErDiagramColumnRecord[];
  foreignKeys: ErDiagramForeignKeyRecord[];
}

// ============ 连接池 API ============

export const poolApi = {
  create: (profile: ConnectionProfile): Promise<number> =>
    invoke('pool_create', { profile }),
  
  getConnection: (poolId: number): Promise<number> =>
    invoke('pool_get_connection', { poolId }),
  
  releaseConnection: (poolId: number, connId: number): Promise<boolean> =>
    invoke('pool_release_connection', { poolId, connId }),
  
  testConnection: (profile: ConnectionProfile): Promise<boolean> =>
    invoke('pool_test_connection', { profile }),
  
  getStats: (poolId: number): Promise<PoolStats> =>
    invoke('pool_get_stats', { poolId }),

  getConnectionProperties: (poolId: number, database?: string | null): Promise<ConnectionProperties> =>
    invoke('pool_get_connection_properties', { poolId, database: database ?? null }),
  
  query: (poolId: number, connId: number, sql: string): Promise<QueryResult> =>
    invoke('pool_query', { poolId, connId, sql }),
  
  execute: (poolId: number, connId: number, sql: string): Promise<ExecResult> =>
    invoke('pool_execute', { poolId, connId, sql }),
  
  queryPrepared: (poolId: number, connId: number, sql: string, params: SqlParam[]): Promise<QueryResult> =>
    invoke('pool_query_prepared', { poolId, connId, sql, params }),
  
  executePrepared: (poolId: number, connId: number, sql: string, params: SqlParam[]): Promise<ExecResult> =>
    invoke('pool_execute_prepared', { poolId, connId, sql, params }),
  
  close: (poolId: number): Promise<void> =>
    invoke('pool_close', { poolId }),
  
  closeAll: (): Promise<void> =>
    invoke('pool_close_all'),
};

// ============ 元数据 API ============

export const metadataApi = {
  listDatabases: (profile: ConnectionProfile): Promise<string[]> =>
    invoke('metadata_list_databases', { profile }),
  
  listTables: (profile: ConnectionProfile, database: string): Promise<string[]> =>
    invoke('metadata_list_tables', { profile, database }),
  
  listTableDetails: (profile: ConnectionProfile, database: string): Promise<TableDetail[]> =>
    invoke('metadata_list_table_details', { profile, database }),
  
  listViews: (profile: ConnectionProfile, database: string): Promise<string[]> =>
    invoke('metadata_list_views', { profile, database }),
  
  listViewDetails: (profile: ConnectionProfile, database: string): Promise<ViewDetail[]> =>
    invoke('metadata_list_view_details', { profile, database }),
  
  listFunctions: (profile: ConnectionProfile, database: string): Promise<string[]> =>
    invoke('metadata_list_functions', { profile, database }),
  
  listRoutinesWithDetails: (profile: ConnectionProfile, database: string): Promise<RoutineDetail[]> =>
    invoke('metadata_list_routines_with_details', { profile, database }),
  
  listFunctionDetails: (profile: ConnectionProfile, database: string): Promise<FunctionDetail[]> =>
    invoke('metadata_list_function_details', { profile, database }),
  
  getFunctionDdl: (profile: ConnectionProfile, database: string, name: string, routineType: string): Promise<string> =>
    invoke('metadata_get_function_ddl', { profile, database, name, routineType }),
  
  getRoutineParams: (profile: ConnectionProfile, database: string, name: string): Promise<RoutineParamInfo[]> =>
    invoke('metadata_get_routine_params', { profile, database, name }),
  
  listColumns: (profile: ConnectionProfile, database: string, table: string): Promise<MetadataRecord[]> =>
    invoke('metadata_list_columns', { profile, database, table }),
  
  listForeignKeys: (profile: ConnectionProfile, database: string, table: string): Promise<MetadataRecord[]> =>
    invoke('metadata_list_foreign_keys', { profile, database, table }),

  getErDiagramData: (profile: ConnectionProfile, database: string): Promise<ErDiagramData> =>
    invoke('metadata_get_er_diagram_data', { profile, database }),
  
  listIndexes: (profile: ConnectionProfile, database: string, table: string): Promise<MetadataRecord[]> =>
    invoke('metadata_list_indexes', { profile, database, table }),
  
  listTriggers: (profile: ConnectionProfile, database: string, table: string): Promise<MetadataRecord[]> =>
    invoke('metadata_list_triggers', { profile, database, table }),
  
  listChecks: (profile: ConnectionProfile, database: string, table: string): Promise<MetadataRecord[]> =>
    invoke('metadata_list_checks', { profile, database, table }),
  
  loadDdl: (profile: ConnectionProfile, database: string, table: string): Promise<string> =>
    invoke('metadata_load_ddl', { profile, database, table }),
  
  getCurrentUserInfo: (profile: ConnectionProfile): Promise<string> =>
    invoke('metadata_get_current_user_info', { profile }),
  
  getAllUsers: (profile: ConnectionProfile): Promise<UserSummary[]> =>
    invoke('metadata_get_all_users', { profile }),
  
  getUserDetail: (profile: ConnectionProfile, username: string, host: string): Promise<string> =>
    invoke('metadata_get_user_detail', { profile, username, host }),
  
  getUserModel: (profile: ConnectionProfile, username: string, host: string): Promise<UserModelPayload> =>
    invoke('metadata_get_user_model', { profile, username, host }),
  
  getAllDatabases: (profile: ConnectionProfile): Promise<string[]> =>
    invoke('metadata_get_all_databases', { profile }),
  
  generateUserSql: (user: UserModel, isNewUser: boolean, original?: UserModel): Promise<string> =>
    invoke('metadata_generate_user_sql', { user, isNewUser, original }),
  
  executeSql: (profile: ConnectionProfile, sql: string, database?: string): Promise<void> =>
    invoke('metadata_execute_sql', { profile, sql, database }),
};

// ============ 配置 API ============

export const configApi = {
  loadConnections: (): Promise<ConnectionProfile[]> =>
    invoke('config_load_connections'),
  
  saveConnections: (profiles: ConnectionProfile[]): Promise<void> =>
    invoke('config_save_connections', { profiles }),
  
  importConnections: (filePath: string): Promise<ConnectionProfile[]> =>
    invoke('config_import_connections', { filePath }),
  
  exportConnections: (filePath: string, profiles: ConnectionProfile[]): Promise<void> =>
    invoke('config_export_connections', { filePath, profiles }),
};

// ============ 应用配置 API ============

export const appConfigApi = {
  get: (key: string, defaultValue: string): Promise<string> =>
    invoke('app_config_get', { key, defaultValue }),
  
  set: (key: string, value: string): Promise<void> =>
    invoke('app_config_set', { key, value }),
  
  flush: (): Promise<void> =>
    invoke('app_config_flush'),
};

// ============ 收藏夹 API ============

export const favoritesApi = {
  getAll: (): Promise<FavoriteItem[]> =>
    invoke('favorites_get_all'),
  
  getByType: (favoriteType: FavoriteType): Promise<FavoriteItem[]> =>
    invoke('favorites_get_by_type', { favoriteType }),
  
  search: (keyword: string): Promise<FavoriteItem[]> =>
    invoke('favorites_search', { keyword }),
  
  get: (id: string): Promise<FavoriteItem | null> =>
    invoke('favorites_get', { id }),
  
  add: (item: FavoriteItem): Promise<FavoriteItem> =>
    invoke('favorites_add', { item }),
  
  update: (item: FavoriteItem): Promise<void> =>
    invoke('favorites_update', { item }),
  
  remove: (id: string): Promise<void> =>
    invoke('favorites_remove', { id }),
  
  recordUsage: (id: string): Promise<void> =>
    invoke('favorites_record_usage', { id }),
  
  clear: (): Promise<void> =>
    invoke('favorites_clear'),
  
  total: (): Promise<number> =>
    invoke('favorites_total'),
  
  stats: (): Promise<Record<FavoriteType, number>> =>
    invoke('favorites_stats'),
};

// ============ SQL 工具 API ============

export const sqlUtilsApi = {
  format: (sql: string, dbType: DbType): Promise<string> =>
    invoke('sql_format', { sql, dbType }),
  
  extractViewSelect: (ddl: string, dbType: DbType): Promise<string | null> =>
    invoke('sql_extract_view_select', { ddl, dbType }),
  
  splitStatements: (sql: string, dbType: DbType): Promise<string[]> =>
    invoke('sql_split_statements', { sql, dbType }),
};

// ============ JSON 工具 API ============

export const jsonApi = {
  parseCanonical: (json: string): Promise<string> =>
    invoke('json_parse_canonical', { json }),
};

// ============ 导入 API ============

export type ImportFormat = 'csv' | 'txt' | 'json' | 'xml' | 'sql';

export const importApi = {
  fromCsv: (profile: ConnectionProfile, database: string, table: string, filePath: string): Promise<ImportResult> =>
    invoke('import_from_csv', { profile, database, table, filePath }),
  
  fromJson: (profile: ConnectionProfile, database: string, table: string, filePath: string): Promise<ImportResult> =>
    invoke('import_from_json', { profile, database, table, filePath }),
  
  fromJsonl: (profile: ConnectionProfile, database: string, table: string, filePath: string): Promise<ImportResult> =>
    invoke('import_from_jsonl', { profile, database, table, filePath }),
  
  // Unified import with format
  importTable: (profile: ConnectionProfile, database: string, table: string, filePath: string, format: ImportFormat): Promise<ImportResult> =>
    invoke('import_table', { profile, database, table, filePath, format }),
};

// ============ 导出 API ============

export type ExportFormat = 'csv' | 'txt' | 'json' | 'html' | 'xml' | 'sql' | 'jsonl' | 'xlsx';

export const exportApi = {
  toCsv: (profile: ConnectionProfile, database: string, table: string, filePath: string): Promise<ExportResult> =>
    invoke('export_to_csv', { profile, database, table, filePath }),
  
  toJsonl: (profile: ConnectionProfile, database: string, table: string, filePath: string): Promise<ExportResult> =>
    invoke('export_to_jsonl', { profile, database, table, filePath }),
  
  // Unified export with format
  exportTable: (profile: ConnectionProfile, database: string, table: string, filePath: string, format: ExportFormat): Promise<ExportResult> =>
    invoke('export_table', { profile, database, table, filePath, format }),
  
  // Export query result with format
  exportQueryResult: (filePath: string, headers: string[], rows: string[][], format: ExportFormat, tableName?: string): Promise<ExportResult> =>
    invoke('export_query_result', { filePath, headers, rows, format, tableName }),
};

// ============ 备份 API ============

const toRustBackupRequest = (req: BackupRequest) => ({
  conn: req.conn,
  schema: req.schema,
  mysqldump_path: req.mysqldumpPath,
  output_path: req.outputPath,
  options: {
    include_data: req.options.includeData,
    include_views: req.options.includeViews,
    include_routines: req.options.includeRoutines,
    add_drop_table: req.options.addDropTable,
  },
});

const toRustRestoreRequest = (req: RestoreRequest) => ({
  conn: req.conn,
  target_schema: req.targetSchema,
  mysql_path: req.mysqlPath,
  input_path: req.inputPath,
  create_schema: req.createSchema,
});

const toRustIncrementalRequest = (req: IncrementalRequest) => ({
  conn: req.conn,
  schema: req.schema,
  output_dir: req.outputDir,
  binlog_index_path: req.binlogIndexPath,
  mysqlbinlog_path: req.mysqlbinlogPath,
});

const toRustScheduleRequest = (req: ScheduleRequest) => ({
  schedule_id: req.scheduleId,
  cron: req.cron,
  backup: toRustBackupRequest(req.backup),
});

const fromRustBackupResult = (result: { output_path: string; duration_ms: number }): BackupResult => ({
  outputPath: result.output_path,
  durationMs: result.duration_ms,
});

const fromRustRestoreResult = (result: { duration_ms: number }): RestoreResult => ({
  durationMs: result.duration_ms,
});

const fromRustIncrementalResult = (result: { output_file: string; duration_ms: number }): IncrementalResult => ({
  outputFile: result.output_file,
  durationMs: result.duration_ms,
});

export const backupApi = {
  execute: (req: BackupRequest): Promise<BackupResult> =>
    invoke<{ output_path: string; duration_ms: number }>('backup_execute', { req: toRustBackupRequest(req) })
      .then(fromRustBackupResult),
  
  restore: (req: RestoreRequest): Promise<RestoreResult> =>
    invoke<{ duration_ms: number }>('restore_execute', { req: toRustRestoreRequest(req) })
      .then(fromRustRestoreResult),
  
  incremental: (req: IncrementalRequest): Promise<IncrementalResult> =>
    invoke<{ output_file: string; duration_ms: number }>('incremental_backup', { req: toRustIncrementalRequest(req) })
      .then(fromRustIncrementalResult),
  
  scheduleAdd: (req: ScheduleRequest): Promise<boolean> =>
    invoke('schedule_add', { req: toRustScheduleRequest(req) }),
  
  scheduleRemove: (scheduleId: string): Promise<boolean> =>
    invoke('schedule_remove', { scheduleId }),
  
  scheduleList: (): Promise<string[]> =>
    invoke('schedule_list'),
};

// ============ 执行器 API ============

export const executorApi = {
  init: (coreThreads: number, maxThreads: number, queueCapacity: number): Promise<boolean> =>
    invoke('executor_init', { coreThreads, maxThreads, queueCapacity }),
  
  submit: (contextId: number): Promise<boolean> =>
    invoke('executor_submit', { contextId }),
  
  shutdown: (): Promise<boolean> =>
    invoke('executor_shutdown'),
};

// ============ 统一导出 ============

export const tauriApi = {
  pool: poolApi,
  metadata: metadataApi,
  config: configApi,
  appConfig: appConfigApi,
  favorites: favoritesApi,
  sqlUtils: sqlUtilsApi,
  json: jsonApi,
  import: importApi,
  export: exportApi,
  backup: backupApi,
  executor: executorApi,
};

export default tauriApi;
