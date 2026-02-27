import React, { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, InputGroup, ProgressBar, Spinner } from '@blueprintjs/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { backupApi } from '../../hooks/useTauri';
import type {
  BackupOptions,
  BackupRequest,
  ConnectionProfile,
  IncrementalRequest,
  ScheduleRequest,
} from '../../types';
import '../../styles/backup-tab.css';

interface BackupTabProps {
  tabId: string;
  connectionProfile: ConnectionProfile;
  database: string;
}

const PREF_MYSQLDUMP_PATH = 'backup_mysqldump_path';
const PREF_MYSQLBINLOG_PATH = 'backup_mysqlbinlog_path';
const PREF_BINLOG_INDEX_PATH = 'backup_binlog_index_path';
const PREF_INCREMENTAL_OUTPUT_DIR = 'backup_incremental_output_dir';
const PREF_SCHEDULE_CRON = 'backup_schedule_cron';
const PREF_SCHEDULE_OUTPUT = 'backup_schedule_output';

const nowTimestamp = () => {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

export const BackupTab: React.FC<BackupTabProps> = ({
  tabId: _tabId,
  connectionProfile,
  database,
}) => {
  const { t } = useTranslation();
  const [mysqldumpPath, setMysqldumpPath] = useState('');
  const [rememberConfig, setRememberConfig] = useState(true);

  const [includeData, setIncludeData] = useState(true);
  const [includeViews, setIncludeViews] = useState(true);
  const [includeRoutines, setIncludeRoutines] = useState(false);
  const [addDropTable, setAddDropTable] = useState(true);

  const [mysqlbinlogPath, setMysqlbinlogPath] = useState('');
  const [binlogIndexPath, setBinlogIndexPath] = useState('');
  const [incrementalOutputDir, setIncrementalOutputDir] = useState('');

  const [scheduleCron, setScheduleCron] = useState('0 0 2 * * *');
  const [scheduleId, setScheduleId] = useState(`${connectionProfile.name}:${database}`);
  const [scheduleOutputPath, setScheduleOutputPath] = useState(`${database}_backup_{timestamp}.sql`);

  const [isBusy, setIsBusy] = useState(false);
  const [statusText, setStatusText] = useState(t('backup.ready'));
  const [logs, setLogs] = useState<string[]>([]);

  const subtitle = useMemo(
    () => t('backup.targetDatabase', { database, host: connectionProfile.host }),
    [database, connectionProfile.host, t],
  );

  const appendLog = (line: string) => {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs((prev) => [...prev, `[${timestamp}] ${line}`]);
  };

  useEffect(() => {
    const savedPath = localStorage.getItem(PREF_MYSQLDUMP_PATH);
    if (savedPath) {
      setMysqldumpPath(savedPath);
    }

    const savedBinlog = localStorage.getItem(PREF_MYSQLBINLOG_PATH);
    if (savedBinlog) {
      setMysqlbinlogPath(savedBinlog);
    }

    const savedIndexPath = localStorage.getItem(PREF_BINLOG_INDEX_PATH);
    if (savedIndexPath) {
      setBinlogIndexPath(savedIndexPath);
    }

    const savedOutputDir = localStorage.getItem(PREF_INCREMENTAL_OUTPUT_DIR);
    if (savedOutputDir) {
      setIncrementalOutputDir(savedOutputDir);
    }

    const savedCron = localStorage.getItem(PREF_SCHEDULE_CRON);
    if (savedCron) {
      setScheduleCron(savedCron);
    }

    const savedScheduleOutput = localStorage.getItem(PREF_SCHEDULE_OUTPUT);
    if (savedScheduleOutput) {
      setScheduleOutputPath(savedScheduleOutput);
    }
  }, []);

  const pickExecutablePath = async (title: string, setter: (val: string) => void) => {
    const selected = await open({
      title,
      multiple: false,
      directory: false,
      filters: [{ name: t('backup.executable'), extensions: ['exe'] }],
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }
    setter(selected);
  };

  const pickFilePath = async (title: string, setter: (val: string) => void, extensions: string[]) => {
    const selected = await open({
      title,
      multiple: false,
      directory: false,
      filters: [{ name: t('backup.file'), extensions }],
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }
    setter(selected);
  };

  const pickDirectoryPath = async (title: string, setter: (val: string) => void) => {
    const selected = await open({
      title,
      multiple: false,
      directory: true,
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }
    setter(selected);
  };

  const backupOptions: BackupOptions = {
    includeData,
    includeViews,
    includeRoutines,
    addDropTable,
  };

  const runBackup = async () => {
    if (!mysqldumpPath.trim()) {
      setStatusText(t('backup.error.missingMysqldump'));
      appendLog(t('backup.error.missingMysqldump'));
      return;
    }

    const outputPath = await save({
      title: t('backup.saveTitle'),
      defaultPath: `${database}_backup_${nowTimestamp()}.sql`,
      filters: [{ name: t('backup.sqlFile'), extensions: ['sql'] }],
      canCreateDirectories: true,
    });

    if (!outputPath) {
      appendLog(t('backup.cancelled'));
      return;
    }

    if (rememberConfig) {
      localStorage.setItem(PREF_MYSQLDUMP_PATH, mysqldumpPath);
    }

    const request: BackupRequest = {
      conn: connectionProfile,
      schema: database,
      mysqldumpPath,
      outputPath,
      options: backupOptions,
    };

    setIsBusy(true);
    setStatusText(t('backup.running'));
    appendLog(t('backup.start', { path: outputPath }));

    try {
      const result = await backupApi.execute(request);
      setStatusText(t('backup.success'));
      appendLog(t('backup.complete', { time: result.durationMs }));
      appendLog(t('backup.outputFile', { path: result.outputPath }));
    } catch (error) {
      setStatusText(t('backup.failed'));
      appendLog(t('backup.error.message', { error: String(error) }));
    } finally {
      setIsBusy(false);
    }
  };

  const runIncrementalBackup = async () => {
    if (!binlogIndexPath.trim()) {
      setStatusText(t('backup.error.missingBinlogIndex'));
      appendLog(t('backup.error.missingBinlogIndex'));
      return;
    }

    if (!incrementalOutputDir.trim()) {
      setStatusText(t('backup.error.missingOutputDir'));
      appendLog(t('backup.error.missingOutputDir'));
      return;
    }

    const request: IncrementalRequest = {
      conn: connectionProfile,
      schema: database,
      outputDir: incrementalOutputDir,
      binlogIndexPath,
      mysqlbinlogPath: mysqlbinlogPath.trim() || undefined,
    };

    localStorage.setItem(PREF_BINLOG_INDEX_PATH, binlogIndexPath);
    localStorage.setItem(PREF_INCREMENTAL_OUTPUT_DIR, incrementalOutputDir);
    if (mysqlbinlogPath.trim()) {
      localStorage.setItem(PREF_MYSQLBINLOG_PATH, mysqlbinlogPath);
    }

    setIsBusy(true);
    setStatusText(t('backup.incremental.running'));
    appendLog(t('backup.incremental.start'));

    try {
      const result = await backupApi.incremental(request);
      setStatusText(t('backup.incremental.success'));
      appendLog(t('backup.incremental.complete', { time: result.durationMs }));
      appendLog(t('backup.outputFile', { path: result.outputFile }));
    } catch (error) {
      setStatusText(t('backup.incremental.failed'));
      appendLog(t('backup.error.message', { error: String(error) }));
    } finally {
      setIsBusy(false);
    }
  };

  const runScheduleAdd = async () => {
    if (!scheduleCron.trim()) {
      setStatusText(t('backup.error.missingCron'));
      appendLog(t('backup.error.missingCron'));
      return;
    }
    if (!scheduleId.trim()) {
      setStatusText(t('backup.error.missingScheduleId'));
      appendLog(t('backup.error.missingScheduleId'));
      return;
    }
    if (!mysqldumpPath.trim()) {
      setStatusText(t('backup.error.missingMysqldump'));
      appendLog(t('backup.error.missingMysqldump'));
      return;
    }
    if (!scheduleOutputPath.trim()) {
      setStatusText(t('backup.error.missingOutputPath'));
      appendLog(t('backup.error.missingOutputPath'));
      return;
    }

    const req: ScheduleRequest = {
      scheduleId,
      cron: scheduleCron,
      backup: {
        conn: connectionProfile,
        schema: database,
        mysqldumpPath,
        outputPath: scheduleOutputPath,
        options: backupOptions,
      },
    };

    localStorage.setItem(PREF_SCHEDULE_CRON, scheduleCron);
    localStorage.setItem(PREF_SCHEDULE_OUTPUT, scheduleOutputPath);

    setIsBusy(true);
    setStatusText(t('backup.schedule.adding'));
    appendLog(t('backup.schedule.addingLog', { id: scheduleId }));

    try {
      await backupApi.scheduleAdd(req);
      setStatusText(t('backup.schedule.added'));
      appendLog(t('backup.schedule.addedLog', { id: scheduleId }));
    } catch (error) {
      setStatusText(t('backup.schedule.addFailed'));
      appendLog(t('backup.schedule.addFailedLog', { error: String(error) }));
    } finally {
      setIsBusy(false);
    }
  };

  const runScheduleRemove = async () => {
    if (!scheduleId.trim()) {
      setStatusText(t('backup.error.missingScheduleId'));
      appendLog(t('backup.error.missingScheduleId'));
      return;
    }

    setIsBusy(true);
    setStatusText(t('backup.schedule.removing'));
    appendLog(t('backup.schedule.removingLog', { id: scheduleId }));

    try {
      await backupApi.scheduleRemove(scheduleId);
      setStatusText(t('backup.schedule.removed'));
      appendLog(t('backup.schedule.removedLog', { id: scheduleId }));
    } catch (error) {
      setStatusText(t('backup.schedule.removeFailed'));
      appendLog(t('backup.schedule.removeFailedLog', { error: String(error) }));
    } finally {
      setIsBusy(false);
    }
  };

  const runScheduleList = async () => {
    setIsBusy(true);
    setStatusText(t('backup.schedule.listing'));
    appendLog(t('backup.schedule.listingLog'));

    try {
      const schedules = await backupApi.scheduleList();
      setStatusText(t('backup.schedule.listed'));
      appendLog(t('backup.schedule.listedLog', { count: schedules.length, schedules: schedules.length > 0 ? schedules.join(', ') : t('backup.empty') }));
    } catch (error) {
      setStatusText(t('backup.schedule.listFailed'));
      appendLog(t('backup.schedule.listFailedLog', { error: String(error) }));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="backup-tab">
      <div className="backup-tab-scroll">
        <div className="backup-header">
          <h2 className="backup-title">{t('backup.title')}</h2>
          <p className="backup-subtitle">{subtitle}</p>
        </div>

        <section className="backup-card">
          <h3 className="backup-card-title">{t('backup.basicConfig')}</h3>
          <div className="backup-form-grid">
            <label className="backup-label">mysqldump:</label>
            <InputGroup
              value={mysqldumpPath}
              onChange={(e) => setMysqldumpPath(e.target.value)}
              placeholder={t('backup.mysqldumpPlaceholder')}
            />
            <Button
              onClick={() => pickExecutablePath(t('backup.selectMysqldump'), setMysqldumpPath)}
              disabled={isBusy}
            >
              {t('backup.browse')}
            </Button>

            <div className="backup-label" />
            <Checkbox
              checked={rememberConfig}
              onChange={(e) => setRememberConfig((e.target as HTMLInputElement).checked)}
              label={t('backup.rememberConfig')}
            />
            <div />
          </div>
        </section>

        <section className="backup-card">
          <h3 className="backup-card-title">{t('backup.exportOptions')}</h3>
          <div className="backup-options-grid">
            <Checkbox
              checked={includeData}
              onChange={(e) => setIncludeData((e.target as HTMLInputElement).checked)}
              label={t('backup.includeData')}
            />
            <Checkbox
              checked={includeViews}
              onChange={(e) => setIncludeViews((e.target as HTMLInputElement).checked)}
              label={t('backup.includeViews')}
            />
            <Checkbox
              checked={includeRoutines}
              onChange={(e) => setIncludeRoutines((e.target as HTMLInputElement).checked)}
              label={t('backup.includeRoutines')}
            />
            <Checkbox
              checked={addDropTable}
              onChange={(e) => setAddDropTable((e.target as HTMLInputElement).checked)}
              label={t('backup.addDropTable')}
            />
          </div>
        </section>

        <section className="backup-card">
          <h3 className="backup-card-title">{t('backup.incrementalTitle')}</h3>
          <div className="backup-form-grid">
            <label className="backup-label">mysqlbinlog:</label>
            <InputGroup
              value={mysqlbinlogPath}
              onChange={(e) => setMysqlbinlogPath(e.target.value)}
              placeholder={t('backup.mysqlbinlogPlaceholder')}
            />
            <Button
              onClick={() => pickExecutablePath(t('backup.selectMysqlbinlog'), setMysqlbinlogPath)}
              disabled={isBusy}
            >
              {t('backup.browse')}
            </Button>

            <label className="backup-label">{t('backup.binlogIndex')}:</label>
            <InputGroup
              value={binlogIndexPath}
              onChange={(e) => setBinlogIndexPath(e.target.value)}
              placeholder={t('backup.binlogIndexPlaceholder')}
            />
            <Button
              onClick={() => pickFilePath(t('backup.selectBinlogIndex'), setBinlogIndexPath, ['index', 'txt'])}
              disabled={isBusy}
            >
              {t('backup.browse')}
            </Button>

            <label className="backup-label">{t('backup.outputDir')}:</label>
            <InputGroup
              value={incrementalOutputDir}
              onChange={(e) => setIncrementalOutputDir(e.target.value)}
              placeholder={t('backup.outputDirPlaceholder')}
            />
            <Button
              onClick={() => pickDirectoryPath(t('backup.selectOutputDir'), setIncrementalOutputDir)}
              disabled={isBusy}
            >
              {t('backup.browse')}
            </Button>
          </div>
          <div className="backup-inline-actions">
            <Button
              intent="success"
              onClick={runIncrementalBackup}
              disabled={isBusy}
            >
              {t('backup.startIncremental')}
            </Button>
          </div>
        </section>

        <section className="backup-card">
          <h3 className="backup-card-title">{t('backup.scheduleTitle')}</h3>
          <div className="backup-form-grid">
            <label className="backup-label">{t('backup.cronExpression')}:</label>
            <InputGroup
              value={scheduleCron}
              onChange={(e) => setScheduleCron(e.target.value)}
              placeholder={t('backup.cronPlaceholder')}
            />
            <div />

            <label className="backup-label">{t('backup.scheduleId')}:</label>
            <InputGroup
              value={scheduleId}
              onChange={(e) => setScheduleId(e.target.value)}
              placeholder={t('backup.scheduleIdPlaceholder')}
            />
            <div />

            <label className="backup-label">{t('backup.outputPath')}:</label>
            <InputGroup
              value={scheduleOutputPath}
              onChange={(e) => setScheduleOutputPath(e.target.value)}
              placeholder={t('backup.outputPathPlaceholder')}
            />
            <Button
              onClick={async () => {
                const selectedPath = await save({
                  title: t('backup.selectOutputFile'),
                  defaultPath: `${database}_backup_${nowTimestamp()}.sql`,
                  filters: [{ name: t('backup.sqlFile'), extensions: ['sql'] }],
                  canCreateDirectories: true,
                });
                if (selectedPath) {
                  setScheduleOutputPath(selectedPath);
                }
              }}
              disabled={isBusy}
            >
              {t('backup.browse')}
            </Button>
          </div>
          <div className="backup-inline-actions">
            <Button intent="primary" onClick={runScheduleAdd} disabled={isBusy}>{t('backup.addSchedule')}</Button>
            <Button intent="danger" onClick={runScheduleRemove} disabled={isBusy}>{t('backup.removeSchedule')}</Button>
            <Button onClick={runScheduleList} disabled={isBusy}>{t('backup.listSchedule')}</Button>
          </div>
        </section>

        <section className="backup-card backup-action-card">
          <div className="backup-main-actions">
            <Button intent="primary" large onClick={runBackup} disabled={isBusy}>{t('backup.start')}</Button>
            <div className="backup-status-line">
              {isBusy ? <Spinner size={18} /> : null}
              <span className="backup-status-text">{statusText}</span>
            </div>
          </div>
          <ProgressBar animate={isBusy} stripes={isBusy} value={isBusy ? undefined : 0} />
        </section>

        <section className="backup-card">
          <h3 className="backup-card-title">{t('backup.logs')}</h3>
          <div className="backup-log-box">
            {logs.length > 0 ? logs.join('\n') : t('backup.noLogs')}
          </div>
        </section>
      </div>
    </div>
  );
};
