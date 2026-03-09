import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Callout,
  Checkbox,
  Classes,
  Dialog,
  Divider,
  FormGroup,
  HTMLSelect,
  InputGroup,
  Intent,
  Spinner,
  Tag,
} from '@blueprintjs/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { backupApi, metadataApi } from '../../hooks/useTauri';
import type { BackupRequest, ConnectionProfile } from '../../types';
import '../../styles/backup-restore-dialog.css';

interface BackupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connectionProfile?: ConnectionProfile;
  database?: string;
}

const nowTimestamp = () => {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

export const BackupDialog: React.FC<BackupDialogProps> = ({
  isOpen,
  onClose,
  connectionProfile,
  database,
}) => {
  const { t, i18n } = useTranslation();
  const [outputPath, setOutputPath] = useState('');
  const [includeStructure, setIncludeStructure] = useState(true);
  const [includeData, setIncludeData] = useState(true);
  const [includeViews, setIncludeViews] = useState(true);
  const [includeRoutines, setIncludeRoutines] = useState(true);
  const [includeTriggers, setIncludeTriggers] = useState(true);
  const [addDropTable, setAddDropTable] = useState(true);
  const [useTransaction, setUseTransaction] = useState(true);
  const [compressOutput, setCompressOutput] = useState(false);
  const [compressionLevel, setCompressionLevel] = useState(6);
  const [insertBatchSize, setInsertBatchSize] = useState(300);

  const [tables, setTables] = useState<string[]>([]);
  const [views, setViews] = useState<string[]>([]);
  const [routines, setRoutines] = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [selectedViews, setSelectedViews] = useState<string[]>([]);
  const [selectedRoutines, setSelectedRoutines] = useState<string[]>([]);

  const [loadingObjects, setLoadingObjects] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  const targetDb = database || connectionProfile?.database || '';

  const subtitle = useMemo(() => {
    if (!connectionProfile || !targetDb) {
      return t('backupDialog.noTarget');
    }
    return t('backupDialog.target', {
      database: targetDb,
      host: connectionProfile.host,
    });
  }, [connectionProfile, targetDb, t]);

  const appendLog = (line: string) => {
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
    const timestamp = new Date().toLocaleTimeString(locale, { hour12: false });
    setLogs((prev) => [...prev, `[${timestamp}] ${line}`]);
  };

  const loadObjects = async () => {
    if (!connectionProfile || !targetDb) {
      return;
    }

    setLoadingObjects(true);
    try {
      const [tableList, viewList, routineList] = await Promise.all([
        metadataApi.listTables(connectionProfile, targetDb),
        metadataApi.listViews(connectionProfile, targetDb),
        metadataApi.listRoutinesWithDetails(connectionProfile, targetDb),
      ]);
      setTables(tableList);
      setViews(viewList);
      setRoutines(routineList.map((item) => item.name));
      setSelectedTables(tableList);
      setSelectedViews(viewList);
      setSelectedRoutines(routineList.map((item) => item.name));
    } catch (error) {
      appendLog(t('backupDialog.loadObjectsFailed', { error: String(error) }));
    } finally {
      setLoadingObjects(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setOutputPath('');
    setStatusText(t('backupDialog.ready'));
    setLogs([]);
    void loadObjects();
  }, [isOpen, connectionProfile, targetDb, t]);

  const pickOutput = async () => {
    const selected = await save({
      title: t('backupDialog.selectOutput'),
      defaultPath: `${targetDb || 'database'}_backup_${nowTimestamp()}.sql`,
      filters: [{ name: 'SQL', extensions: ['sql', 'gz'] }],
      canCreateDirectories: true,
    });

    if (!selected) {
      return;
    }

    setOutputPath(selected);
  };

  const toggleSelection = (name: string, current: string[], set: (next: string[]) => void) => {
    if (current.includes(name)) {
      set(current.filter((item) => item !== name));
      return;
    }
    set([...current, name]);
  };

  const runBackup = async () => {
    if (!connectionProfile || !targetDb) {
      return;
    }
    if (!outputPath.trim()) {
      setStatusText(t('backupDialog.missingOutput'));
      return;
    }

    const request: BackupRequest = {
      conn: connectionProfile,
      schema: targetDb,
      outputPath,
      selectedTables,
      selectedViews,
      selectedRoutines,
      options: {
        includeStructure,
        includeData,
        includeViews,
        includeRoutines,
        includeTriggers,
        addDropTable,
        useTransaction,
        compressOutput,
        compressionLevel,
        insertBatchSize,
      },
    };

    setIsBusy(true);
    setStatusText(t('backupDialog.running'));
    setLogs([]);
    appendLog(t('backupDialog.starting', { path: outputPath }));

    try {
      const result = await backupApi.execute(request);
      setStatusText(t('backupDialog.success'));
      appendLog(t('backupDialog.done', { time: result.durationMs }));
      appendLog(t('backupDialog.output', { path: result.outputPath }));
    } catch (error) {
      setStatusText(t('backupDialog.failed'));
      appendLog(t('backupDialog.error', { error: String(error) }));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('backupDialog.title')}
      icon="database"
      className="backup-restore-dialog"
      style={{ width: 1180, maxWidth: '96vw', maxHeight: '92vh' }}
    >
      <div className={Classes.DIALOG_BODY}>
        <div className="brd-subtitle">{subtitle}</div>

        {!connectionProfile || !targetDb ? (
          <Callout intent={Intent.WARNING}>{t('backupDialog.missingContext')}</Callout>
        ) : (
          <>
            <section className="brd-section">
              <div className="brd-section-title-row">
                <h3>{t('backupDialog.outputTitle')}</h3>
                <Tag minimal>{targetDb}</Tag>
              </div>
              <div className="brd-input-row">
                <InputGroup
                  value={outputPath}
                  onChange={(e) => setOutputPath(e.target.value)}
                  placeholder={t('backupDialog.outputPlaceholder')}
                />
                <Button onClick={pickOutput} disabled={isBusy}>{t('backup.browse')}</Button>
              </div>
            </section>

            <section className="brd-section">
              <h3>{t('backupDialog.objectsTitle')}</h3>
              <div className="brd-object-toolbar">
                <Button onClick={() => setSelectedTables(tables)} small>{t('backupDialog.selectAllTables')}</Button>
                <Button onClick={() => setSelectedTables([])} small>{t('backupDialog.clearTables')}</Button>
                <Button className="brd-refresh-btn" onClick={loadObjects} small disabled={loadingObjects || isBusy}>
                  {loadingObjects ? <Spinner size={14} /> : t('common.refresh')}
                </Button>
              </div>
              <div className="brd-object-grid">
                <div className="brd-object-panel">
                  <div className="brd-object-title">{t('backupDialog.tables')}</div>
                  <div className="brd-object-list">
                    {tables.map((name) => (
                      <Checkbox
                        key={name}
                        checked={selectedTables.includes(name)}
                        onChange={() => toggleSelection(name, selectedTables, setSelectedTables)}
                        label={name}
                      />
                    ))}
                  </div>
                </div>
                <div className="brd-object-panel">
                  <div className="brd-object-title">{t('backupDialog.views')}</div>
                  <div className="brd-object-list">
                    {views.map((name) => (
                      <Checkbox
                        key={name}
                        checked={selectedViews.includes(name)}
                        onChange={() => toggleSelection(name, selectedViews, setSelectedViews)}
                        label={name}
                        disabled={!includeViews}
                      />
                    ))}
                  </div>
                </div>
                <div className="brd-object-panel">
                  <div className="brd-object-title">{t('backupDialog.routines')}</div>
                  <div className="brd-object-list">
                    {routines.map((name) => (
                      <Checkbox
                        key={name}
                        checked={selectedRoutines.includes(name)}
                        onChange={() => toggleSelection(name, selectedRoutines, setSelectedRoutines)}
                        label={name}
                        disabled={!includeRoutines}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="brd-section">
              <h3>{t('backupDialog.optionsTitle')}</h3>
              <div className="brd-options-grid">
                <Checkbox checked={includeStructure} onChange={(e) => setIncludeStructure((e.target as HTMLInputElement).checked)} label={t('backupDialog.includeStructure')} />
                <Checkbox checked={includeData} onChange={(e) => setIncludeData((e.target as HTMLInputElement).checked)} label={t('backupDialog.includeData')} />
                <Checkbox checked={includeViews} onChange={(e) => setIncludeViews((e.target as HTMLInputElement).checked)} label={t('backupDialog.includeViews')} />
                <Checkbox checked={includeRoutines} onChange={(e) => setIncludeRoutines((e.target as HTMLInputElement).checked)} label={t('backupDialog.includeRoutines')} />
                <Checkbox checked={includeTriggers} onChange={(e) => setIncludeTriggers((e.target as HTMLInputElement).checked)} label={t('backupDialog.includeTriggers')} />
                <Checkbox checked={addDropTable} onChange={(e) => setAddDropTable((e.target as HTMLInputElement).checked)} label={t('backupDialog.addDrop')} />
                <Checkbox checked={useTransaction} onChange={(e) => setUseTransaction((e.target as HTMLInputElement).checked)} label={t('backupDialog.transaction')} />
                <Checkbox checked={compressOutput} onChange={(e) => setCompressOutput((e.target as HTMLInputElement).checked)} label={t('backupDialog.compress')} />
              </div>

              <div className="brd-advanced-row">
                <FormGroup label={t('backupDialog.compressionLevel')} inline>
                  <HTMLSelect
                    value={compressionLevel}
                    onChange={(e) => setCompressionLevel(Number(e.target.value))}
                    disabled={!compressOutput}
                    options={Array.from({ length: 10 }, (_, i) => ({ label: `${i}`, value: i }))}
                  />
                </FormGroup>
                <FormGroup label={t('backupDialog.batchSize')} inline>
                  <InputGroup
                    value={String(insertBatchSize)}
                    onChange={(e) => setInsertBatchSize(Math.max(1, Number(e.target.value) || 1))}
                  />
                </FormGroup>
              </div>
            </section>

            <section className="brd-section">
              <h3>{t('backupDialog.logs')}</h3>
              <div className="brd-log-box">{logs.length > 0 ? logs.join('\n') : t('backupDialog.noLogs')}</div>
            </section>
          </>
        )}
      </div>

      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <span className="brd-status">{statusText}</span>
          <Divider />
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            intent={Intent.PRIMARY}
            loading={isBusy}
            onClick={runBackup}
            disabled={!connectionProfile || !targetDb}
          >
            {t('backupDialog.start')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
