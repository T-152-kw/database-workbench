// ============ 基础类型 ============

export interface ConnectionProfile {
  name?: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database?: string;
  // 扩展连接配置
  charset?: string;
  collation?: string;
  timeout?: number; // 空闲超时（wait_timeout），默认 28800 秒（8小时）
  connectionTimeout?: number; // 连接超时，默认 30 秒
  autoReconnect?: boolean; // 自动重连，默认 false（安全优先）
  ssl?: boolean;
  sslMode?: 'disabled' | 'preferred' | 'required' | 'verify-ca' | 'verify-identity';
  sslCaPath?: string;
  sslCertPath?: string;
  sslKeyPath?: string;
}

export type FavoriteType = 'SQL_QUERY' | 'CONNECTION_PROFILE' | 'DATABASE_OBJECT';

export interface FavoriteItem {
  id?: string;
  name: string;
  description?: string;
  type: FavoriteType;
  content?: string;
  createdTime: number;
  lastUsedTime: number;
  usageCount: number;
}

export type DbType = 'MYSQL' | 'POSTGRESQL' | 'SQL_SERVER' | 'ORACLE' | 'SQLITE';

export interface SqlParam {
  type: string;
  value: unknown;
}

export interface UserModel {
  username: string;
  host: string;
  plugin?: string;
  password?: string;
  serverPrivileges: string[];
  databasePrivileges: Record<string, string[]>;
}

// ============ 连接池类型 ============

export interface PoolStats {
  poolId: number;
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  maxSize: number;
  waitingThreads: number;
}

export interface ConnectionProperties {
  connection_status: boolean;
  server_version?: string | null;
  current_database?: string | null;
  connection_charset?: string | null;
  wait_timeout_seconds?: number | null;
  ssl_mode?: string | null;
  table_count?: number | null;
  view_count?: number | null;
  function_count?: number | null;
  procedure_count?: number | null;
}

export interface ColumnMeta {
  name: string;
  label: string;
  typeName: string;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: unknown[][];
}

export interface ExecResult {
  affectedRows: number;
  lastInsertId: number;
}

// ============ 元数据类型 ============

export interface TableDetail {
  Name: string;
  Rows?: number;
  DataLength?: number;
  Engine?: string;
  UpdateTime?: string;
  Comment?: string;
}

export interface ViewDetail {
  Name: string;
  Definition?: string;
  CheckOption?: string;
  IsUpdatable?: string;
  Definer?: string;
  SecurityType?: string;
  CreateTime?: string;
  UpdateTime?: string;
}

export interface FunctionDetail {
  Name: string;
  Type: string;
  DataType?: string;
  Definition?: string;
  IsDeterministic?: string;
  SqlDataAccess?: string;
  SecurityType?: string;
  Definer?: string;
  CreateTime?: string;
  UpdateTime?: string;
  Comment?: string;
}

export interface RoutineParam {
  name: string;
  type: string;
  mode?: string;
}

export interface RoutineDetail {
  name: string;
  type: string;
  returnType?: string;
  params: RoutineParam[];
}

export interface RoutineParamInfo {
  name: string;
  type: string;
  mode?: string;
}

export interface UserSummary {
  username: string;
  host: string;
  plugin?: string;
  status: string;
}

export interface UserModelPayload {
  username: string;
  host: string;
  plugin?: string;
  serverPrivileges: string[];
  databasePrivileges: Record<string, string[]>;
}

// 列、外键、索引、触发器、检查约束使用 Record<string, string>
export type MetadataRecord = Record<string, string>;

// ============ 备份类型 ============

export interface BackupOptions {
  includeData: boolean;
  includeViews: boolean;
  includeRoutines: boolean;
  addDropTable: boolean;
}

export interface BackupRequest {
  conn: ConnectionProfile;
  schema: string;
  mysqldumpPath: string;
  outputPath: string;
  options: BackupOptions;
}

export interface RestoreRequest {
  conn: ConnectionProfile;
  targetSchema: string;
  mysqlPath: string;
  inputPath: string;
  createSchema: boolean;
}

export interface IncrementalRequest {
  conn: ConnectionProfile;
  schema: string;
  outputDir: string;
  binlogIndexPath: string;
  mysqlbinlogPath?: string;
}

export interface ScheduleRequest {
  scheduleId: string;
  cron: string;
  backup: BackupRequest;
}

export interface BackupResult {
  outputPath: string;
  durationMs: number;
}

export interface RestoreResult {
  durationMs: number;
}

export interface IncrementalResult {
  outputFile: string;
  durationMs: number;
}

// ============ 导入导出类型 ============

export interface ExportResult {
  success: boolean;
  rowsExported: number;
  filePath: string;
  durationMs: number;
  error?: string;
}

export interface ImportResult {
  success: boolean;
  rowsImported: number;
  durationMs: number;
  error?: string;
}

// ============ 前端专用类型 ============

export type TabType = 
  | 'query' 
  | 'tableList' 
  | 'viewList' 
  | 'functionList' 
  | 'backup'
  | 'restore'
  | 'tableData' 
  | 'viewData'
  | 'designer' 
  | 'erDiagram' 
  | 'viewDesigner' 
  | 'functionDesigner' 
  | 'userManager' 
  | 'userEditor'
  | 'welcome';

export type ObjectType = 'TABLE' | 'VIEW' | 'FUNCTION';

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  connectionId?: string;
  database?: string;
  table?: string;
  objectName?: string;
  objectType?: ObjectType;
  isModified?: boolean;
  data?: unknown;
  sqlContent?: string;
  sqlFilePath?: string;
  connectionProfile?: ConnectionProfile;
}

// Query execution result types
export interface QueryResultColumn {
  name: string;
  label: string;
  type_name: string;
}

export interface QueryResultData {
  columns: QueryResultColumn[];
  rows: unknown[][];
}

export interface MultiQueryResultData {
  result_sets: QueryResultData[];
  affected_rows: number;
  last_insert_id: number;
}

export interface ExecResultData {
  affected_rows: number;
  last_insert_id: number;
}

export type ResultTabType = 'query' | 'update' | 'error';

export interface ResultTab {
  id: string;
  type: ResultTabType;
  title: string;
  data: QueryResultData | ExecResultData | string;
  sql: string;
  executionTime?: number;
}

export interface QueryTabState {
  sqlContent: string;
  selectedConnection?: ConnectionProfile;
  selectedDatabase?: string;
  isConnected: boolean;
  isExecuting: boolean;
  autoCommit: boolean;
  resultTabs: ResultTab[];
  activeResultTabId: string | null;
  statusMessage: string;
  connectionInfo: string;
}

export type TreeNodeType = 
  | 'connection' 
  | 'database' 
  | 'tables' 
  | 'views' 
  | 'functions' 
  | 'table' 
  | 'view' 
  | 'function' 
  | 'column' 
  | 'index' 
  | 'foreignKey' 
  | 'trigger' 
  | 'check';

export interface TreeNode {
  id: string;
  label: string;
  nodeType: TreeNodeType;
  icon?: string;
  isExpanded?: boolean;
  isLoading?: boolean;
  children?: TreeNode[];
  parentId?: string;
  data?: unknown;
}

export interface ConnectionState {
  profile: ConnectionProfile;
  poolId?: number;
  isConnected: boolean;
  isConnecting: boolean;
  error?: string;
}

export type Theme = 'light' | 'dark';

export interface AppState {
  theme: Theme;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
}
