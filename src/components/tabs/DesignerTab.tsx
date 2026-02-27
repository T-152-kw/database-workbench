import React, { useState, useEffect, useCallback, useRef } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import {
  Tabs,
  Tab,
  Button,
  TextArea,
  InputGroup,
  HTMLSelect,
  Checkbox,
  FormGroup,
  Intent,
  Spinner,
  Callout,
  OverlayToaster,
} from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import type { ConnectionProfile } from '../../types';
import { metadataApi } from '../../hooks/useTauri';
import { useAppStore, useTabStore } from '../../stores';
import { registerSQLCompletionProvider, updateCompletionProviderState } from '../../utils/sqlCompletionProvider';
import { registerEditor, unregisterEditor, getEditorSettings, applySettingsToAllEditors } from '../../utils/editorSettings';
import '../../styles/designer-tab.css';

import type { Toaster } from '@blueprintjs/core';
let designerToaster: Toaster | null = null;
const getDesignerToaster = async () => {
  if (!designerToaster) {
    designerToaster = await OverlayToaster.create({ position: 'top' });
  }
  return designerToaster;
};

interface DesignerTabProps {
  tabId: string;
  connectionProfile: ConnectionProfile;
  database: string;
  tableName?: string;
}

interface FieldDefinition {
  id: string;
  name: string;
  type: string;
  length: string;
  decimals: string;
  nullable: boolean;
  defaultValue: string | null;
  comment: string;
  isPrimaryKey: boolean;
  autoIncrement: boolean;
  unsigned: boolean;
  zerofill: boolean;
  charset: string;
  collation: string;
  position: number;
  originalName?: string;
  isNew?: boolean;
  isModified?: boolean;
  isDeleted?: boolean;
}

interface IndexDefinition {
  id: string;
  name: string;
  fields: string;
  type: 'NORMAL' | 'UNIQUE' | 'FULLTEXT' | 'SPATIAL';
  method: 'BTREE' | 'HASH';
  comment: string;
  isNew?: boolean;
  isModified?: boolean;
  isDeleted?: boolean;
}

interface ForeignKeyDefinition {
  id: string;
  name: string;
  fields: string;
  refSchema: string;
  refTable: string;
  refFields: string;
  onUpdate: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION';
  onDelete: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION';
  isNew?: boolean;
  isModified?: boolean;
  isDeleted?: boolean;
}

interface CheckDefinition {
  id: string;
  name: string;
  clause: string;
  notEnforced: boolean;
  isNew?: boolean;
  isModified?: boolean;
  isDeleted?: boolean;
}

interface TriggerDefinition {
  id: string;
  name: string;
  timing: 'BEFORE' | 'AFTER';
  insert: boolean;
  update: boolean;
  delete: boolean;
  definition: string;
  isNew?: boolean;
  isModified?: boolean;
  isDeleted?: boolean;
}

interface TableOptions {
  engine: string;
  charset: string;
  collation: string;
  comment: string;
  autoIncrement: string;
}

const MYSQL_DATA_TYPES = [
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
  'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE',
  'CHAR', 'VARCHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB', 'BINARY', 'VARBINARY',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'BOOLEAN', 'BOOL',
  'ENUM', 'SET',
  'JSON',
  'BIT',
];

const MYSQL_ENGINES = ['InnoDB', 'MyISAM', 'MEMORY', 'CSV', 'ARCHIVE', 'BLACKHOLE', 'MERGE', 'FEDERATED'];

const MYSQL_CHARSETS = ['utf8mb4', 'utf8', 'latin1', 'gbk', 'gb2312', 'big5', 'ascii', 'binary'];

// 字符集与排序规则映射
const MYSQL_COLLATIONS: Record<string, string[]> = {
  'utf8mb4': ['utf8mb4_0900_ai_ci', 'utf8mb4_0900_as_ci', 'utf8mb4_0900_as_cs', 'utf8mb4_unicode_ci', 'utf8mb4_general_ci', 'utf8mb4_bin'],
  'utf8': ['utf8_general_ci', 'utf8_unicode_ci', 'utf8_bin'],
  'latin1': ['latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin'],
  'gbk': ['gbk_chinese_ci', 'gbk_bin'],
  'gb2312': ['gb2312_chinese_ci', 'gb2312_bin'],
  'big5': ['big5_chinese_ci', 'big5_bin'],
  'ascii': ['ascii_general_ci', 'ascii_bin'],
  'binary': ['binary'],
};

// 从 DDL 中解析表选项
const parseTableOptionsFromDdl = (ddl: string): Partial<TableOptions> => {
  const options: Partial<TableOptions> = {};
  if (!ddl) return options;

  // 解析引擎
  const engineMatch = ddl.match(/ENGINE\s*=\s*(\w+)/i);
  if (engineMatch) {
    options.engine = engineMatch[1];
  }
  
  // 解析字符集
  const charsetMatch = ddl.match(/CHARSET\s*=\s*(\w+)/i) || ddl.match(/CHARACTER\s+SET\s*=\s*(\w+)/i);
  if (charsetMatch) {
    options.charset = charsetMatch[1];
  }
  
  // 解析排序规则
  const collationMatch = ddl.match(/COLLATE\s*=\s*(\w+)/i);
  if (collationMatch) {
    options.collation = collationMatch[1];
  }
  
  // 解析注释
  const commentMatch = ddl.match(/COMMENT\s*=\s*['"]([^'"]*)['"]/i);
  if (commentMatch) {
    options.comment = commentMatch[1];
  }
  
  // 解析自增值
  const autoIncrementMatch = ddl.match(/AUTO_INCREMENT\s*=\s*(\d+)/i);
  if (autoIncrementMatch) {
    options.autoIncrement = autoIncrementMatch[1];
  }
  
  return options;
};

const INDEX_TYPES = ['NORMAL', 'UNIQUE', 'FULLTEXT', 'SPATIAL'];

const INDEX_METHODS = ['BTREE', 'HASH'];

const FK_ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'];

const TRIGGER_TIMINGS = ['BEFORE', 'AFTER'];

const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// 字符串类型列表
const STRING_DATA_TYPES = ['CHAR', 'VARCHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT', 'BINARY', 'VARBINARY', 'BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB', 'ENUM', 'SET'];

// 判断是否为字符串类型
const isStringType = (type: string): boolean => {
  return STRING_DATA_TYPES.includes(type.toUpperCase());
};

export const DesignerTab: React.FC<DesignerTabProps> = ({
  tabId,
  connectionProfile,
  database,
  tableName,
}) => {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTabId, setSelectedTabId] = useState('fields');
  const [isSaving, setIsSaving] = useState(false);

  const [ddl, setDdl] = useState('');
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [indexes, setIndexes] = useState<IndexDefinition[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyDefinition[]>([]);
  const [checks, setChecks] = useState<CheckDefinition[]>([]);
  const [triggers, setTriggers] = useState<TriggerDefinition[]>([]);
  const [tableOptions, setTableOptions] = useState<TableOptions>({
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collation: 'utf8mb4_0900_ai_ci',
    comment: '',
    autoIncrement: '',
  });

  const [generatedSql, setGeneratedSql] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  // Get theme from app store for Monaco Editor
  const { theme: appTheme } = useAppStore();

  // Selection states
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [selectedIndexId, setSelectedIndexId] = useState<string | null>(null);
  const [selectedFkId, setSelectedFkId] = useState<string | null>(null);
  const [selectedCheckId, setSelectedCheckId] = useState<string | null>(null);
  const [selectedTriggerId, setSelectedTriggerId] = useState<string | null>(null);

  const [currentTableName, setCurrentTableName] = useState(tableName || '');
  const isNewTable = !currentTableName;
  const [newTableName, setNewTableName] = useState('');
  const effectiveTableName = isNewTable ? newTableName.trim() : currentTableName;
  const { updateTab } = useTabStore();

  const loadTableData = useCallback(async (targetTableName?: string) => {
    if (!connectionProfile || !database) return;

    const tableToLoad = targetTableName ?? currentTableName;

    setIsLoading(true);
    setError(null);

    try {
      if (tableToLoad) {
        const [ddlResult, columnsResult, indexesResult, fksResult, checksResult, triggersResult] = await Promise.all([
          metadataApi.loadDdl(connectionProfile, database, tableToLoad),
          metadataApi.listColumns(connectionProfile, database, tableToLoad),
          metadataApi.listIndexes(connectionProfile, database, tableToLoad),
          metadataApi.listForeignKeys(connectionProfile, database, tableToLoad),
          metadataApi.listChecks(connectionProfile, database, tableToLoad),
          metadataApi.listTriggers(connectionProfile, database, tableToLoad),
        ]);

        setDdl(ddlResult);

        const parsedFields: FieldDefinition[] = columnsResult.map((col, index) => ({
          id: generateId(),
          name: col.COLUMN_NAME || '',
          type: (col.DATA_TYPE || '').toUpperCase(),
          length: col.CHARACTER_MAXIMUM_LENGTH || col.NUMERIC_PRECISION || '',
          decimals: col.NUMERIC_SCALE || '',
          nullable: col.IS_NULLABLE === 'YES',
          defaultValue: col.COLUMN_DEFAULT,
          comment: col.COLUMN_COMMENT || '',
          isPrimaryKey: col.COLUMN_KEY === 'PRI',
          autoIncrement: col.EXTRA?.includes('auto_increment') || false,
          unsigned: col.COLUMN_TYPE?.includes('unsigned') || false,
          zerofill: false,
          charset: col.CHARACTER_SET_NAME || '',
          collation: col.COLLATION_NAME || '',
          position: index + 1,
          originalName: col.COLUMN_NAME,
          isNew: false,
          isModified: false,
          isDeleted: false,
        }));
        setFields(parsedFields);

        // Parse indexes - backend returns COLUMNS as comma-separated string
        const parsedIndexes: IndexDefinition[] = indexesResult
          .filter((idx) => idx.INDEX_NAME !== 'PRIMARY') // Skip primary key
          .map((idx) => ({
            id: generateId(),
            name: idx.INDEX_NAME || '',
            fields: idx.COLUMNS || '',
            type: idx.NON_UNIQUE === '0' ? 'UNIQUE' : 'NORMAL',
            method: (idx.INDEX_TYPE as 'BTREE' | 'HASH') || 'BTREE',
            comment: idx.INDEX_COMMENT || '',
            isNew: false,
            isModified: false,
            isDeleted: false,
          }));
        setIndexes(parsedIndexes);

        // Group foreign keys by name
        const fkMap = new Map<string, ForeignKeyDefinition>();
        fksResult.forEach((fk) => {
          const fkName = fk.CONSTRAINT_NAME || '';
          
          if (!fkMap.has(fkName)) {
            fkMap.set(fkName, {
              id: generateId(),
              name: fkName,
              fields: '',
              refSchema: fk.REFERENCED_TABLE_SCHEMA || '',
              refTable: fk.REFERENCED_TABLE_NAME || '',
              refFields: '',
              onUpdate: (fk.UPDATE_RULE || 'RESTRICT') as ForeignKeyDefinition['onUpdate'],
              onDelete: (fk.DELETE_RULE || 'RESTRICT') as ForeignKeyDefinition['onDelete'],
              isNew: false,
              isModified: false,
              isDeleted: false,
            });
          }
          
          const existing = fkMap.get(fkName)!;
          const colName = fk.COLUMN_NAME || '';
          const refColName = fk.REFERENCED_COLUMN_NAME || '';
          existing.fields = existing.fields ? `${existing.fields},${colName}` : colName;
          existing.refFields = existing.refFields ? `${existing.refFields},${refColName}` : refColName;
        });
        setForeignKeys(Array.from(fkMap.values()));

        const parsedChecks: CheckDefinition[] = checksResult.map((chk) => ({
          id: generateId(),
          name: chk.CONSTRAINT_NAME || '',
          clause: chk.CHECK_CLAUSE || '',
          notEnforced: chk.ENFORCED === 'NO' || !chk.ENFORCED,
          isNew: false,
          isModified: false,
          isDeleted: false,
        }));
        setChecks(parsedChecks);

        // Group triggers by name
        const triggerMap = new Map<string, TriggerDefinition>();
        triggersResult.forEach((trg) => {
          const trgName = trg.TRIGGER_NAME || '';
          
          if (!triggerMap.has(trgName)) {
            triggerMap.set(trgName, {
              id: generateId(),
              name: trgName,
              timing: (trg.ACTION_TIMING || 'BEFORE') as TriggerDefinition['timing'],
              insert: false,
              update: false,
              delete: false,
              definition: trg.ACTION_STATEMENT || '',
              isNew: false,
              isModified: false,
              isDeleted: false,
            });
          }
          
          const existing = triggerMap.get(trgName)!;
          const event = trg.EVENT_MANIPULATION;
          if (event === 'INSERT') existing.insert = true;
          if (event === 'UPDATE') existing.update = true;
          if (event === 'DELETE') existing.delete = true;
        });
        setTriggers(Array.from(triggerMap.values()));

        // 从 DDL 中解析表选项
        const parsedOptions = parseTableOptionsFromDdl(ddlResult);
        
        // 确定字符集和排序规则
        let charset = parsedOptions.charset || 'utf8mb4';
        let collation = parsedOptions.collation;
        
        // 如果没有从 DDL 解析到排序规则，使用字符集对应的默认排序规则
        if (!collation && MYSQL_COLLATIONS[charset]) {
          collation = MYSQL_COLLATIONS[charset][0];
        }
        
        setTableOptions({
          engine: parsedOptions.engine || 'InnoDB',
          charset: charset,
          collation: collation || 'utf8mb4_0900_ai_ci',
          comment: parsedOptions.comment || '',
          autoIncrement: parsedOptions.autoIncrement || '',
        });
      } else {
        setFields([{ 
          id: generateId(), 
          name: '', 
          type: 'INT', 
          length: '', 
          decimals: '',
          nullable: false, 
          defaultValue: null, 
          comment: '', 
          isPrimaryKey: false, 
          autoIncrement: false, 
          unsigned: false, 
          zerofill: false, 
          charset: '', 
          collation: '', 
          position: 1, 
          isNew: true, 
          isModified: false, 
          isDeleted: false 
        }]);
      }
    } catch (err) {
      setError(t('designerTab.errors.loadFailed', { error: err }));
    } finally {
      setIsLoading(false);
    }
  }, [connectionProfile, database, currentTableName, t]);

  useEffect(() => {
    loadTableData();
  }, [loadTableData]);

  useEffect(() => {
    const hasAnyChanges = 
      fields.some(f => f.isNew || f.isModified || f.isDeleted) ||
      indexes.some(i => i.isNew || i.isModified || i.isDeleted) ||
      foreignKeys.some(fk => fk.isNew || fk.isModified || fk.isDeleted) ||
      checks.some(c => c.isNew || c.isModified || c.isDeleted) ||
      triggers.some(t => t.isNew || t.isModified || t.isDeleted);
    
    setHasChanges(hasAnyChanges);
  }, [fields, indexes, foreignKeys, checks, triggers, isNewTable]);

  const generateCreateTableSql = useCallback((): string => {
    const activeFields = fields.filter(f => !f.isDeleted);
    if (activeFields.length === 0) return '';

    const columnDefs = activeFields.map(field => {
      let def = `  \`${field.name}\` ${field.type.toUpperCase()}`;
      
      if (field.length) {
        if (field.decimals) {
          def += `(${field.length},${field.decimals})`;
        } else {
          def += `(${field.length})`;
        }
      }
      
      if (field.unsigned) {
        def += ' UNSIGNED';
      }
      
      if (field.zerofill) {
        def += ' ZEROFILL';
      }
      
      if (field.charset) {
        def += ` CHARACTER SET ${field.charset}`;
      }
      
      if (field.collation) {
        def += ` COLLATE ${field.collation}`;
      }
      
      if (!field.nullable) {
        def += ' NOT NULL';
      } else {
        def += ' NULL';
      }
      
      if (field.defaultValue !== null && field.defaultValue !== undefined) {
        if (field.defaultValue === 'NULL' || field.defaultValue === '') {
          def += ' DEFAULT NULL';
        } else if (field.defaultValue.toUpperCase() === 'CURRENT_TIMESTAMP') {
          def += ' DEFAULT CURRENT_TIMESTAMP';
        } else {
          def += ` DEFAULT '${field.defaultValue}'`;
        }
      }
      
      if (field.autoIncrement) {
        def += ' AUTO_INCREMENT';
      }
      
      if (field.comment) {
        def += ` COMMENT '${field.comment}'`;
      }
      
      return def;
    });

    const primaryKeys = activeFields.filter(f => f.isPrimaryKey).map(f => `\`${f.name}\``);
    if (primaryKeys.length > 0) {
      columnDefs.push(`  PRIMARY KEY (${primaryKeys.join(', ')})`);
    }

    const activeIndexes = indexes.filter(i => !i.isDeleted);
    activeIndexes.forEach(idx => {
      const uniqueStr = idx.type === 'UNIQUE' ? 'UNIQUE ' : idx.type === 'FULLTEXT' ? 'FULLTEXT ' : idx.type === 'SPATIAL' ? 'SPATIAL ' : '';
      const columns = idx.fields.split(',').map(c => `\`${c.trim()}\``).join(', ');
      columnDefs.push(`  ${uniqueStr}INDEX \`${idx.name}\` (${columns}) USING ${idx.method}`);
    });

    const activeFks = foreignKeys.filter(fk => !fk.isDeleted);
    activeFks.forEach(fk => {
      const columns = fk.fields.split(',').map(c => `\`${c.trim()}\``).join(', ');
      const refColumns = fk.refFields.split(',').map(c => `\`${c.trim()}\``).join(', ');
      columnDefs.push(`  CONSTRAINT \`${fk.name}\` FOREIGN KEY (${columns}) REFERENCES \`${fk.refTable}\` (${refColumns}) ON UPDATE ${fk.onUpdate} ON DELETE ${fk.onDelete}`);
    });

    const activeChecks = checks.filter(c => !c.isDeleted);
    activeChecks.forEach(chk => {
      const notEnforced = chk.notEnforced ? ' NOT ENFORCED' : '';
      columnDefs.push(`  CONSTRAINT \`${chk.name}\` CHECK (${chk.clause})${notEnforced}`);
    });

    const previewTableName = effectiveTableName || 'new_table';

    let sql = `CREATE TABLE \`${previewTableName}\` (\n`;
    sql += columnDefs.join(',\n');
    sql += '\n)';
    
    sql += ` ENGINE=${tableOptions.engine}`;
    if (tableOptions.charset) {
      sql += ` DEFAULT CHARSET=${tableOptions.charset}`;
    }
    if (tableOptions.collation) {
      sql += ` COLLATE=${tableOptions.collation}`;
    }
    if (tableOptions.autoIncrement) {
      sql += ` AUTO_INCREMENT=${tableOptions.autoIncrement}`;
    }
    if (tableOptions.comment) {
      sql += ` COMMENT='${tableOptions.comment}'`;
    }
    
    sql += ';';

    // Add triggers
    const activeTriggers = triggers.filter(t => !t.isDeleted);
    if (activeTriggers.length > 0) {
      sql += '\n\nDELIMITER ;;';
      activeTriggers.forEach(trg => {
        const events: string[] = [];
        if (trg.insert) events.push('INSERT');
        if (trg.update) events.push('UPDATE');
        if (trg.delete) events.push('DELETE');
        if (events.length > 0) {
          sql += `\nCREATE TRIGGER \`${trg.name}\` ${trg.timing} ${events.join(' OR ')} ON \`${previewTableName}\` FOR EACH ROW ${trg.definition};;`;
        }
      });
      sql += '\nDELIMITER ;';
    }
    
    return sql;
  }, [fields, indexes, foreignKeys, checks, triggers, effectiveTableName, tableOptions]);

  const generateAlterTableSql = useCallback((): string => {
    if (isNewTable) {
      return generateCreateTableSql();
    }

    const statements: string[] = [];

    fields.filter(f => f.isDeleted).forEach(field => {
      statements.push(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${field.originalName || field.name}\`;`);
    });

    fields.filter(f => f.isNew && !f.isDeleted).forEach(field => {
      let def = `ADD COLUMN \`${field.name}\` ${field.type.toUpperCase()}`;
      if (field.length) {
        if (field.decimals) {
          def += `(${field.length},${field.decimals})`;
        } else {
          def += `(${field.length})`;
        }
      }
      if (field.unsigned) def += ' UNSIGNED';
      if (field.charset) def += ` CHARACTER SET ${field.charset}`;
      if (field.collation) def += ` COLLATE ${field.collation}`;
      if (!field.nullable) def += ' NOT NULL';
      if (field.defaultValue !== null && field.defaultValue !== undefined) {
        def += ` DEFAULT '${field.defaultValue}'`;
      }
      if (field.autoIncrement) def += ' AUTO_INCREMENT';
      if (field.comment) def += ` COMMENT '${field.comment}'`;
      statements.push(`ALTER TABLE \`${tableName}\` ${def};`);
    });

    fields.filter(f => f.isModified && !f.isDeleted && !f.isNew).forEach(field => {
      let def = `MODIFY COLUMN \`${field.name}\` ${field.type.toUpperCase()}`;
      if (field.length) {
        if (field.decimals) {
          def += `(${field.length},${field.decimals})`;
        } else {
          def += `(${field.length})`;
        }
      }
      if (field.unsigned) def += ' UNSIGNED';
      if (field.charset) def += ` CHARACTER SET ${field.charset}`;
      if (field.collation) def += ` COLLATE ${field.collation}`;
      if (!field.nullable) def += ' NOT NULL';
      if (field.defaultValue !== null && field.defaultValue !== undefined) {
        def += ` DEFAULT '${field.defaultValue}'`;
      }
      if (field.autoIncrement) def += ' AUTO_INCREMENT';
      if (field.comment) def += ` COMMENT '${field.comment}'`;
      statements.push(`ALTER TABLE \`${tableName}\` ${def};`);
    });

    indexes.filter(i => i.isDeleted).forEach(idx => {
      statements.push(`ALTER TABLE \`${tableName}\` DROP INDEX \`${idx.name}\`;`);
    });

    indexes.filter(i => i.isNew && !i.isDeleted).forEach(idx => {
      const uniqueStr = idx.type === 'UNIQUE' ? 'UNIQUE ' : idx.type === 'FULLTEXT' ? 'FULLTEXT ' : idx.type === 'SPATIAL' ? 'SPATIAL ' : '';
      const columns = idx.fields.split(',').map(c => `\`${c.trim()}\``).join(', ');
      statements.push(`ALTER TABLE \`${tableName}\` ADD ${uniqueStr}INDEX \`${idx.name}\` (${columns}) USING ${idx.method};`);
    });

    foreignKeys.filter(fk => fk.isDeleted).forEach(fk => {
      statements.push(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${fk.name}\`;`);
    });

    foreignKeys.filter(fk => fk.isNew && !fk.isDeleted).forEach(fk => {
      const columns = fk.fields.split(',').map(c => `\`${c.trim()}\``).join(', ');
      const refColumns = fk.refFields.split(',').map(c => `\`${c.trim()}\``).join(', ');
      statements.push(`ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${fk.name}\` FOREIGN KEY (${columns}) REFERENCES \`${fk.refTable}\` (${refColumns}) ON UPDATE ${fk.onUpdate} ON DELETE ${fk.onDelete};`);
    });

    checks.filter(c => c.isDeleted).forEach(chk => {
      statements.push(`ALTER TABLE \`${tableName}\` DROP CHECK \`${chk.name}\`;`);
    });

    checks.filter(c => c.isNew && !c.isDeleted).forEach(chk => {
      const notEnforced = chk.notEnforced ? ' NOT ENFORCED' : '';
      statements.push(`ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${chk.name}\` CHECK (${chk.clause})${notEnforced};`);
    });

    // Triggers are handled separately
    triggers.filter(t => t.isDeleted).forEach(trg => {
      statements.push(`DROP TRIGGER IF EXISTS \`${trg.name}\`;`);
    });

    triggers.filter(t => t.isModified && !t.isDeleted && !t.isNew).forEach(trg => {
      const events: string[] = [];
      if (trg.insert) events.push('INSERT');
      if (trg.update) events.push('UPDATE');
      if (trg.delete) events.push('DELETE');
      if (events.length > 0) {
        statements.push(`DROP TRIGGER IF EXISTS \`${trg.name}\`;`);
        statements.push(`DELIMITER ;;`);
        statements.push(`CREATE TRIGGER \`${trg.name}\` ${trg.timing} ${events.join(' OR ')} ON \`${tableName}\` FOR EACH ROW ${trg.definition};;`);
        statements.push(`DELIMITER ;`);
      }
    });

    triggers.filter(t => t.isNew && !t.isDeleted).forEach(trg => {
      const events: string[] = [];
      if (trg.insert) events.push('INSERT');
      if (trg.update) events.push('UPDATE');
      if (trg.delete) events.push('DELETE');
      if (events.length > 0) {
        statements.push(`DELIMITER ;;`);
        statements.push(`CREATE TRIGGER \`${trg.name}\` ${trg.timing} ${events.join(' OR ')} ON \`${tableName}\` FOR EACH ROW ${trg.definition};;`);
        statements.push(`DELIMITER ;`);
      }
    });

    return statements.join('\n\n');
  }, [fields, indexes, foreignKeys, checks, triggers, tableName, isNewTable, generateCreateTableSql]);

  useEffect(() => {
    const sql = isNewTable ? generateCreateTableSql() : generateAlterTableSql();
    setGeneratedSql(sql);
  }, [isNewTable, generateCreateTableSql, generateAlterTableSql]);

  // Field handlers
  const handleFieldChange = (id: string, key: keyof FieldDefinition, value: unknown) => {
    setFields(prev => prev.map(f => {
      if (f.id === id) {
        const updated = { ...f, [key]: value };
        if (!f.isNew) {
          updated.isModified = true;
        }
        return updated;
      }
      return f;
    }));
  };

  const handleAddField = () => {
    const newPosition = Math.max(...fields.map(f => f.position), 0) + 1;
    const newField: FieldDefinition = {
      id: generateId(),
      name: '',
      type: 'VARCHAR',
      length: '255',
      decimals: '',
      nullable: true,
      defaultValue: null,
      comment: '',
      isPrimaryKey: false,
      autoIncrement: false,
      unsigned: false,
      zerofill: false,
      charset: '',
      collation: '',
      position: newPosition,
      isNew: true,
      isModified: false,
      isDeleted: false,
    };
    setFields(prev => [...prev, newField]);
    setSelectedFieldId(newField.id);
  };

  const handleInsertField = () => {
    if (!selectedFieldId) {
      handleAddField();
      return;
    }
    
    const selectedIndex = fields.findIndex(f => f.id === selectedFieldId);
    if (selectedIndex === -1) {
      handleAddField();
      return;
    }

    const newField: FieldDefinition = {
      id: generateId(),
      name: '',
      type: 'VARCHAR',
      length: '255',
      decimals: '',
      nullable: true,
      defaultValue: null,
      comment: '',
      isPrimaryKey: false,
      autoIncrement: false,
      unsigned: false,
      zerofill: false,
      charset: '',
      collation: '',
      position: selectedIndex + 1,
      isNew: true,
      isModified: false,
      isDeleted: false,
    };

    setFields(prev => {
      const newFields = [...prev];
      newFields.splice(selectedIndex, 0, newField);
      // Update positions
      newFields.forEach((f, idx) => f.position = idx + 1);
      return newFields;
    });
    setSelectedFieldId(newField.id);
  };

  const handleDeleteField = () => {
    if (!selectedFieldId) return;
    
    setFields(prev => {
      const field = prev.find(f => f.id === selectedFieldId);
      if (!field) return prev;
      
      if (field.isNew) {
        return prev.filter(f => f.id !== selectedFieldId);
      }
      
      return prev.map(f => {
        if (f.id === selectedFieldId) {
          return { ...f, isDeleted: true };
        }
        return f;
      });
    });
    setSelectedFieldId(null);
  };

  const handleTogglePrimaryKey = () => {
    if (!selectedFieldId) return;
    
    setFields(prev => prev.map(f => {
      if (f.id === selectedFieldId) {
        const updated = { ...f, isPrimaryKey: !f.isPrimaryKey };
        if (!f.isNew) {
          updated.isModified = true;
        }
        return updated;
      }
      return f;
    }));
  };

  const handleMoveField = (direction: -1 | 1) => {
    if (!selectedFieldId) return;
    
    setFields(prev => {
      const visibleFields = prev.filter(f => !f.isDeleted);
      const currentIndex = visibleFields.findIndex(f => f.id === selectedFieldId);
      if (currentIndex === -1) return prev;
      
      const newIndex = currentIndex + direction;
      if (newIndex < 0 || newIndex >= visibleFields.length) return prev;
      
      // Swap positions
      const temp = visibleFields[currentIndex].position;
      visibleFields[currentIndex].position = visibleFields[newIndex].position;
      visibleFields[newIndex].position = temp;
      
      // Sort by position
      return [...prev].sort((a, b) => a.position - b.position);
    });
  };

  // Index handlers
  const handleIndexChange = (id: string, key: keyof IndexDefinition, value: unknown) => {
    setIndexes(prev => prev.map(i => {
      if (i.id === id) {
        const updated = { ...i, [key]: value };
        if (!i.isNew) {
          updated.isModified = true;
        }
        return updated;
      }
      return i;
    }));
  };

  const handleAddIndex = () => {
    const newIndex: IndexDefinition = {
      id: generateId(),
      name: `idx_${Date.now() % 1000}`,
      fields: '',
      type: 'NORMAL',
      method: 'BTREE',
      comment: '',
      isNew: true,
      isModified: false,
      isDeleted: false,
    };
    setIndexes(prev => [...prev, newIndex]);
    setSelectedIndexId(newIndex.id);
  };

  const handleDeleteIndex = () => {
    if (!selectedIndexId) return;
    
    setIndexes(prev => {
      const idx = prev.find(i => i.id === selectedIndexId);
      if (!idx) return prev;
      
      if (idx.isNew) {
        return prev.filter(i => i.id !== selectedIndexId);
      }
      
      return prev.map(i => {
        if (i.id === selectedIndexId) {
          return { ...i, isDeleted: true };
        }
        return i;
      });
    });
    setSelectedIndexId(null);
  };

  // Foreign Key handlers
  const handleFkChange = (id: string, key: keyof ForeignKeyDefinition, value: unknown) => {
    setForeignKeys(prev => prev.map(fk => {
      if (fk.id === id) {
        const updated = { ...fk, [key]: value };
        if (!fk.isNew) {
          updated.isModified = true;
        }
        return updated;
      }
      return fk;
    }));
  };

  const handleAddForeignKey = () => {
    const newFk: ForeignKeyDefinition = {
      id: generateId(),
      name: `fk_${Date.now() % 1000}`,
      fields: '',
      refSchema: '',
      refTable: '',
      refFields: '',
      onUpdate: 'RESTRICT',
      onDelete: 'RESTRICT',
      isNew: true,
      isModified: false,
      isDeleted: false,
    };
    setForeignKeys(prev => [...prev, newFk]);
    setSelectedFkId(newFk.id);
  };

  const handleDeleteForeignKey = () => {
    if (!selectedFkId) return;
    
    setForeignKeys(prev => {
      const fk = prev.find(f => f.id === selectedFkId);
      if (!fk) return prev;
      
      if (fk.isNew) {
        return prev.filter(f => f.id !== selectedFkId);
      }
      
      return prev.map(f => {
        if (f.id === selectedFkId) {
          return { ...f, isDeleted: true };
        }
        return f;
      });
    });
    setSelectedFkId(null);
  };

  // Check handlers
  const handleCheckChange = (id: string, key: keyof CheckDefinition, value: unknown) => {
    setChecks(prev => prev.map(c => {
      if (c.id === id) {
        const updated = { ...c, [key]: value };
        if (!c.isNew) {
          updated.isModified = true;
        }
        return updated;
      }
      return c;
    }));
  };

  const handleAddCheck = () => {
    const newCheck: CheckDefinition = {
      id: generateId(),
      name: `chk_${Date.now() % 1000}`,
      clause: '',
      notEnforced: false,
      isNew: true,
      isModified: false,
      isDeleted: false,
    };
    setChecks(prev => [...prev, newCheck]);
    setSelectedCheckId(newCheck.id);
  };

  const handleDeleteCheck = () => {
    if (!selectedCheckId) return;
    
    setChecks(prev => {
      const chk = prev.find(c => c.id === selectedCheckId);
      if (!chk) return prev;
      
      if (chk.isNew) {
        return prev.filter(c => c.id !== selectedCheckId);
      }
      
      return prev.map(c => {
        if (c.id === selectedCheckId) {
          return { ...c, isDeleted: true };
        }
        return c;
      });
    });
    setSelectedCheckId(null);
  };

  // Trigger handlers
  const handleTriggerChange = (id: string, key: keyof TriggerDefinition, value: unknown) => {
    setTriggers(prev => prev.map(t => {
      if (t.id === id) {
        const updated = { ...t, [key]: value };
        if (!t.isNew) {
          updated.isModified = true;
        }
        return updated;
      }
      return t;
    }));
  };

  const handleAddTrigger = () => {
    const newTrigger: TriggerDefinition = {
      id: generateId(),
      name: `trg_${Date.now() % 1000}`,
      timing: 'BEFORE',
      insert: false,
      update: false,
      delete: false,
      definition: '',
      isNew: true,
      isModified: false,
      isDeleted: false,
    };
    setTriggers(prev => [...prev, newTrigger]);
    setSelectedTriggerId(newTrigger.id);
  };

  const handleDeleteTrigger = () => {
    if (!selectedTriggerId) return;
    
    setTriggers(prev => {
      const trg = prev.find(t => t.id === selectedTriggerId);
      if (!trg) return prev;
      
      if (trg.isNew) {
        return prev.filter(t => t.id !== selectedTriggerId);
      }
      
      return prev.map(t => {
        if (t.id === selectedTriggerId) {
          return { ...t, isDeleted: true };
        }
        return t;
      });
    });
    setSelectedTriggerId(null);
  };

  const handleSave = async () => {
    if (isNewTable && !effectiveTableName) {
      setError(t('designerTab.errors.noTableName'));
      return;
    }

    if (!generatedSql) return;
    
    setIsSaving(true);
    try {
      await metadataApi.executeSql(connectionProfile, generatedSql, database);
      setHasChanges(false);
      if (isNewTable) {
        setCurrentTableName(effectiveTableName);
        updateTab(tabId, {
          title: t('designerTab.tabTitle', { name: effectiveTableName }),
          table: effectiveTableName,
        });
        await loadTableData(effectiveTableName);
        setSelectedTabId('ddl');
      } else {
        await loadTableData();
      }
      (await getDesignerToaster())?.show({
        message: isNewTable ? t('designerTab.saveSuccess.create', { name: effectiveTableName }) : t('designerTab.saveSuccess.modify', { name: currentTableName }),
        intent: Intent.SUCCESS,
        timeout: 3000,
      });
    } catch (err) {
      setError(t('designerTab.errors.saveFailed', { error: err }));
    } finally {
      setIsSaving(false);
    }
  };

  const renderFieldsTab = () => {
    const selectedField = fields.find(f => f.id === selectedFieldId);
    const showCharsetCollation = selectedField && isStringType(selectedField.type);

    return (
      <div className="designer-fields">
        <div className="designer-fields-toolbar">
          <Button icon="add" text={t('designerTab.fields.addField')} onClick={handleAddField} small />
          <Button icon="insert" text={t('designerTab.fields.insertField')} onClick={handleInsertField} small disabled={!selectedFieldId} />
          <Button icon="trash" text={t('designerTab.fields.deleteField')} onClick={handleDeleteField} small disabled={!selectedFieldId} intent={Intent.DANGER} />
          <div className="toolbar-separator" />
          <Button icon="key" text={t('designerTab.fields.primaryKey')} onClick={handleTogglePrimaryKey} small disabled={!selectedFieldId} />
          <div className="toolbar-separator" />
          <Button icon="arrow-up" text={t('designerTab.fields.moveUp')} onClick={() => handleMoveField(-1)} small disabled={!selectedFieldId} />
          <Button icon="arrow-down" text={t('designerTab.fields.moveDown')} onClick={() => handleMoveField(1)} small disabled={!selectedFieldId} />
        </div>
        <div className="designer-fields-table">
          <table>
            <thead>
              <tr>
                <th style={{ width: '30px' }}>#</th>
                <th style={{ width: '140px' }}>{t('designerTab.fields.columns.name')}</th>
                <th style={{ width: '100px' }}>{t('designerTab.fields.columns.type')}</th>
                <th style={{ width: '70px' }}>{t('designerTab.fields.columns.length')}</th>
                <th style={{ width: '60px' }}>{t('designerTab.fields.columns.decimals')}</th>
                <th style={{ width: '50px' }}>{t('designerTab.fields.columns.notNull')}</th>
                <th style={{ width: '50px' }}>{t('designerTab.fields.columns.key')}</th>
                <th style={{ width: '50px' }}>{t('designerTab.fields.columns.autoIncrement')}</th>
                <th style={{ width: '100px' }}>{t('designerTab.fields.columns.default')}</th>
                <th style={{ width: '120px' }}>{t('designerTab.fields.columns.comment')}</th>
              </tr>
            </thead>
            <tbody>
              {fields.filter(f => !f.isDeleted).map((field, index) => (
                <tr 
                  key={field.id} 
                  className={`${field.isNew ? 'new-row' : ''} ${field.isModified ? 'modified-row' : ''} ${selectedFieldId === field.id ? 'selected-row' : ''}`}
                  onClick={() => setSelectedFieldId(field.id)}
                >
                  <td>{index + 1}</td>
                  <td>
                    <InputGroup
                      small
                      value={field.name}
                      onChange={(e) => handleFieldChange(field.id, 'name', e.target.value)}
                      placeholder={t('designerTab.fields.placeholders.name')}
                    />
                  </td>
                  <td>
                    <HTMLSelect
                      value={field.type.toUpperCase()}
                      onChange={(e) => {
                        const newType = e.target.value;
                        handleFieldChange(field.id, 'type', newType);
                        // 如果新类型不是字符串类型，清空字符集和排序规则
                        if (!isStringType(newType)) {
                          handleFieldChange(field.id, 'charset', '');
                          handleFieldChange(field.id, 'collation', '');
                        }
                      }}
                      options={MYSQL_DATA_TYPES.map(t => ({ value: t, label: t }))}
                    />
                  </td>
                  <td>
                    <InputGroup
                      small
                      value={field.length}
                      onChange={(e) => handleFieldChange(field.id, 'length', e.target.value)}
                      placeholder={t('designerTab.fields.placeholders.length')}
                    />
                  </td>
                  <td>
                    <InputGroup
                      small
                      value={field.decimals}
                      onChange={(e) => handleFieldChange(field.id, 'decimals', e.target.value)}
                      placeholder={t('designerTab.fields.placeholders.decimals')}
                    />
                  </td>
                  <td>
                    <Checkbox
                      checked={!field.nullable}
                      onChange={(e) => handleFieldChange(field.id, 'nullable', !(e.target as HTMLInputElement).checked)}
                    />
                  </td>
                  <td className="key-cell">
                    {field.isPrimaryKey && <span className="key-icon">🔑1</span>}
                  </td>
                  <td>
                    <Checkbox
                      checked={field.autoIncrement}
                      onChange={(e) => handleFieldChange(field.id, 'autoIncrement', (e.target as HTMLInputElement).checked)}
                    />
                  </td>
                  <td>
                    <InputGroup
                      small
                      value={field.defaultValue || ''}
                      onChange={(e) => handleFieldChange(field.id, 'defaultValue', e.target.value || null)}
                      placeholder={t('designerTab.fields.placeholders.default')}
                    />
                  </td>
                  <td>
                    <InputGroup
                      small
                      value={field.comment}
                      onChange={(e) => handleFieldChange(field.id, 'comment', e.target.value)}
                      placeholder={t('designerTab.fields.placeholders.comment')}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* 字符串类型字段的字符集和排序规则选择区域 */}
        {showCharsetCollation && selectedField && (
          <div className="designer-field-charset-section">
            <div className="designer-field-charset-title">{t('designerTab.fields.charsetCollation')}</div>
            <div className="designer-field-charset-row">
              <FormGroup label={t('designerTab.fields.columns.charset')} className="charset-form-group">
                <HTMLSelect
                  value={selectedField.charset || ''}
                  onChange={(e) => {
                    const newCharset = e.target.value;
                    handleFieldChange(selectedField.id, 'charset', newCharset);
                    // 当字符集改变时，自动选择该字符集的第一个排序规则
                    if (newCharset && MYSQL_COLLATIONS[newCharset]) {
                      handleFieldChange(selectedField.id, 'collation', MYSQL_COLLATIONS[newCharset][0]);
                    } else {
                      handleFieldChange(selectedField.id, 'collation', '');
                    }
                  }}
                  options={[
                    { value: '', label: t('designerTab.fields.default') },
                    ...MYSQL_CHARSETS.map(c => ({ value: c, label: c }))
                  ]}
                />
              </FormGroup>
              <FormGroup label={t('designerTab.fields.columns.collation')} className="collation-form-group">
                <HTMLSelect
                  value={selectedField.collation || ''}
                  onChange={(e) => handleFieldChange(selectedField.id, 'collation', e.target.value)}
                  options={[
                    { value: '', label: t('designerTab.fields.default') },
                    ...(selectedField.charset && MYSQL_COLLATIONS[selectedField.charset] 
                      ? MYSQL_COLLATIONS[selectedField.charset].map(c => ({ value: c, label: c })) 
                      : [])
                  ]}
                  disabled={!selectedField.charset}
                />
              </FormGroup>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderIndexesTab = () => (
    <div className="designer-indexes">
      <div className="designer-indexes-toolbar">
        <Button icon="add" text={t('designerTab.indexes.addIndex')} onClick={handleAddIndex} small />
        <Button icon="trash" text={t('designerTab.indexes.deleteIndex')} onClick={handleDeleteIndex} small disabled={!selectedIndexId} intent={Intent.DANGER} />
      </div>
      <div className="designer-table-container">
        <table className="designer-data-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>#</th>
              <th style={{ width: '150px' }}>{t('designerTab.indexes.columns.name')}</th>
              <th style={{ width: '200px' }}>{t('designerTab.indexes.columns.fields')}</th>
              <th style={{ width: '120px' }}>{t('designerTab.indexes.columns.type')}</th>
              <th style={{ width: '100px' }}>{t('designerTab.indexes.columns.method')}</th>
              <th style={{ width: '200px' }}>{t('designerTab.indexes.columns.comment')}</th>
            </tr>
          </thead>
          <tbody>
            {indexes.filter(i => !i.isDeleted).map((idx, index) => (
              <tr
                key={idx.id}
                className={`${idx.isNew ? 'new-row' : ''} ${idx.isModified ? 'modified-row' : ''} ${selectedIndexId === idx.id ? 'selected-row' : ''}`}
                onClick={() => setSelectedIndexId(idx.id)}
              >
                <td>{index + 1}</td>
                <td>
                  <InputGroup
                    small
                    value={idx.name}
                    onChange={(e) => handleIndexChange(idx.id, 'name', e.target.value)}
                    placeholder={t('designerTab.indexes.placeholders.name')}
                  />
                </td>
                <td>
                  <InputGroup
                    small
                    value={idx.fields}
                    onChange={(e) => handleIndexChange(idx.id, 'fields', e.target.value)}
                    placeholder={t('designerTab.indexes.placeholders.fields')}
                  />
                </td>
                <td>
                  <HTMLSelect
                    value={idx.type}
                    onChange={(e) => handleIndexChange(idx.id, 'type', e.target.value)}
                    options={INDEX_TYPES.map(t => ({ value: t, label: t }))}
                  />
                </td>
                <td>
                  <HTMLSelect
                    value={idx.method}
                    onChange={(e) => handleIndexChange(idx.id, 'method', e.target.value)}
                    options={INDEX_METHODS.map(m => ({ value: m, label: m }))}
                  />
                </td>
                <td>
                  <InputGroup
                    small
                    value={idx.comment}
                    onChange={(e) => handleIndexChange(idx.id, 'comment', e.target.value)}
                    placeholder={t('designerTab.indexes.placeholders.comment')}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {indexes.filter(i => !i.isDeleted).length === 0 && (
          <div className="designer-empty">{t('designerTab.indexes.noIndexes')}</div>
        )}
      </div>
    </div>
  );

  const renderForeignKeysTab = () => (
    <div className="designer-foreign-keys">
      <div className="designer-fk-toolbar">
        <Button icon="add" text={t('designerTab.foreignKeys.addForeignKey')} onClick={handleAddForeignKey} small />
        <Button icon="trash" text={t('designerTab.foreignKeys.deleteForeignKey')} onClick={handleDeleteForeignKey} small disabled={!selectedFkId} intent={Intent.DANGER} />
      </div>
      <div className="designer-table-container">
        <table className="designer-data-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>#</th>
              <th style={{ width: '120px' }}>{t('designerTab.foreignKeys.columns.name')}</th>
              <th style={{ width: '120px' }}>{t('designerTab.foreignKeys.columns.fields')}</th>
              <th style={{ width: '120px' }}>{t('designerTab.foreignKeys.columns.refSchema')}</th>
              <th style={{ width: '120px' }}>{t('designerTab.foreignKeys.columns.refTable')}</th>
              <th style={{ width: '120px' }}>{t('designerTab.foreignKeys.columns.refFields')}</th>
              <th style={{ width: '100px' }}>{t('designerTab.foreignKeys.columns.onDelete')}</th>
              <th style={{ width: '100px' }}>{t('designerTab.foreignKeys.columns.onUpdate')}</th>
            </tr>
          </thead>
          <tbody>
            {foreignKeys.filter(fk => !fk.isDeleted).map((fk, index) => (
              <tr
                key={fk.id}
                className={`${fk.isNew ? 'new-row' : ''} ${fk.isModified ? 'modified-row' : ''} ${selectedFkId === fk.id ? 'selected-row' : ''}`}
                onClick={() => setSelectedFkId(fk.id)}
              >
                <td>{index + 1}</td>
                <td>
                  <InputGroup
                    small
                    value={fk.name}
                    onChange={(e) => handleFkChange(fk.id, 'name', e.target.value)}
                    placeholder={t('designerTab.foreignKeys.placeholders.name')}
                  />
                </td>
                <td>
                  <InputGroup
                    small
                    value={fk.fields}
                    onChange={(e) => handleFkChange(fk.id, 'fields', e.target.value)}
                    placeholder={t('designerTab.foreignKeys.placeholders.fields')}
                  />
                </td>
                <td>
                  <InputGroup
                    small
                    value={fk.refSchema}
                    onChange={(e) => handleFkChange(fk.id, 'refSchema', e.target.value)}
                    placeholder={t('designerTab.foreignKeys.placeholders.refSchema')}
                  />
                </td>
                <td>
                  <InputGroup
                    small
                    value={fk.refTable}
                    onChange={(e) => handleFkChange(fk.id, 'refTable', e.target.value)}
                    placeholder={t('designerTab.foreignKeys.placeholders.refTable')}
                  />
                </td>
                <td>
                  <InputGroup
                    small
                    value={fk.refFields}
                    onChange={(e) => handleFkChange(fk.id, 'refFields', e.target.value)}
                    placeholder={t('designerTab.foreignKeys.placeholders.refFields')}
                  />
                </td>
                <td>
                  <HTMLSelect
                    value={fk.onDelete}
                    onChange={(e) => handleFkChange(fk.id, 'onDelete', e.target.value)}
                    options={FK_ACTIONS.map(a => ({ value: a, label: a }))}
                  />
                </td>
                <td>
                  <HTMLSelect
                    value={fk.onUpdate}
                    onChange={(e) => handleFkChange(fk.id, 'onUpdate', e.target.value)}
                    options={FK_ACTIONS.map(a => ({ value: a, label: a }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {foreignKeys.filter(fk => !fk.isDeleted).length === 0 && (
          <div className="designer-empty">{t('designerTab.foreignKeys.noForeignKeys')}</div>
        )}
      </div>
    </div>
  );

  const renderChecksTab = () => (
    <div className="designer-checks">
      <div className="designer-checks-toolbar">
        <Button icon="add" text={t('designerTab.checks.addCheck')} onClick={handleAddCheck} small />
        <Button icon="trash" text={t('designerTab.checks.deleteCheck')} onClick={handleDeleteCheck} small disabled={!selectedCheckId} intent={Intent.DANGER} />
      </div>
      <div className="designer-table-container">
        <table className="designer-data-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>#</th>
              <th style={{ width: '150px' }}>{t('designerTab.checks.columns.name')}</th>
              <th style={{ width: '400px' }}>{t('designerTab.checks.columns.clause')}</th>
              <th style={{ width: '100px' }}>{t('designerTab.checks.columns.notEnforced')}</th>
            </tr>
          </thead>
          <tbody>
            {checks.filter(c => !c.isDeleted).map((chk, index) => (
              <tr
                key={chk.id}
                className={`${chk.isNew ? 'new-row' : ''} ${chk.isModified ? 'modified-row' : ''} ${selectedCheckId === chk.id ? 'selected-row' : ''}`}
                onClick={() => setSelectedCheckId(chk.id)}
              >
                <td>{index + 1}</td>
                <td>
                  <InputGroup
                    small
                    value={chk.name}
                    onChange={(e) => handleCheckChange(chk.id, 'name', e.target.value)}
                    placeholder={t('designerTab.checks.placeholders.name')}
                  />
                </td>
                <td>
                  <InputGroup
                    small
                    value={chk.clause}
                    onChange={(e) => handleCheckChange(chk.id, 'clause', e.target.value)}
                    placeholder={t('designerTab.checks.placeholders.clause')}
                  />
                </td>
                <td>
                  <Checkbox
                    checked={chk.notEnforced}
                    onChange={(e) => handleCheckChange(chk.id, 'notEnforced', (e.target as HTMLInputElement).checked)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {checks.filter(c => !c.isDeleted).length === 0 && (
          <div className="designer-empty">{t('designerTab.checks.noChecks')}</div>
        )}
      </div>
    </div>
  );

  const [isTriggerEditing, setIsTriggerEditing] = useState(false);
  const [editingTriggerDefinition, setEditingTriggerDefinition] = useState<string>('');
  const triggerEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const [editorSettings, setEditorSettings] = useState(getEditorSettings());

  const handleTriggerEditorMount = useCallback((
    editorInstance: editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor'),
  ) => {
    triggerEditorRef.current = editorInstance;
    // 注册编辑器到全局管理器
    registerEditor(editorInstance, monaco);
    // 在编辑模式下启用自动补全
    if (isTriggerEditing && editorSettings.editorAutoComplete) {
      registerSQLCompletionProvider(monaco, true);
    }

    return () => {
      unregisterEditor(editorInstance);
    };
  }, [isTriggerEditing, editorSettings.editorAutoComplete]);

  // 监听设置变更事件，即时响应所有设置
  useEffect(() => {
    const handleSettingsChanged = () => {
      const newSettings = getEditorSettings();
      setEditorSettings(newSettings);
      // 应用设置到所有编辑器
      applySettingsToAllEditors();
      // 更新自动补全状态
      updateCompletionProviderState();
    };

    window.addEventListener('dbw:settings-changed', handleSettingsChanged as EventListener);
    return () => {
      window.removeEventListener('dbw:settings-changed', handleSettingsChanged as EventListener);
    };
  }, []);

  const extractTriggerBody = (definition: string): string => {
    if (!definition) return '';
    const beginMatch = definition.match(/BEGIN\s*/i);
    const endMatch = definition.match(/\s*END\s*$/i);
    if (beginMatch && endMatch) {
      const start = definition.indexOf(beginMatch[0]) + beginMatch[0].length;
      const end = definition.lastIndexOf(endMatch[0]);
      return definition.substring(start, end).trim();
    }
    return definition;
  };

  const handleStartTriggerEdit = () => {
    const selectedTrigger = triggers.find(t => t.id === selectedTriggerId);
    if (selectedTrigger) {
      setEditingTriggerDefinition(extractTriggerBody(selectedTrigger.definition));
    }
    setIsTriggerEditing(true);
  };

  const handleFinishTriggerEdit = () => {
    if (selectedTriggerId && editingTriggerDefinition !== undefined) {
      const selectedTrigger = triggers.find(t => t.id === selectedTriggerId);
      const originalBody = selectedTrigger ? extractTriggerBody(selectedTrigger.definition) : '';
      if (editingTriggerDefinition !== originalBody) {
        handleTriggerChange(selectedTriggerId, 'definition', `BEGIN\n${editingTriggerDefinition}\nEND`);
      }
    }
    setIsTriggerEditing(false);
    setEditingTriggerDefinition('');
  };

  const renderTriggersTab = () => {
    const selectedTrigger = triggers.find(t => t.id === selectedTriggerId);

    return (
      <div className="designer-triggers">
        <div className="designer-triggers-toolbar">
          <Button icon="add" text={t('designerTab.triggers.addTrigger')} onClick={handleAddTrigger} small />
          <Button icon="trash" text={t('designerTab.triggers.deleteTrigger')} onClick={handleDeleteTrigger} small disabled={!selectedTriggerId} intent={Intent.DANGER} />
        </div>
        <div className="designer-triggers-content">
          <div className="designer-table-container">
            <table className="designer-data-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>#</th>
                  <th style={{ width: '150px' }}>{t('designerTab.triggers.columns.name')}</th>
                  <th style={{ width: '80px' }}>{t('designerTab.triggers.columns.timing')}</th>
                  <th style={{ width: '60px' }}>{t('designerTab.triggers.columns.insert')}</th>
                  <th style={{ width: '60px' }}>{t('designerTab.triggers.columns.update')}</th>
                  <th style={{ width: '60px' }}>{t('designerTab.triggers.columns.delete')}</th>
                </tr>
              </thead>
              <tbody>
                {triggers.filter(t => !t.isDeleted).map((trg, index) => (
                  <tr
                    key={trg.id}
                    className={`${trg.isNew ? 'new-row' : ''} ${trg.isModified ? 'modified-row' : ''} ${selectedTriggerId === trg.id ? 'selected-row' : ''}`}
                    onClick={() => {
                      setSelectedTriggerId(trg.id);
                      setIsTriggerEditing(false);
                      setEditingTriggerDefinition('');
                    }}
                  >
                    <td>{index + 1}</td>
                    <td>
                      <InputGroup
                        small
                        value={trg.name}
                        onChange={(e) => handleTriggerChange(trg.id, 'name', e.target.value)}
                        placeholder={t('designerTab.triggers.placeholders.name')}
                      />
                    </td>
                    <td>
                      <HTMLSelect
                        value={trg.timing}
                        onChange={(e) => handleTriggerChange(trg.id, 'timing', e.target.value)}
                        options={TRIGGER_TIMINGS.map(t => ({ value: t, label: t }))}
                      />
                    </td>
                    <td>
                      <div className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={trg.insert}
                          onChange={(e) => handleTriggerChange(trg.id, 'insert', (e.target as HTMLInputElement).checked)}
                        />
                      </div>
                    </td>
                    <td>
                      <div className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={trg.update}
                          onChange={(e) => handleTriggerChange(trg.id, 'update', (e.target as HTMLInputElement).checked)}
                        />
                      </div>
                    </td>
                    <td>
                      <div className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={trg.delete}
                          onChange={(e) => handleTriggerChange(trg.id, 'delete', (e.target as HTMLInputElement).checked)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {triggers.filter(t => !t.isDeleted).length === 0 && (
              <div className="designer-empty">{t('designerTab.triggers.noTriggers')}</div>
            )}
          </div>
          <div className="designer-trigger-definition">
            <div className="definition-header">
              <div className="definition-label">{t('designerTab.triggers.definition')}</div>
              {selectedTriggerId && (
                <Button
                  small
                  intent={isTriggerEditing ? Intent.PRIMARY : Intent.NONE}
                  onClick={isTriggerEditing ? handleFinishTriggerEdit : handleStartTriggerEdit}
                >
                  {isTriggerEditing ? t('designerTab.triggers.done') : t('designerTab.triggers.edit')}
                </Button>
              )}
            </div>
            <div className="definition-editor">
              <Editor
                height="100%"
                language="sql"
                value={isTriggerEditing ? editingTriggerDefinition : (selectedTrigger ? extractTriggerBody(selectedTrigger.definition) : '')}
                theme={appTheme === 'dark' ? 'vs-dark' : 'light'}
                options={{
                  readOnly: !isTriggerEditing || !selectedTrigger,
                  minimap: { enabled: editorSettings.editorMinimap },
                  scrollBeyondLastLine: false,
                  fontSize: editorSettings.editorFontSize,
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  lineNumbers: 'on',
                  renderWhitespace: 'selection',
                  wordWrap: 'on',
                  automaticLayout: true,
                  tabSize: editorSettings.editorTabSize,
                  insertSpaces: true,
                }}
                onChange={(value) => isTriggerEditing && setEditingTriggerDefinition(value || '')}
                onMount={handleTriggerEditorMount}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderOptionsTab = () => (
    <div className="designer-options">
      <FormGroup label={t('designerTab.options.engine')} labelInfo="">
        <HTMLSelect
          value={tableOptions.engine}
          onChange={(e) => setTableOptions(prev => ({ ...prev, engine: e.target.value }))}
          options={MYSQL_ENGINES.map(e => ({ value: e, label: e }))}
        />
      </FormGroup>
      <FormGroup label={t('designerTab.options.charset')}>
        <HTMLSelect
          value={tableOptions.charset}
          onChange={(e) => {
            const newCharset = e.target.value;
            // 当字符集改变时，自动选择该字符集的第一个排序规则
            const defaultCollation = MYSQL_COLLATIONS[newCharset]?.[0] || '';
            setTableOptions(prev => ({
              ...prev,
              charset: newCharset,
              collation: defaultCollation
            }));
          }}
          options={MYSQL_CHARSETS.map(c => ({ value: c, label: c }))}
        />
      </FormGroup>
      <FormGroup label={t('designerTab.options.collation')}>
        <HTMLSelect
          value={tableOptions.collation}
          onChange={(e) => setTableOptions(prev => ({ ...prev, collation: e.target.value }))}
          options={tableOptions.charset ? MYSQL_COLLATIONS[tableOptions.charset]?.map(c => ({ value: c, label: c })) || [] : []}
          disabled={!tableOptions.charset}
        />
      </FormGroup>
      <FormGroup label={t('designerTab.options.comment')}>
        <TextArea
          value={tableOptions.comment}
          onChange={(e) => setTableOptions(prev => ({ ...prev, comment: e.target.value }))}
          placeholder={t('designerTab.options.placeholders.comment')}
          rows={3}
        />
      </FormGroup>
      <FormGroup label={t('designerTab.options.autoIncrement')}>
        <InputGroup
          value={tableOptions.autoIncrement}
          onChange={(e) => setTableOptions(prev => ({ ...prev, autoIncrement: e.target.value }))}
          placeholder={t('designerTab.options.placeholders.autoIncrement')}
        />
      </FormGroup>
    </div>
  );

  const handleReadOnlyEditorMount = useCallback((
    editorInstance: editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor'),
  ) => {
    // 注册只读编辑器（仅字体大小生效）
    registerEditor(editorInstance, monaco);
    return () => {
      unregisterEditor(editorInstance);
    };
  }, []);

  const renderSqlPreviewTab = () => (
    <div className="designer-sql-preview">
      <div className="sql-preview-editor">
        <Editor
          height="100%"
          language="sql"
          value={generatedSql}
          theme={appTheme === 'dark' ? 'vs-dark' : 'light'}
          options={{
            readOnly: true,
            minimap: { enabled: editorSettings.editorMinimap },
            scrollBeyondLastLine: false,
            fontSize: editorSettings.editorFontSize,
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            wordWrap: 'on',
            automaticLayout: true,
          }}
          onMount={handleReadOnlyEditorMount}
        />
      </div>
    </div>
  );

  const renderDdlTab = () => (
    <div className="designer-ddl">
      <div className="ddl-editor">
        <Editor
          height="100%"
          language="sql"
          value={ddl}
          theme={appTheme === 'dark' ? 'vs-dark' : 'light'}
          options={{
            readOnly: true,
            minimap: { enabled: editorSettings.editorMinimap },
            scrollBeyondLastLine: false,
            fontSize: editorSettings.editorFontSize,
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            wordWrap: 'on',
            automaticLayout: true,
          }}
          onMount={handleReadOnlyEditorMount}
        />
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="designer-tab loading">
        <Spinner size={50} />
        <span>{t('designerTab.loading')}</span>
      </div>
    );
  }

  return (
    <div className="designer-tab">
      <div className="designer-toolbar">
        <div className="designer-toolbar-left">
          <span className="designer-title">
            {isNewTable ? t('designerTab.newTable') : `${t('designerTab.designTable')}: ${currentTableName}`}
          </span>
          <span className="designer-database">{database}</span>
          {isNewTable && (
            <InputGroup
              small
              value={newTableName}
              onChange={(e) => {
                setNewTableName(e.target.value);
                if (error) {
                  setError(null);
                }
              }}
              placeholder={t('designerTab.tableNamePlaceholder')}
              style={{ width: 220, marginLeft: 12 }}
            />
          )}
        </div>
        <div className="designer-toolbar-right">
          <Button
            icon="refresh"
            text={t('designerTab.refresh')}
            small
            onClick={() => loadTableData()}
          />
          <Button
            icon="floppy-disk"
            text={t('designerTab.save')}
            intent={hasChanges ? Intent.PRIMARY : Intent.NONE}
            small
            onClick={handleSave}
            loading={isSaving}
            disabled={!hasChanges || !generatedSql}
          />
        </div>
      </div>

      {error && (
        <Callout intent={Intent.DANGER} className="designer-error">
          {error}
        </Callout>
      )}

      <div className="designer-content">
        <Tabs
          id={`designer-tabs-${tabId}`}
          selectedTabId={selectedTabId}
          onChange={(id) => setSelectedTabId(id as string)}
          renderActiveTabPanelOnly={false}
          large={false}
        >
          {!isNewTable && (
            <Tab id="ddl" title="DDL" panel={renderDdlTab()} />
          )}
          <Tab id="fields" title={t('designerTab.tabs.fields')} panel={renderFieldsTab()} />
          <Tab id="indexes" title={t('designerTab.tabs.indexes')} panel={renderIndexesTab()} />
          <Tab id="foreignKeys" title={t('designerTab.tabs.foreignKeys')} panel={renderForeignKeysTab()} />
          <Tab id="checks" title={t('designerTab.tabs.checks')} panel={renderChecksTab()} />
          <Tab id="triggers" title={t('designerTab.tabs.triggers')} panel={renderTriggersTab()} />
          <Tab id="options" title={t('designerTab.tabs.options')} panel={renderOptionsTab()} />
          <Tab id="sqlPreview" title={t('designerTab.tabs.sqlPreview')} panel={renderSqlPreviewTab()} />
        </Tabs>
      </div>
    </div>
  );
};
