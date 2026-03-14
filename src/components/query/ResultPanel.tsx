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
  getSortedRowModel,
  type SortingState,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';

interface ResultPanelProps {
  tabs: ResultTab[];
  metaTabs?: ResultTab[];
  executionWallTimeSec?: number;
  activeTabId: string | null;
  onTabChange: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onClearAll: () => void;
  onRequestQueryPage?: (tabId: string, page: number, pageSize: number) => void | Promise<void>;
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

interface VirtualWindowRange {
  start: number;
  end: number;
  topPadding: number;
  bottomPadding: number;
}

interface SummaryRowItem {
  tab: ResultTab;
  infoMessage: string;
}

const MESSAGE_VIRTUAL_ROW_HEIGHT = 84;
const MESSAGE_VIRTUAL_OVERSCAN = 10;
const SUMMARY_VIRTUAL_ROW_HEIGHT = 36;
const SUMMARY_VIRTUAL_OVERSCAN = 12;

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

const useVirtualWindow = (
  enabled: boolean,
  rowCount: number,
  rowHeight: number,
  overscan: number,
): {
  containerRef: React.RefObject<HTMLDivElement>;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  range: VirtualWindowRange;
} => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(420);

  React.useEffect(() => {
    if (!enabled) {
      setScrollTop(0);
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const applyHeight = () => {
      setViewportHeight(container.clientHeight || 420);
    };

    applyHeight();
    const observer = new ResizeObserver(applyHeight);
    observer.observe(container);

    return () => observer.disconnect();
  }, [enabled]);

  const onScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (!enabled) {
      return;
    }
    setScrollTop((event.currentTarget as HTMLDivElement).scrollTop);
  }, [enabled]);

  const range = React.useMemo<VirtualWindowRange>(() => {
    if (!enabled) {
      return {
        start: 0,
        end: rowCount,
        topPadding: 0,
        bottomPadding: 0,
      };
    }

    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
    const end = Math.min(rowCount, start + visibleCount);
    const topPadding = start * rowHeight;
    const bottomPadding = Math.max(0, (rowCount - end) * rowHeight);

    return {
      start,
      end,
      topPadding,
      bottomPadding,
    };
  }, [enabled, overscan, rowCount, rowHeight, scrollTop, viewportHeight]);

  return {
    containerRef,
    onScroll,
    range,
  };
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
const QueryResultTable: React.FC<{
  data: QueryResultData;
  onRequestPage?: (page: number, pageSize: number) => void | Promise<void>;
}> = ({ data, onRequestPage }) => {
  const { t } = useTranslation();
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [selectedRowIndex, setSelectedRowIndex] = React.useState<number | null>(null);
  const [contextMenu, setContextMenu] = React.useState<ResultContextMenuState | null>(null);
  const [columnWidths, setColumnWidths] = React.useState<Record<string, number>>({});
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(420);
  const VIRTUAL_ROW_HEIGHT = 30;
  const VIRTUAL_OVERSCAN = 12;
  const serverPaginationData = data.pagination;
  const serverPagination = Boolean(serverPaginationData);
  const serverOffset = serverPaginationData
    ? (serverPaginationData.page - 1) * serverPaginationData.page_size
    : 0;

  const columns: ColumnDef<unknown[], string>[] = React.useMemo(() => {
    const sourceColumns = data.columns.length > 0
      ? data.columns
      : [{ name: '__empty__', label: t('resultPanel.result'), type_name: '' }];

    const rowNumberColumn: ColumnDef<unknown[], string> = {
      id: '__rownum',
      header: '#',
      accessorFn: (_row, index) => String(index + 1 + serverOffset),
      enableSorting: false,
      cell: (info) => String(info.row.index + 1 + serverOffset),
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
  }, [data.columns, t, serverOffset]);

  const table = useReactTable({
    data: data.rows,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const visibleRows = table.getRowModel().rows;
  const virtualEnabled = !serverPagination && visibleRows.length > 200;

  React.useEffect(() => {
    if (!virtualEnabled) {
      return;
    }

    const el = wrapperRef.current;
    if (!el) {
      return;
    }

    const applyHeight = () => {
      setViewportHeight(el.clientHeight || 420);
    };

    applyHeight();
    const observer = new ResizeObserver(applyHeight);
    observer.observe(el);

    return () => observer.disconnect();
  }, [virtualEnabled]);

  const virtualRange = React.useMemo(() => {
    if (!virtualEnabled) {
      return {
        start: 0,
        end: visibleRows.length,
        topPadding: 0,
        bottomPadding: 0,
      };
    }

    const start = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const count = Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
    const end = Math.min(visibleRows.length, start + count);
    const topPadding = start * VIRTUAL_ROW_HEIGHT;
    const bottomPadding = Math.max(0, (visibleRows.length - end) * VIRTUAL_ROW_HEIGHT);

    return {
      start,
      end,
      topPadding,
      bottomPadding,
    };
  }, [virtualEnabled, visibleRows.length, scrollTop, viewportHeight]);

  const renderedRows = React.useMemo(
    () => visibleRows.slice(virtualRange.start, virtualRange.end),
    [visibleRows, virtualRange.start, virtualRange.end],
  );

  const handleServerPageChange = React.useCallback((page: number, pageSize?: number) => {
    if (!serverPaginationData || !onRequestPage) return;
    void onRequestPage(page, pageSize ?? serverPaginationData.page_size);
  }, [serverPaginationData, onRequestPage]);

  const handleServerPageSizeChange = React.useCallback((newSize: number) => {
    if (!serverPaginationData || !onRequestPage) return;
    void onRequestPage(1, newSize);
  }, [serverPaginationData, onRequestPage]);

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
      <div
        ref={wrapperRef}
        className="result-table-wrapper"
        onScroll={(event) => setScrollTop((event.currentTarget as HTMLDivElement).scrollTop)}
      >
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
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={table.getAllColumns().length} className="result-table-empty-row">
                  {t('resultPanel.noData')}
                </td>
              </tr>
            ) : (
              <>
                {virtualRange.topPadding > 0 && (
                  <tr>
                    <td colSpan={table.getAllColumns().length} style={{ height: `${virtualRange.topPadding}px`, padding: 0, border: 'none' }} />
                  </tr>
                )}
                {renderedRows.map((row) => (
                <tr
                  key={row.id}
                  className={`result-table-row ${selectedRowIndex === row.index ? 'selected' : ''}`}
                  onClick={() => setSelectedRowIndex(row.index)}
                  style={virtualEnabled ? { height: `${VIRTUAL_ROW_HEIGHT}px` } : undefined}
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
                ))}
                {virtualRange.bottomPadding > 0 && (
                  <tr>
                    <td colSpan={table.getAllColumns().length} style={{ height: `${virtualRange.bottomPadding}px`, padding: 0, border: 'none' }} />
                  </tr>
                )}
              </>
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
          {!serverPagination && t('resultPanel.showingRows', { shown: visibleRows.length, total: data.rows.length })}
          {serverPagination && t('resultPanel.showingRows', {
            shown: data.rows.length,
            total: data.pagination?.total_rows ?? (data.pagination?.has_more ? `${data.rows.length}+` : `${data.rows.length}`),
          })}
        </div>
        <div className="pagination-controls">
          {!serverPagination && (
            <>
              <span className="pagination-page">
                {virtualEnabled ? 'Virtual Scroll' : 'Client Mode'}
              </span>
            </>
          )}
          {serverPagination && serverPaginationData && (
            <>
              <span className="pagination-page-size-label">{t('resultPanel.pageSize')}</span>
              <select
                className="pagination-page-size-select"
                value={serverPaginationData.page_size}
                onChange={(event) => handleServerPageSizeChange(Number(event.target.value))}
              >
                {[100, 200, 500, 1000].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
              <Button
                small
                minimal
                disabled={serverPaginationData.page <= 1}
                onClick={() => handleServerPageChange(1)}
              >
                {'<<'}
              </Button>
              <Button
                small
                minimal
                disabled={serverPaginationData.page <= 1}
                onClick={() => handleServerPageChange(serverPaginationData.page - 1)}
              >
                {'<'}
              </Button>
              <span className="pagination-page">
                {t('resultPanel.page', {
                  current: serverPaginationData.page,
                  total: serverPaginationData.total_pages ?? '?',
                })}
              </span>
              <Button
                small
                minimal
                disabled={!serverPaginationData.has_more}
                onClick={() => handleServerPageChange(serverPaginationData.page + 1)}
              >
                {'>'}
              </Button>
              <Button
                small
                minimal
                disabled={!serverPaginationData.total_pages || serverPaginationData.page >= serverPaginationData.total_pages}
                onClick={() => {
                  if (serverPaginationData.total_pages) {
                    handleServerPageChange(serverPaginationData.total_pages);
                  }
                }}
              >
                {'>>'}
              </Button>
            </>
          )}
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
  const virtualEnabled = tabs.length > 220;
  const {
    containerRef,
    onScroll,
    range,
  } = useVirtualWindow(virtualEnabled, tabs.length, MESSAGE_VIRTUAL_ROW_HEIGHT, MESSAGE_VIRTUAL_OVERSCAN);

  const renderedTabs = React.useMemo(
    () => tabs.slice(range.start, range.end),
    [tabs, range.start, range.end],
  );

  return (
    <div ref={containerRef} className="result-message-view" onScroll={onScroll}>
      {range.topPadding > 0 && <div className="result-message-virtual-spacer" style={{ height: `${range.topPadding}px` }} />}
      {renderedTabs.map((tab, index) => {
        const actualIndex = range.start + index;

        return (
          <div key={tab.id} className="result-message-block" style={virtualEnabled ? { height: `${MESSAGE_VIRTUAL_ROW_HEIGHT}px` } : undefined}>
            <p className="result-message-sql" title={tab.sql}>{normalizeSqlForMessage(tab.sql) || tab.title}</p>
            <p className="result-message-line">&gt; {tab.type === 'error' ? tab.statusText || t('resultPanel.execFailed') : 'OK'}</p>
            <p className="result-message-line">
              &gt; {t('resultPanel.queryTime', { time: formatSeconds(tab.executionTimeSec) })}
            </p>
            {actualIndex < tabs.length - 1 && <div className="result-message-divider" />}
          </div>
        );
      })}
      {range.bottomPadding > 0 && <div className="result-message-virtual-spacer" style={{ height: `${range.bottomPadding}px` }} />}
    </div>
  );
};

const SummaryView: React.FC<{
  tabs: ResultTab[];
  executionWallTimeSec?: number;
  onlyErrors: boolean;
  onToggleOnlyErrors: (checked: boolean) => void;
  onOpenQueryResult: (tabId: string) => void;
}> = ({ tabs, executionWallTimeSec, onlyErrors, onToggleOnlyErrors, onOpenQueryResult }) => {
  const { t } = useTranslation();
  const [detailState, setDetailState] = React.useState<SummaryDetailState | null>(null);

  const summaryStats = React.useMemo(() => {
    const processed = tabs.length;
    const success = tabs.filter((tab) => tab.type !== 'error').length;
    const error = processed - success;
    const startAt = tabs[0]?.startedAt;
    const endAt = tabs[tabs.length - 1]?.finishedAt;
    const runtimeSec = tabs
      .reduce((acc, tab) => acc + (tab.executionTimeSec || 0) + (tab.fetchTimeSec || 0), 0)
      .toFixed(3);
    const runtimeDisplay = typeof executionWallTimeSec === 'number'
      ? executionWallTimeSec.toFixed(3)
      : runtimeSec;

    return {
      processed,
      success,
      error,
      startAt,
      endAt,
      runtimeSec: runtimeDisplay,
    };
  }, [tabs, executionWallTimeSec]);

  const tableRows = React.useMemo<SummaryRowItem[]>(() => {
    const sourceTabs = onlyErrors
      ? tabs.filter((tab) => tab.type === 'error')
      : tabs;

    return sourceTabs.map((tab) => ({
      tab,
      infoMessage: getSummaryInfoMessage(tab, t),
    }));
  }, [onlyErrors, tabs, t]);

  const summaryVirtualEnabled = tableRows.length > 220;
  const {
    containerRef,
    onScroll,
    range,
  } = useVirtualWindow(summaryVirtualEnabled, tableRows.length, SUMMARY_VIRTUAL_ROW_HEIGHT, SUMMARY_VIRTUAL_OVERSCAN);

  const renderedRows = React.useMemo(
    () => tableRows.slice(range.start, range.end),
    [tableRows, range.start, range.end],
  );

  return (
    <div className="result-summary-view">
      <div className="result-summary-top">
        <div className="result-summary-grid">
          <div>{t('resultPanel.processed', { count: summaryStats.processed })}</div>
          <div>{t('resultPanel.startTime', { time: formatDateTime(summaryStats.startAt) })}</div>
          <div>{t('resultPanel.successCount', { count: summaryStats.success })}</div>
          <div>{t('resultPanel.endTime', { time: formatDateTime(summaryStats.endAt) })}</div>
          <div>{t('resultPanel.errorCount', { count: summaryStats.error })}</div>
          <div>{t('resultPanel.runtime', { time: summaryStats.runtimeSec })}</div>
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

      <div ref={containerRef} className="result-summary-table-wrap" onScroll={onScroll}>
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
            {range.topPadding > 0 && (
              <tr>
                <td colSpan={4} style={{ height: `${range.topPadding}px`, padding: 0, border: 'none' }} />
              </tr>
            )}
            {renderedRows.map(({ tab, infoMessage }) => (
              <tr
                key={`summary_${tab.id}`}
                className={tab.type === 'error' ? 'result-summary-row-error' : undefined}
                style={summaryVirtualEnabled ? { height: `${SUMMARY_VIRTUAL_ROW_HEIGHT}px` } : undefined}
              >
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
                    <span className="result-summary-info-text" title={infoMessage}>
                      {infoMessage}
                    </span>
                    <button
                      className="result-summary-info-more"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDetailState({ content: infoMessage, kind: 'info' });
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
            {range.bottomPadding > 0 && (
              <tr>
                <td colSpan={4} style={{ height: `${range.bottomPadding}px`, padding: 0, border: 'none' }} />
              </tr>
            )}
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
  metaTabs,
  executionWallTimeSec,
  activeTabId,
  onTabChange,
  onTabClose,
  onClearAll,
  onRequestQueryPage,
}) => {
  const { t } = useTranslation();
  const [exportNotice, setExportNotice] = React.useState<string | null>(null);
  const [activeViewId, setActiveViewId] = React.useState<string>('');
  const [pinMetaView, setPinMetaView] = React.useState(false);
  const [summaryOnlyErrors, setSummaryOnlyErrors] = React.useState(false);

  const executionTabs = React.useMemo(
    () => (metaTabs && metaTabs.length > 0 ? metaTabs : tabs),
    [metaTabs, tabs],
  );

  void onTabClose;

  const sortedTabs = React.useMemo(
    () => [...executionTabs].sort((a, b) => (a.statementOrder || 0) - (b.statementOrder || 0) || a.id.localeCompare(b.id)),
    [executionTabs],
  );

  const resultViews = React.useMemo(
    () => sortedTabs.filter((tab) => tab.type === 'query'),
    [sortedTabs],
  );
  const hasQueryResults = resultViews.length > 0;

  React.useEffect(() => {
    if (executionTabs.length === 0) {
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
  }, [executionTabs, activeTabId, resultViews, activeViewId, pinMetaView, hasQueryResults]);

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
    return (
      <QueryResultTable
        data={tab.data as QueryResultData}
        onRequestPage={(page, pageSize) => onRequestQueryPage?.(tab.id, page, pageSize)}
      />
    );
  };

  return (
    <div className="result-panel">
      <div className="result-panel-toolbar">
        <div className="result-panel-title">
          <span>{t('resultPanel.title')}</span>
          {executionTabs.length > 0 && (
            <span className="result-panel-count">({executionTabs.length})</span>
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
            disabled={executionTabs.length === 0}
            className="result-panel-clear-btn"
          >
            <ClearResultsIcon size={14} />
            <span>{t('resultPanel.clearResults')}</span>
          </Button>
        </div>
      </div>

      {executionTabs.length === 0 ? (
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
                executionWallTimeSec={executionWallTimeSec}
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
