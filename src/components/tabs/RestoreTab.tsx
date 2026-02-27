import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, HTMLSelect, InputGroup, ProgressBar, Radio, RadioGroup, Spinner } from '@blueprintjs/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { backupApi, metadataApi } from '../../hooks/useTauri';
import type { ConnectionProfile, RestoreRequest } from '../../types';
import '../../styles/restore-tab.css';

interface RestoreTabProps {
  tabId: string;
  connectionProfile: ConnectionProfile;
  initialDatabase?: string;
}

const PREF_MYSQL_PATH = 'restore_mysql_path';
const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

export const RestoreTab: React.FC<RestoreTabProps> = ({
  tabId: _tabId,
  connectionProfile,
  initialDatabase,
}) => {
  const { t, i18n } = useTranslation();
  const [mysqlPath, setMysqlPath] = useState('');
  const [rememberConfig, setRememberConfig] = useState(true);
  const [sqlScriptPath, setSqlScriptPath] = useState('');

  const [targetMode, setTargetMode] = useState<'existing' | 'new'>('existing');
  const [existingDatabases, setExistingDatabases] = useState<string[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState('');
  const [newDatabaseName, setNewDatabaseName] = useState(initialDatabase || '');

  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [statusText, setStatusText] = useState(t('restore.ready'));
  const [logs, setLogs] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const subtitle = useMemo(
    () => t('restore.targetConnection', { name: connectionProfile.name || t('restore.unnamedConnection'), host: connectionProfile.host }),
    [connectionProfile.name, connectionProfile.host, t],
  );

  const appendLog = (line: string) => {
    const timestamp = new Date().toLocaleTimeString(i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US', { hour12: false });
    setLogs((prev) => [...prev, `[${timestamp}] ${line}`]);
  };

  useEffect(() => {
    const savedPath = localStorage.getItem(PREF_MYSQL_PATH);
    if (savedPath) {
      setMysqlPath(savedPath);
    }
  }, []);

  const loadDatabases = async () => {
    setIsLoadingDatabases(true);
    try {
      const allDatabases = await metadataApi.listDatabases(connectionProfile);
      const userDatabases = allDatabases.filter((name) => !SYSTEM_DATABASES.has(name.toLowerCase()));
      setExistingDatabases(userDatabases);

      if (initialDatabase && userDatabases.includes(initialDatabase)) {
        setSelectedDatabase(initialDatabase);
      } else if (!selectedDatabase && userDatabases.length > 0) {
        setSelectedDatabase(userDatabases[0]);
      }
    } catch (error) {
      appendLog(t('restore.loadDatabasesFailed', { error: String(error) }));
    } finally {
      setIsLoadingDatabases(false);
    }
  };

  useEffect(() => {
    if (targetMode === 'existing') {
      loadDatabases();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMode]);

  const pickMysqlPath = async () => {
    const selected = await open({
      title: t('restore.selectMysql'),
      multiple: false,
      directory: false,
      filters: [{ name: t('restore.executable'), extensions: ['exe'] }],
    });
    if (!selected || Array.isArray(selected)) {
      return;
    }
    setMysqlPath(selected);
  };

  const pickSqlFile = async () => {
    const selected = await open({
      title: t('restore.selectSqlFile'),
      multiple: false,
      directory: false,
      filters: [{ name: t('restore.sqlFile'), extensions: ['sql'] }],
    });
    if (!selected || Array.isArray(selected)) {
      return;
    }
    setSqlScriptPath(selected);
  };

  const validateRestore = () => {
    if (!mysqlPath.trim()) {
      setStatusText(t('restore.error.missingMysql'));
      appendLog(t('restore.error.missingMysqlLog'));
      return false;
    }
    if (!sqlScriptPath.trim()) {
      setStatusText(t('restore.error.missingSql'));
      appendLog(t('restore.error.missingSqlLog'));
      return false;
    }

    if (targetMode === 'existing') {
      if (!selectedDatabase.trim()) {
        setStatusText(t('restore.error.missingDatabase'));
        appendLog(t('restore.error.missingDatabaseLog'));
        return false;
      }
      setConfirmOpen(true);
      return false;
    }

    if (!newDatabaseName.trim()) {
      setStatusText(t('restore.error.missingNewDatabase'));
      appendLog(t('restore.error.missingNewDatabaseLog'));
      return false;
    }

    return true;
  };

  const executeRestore = async () => {
    const targetSchema = targetMode === 'existing' ? selectedDatabase : newDatabaseName.trim();
    const createSchema = targetMode === 'new';

    const request: RestoreRequest = {
      conn: connectionProfile,
      targetSchema,
      mysqlPath,
      inputPath: sqlScriptPath,
      createSchema,
    };

    if (rememberConfig) {
      localStorage.setItem(PREF_MYSQL_PATH, mysqlPath);
    }

    setIsBusy(true);
    setStatusText(t('restore.running'));
    setLogs([]);
    appendLog(t('restore.preparing'));
    appendLog(t('restore.sqlScript', { path: sqlScriptPath }));
    appendLog(t('restore.targetSchema', { schema: targetSchema }));

    try {
      const result = await backupApi.restore(request);
      setStatusText(t('restore.success'));
      appendLog(t('restore.complete', { time: result.durationMs }));
    } catch (error) {
      setStatusText(t('restore.failed'));
      appendLog(t('restore.failedLog', { error: String(error) }));
    } finally {
      setIsBusy(false);
    }
  };

  const runRestore = async () => {
    if (!validateRestore()) {
      return;
    }
    await executeRestore();
  };

  return (
    <div className="restore-tab">
      <div className="restore-tab-scroll">
        <div className="restore-header">
          <h2 className="restore-title">{t('restore.title')}</h2>
          <p className="restore-subtitle">{subtitle}</p>
        </div>

        <section className="restore-card">
          <h3 className="restore-card-title">{t('restore.basicConfig')}</h3>
          <div className="restore-form-grid">
            <label className="restore-label">mysql:</label>
            <InputGroup
              value={mysqlPath}
              onChange={(e) => setMysqlPath(e.target.value)}
              placeholder={t('restore.mysqlPlaceholder')}
            />
            <Button onClick={pickMysqlPath} disabled={isBusy}>{t('restore.browse')}</Button>

            <div className="restore-label" />
            <label className="restore-check-label">
              <input
                type="checkbox"
                checked={rememberConfig}
                onChange={(e) => setRememberConfig(e.target.checked)}
              />
              <span>{t('restore.rememberConfig')}</span>
            </label>
            <div />
          </div>
        </section>

        <section className="restore-card">
          <h3 className="restore-card-title">{t('restore.sqlScript')}</h3>
          <div className="restore-form-grid">
            <label className="restore-label">{t('restore.sqlScriptPath')}:</label>
            <InputGroup
              value={sqlScriptPath}
              onChange={(e) => setSqlScriptPath(e.target.value)}
              placeholder={t('restore.sqlScriptPlaceholder')}
            />
            <Button onClick={pickSqlFile} disabled={isBusy}>{t('restore.browse')}</Button>
          </div>
        </section>

        <section className="restore-card">
          <h3 className="restore-card-title">{t('restore.targetDatabase')}</h3>

          <RadioGroup
            selectedValue={targetMode}
            onChange={(e) => setTargetMode((e.target as HTMLInputElement).value as 'existing' | 'new')}
            className="restore-radio-group"
          >
            <Radio value="existing" label={t('restore.restoreToExisting')} />
            <Radio value="new" label={t('restore.restoreToNew')} />
          </RadioGroup>

          {targetMode === 'existing' ? (
            <div className="restore-form-grid">
              <label className="restore-label">{t('restore.selectDatabase')}:</label>
              <HTMLSelect
                value={selectedDatabase}
                onChange={(e) => setSelectedDatabase(e.target.value)}
                fill
                options={
                  existingDatabases.length > 0
                    ? existingDatabases
                    : [{ label: isLoadingDatabases ? t('restore.loading') : t('restore.noDatabases'), value: '' }]
                }
                disabled={isBusy || isLoadingDatabases || existingDatabases.length === 0}
              />
              <Button onClick={loadDatabases} disabled={isBusy || isLoadingDatabases}>
                {isLoadingDatabases ? t('restore.loading') : t('restore.refresh')}
              </Button>
            </div>
          ) : (
            <div className="restore-form-grid">
              <label className="restore-label">{t('restore.newDatabaseName')}:</label>
              <InputGroup
                value={newDatabaseName}
                onChange={(e) => setNewDatabaseName(e.target.value)}
                placeholder={t('restore.newDatabasePlaceholder')}
                disabled={isBusy}
              />
              <div />
            </div>
          )}
        </section>

        <section className="restore-card restore-action-card">
          <div className="restore-main-actions">
            <Button intent="primary" large onClick={runRestore} disabled={isBusy}>
              {t('restore.start')}
            </Button>
            <div className="restore-status-line">
              {isBusy ? <Spinner size={18} /> : null}
              <span className="restore-status-text">{statusText}</span>
            </div>
          </div>
          <ProgressBar animate={isBusy} stripes={isBusy} value={isBusy ? undefined : 0} />
        </section>

        <section className="restore-card">
          <h3 className="restore-card-title">{t('restore.logs')}</h3>
          <div className="restore-log-box">
            {logs.length > 0 ? logs.join('\n') : t('restore.noLogs')}
          </div>
        </section>
      </div>

      <Alert
        isOpen={confirmOpen}
        intent="warning"
        cancelButtonText={t('restore.cancel')}
        confirmButtonText={t('restore.confirmRestore')}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false);
          await executeRestore();
        }}
      >
        <p>{t('restore.confirmOverwrite', { database: selectedDatabase })}</p>
        <p>{t('restore.confirmWarning')}</p>
      </Alert>
    </div>
  );
};
