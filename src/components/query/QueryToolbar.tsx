import React, { useState, useEffect } from 'react';
import { Button, Menu, MenuItem, Popover, Position, Divider } from '@blueprintjs/core';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ConnectionProfile } from '../../types';
import {
  SaveIcon,
  PlayIcon,
  SearchIcon,
  FormatIcon,
  ClearIcon,
  CheckIcon,
  UndoIcon,
  ConnectionStatusIcon,
} from './QueryIcons';

interface QueryToolbarProps {
  availableConnections: ConnectionProfile[];
  selectedConnection?: ConnectionProfile;
  selectedDatabase?: string;
  isConnected: boolean;
  isExecuting: boolean;
  autoCommit: boolean;
  statusMessage: string;
  connectionInfo: string;
  onConnectionChange: (connection?: ConnectionProfile) => void;
  onDatabaseChange: (database?: string) => void;
  onExecute: () => void;
  executeLabel?: string;
  onSave: () => void;
  onExplain: () => void;
  onFormat: () => void;
  onClear: () => void;
  onInsertSnippet: (snippet: string) => void;
  onTransactionModeChange: (mode: 'auto' | 'manual') => void;
  onCommit: () => void;
  onRollback: () => void;
}

export const QueryToolbar: React.FC<QueryToolbarProps> = ({
  availableConnections,
  selectedConnection,
  selectedDatabase,
  isConnected,
  isExecuting,
  autoCommit,
  statusMessage,
  connectionInfo,
  onConnectionChange,
  onDatabaseChange,
  onExecute,
  executeLabel,
  onSave,
  onExplain,
  onFormat,
  onClear,
  onInsertSnippet,
  onTransactionModeChange,
  onCommit,
  onRollback,
}) => {
  const { t } = useTranslation();
  const [databases, setDatabases] = useState<string[]>([]);
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);

  // Snippets for SQL
  const SQL_SNIPPETS = [
    { label: 'SELECT *', code: 'SELECT * FROM ' },
    { label: 'COUNT(*)', code: 'SELECT COUNT(*) FROM ' },
    { label: 'LIMIT 100', code: 'LIMIT 100' },
    { label: 'ORDER BY', code: 'ORDER BY id DESC' },
    { label: 'LEFT JOIN', code: 'LEFT JOIN table2 t2 ON t1.id = t2.id' },
    { label: 'INSERT INTO', code: 'INSERT INTO table_name (column1, column2) VALUES (value1, value2)' },
    { label: 'UPDATE', code: 'UPDATE table_name SET column1 = value1 WHERE condition' },
    { label: 'DELETE', code: 'DELETE FROM table_name WHERE condition' },
  ];

  // Load databases when connection changes
  useEffect(() => {
    const loadDatabases = async () => {
      if (!selectedConnection) {
        setDatabases([]);
        return;
      }

      setIsLoadingDatabases(true);
      try {
        const dbs = await invoke<string[]>('metadata_list_databases', {
          profile: selectedConnection,
        });
        setDatabases(dbs);
      } catch (error) {
        console.error('Failed to load databases:', error);
        setDatabases([]);
      } finally {
        setIsLoadingDatabases(false);
      }
    };

    loadDatabases();
  }, [selectedConnection]);

  return (
    <div className="query-toolbar">
      {/* Connection and Database Selection Row */}
      <div className="query-toolbar-row">
        <div className="query-toolbar-group">
          <span className="query-toolbar-label">{t('queryToolbar.connection')}:</span>
          <div className="query-toolbar-select">
            <Popover
              position={Position.BOTTOM_LEFT}
              minimal
              content={
                <Menu>
                  <MenuItem
                    text={t('queryToolbar.noConnection')}
                    active={!selectedConnection}
                    onClick={() => onConnectionChange(undefined)}
                  />
                  {availableConnections.map((conn) => (
                    <MenuItem
                      key={conn.name || `${conn.host}:${conn.port}`}
                      text={conn.name || `${conn.host}:${conn.port}`}
                      active={selectedConnection?.name === conn.name}
                      onClick={() => onConnectionChange(conn)}
                    />
                  ))}
                </Menu>
              }
            >
              <Button
                text={selectedConnection?.name || t('queryToolbar.selectConnection')}
                rightIcon="caret-down"
                minimal
                small
                className="query-toolbar-dropdown"
              />
            </Popover>
          </div>
        </div>

        <div className="query-toolbar-group">
          <span className="query-toolbar-label">{t('queryToolbar.database')}:</span>
          <div className="query-toolbar-select">
            <Popover
              position={Position.BOTTOM_LEFT}
              minimal
              content={
                <Menu>
                  <MenuItem
                    text={t('queryToolbar.selectDatabase')}
                    active={!selectedDatabase}
                    onClick={() => onDatabaseChange(undefined)}
                  />
                  {isLoadingDatabases ? (
                    <MenuItem text={t('common.loading')} disabled />
                  ) : (
                    databases.map((db) => (
                      <MenuItem
                        key={db}
                        text={db}
                        active={selectedDatabase === db}
                        onClick={() => onDatabaseChange(db)}
                      />
                    ))
                  )}
                </Menu>
              }
            >
              <Button
                text={selectedDatabase || t('queryToolbar.selectDatabase')}
                rightIcon="caret-down"
                minimal
                small
                className="query-toolbar-dropdown"
                disabled={!isConnected}
              />
            </Popover>
          </div>
        </div>

        <div className="query-toolbar-spacer" />

        {/* Connection Status */}
        <div className="query-toolbar-status">
          <span className="query-toolbar-status-message">{statusMessage}</span>
          <div className="query-toolbar-connection-status">
            <ConnectionStatusIcon connected={isConnected} />
            <span className={`query-toolbar-connection-info ${isConnected ? 'connected' : ''}`}>
              {connectionInfo}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons Row */}
      <div className="query-toolbar-row">
        <div className="query-toolbar-group">
          {/* Save Button */}
          <Button
            className="query-toolbar-btn"
            minimal
            small
            onClick={onSave}
            title={t('common.save')}
          >
            <SaveIcon size={16} />
            <span>{t('common.save')}</span>
          </Button>

          {/* Execute Button */}
          <Button
            className="query-toolbar-btn query-toolbar-btn-primary"
            minimal
            small
            onMouseDown={(e) => e.preventDefault()}
            onClick={onExecute}
            disabled={isExecuting || !isConnected}
            loading={isExecuting}
            title={t('queryToolbar.executeTitle')}
          >
            <PlayIcon size={16} />
            <span>{executeLabel || t('queryToolbar.execute')}</span>
          </Button>

          {/* Explain Button */}
          <Button
            className="query-toolbar-btn"
            minimal
            small
            onMouseDown={(e) => e.preventDefault()}
            onClick={onExplain}
            disabled={isExecuting || !isConnected}
            title={t('queryToolbar.explain')}
          >
            <SearchIcon size={16} />
            <span>{t('queryToolbar.explain')}</span>
          </Button>

          {/* Format Button */}
          <Button
            className="query-toolbar-btn"
            minimal
            small
            onClick={onFormat}
            title={t('queryToolbar.format')}
          >
            <FormatIcon size={16} />
            <span>{t('queryToolbar.format')}</span>
          </Button>

          {/* Snippets Dropdown */}
          <Popover
            position={Position.BOTTOM_LEFT}
            minimal
            content={
              <Menu>
                {SQL_SNIPPETS.map((snippet) => (
                  <MenuItem
                    key={snippet.label}
                    text={snippet.label}
                    onClick={() => onInsertSnippet(snippet.code)}
                  />
                ))}
              </Menu>
            }
          >
            <Button
              className="query-toolbar-btn"
              minimal
              small
              rightIcon="caret-down"
              title={t('queryToolbar.snippets')}
            >
              <span>{t('queryToolbar.snippets')}</span>
            </Button>
          </Popover>

          {/* Clear Button */}
          <Button
            className="query-toolbar-btn"
            minimal
            small
            onClick={onClear}
            title={t('queryToolbar.clear')}
          >
            <ClearIcon size={16} />
            <span>{t('queryToolbar.clear')}</span>
          </Button>
        </div>

        <Divider className="query-toolbar-divider" />

        <div className="query-toolbar-group">
          <span className="query-toolbar-label">{t('queryToolbar.transaction')}:</span>
          <Popover
            position={Position.BOTTOM_LEFT}
            minimal
            content={
              <Menu>
                <MenuItem
                  text={t('queryToolbar.autoCommit')}
                  active={autoCommit}
                  onClick={() => onTransactionModeChange('auto')}
                />
                <MenuItem
                  text={t('queryToolbar.manualCommit')}
                  active={!autoCommit}
                  onClick={() => onTransactionModeChange('manual')}
                />
              </Menu>
            }
          >
            <Button
              text={autoCommit ? t('queryToolbar.autoCommit') : t('queryToolbar.manualCommit')}
              rightIcon="caret-down"
              minimal
              small
              className="query-toolbar-dropdown"
              disabled={!isConnected}
            />
          </Popover>

          {/* Commit Button */}
          <Button
            className="query-toolbar-btn query-toolbar-btn-success"
            minimal
            small
            onClick={onCommit}
            disabled={autoCommit || !isConnected}
            title={t('queryToolbar.commit')}
          >
            <CheckIcon size={16} />
            <span>{t('queryToolbar.commit')}</span>
          </Button>

          {/* Rollback Button */}
          <Button
            className="query-toolbar-btn query-toolbar-btn-danger"
            minimal
            small
            onClick={onRollback}
            disabled={autoCommit || !isConnected}
            title={t('queryToolbar.rollback')}
          >
            <UndoIcon size={16} />
            <span>{t('queryToolbar.rollback')}</span>
          </Button>
        </div>
      </div>
    </div>
  );
};
