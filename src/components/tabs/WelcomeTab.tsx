import React, { useState, useEffect } from 'react';
import { Icon } from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import { useTabStore, useAppStore, useConnectionStore } from '../../stores';
import { open } from '@tauri-apps/plugin-dialog';
import logoImage from '../../assets/Database Workbench.png';
import '../../styles/welcome-tab.css';

// 最近文件项
interface RecentFile {
  path: string;
  name: string;
  lastOpened: number;
}

export const WelcomeTab: React.FC = () => {
  const { theme, setStatusMessage } = useAppStore();
  const { t, i18n } = useTranslation();
  const { addTab } = useTabStore();
  const { connections, activeConnectionId, activeDatabase } = useConnectionStore();
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);

  // 获取当前活动连接
  const activeConnection = connections.find(c => c.profile.name === activeConnectionId);

  // 加载最近文件
  useEffect(() => {
    const saved = localStorage.getItem('dbw-recent-files');
    if (saved) {
      try {
        const files = JSON.parse(saved);
        setRecentFiles(files.slice(0, 6));
      } catch {
        // 忽略解析错误
      }
    }
  }, []);

  // 新建连接
  const handleNewConnection = () => {
    window.dispatchEvent(new CustomEvent('dbw:new-connection'));
    setStatusMessage(t('welcomeTab.status.openNewConnection'));
  };

  // 新建查询
  const handleNewQuery = () => {
    addTab({
      type: 'query',
      title: t('welcomeTab.newQuery'),
      isModified: false,
      connectionId: activeConnection?.profile.name,
      connectionProfile: activeConnection?.profile,
      database: activeDatabase || undefined,
    });
    setStatusMessage(t('welcomeTab.status.newQuery'));
  };

  // 打开SQL文件
  const handleOpenFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: t('welcomeTab.sqlFiles'), extensions: ['sql'] },
          { name: t('welcomeTab.allFiles'), extensions: ['*'] },
        ],
      });
      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[/\\]/).pop() || t('welcomeTab.untitled');

        addTab({
          type: 'query',
          title: fileName,
          isModified: false,
          sqlFilePath: selected,
          connectionId: activeConnection?.profile.name,
          connectionProfile: activeConnection?.profile,
          database: activeDatabase || undefined,
        });
        setStatusMessage(t('welcomeTab.status.openFile', { name: fileName }));
        addToRecentFiles(selected, fileName);
      }
    } catch (error) {
      setStatusMessage(t('welcomeTab.status.openFileFailed', { error: String(error) }));
    }
  };

  // 添加到最近文件
  const addToRecentFiles = (path: string, name: string) => {
    const newFile: RecentFile = {
      path,
      name,
      lastOpened: Date.now(),
    };
    setRecentFiles(prev => {
      const filtered = prev.filter(f => f.path !== path);
      const updated = [newFile, ...filtered].slice(0, 8);
      localStorage.setItem('dbw-recent-files', JSON.stringify(updated));
      return updated.slice(0, 6);
    });
  };

  // 打开最近文件
  const handleOpenRecentFile = (file: RecentFile) => {
    addTab({
      type: 'query',
      title: file.name,
      isModified: false,
      sqlFilePath: file.path,
      connectionId: activeConnection?.profile.name,
      connectionProfile: activeConnection?.profile,
      database: activeDatabase || undefined,
    });
    setStatusMessage(t('welcomeTab.status.openFile', { name: file.name }));
    addToRecentFiles(file.path, file.name);
  };

  // 清除最近文件
  const handleClearRecentFiles = () => {
    localStorage.removeItem('dbw-recent-files');
    setRecentFiles([]);
    setStatusMessage(t('welcomeTab.status.clearRecentFiles'));
  };

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return t('welcomeTab.time.justNow');
    if (diff < 3600000) return t('welcomeTab.time.minutesAgo', { minutes: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('welcomeTab.time.hoursAgo', { hours: Math.floor(diff / 3600000) });
    if (diff < 604800000) return t('welcomeTab.time.daysAgo', { days: Math.floor(diff / 86400000) });

    return date.toLocaleDateString(i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US');
  };

  return (
    <div className={`welcome-tab bp5-${theme}`}>
      <div className="welcome-container">
        {/* 左侧：Logo 和标题 */}
        <div className="welcome-left">
          <div className="welcome-brand">
            <div className="welcome-logo-large">
              <img src={logoImage} alt="Database Workbench" />
            </div>
            <h1 className="welcome-title-large">Database Workbench</h1>
            <p className="welcome-subtitle-large">{t('welcomeTab.subtitle')}</p>
          </div>
        </div>

        {/* 右侧：开始和最近 */}
        <div className="welcome-right">
          {/* 开始区域 */}
          <div className="welcome-section">
            <h2 className="welcome-section-title">{t('welcomeTab.startSection')}</h2>
            <div className="welcome-section-content">
              <div className="welcome-link" onClick={handleNewConnection}>
                <Icon icon="data-connection" size={16} />
                <span>{t('welcomeTab.newConnection')}</span>
                <span className="welcome-link-hint">Ctrl+N</span>
              </div>
              <div className="welcome-link" onClick={handleNewQuery}>
                <Icon icon="code" size={16} />
                <span>{t('welcomeTab.newQuery')}</span>
                <span className="welcome-link-hint">Ctrl+Q</span>
              </div>
              <div className="welcome-link" onClick={handleOpenFile}>
                <Icon icon="document-open" size={16} />
                <span>{t('welcomeTab.openSqlFile')}</span>
                <span className="welcome-link-hint">Ctrl+O</span>
              </div>
            </div>
          </div>

          {/* 最近文件区域 */}
          <div className="welcome-section">
            <div className="welcome-section-header">
              <h2 className="welcome-section-title">{t('welcomeTab.recentSection')}</h2>
              {recentFiles.length > 0 && (
                <button
                  className="welcome-clear-link"
                  onClick={handleClearRecentFiles}
                >
                  {t('welcomeTab.clearRecentFiles')}
                </button>
              )}
            </div>
            <div className="welcome-section-content">
              {recentFiles.length === 0 ? (
                <div className="welcome-empty-text">{t('welcomeTab.noRecentFiles')}</div>
              ) : (
                <div className="welcome-recent-links">
                  {recentFiles.map((file, index) => (
                    <div
                      key={index}
                      className="welcome-link welcome-recent-link"
                      onClick={() => handleOpenRecentFile(file)}
                      title={file.path}
                    >
                      <Icon icon="document" size={16} />
                      <div className="welcome-recent-link-content">
                        <span className="welcome-recent-link-name">{file.name}</span>
                        <span className="welcome-recent-link-path">{file.path}</span>
                      </div>
                      <span className="welcome-recent-link-time">{formatTime(file.lastOpened)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
