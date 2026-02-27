import React, { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useTranslation } from 'react-i18next';
import type { ConnectionProfile, QueryResultData, MultiQueryResultData, ExecResultData, ResultTab } from '../../types';
import { useAppStore, useConnectionStore, useTabStore } from '../../stores';
import { QueryToolbar } from './QueryToolbar';
import { QueryEditor, type QueryEditorRef } from './QueryEditor';
import { ResultPanel } from './ResultPanel';
import { getEditorSettings } from '../../utils/editorSettings';
import '../../styles/query-tab.css';

interface QueryTabProps {
  tabId: string;
  initialConnection?: ConnectionProfile;
  initialDatabase?: string;
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

const clampEditorHeight = (containerHeight: number, targetHeight: number): number => {
  if (containerHeight <= 0) return MIN_EDITOR_HEIGHT;

  const maxEditorHeight = Math.max(
    MIN_EDITOR_HEIGHT,
    containerHeight - SPLITTER_HEIGHT - MIN_RESULT_HEIGHT,
  );

  const minEditorHeight = Math.min(MIN_EDITOR_HEIGHT, maxEditorHeight);

  return Math.min(maxEditorHeight, Math.max(minEditorHeight, targetHeight));
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
  } = useConnectionStore();
  const activeConnection = connections.find((c) => c.profile.name === activeConnectionId);

  // Editor ref
  const editorRef = useRef<QueryEditorRef>(null);
  const contentRef = useRef<HTMLDivElement>(null);
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
  const [activeResultTabId, setActiveResultTabId] = useState<string | null>(null);
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

  const saveSqlFile = useCallback(async (forcedFilePath?: string): Promise<boolean> => {
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

      await writeTextFile(filePath, sqlContent);

      const fileName = filePath.split(/[/\\]/).pop() || 'query.sql';
      savedSqlContentRef.current = sqlContent;
      updateTab(tabId, {
        title: fileName,
        sqlFilePath: filePath,
        sqlContent,
      });
      setTabModified(tabId, false);

      const message = t('status.saved');
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
      // Set new timer for auto save (1000ms debounce)
      autoSaveTimerRef.current = setTimeout(() => {
        void saveSqlFile();
      }, 1000);
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

    try {
      // Close existing connection
      if (poolIdRef.current && connIdRef.current) {
        await invoke('pool_release_connection', { poolId: poolIdRef.current, connId: connIdRef.current });
        await invoke('pool_close', { poolId: poolIdRef.current });
      }

      setStatusMessage(t('queryToolbar.connecting'));

      // Create new pool and get connection
      const newPoolId = await invoke<number>('pool_create', { profile });
      // MODIFIED: 传递初始数据库到连接池
      const newConnId = await invoke<number>('pool_get_connection', {
        poolId: newPoolId,
        initialDatabase: targetDatabase,
      });

      // Switch database if specified (执行 USE 语句)
      if (targetDatabase) {
        await invoke('pool_execute', {
          poolId: newPoolId,
          connId: newConnId,
          sql: `USE \`${targetDatabase.replace(/`/g, '``')}\``,
        });
        // NEW: 通知后端更新数据库状态
        await invoke('pool_set_database', {
          poolId: newPoolId,
          connId: newConnId,
          database: targetDatabase,
        });
      }

      setPoolId(newPoolId);
      setConnId(newConnId);
      poolIdRef.current = newPoolId;
      connIdRef.current = newConnId;
      setActiveConnection(profile.name || null);
      if (targetDatabase) {
        setSelectedDatabase(targetDatabase);
        setActiveDatabase(targetDatabase);
        if (profile.name) {
          setLastUsedDatabaseForConnection(profile.name, targetDatabase);
        }
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
    getLastUsedDatabaseForConnection,
    setActiveConnection,
    setActiveDatabase,
    setLastUsedDatabaseForConnection,
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

  // Check if SQL is a query
  const isQuerySql = (sql: string): boolean => {
    const trimmed = stripLeadingSqlComments(sql).trim().toLowerCase();
    return trimmed.startsWith('select') ||
           trimmed.startsWith('show') ||
           trimmed.startsWith('describe') ||
           trimmed.startsWith('desc') ||
           trimmed.startsWith('explain') ||
           trimmed.startsWith('with');
  };

  // Check if SQL is a stored procedure call
  const isStoredProcedureCall = (sql: string): boolean => {
    const trimmed = stripLeadingSqlComments(sql).trim().toLowerCase();
    return trimmed.startsWith('call');
  };

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

    try {
      // Split SQL statements
      const statements = await invoke<string[]>('sql_split_statements', {
        sql,
        dbType: 'MYSQL',
      });

      // Clear previous results and expand result panel
      setResultTabs([]);
      setIsResultPanelCollapsed(false); // Auto expand when executing SQL

      let successCount = 0;
      let errorCount = 0;
      const startTime = Date.now();

      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i].trim();
        if (!statement) continue;

        const statementWithoutLeadingComments = stripLeadingSqlComments(statement).trim();
        if (!statementWithoutLeadingComments) continue;

        try {
          if (isStoredProcedureCall(statement)) {
            // Execute stored procedure with multiple result sets support
            const result = await invoke<MultiQueryResultData>('pool_query_multi', {
              poolId,
              connId,
              sql: statement,
            });

            // Create a result tab for each result set
            if (result.result_sets.length === 0) {
              // No result sets, show as update result
              const resultTab: ResultTab = {
                id: `result_${Date.now()}_${i}`,
                type: 'update',
                title: t('resultPanel.updateResult'),
                data: { affected_rows: result.affected_rows, last_insert_id: result.last_insert_id },
                sql: statement,
              };
              setResultTabs(prev => [...prev, resultTab]);
              setActiveResultTabId(resultTab.id);
            } else if (result.result_sets.length === 1) {
              // Single result set
              const resultTab: ResultTab = {
                id: `result_${Date.now()}_${i}`,
                type: 'query',
                title: t('resultPanel.queryResult', { count: result.result_sets[0].rows.length }),
                data: result.result_sets[0],
                sql: statement,
              };
              setResultTabs(prev => [...prev, resultTab]);
              setActiveResultTabId(resultTab.id);
            } else {
              // Multiple result sets - create a tab for each
              result.result_sets.forEach((resultSet, setIndex) => {
                const resultTab: ResultTab = {
                  id: `result_${Date.now()}_${i}_${setIndex}`,
                  type: 'query',
                  title: t('resultPanel.queryResultSet', { index: setIndex + 1, count: resultSet.rows.length }),
                  data: resultSet,
                  sql: statement,
                };
                setResultTabs(prev => [...prev, resultTab]);
                setActiveResultTabId(resultTab.id);
              });
            }
            successCount++;
          } else if (isQuerySql(statement)) {
            // Execute query
            const result = await invoke<QueryResultData>('pool_query', {
              poolId,
              connId,
              sql: statement,
            });

            const resultTab: ResultTab = {
              id: `result_${Date.now()}_${i}`,
              type: 'query',
              title: t('resultPanel.queryResult', { count: result.rows.length }),
              data: result,
              sql: statement,
            };

            setResultTabs(prev => [...prev, resultTab]);
            setActiveResultTabId(resultTab.id);
            successCount++;
          } else {
            // Execute update
            const result = await invoke<ExecResultData>('pool_execute', {
              poolId,
              connId,
              sql: statement,
            });

            const resultTab: ResultTab = {
              id: `result_${Date.now()}_${i}`,
              type: 'update',
              title: t('resultPanel.updateResult'),
              data: result,
              sql: statement,
            };

            setResultTabs(prev => [...prev, resultTab]);
            setActiveResultTabId(resultTab.id);
            successCount++;
          }

          const useDatabase = extractUseDatabaseFromStatement(statement);
          if (useDatabase) {
            setSelectedDatabase(useDatabase);
            setActiveDatabase(useDatabase);
            if (selectedConnection?.name) {
              setLastUsedDatabaseForConnection(selectedConnection.name, useDatabase);
            }
          }
        } catch (error) {
          errorCount++;
          const errorTab: ResultTab = {
            id: `result_${Date.now()}_${i}`,
            type: 'error',
            title: t('resultPanel.errorResult'),
            data: String(error),
            sql: statement,
          };
          setResultTabs(prev => [...prev, errorTab]);
          setActiveResultTabId(errorTab.id);
        }
      }

      const duration = Date.now() - startTime;
      setStatusMessage(t('resultPanel.execComplete', { success: successCount, error: errorCount, time: duration }));
    } catch (error) {
      setStatusMessage(t('query.executionFailed'));
    } finally {
      setIsExecuting(false);
    }
  }, [
    isConnected,
    poolId,
    connId,
    stripLeadingSqlComments,
    extractUseDatabaseFromStatement,
    selectedConnection,
    setActiveDatabase,
    setLastUsedDatabaseForConnection,
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
    setActiveResultTabId(null);
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
              activeTabId={activeResultTabId}
              onTabChange={setActiveResultTabId}
              onTabClose={closeResultTab}
              onClearAll={clearResults}
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
