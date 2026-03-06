import React from 'react';
import { Button } from '@blueprintjs/core';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import type { ResultTab, QueryResultData, ExecResultData } from '../../types';
import {
  ClearResultsIcon,
} from './QueryIcons';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';

interface ResultPanelProps {
  tabs: ResultTab[];
  activeTabId: string | null;
  onTabChange: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onClearAll: () => void;
}

interface SummaryDetailState {
  content: string;
  kind: 'sql' | 'info';
}

interface ResultContextMenuState {
  x: number;
  y: number;
  cellText: string;
  rowText: string;
}

interface CsvExportInfo {
  file_path: string;
  exported_at: string;
  row_count: number;
}

const formatSeconds = (seconds?: number): string => {
  if (seconds === undefined || Number.isNaN(seconds)) {
    return '0.000';
  }
  return Math.max(0, seconds).toFixed(3);
};

const formatDateTime = (iso?: string): string => {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
};

const formatCellValue = (value: unknown): string => {
  if (value === null || value === undefined) return '(Null)';
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

// Column resize handle component - matching DatabaseObjectTab style
const ColumnResizeHandle: React.FC<{
  onResize: (delta: number) => void;
}> = ({ onResize }) => {
  const [isResizing, setIsResizing] = React.useState(false);
  const startXRef = React.useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    startXRef.current = e.clientX;
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  React.useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      onResize(delta);
      startXRef.current = e.clientX;
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, onResize]);

  return (
    <div
      className={`column-resize-handle ${isResizing ? 'resizing' : ''}`}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <div className="column-resize-line" />
    </div>
  );
};

// Query Result Table Component
const QueryResultTable: React.FC<{ data: QueryResultData }> = ({ data }) => {
  const { t } = useTranslation();
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [selectedRowIndex, setSelectedRowIndex] = React.useState<number | null>(null);
  const [contextMenu, setContextMenu] = React.useState<ResultContextMenuState | null>(null);
  const [columnWidths, setColumnWidths] = React.useState<Record<string, number>>({});

  const columns: ColumnDef<unknown[], string>[] = React.useMemo(() => {
    const sourceColumns = data.columns.length > 0
      ? data.columns
      : [{ name: '__empty__', label: t('resultPanel.result'), type_name: '' }];

    const rowNumberColumn: ColumnDef<unknown[], string> = {
      id: '__rownum',
      header: '#',
      accessorFn: (_row, index) => String(index + 1),
      enableSorting: false,
      cell: (info) => String(info.row.index + 1),
    };

    const dataColumns = sourceColumns.map((col, index) => ({
      id: col.name,
      header: col.label,
      accessorFn: (row: unknown[]) => row[index],
      enableSorting: true,
      cell: (info: { getValue: () => unknown }) => {
        const value = info.getValue();
        return value === null || value === undefined ? '' : String(value);
      },
    }));

    return [rowNumberColumn, ...dataColumns];
  }, [data.columns, t]);

  const table = useReactTable({
    data: data.rows,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: {
      pagination: {
        pageSize: 100,
      },
    },
  });

  React.useEffect(() => {
    if (!contextMenu) return;

    const handleGlobalClick = () => setContextMenu(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('contextmenu', handleGlobalClick);
    window.addEventListener('scroll', handleGlobalClick, true);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('contextmenu', handleGlobalClick);
      window.removeEventListener('scroll', handleGlobalClick, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu]);

  const handleCellContextMenu = (
    event: React.MouseEvent<HTMLTableCellElement>,
    rowValues: unknown[],
    cellValue: unknown,
    rowIndex: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedRowIndex(rowIndex);

    const cellText = formatCellValue(cellValue);
    const rowText = rowValues.map((value) => formatCellValue(value)).join('\t');

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      cellText,
      rowText,
    });
  };

  const handleCopyCell = async () => {
    if (!contextMenu) return;
    await copyTextToClipboard(contextMenu.cellText);
    setContextMenu(null);
  };

  const handleCopyRow = async () => {
    if (!contextMenu) return;
    await copyTextToClipboard(contextMenu.rowText);
    setContextMenu(null);
  };

  const handleColumnResize = (columnId: string, delta: number) => {
    setColumnWidths((prev) => {
      const currentWidth = prev[columnId] || getDefaultColumnWidth(columnId);
      const newWidth = Math.max(60, currentWidth + delta);
      return { ...prev, [columnId]: newWidth };
    });
  };

  const getDefaultColumnWidth = (columnId: string): number => {
    if (columnId === '__rownum') return 44;
    const column = data.columns.find((col) => col.name === columnId);
    if (column) {
      return Math.max(120, (column.label || column.name).length * 10 + 28);
    }
    return 120;
  };

  const getColumnWidth = (columnId: string): number => {
    return columnWidths[columnId] || getDefaultColumnWidth(columnId);
  };

  return (
    <div className="result-table-container result-table-java-like">
      <div className="result-table-wrapper">
        <table className="result-table">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{
                      width: getColumnWidth(header.column.id),
                      minWidth: getColumnWidth(header.column.id),
                    }}
                    className={`${header.column.id === '__rownum' ? 'row-number-col' : ''} ${header.column.getCanSort() ? 'sortable' : ''}`.trim()}
                  >
                    <div 
                      className="result-table-header-content"
                      onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="header-text">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                      {header.column.getCanSort() && (
                        <span className="result-table-sort-indicator" aria-hidden="true">
                          {header.column.getIsSorted() === 'asc'
                            ? '▲'
                            : header.column.getIsSorted() === 'desc'
                              ? '▼'
                              : '↕'}
                        </span>
                      )}
                    </div>
                    {header.column.id !== '__rownum' && (
                      <ColumnResizeHandle
                        onResize={(delta) => handleColumnResize(header.column.id, delta)}
                      />
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={table.getAllColumns().length} className="result-table-empty-row">
                  {t('resultPanel.noData')}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={`result-table-row ${selectedRowIndex === row.index ? 'selected' : ''}`}
                  onClick={() => setSelectedRowIndex(row.index)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      onContextMenu={(event) => handleCellContextMenu(event, row.original, cell.getValue(), row.index)}
                      className={cell.column.id === '__rownum' ? 'row-number-col' : undefined}
                    >
                      <div
                        className={`result-table-cell-text ${cell.column.id === '__rownum' ? 'row-number-text' : ''}`.trim()}
                        title={formatCellValue(cell.getValue())}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>

        {contextMenu && (
          <div
            className="result-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button className="result-context-menu-item" onClick={handleCopyCell}>
              {t('resultPanel.copy')}
            </button>
            <button className="result-context-menu-item" onClick={handleCopyRow}>
              {t('resultPanel.copyRow')}
            </button>
          </div>
        )}
      </div>
      {/* Pagination */}
      <div className="result-table-pagination">
        <div className="pagination-info">
          {t('resultPanel.showingRows', { shown: table.getRowModel().rows.length, total: data.rows.length })}
        </div>
        <div className="pagination-controls">
          <Button
            small
            minimal
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.setPageIndex(0)}
          >
            {'<<'}
          </Button>
          <Button
            small
            minimal
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            {'<'}
          </Button>
          <span className="pagination-page">
            {t('resultPanel.page', { current: table.getState().pagination.pageIndex + 1, total: table.getPageCount() })}
          </span>
          <Button
            small
            minimal
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            {'>'}
          </Button>
          <Button
            small
            minimal
            disabled={!table.getCanNextPage()}
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
          >
            {'>>'}
          </Button>
        </div>
      </div>
    </div>
  );
};

const normalizeSqlForMessage = (sql: string): string => {
  return sql.trim().replace(/[;\s]+$/, '');
};

const getSqlKeyword = (sql: string): string => {
  const stripped = sql
    .replace(/^\s*(?:--.*(?:\r?\n|$)|#.*(?:\r?\n|$)|\/\*[\s\S]*?\*\/\s*)*/g, '')
    .trim()
    .toLowerCase();
  const keyword = stripped.match(/^([a-z]+)/)?.[1];
  return keyword || '';
};

const getSummaryInfoMessage = (tab: ResultTab, t: (key: string, opts?: Record<string, unknown>) => string): string => {
  if (tab.type === 'error') {
    return tab.statusText || (typeof tab.data === 'string' ? tab.data : t('resultPanel.execFailed'));
  }

  if (tab.type === 'update') {
    const keyword = getSqlKeyword(tab.sql);
    const updateData = tab.data as ExecResultData;
    if (keyword === 'update' || keyword === 'delete' || keyword === 'insert' || keyword === 'replace') {
      return t('resultPanel.affectedRows', { count: updateData.affected_rows });
    }

    if (keyword === 'create') {
      return 'OK';
    }

    if (typeof updateData.affected_rows === 'number' && updateData.affected_rows > 0) {
      return t('resultPanel.affectedRows', { count: updateData.affected_rows });
    }

    return 'OK';
  }

  return 'OK';
};

const MessageView: React.FC<{ tabs: ResultTab[] }> = ({ tabs }) => {
  const { t } = useTranslation();

  return (
    <div className="result-message-view">
      {tabs.map((tab, index) => (
        <div key={tab.id} className="result-message-block">
          <p className="result-message-sql">{normalizeSqlForMessage(tab.sql) || tab.title}</p>
          <p className="result-message-line">&gt; {tab.type === 'error' ? tab.statusText || t('resultPanel.execFailed') : 'OK'}</p>
          <p className="result-message-line">
            &gt; {t('resultPanel.queryTime', { time: formatSeconds(tab.executionTimeSec) })}
          </p>
          {index < tabs.length - 1 && <div className="result-message-divider" />}
        </div>
      ))}
    </div>
  );
};

const SummaryView: React.FC<{
  tabs: ResultTab[];
  onlyErrors: boolean;
  onToggleOnlyErrors: (checked: boolean) => void;
  onOpenQueryResult: (tabId: string) => void;
}> = ({ tabs, onlyErrors, onToggleOnlyErrors, onOpenQueryResult }) => {
  const { t } = useTranslation();
  const [detailState, setDetailState] = React.useState<SummaryDetailState | null>(null);

  const sortedTabs = React.useMemo(
    () => [...tabs].sort((a, b) => (a.statementOrder || 0) - (b.statementOrder || 0) || a.id.localeCompare(b.id)),
    [tabs],
  );

  const processed = sortedTabs.length;
  const success = sortedTabs.filter((tab) => tab.type !== 'error').length;
  const error = processed - success;
  const startAt = sortedTabs[0]?.startedAt;
  const endAt = sortedTabs[sortedTabs.length - 1]?.finishedAt;
  const runtimeSec = sortedTabs
    .reduce((acc, tab) => acc + (tab.executionTimeSec || 0) + (tab.fetchTimeSec || 0), 0)
    .toFixed(3);
  const tableRows = onlyErrors
    ? sortedTabs.filter((tab) => tab.type === 'error')
    : sortedTabs;

  return (
    <div className="result-summary-view">
      <div className="result-summary-top">
        <div className="result-summary-grid">
          <div>{t('resultPanel.processed', { count: processed })}</div>
          <div>{t('resultPanel.startTime', { time: formatDateTime(startAt) })}</div>
          <div>{t('resultPanel.successCount', { count: success })}</div>
          <div>{t('resultPanel.endTime', { time: formatDateTime(endAt) })}</div>
          <div>{t('resultPanel.errorCount', { count: error })}</div>
          <div>{t('resultPanel.runtime', { time: runtimeSec })}</div>
        </div>
        <label className="result-summary-only-errors">
          <input
            type="checkbox"
            checked={onlyErrors}
            onChange={(event) => onToggleOnlyErrors(event.target.checked)}
          />
          <span>{t('resultPanel.onlyErrors')}</span>
        </label>
      </div>

      <div className="result-summary-table-wrap">
        <table className="result-summary-table">
          <thead>
            <tr>
              <th>{t('resultPanel.summarySql')}</th>
              <th>{t('resultPanel.summaryMessage')}</th>
              <th>{t('resultPanel.summaryQueryTime')}</th>
              <th>{t('resultPanel.summaryFetchTime')}</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((tab) => (
              <tr key={`summary_${tab.id}`}>
                <td
                  className="result-summary-sql-cell"
                  onDoubleClick={() => {
                    if (tab.type === 'query') {
                      onOpenQueryResult(tab.id);
                    }
                  }}
                >
                  <div className="result-summary-info-wrap">
                    <span className="result-summary-info-text" title={tab.sql}>
                      {tab.sql}
                    </span>
                    <button
                      className="result-summary-info-more"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDetailState({ content: tab.sql, kind: 'sql' });
                      }}
                      aria-label={t('resultPanel.viewDetail')}
                    >
                      ...
                    </button>
                  </div>
                </td>
                <td className="result-summary-message-cell">
                  <div className="result-summary-info-wrap">
                    <span className="result-summary-info-text" title={getSummaryInfoMessage(tab, t)}>
                      {getSummaryInfoMessage(tab, t)}
                    </span>
                    <button
                      className="result-summary-info-more"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDetailState({ content: getSummaryInfoMessage(tab, t), kind: 'info' });
                      }}
                      aria-label={t('resultPanel.viewDetail')}
                    >
                      ...
                    </button>
                  </div>
                </td>
                <td>{formatSeconds(tab.executionTimeSec)}s</td>
                <td>{formatSeconds(tab.fetchTimeSec)}s</td>
              </tr>
            ))}
            {tableRows.length === 0 && (
              <tr>
                <td colSpan={4}>{t('resultPanel.noData')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detailState && (
        <div className="result-summary-detail-overlay" onClick={() => setDetailState(null)}>
          <div className="result-summary-detail-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="result-summary-detail-body">
              <textarea
                className="result-summary-detail-textarea"
                value={detailState.content}
                readOnly
                spellCheck={false}
              />
            </div>
            <div className="result-summary-detail-actions">
              <button type="button" className="result-summary-detail-confirm" onClick={() => setDetailState(null)}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const ResultPanel: React.FC<ResultPanelProps> = ({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onClearAll,
}) => {
  const { t } = useTranslation();
  const [exportNotice, setExportNotice] = React.useState<string | null>(null);
  const [activeViewId, setActiveViewId] = React.useState<string>('');
  const [pinMetaView, setPinMetaView] = React.useState(false);
  const [summaryOnlyErrors, setSummaryOnlyErrors] = React.useState(false);

  void onTabClose;

  const sortedTabs = React.useMemo(
    () => [...tabs].sort((a, b) => (a.statementOrder || 0) - (b.statementOrder || 0) || a.id.localeCompare(b.id)),
    [tabs],
  );

  const resultViews = React.useMemo(
    () => sortedTabs.filter((tab) => tab.type === 'query'),
    [sortedTabs],
  );
  const hasQueryResults = resultViews.length > 0;

  React.useEffect(() => {
    if (tabs.length === 0) {
      setActiveViewId('');
      setPinMetaView(false);
      return;
    }

    if (pinMetaView && (activeViewId === 'messages' || activeViewId === 'summary')) {
      return;
    }

    if (activeTabId && resultViews.some((tab) => tab.id === activeTabId)) {
      setActiveViewId(activeTabId);
      return;
    }

    if (!activeViewId || !resultViews.some((tab) => tab.id === activeViewId)) {
      if (hasQueryResults) {
        setActiveViewId(resultViews[0].id);
      } else {
        setActiveViewId('summary');
      }
    }
  }, [tabs, activeTabId, resultViews, activeViewId, pinMetaView, hasQueryResults]);

  const activeTab = React.useMemo(
    () => resultViews.find((tab) => tab.id === activeViewId) ?? null,
    [resultViews, activeViewId],
  );

  const canExportCsv =
    activeTab?.type === 'query' &&
    Boolean((activeTab.data as QueryResultData | undefined)?.columns?.length);

  React.useEffect(() => {
    if (!exportNotice) return;
    const timer = window.setTimeout(() => setExportNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [exportNotice]);

  const handleExportCsv = React.useCallback(async () => {
    if (!activeTab || activeTab.type !== 'query') return;

    try {
      const queryData = activeTab.data as QueryResultData;
      const headers = queryData.columns.map((col) => col.label || col.name);
      const rows = queryData.rows.map((row) => row.map((value) => formatCellValue(value)));

      const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const defaultFileName = `query_result_${timestamp}.csv`;

      const selectedPath = await save({
        title: t('resultPanel.exportTitle'),
        defaultPath: defaultFileName,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        canCreateDirectories: true,
      });

      if (!selectedPath) {
        setExportNotice(t('resultPanel.exportCancelled'));
        return;
      }

      const result = await invoke<CsvExportInfo>('export_query_result_csv', {
        filePath: selectedPath,
        headers,
        rows,
      });

      setExportNotice(t('resultPanel.exportSuccess', { time: result.exported_at, path: result.file_path }));
    } catch (error) {
      setExportNotice(t('resultPanel.exportFailed', { error: String(error) }));
    }
  }, [activeTab, t]);

  const handleSwitchView = (nextViewId: string) => {
    setActiveViewId(nextViewId);
    setPinMetaView(nextViewId === 'messages' || nextViewId === 'summary');
    if (nextViewId !== 'messages' && nextViewId !== 'summary') {
      onTabChange(nextViewId);
    }
  };

  const renderResultContent = (tab: ResultTab) => {
    return <QueryResultTable data={tab.data as QueryResultData} />;
  };

  return (
    <div className="result-panel">
      <div className="result-panel-toolbar">
        <div className="result-panel-title">
          <span>{t('resultPanel.title')}</span>
          {tabs.length > 0 && (
            <span className="result-panel-count">({tabs.length})</span>
          )}
          {exportNotice && (
            <span className="result-panel-count">{exportNotice}</span>
          )}
        </div>
        <div className="result-panel-actions">
          <Button
            small
            minimal
            onClick={handleExportCsv}
            disabled={!canExportCsv}
            className="result-panel-clear-btn"
          >
            <span>{t('resultPanel.exportCsv')}</span>
          </Button>
          <Button
            small
            minimal
            onClick={onClearAll}
            disabled={tabs.length === 0}
            className="result-panel-clear-btn"
          >
            <ClearResultsIcon size={14} />
            <span>{t('resultPanel.clearResults')}</span>
          </Button>
        </div>
      </div>

      {tabs.length === 0 ? (
        <div className="result-panel-empty">
          <p>{t('resultPanel.emptyHint')}</p>
        </div>
      ) : (
        <>
          <div className="result-navicat-tabs">
            <button
              className={`result-navicat-tab ${activeViewId === 'messages' ? 'active' : ''}`}
              onClick={() => handleSwitchView('messages')}
            >
              {t('resultPanel.messages')}
            </button>
            <button
              className={`result-navicat-tab ${activeViewId === 'summary' ? 'active' : ''}`}
              onClick={() => handleSwitchView('summary')}
            >
              {t('resultPanel.summary')}
            </button>
            {resultViews.map((tab, index) => (
              <button
                key={`view_${tab.id}`}
                className={`result-navicat-tab ${activeViewId === tab.id ? 'active' : ''}`}
                onClick={() => handleSwitchView(tab.id)}
              >
                {t('resultPanel.resultSetSimple', { index: index + 1 })}
              </button>
            ))}
          </div>

          <div className="result-navicat-content">
            {activeViewId === 'messages' && <MessageView tabs={sortedTabs} />}
            {activeViewId === 'summary' && (
              <SummaryView
                tabs={sortedTabs}
                onlyErrors={summaryOnlyErrors}
                onToggleOnlyErrors={setSummaryOnlyErrors}
                onOpenQueryResult={handleSwitchView}
              />
            )}
            {activeTab && activeViewId !== 'messages' && activeViewId !== 'summary' && (
              <div className="result-tab-content">{renderResultContent(activeTab)}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
