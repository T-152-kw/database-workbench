import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Dialog,
  Classes,
  Tab,
  Tabs,
  TabId,
  Button,
  Spinner,
  Callout,
  Intent,
} from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import type { ConnectionProfile, QueryResult } from '../../types';
import '../../styles/preview-commit-dialog.css';

interface DataRow {
  state: 'SYNCED' | 'NEW' | 'MODIFIED' | 'DELETED';
  originalData: unknown[];
  currentData: unknown[];
}

interface ColumnInfo {
  name: string;
  typeName: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: unknown;
  baseColumnName?: string; // 基表中的列名（用于视图列映射到基表）
}

interface TriggerInfo {
  name: string;
  timing: string;
  event: string;
  statement: string;
}

interface ForeignKeyCheck {
  type: 'outgoing' | 'incoming';
  myColumn: string;
  refTable: string;
  refColumn: string;
  missingValues?: string[];
  dependentRows?: Record<string, unknown>[];
  warning?: string;
}

interface ViewPreviewCommitDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connectionProfile: ConnectionProfile;
  database: string;
  viewName: string;
  baseTableName: string;
  columns: ColumnInfo[];
  changedRows: DataRow[];
  primaryKeys: string[];
}

const escapeSqlValue = (value: unknown): string => {
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

export const ViewPreviewCommitDialog: React.FC<ViewPreviewCommitDialogProps> = ({
  isOpen,
  onClose,
  connectionProfile,
  database,
  viewName,
  baseTableName,
  columns,
  changedRows,
  primaryKeys: _primaryKeys,
}) => {
  const { t } = useTranslation();
  const [selectedTab, setSelectedTab] = useState<TabId>('changes');
  const [isLoading, setIsLoading] = useState(false);
  const [triggers, setTriggers] = useState<TriggerInfo[]>([]);
  const [foreignKeyChecks, setForeignKeyChecks] = useState<ForeignKeyCheck[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const hasInsert = changedRows.some(r => r.state === 'NEW');
  const hasUpdate = changedRows.some(r => r.state === 'MODIFIED');
  const hasDelete = changedRows.some(r => r.state === 'DELETED');

  useEffect(() => {
    if (isOpen && selectedTab === 'associations') {
      loadAssociations();
    }
  }, [isOpen, selectedTab]);

  const loadAssociations = async () => {
    setIsLoading(true);
    setLoadError(null);
    
    let poolId: number | null = null;
    let connId: number | null = null;
    
    try {
      poolId = await invoke<number>('pool_create', { profile: connectionProfile });
      connId = await invoke<number>('pool_get_connection', { poolId, initialDatabase: database });

      await invoke('pool_execute', {
        poolId,
        connId,
        sql: `USE ${escapeIdentifier(database)}`,
      });
      // 通知后端更新数据库状态
      await invoke('pool_set_database', {
        poolId,
        connId,
        database,
      });

      // 加载基表的触发器和外键约束
      const loadedTriggers = await loadTriggers(poolId, connId);
      const loadedFkChecks = await checkForeignKeys(poolId, connId);
      
      setTriggers(loadedTriggers);
      setForeignKeyChecks(loadedFkChecks);
    } catch (err) {
      setLoadError(t('previewCommit.dialog.errors.loadAssociationsFailed', { error: err }));
    } finally {
      if (poolId && connId) {
        try {
          await invoke('pool_release_connection', { poolId, connId });
          await invoke('pool_close', { poolId });
        } catch (e) {
          console.error('Failed to close connection:', e);
        }
      }
      setIsLoading(false);
    }
  };

  const loadTriggers = async (poolId: number, connId: number): Promise<TriggerInfo[]> => {
    const result: TriggerInfo[] = [];
    
    try {
      const trigResult = await invoke<QueryResult>('pool_query', {
        poolId,
        connId,
        sql: `SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT 
              FROM INFORMATION_SCHEMA.TRIGGERS 
              WHERE EVENT_OBJECT_SCHEMA = ${escapeSqlValue(database)} 
              AND EVENT_OBJECT_TABLE = ${escapeSqlValue(baseTableName)}`,
      });

      for (const row of trigResult.rows) {
        const event = String(row[2]);
        const relevant = (event === 'INSERT' && hasInsert) ||
                        (event === 'UPDATE' && hasUpdate) ||
                        (event === 'DELETE' && hasDelete);

        if (relevant) {
          result.push({
            name: String(row[0]),
            timing: String(row[1]),
            event: event,
            statement: String(row[3]),
          });
        }
      }
    } catch (err) {
      console.error('Failed to load triggers:', err);
    }

    return result;
  };

  const checkForeignKeys = async (poolId: number, connId: number): Promise<ForeignKeyCheck[]> => {
    const result: ForeignKeyCheck[] = [];
    
    const insOrMod = changedRows.filter(r => r.state === 'NEW' || r.state === 'MODIFIED');
    const delOrMod = changedRows.filter(r => r.state === 'DELETED' || r.state === 'MODIFIED');

    if (insOrMod.length > 0) {
      try {
        const outFkResult = await invoke<QueryResult>('pool_query', {
          poolId,
          connId,
          sql: `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME 
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
                WHERE TABLE_SCHEMA = ${escapeSqlValue(database)} 
                AND TABLE_NAME = ${escapeSqlValue(baseTableName)} 
                AND REFERENCED_TABLE_NAME IS NOT NULL`,
        });

        for (const row of outFkResult.rows) {
          const myCol = String(row[0]);
          const parentTable = String(row[1]);
          const parentCol = String(row[2]);
          
          // 查找列索引：优先匹配baseColumnName，然后匹配name（忽略大小写）
          const colIndex = columns.findIndex(c => 
            c.baseColumnName === myCol || 
            c.name === myCol || 
            c.name.toLowerCase() === myCol.toLowerCase()
          );
          if (colIndex === -1) {
            console.log(`Outgoing FK: Column ${myCol} not found in view columns`);
            continue;
          }

          const checkingValues = new Set<string>();
          for (const dataRow of insOrMod) {
            const val = dataRow.currentData[colIndex];
            if (val !== null && val !== undefined && String(val) !== '') {
              checkingValues.add(String(val));
            }
          }

          if (checkingValues.size > 0) {
            const valuesList = Array.from(checkingValues).map(v => escapeSqlValue(v)).join(',');
            const q = `SELECT DISTINCT ${escapeIdentifier(parentCol)} FROM ${escapeIdentifier(database)}.${escapeIdentifier(parentTable)} WHERE ${escapeIdentifier(parentCol)} IN (${valuesList})`;
            
            const foundResult = await invoke<QueryResult>('pool_query', {
              poolId,
              connId,
              sql: q,
            });

            const foundValues = new Set<string>();
            for (const foundRow of foundResult.rows) {
              if (foundRow[0] !== null) {
                foundValues.add(String(foundRow[0]));
              }
            }

            const missingValues = Array.from(checkingValues).filter(v => !foundValues.has(v));

            if (missingValues.length > 0) {
              result.push({
                type: 'outgoing',
                myColumn: myCol,
                refTable: parentTable,
                refColumn: parentCol,
                missingValues,
                warning: t('previewCommit.dialog.associations.missingValuesWarning', { parentTable }),
              });
            }
          }
        }
      } catch (err) {
        console.error('Failed to check outgoing FKs:', err);
      }
    }

    if (delOrMod.length > 0) {
      try {
        const inFkResult = await invoke<QueryResult>('pool_query', {
          poolId,
          connId,
          sql: `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_COLUMN_NAME 
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
                WHERE REFERENCED_TABLE_SCHEMA = ${escapeSqlValue(database)} 
                AND REFERENCED_TABLE_NAME = ${escapeSqlValue(baseTableName)} 
                AND REFERENCED_COLUMN_NAME IS NOT NULL`,
        });

        for (const row of inFkResult.rows) {
          const refTable = String(row[0]);
          const refCol = String(row[1]);
          const myCol = String(row[2]);
          
          // 查找列索引：优先匹配baseColumnName，然后匹配name（忽略大小写）
          const colIndex = columns.findIndex(c => 
            c.baseColumnName === myCol || 
            c.name === myCol || 
            c.name.toLowerCase() === myCol.toLowerCase()
          );
          if (colIndex === -1) {
            console.log(`Incoming FK: Column ${myCol} not found in view columns`);
            continue;
          }

          const targetValues = new Set<string>();
          for (const dataRow of delOrMod) {
            let isAffected = false;
            
            if (dataRow.state === 'DELETED') {
              isAffected = true;
            } else if (dataRow.state === 'MODIFIED') {
              const curVal = dataRow.currentData[colIndex];
              const origVal = dataRow.originalData[colIndex];
              if (curVal !== origVal) {
                isAffected = true;
              }
            }

            if (isAffected) {
              const val = dataRow.originalData[colIndex];
              if (val !== null && val !== undefined) {
                targetValues.add(String(val));
              }
            }
          }

          if (targetValues.size > 0) {
            const valuesList = Array.from(targetValues).map(v => escapeSqlValue(v)).join(',');
            const q = `SELECT * FROM ${escapeIdentifier(database)}.${escapeIdentifier(refTable)} WHERE ${escapeIdentifier(refCol)} IN (${valuesList}) LIMIT 20`;
            
            const childResult = await invoke<QueryResult>('pool_query', {
              poolId,
              connId,
              sql: q,
            });

            if (childResult.rows.length > 0) {
              const dependentRows: Record<string, unknown>[] = [];
              for (const childRow of childResult.rows) {
                const rowMap: Record<string, unknown> = {};
                for (let i = 0; i < childResult.columns.length; i++) {
                  rowMap[childResult.columns[i].name] = childRow[i];
                }
                dependentRows.push(rowMap);
              }

              result.push({
                type: 'incoming',
                myColumn: myCol,
                refTable,
                refColumn: refCol,
                dependentRows,
                warning: t('previewCommit.dialog.associations.dependencyWarning'),
              });
            }
          }
        }
      } catch (err) {
        console.error('Failed to check incoming FKs:', err);
      }
    }

    return result;
  };

  const getOperationLabel = (state: DataRow['state']): string => {
    switch (state) {
      case 'NEW':
        return t('previewCommit.dialog.changes.operations.new');
      case 'MODIFIED':
        return t('previewCommit.dialog.changes.operations.modified');
      case 'DELETED':
        return t('previewCommit.dialog.changes.operations.deleted');
      default:
        return '';
    }
  };

  const getOperationClassName = (state: DataRow['state']): string => {
    switch (state) {
      case 'NEW':
        return 'operation-new';
      case 'MODIFIED':
        return 'operation-modified';
      case 'DELETED':
        return 'operation-deleted';
      default:
        return '';
    }
  };

  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'string') {
      return value.length > 50 ? value.substring(0, 50) + '...' : value;
    }
    return String(value);
  };

  const isNullValue = (value: unknown): boolean => {
    return value === null || value === undefined;
  };

  const renderChangesTab = () => {
    if (changedRows.length === 0) {
      return (
        <div className="preview-empty-state">
          <span className="bp5-icon bp5-icon-info-sign" />
          <span>{t('previewCommit.dialog.changes.noData')}</span>
        </div>
      );
    }

    return (
      <div className="preview-changes-container">
        <Callout intent={Intent.NONE} className="view-preview-info">
          <strong>{t('previewCommit.dialog.viewInfo.title')}</strong>
          {t('previewCommit.dialog.viewInfo.description', { viewName, baseTableName })}
        </Callout>
        <div className="preview-changes-info">
          {t('previewCommit.dialog.changes.recordCount', { count: changedRows.length })}
        </div>
        <div className="preview-changes-table-wrapper">
          <table className="preview-changes-table">
            <thead>
              <tr>
                <th className="operation-col">{t('previewCommit.dialog.changes.operation')}</th>
                {columns.map((col) => (
                  <th key={col.name}>
                    <div className="preview-header-content">
                      <span className="preview-header-name">{col.name}</span>
                      {col.isPrimaryKey && (
                        <span className="pk-indicator">{t('previewCommit.dialog.changes.pkIndicator')}</span>
                      )}
                    </div>
                    <div className="preview-header-type">{col.typeName}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {changedRows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={`preview-changes-row ${row.state === 'DELETED' ? 'row-deleted' : ''}`}
                >
                  <td className={`operation-col ${getOperationClassName(row.state)}`}>
                    <strong>{getOperationLabel(row.state)}</strong>
                  </td>
                  {columns.map((col, colIndex) => {
                    const currentValue = row.currentData[colIndex];
                    const originalValue = row.originalData[colIndex];
                    const isModified = row.state === 'MODIFIED' && currentValue !== originalValue;
                    const displayValue = row.state === 'DELETED' ? originalValue : currentValue;

                    return (
                      <td
                        key={col.name}
                        className={isModified ? 'cell-modified' : ''}
                      >
                        <span
                          className={`preview-cell-text ${isNullValue(displayValue) ? 'null-value' : ''}`}
                          title={String(displayValue ?? '')}
                        >
                          {formatCellValue(displayValue)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderAssociationsTab = () => {
    if (isLoading) {
      return (
        <div className="preview-loading">
          <Spinner size={32} />
          <span>{t('previewCommit.dialog.associations.loading')}</span>
        </div>
      );
    }

    if (loadError) {
      return (
        <div className="preview-error">
          <span className="error-icon">⚠</span>
          <span>{loadError}</span>
        </div>
      );
    }

    const hasContent = triggers.length > 0 || foreignKeyChecks.length > 0;

    if (!hasContent) {
      return (
        <div className="preview-empty-associations">
          <Callout intent={Intent.NONE} className="view-preview-info">
            <strong>{t('previewCommit.dialog.associations.baseTable')}：</strong>{baseTableName}
          </Callout>
          <span className="success-icon">✓</span>
          <span>{t('previewCommit.dialog.associations.viewNoAssociations')}</span>
        </div>
      );
    }

    return (
      <div className="preview-associations-container">
        <Callout intent={Intent.NONE} className="view-preview-info">
          <strong>{t('previewCommit.dialog.associations.baseTable')}：</strong>{baseTableName}
          <br />
          <small>{t('previewCommit.dialog.associations.baseTableInfo')}</small>
        </Callout>

        {triggers.map((trigger, idx) => (
          <div key={`trigger-${idx}`} className="association-card trigger-card">
            <div className="card-title trigger-title">
              {t('previewCommit.dialog.associations.trigger')}: {trigger.name} ({trigger.timing} {trigger.event})
            </div>
            <textarea className="card-statement" value={trigger.statement} readOnly rows={4} />
          </div>
        ))}

        {foreignKeyChecks.map((fk, idx) => (
          <div key={`fk-${idx}`} className={`association-card ${fk.type === 'outgoing' ? 'fk-outgoing-card' : 'fk-incoming-card'}`}>
            {fk.type === 'outgoing' ? (
              <>
                <div className="card-title fk-outgoing-title">
                  {t('previewCommit.dialog.associations.viewForeignKeyConstraint', { myColumn: fk.myColumn, refTable: fk.refTable, refColumn: fk.refColumn })}
                </div>
                {fk.warning && fk.missingValues && (
                  <div className="card-warning">
                    ⚠ {fk.warning}:<br />
                    {fk.missingValues.join(', ')}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="card-title fk-incoming-title">
                  {t('previewCommit.dialog.associations.viewDependencyCheck', { refTable: fk.refTable, refColumn: fk.refColumn, myColumn: fk.myColumn })}
                </div>
                {fk.warning && (
                  <div className="card-warning">
                    ⚠ {fk.warning}
                  </div>
                )}
                {fk.dependentRows && fk.dependentRows.length > 0 && (
                  <div className="dependent-rows-table-wrapper">
                    <table className="dependent-rows-table">
                      <thead>
                        <tr>
                          {Object.keys(fk.dependentRows[0]).map(key => (
                            <th key={key} className={key === fk.refColumn ? 'highlight-column' : ''}>
                              {key}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {fk.dependentRows.slice(0, 10).map((row, rowIdx) => (
                          <tr key={rowIdx}>
                            {Object.entries(row).map(([key, val]) => (
                              <td key={key} className={key === fk.refColumn ? 'highlight-column' : ''}>
                                {formatCellValue(val)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {fk.dependentRows.length > 10 && (
                      <div className="more-rows-hint">
                        {t('previewCommit.dialog.associations.moreRows', { count: fk.dependentRows.length - 10 })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('previewCommit.dialog.viewTitle', { database, viewName, baseTableName })}
      className="preview-commit-dialog"
    >
      <div className={`${Classes.DIALOG_BODY} preview-commit-dialog-body`}>
        <Tabs
          id="preview-tabs"
          selectedTabId={selectedTab}
          onChange={(tabId) => setSelectedTab(tabId)}
          className="preview-tabs"
        >
          <Tab id="changes" title={t('previewCommit.dialog.tabs.changes')} panel={renderChangesTab()} />
          <Tab id="associations" title={t('previewCommit.dialog.tabs.associations')} panel={renderAssociationsTab()} />
        </Tabs>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>{t('previewCommit.dialog.close')}</Button>
        </div>
      </div>
    </Dialog>
  );
}

export default ViewPreviewCommitDialog;
