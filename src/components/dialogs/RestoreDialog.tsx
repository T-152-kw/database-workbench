import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Callout,
  Checkbox,
  Classes,
  Dialog,
  FormGroup,
  HTMLSelect,
  InputGroup,
  Intent,
  Spinner,
} from '@blueprintjs/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { backupApi, metadataApi } from '../../hooks/useTauri';
import type { ConnectionProfile, RestoreRequest } from '../../types';
import '../../styles/backup-restore-dialog.css';

interface RestoreDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connectionProfile?: ConnectionProfile;
  initialDatabase?: string;
}

const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

export const RestoreDialog: React.FC<RestoreDialogProps> = ({
  isOpen,
  onClose,
  connectionProfile,
  initialDatabase,
}) => {
  const { t, i18n } = useTranslation();
  const [sqlScriptPath, setSqlScriptPath] = useState('');
  const [targetMode, setTargetMode] = useState<'existing' | 'new'>('existing');
  const [selectedDatabase, setSelectedDatabase] = useState('');
  const [newDatabaseName, setNewDatabaseName] = useState(initialDatabase || '');

  const [useTransaction, setUseTransaction] = useState(true);
  const [continueOnError, setContinueOnError] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [existingDatabases, setExistingDatabases] = useState<string[]>([]);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  const subtitle = useMemo(() => {
    if (!connectionProfile) {
      return t('restoreDialog.noTarget');
    }
    return t('restoreDialog.target', {
      name: connectionProfile.name || t('restoreDialog.unnamedConnection'),
      host: connectionProfile.host,
    });
  }, [connectionProfile, t]);

  const appendLog = (line: string) => {
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
    const timestamp = new Date().toLocaleTimeString(locale, { hour12: false });
    setLogs((prev) => [...prev, `[${timestamp}] ${line}`]);
  };

  const loadDatabases = async () => {
    if (!connectionProfile) {
      return;
    }

    setLoadingDatabases(true);
    try {
      const allDatabases = await metadataApi.listDatabases(connectionProfile);
      const userDatabases = allDatabases.filter((name) => !SYSTEM_DATABASES.has(name.toLowerCase()));
      setExistingDatabases(userDatabases);
      if (initialDatabase && userDatabases.includes(initialDatabase)) {
        setSelectedDatabase(initialDatabase);
      } else if (userDatabases.length > 0) {
        setSelectedDatabase(userDatabases[0]);
      }
    } catch (error) {
      appendLog(t('restoreDialog.loadDatabasesFailed', { error: String(error) }));
    } finally {
      setLoadingDatabases(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSqlScriptPath('');
    setTargetMode('existing');
    setStatusText(t('restoreDialog.ready'));
    setLogs([]);
    setNewDatabaseName(initialDatabase || '');
    void loadDatabases();
  }, [isOpen, connectionProfile, initialDatabase, t]);

  const pickSqlFile = async () => {
    const selected = await open({
      title: t('restoreDialog.selectSqlFile'),
      multiple: false,
      directory: false,
      filters: [{ name: 'SQL', extensions: ['sql', 'gz'] }],
    });
    if (!selected || Array.isArray(selected)) {
      return;
    }
    setSqlScriptPath(selected);
  };

  const executeRestore = async () => {
    if (!connectionProfile) {
      return;
    }
    const targetSchema = targetMode === 'existing' ? selectedDatabase : newDatabaseName.trim();
    const createSchema = targetMode === 'new';

    const request: RestoreRequest = {
      conn: connectionProfile,
      targetSchema,
      inputPath: sqlScriptPath,
      createSchema,
      continueOnError,
      useTransaction,
    };

    setIsBusy(true);
    setStatusText(t('restoreDialog.running'));
    setLogs([]);
    appendLog(t('restoreDialog.preparing'));
    appendLog(t('restoreDialog.script', { path: sqlScriptPath }));

    try {
      const result = await backupApi.restore(request);
      setStatusText(t('restoreDialog.success'));
      appendLog(t('restoreDialog.done', { time: result.durationMs }));
    } catch (error) {
      setStatusText(t('restoreDialog.failed'));
      appendLog(t('restoreDialog.error', { error: String(error) }));
    } finally {
      setIsBusy(false);
    }
  };

  const runRestore = async () => {
    if (!sqlScriptPath.trim()) {
      setStatusText(t('restoreDialog.missingSql'));
      return;
    }

    if (targetMode === 'existing') {
      if (!selectedDatabase.trim()) {
        setStatusText(t('restoreDialog.missingDatabase'));
        return;
      }
      setConfirmOpen(true);
      return;
    }

    if (!newDatabaseName.trim()) {
      setStatusText(t('restoreDialog.missingNewDatabase'));
      return;
    }

    await executeRestore();
  };

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title={t('restoreDialog.title')}
        icon="import"
        className="backup-restore-dialog"
        style={{ width: 1020, maxWidth: '96vw', maxHeight: '92vh' }}
      >
        <div className={Classes.DIALOG_BODY}>
          <div className="brd-subtitle">{subtitle}</div>

          {!connectionProfile ? (
            <Callout intent={Intent.WARNING}>{t('restoreDialog.missingContext')}</Callout>
          ) : (
            <>
              <section className="brd-section">
                <h3>{t('restoreDialog.scriptTitle')}</h3>
                <div className="brd-input-row">
                  <InputGroup
                    value={sqlScriptPath}
                    onChange={(e) => setSqlScriptPath(e.target.value)}
                    placeholder={t('restoreDialog.scriptPlaceholder')}
                  />
                  <Button onClick={pickSqlFile} disabled={isBusy}>{t('restore.browse')}</Button>
                </div>
              </section>

              <section className="brd-section">
                <h3>{t('restoreDialog.targetTitle')}</h3>
                <div className="brd-options-grid">
                  <Checkbox
                    checked={targetMode === 'existing'}
                    onChange={() => setTargetMode('existing')}
                    label={t('restoreDialog.restoreToExisting')}
                  />
                  <Checkbox
                    checked={targetMode === 'new'}
                    onChange={() => setTargetMode('new')}
                    label={t('restoreDialog.restoreToNew')}
                  />
                </div>

                {targetMode === 'existing' ? (
                  <FormGroup label={t('restoreDialog.selectDatabase')}>
                    <div className="brd-input-row">
                      <HTMLSelect
                        fill
                        value={selectedDatabase}
                        onChange={(e) => setSelectedDatabase(e.target.value)}
                        disabled={loadingDatabases || existingDatabases.length === 0}
                        options={
                          existingDatabases.length > 0
                            ? existingDatabases
                            : [{ label: loadingDatabases ? t('common.loading') : t('restoreDialog.noDatabases'), value: '' }]
                        }
                      />
                      <Button
                        className="brd-refresh-btn"
                        onClick={loadDatabases}
                        disabled={loadingDatabases || isBusy}
                      >
                        {loadingDatabases ? <Spinner size={14} /> : t('common.refresh')}
                      </Button>
                    </div>
                  </FormGroup>
                ) : (
                  <FormGroup label={t('restoreDialog.newDatabaseName')}>
                    <InputGroup
                      value={newDatabaseName}
                      onChange={(e) => setNewDatabaseName(e.target.value)}
                      placeholder={t('restoreDialog.newDatabasePlaceholder')}
                    />
                  </FormGroup>
                )}
              </section>

              <section className="brd-section">
                <h3>{t('restoreDialog.optionsTitle')}</h3>
                <div className="brd-options-grid">
                  <Checkbox checked={useTransaction} onChange={(e) => setUseTransaction((e.target as HTMLInputElement).checked)} label={t('restoreDialog.useTransaction')} />
                  <Checkbox checked={continueOnError} onChange={(e) => setContinueOnError((e.target as HTMLInputElement).checked)} label={t('restoreDialog.continueOnError')} />
                </div>
              </section>

              <section className="brd-section">
                <h3>{t('restoreDialog.logs')}</h3>
                <div className="brd-log-box">{logs.length > 0 ? logs.join('\n') : t('restoreDialog.noLogs')}</div>
              </section>
            </>
          )}
        </div>

        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <span className="brd-status">{statusText}</span>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button intent={Intent.PRIMARY} loading={isBusy} onClick={runRestore} disabled={!connectionProfile}>
              {t('restoreDialog.start')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Alert
        isOpen={confirmOpen}
        intent="warning"
        cancelButtonText={t('common.cancel')}
        confirmButtonText={t('restoreDialog.confirmRestore')}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false);
          await executeRestore();
        }}
      >
        <p>{t('restoreDialog.confirmOverwrite', { database: selectedDatabase })}</p>
        <p>{t('restoreDialog.confirmWarning')}</p>
      </Alert>
    </>
  );
};
