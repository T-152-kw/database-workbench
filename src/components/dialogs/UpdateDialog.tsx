import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  Button,
  ProgressBar,
  Classes,
  Callout,
  Spinner,
} from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import { UpdaterService, type UpdateInfo, type DownloadProgress } from '../../services/updaterService';
import { useAppStore } from '../../stores';
import '../../styles/update-dialog.css';

interface UpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isManualCheck?: boolean;
}

type UpdateStatus = 'checking' | 'available' | 'notAvailable' | 'downloading' | 'ready' | 'error';

export const UpdateDialog: React.FC<UpdateDialogProps> = ({
  isOpen,
  onClose,
  isManualCheck = false,
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus>('checking');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { updateAvailable, updateVersion, dismissUpdate, setUpdateAvailable } = useAppStore();

  const checkForUpdate = useCallback(async () => {
    setStatus('checking');
    setErrorMessage(null);
    setUpdateInfo(null);
    setProgress(null);

    try {
      const info = await UpdaterService.checkForUpdate();
      if (info) {
        setUpdateInfo(info);
        if (info.available) {
          setStatus('available');
          setUpdateAvailable(true, info.version);
        } else {
          setStatus('notAvailable');
        }
      } else {
        setStatus('error');
        setErrorMessage(t('update.checkFailed', '检查更新失败'));
      }
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : t('update.unknownError', '未知错误'));
    }
  }, [t, setUpdateAvailable]);

  useEffect(() => {
    if (isOpen) {
      if (isManualCheck) {
        checkForUpdate();
      } else if (updateAvailable && updateVersion) {
        setUpdateInfo({
          available: true,
          version: updateVersion,
        });
        setStatus('available');
      } else {
        checkForUpdate();
      }
    }
  }, [isOpen, isManualCheck, updateAvailable, updateVersion, checkForUpdate]);

  const handleDownload = async () => {
    setStatus('downloading');
    setProgress(null);
    setErrorMessage(null);

    try {
      const result = await UpdaterService.downloadAndInstall((p) => {
        setProgress(p);
      });

      if (result.success) {
        setStatus('ready');
      } else {
        setStatus('error');
        setErrorMessage(result.error || t('update.downloadFailed', '下载更新失败'));
      }
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : t('update.unknownError', '未知错误'));
    }
  };

  const handleRestart = async () => {
    try {
      await UpdaterService.relaunchApp();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('update.restartFailed', '重启失败'));
    }
  };

  const handleClose = () => {
    if (status === 'available' && updateInfo?.available) {
      dismissUpdate();
    }
    onClose();
  };

  const renderContent = () => {
    switch (status) {
      case 'checking':
        return (
          <div className="update-checking">
            <Spinner size={32} />
            <p>{t('update.checking', '正在检查更新...')}</p>
          </div>
        );

      case 'notAvailable':
        return (
          <div className="update-not-available">
            <Callout intent="success" icon="tick-circle">
              {t('update.upToDate', '您使用的是最新版本')}
            </Callout>
          </div>
        );

      case 'available':
        return (
          <div className="update-available">
            <Callout intent="primary" icon="download">
              <p className="update-version-info">
                {t('update.newVersionAvailable', '发现新版本 {{version}}', { version: updateInfo?.version })}
              </p>
              {updateInfo?.date && (
                <p className="update-date">
                  {t('update.releaseDate', '发布日期')}: {new Date(updateInfo.date).toLocaleDateString()}
                </p>
              )}
            </Callout>
            {updateInfo?.body && (
              <div className="update-notes">
                <h4>{t('update.releaseNotes', '更新说明')}</h4>
                <div className="update-notes-content">
                  {updateInfo.body.split('\n').map((line, index) => (
                    <p key={index}>{line}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case 'downloading':
        return (
          <div className="update-downloading">
            <p>{t('update.downloading', '正在下载更新...')}</p>
            <ProgressBar
              value={progress ? progress.percentage / 100 : 0}
              animate={!progress}
              stripes
            />
            {progress && (
              <p className="update-progress-text">
                {progress.percentage}% ({formatBytes(progress.downloaded)} / {formatBytes(progress.total)})
              </p>
            )}
          </div>
        );

      case 'ready':
        return (
          <div className="update-ready">
            <Callout intent="success" icon="tick-circle">
              {t('update.readyToInstall', '更新已下载完成，点击"重启"按钮安装更新')}
            </Callout>
          </div>
        );

      case 'error':
        return (
          <div className="update-error">
            <Callout intent="danger" icon="error">
              {errorMessage || t('update.unknownError', '未知错误')}
            </Callout>
          </div>
        );

      default:
        return null;
    }
  };

  const renderFooter = () => {
    const actions = [];

    if (status === 'notAvailable' || status === 'error') {
      actions.push(
        <Button key="retry" onClick={checkForUpdate}>
          {t('update.retry', '重试')}
        </Button>
      );
    }

    if (status === 'available') {
      actions.push(
        <Button key="download" intent="primary" onClick={handleDownload}>
          {t('update.download', '下载更新')}
        </Button>
      );
    }

    if (status === 'ready') {
      actions.push(
        <Button key="restart" intent="primary" onClick={handleRestart}>
          {t('update.restart', '重启')}
        </Button>
      );
    }

    actions.push(
      <Button
        key="close"
        onClick={handleClose}
        disabled={status === 'downloading'}
      >
        {status === 'downloading' ? t('update.downloading', '下载中...') : t('common.close', '关闭')}
      </Button>
    );

    return <div className={Classes.DIALOG_FOOTER_ACTIONS}>{actions}</div>;
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={status === 'downloading' ? undefined : handleClose}
      title={t('update.title', '检查更新')}
      icon="automatic-updates"
      className="update-dialog"
      canEscapeKeyClose={status !== 'downloading'}
      canOutsideClickClose={status !== 'downloading'}
    >
      <div className={Classes.DIALOG_BODY}>
        {renderContent()}
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        {renderFooter()}
      </div>
    </Dialog>
  );
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
