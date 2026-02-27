import React from 'react';
import { Button, Tab, Tabs } from '@blueprintjs/core';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import type { ResultTab, QueryResultData, ExecResultData } from '../../types';
import {
  TableIcon,
  UpdateIcon,
  ErrorIcon,
  CloseIcon,
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

// Update Result Component
const UpdateResult: React.FC<{ data: ExecResultData }> = ({ data }) => {
  const { t } = useTranslation();
  return (
    <div className="result-update">
      <div className="result-update-content">
        <div className="result-update-icon">
          <UpdateIcon size={48} color="#28a745" />
        </div>
        <div className="result-update-text">
          <p className="result-update-title">{t('resultPanel.execSuccess')}</p>
          <p className="result-update-detail">{t('resultPanel.affectedRows', { count: data.affected_rows })}</p>
          {data.last_insert_id > 0 && (
            <p className="result-update-detail">{t('resultPanel.lastInsertId', { id: data.last_insert_id })}</p>
          )}
        </div>
      </div>
    </div>
  );
};

// Error Result Component
const ErrorResult: React.FC<{ message: string }> = ({ message }) => {
  const { t } = useTranslation();
  return (
    <div className="result-error">
      <div className="result-error-content">
        <div className="result-error-icon">
          <ErrorIcon size={48} />
        </div>
        <div className="result-error-text">
          <p className="result-error-title">{t('resultPanel.execFailed')}</p>
          <p className="result-error-detail">{message}</p>
        </div>
      </div>
    </div>
  );
};

// Result Tab Title Component
const ResultTabTitle: React.FC<{
  tab: ResultTab;
  onClose: () => void;
}> = ({ tab, onClose }) => {
  const getIcon = () => {
    switch (tab.type) {
      case 'query':
        return <TableIcon size={14} />;
      case 'update':
        return <UpdateIcon size={14} />;
      case 'error':
        return <ErrorIcon size={14} />;
      default:
        return null;
    }
  };

  return (
    <div className="result-tab-title">
      {getIcon()}
      <span className="result-tab-label">{tab.title}</span>
      <button
        className="result-tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <CloseIcon size={12} />
      </button>
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

  const activeTab = React.useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId],
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

  // Render result content based on tab type
  const renderResultContent = (tab: ResultTab) => {
    switch (tab.type) {
      case 'query':
        return <QueryResultTable data={tab.data as QueryResultData} />;
      case 'update':
        return <UpdateResult data={tab.data as ExecResultData} />;
      case 'error':
        return <ErrorResult message={tab.data as string} />;
      default:
        return null;
    }
  };

  return (
    <div className="result-panel">
      {/* Result Toolbar */}
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

      {/* Result Tabs */}
      {tabs.length === 0 ? (
        <div className="result-panel-empty">
          <p>{t('resultPanel.emptyHint')}</p>
        </div>
      ) : (
        <Tabs
          selectedTabId={activeTabId || undefined}
          onChange={onTabChange}
          className="result-tabs"
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              id={tab.id}
              title={<ResultTabTitle tab={tab} onClose={() => onTabClose(tab.id)} />}
              panel={
                <div className="result-tab-content">
                  {renderResultContent(tab)}
                </div>
              }
            />
          ))}
        </Tabs>
      )}
    </div>
  );
};
