import type * as monaco from 'monaco-editor';
import { getMonacoInstance, getEditorSettings } from './editorSettings';
import { metadataApi } from '../hooks/useTauri';
import type { ConnectionProfile, MetadataRecord } from '../types';

// SQL 关键字列表
const SQL_KEYWORDS = [
  // DML
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'INTO', 'VALUES', 'SET',
  // DDL
  'CREATE', 'ALTER', 'DROP', 'TABLE', 'DATABASE', 'INDEX', 'VIEW', 'TRIGGER',
  'FUNCTION', 'PROCEDURE', 'SCHEMA', 'COLUMN', 'ADD', 'MODIFY', 'RENAME', 'TO',
  // DCL
  'GRANT', 'REVOKE', 'PRIVILEGES', 'ON', 'TO', 'FROM', 'ALL',
  // TCL
  'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'TRANSACTION', 'BEGIN', 'END',
  // 查询修饰符
  'DISTINCT', 'ALL', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'EXISTS',
  'BETWEEN', 'LIKE', 'ESCAPE', 'LIMIT', 'OFFSET', 'TOP',
  // JOIN
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL', 'ON',
  'USING',
  // 聚合
  'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC',
  // 条件
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IF', 'ELSEIF', 'WHILE', 'LOOP',
  // 其他
  'UNION', 'INTERSECT', 'EXCEPT', 'WITH', 'RECURSIVE', 'OVER', 'PARTITION',
  'ROWS', 'RANGE', 'PRECEDING', 'FOLLOWING', 'CURRENT', 'ROW',
  // MySQL 特有
  'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'USE', 'CHANGE', 'MASTER', 'SLAVE',
  'START', 'STOP', 'RESET', 'PURGE', 'FLUSH', 'KILL', 'CALL', 'DELIMITER',
  // 约束
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT',
  'AUTO_INCREMENT', 'NOT NULL', 'CASCADE', 'RESTRICT', 'NO ACTION',
  // 引擎和字符集
  'ENGINE', 'CHARSET', 'COLLATE', 'CHARACTER', 'SET', 'COMMENT',
];

// SQL 函数列表
const SQL_FUNCTIONS = [
  // 聚合函数
  { name: 'COUNT', snippet: 'COUNT(${1:*})', desc: '返回匹配条件的行数' },
  { name: 'SUM', snippet: 'SUM(${1:column})', desc: '返回数值列的总和' },
  { name: 'AVG', snippet: 'AVG(${1:column})', desc: '返回数值列的平均值' },
  { name: 'MAX', snippet: 'MAX(${1:column})', desc: '返回列的最大值' },
  { name: 'MIN', snippet: 'MIN(${1:column})', desc: '返回列的最小值' },
  { name: 'GROUP_CONCAT', snippet: 'GROUP_CONCAT(${1:column})', desc: '将分组中的字符串连接' },
  // 字符串函数
  { name: 'CONCAT', snippet: 'CONCAT(${1:str1}, ${2:str2})', desc: '连接两个或多个字符串' },
  { name: 'SUBSTRING', snippet: 'SUBSTRING(${1:str}, ${2:start}, ${3:length})', desc: '提取子字符串' },
  { name: 'LEFT', snippet: 'LEFT(${1:str}, ${2:length})', desc: '从左侧提取字符' },
  { name: 'RIGHT', snippet: 'RIGHT(${1:str}, ${2:length})', desc: '从右侧提取字符' },
  { name: 'LENGTH', snippet: 'LENGTH(${1:str})', desc: '返回字符串长度' },
  { name: 'CHAR_LENGTH', snippet: 'CHAR_LENGTH(${1:str})', desc: '返回字符数' },
  { name: 'TRIM', snippet: 'TRIM(${1:str})', desc: '去除字符串两端空格' },
  { name: 'LTRIM', snippet: 'LTRIM(${1:str})', desc: '去除字符串左侧空格' },
  { name: 'RTRIM', snippet: 'RTRIM(${1:str})', desc: '去除字符串右侧空格' },
  { name: 'UPPER', snippet: 'UPPER(${1:str})', desc: '转换为大写' },
  { name: 'LOWER', snippet: 'LOWER(${1:str})', desc: '转换为小写' },
  { name: 'REPLACE', snippet: 'REPLACE(${1:str}, ${2:from}, ${3:to})', desc: '替换字符串' },
  { name: 'INSTR', snippet: 'INSTR(${1:str}, ${2:substr})', desc: '返回子字符串位置' },
  { name: 'LOCATE', snippet: 'LOCATE(${1:substr}, ${2:str})', desc: '返回子字符串位置' },
  // 日期时间函数
  { name: 'NOW', snippet: 'NOW()', desc: '返回当前日期时间' },
  { name: 'CURDATE', snippet: 'CURDATE()', desc: '返回当前日期' },
  { name: 'CURTIME', snippet: 'CURTIME()', desc: '返回当前时间' },
  { name: 'DATE', snippet: 'DATE(${1:datetime})', desc: '提取日期部分' },
  { name: 'TIME', snippet: 'TIME(${1:datetime})', desc: '提取时间部分' },
  { name: 'YEAR', snippet: 'YEAR(${1:date})', desc: '提取年份' },
  { name: 'MONTH', snippet: 'MONTH(${1:date})', desc: '提取月份' },
  { name: 'DAY', snippet: 'DAY(${1:date})', desc: '提取日期' },
  { name: 'HOUR', snippet: 'HOUR(${1:time})', desc: '提取小时' },
  { name: 'MINUTE', snippet: 'MINUTE(${1:time})', desc: '提取分钟' },
  { name: 'SECOND', snippet: 'SECOND(${1:time})', desc: '提取秒' },
  { name: 'DATE_FORMAT', snippet: 'DATE_FORMAT(${1:date}, ${2:format})', desc: '格式化日期' },
  { name: 'STR_TO_DATE', snippet: 'STR_TO_DATE(${1:str}, ${2:format})', desc: '字符串转日期' },
  { name: 'DATEDIFF', snippet: 'DATEDIFF(${1:date1}, ${2:date2})', desc: '计算日期差' },
  { name: 'TIMESTAMPDIFF', snippet: 'TIMESTAMPDIFF(${1:unit}, ${2:date1}, ${3:date2})', desc: '计算时间差' },
  { name: 'DATE_ADD', snippet: 'DATE_ADD(${1:date}, INTERVAL ${2:expr} ${3:unit})', desc: '日期加法' },
  { name: 'DATE_SUB', snippet: 'DATE_SUB(${1:date}, INTERVAL ${2:expr} ${3:unit})', desc: '日期减法' },
  // 数学函数
  { name: 'ABS', snippet: 'ABS(${1:number})', desc: '返回绝对值' },
  { name: 'ROUND', snippet: 'ROUND(${1:number}, ${2:decimals})', desc: '四舍五入' },
  { name: 'CEIL', snippet: 'CEIL(${1:number})', desc: '向上取整' },
  { name: 'FLOOR', snippet: 'FLOOR(${1:number})', desc: '向下取整' },
  { name: 'MOD', snippet: 'MOD(${1:n}, ${2:m})', desc: '取模运算' },
  { name: 'POWER', snippet: 'POWER(${1:base}, ${2:exp})', desc: '幂运算' },
  { name: 'SQRT', snippet: 'SQRT(${1:number})', desc: '平方根' },
  { name: 'RAND', snippet: 'RAND()', desc: '随机数' },
  // 类型转换
  { name: 'CAST', snippet: 'CAST(${1:expr} AS ${2:type})', desc: '类型转换' },
  { name: 'CONVERT', snippet: 'CONVERT(${1:expr}, ${2:type})', desc: '类型转换' },
  // 条件函数
  { name: 'IF', snippet: 'IF(${1:condition}, ${2:true_value}, ${3:false_value})', desc: '条件判断' },
  { name: 'IFNULL', snippet: 'IFNULL(${1:expr}, ${2:replacement})', desc: 'NULL 替换' },
  { name: 'COALESCE', snippet: 'COALESCE(${1:expr1}, ${2:expr2})', desc: '返回第一个非 NULL 值' },
  { name: 'NULLIF', snippet: 'NULLIF(${1:expr1}, ${2:expr2})', desc: '相等时返回 NULL' },
  { name: 'CASE', snippet: 'CASE\n  WHEN ${1:condition} THEN ${2:value}\n  ELSE ${3:default}\nEND', desc: '多条件判断' },
];

// SQL 数据类型
const SQL_DATA_TYPES = [
  // 整数类型
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
  // 浮点类型
  'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL',
  // 字符串类型
  'CHAR', 'VARCHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB', 'BINARY', 'VARBINARY',
  // 日期时间类型
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  // 其他类型
  'BOOLEAN', 'BOOL', 'ENUM', 'SET', 'JSON', 'BIT', 'GEOMETRY',
];

// 存储过程和函数关键字
const ROUTINE_KEYWORDS = [
  'DECLARE', 'SET', 'RETURN', 'RETURNS', 'DETERMINISTIC', 'NOT DETERMINISTIC',
  'READS SQL DATA', 'MODIFIES SQL DATA', 'NO SQL', 'CONTAINS SQL',
  'IN', 'OUT', 'INOUT', 'EXIT', 'CONTINUE', 'HANDLER', 'FOR',
  'SQLEXCEPTION', 'SQLWARNING', 'NOT FOUND',
];

let completionProviderDisposable: monaco.IDisposable | null = null;
let enableRoutineKeywordsFlag: boolean = false;

interface CompletionContext {
  profile: ConnectionProfile;
  database?: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TABLE_CACHE_TTL_MS = 20_000;
const COLUMN_CACHE_TTL_MS = 20_000;
const DATABASE_CACHE_TTL_MS = 60_000;
let completionContext: CompletionContext | null = null;
const databaseListCache = new Map<string, CacheEntry<string[]>>();
const databaseListInFlight = new Map<string, Promise<string[]>>();
const tableListCache = new Map<string, CacheEntry<string[]>>();
const tableListInFlight = new Map<string, Promise<string[]>>();
const columnCache = new Map<string, CacheEntry<string[]>>();
const columnInFlight = new Map<string, Promise<string[]>>();

interface TableRef {
  database?: string;
  table: string;
}

interface StatementContext {
  clause: 'select' | 'from' | 'groupBy' | 'generic';
  statementSql: string;
  beforeCursorSql: string;
  tableRefs: TableRef[];
  aliasMap: Map<string, TableRef>;
  selectedFields: string[];
  hasSelectStar: boolean;
  cteNames: Set<string>;
  cteFieldMap: Map<string, string[]>;
  localRelationNames: Set<string>;
}

interface DotCompletionContext {
  qualifierParts: string[];
}

interface StatementWindow {
  statementSql: string;
  beforeCursorSql: string;
}

function getProfileCacheKey(profile: ConnectionProfile): string {
  return [
    profile.host,
    profile.port,
    profile.username,
    profile.database ?? '',
    profile.sslMode ?? '',
    profile.sslCaPath ?? '',
  ].join('|');
}

function getContextKey(context: CompletionContext): string {
  return `${getProfileCacheKey(context.profile)}|${context.database ?? ''}`;
}

function getContextProfileKey(context: CompletionContext): string {
  return getProfileCacheKey(context.profile);
}

function parseColumnNames(rows: MetadataRecord[]): string[] {
  return rows
    .map((row) => row.COLUMN_NAME)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

function readCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  return null;
}

function normalizePart(part: string): string {
  const trimmed = part.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/``/g, '`').trim();
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim();
  }

  return trimmed;
}

function splitQualifiedIdentifier(input: string): string[] {
  const result: string[] = [];
  let current = '';
  let inBacktick = false;
  let inDoubleQuote = false;

  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index];

    if (ch === '`' && !inDoubleQuote) {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }

    if (ch === '"' && !inBacktick) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    if (ch === '.' && !inBacktick && !inDoubleQuote) {
      result.push(normalizePart(current));
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    result.push(normalizePart(current));
  }

  return result.filter((part) => part.length > 0);
}

function parseTableRef(raw: string): TableRef | null {
  const parts = splitQualifiedIdentifier(raw);
  if (parts.length === 0) return null;

  if (parts.length === 1) {
    return { table: parts[0] };
  }

  return {
    database: parts[parts.length - 2],
    table: parts[parts.length - 1],
  };
}

function tableRefKey(tableRef: TableRef): string {
  return `${(tableRef.database || '').toLowerCase()}|${tableRef.table.toLowerCase()}`;
}

function quoteIdentifier(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

function buildQualifiedTableName(tableRef: TableRef): string {
  if (tableRef.database) {
    return `${quoteIdentifier(tableRef.database)}.${quoteIdentifier(tableRef.table)}`;
  }
  return quoteIdentifier(tableRef.table);
}

async function loadDatabasesForContext(context: CompletionContext): Promise<string[]> {
  const cacheKey = `databases:${getContextProfileKey(context)}`;
  const cached = readCachedValue(databaseListCache, cacheKey);
  if (cached) return cached;

  const pending = databaseListInFlight.get(cacheKey);
  if (pending) return pending;

  const request = metadataApi
    .listDatabases(context.profile)
    .then((databases) => {
      databaseListCache.set(cacheKey, {
        value: databases,
        expiresAt: Date.now() + DATABASE_CACHE_TTL_MS,
      });
      return databases;
    })
    .finally(() => {
      databaseListInFlight.delete(cacheKey);
    });

  databaseListInFlight.set(cacheKey, request);
  return request;
}

async function loadTablesForContext(context: CompletionContext): Promise<string[]> {
  if (!context.database) return [];

  const contextKey = getContextKey(context);
  const cacheKey = `tables:${contextKey}`;
  const cached = readCachedValue(tableListCache, cacheKey);
  if (cached) return cached;

  const pending = tableListInFlight.get(cacheKey);
  if (pending) return pending;

  const request = metadataApi
    .listTables(context.profile, context.database)
    .then((tables) => {
      tableListCache.set(cacheKey, {
        value: tables,
        expiresAt: Date.now() + TABLE_CACHE_TTL_MS,
      });
      return tables;
    })
    .finally(() => {
      tableListInFlight.delete(cacheKey);
    });

  tableListInFlight.set(cacheKey, request);
  return request;
}

async function loadTablesForDatabase(context: CompletionContext, database: string): Promise<string[]> {
  if (!database) return [];

  const contextKey = getContextProfileKey(context);
  const cacheKey = `tables:${contextKey}:${database.toLowerCase()}`;
  const cached = readCachedValue(tableListCache, cacheKey);
  if (cached) return cached;

  const pending = tableListInFlight.get(cacheKey);
  if (pending) return pending;

  const request = metadataApi
    .listTables(context.profile, database)
    .then((tables) => {
      tableListCache.set(cacheKey, {
        value: tables,
        expiresAt: Date.now() + TABLE_CACHE_TTL_MS,
      });
      return tables;
    })
    .finally(() => {
      tableListInFlight.delete(cacheKey);
    });

  tableListInFlight.set(cacheKey, request);
  return request;
}

async function loadColumnsForTable(
  context: CompletionContext,
  tableRef: TableRef
): Promise<string[]> {
  const targetDatabase = tableRef.database || context.database;
  if (!targetDatabase || !tableRef.table) return [];

  const contextKey = getContextProfileKey(context);
  const cacheKey = `columns:${contextKey}:${targetDatabase.toLowerCase()}:${tableRef.table.toLowerCase()}`;
  const cached = readCachedValue(columnCache, cacheKey);
  if (cached) return cached;

  const pending = columnInFlight.get(cacheKey);
  if (pending) return pending;

  const request = metadataApi
    .listColumns(context.profile, targetDatabase, tableRef.table)
    .then((rows) => {
      const columns = parseColumnNames(rows);
      columnCache.set(cacheKey, {
        value: columns,
        expiresAt: Date.now() + COLUMN_CACHE_TTL_MS,
      });
      return columns;
    })
    .finally(() => {
      columnInFlight.delete(cacheKey);
    });

  columnInFlight.set(cacheKey, request);
  return request;
}

function normalizeIdentifier(identifier: string): string {
  const parts = splitQualifiedIdentifier(identifier);
  if (parts.length === 0) return '';
  return parts[parts.length - 1];
}

function extractStatementWindow(fullSql: string, cursorOffset: number): StatementWindow {
  let start = 0;
  for (let index = cursorOffset - 1; index >= 0; index -= 1) {
    if (fullSql[index] === ';') {
      start = index + 1;
      break;
    }
  }

  let end = fullSql.length;
  for (let index = cursorOffset; index < fullSql.length; index += 1) {
    if (fullSql[index] === ';') {
      end = index;
      break;
    }
  }

  const statementSql = fullSql.slice(start, end);
  const statementCursorOffset = Math.max(0, Math.min(statementSql.length, cursorOffset - start));
  const beforeCursorSql = statementSql.slice(0, statementCursorOffset);

  return {
    statementSql,
    beforeCursorSql,
  };
}

function splitTopLevelByComma(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;

  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index];

    if (ch === '\\') {
      current += ch;
      if (index + 1 < input.length) {
        index += 1;
        current += input[index];
      }
      continue;
    }

    if (!inDoubleQuote && !inBacktick && ch === '\'') {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }

    if (!inSingleQuote && !inBacktick && ch === '"') {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && ch === '`') {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (ch === '(') depth += 1;
      if (ch === ')' && depth > 0) depth -= 1;

      if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
    }

    current += ch;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  return parts;
}

function extractSelectedFields(statementSql: string): { fields: string[]; hasStar: boolean } {
  const match = statementSql.match(/\bselect\b([\s\S]*?)(\bfrom\b|$)/i);
  if (!match) {
    return { fields: [], hasStar: false };
  }

  const selectList = match[1] || '';
  const hasStar = /(^|\s|,)\*(\s|,|$)/.test(selectList) || /\w+\.\*/.test(selectList);
  if (hasStar) {
    return { fields: [], hasStar: true };
  }

  const fields = splitTopLevelByComma(selectList)
    .map((segment) => {
      const asMatch = segment.match(/\bas\s+([`"\w$]+)$/i);
      if (asMatch) {
        return normalizeIdentifier(asMatch[1]);
      }

      const simpleAlias = segment.match(/([`"\w$]+)$/);
      const core = simpleAlias ? simpleAlias[1] : segment;
      return normalizeIdentifier(core);
    })
    .filter((field) => field.length > 0);

  return { fields, hasStar };
}

function extractCteNames(statementSql: string): Set<string> {
  const cteNames = new Set<string>();
  const withMatch = statementSql.match(/^\s*with\s+([\s\S]+)/i);
  if (!withMatch) return cteNames;

  const regex = /([`"\w$]+)\s+as\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(statementSql)) !== null) {
    const cteName = normalizeIdentifier(match[1]);
    if (cteName) {
      cteNames.add(cteName.toLowerCase());
    }
  }

  return cteNames;
}

function extractCteFieldMap(statementSql: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const regex = /([`"\w$]+)\s+as\s*\(\s*select\s+([\s\S]*?)\s+from[\s\S]*?\)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(statementSql)) !== null) {
    const cteName = normalizeIdentifier(match[1]).toLowerCase();
    const selectList = match[2] || '';
    const fields = splitTopLevelByComma(selectList)
      .map((segment) => {
        const asMatch = segment.match(/\bas\s+([`"\w$]+)$/i);
        if (asMatch) return normalizeIdentifier(asMatch[1]);
        const tail = segment.match(/([`"\w$]+)$/);
        return normalizeIdentifier(tail ? tail[1] : segment);
      })
      .filter((field) => field.length > 0);

    if (cteName && fields.length > 0) {
      map.set(cteName, fields);
    }
  }

  return map;
}

function extractDerivedTableAliases(statementSql: string): Set<string> {
  const aliases = new Set<string>();
  const regex = /\b(?:from|join)\s*\([\s\S]*?\)\s*(?:as\s+)?([`"\w$]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(statementSql)) !== null) {
    const alias = normalizeIdentifier(match[1]);
    if (alias) aliases.add(alias.toLowerCase());
  }
  return aliases;
}

function extractTableAliasMap(statementSql: string): Map<string, TableRef> {
  const aliasMap = new Map<string, TableRef>();
  const regex = /\b(?:from|join|update|into)\s+([^\s,()]+)(?:\s+(?:as\s+)?([`"\w$]+))?/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(statementSql)) !== null) {
    const tableRef = parseTableRef(match[1] || '');
    if (!tableRef) continue;
    const rawAlias = normalizeIdentifier(match[2] || '');

    aliasMap.set(tableRef.table.toLowerCase(), tableRef);
    if (rawAlias) {
      aliasMap.set(rawAlias.toLowerCase(), tableRef);
    }
  }

  return aliasMap;
}

function collectStatementTables(aliasMap: Map<string, TableRef>): TableRef[] {
  const values = new Map<string, TableRef>();
  aliasMap.forEach((tableRef) => {
    values.set(tableRefKey(tableRef), tableRef);
  });
  return Array.from(values.values());
}

function detectClauseContext(beforeCursorSql: string): StatementContext['clause'] {
  const normalized = beforeCursorSql.toLowerCase();
  if (/\bgroup\s+by\s+[^;]*$/i.test(normalized)) return 'groupBy';
  if (/\b(from|join|update|into|table|describe|desc|truncate)\s+[^;]*$/i.test(normalized)) return 'from';
  if (/\bselect\b[\s\S]*$/i.test(normalized) && !/\bfrom\b/i.test(normalized)) return 'select';
  return 'generic';
}

function extractDotCompletionContext(beforeCursorSql: string): DotCompletionContext | null {
  const trimmedRight = beforeCursorSql.replace(/\s+$/, '');
  if (!trimmedRight.endsWith('.')) return null;

  const source = trimmedRight.slice(0, -1);
  let index = source.length - 1;
  while (index >= 0) {
    const ch = source[index];
    const isBreak = /[\s,;()+\-*/=%<>!]/.test(ch);
    if (isBreak) break;
    index -= 1;
  }

  const token = source.slice(index + 1);
  const parts = splitQualifiedIdentifier(token);
  if (parts.length === 0) return null;

  return { qualifierParts: parts };
}

function buildStatementContext(statementSql: string, beforeCursorSql: string): StatementContext {
  const aliasMap = extractTableAliasMap(statementSql);
  const tableRefs = collectStatementTables(aliasMap);
  const selectedFieldInfo = extractSelectedFields(statementSql);
  const cteNames = extractCteNames(statementSql);
  const cteFieldMap = extractCteFieldMap(statementSql);
  const derivedAliases = extractDerivedTableAliases(statementSql);
  const localRelationNames = new Set<string>([...cteNames, ...derivedAliases]);

  return {
    clause: detectClauseContext(beforeCursorSql),
    statementSql,
    beforeCursorSql,
    tableRefs,
    aliasMap,
    selectedFields: selectedFieldInfo.fields,
    hasSelectStar: selectedFieldInfo.hasStar,
    cteNames,
    cteFieldMap,
    localRelationNames,
  };
}

function createTableSuggestions(
  monaco: typeof import('monaco-editor'),
  tables: string[],
  range: monaco.IRange,
  priority: number,
  database?: string,
  withDatabasePrefix: boolean = false
): monaco.languages.CompletionItem[] {
  return tables.map((table) => ({
    label: withDatabasePrefix && database ? `${database}.${table}` : table,
    kind: monaco.languages.CompletionItemKind.Class,
    insertText: withDatabasePrefix && database
      ? `${quoteIdentifier(database)}.${quoteIdentifier(table)}`
      : quoteIdentifier(table),
    detail: database ? `Table (${database})` : 'Table',
    range,
    sortText: `${String(priority).padStart(2, '0')}_table_${(database || '').toLowerCase()}_${table.toLowerCase()}`,
  }));
}

function createDatabaseSuggestions(
  monaco: typeof import('monaco-editor'),
  databases: string[],
  range: monaco.IRange,
  priority: number,
  appendDot: boolean
): monaco.languages.CompletionItem[] {
  return databases.map((database) => ({
    label: database,
    kind: monaco.languages.CompletionItemKind.Module,
    insertText: appendDot ? `${quoteIdentifier(database)}.` : quoteIdentifier(database),
    detail: 'Database',
    range,
    sortText: `${String(priority).padStart(2, '0')}_db_${database.toLowerCase()}`,
  }));
}

function createColumnSuggestions(
  monaco: typeof import('monaco-editor'),
  tableRef: TableRef,
  columns: string[],
  range: monaco.IRange,
  useQualifiedName: boolean,
  priority: number
): monaco.languages.CompletionItem[] {
  const tableDisplay = tableRef.database ? `${tableRef.database}.${tableRef.table}` : tableRef.table;
  return columns.map((column) => ({
    label: column,
    kind: monaco.languages.CompletionItemKind.Field,
    insertText: useQualifiedName
      ? `${buildQualifiedTableName(tableRef)}.${quoteIdentifier(column)}`
      : quoteIdentifier(column),
    detail: `Column (${tableDisplay})`,
    range,
    sortText: `${String(priority).padStart(2, '0')}_col_${tableDisplay.toLowerCase()}_${column.toLowerCase()}`,
  }));
}

function createSelectedFieldSuggestions(
  monaco: typeof import('monaco-editor'),
  selectedFields: string[],
  range: monaco.IRange,
  priority: number
): monaco.languages.CompletionItem[] {
  return selectedFields.map((field) => ({
    label: field,
    kind: monaco.languages.CompletionItemKind.Field,
    insertText: field,
    detail: 'Selected field',
    range,
    sortText: `${String(priority).padStart(2, '0')}_selected_${field.toLowerCase()}`,
  }));
}

function createLocalRelationSuggestions(
  monaco: typeof import('monaco-editor'),
  names: string[],
  range: monaco.IRange,
  priority: number
): monaco.languages.CompletionItem[] {
  return names.map((name) => ({
    label: name,
    kind: monaco.languages.CompletionItemKind.Variable,
    insertText: quoteIdentifier(name),
    detail: 'CTE/Derived relation',
    range,
    sortText: `${String(priority).padStart(2, '0')}_local_${name.toLowerCase()}`,
  }));
}

function dedupeSuggestions(
  suggestions: monaco.languages.CompletionItem[]
): monaco.languages.CompletionItem[] {
  const seen = new Set<string>();
  const result: monaco.languages.CompletionItem[] = [];

  suggestions.forEach((item) => {
    const label = typeof item.label === 'string' ? item.label : item.label.label;
    const key = `${label}:${item.kind ?? ''}:${item.insertText}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });

  return result;
}

/**
 * 注册 SQL 自动补全提供程序
 */
export function registerSQLCompletionProvider(
  monaco: typeof import('monaco-editor'),
  enableRoutineKeywords: boolean = false
): void {
  // 保存配置
  enableRoutineKeywordsFlag = enableRoutineKeywords;

  // 如果已经注册，先注销
  unregisterSQLCompletionProvider();

  completionProviderDisposable = monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' ', '(', ','],
    provideCompletionItems: async (model, position) => {
      const context = completionContext;
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: monaco.languages.CompletionItem[] = [];

      const fullSql = model.getValue();
      const cursorOffset = model.getOffsetAt(position);
      const statementWindow = extractStatementWindow(fullSql, cursorOffset);
      const statementContext = buildStatementContext(
        statementWindow.statementSql,
        statementWindow.beforeCursorSql,
      );
      const dotContext = extractDotCompletionContext(statementWindow.beforeCursorSql);

      const keywordPriority = statementContext.clause === 'from' ? 40 : statementContext.clause === 'select' ? 30 : statementContext.clause === 'groupBy' ? 28 : 20;
      const functionPriority = statementContext.clause === 'select' ? 14 : 24;
      const dataTypePriority = statementContext.clause === 'from' ? 45 : 26;

      // 添加关键字补全
      SQL_KEYWORDS.forEach((keyword) => {
        suggestions.push({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword + ' ',
          range,
          sortText: `${String(keywordPriority).padStart(2, '0')}_keyword_${keyword.toLowerCase()}`,
        });
      });

      // 添加函数补全
      SQL_FUNCTIONS.forEach((func) => {
        suggestions.push({
          label: {
            label: func.name + '()',
            description: func.desc,
          },
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: func.snippet,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: func.desc,
          range,
          sortText: `${String(functionPriority).padStart(2, '0')}_func_${func.name.toLowerCase()}`,
        });
      });

      // 添加数据类型补全
      SQL_DATA_TYPES.forEach((type) => {
        suggestions.push({
          label: type,
          kind: monaco.languages.CompletionItemKind.TypeParameter,
          insertText: type,
          range,
          sortText: `${String(dataTypePriority).padStart(2, '0')}_type_${type.toLowerCase()}`,
        });
      });

      // 添加存储过程/函数关键字（可选）
      if (enableRoutineKeywords) {
        ROUTINE_KEYWORDS.forEach((keyword) => {
          suggestions.push({
            label: keyword,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: keyword + ' ',
            range,
            sortText: `34_routine_${keyword.toLowerCase()}`,
          });
        });
      }

      if (context?.database) {
        try {
          if (dotContext) {
            const parts = dotContext.qualifierParts;

            if (parts.length >= 2) {
              const tableRef: TableRef = {
                database: parts[parts.length - 2],
                table: parts[parts.length - 1],
              };
              const columns = await loadColumnsForTable(context, tableRef);
              suggestions.push(...createColumnSuggestions(monaco, tableRef, columns, range, false, 2));
            } else {
              const qualifier = parts[0];
              const aliasRef = statementContext.aliasMap.get(qualifier.toLowerCase());

              if (aliasRef) {
                const qualifierKey = qualifier.toLowerCase();
                if (statementContext.cteFieldMap.has(qualifierKey)) {
                  const cteFields = statementContext.cteFieldMap.get(qualifierKey) || [];
                  const cteTableRef: TableRef = { table: qualifier };
                  suggestions.push(...createColumnSuggestions(monaco, cteTableRef, cteFields, range, false, 1));
                } else if (!statementContext.localRelationNames.has(aliasRef.table.toLowerCase())) {
                  const columns = await loadColumnsForTable(context, aliasRef);
                  suggestions.push(...createColumnSuggestions(monaco, aliasRef, columns, range, false, 2));
                }
              } else {
                const tablesInQualifierDb = await loadTablesForDatabase(context, qualifier);
                if (tablesInQualifierDb.length > 0) {
                  suggestions.push(
                    ...createTableSuggestions(monaco, tablesInQualifierDb, range, 3, qualifier, false)
                  );
                }
              }
            }
          } else {
            if (statementContext.localRelationNames.size > 0) {
              const localNames = Array.from(statementContext.localRelationNames);
              const localPriority = statementContext.clause === 'from' ? 2 : 9;
              suggestions.push(...createLocalRelationSuggestions(monaco, localNames, range, localPriority));
            }

            if (statementContext.clause === 'from') {
              const tables = await loadTablesForContext(context);
              suggestions.push(...createTableSuggestions(monaco, tables, range, 4));

              const databases = await loadDatabasesForContext(context);
              suggestions.push(...createDatabaseSuggestions(monaco, databases, range, 6, true));
            }

            if (statementContext.clause === 'groupBy' && !statementContext.hasSelectStar && statementContext.selectedFields.length > 0) {
              suggestions.push(
                ...createSelectedFieldSuggestions(monaco, statementContext.selectedFields, range, 1)
              );
            }

            if (statementContext.tableRefs.length > 0) {
              const columnResults = await Promise.all(statementContext.tableRefs.map(async (tableRef) => {
                const tableKey = tableRef.table.toLowerCase();
                if (statementContext.cteFieldMap.has(tableKey)) {
                  return {
                    tableRef,
                    columns: statementContext.cteFieldMap.get(tableKey) || [],
                  };
                }

                if (statementContext.localRelationNames.has(tableKey)) {
                  return {
                    tableRef,
                    columns: [] as string[],
                  };
                }

                return {
                  tableRef,
                  columns: await loadColumnsForTable(context, tableRef),
                };
              }));

              const columnPriority = statementContext.clause === 'groupBy'
                ? 3
                : statementContext.clause === 'select'
                  ? 2
                  : 12;

              columnResults.forEach(({ tableRef, columns }) => {
                if (columns.length === 0) return;
                suggestions.push(...createColumnSuggestions(monaco, tableRef, columns, range, false, columnPriority));
              });
            }
          }
        } catch {
          // Keep base keyword/function completion available even if metadata lookup fails.
        }
      }

      return { suggestions: dedupeSuggestions(suggestions) };
    },
  });
}

/**
 * 设置 SQL 自动补全上下文（连接与数据库）
 */
export function setSQLCompletionContext(context: CompletionContext | null): void {
  completionContext = context;
}

/**
 * 清理 SQL 自动补全元数据缓存
 */
export function clearSQLCompletionMetadataCache(): void {
  databaseListCache.clear();
  databaseListInFlight.clear();
  tableListCache.clear();
  tableListInFlight.clear();
  columnCache.clear();
  columnInFlight.clear();
}

if (
  typeof window !== 'undefined' &&
  !(window as Window & { __dbwSqlCompletionCacheHooked?: boolean }).__dbwSqlCompletionCacheHooked
) {
  window.addEventListener('dbw:global-refresh', clearSQLCompletionMetadataCache);
  (window as Window & { __dbwSqlCompletionCacheHooked?: boolean }).__dbwSqlCompletionCacheHooked = true;
}

/**
 * 注销 SQL 自动补全提供程序
 */
export function unregisterSQLCompletionProvider(): void {
  if (completionProviderDisposable) {
    completionProviderDisposable.dispose();
    completionProviderDisposable = null;
  }
}

/**
 * 根据设置更新自动补全状态
 */
export function updateCompletionProviderState(): void {
  const monaco = getMonacoInstance();
  if (!monaco) return;

  const settings = getEditorSettings();
  const isRegistered = isCompletionProviderRegistered();

  if (settings.editorAutoComplete && !isRegistered) {
    // 开启自动补全
    registerSQLCompletionProvider(monaco, enableRoutineKeywordsFlag);
  } else if (!settings.editorAutoComplete && isRegistered) {
    // 关闭自动补全
    unregisterSQLCompletionProvider();
  }
}

/**
 * 检查自动补全是否已启用
 */
export function isCompletionProviderRegistered(): boolean {
  return completionProviderDisposable !== null;
}

/**
 * 获取自动补全设置（兼容旧代码）
 */
export function getAutoCompleteSetting(): boolean {
  return getEditorSettings().editorAutoComplete;
}
