import type * as monaco from 'monaco-editor';
import { getMonacoInstance, getEditorSettings } from './editorSettings';

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
    triggerCharacters: ['.', ' ', '\n', '(', ','],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: monaco.languages.CompletionItem[] = [];

      // 添加关键字补全
      SQL_KEYWORDS.forEach((keyword) => {
        suggestions.push({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword + ' ',
          range,
          sortText: '1' + keyword,
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
          sortText: '2' + func.name,
        });
      });

      // 添加数据类型补全
      SQL_DATA_TYPES.forEach((type) => {
        suggestions.push({
          label: type,
          kind: monaco.languages.CompletionItemKind.TypeParameter,
          insertText: type,
          range,
          sortText: '3' + type,
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
            sortText: '4' + keyword,
          });
        });
      }

      return { suggestions };
    },
  });
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
