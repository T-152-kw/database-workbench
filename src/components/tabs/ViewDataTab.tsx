import React, { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import {
  Button,
  ButtonGroup,
  HTMLSelect,
  InputGroup,
  Intent,
  Position,
  Spinner,
  Tooltip,
} from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import type { ConnectionProfile, QueryResult, ColumnMeta } from '../../types';
import { ViewIcon } from './DatabaseObjectIcons';
import { ViewPreviewCommitDialog, ConfirmDialog } from '../dialogs';
import { showExportSuccessNotice, showExportFailedNotice } from '../../utils/toolbarNotice';
import { exportApi, type ExportFormat } from '../../hooks/useTauri';
import '../../styles/table-data-tab.css';

enum RowState {
  SYNCED = 'SYNCED',
  NEW = 'NEW',
  MODIFIED = 'MODIFIED',
  DELETED = 'DELETED'
}

interface DataRow {
  state: RowState;
  originalData: unknown[];
  currentData: unknown[];
}

interface ViewDataTabProps {
  tabId: string;
  connectionProfile: ConnectionProfile;
  database: string;
  viewName: string;
}

interface ColumnInfo {
  name: string;
  typeName: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: unknown;
  // 视图列映射到基表的信息
  baseTableName?: string;
  baseColumnName?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  rowIndex: number;
  colIndex: number;
  cellValue: unknown;
  rowData: unknown[];
}

const RefreshIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 4v6h-6" />
    <path d="M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const AddRowIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const DeleteRowIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const SubmitIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

const WithdrawIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
  </svg>
);

const PreviewIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const ExportCsvIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="12" y2="12" />
    <line x1="15" y1="15" x2="12" y2="12" />
  </svg>
);



const formatCellValue = (value: unknown): string => {
  if (value === null || value === undefined) return '(NULL)';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const escapeSqlValue = (value: unknown, _typeName: string): string => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  const strValue = String(value);
  const escaped = strValue.replace(/'/g, "''");
  return `'${escaped}'`;
};

const escapeIdentifier = (name: string): string => {
  return `\`${name.replace(/`/g, '``')}\``;
};

const copyTextToClipboard = async (text: string): Promise<void> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fallback below
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
};

export const ViewDataTab: React.FC<ViewDataTabProps> = ({
  connectionProfile,
  database,
  viewName,
}) => {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [allRows, setAllRows] = useState<DataRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [isUpdatable, setIsUpdatable] = useState<boolean | null>(null);
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; colIndex: number } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [isPreviewDialogOpen, setIsPreviewDialogOpen] = useState(false);
  const [baseTableName, setBaseTableName] = useState<string>('');
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [whereClauseInput, setWhereClauseInput] = useState<string>('');
  const [groupByClauseInput, setGroupByClauseInput] = useState<string>('');
  const [orderByClauseInput, setOrderByClauseInput] = useState<string>('');
  const [appliedFilters, setAppliedFilters] = useState<{
    where: string;
    groupBy: string;
    orderBy: string;
  }>({ where: '', groupBy: '', orderBy: '' });
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const poolIdRef = useRef<number | null>(null);
  const connIdRef = useRef<number | null>(null);
  const resizingColRef = useRef<string | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  const offset = (page - 1) * pageSize;
  const totalPages = Math.ceil(totalRows / pageSize);

  const getDirtyRows = useCallback(() => allRows.filter(row => row.state !== RowState.SYNCED), [allRows]);
  const hasChangesFunc = useCallback(() => getDirtyRows().length > 0, [getDirtyRows]);

  const connect = useCallback(async () => {
    try {
      const newPoolId = await invoke<number>('pool_create', { profile: connectionProfile });
      const newConnId = await invoke<number>('pool_get_connection', { poolId: newPoolId, initialDatabase: database });

      await invoke('pool_execute', {
        poolId: newPoolId,
        connId: newConnId,
        sql: `USE ${escapeIdentifier(database)}`,
      });
      // 通知后端更新数据库状态
      await invoke('pool_set_database', {
        poolId: newPoolId,
        connId: newConnId,
        database,
      });

      poolIdRef.current = newPoolId;
      connIdRef.current = newConnId;
      return true;
    } catch (err) {
      setError(t('viewTab.data.errors.connectFailed', { error: err }));
      return false;
    }
  }, [connectionProfile, database, t]);

  const disconnect = useCallback(async () => {
    if (poolIdRef.current && connIdRef.current) {
      try {
        await invoke('pool_release_connection', { poolId: poolIdRef.current, connId: connIdRef.current });
        await invoke('pool_close', { poolId: poolIdRef.current });
      } catch (err) {
        console.error('Disconnect error:', err);
      }
    }
    poolIdRef.current = null;
    connIdRef.current = null;
  }, []);

  const checkViewUpdatability = useCallback(async () => {
    if (!poolIdRef.current || !connIdRef.current) return;

    try {
      const result = await invoke<QueryResult>('pool_query', {
        poolId: poolIdRef.current,
        connId: connIdRef.current,
        sql: `SELECT IS_UPDATABLE 
              FROM INFORMATION_SCHEMA.VIEWS 
              WHERE TABLE_SCHEMA = ${escapeSqlValue(database, 'VARCHAR')} 
              AND TABLE_NAME = ${escapeSqlValue(viewName, 'VARCHAR')}`,
      });

      if (result.rows.length > 0) {
        const isUpdatableValue = String(result.rows[0][0]);
        setIsUpdatable(isUpdatableValue === 'YES');
      } else {
        setIsUpdatable(false);
      }
    } catch (err) {
      console.error('Failed to check view updatability:', err);
      setIsUpdatable(false);
    }
  }, [database, viewName]);

  // 获取视图的列映射信息
  const fetchViewColumnMappings = useCallback(async () => {
    if (!poolIdRef.current || !connIdRef.current) return;

    try {
      // 获取视图的定义
      const viewDefResult = await invoke<QueryResult>('pool_query', {
        poolId: poolIdRef.current,
        connId: connIdRef.current,
        sql: `SELECT VIEW_DEFINITION 
              FROM INFORMATION_SCHEMA.VIEWS 
              WHERE TABLE_SCHEMA = ${escapeSqlValue(database, 'VARCHAR')} 
              AND TABLE_NAME = ${escapeSqlValue(viewName, 'VARCHAR')}`,
      });

      if (viewDefResult.rows.length > 0) {
        const viewDefinition = String(viewDefResult.rows[0][0] || '');
        
        // 尝试从视图定义中提取基表名
        // 支持格式: FROM table, FROM `table`, FROM db.table, FROM `db`.`table`
        const fromMatch = viewDefinition.match(/FROM\s+(?:`?\w+`?\s*\.\s*)?`?(\w+)`?/i);
        if (fromMatch) {
          setBaseTableName(fromMatch[1]);
          console.log('Base table name extracted:', fromMatch[1]);
        } else {
          console.log('Failed to extract base table name from view definition');
        }
      }

      // 获取视图的列信息
      const columnResult = await invoke<QueryResult>('pool_query', {
        poolId: poolIdRef.current,
        connId: connIdRef.current,
        sql: `SELECT 
          COLUMN_NAME,
          COLUMN_TYPE,
          IS_NULLABLE,
          COLUMN_KEY,
          COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = ${escapeSqlValue(database, 'VARCHAR')} 
        AND TABLE_NAME = ${escapeSqlValue(viewName, 'VARCHAR')}
        ORDER BY ORDINAL_POSITION`,
      });

      // 尝试获取基表的列信息（用于映射）
      const baseTableColumns: Record<string, string> = {}; // 视图列名 -> 基表列名
      
      if (baseTableName) {
        try {
          // 获取基表的所有列
          const baseColumnResult = await invoke<QueryResult>('pool_query', {
            poolId: poolIdRef.current,
            connId: connIdRef.current,
            sql: `SELECT 
              COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = ${escapeSqlValue(database, 'VARCHAR')} 
            AND TABLE_NAME = ${escapeSqlValue(baseTableName, 'VARCHAR')}
            ORDER BY ORDINAL_POSITION`,
          });

          const baseColNames = baseColumnResult.rows.map(row => String(row[0]));
          
          // 尝试从视图定义中解析列映射
          // 视图定义格式: SELECT `db`.`table`.`col` AS `ALIAS`, ...
          if (viewDefResult.rows.length > 0) {
            const viewDefinition = String(viewDefResult.rows[0][0] || '');
            
            // 解析SELECT部分
            const selectMatch = viewDefinition.match(/SELECT\s+(.+?)\s+FROM/i);
            if (selectMatch) {
              const selectPart = selectMatch[1];
              // 分割列定义
              const colDefs = selectPart.split(',').map(s => s.trim());
              
              colDefs.forEach((colDef) => {
                // 匹配格式: `db`.`table`.`col` AS `ALIAS` 或 `table`.`col` AS `ALIAS` 或 `col` AS `ALIAS`
                const aliasMatch = colDef.match(/`?(?:\w+`?\s*\.\s*)?`?(\w+)`?\s+AS\s+`?(\w+)`?/i);
                if (aliasMatch) {
                  const baseCol = aliasMatch[1];
                  const viewCol = aliasMatch[2];
                  baseTableColumns[viewCol] = baseCol;
                  baseTableColumns[viewCol.toLowerCase()] = baseCol;
                } else {
                  // 没有AS别名，尝试直接匹配
                  const simpleMatch = colDef.match(/`?(?:\w+`?\s*\.\s*)?`?(\w+)`?$/i);
                  if (simpleMatch) {
                    const colName = simpleMatch[1];
                    baseTableColumns[colName] = colName;
                  }
                }
              });
            }
          }
          
          // 对于没有解析到的列，尝试大小写不敏感匹配
          columnResult.rows.forEach((row) => {
            const viewColName = String(row[0]);
            if (!baseTableColumns[viewColName]) {
              // 尝试在基表列中查找匹配的列（忽略大小写）
              const matchedBaseCol = baseColNames.find(
                baseCol => baseCol.toLowerCase() === viewColName.toLowerCase()
              );
              if (matchedBaseCol) {
                baseTableColumns[viewColName] = matchedBaseCol;
              }
            }
          });
        } catch (err) {
          console.error('Failed to fetch base table columns:', err);
        }
      }

      const columnInfos: ColumnInfo[] = columnResult.rows.map((row) => {
        const viewColName = String(row[0]);
        const baseColName = baseTableColumns[viewColName] || viewColName;
        
        return {
          name: viewColName,
          typeName: String(row[1]),
          isNullable: String(row[2]) === 'YES',
          isPrimaryKey: String(row[3]) === 'PRI',
          defaultValue: row[4],
          baseTableName: baseTableName,
          baseColumnName: baseColName,
        };
      });

      setColumns(columnInfos);
    } catch (err) {
      console.error('Failed to fetch view column mappings:', err);
    }
  }, [database, viewName, baseTableName]);

  const fetchData = useCallback(async () => {
    if (!poolIdRef.current || !connIdRef.current) return;

    setIsLoading(true);
    setError(null);

    try {
      const countResult = await invoke<QueryResult>('pool_query', {
        poolId: poolIdRef.current,
        connId: connIdRef.current,
        sql: `SELECT COUNT(*) FROM ${escapeIdentifier(database)}.${escapeIdentifier(viewName)}`,
      });
      const count = Number(countResult.rows[0]?.[0] || 0);
      setTotalRows(count);

      let sql = `SELECT * FROM ${escapeIdentifier(database)}.${escapeIdentifier(viewName)}`;
      if (appliedFilters.where.trim()) {
        sql += ` WHERE ${appliedFilters.where.trim()}`;
      }
      if (appliedFilters.groupBy.trim()) {
        sql += ` GROUP BY ${appliedFilters.groupBy.trim()}`;
      }
      if (appliedFilters.orderBy.trim()) {
        sql += ` ORDER BY ${appliedFilters.orderBy.trim()}`;
      }
      sql += ` LIMIT ${offset}, ${pageSize}`;

      const dataResult = await invoke<QueryResult>('pool_query', {
        poolId: poolIdRef.current,
        connId: connIdRef.current,
        sql,
      });

      const dataRows: DataRow[] = dataResult.rows.map((row) => ({
        state: RowState.SYNCED,
        originalData: row,
        currentData: [...row],
      }));

      setAllRows(dataRows);

      // 如果列信息还没有加载，从查询结果中获取
      if (columns.length === 0) {
        setColumns(dataResult.columns.map((col: ColumnMeta) => ({
          name: col.name,
          typeName: col.typeName,
          isNullable: true,
          isPrimaryKey: false,
          defaultValue: null,
        })));
      }
    } catch (err) {
      setError(t('viewTab.data.errors.loadDataFailed', { error: err }));
    } finally {
      setIsLoading(false);
    }
  }, [database, viewName, offset, pageSize, columns.length, t, appliedFilters]);

  useEffect(() => {
    const init = async () => {
      const connected = await connect();
      if (connected) {
        await checkViewUpdatability();
        await fetchViewColumnMappings();
        await fetchData();
      }
    };
    init();

    return () => {
      disconnect();
    };
  }, []);

  useEffect(() => {
    if (poolIdRef.current && connIdRef.current) {
      fetchData();
    }
  }, [page, pageSize, fetchData]);

  const handleRefresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  const handleResetFilters = useCallback(() => {
    setWhereClauseInput('');
    setGroupByClauseInput('');
    setOrderByClauseInput('');
    setAppliedFilters({ where: '', groupBy: '', orderBy: '' });
    setPage(1);
  }, []);

  const handleApplyFilters = useCallback(() => {
    setAppliedFilters({
      where: whereClauseInput,
      groupBy: groupByClauseInput,
      orderBy: orderByClauseInput,
    });
    setPage(1);
  }, [whereClauseInput, groupByClauseInput, orderByClauseInput]);

  const getFileExtension = (format: ExportFormat): string => {
    switch (format) {
      case 'csv': return 'csv';
      case 'txt': return 'txt';
      case 'json': return 'json';
      case 'html': return 'html';
      case 'xml': return 'xml';
      case 'sql': return 'sql';
      case 'jsonl': return 'jsonl';
      case 'xlsx': return 'xlsx';
      default: return 'csv';
    }
  };

  const getFileFilter = (format: ExportFormat) => {
    const ext = getFileExtension(format);
    return [{ name: format.toUpperCase(), extensions: [ext] }];
  };

  const handleExport = useCallback(async (exportAll: boolean) => {
    try {
      const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const ext = getFileExtension(exportFormat);
      const defaultFileName = `${viewName}_${timestamp}.${ext}`;

      const selectedPath = await save({
        title: t('viewTab.data.export.title', { format: exportFormat.toUpperCase() }),
        defaultPath: defaultFileName,
        filters: getFileFilter(exportFormat),
        canCreateDirectories: true,
      });

      if (!selectedPath) {
        return;
      }

      if (exportAll) {
        // 导出全表
        const result = await exportApi.exportTable(
          connectionProfile,
          database,
          viewName,
          selectedPath,
          exportFormat
        );
        if (result.success) {
          await showExportSuccessNotice(result.rowsExported, result.filePath);
        } else {
          await showExportFailedNotice(result.error || 'Unknown error');
        }
      } else {
        // 导出当前页
        const headers = columns.map((col) => col.name);
        const rows = allRows
          .filter((row) => row.state !== RowState.DELETED)
          .map((row) => row.currentData.map((value) => formatCellValue(value)));

        const result = await exportApi.exportQueryResult(
          selectedPath,
          headers,
          rows,
          exportFormat,
          viewName
        );
        if (result.success) {
          await showExportSuccessNotice(result.rowsExported, result.filePath);
        } else {
          await showExportFailedNotice(result.error || 'Unknown error');
        }
      }
    } catch (error) {
      await showExportFailedNotice(String(error));
    }
  }, [connectionProfile, database, viewName, columns, allRows, exportFormat, t]);

  const handleExportClick = useCallback(() => {
    const totalPages = Math.ceil(totalRows / pageSize);
    if (totalPages <= 1) {
      // 只有一页，直接导出全表
      handleExport(true);
    } else {
      // 多页，显示选择对话框
      setIsExportDialogOpen(true);
    }
  }, [totalRows, pageSize, handleExport]);

  const handleAddRow = useCallback(() => {
    const newRow = columns.map(() => null);
    const dataRow: DataRow = {
      state: RowState.NEW,
      originalData: [],
      currentData: newRow,
    };
    setAllRows((prev) => [...prev, dataRow]);
  }, [columns]);

  const handleDeleteRow = useCallback(() => {
    if (selectedRowIndexes.size === 0) return;

    setAllRows((prev) => {
      const newRows = [...prev];
      for (const rowIndex of selectedRowIndexes) {
        if (newRows[rowIndex]) {
          if (newRows[rowIndex].state === RowState.NEW) {
            newRows[rowIndex] = { ...newRows[rowIndex], state: RowState.DELETED };
          } else {
            newRows[rowIndex] = { ...newRows[rowIndex], state: RowState.DELETED };
          }
        }
      }
      return newRows;
    });
    setSelectedRowIndexes(new Set());
  }, [selectedRowIndexes]);

  const handleWithdraw = useCallback(() => {
    setAllRows((prevRows) => {
      const newRows: DataRow[] = [];
      for (const row of prevRows) {
        if (row.state === RowState.NEW) {
          continue;
        } else if (row.state === RowState.DELETED) {
          newRows.push({
            ...row,
            state: RowState.SYNCED,
          });
        } else if (row.state === RowState.MODIFIED) {
          newRows.push({
            ...row,
            state: RowState.SYNCED,
            currentData: [...row.originalData],
          });
        } else {
          newRows.push(row);
        }
      }
      return newRows;
    });
    setSelectedRowIndexes(new Set());
  }, []);

  // 获取基表的主键列
  const getBaseTablePrimaryKeys = useCallback(async (): Promise<string[]> => {
    if (!poolIdRef.current || !connIdRef.current || !baseTableName) return [];

    try {
      const result = await invoke<QueryResult>('pool_query', {
        poolId: poolIdRef.current,
        connId: connIdRef.current,
        sql: `SELECT COLUMN_NAME 
              FROM INFORMATION_SCHEMA.COLUMNS 
              WHERE TABLE_SCHEMA = ${escapeSqlValue(database, 'VARCHAR')} 
              AND TABLE_NAME = ${escapeSqlValue(baseTableName, 'VARCHAR')}
              AND COLUMN_KEY = 'PRI'`,
      });

      return result.rows.map(row => String(row[0]));
    } catch (err) {
      console.error('Failed to get base table primary keys:', err);
      return [];
    }
  }, [database, baseTableName]);

  const handleSubmitChanges = useCallback(async () => {
    if (!poolIdRef.current || !connIdRef.current) return;
    const dirtyRows = getDirtyRows();
    if (dirtyRows.length === 0) return;

    setIsLoading(true);
    setError(null);

    try {
      const pkColumns = await getBaseTablePrimaryKeys();

      if (pkColumns.length === 0) {
        throw new Error(t('viewTab.data.errors.cannotDeterminePk'));
      }

      for (const row of dirtyRows) {
        if (row.state === RowState.DELETED) {
          if (row.originalData.length > 0 && pkColumns.length > 0) {
            // 构建WHERE子句，使用基表的主键
            const whereClause = pkColumns
              .map((pkName) => {
                const colIndex = columns.findIndex((c) => c.name === pkName);
                if (colIndex === -1) {
                  throw new Error(t('viewTab.data.errors.pkColumnNotFound', { name: pkName }));
                }
                return `${escapeIdentifier(pkName)} = ${escapeSqlValue(row.originalData[colIndex], columns[colIndex]?.typeName || '')}`;
              })
              .join(' AND ');

            await invoke('pool_execute', {
              poolId: poolIdRef.current,
              connId: connIdRef.current,
              sql: `DELETE FROM ${escapeIdentifier(database)}.${escapeIdentifier(baseTableName)} WHERE ${whereClause}`,
            });
          }
        } else if (row.state === RowState.NEW) {
          // 插入到基表
          const colNames = columns.map((col) => escapeIdentifier(col.name)).join(', ');
          const values = row.currentData
            .map((value, idx) => escapeSqlValue(value, columns[idx]?.typeName || ''))
            .join(', ');

          await invoke('pool_execute', {
            poolId: poolIdRef.current,
            connId: connIdRef.current,
            sql: `INSERT INTO ${escapeIdentifier(database)}.${escapeIdentifier(baseTableName)} (${colNames}) VALUES (${values})`,
          });
        } else if (row.state === RowState.MODIFIED) {
          // 更新基表
          const changedColumns: { colIndex: number; value: unknown }[] = [];
          for (let i = 0; i < row.currentData.length; i++) {
            if (row.currentData[i] !== row.originalData[i]) {
              changedColumns.push({ colIndex: i, value: row.currentData[i] });
            }
          }

          if (changedColumns.length > 0) {
            const setClause = changedColumns
              .map(({ colIndex, value }) => {
                const col = columns[colIndex];
                return `${escapeIdentifier(col.name)} = ${escapeSqlValue(value, col.typeName)}`;
              })
              .join(', ');

            const whereClause = pkColumns
              .map((pkName) => {
                const colIndex = columns.findIndex((c) => c.name === pkName);
                if (colIndex === -1) {
                  throw new Error(t('viewTab.data.errors.pkColumnNotFound', { name: pkName }));
                }
                return `${escapeIdentifier(pkName)} = ${escapeSqlValue(row.originalData[colIndex], columns[colIndex]?.typeName || '')}`;
              })
              .join(' AND ');

            await invoke('pool_execute', {
              poolId: poolIdRef.current,
              connId: connIdRef.current,
              sql: `UPDATE ${escapeIdentifier(database)}.${escapeIdentifier(baseTableName)} SET ${setClause} WHERE ${whereClause}`,
            });
          }
        }
      }

      await fetchData();
    } catch (err) {
      setError(t('viewTab.data.errors.submitFailed', { error: err }));
    } finally {
      setIsLoading(false);
    }
  }, [getDirtyRows, columns, database, baseTableName, fetchData, getBaseTablePrimaryKeys, t]);

  const handleRowSelect = useCallback((rowIndex: number, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      setSelectedRowIndexes((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(rowIndex)) {
          newSet.delete(rowIndex);
        } else {
          newSet.add(rowIndex);
        }
        return newSet;
      });
    } else if (event.shiftKey && selectedRowIndexes.size > 0) {
      const lastSelected = Math.max(...Array.from(selectedRowIndexes));
      const start = Math.min(lastSelected, rowIndex);
      const end = Math.max(lastSelected, rowIndex);
      setSelectedRowIndexes(new Set(Array.from({ length: end - start + 1 }, (_, i) => start + i)));
    } else {
      setSelectedRowIndexes(new Set([rowIndex]));
    }
  }, [selectedRowIndexes]);

  const handleCellDoubleClick = useCallback((rowIndex: number, colIndex: number) => {
    const row = allRows[rowIndex];
    if (!row || row.state === RowState.DELETED) return;
    
    const value = row.currentData[colIndex];
    setEditingCell({ rowIndex, colIndex });
    setEditValue(value === null || value === undefined ? '' : String(value));
  }, [allRows]);

  const handleCellEditComplete = useCallback(() => {
    if (!editingCell) return;

    const { rowIndex, colIndex } = editingCell;

    setAllRows((prev) => {
      const newRows = [...prev];
      const row = newRows[rowIndex];
      if (!row) return prev;

      const newCurrentData = [...row.currentData];
      newCurrentData[colIndex] = editValue === '' ? null : editValue;

      const hasDataChanged = newCurrentData.some((val, idx) => val !== row.originalData[idx]);

      if (row.state === RowState.NEW) {
        newRows[rowIndex] = {
          ...row,
          currentData: newCurrentData,
        };
      } else if (hasDataChanged) {
        newRows[rowIndex] = {
          ...row,
          state: RowState.MODIFIED,
          currentData: newCurrentData,
        };
      } else {
        newRows[rowIndex] = {
          ...row,
          state: RowState.SYNCED,
          currentData: newCurrentData,
        };
      }

      return newRows;
    });

    setEditingCell(null);
    setEditValue('');
  }, [editingCell, editValue]);

  const handleCellEditCancel = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleCellEditComplete();
    } else if (event.key === 'Escape') {
      handleCellEditCancel();
    }
  }, [handleCellEditComplete, handleCellEditCancel]);

  const handleResizeStart = useCallback((colName: string, e: React.MouseEvent, thElement: HTMLTableCellElement) => {
    e.preventDefault();
    e.stopPropagation();
    resizingColRef.current = colName;
    startXRef.current = e.clientX;
    // 使用实际测量的宽度，避免跳动
    const actualWidth = thElement.getBoundingClientRect().width;
    const currentWidth = columnWidths[colName] || actualWidth;
    startWidthRef.current = currentWidth;

    // 立即设置初始宽度，防止跳动
    if (!columnWidths[colName]) {
      setColumnWidths(prev => ({
        ...prev,
        [colName]: actualWidth
      }));
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingColRef.current) return;
      const delta = moveEvent.clientX - startXRef.current;
      const newWidth = Math.max(80, startWidthRef.current + delta);
      setColumnWidths(prev => ({
        ...prev,
        [resizingColRef.current!]: newWidth
      }));
    };

    const handleMouseUp = () => {
      resizingColRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [columnWidths]);

  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
    }
  }, [totalPages]);

  const handlePageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  }, []);

  // 右键菜单处理函数
  const handleCellContextMenu = useCallback((
    event: React.MouseEvent<HTMLTableCellElement>,
    rowIndex: number,
    colIndex: number,
    row: DataRow
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const cellValue = row.currentData[colIndex];
    const rowData = row.currentData;

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      rowIndex,
      colIndex,
      cellValue,
      rowData,
    });
  }, []);

  const handleCopyCell = useCallback(async () => {
    if (!contextMenu) return;
    const text = formatCellValue(contextMenu.cellValue);
    await copyTextToClipboard(text);
    setContextMenu(null);
  }, [contextMenu]);

  const handleCopyRow = useCallback(async () => {
    if (!contextMenu) return;
    const text = contextMenu.rowData.map((value) => formatCellValue(value)).join('\t');
    await copyTextToClipboard(text);
    setContextMenu(null);
  }, [contextMenu]);

  const handleEditCell = useCallback(() => {
    if (!contextMenu) return;
    handleCellDoubleClick(contextMenu.rowIndex, contextMenu.colIndex);
    setContextMenu(null);
  }, [contextMenu, handleCellDoubleClick]);

  const handleCancelContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // 全局点击关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;

    const handleGlobalClick = () => setContextMenu(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('contextmenu', handleGlobalClick);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleGlobalClick, true);

    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('contextmenu', handleGlobalClick);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleGlobalClick, true);
    };
  }, [contextMenu]);

  const hasChanges = hasChangesFunc();
  const readOnly = isUpdatable === false;

  const renderCell = (rowIndex: number, colIndex: number, row: DataRow) => {
    const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.colIndex === colIndex;
    const displayValue = row.currentData[colIndex];

    if (isEditing) {
      return (
        <InputGroup
          small
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleCellEditComplete}
          className="table-data-cell-input"
        />
      );
    }

    const isModified = row.state === RowState.MODIFIED && row.originalData[colIndex] !== row.currentData[colIndex];
    
    return (
      <div
        className={`table-data-cell-text ${isModified ? 'modified' : ''} ${displayValue === null ? 'null-value' : ''}`}
        title={formatCellValue(displayValue)}
        onDoubleClick={readOnly ? undefined : () => handleCellDoubleClick(rowIndex, colIndex)}
      >
        {formatCellValue(displayValue)}
      </div>
    );
  };

  return (
    <div className="table-data-tab">
      <div className="table-data-filter-bar">
        <div className="filter-section">
          <div className="filter-input-group">
            <svg className="filter-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            <span className="filter-label">WHERE</span>
            <InputGroup
              small
              placeholder=""
              value={whereClauseInput}
              onChange={(e) => setWhereClauseInput(e.target.value)}
              className="filter-input"
              disabled={isLoading}
            />
          </div>
          <div className="filter-divider" />
          <div className="filter-input-group">
            <svg className="filter-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
            </svg>
            <span className="filter-label">GROUP BY</span>
            <InputGroup
              small
              placeholder=""
              value={groupByClauseInput}
              onChange={(e) => setGroupByClauseInput(e.target.value)}
              className="filter-input"
              disabled={isLoading}
            />
          </div>
          <div className="filter-divider" />
          <div className="filter-input-group">
            <svg className="filter-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="13" y2="6"/>
              <line x1="4" y1="12" x2="11" y2="12"/>
              <line x1="4" y1="18" x2="11" y2="18"/>
              <polyline points="15 15 18 18 21 15"/>
              <line x1="18" y1="6" x2="18" y2="18"/>
            </svg>
            <span className="filter-label">ORDER BY</span>
            <InputGroup
              small
              placeholder=""
              value={orderByClauseInput}
              onChange={(e) => setOrderByClauseInput(e.target.value)}
              className="filter-input"
              disabled={isLoading}
            />
          </div>
        </div>
        <div className="filter-buttons">
          <Button
            small
            minimal
            onClick={handleResetFilters}
            disabled={isLoading}
          >
            {t('viewTab.data.buttons.reset')}
          </Button>
          <Button
            small
            intent={Intent.PRIMARY}
            onClick={handleApplyFilters}
            disabled={isLoading}
          >
            {t('viewTab.data.buttons.confirm')}
          </Button>
        </div>
      </div>

      <div className="table-data-toolbar">
        <ButtonGroup minimal>
          <Tooltip content={t('viewTab.data.tooltips.refresh')} position={Position.BOTTOM}>
            <Button
              small
              icon={<RefreshIcon />}
              onClick={handleRefresh}
              disabled={isLoading}
            >
              {t('viewTab.data.toolbar.refresh')}
            </Button>
          </Tooltip>
          {!readOnly && (
            <>
              <Tooltip content={t('viewTab.data.tooltips.addRow')} position={Position.BOTTOM}>
                <Button
                  small
                  icon={<AddRowIcon />}
                  onClick={handleAddRow}
                  disabled={isLoading}
                >
                  {t('viewTab.data.toolbar.addRow')}
                </Button>
              </Tooltip>
              <Tooltip content={t('viewTab.data.tooltips.deleteRow')} position={Position.BOTTOM}>
                <Button
                  small
                  icon={<DeleteRowIcon />}
                  onClick={handleDeleteRow}
                  disabled={isLoading || selectedRowIndexes.size === 0 || hasChanges}
                  intent={selectedRowIndexes.size > 0 && !hasChanges ? Intent.DANGER : Intent.NONE}
                >
                  {t('viewTab.data.toolbar.deleteRow')}
                </Button>
              </Tooltip>
              <Tooltip content={t('viewTab.data.tooltips.preview')} position={Position.BOTTOM}>
                <Button
                  small
                  icon={<PreviewIcon />}
                  onClick={() => setIsPreviewDialogOpen(true)}
                  disabled={isLoading || !hasChanges}
                >
                  {t('viewTab.data.toolbar.preview')}
                </Button>
              </Tooltip>
              <Tooltip content={t('viewTab.data.tooltips.withdraw')} position={Position.BOTTOM}>
                <Button
                  small
                  icon={<WithdrawIcon />}
                  onClick={handleWithdraw}
                  disabled={isLoading || !hasChanges}
                >
                  {t('viewTab.data.toolbar.withdraw')}
                </Button>
              </Tooltip>
              <Tooltip content={t('viewTab.data.tooltips.submit')} position={Position.BOTTOM}>
                <Button
                  small
                  icon={<SubmitIcon />}
                  onClick={handleSubmitChanges}
                  disabled={isLoading || !hasChanges}
                  intent={hasChanges ? Intent.PRIMARY : Intent.NONE}
                >
                  {t('viewTab.data.toolbar.submit')}
                </Button>
              </Tooltip>
            </>
          )}
        </ButtonGroup>

        <div className="table-data-toolbar-spacer" />

        <div className="table-data-toolbar-info">
          {hasChanges && !readOnly && (
            <span className="table-data-changes-indicator">
              {getDirtyRows().length} {t('viewTab.data.toolbar.changesPending')}
            </span>
          )}
          {selectedRowIndexes.size > 0 && (
            <span className="table-data-selection-info">
              {t('viewTab.data.toolbar.rowsSelected', { count: selectedRowIndexes.size })}
            </span>
          )}
          <span className="table-data-view-info">
            {t('viewTab.data.title')}
          </span>
        </div>

        {/* Format Selection and Export - 放在最右侧 */}
        <div className="table-data-toolbar-import-export">
          <HTMLSelect
            className="format-select-small"
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
            options={[
              { value: 'csv', label: t('tableDataTab.format.csv') },
              { value: 'txt', label: t('tableDataTab.format.txt') },
              { value: 'json', label: t('tableDataTab.format.json') },
              { value: 'html', label: t('tableDataTab.format.html') },
              { value: 'xml', label: t('tableDataTab.format.xml') },
              { value: 'sql', label: t('tableDataTab.format.sql') },
              { value: 'xlsx', label: t('tableDataTab.format.xlsx') },
            ]}
            disabled={isLoading}
          />
          <Tooltip content={t('tableDataTab.tooltips.export')} position={Position.BOTTOM}>
            <Button
              icon={<ExportCsvIcon />}
              onClick={handleExportClick}
              disabled={isLoading || allRows.length === 0}
            >
              {t('tableDataTab.buttons.export')}
            </Button>
          </Tooltip>
        </div>

      </div>

      {readOnly && (
        <div className="table-data-readonly-banner">
          <div className="readonly-banner-icon">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="readonly-banner-content">
            <strong>{t('viewTab.data.readOnly.title')}</strong>
            <span>{t('viewTab.data.readOnly.description')}</span>
          </div>
        </div>
      )}

      {error && (
        <div className="table-data-error">
          <span>{error}</span>
          <Button small minimal onClick={() => setError(null)}>
            ✕
          </Button>
        </div>
      )}

      <div className="table-data-content">
        {isLoading && !allRows.length ? (
          <div className="table-data-loading">
            <Spinner size={32} />
            <span>{t('viewTab.data.loading')}</span>
          </div>
        ) : (
          <div className="table-data-wrapper">
            <table className="table-data-grid">
              <thead>
                <tr>
                  <th className="row-number-col">#</th>
                  {columns.map((col) => (
                    <th
                      key={col.name}
                      ref={(el) => {
                        if (el) {
                          el.dataset.colName = col.name;
                        }
                      }}
                      style={{ width: columnWidths[col.name] || 'auto', minWidth: columnWidths[col.name] || 120 }}
                      className="resizable-column"
                    >
                      <div className="table-data-header-content">
                        <span>{col.name}</span>
                        {col.isPrimaryKey && <span className="pk-indicator">PK</span>}
                      </div>
                      <div className="table-data-header-type">{col.typeName}</div>
                      <div
                        className="column-resize-handle"
                        onMouseDown={(e) => {
                          const thElement = e.currentTarget.parentElement as HTMLTableCellElement;
                          handleResizeStart(col.name, e, thElement);
                        }}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allRows.map((row, rowIndex) => {
                  if (row.state === RowState.DELETED) return null;
                  
                  const rowClassName = `table-data-row ${selectedRowIndexes.has(rowIndex) ? 'selected' : ''} ${
                    row.state === RowState.NEW ? 'row-new' : 
                    row.state === RowState.MODIFIED ? 'row-modified' : ''
                  }`;
                  
                  return (
                    <tr
                      key={`row-${rowIndex}`}
                      className={rowClassName}
                      onClick={(e) => !readOnly && handleRowSelect(rowIndex, e)}
                    >
                      <td className="row-number-col">
                        {row.state === RowState.NEW ? '*' : offset + rowIndex + 1}
                      </td>
                      {row.currentData.map((_, colIndex) => (
                        <td
                          key={`cell-${rowIndex}-${colIndex}`}
                          onContextMenu={(e) => handleCellContextMenu(e, rowIndex, colIndex, row)}
                        >
                          {renderCell(rowIndex, colIndex, row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* 右键菜单 */}
            {contextMenu && (
              <div
                className="table-data-context-menu"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <button className="table-data-context-menu-item" onClick={handleCopyCell}>
                  {t('tableDataTab.contextMenu.copy')}
                </button>
                <button className="table-data-context-menu-item" onClick={handleCopyRow}>
                  {t('tableDataTab.contextMenu.copyRow')}
                </button>
                {!readOnly && (
                  <>
                    <div className="table-data-context-menu-divider" />
                    <button className="table-data-context-menu-item" onClick={handleEditCell}>
                      {t('tableDataTab.contextMenu.edit')}
                    </button>
                  </>
                )}
                <div className="table-data-context-menu-divider" />
                <button className="table-data-context-menu-item" onClick={handleCancelContextMenu}>
                  {t('tableDataTab.contextMenu.cancel')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="table-data-pagination">
        <div className="pagination-info">
          {t('viewTab.data.pagination.showing', { start: offset + 1, end: Math.min(offset + pageSize, totalRows), total: totalRows })}
        </div>
        <div className="pagination-controls">
          <span className="pagination-page-size-label">{t('viewTab.data.pagination.pageSize')}:</span>
          <HTMLSelect
            value={pageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            options={[
              { value: '50', label: '50' },
              { value: '100', label: '100' },
              { value: '200', label: '200' },
              { value: '500', label: '500' },
              { value: '1000', label: '1000' },
            ]}
          />
          <Button
            small
            minimal
            disabled={page <= 1}
            onClick={() => handlePageChange(1)}
          >
            {'<<'}
          </Button>
          <Button
            small
            minimal
            disabled={page <= 1}
            onClick={() => handlePageChange(page - 1)}
          >
            {'<'}
          </Button>
          <span className="pagination-page">
            第 {page} / {totalPages || 1} 页
          </span>
          <Button
            small
            minimal
            disabled={page >= totalPages}
            onClick={() => handlePageChange(page + 1)}
          >
            {'>'}
          </Button>
          <Button
            small
            minimal
            disabled={page >= totalPages}
            onClick={() => handlePageChange(totalPages)}
          >
            {'>>'}
          </Button>
        </div>
      </div>

      {!readOnly && (
        <ViewPreviewCommitDialog
          isOpen={isPreviewDialogOpen}
          onClose={() => setIsPreviewDialogOpen(false)}
          connectionProfile={connectionProfile}
          database={database}
          viewName={viewName}
          baseTableName={baseTableName || viewName}
          columns={columns}
          changedRows={getDirtyRows()}
          primaryKeys={columns.filter(col => col.isPrimaryKey).map(col => col.name)}
        />
      )}

      <ConfirmDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        onConfirm={() => handleExport(true)}
        onCancel={() => handleExport(false)}
        title={t('viewTab.data.export.dialogTitle')}
        message={t('viewTab.data.export.dialogMessage', { totalRows })}
        confirmText={t('viewTab.data.export.exportAll')}
        cancelText={t('viewTab.data.export.exportCurrent')}
        intent="primary"
      />
    </div>
  );
};

export const getViewDataTabTitle = (viewName: string, database: string, connectionName: string): string => {
  return `${viewName}@${database}(${connectionName}) - 视图`;
};

export const getViewDataTabIcon = () => <ViewIcon size={16} />;

export default ViewDataTab;
