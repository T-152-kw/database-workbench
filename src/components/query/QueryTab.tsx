import React, { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useTranslation } from 'react-i18next';
import type { ConnectionProfile, QueryResultData, MultiQueryResultData, ExecResultData, ResultTab } from '../../types';
import { useAppStore, useConnectionStore, useTabStore } from '../../stores';
import { QueryToolbar } from './QueryToolbar';
import { QueryEditor, type QueryEditorRef } from './QueryEditor';
import { ResultPanel } from './ResultPanel';
import { getEditorSettings } from '../../utils/editorSettings';
import { setSQLCompletionContext, clearSQLCompletionMetadataCache } from '../../utils/sqlCompletionProvider';
import '../../styles/query-tab.css';

interface QueryTabProps {
  tabId: string;
  initialConnection?: ConnectionProfile;
  initialDatabase?: string;
}

interface QueryPageResultData extends QueryResultData {
  page: number;
  page_size: number;
  has_more: boolean;
  total_rows?: number | null;
  total_pages?: number | null;
}

interface StatementSplitSessionData {
  session_id: number;
  total: number;
}

interface ScriptExecutePageEntryData {
  statement_index: number;
  sql: string;
  result_type: 'query' | 'query_page' | 'multi_query' | 'update' | 'error';
  query_result?: QueryResultData;
  query_page_result?: QueryPageResultData;
  multi_query_result?: MultiQueryResultData;
  exec_result?: ExecResultData;
  error?: string;
}

interface ScriptExecutePageResultData {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_more: boolean;
  entries: ScriptExecutePageEntryData[];
}

interface ScriptExecuteProgressEventData {
  run_id: string;
  processed: number;
  total: number;
  success: number;
  error: number;
  statement_index: number;
}

// Chevron icons for collapse/expand
const ChevronDownIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ChevronUpIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

// Split pane resizer component with collapse button
const SplitPaneResizer: React.FC<{
  isDragging: boolean;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onToggleCollapse: () => void;
}> = ({ isDragging, onMouseDown, onToggleCollapse }) => {
  const handleCollapseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCollapse();
  };

  return (
    <div
      className={`split-pane-resizer ${isDragging ? 'dragging' : ''}`}
      onMouseDown={onMouseDown}
    >
      <div className="split-pane-resizer-line" />
      <button
        className="split-pane-collapse-btn"
        onClick={handleCollapseClick}
        title="折叠结果面板"
      >
        <ChevronDownIcon size={12} />
      </button>
    </div>
  );
};

const SPLITTER_HEIGHT = 8;
const MIN_EDITOR_HEIGHT = 160;
const MIN_RESULT_HEIGHT = 140;
const DEFAULT_SQL_STATEMENT_PAGE_SIZE = 256;
const RESULT_TAB_FLUSH_BATCH_SIZE = 64;
const MAX_VISIBLE_RESULT_TABS = 600;

const clampEditorHeight = (containerHeight: number, targetHeight: number): number => {
  if (containerHeight <= 0) return MIN_EDITOR_HEIGHT;

  const maxEditorHeight = Math.max(
    MIN_EDITOR_HEIGHT,
    containerHeight - SPLITTER_HEIGHT - MIN_RESULT_HEIGHT,
  );

  const minEditorHeight = Math.min(MIN_EDITOR_HEIGHT, maxEditorHeight);

  return Math.min(maxEditorHeight, Math.max(minEditorHeight, targetHeight));
};

const isLikelySingleStatementSql = (sql: string): boolean => {
  const normalized = sql.trim().replace(/;\s*$/, '');
  if (!normalized) {
    return false;
  }
  return !normalized.includes(';');
};

const isQuerySqlLike = (sql: string): boolean => {
  const trimmed = sql.trim().toLowerCase();
  return trimmed.startsWith('select')
    || trimmed.startsWith('show')
    || trimmed.startsWith('describe')
    || trimmed.startsWith('desc')
    || trimmed.startsWith('explain')
    || trimmed.startsWith('with');
};

export const QueryTab: React.FC<QueryTabProps> = ({
  tabId,
  initialConnection,
  initialDatabase,
}) => {
  const { t } = useTranslation();
  const { setStatusMessage: setGlobalStatusMessage } = useAppStore();
  const activeTabId = useTabStore((state) => state.activeTabId);
  const updateTab = useTabStore((state) => state.updateTab);
  const setTabModified = useTabStore((state) => state.setTabModified);
  const currentTab = useTabStore((state) => state.tabs.find((tab) => tab.id === tabId));
  const {
    connections,
    activeConnectionId,
    activeDatabase,
    setActiveConnection,
    setActiveDatabase,
    setLastUsedDatabaseForConnection,
    getLastUsedDatabaseForConnection,
    clearLastUsedDatabaseForConnection,
  } = useConnectionStore();
  const activeConnection = connections.find((c) => c.profile.name === activeConnectionId);

  // Editor ref
  const editorRef = useRef<QueryEditorRef>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastProgressUpdateAtRef = useRef(0);
  const pendingDqlTotalCountRef = useRef<Set<string>>(new Set());
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(0);

  // Split pane state (pixel based)
  const [editorHeightPx, setEditorHeightPx] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  // Connection state
  const [selectedConnection, setSelectedConnection] = useState<ConnectionProfile | undefined>(initialConnection || activeConnection?.profile);
  // 优先使用initialDatabase，如果没有则使用activeDatabase，不使用lastUsedDatabase作为初始值
  // lastUsedDatabase只在用户明确选择连接后、没有指定数据库时作为后备
  const [selectedDatabase, setSelectedDatabase] = useState<string | undefined>(
    initialDatabase !== undefined ? initialDatabase : activeDatabase || undefined
  );
  const [isConnected, setIsConnected] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState('');
  const [poolId, setPoolId] = useState<number | null>(null);
  const [connId, setConnId] = useState<number | null>(null);
  const poolIdRef = useRef<number | null>(null);
  const connIdRef = useRef<number | null>(null);

  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [hasSelection, setHasSelection] = useState(false);

  // Transaction state
  const [autoCommit, setAutoCommit] = useState(true);

  // Result tabs state
  const [resultTabs, setResultTabs] = useState<ResultTab[]>([]);
  const [metaResultTabs, setMetaResultTabs] = useState<ResultTab[]>([]);
  const [activeResultTabId, setActiveResultTabId] = useState<string | null>(null);
  const [executionWallTimeSec, setExecutionWallTimeSec] = useState<number | null>(null);
  const [isResultPanelCollapsed, setIsResultPanelCollapsed] = useState(true); // Default collapsed

  // SQL content
  const [sqlContent, setSqlContent] = useState(currentTab?.sqlContent || '');
  const savedSqlContentRef = useRef(currentTab?.sqlContent || '');

  // Auto save
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorSettingsRef = useRef(getEditorSettings());

  const buildDefaultSqlFileName = useCallback(() => {
    const baseTitle = (currentTab?.title || 'query')
      .replace(/^\*/, '')
      .replace(/\s+/g, '_')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim();

    const normalized = baseTitle || 'query';
    return normalized.toLowerCase().endsWith('.sql') ? normalized : `${normalized}.sql`;
  }, [currentTab?.title]);

  // Ref to track latest content for auto save to avoid stale closure issues
  const latestSqlContentRef = useRef(sqlContent);
  useEffect(() => {
    latestSqlContentRef.current = sqlContent;
  }, [sqlContent]);

  const saveSqlFile = useCallback(async (forcedFilePath?: string, isAutoSave = false): Promise<boolean> => {
    try {
      let filePath = forcedFilePath || currentTab?.sqlFilePath;

      if (!filePath) {
        const selectedPath = await save({
          filters: [{ name: 'SQL', extensions: ['sql'] }],
          defaultPath: buildDefaultSqlFileName(),
        });
        if (!selectedPath) {
          setStatusMessage(t('resultPanel.exportCancelled'));
          setGlobalStatusMessage(t('resultPanel.exportCancelled'));
          return false;
        }
        filePath = selectedPath;
      }

      // Use latest content from ref for auto save to ensure we save the most recent content
      const contentToSave = isAutoSave ? latestSqlContentRef.current : sqlContent;
      await writeTextFile(filePath, contentToSave);

      const fileName = filePath.split(/[/\\]/).pop() || 'query.sql';
      savedSqlContentRef.current = contentToSave;
      
      // For auto save, don't update sqlContent in tab to avoid editor re-render/flicker
      // The editor already has the correct content
      if (isAutoSave) {
        updateTab(tabId, {
          title: fileName,
          sqlFilePath: filePath,
          // Don't include sqlContent here to prevent re-render
        });
      } else {
        updateTab(tabId, {
          title: fileName,
          sqlFilePath: filePath,
          sqlContent: contentToSave,
        });
      }
      setTabModified(tabId, false);

      const message = isAutoSave ? t('status.autoSaved') : t('status.saved');
      setStatusMessage(message);
      setGlobalStatusMessage(message);
      return true;
    } catch (error) {
      const message = t('error.saveFailed', { message: error });
      setStatusMessage(message);
      setGlobalStatusMessage(message);
      return false;
    }
  }, [
    buildDefaultSqlFileName,
    currentTab?.sqlFilePath,
    setGlobalStatusMessage,
    sqlContent,
    tabId,
    updateTab,
    setTabModified,
  ]);

  const handleSqlContentChange = useCallback((nextValue: string) => {
    setSqlContent(nextValue);
    updateTab(tabId, { sqlContent: nextValue });
    const modified = nextValue !== savedSqlContentRef.current;
    setTabModified(tabId, modified);

    // Auto save logic: only for external files with sqlFilePath
    if (modified && currentTab?.sqlFilePath && editorSettingsRef.current.editorAutoSave) {
      // Clear existing timer
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      // Set new timer for auto save (2000ms debounce - longer delay to reduce flicker and ensure content is stable)
      autoSaveTimerRef.current = setTimeout(() => {
        void saveSqlFile(undefined, true);
      }, 2000);
    }
  }, [tabId, updateTab, setTabModified, currentTab?.sqlFilePath, saveSqlFile]);

  const stripLeadingSqlComments = useCallback((sqlText: string): string => {
    let remaining = sqlText;

    while (remaining.length > 0) {
      remaining = remaining.replace(/^\s+/, '');

      if (remaining.startsWith('--')) {
        const lineEnd = remaining.indexOf('\n');
        remaining = lineEnd >= 0 ? remaining.slice(lineEnd + 1) : '';
        continue;
      }

      if (remaining.startsWith('#')) {
        const lineEnd = remaining.indexOf('\n');
        remaining = lineEnd >= 0 ? remaining.slice(lineEnd + 1) : '';
        continue;
      }

      if (remaining.startsWith('/*')) {
        const end = remaining.indexOf('*/');
        remaining = end >= 0 ? remaining.slice(end + 2) : '';
        continue;
      }

      break;
    }

    return remaining;
  }, []);

  const extractUseDatabaseFromStatement = useCallback((statement: string): string | undefined => {
    const trimmed = stripLeadingSqlComments(statement).trim().replace(/;+$/, '');
    const match = trimmed.match(/^use\s+(.+)$/i);
    if (!match) return undefined;

    const rawName = match[1].trim();
    if (!rawName) return undefined;

    if (rawName.startsWith('`') && rawName.endsWith('`')) {
      return rawName.slice(1, -1).replace(/``/g, '`').trim() || undefined;
    }

    return rawName.replace(/^['"]|['"]$/g, '').trim() || undefined;
  }, [stripLeadingSqlComments]);

  const handleResizerMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const containerHeight = contentRef.current?.clientHeight || 0;
    dragStartYRef.current = event.clientY;
    dragStartHeightRef.current = editorHeightPx ?? Math.floor(containerHeight * 0.68);
    setIsResizing(true);
  }, [editorHeightPx]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (event: MouseEvent) => {
      const containerHeight = contentRef.current?.clientHeight || 0;
      if (containerHeight <= 0) return;

      const delta = event.clientY - dragStartYRef.current;
      const nextHeight = dragStartHeightRef.current + delta;
      setEditorHeightPx(clampEditorHeight(containerHeight, nextHeight));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const syncHeight = () => {
      const containerHeight = container.clientHeight;
      if (containerHeight <= 0) return;

      setEditorHeightPx((previous) => {
        if (previous == null) {
          return clampEditorHeight(containerHeight, Math.floor(containerHeight * 0.68));
        }
        return clampEditorHeight(containerHeight, previous);
      });
    };

    syncHeight();

    const observer = new ResizeObserver(syncHeight);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  // Connect to database
  const connect = useCallback(async (profile: ConnectionProfile, database?: string) => {
    if (!profile) return;

    const targetDatabase = database || getLastUsedDatabaseForConnection(profile.name);

    const openWithTarget = async (target?: string) => {
      const newPoolId = await invoke<number>('pool_create', { profile });
      try {
        const newConnId = await invoke<number>('pool_get_connection', {
          poolId: newPoolId,
          initialDatabase: target,
        });

        if (target) {
          await invoke('pool_execute', {
            poolId: newPoolId,
            connId: newConnId,
            sql: `USE \`${target.replace(/`/g, '``')}\``,
          });
          await invoke('pool_set_database', {
            poolId: newPoolId,
            connId: newConnId,
            database: target,
          });
        }

        return { newPoolId, newConnId };
      } catch (error) {
        await invoke('pool_close', { poolId: newPoolId }).catch(() => undefined);
        throw error;
      }
    };

    try {
      // Close existing connection
      if (poolIdRef.current && connIdRef.current) {
        await invoke('pool_release_connection', { poolId: poolIdRef.current, connId: connIdRef.current });
        await invoke('pool_close', { poolId: poolIdRef.current });
      }

      setStatusMessage(t('queryToolbar.connecting'));

      let opened;
      let resolvedDatabase = targetDatabase;

      // Clear stale remembered database and retry once without database binding.
      if (targetDatabase) {
        try {
          opened = await openWithTarget(targetDatabase);
        } catch (error) {
          const message = String(error).toLowerCase();
          const isUnknownDatabase = message.includes('unknown database') || message.includes('error 1049');
          if (!isUnknownDatabase) {
            throw error;
          }

          if (profile.name) {
            clearLastUsedDatabaseForConnection(profile.name);
          }
          resolvedDatabase = undefined;
          opened = await openWithTarget(undefined);
        }
      } else {
        opened = await openWithTarget(undefined);
      }

      const { newPoolId, newConnId } = opened;

      setPoolId(newPoolId);
      setConnId(newConnId);
      poolIdRef.current = newPoolId;
      connIdRef.current = newConnId;
      setActiveConnection(profile.name || null);
      if (resolvedDatabase) {
        setSelectedDatabase(resolvedDatabase);
        setActiveDatabase(resolvedDatabase);
        if (profile.name) {
          setLastUsedDatabaseForConnection(profile.name, resolvedDatabase);
        }
      } else {
        setSelectedDatabase(undefined);
        setActiveDatabase(null);
      }
      setIsConnected(true);
      setConnectionInfo(`${profile.host}:${profile.port}`);
      setStatusMessage(t('connection.connected'));
    } catch (error) {
      setIsConnected(false);
      setConnectionInfo('');
      setStatusMessage(t('error.connectionFailed', { message: error }));
    }
  }, [
    clearLastUsedDatabaseForConnection,
    getLastUsedDatabaseForConnection,
    setActiveConnection,
    setActiveDatabase,
    setLastUsedDatabaseForConnection,
    t,
  ]);

  // Disconnect
  const disconnect = useCallback(async () => {
    if (poolIdRef.current && connIdRef.current) {
      try {
        await invoke('pool_release_connection', { poolId: poolIdRef.current, connId: connIdRef.current });
        await invoke('pool_close', { poolId: poolIdRef.current });
      } catch (error) {
        console.error('Disconnect error:', error);
      }
    }
    poolIdRef.current = null;
    connIdRef.current = null;
    setPoolId(null);
    setConnId(null);
    setIsConnected(false);
    setConnectionInfo('');
    setStatusMessage('');
  }, []);

  useEffect(() => {
    if (!selectedConnection?.name) return;
    const stillExists = connections.some((conn) => conn.profile.name === selectedConnection.name);
    if (stillExists) return;

    setSelectedConnection(undefined);
    setSelectedDatabase(undefined);
    setActiveConnection(null);
    setActiveDatabase(null);
    void disconnect();
  }, [
    connections,
    disconnect,
    selectedConnection,
    setActiveConnection,
    setActiveDatabase,
  ]);

  useEffect(() => {
    poolIdRef.current = poolId;
  }, [poolId]);

  useEffect(() => {
    connIdRef.current = connId;
  }, [connId]);

  // Switch database
  const switchDatabase = useCallback(async (database: string) => {
    if (!poolId || !connId || !isConnected) return;

    try {
      await invoke('pool_execute', {
        poolId,
        connId,
        sql: `USE \`${database.replace(/`/g, '``')}\``,
      });
      // NEW: 通知后端更新数据库状态
      await invoke('pool_set_database', {
        poolId,
        connId,
        database,
      });
      setSelectedDatabase(database);
      setActiveDatabase(database);
      if (selectedConnection?.name) {
        setLastUsedDatabaseForConnection(selectedConnection.name, database);
      }
      setStatusMessage(t('status.connected', { database }));
    } catch (error) {
      setStatusMessage(t('error.queryFailed', { message: error }));
    }
  }, [
    poolId,
    connId,
    isConnected,
    selectedConnection,
    setActiveDatabase,
    setLastUsedDatabaseForConnection,
  ]);

  const isServerPageableSql = useCallback((sql: string): boolean => {
    const trimmed = stripLeadingSqlComments(sql).trim().toLowerCase();
    return trimmed.startsWith('select') || trimmed.startsWith('with');
  }, [stripLeadingSqlComments]);

  const isStoredProcedureCallLike = useCallback((sql: string): boolean => {
    const trimmed = sql.trim().toLowerCase();
    return trimmed.startsWith('call');
  }, []);

  const fetchQueryPage = useCallback(async (
    sql: string,
    page: number,
    pageSize: number,
    includeTotal = false,
  ): Promise<QueryResultData> => {
    if (!poolId || !connId) {
      throw new Error(t('error.noActiveConnection'));
    }

    const result = await invoke<QueryPageResultData>('pool_query_page', {
      poolId,
      connId,
      sql,
      page,
      pageSize,
      includeTotal,
    });

    return {
      columns: result.columns,
      rows: result.rows,
      query_time_secs: result.query_time_secs,
      fetch_time_secs: result.fetch_time_secs,
      source_sql: sql,
      pagination: {
        page: result.page,
        page_size: result.page_size,
        has_more: result.has_more,
        total_rows: result.total_rows,
        total_pages: result.total_pages,
      },
    };
  }, [poolId, connId, t]);

  const hydrateQueryTotalForTab = useCallback((
    tabId: string,
    sql: string,
    page: number,
    pageSize: number,
  ) => {
    if (!poolId || !connId) {
      return;
    }
    if (pendingDqlTotalCountRef.current.has(tabId)) {
      return;
    }

    pendingDqlTotalCountRef.current.add(tabId);

    void invoke<QueryPageResultData>('pool_query_page', {
      poolId,
      connId,
      sql,
      page,
      pageSize,
      includeTotal: true,
    })
      .then((countedResult) => {
        React.startTransition(() => {
          const patchTabData = (tab: ResultTab): ResultTab => {
            if (tab.id !== tabId || tab.type !== 'query') {
              return tab;
            }

            const data = tab.data as QueryResultData;
            const pagination = data.pagination;
            if (!pagination) {
              return tab;
            }

            return {
              ...tab,
              data: {
                ...data,
                pagination: {
                  ...pagination,
                  total_rows: countedResult.total_rows ?? pagination.total_rows,
                  total_pages: countedResult.total_pages ?? pagination.total_pages,
                },
              },
            };
          };

          setResultTabs((prev) => prev.map(patchTabData));
          setMetaResultTabs((prev) => prev.map(patchTabData));
        });
      })
      .catch(() => undefined)
      .finally(() => {
        pendingDqlTotalCountRef.current.delete(tabId);
      });
  }, [poolId, connId]);

  // Execute SQL
  const executeSql = useCallback(async () => {
    if (!isConnected || !poolId || !connId) {
      setStatusMessage(t('error.noActiveConnection'));
      return;
    }

    const editor = editorRef.current;
    if (!editor) return;

    // Get selected text or all text
    const model = editor.getModel();
    const selection = editor.getSelection();
    let sql = '';
    
    // Try to get selected text
    if (selection && !selection.isEmpty()) {
      const range = {
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn,
      };
      sql = model?.getValueInRange(range) || '';
    } else {
      sql = editor.getValue();
    }

    if (!sql.trim()) {
      setStatusMessage(t('query.noQuery'));
      return;
    }

    setIsExecuting(true);
    setStatusMessage(t('status.executing'));
    setExecutionWallTimeSec(null);

    let splitSessionId: number | null = null;
    let unlistenProgress: (() => void) | null = null;
    const executionRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let useScriptTransaction = false;
    let transactionStarted = false;
    let autoCommitRestored = false;
    let encounteredExecutionError = false;

    try {
      unlistenProgress = await listen<ScriptExecuteProgressEventData>('sql-script-progress', (event) => {
        const payload = event.payload;
        if (payload.run_id !== executionRunId) {
          return;
        }

        const now = performance.now();
        if (now - lastProgressUpdateAtRef.current < 80 && payload.processed < payload.total) {
          return;
        }
        lastProgressUpdateAtRef.current = now;

        setStatusMessage(
          `${t('status.executing')} ${payload.processed}/${payload.total} (OK ${payload.success}, ERR ${payload.error})`
        );
      });

      const normalizedSelectedSql = sql.trim().replace(/;\s*$/, '');
      const strippedSelectedSql = stripLeadingSqlComments(normalizedSelectedSql).trim();
      const canUseSingleQueryFastPath = isLikelySingleStatementSql(normalizedSelectedSql)
        && isQuerySqlLike(strippedSelectedSql)
        && !isStoredProcedureCallLike(strippedSelectedSql);

      if (canUseSingleQueryFastPath) {
        const wallStart = performance.now();
        const startedAtIso = new Date().toISOString();

        setResultTabs([]);
        setMetaResultTabs([]);
        setActiveResultTabId(null);
        setIsResultPanelCollapsed(false);

        let queryData: QueryResultData;
        if (isServerPageableSql(strippedSelectedSql)) {
          queryData = await fetchQueryPage(strippedSelectedSql, 1, 200, false);
        } else {
          const result = await invoke<QueryResultData>('pool_query', {
            poolId,
            connId,
            sql: strippedSelectedSql,
          });
          queryData = {
            ...result,
            source_sql: strippedSelectedSql,
          };
        }

        const queryTab: ResultTab = {
          id: `result_${Date.now()}_0`,
          type: 'query',
          title: t('resultPanel.queryResult', { count: queryData.rows.length }),
          data: queryData,
          sql: strippedSelectedSql,
          executionTimeSec: queryData.query_time_secs,
          fetchTimeSec: queryData.fetch_time_secs,
          statementOrder: 1,
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          statusText: 'OK',
        };

        React.startTransition(() => {
          setResultTabs([queryTab]);
          setMetaResultTabs([queryTab]);
          setActiveResultTabId(queryTab.id);
        });

        if (queryData.pagination && (queryData.pagination.total_rows == null || queryData.pagination.total_pages == null)) {
          void hydrateQueryTotalForTab(
            queryTab.id,
            strippedSelectedSql,
            queryData.pagination.page,
            queryData.pagination.page_size,
          );
        }

        const wallDurationSec = (performance.now() - wallStart) / 1000;
        setExecutionWallTimeSec(Number(wallDurationSec.toFixed(3)));
        setStatusMessage(t('resultPanel.execComplete', {
          success: 1,
          error: 0,
          time: wallDurationSec.toFixed(3),
        }));

        return;
      }

      // Create a backend split session so statements can be consumed page by page.
      const splitSession = await invoke<StatementSplitSessionData>('sql_split_statements_create', {
        sql,
        dbType: 'MYSQL',
      });
      splitSessionId = splitSession.session_id;

      if (splitSession.total <= 0) {
        setStatusMessage(t('query.noQuery'));
        return;
      }

      // For multi-statement scripts, temporarily switch to manual commit mode for faster batched execution.
      useScriptTransaction = autoCommit && splitSession.total > 1;
      if (useScriptTransaction) {
        await invoke('pool_execute', {
          poolId,
          connId,
          sql: 'SET autocommit=0',
        });
        await invoke('pool_execute', {
          poolId,
          connId,
          sql: 'START TRANSACTION',
        });
        transactionStarted = true;
      }

      // Clear previous results and expand result panel
      setResultTabs([]);
      setMetaResultTabs([]);
      setActiveResultTabId(null);
      setIsResultPanelCollapsed(false); // Auto expand when executing SQL

      const wallStart = performance.now();
      let successCount = 0;
      let errorCount = 0;
      let statementOrder = 0;
      const pendingResultTabs: ResultTab[] = [];
      const pendingMetaTabs: ResultTab[] = [];
      let hasActivatedResultTab = false;
      let flushedResultTabCount = 0;
      let lastDetectedUseDatabase: string | undefined;

      const canAppendResultTab = (tab: ResultTab): boolean => {
        if (tab.type !== 'update') {
          return true;
        }
        const totalVisible = flushedResultTabCount + pendingResultTabs.length;
        if (totalVisible < MAX_VISIBLE_RESULT_TABS) {
          return true;
        }
        return false;
      };

      const flushResultTabs = (force = false) => {
        if (!force && pendingResultTabs.length < RESULT_TAB_FLUSH_BATCH_SIZE) {
          return;
        }
        if (pendingResultTabs.length === 0) {
          return;
        }

        const batch = pendingResultTabs.splice(0, pendingResultTabs.length);
        flushedResultTabCount += batch.length;
        if (!hasActivatedResultTab && batch.length > 0) {
          setActiveResultTabId(batch[0].id);
          hasActivatedResultTab = true;
        }

        React.startTransition(() => {
          setResultTabs((prev) => [...prev, ...batch]);
        });
      };

      const flushMetaTabs = (force = false) => {
        if (!force && pendingMetaTabs.length < RESULT_TAB_FLUSH_BATCH_SIZE) {
          return;
        }
        if (pendingMetaTabs.length === 0) {
          return;
        }

        const batch = pendingMetaTabs.splice(0, pendingMetaTabs.length);
        React.startTransition(() => {
          setMetaResultTabs((prev) => [...prev, ...batch]);
        });
      };

      let statementPage = 1;
      let hasMoreStatements = true;

      while (hasMoreStatements) {
        const executedPage = await invoke<ScriptExecutePageResultData>('pool_execute_statement_page', {
          poolId,
          connId,
          sessionId: splitSessionId,
          page: statementPage,
          pageSize: DEFAULT_SQL_STATEMENT_PAGE_SIZE,
          runId: executionRunId,
          successOffset: successCount,
          errorOffset: errorCount,
          stopOnError: true,
        });

        hasMoreStatements = executedPage.has_more;
        statementPage += 1;

        for (const entry of executedPage.entries) {
          const statement = entry.sql.trim();
          if (!statement) continue;

          const statementWithoutLeadingComments = stripLeadingSqlComments(statement).trim();
          if (!statementWithoutLeadingComments) continue;

          const statementIndex = entry.statement_index;

          statementOrder += 1;
          const startedAtIso = new Date().toISOString();

          if (entry.result_type === 'error') {
            errorCount++;
            encounteredExecutionError = true;
            const errorTab: ResultTab = {
              id: `result_${Date.now()}_${statementIndex}`,
              type: 'error',
              title: t('resultPanel.errorResult'),
              data: entry.error || t('resultPanel.execFailed'),
              sql: statement,
              executionTimeSec: 0,
              fetchTimeSec: 0,
              statementOrder,
              startedAt: startedAtIso,
              finishedAt: new Date().toISOString(),
              statusText: entry.error || t('resultPanel.execFailed'),
            };
            pendingMetaTabs.push(errorTab);
            pendingResultTabs.push(errorTab);
          } else if (entry.result_type === 'multi_query') {
            const result = entry.multi_query_result;
            if (!result) {
              errorCount++;
            } else {
              if (result.result_sets.length === 0) {
                const updateTab: ResultTab = {
                  id: `result_${Date.now()}_${statementIndex}`,
                  type: 'update',
                  title: t('resultPanel.updateResult'),
                  data: { affected_rows: result.affected_rows, last_insert_id: result.last_insert_id },
                  sql: statement,
                  executionTimeSec: result.query_time_secs,
                  fetchTimeSec: result.fetch_time_secs,
                  statementOrder,
                  startedAt: startedAtIso,
                  finishedAt: new Date().toISOString(),
                  statusText: 'OK',
                };
                pendingMetaTabs.push(updateTab);
                if (canAppendResultTab(updateTab)) {
                  pendingResultTabs.push(updateTab);
                }
              } else if (result.result_sets.length === 1) {
                const queryTab: ResultTab = {
                  id: `result_${Date.now()}_${statementIndex}`,
                  type: 'query',
                  title: t('resultPanel.queryResult', { count: result.result_sets[0].rows.length }),
                  data: result.result_sets[0],
                  sql: statement,
                  executionTimeSec: result.query_time_secs,
                  fetchTimeSec: result.fetch_time_secs,
                  statementOrder,
                  startedAt: startedAtIso,
                  finishedAt: new Date().toISOString(),
                  statusText: 'OK',
                };
                pendingMetaTabs.push(queryTab);
                pendingResultTabs.push(queryTab);
              } else {
                result.result_sets.forEach((resultSet, setIndex) => {
                  const queryTab: ResultTab = {
                    id: `result_${Date.now()}_${statementIndex}_${setIndex}`,
                    type: 'query',
                    title: t('resultPanel.queryResultSet', { index: setIndex + 1, count: resultSet.rows.length }),
                    data: resultSet,
                    sql: statement,
                    executionTimeSec: setIndex === 0 ? result.query_time_secs : 0,
                    fetchTimeSec: setIndex === 0 ? result.fetch_time_secs : 0,
                    statementOrder,
                    startedAt: startedAtIso,
                    finishedAt: new Date().toISOString(),
                    statusText: 'OK',
                  };
                  pendingMetaTabs.push(queryTab);
                  pendingResultTabs.push(queryTab);
                });
              }
              successCount++;
            }
          } else if (entry.result_type === 'query_page') {
            const result = entry.query_page_result;
            if (!result) {
              errorCount++;
            } else {
              const mappedQueryData: QueryResultData = {
                columns: result.columns,
                rows: result.rows,
                query_time_secs: result.query_time_secs,
                fetch_time_secs: result.fetch_time_secs,
                source_sql: statement,
                pagination: {
                  page: result.page,
                  page_size: result.page_size,
                  has_more: result.has_more,
                  total_rows: result.total_rows,
                  total_pages: result.total_pages,
                },
              };

              const queryTab: ResultTab = {
                id: `result_${Date.now()}_${statementIndex}`,
                type: 'query',
                title: t('resultPanel.queryResult', { count: mappedQueryData.rows.length }),
                data: mappedQueryData,
                sql: statement,
                executionTimeSec: mappedQueryData.query_time_secs,
                fetchTimeSec: mappedQueryData.fetch_time_secs,
                statementOrder,
                startedAt: startedAtIso,
                finishedAt: new Date().toISOString(),
                statusText: 'OK',
              };
              pendingMetaTabs.push(queryTab);
              pendingResultTabs.push(queryTab);
              successCount++;
            }
          } else if (entry.result_type === 'query') {
            const result = entry.query_result;
            if (!result) {
              errorCount++;
            } else {
              const queryTab: ResultTab = {
                id: `result_${Date.now()}_${statementIndex}`,
                type: 'query',
                title: t('resultPanel.queryResult', { count: result.rows.length }),
                data: result,
                sql: statement,
                executionTimeSec: result.query_time_secs,
                fetchTimeSec: result.fetch_time_secs,
                statementOrder,
                startedAt: startedAtIso,
                finishedAt: new Date().toISOString(),
                statusText: 'OK',
              };
              pendingMetaTabs.push(queryTab);
              pendingResultTabs.push(queryTab);
              successCount++;
            }
          } else if (entry.result_type === 'update') {
            const result = entry.exec_result;
            if (!result) {
              errorCount++;
            } else {
              const updateTab: ResultTab = {
                id: `result_${Date.now()}_${statementIndex}`,
                type: 'update',
                title: t('resultPanel.updateResult'),
                data: result,
                sql: statement,
                executionTimeSec: result.query_time_secs,
                fetchTimeSec: 0,
                statementOrder,
                startedAt: startedAtIso,
                finishedAt: new Date().toISOString(),
                statusText: 'OK',
              };
              pendingMetaTabs.push(updateTab);
              if (canAppendResultTab(updateTab)) {
                pendingResultTabs.push(updateTab);
              }
              successCount++;
            }
          }

          const useDatabase = extractUseDatabaseFromStatement(statement);
          if (useDatabase) {
            lastDetectedUseDatabase = useDatabase;
          }

          flushResultTabs();
          flushMetaTabs();

          if (encounteredExecutionError) {
            break;
          }
        }

        if (encounteredExecutionError) {
          break;
        }
      }

      flushResultTabs(true);
      flushMetaTabs(true);

      if (transactionStarted) {
        if (encounteredExecutionError) {
          await invoke('pool_execute', {
            poolId,
            connId,
            sql: 'ROLLBACK',
          });
        } else {
          await invoke('pool_execute', {
            poolId,
            connId,
            sql: 'COMMIT',
          });
        }

        await invoke('pool_execute', {
          poolId,
          connId,
          sql: 'SET autocommit=1',
        });
        autoCommitRestored = true;
      }

      if (lastDetectedUseDatabase) {
        setSelectedDatabase(lastDetectedUseDatabase);
        setActiveDatabase(lastDetectedUseDatabase);
        if (selectedConnection?.name) {
          setLastUsedDatabaseForConnection(selectedConnection.name, lastDetectedUseDatabase);
        }
      }

      const wallDurationSec = ((performance.now() - wallStart) / 1000).toFixed(3);
      setExecutionWallTimeSec(Number(wallDurationSec));
      const completionText = t('resultPanel.execComplete', {
        success: successCount,
        error: errorCount,
        time: wallDurationSec,
      });
      if (encounteredExecutionError && transactionStarted) {
        setStatusMessage(`${completionText} | ${t('queryToolbar.rollbackSuccess')}`);
      } else {
        setStatusMessage(completionText);
      }
    } catch (error) {
      if (transactionStarted) {
        await invoke('pool_execute', {
          poolId,
          connId,
          sql: 'ROLLBACK',
        }).catch(() => undefined);

        if (!autoCommitRestored) {
          await invoke('pool_execute', {
            poolId,
            connId,
            sql: 'SET autocommit=1',
          }).catch(() => undefined);
          autoCommitRestored = true;
        }
      }
      setStatusMessage(t('query.executionFailed'));
    } finally {
      if (transactionStarted && !autoCommitRestored) {
        void invoke('pool_execute', {
          poolId,
          connId,
          sql: 'SET autocommit=1',
        }).catch(() => undefined);
      }
      if (unlistenProgress) {
        unlistenProgress();
      }
      if (splitSessionId !== null) {
        void invoke<boolean>('sql_split_statements_release', {
          sessionId: splitSessionId,
        }).catch(() => undefined);
      }
      setIsExecuting(false);
    }
  }, [
    isConnected,
    poolId,
    connId,
    stripLeadingSqlComments,
    isServerPageableSql,
    isStoredProcedureCallLike,
    fetchQueryPage,
    extractUseDatabaseFromStatement,
    autoCommit,
    selectedConnection,
    t,
    setActiveDatabase,
    setLastUsedDatabaseForConnection,
  ]);

  const requestQueryPage = useCallback(async (tabId: string, page: number, pageSize: number) => {
    if (!isConnected || !poolId || !connId) {
      setStatusMessage(t('error.noActiveConnection'));
      return;
    }

    const targetTab = resultTabs.find((tab) => tab.id === tabId && tab.type === 'query');
    if (!targetTab) return;

    const queryData = targetTab.data as QueryResultData;
    const sourceSql = queryData.source_sql || targetTab.sql;
    if (!sourceSql || !isServerPageableSql(sourceSql)) return;

    try {
      setStatusMessage(t('status.executing'));
      const nextPageData = await fetchQueryPage(sourceSql, page, pageSize, false);

      React.startTransition(() => {
        setResultTabs((prev) => prev.map((tab) => {
          if (tab.id !== tabId || tab.type !== 'query') return tab;

          return {
            ...tab,
            title: t('resultPanel.queryResult', { count: nextPageData.rows.length }),
            data: nextPageData,
            executionTimeSec: nextPageData.query_time_secs,
            fetchTimeSec: nextPageData.fetch_time_secs,
            finishedAt: new Date().toISOString(),
            statusText: 'OK',
          };
        }));
        setMetaResultTabs((prev) => prev.map((tab) => {
          if (tab.id !== tabId || tab.type !== 'query') return tab;

          return {
            ...tab,
            title: t('resultPanel.queryResult', { count: nextPageData.rows.length }),
            data: nextPageData,
            executionTimeSec: nextPageData.query_time_secs,
            fetchTimeSec: nextPageData.fetch_time_secs,
            finishedAt: new Date().toISOString(),
            statusText: 'OK',
          };
        }));
      });

      if (nextPageData.pagination && (nextPageData.pagination.total_rows == null || nextPageData.pagination.total_pages == null)) {
        void hydrateQueryTotalForTab(
          tabId,
          sourceSql,
          nextPageData.pagination.page,
          nextPageData.pagination.page_size,
        );
      }

      setStatusMessage(t('resultPanel.execSuccess'));
    } catch (error) {
      setStatusMessage(t('error.queryFailed', { message: String(error) }));
    }
  }, [
    isConnected,
    poolId,
    connId,
    resultTabs,
    isServerPageableSql,
    fetchQueryPage,
    hydrateQueryTotalForTab,
    t,
  ]);

  // Execute explain
  const explainSql = useCallback(async () => {
    if (!isConnected || !poolId || !connId) {
      setStatusMessage(t('error.noActiveConnection'));
      return;
    }

    const editor = editorRef.current;
    if (!editor) return;

    const sql = editor.getValue().trim();

    if (!sql) {
      setStatusMessage(t('query.noQuery'));
      return;
    }

    setIsExecuting(true);
    try {
      const explainSqlText = `EXPLAIN ${sql}`;
      const result = await invoke<QueryResultData>('pool_query', {
        poolId,
        connId,
        sql: explainSqlText,
      });

      const resultTab: ResultTab = {
        id: `result_${Date.now()}_explain`,
        type: 'query',
        title: t('resultPanel.explainResult'),
        data: result,
        sql: explainSqlText,
      };

      setResultTabs(prev => [...prev, resultTab]);
      setMetaResultTabs(prev => [...prev, resultTab]);
      setActiveResultTabId(resultTab.id);
      setStatusMessage(t('resultPanel.explainSuccess'));
    } catch (error) {
      setStatusMessage(t('resultPanel.explainFailed'));
    } finally {
      setIsExecuting(false);
    }
  }, [isConnected, poolId, connId, t]);

  // Format SQL
  const formatSql = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;

    const sql = editor.getValue();

    if (!sql.trim()) return;

    try {
      const formatted = await invoke<string>('sql_format', {
        sql,
        dbType: 'MYSQL',
      });
      const model = editor.getModel();
      if (model) {
        model.setValue(formatted);
      }
      setStatusMessage(t('queryToolbar.formatSuccess'));
    } catch (error) {
      setStatusMessage(t('queryToolbar.formatFailed'));
    }
  }, [t]);

  // Clear SQL
  const clearSql = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const model = editor.getModel();
    if (model) {
      model.setValue('');
    }
    setStatusMessage('');
  }, []);

  // Insert snippet
  const insertSnippet = useCallback((snippet: string) => {
    const editor = editorRef.current;
    if (!editor) return;

    const position = editor.getPosition();
    if (position) {
      editor.executeEdits('snippet', [{
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        },
        text: snippet,
      }]);
      editor.setPosition({
        lineNumber: position.lineNumber,
        column: position.column + snippet.length,
      });
      editor.focus();
    }
  }, []);

  // Handle transaction mode change
  const handleTransactionModeChange = useCallback(async (mode: 'auto' | 'manual') => {
    if (!isConnected || !poolId || !connId) return;

    const isAuto = mode === 'auto';
    try {
      await invoke('pool_execute', {
        poolId,
        connId,
        sql: `SET autocommit=${isAuto ? '1' : '0'}`,
      });
      setAutoCommit(isAuto);
      setStatusMessage(isAuto ? t('queryToolbar.autoCommit') : t('queryToolbar.manualCommit'));
    } catch (error) {
      setStatusMessage(t('queryToolbar.txModeFailed'));
    }
  }, [isConnected, poolId, connId, t]);

  // Commit transaction
  const commitTransaction = useCallback(async () => {
    if (!isConnected || !poolId || !connId) return;

    try {
      await invoke('pool_execute', {
        poolId,
        connId,
        sql: 'COMMIT',
      });
      setStatusMessage(t('queryToolbar.commitSuccess'));
    } catch (error) {
      setStatusMessage(t('queryToolbar.commitFailed'));
    }
  }, [isConnected, poolId, connId, t]);

  // Rollback transaction
  const rollbackTransaction = useCallback(async () => {
    if (!isConnected || !poolId || !connId) return;

    try {
      await invoke('pool_execute', {
        poolId,
        connId,
        sql: 'ROLLBACK',
      });
      setStatusMessage(t('queryToolbar.rollbackSuccess'));
    } catch (error) {
      setStatusMessage(t('queryToolbar.rollbackFailed'));
    }
  }, [isConnected, poolId, connId, t]);

  // Clear results
  const clearResults = useCallback(() => {
    setResultTabs([]);
    setMetaResultTabs([]);
    setActiveResultTabId(null);
    setExecutionWallTimeSec(null);
  }, []);

  // Close result tab
  const closeResultTab = useCallback((id: string) => {
    setResultTabs(prev => {
      const newTabs = prev.filter(t => t.id !== id);
      if (activeResultTabId === id) {
        setActiveResultTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null);
      }
      return newTabs;
    });
  }, [activeResultTabId]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      const currentPoolId = poolIdRef.current;
      const currentConnId = connIdRef.current;
      if (currentPoolId && currentConnId) {
        void invoke('pool_release_connection', { poolId: currentPoolId, connId: currentConnId }).catch(() => undefined);
        void invoke('pool_close', { poolId: currentPoolId }).catch(() => undefined);
      }
    };
  }, []);

  // Initial connection
  useEffect(() => {
    if (initialConnection && !isConnected) {
      connect(initialConnection, initialDatabase);
    }
  }, [initialConnection, initialDatabase, connect, isConnected]);

  useEffect(() => {
    if (!selectedConnection && activeConnection?.profile) {
      setSelectedConnection(activeConnection.profile);
    }
  }, [activeConnection, selectedConnection]);

  useEffect(() => {
    if (currentTab?.sqlContent === undefined) return;
    if (currentTab.sqlContent === sqlContent) return;
    setSqlContent(currentTab.sqlContent);
  }, [currentTab?.sqlContent, sqlContent]);

  useEffect(() => {
    const handleSaveCurrentTab = () => {
      if (activeTabId !== tabId) return;
      void saveSqlFile();
    };

    const handleSaveAs = (event: Event) => {
      if (activeTabId !== tabId) return;
      const customEvent = event as CustomEvent<{ filePath?: string }>;
      void saveSqlFile(customEvent.detail?.filePath);
    };

    window.addEventListener('dbw:save-current-tab', handleSaveCurrentTab);
    window.addEventListener('dbw:save-as', handleSaveAs);

    return () => {
      window.removeEventListener('dbw:save-current-tab', handleSaveCurrentTab);
      window.removeEventListener('dbw:save-as', handleSaveAs);
    };
  }, [activeTabId, saveSqlFile, tabId]);

  useEffect(() => {
    if (!selectedConnection?.name || selectedDatabase) return;
    const persistedDb = getLastUsedDatabaseForConnection(selectedConnection.name);
    if (persistedDb) {
      setSelectedDatabase(persistedDb);
      setActiveDatabase(persistedDb);
    }
  }, [selectedConnection, selectedDatabase, getLastUsedDatabaseForConnection, setActiveDatabase]);

  useEffect(() => {
    if (selectedConnection && selectedDatabase) {
      setSQLCompletionContext({
        profile: selectedConnection,
        database: selectedDatabase,
      });
      return;
    }

    setSQLCompletionContext(null);
    clearSQLCompletionMetadataCache();
  }, [selectedConnection, selectedDatabase]);

  // Listen for execute SQL keyboard shortcut
  useEffect(() => {
    const handleExecuteSql = () => {
      if (activeTabId !== tabId) return;
      void executeSql();
    };

    window.addEventListener('dbw:execute-sql', handleExecuteSql);
    return () => {
      window.removeEventListener('dbw:execute-sql', handleExecuteSql);
    };
  }, [activeTabId, executeSql, tabId]);

  // Listen for settings changes to update auto save behavior
  useEffect(() => {
    const handleSettingsChanged = () => {
      editorSettingsRef.current = getEditorSettings();
    };

    window.addEventListener('dbw:settings-changed', handleSettingsChanged as EventListener);
    return () => {
      window.removeEventListener('dbw:settings-changed', handleSettingsChanged as EventListener);
    };
  }, []);

  // Cleanup auto save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="query-tab">
      {/* Toolbar */}
      <QueryToolbar
        availableConnections={connections.map((c) => c.profile)}
        selectedConnection={selectedConnection}
        selectedDatabase={selectedDatabase}
        isConnected={isConnected}
        isExecuting={isExecuting}
        autoCommit={autoCommit}
        statusMessage={statusMessage}
        connectionInfo={connectionInfo}
        onConnectionChange={(conn) => {
          const persistedDb = conn?.name ? getLastUsedDatabaseForConnection(conn.name) : undefined;
          setSelectedConnection(conn);
          setSelectedDatabase(persistedDb);
          setActiveConnection(conn?.name || null);
          setActiveDatabase(persistedDb || null);
          if (conn) {
            connect(conn, persistedDb);
          } else {
            disconnect();
          }
        }}
        onDatabaseChange={(db) => {
          setSelectedDatabase(db);
          setActiveDatabase(db || null);
          if (db && selectedConnection?.name) {
            setLastUsedDatabaseForConnection(selectedConnection.name, db);
          }
          if (db) {
            switchDatabase(db);
          }
        }}
        onExecute={executeSql}
        executeLabel={hasSelection ? t('queryToolbar.executeSelected') : t('queryToolbar.execute')}
        onSave={() => {
          void saveSqlFile();
        }}
        onExplain={explainSql}
        onFormat={formatSql}
        onClear={clearSql}
        onInsertSnippet={insertSnippet}
        onTransactionModeChange={handleTransactionModeChange}
        onCommit={commitTransaction}
        onRollback={rollbackTransaction}
      />

      {/* Content area with split pane */}
      <div className={`query-tab-content ${isResultPanelCollapsed ? 'result-collapsed' : ''}`} ref={contentRef}>
        {/* SQL Editor (top) */}
        <div
          className="query-editor-container"
          style={{
            flex: isResultPanelCollapsed ? 1 : `0 0 ${editorHeightPx ?? MIN_EDITOR_HEIGHT}px`,
            height: isResultPanelCollapsed ? '100%' : `${editorHeightPx ?? MIN_EDITOR_HEIGHT}px`,
          }}
        >
          <QueryEditor
            ref={editorRef}
            value={sqlContent}
            onChange={handleSqlContentChange}
            onExecute={executeSql}
            onSelectionChange={setHasSelection}
          />
        </div>

        {/* Resizer with collapse button - only show when result panel is visible */}
        {!isResultPanelCollapsed && (
          <SplitPaneResizer
            isDragging={isResizing}
            onMouseDown={handleResizerMouseDown}
            onToggleCollapse={() => setIsResultPanelCollapsed(true)}
          />
        )}

        {/* Result Panel (bottom) */}
        {!isResultPanelCollapsed && (
          <div className="query-result-container">
            <ResultPanel
              tabs={resultTabs}
              metaTabs={metaResultTabs}
              executionWallTimeSec={executionWallTimeSec ?? undefined}
              activeTabId={activeResultTabId}
              onTabChange={setActiveResultTabId}
              onTabClose={closeResultTab}
              onClearAll={clearResults}
              onRequestQueryPage={requestQueryPage}
            />
          </div>
        )}
        
        {/* Collapsed state - show expand button bar */}
        {isResultPanelCollapsed && (
          <div className="result-collapsed-bar">
            <button 
              className="result-expand-btn"
              onClick={() => setIsResultPanelCollapsed(false)}
              title={t('resultPanel.expand')}
            >
              <ChevronUpIcon size={12} />
              <span>{t('resultPanel.title')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
