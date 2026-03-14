import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Menu,
  MenuItem,
  Popover,
  Position,
  Divider,
  Dialog,
  Classes,
  Button,
  Checkbox,
} from '@blueprintjs/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/plugin-process';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';
import { getMenuConfig } from '../../utils/menuConfig';
import type { MenuItem as MenuItemType } from '../../utils/menuConfig';
import { useAppStore, useConnectionStore, useTabStore } from '../../stores';
import {
  parseFavoritePayload,
  type DatabaseObjectOpenMode,
  type DatabaseObjectType,
  showToolbarRequirementNotice,
} from '../../utils';
import {
  FavoritesDialog,
  AddFavoriteDialog,
  ConfirmDialog,
  AboutDialog,
  ShortcutsDialog,
  ConnectionDialog,
  OptionsDialog,
  PropertiesDialog,
  BackupDialog,
  RestoreDialog,
} from '../dialogs';
import { useFavorites } from '../../hooks/useFavorites';
import type { ConnectionProfile, FavoriteItem } from '../../types/api';
import './MenuBar.css';

export const MenuBar: React.FC = () => {
  const { t } = useTranslation();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const {
    setStatusMessage,
    toggleTheme,
    toggleSidebar,
    toggleStatusBar,
    statusBarVisible,
    updateAvailable,
    updateDismissed
  } = useAppStore();
  const {
    addTab,
    closeAllTabs,
    activeTabId,
    getActiveTab
  } = useTabStore();
  const {
    connections,
    activeConnectionId,
    activeDatabase,
    addConnection,
    updateConnection,
    connect,
    checkMaxConnections,
    getConnectionState,
    setActiveConnection,
    setActiveDatabase,
    getLastUsedDatabaseForConnection,
  } = useConnectionStore();
  const activeConnection = connections.find((c) => c.profile.name === activeConnectionId);

  const { favorites, getAll, add, recordUsage } = useFavorites();
  const [isFavoritesDialogOpen, setIsFavoritesDialogOpen] = useState(false);
  const [isAddFavoriteDialogOpen, setIsAddFavoriteDialogOpen] = useState(false);
  const [isAboutDialogOpen, setIsAboutDialogOpen] = useState(false);
  const [isShortcutsDialogOpen, setIsShortcutsDialogOpen] = useState(false);
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [isOptionsDialogOpen, setIsOptionsDialogOpen] = useState(false);
  const [isPropertiesDialogOpen, setIsPropertiesDialogOpen] = useState(false);
  const [isBackupDialogOpen, setIsBackupDialogOpen] = useState(false);
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [isExportConnectionsDialogOpen, setIsExportConnectionsDialogOpen] = useState(false);
  const [exportSelection, setExportSelection] = useState<Record<string, boolean>>({});
  const [confirmDialogState, setConfirmDialogState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    intent?: 'primary' | 'success' | 'warning' | 'danger';
  }>({
    isOpen: false,
    title: '',
    message: '',
    intent: 'primary',
  });
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [recentFavorites, setRecentFavorites] = useState<FavoriteItem[]>([]);

  // 获取菜单配置
  const menuConfig = getMenuConfig(t);

  useEffect(() => {
    getAll();
  }, [getAll]);

  useEffect(() => {
    const sorted = [...favorites].sort((a, b) => b.lastUsedTime - a.lastUsedTime);
    setRecentFavorites(sorted.slice(0, 9));
  }, [favorites]);

  const askForConfirm = useCallback(
    ({ title, message, intent }: { title: string; message: string; intent?: 'primary' | 'success' | 'warning' | 'danger' }) => {
      return new Promise<boolean>((resolve) => {
        confirmResolverRef.current = resolve;
        setConfirmDialogState({
          isOpen: true,
          title,
          message,
          intent: intent || 'primary',
        });
      });
    },
    [],
  );

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialogState((prev) => ({ ...prev, isOpen: false }));
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
      confirmResolverRef.current = null;
    }
  }, []);

  const handleConfirmDialogConfirm = useCallback(() => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(true);
      confirmResolverRef.current = null;
    }
    setConfirmDialogState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleConfirmDialogCancel = useCallback(() => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
      confirmResolverRef.current = null;
    }
    setConfirmDialogState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  useEffect(() => {
    const onOpenBackup = () => {
      if (!activeConnection?.profile || !activeDatabase) {
        void showToolbarRequirementNotice(t('database.backup'), 'database');
        return;
      }
      setIsBackupDialogOpen(true);
    };

    const onOpenRestore = () => {
      if (!activeConnection?.profile) {
        void showToolbarRequirementNotice(t('database.restore'), 'connection');
        return;
      }
      setIsRestoreDialogOpen(true);
    };

    window.addEventListener('dbw:open-backup-dialog', onOpenBackup as EventListener);
    window.addEventListener('dbw:open-restore-dialog', onOpenRestore as EventListener);

    return () => {
      window.removeEventListener('dbw:open-backup-dialog', onOpenBackup as EventListener);
      window.removeEventListener('dbw:open-restore-dialog', onOpenRestore as EventListener);
    };
  }, [activeConnection, activeDatabase, t]);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      const clickedInsidePopover =
        !!target.closest('.menubar-popover') ||
        !!target.closest('.bp5-popover') ||
        !!target.closest('.bp6-popover') ||
        !!target.closest('.bp5-menu') ||
        !!target.closest('.bp6-menu');
      if (clickedInsidePopover) {
        return;
      }

      if (menuBarRef.current && !menuBarRef.current.contains(target)) {
        setActiveMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMenuClick = (label: string) => {
    setActiveMenu(activeMenu === label ? null : label);
  };

  // 文件菜单操作
  const handleNewConnection = useCallback(() => {
    setIsConnectionDialogOpen(true);
    setActiveMenu(null);
  }, []);

  const handleNewQuery = useCallback(() => {
    const inheritedDatabase = activeDatabase;
    addTab({
      type: 'query',
      title: t('query.new'),
      connectionId: activeConnection?.profile.name,
      connectionProfile: activeConnection?.profile,
      database: inheritedDatabase || undefined,
    });
    setStatusMessage(t('status.ready'));
    setActiveMenu(null);
  }, [activeConnection, activeDatabase, addTab, setStatusMessage, t]);

  const handleOpenSqlFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'SQL', extensions: ['sql'] }]
      });
      if (selected && typeof selected === 'string') {
        const content = await readTextFile(selected);
        const fileName = selected.split(/[/\\]/).pop() || 'query.sql';
        addTab({
          type: 'query',
          title: fileName,
          connectionId: activeConnection?.profile.name,
          connectionProfile: activeConnection?.profile,
          database: activeDatabase || undefined,
          sqlContent: content,
          sqlFilePath: selected,
          isModified: false,
        });
        // 添加到最近文件
        const newFile = {
          path: selected,
          name: fileName,
          lastOpened: Date.now(),
        };
        const saved = localStorage.getItem('dbw-recent-files');
        const prevFiles = saved ? JSON.parse(saved) : [];
        const filtered = prevFiles.filter((f: { path: string }) => f.path !== selected);
        const updated = [newFile, ...filtered].slice(0, 8);
        localStorage.setItem('dbw-recent-files', JSON.stringify(updated));
        // 通知 WelcomeTab 更新最近文件列表
        window.dispatchEvent(new CustomEvent('dbw:recent-files-updated'));
        setStatusMessage(`${t('common.open')}: ${selected}`);
      }
    } catch (error) {
      setStatusMessage(`${t('error.loadFailed')}: ${error}`);
    }
    setActiveMenu(null);
  }, [activeConnection, activeDatabase, addTab, setStatusMessage, t]);

  const handleSave = useCallback(() => {
    const activeTab = getActiveTab();
    if (!activeTab) {
      void showToolbarRequirementNotice(t('common.save'), 'query');
      setActiveMenu(null);
      return;
    }
    if (activeTab.type !== 'query') {
      void showToolbarRequirementNotice(t('common.save'), 'query');
      setActiveMenu(null);
      return;
    }
    window.dispatchEvent(new CustomEvent('dbw:save-current-tab'));
    setStatusMessage(t('status.saving'));
    setActiveMenu(null);
  }, [setStatusMessage, getActiveTab, t]);

  const handleSaveAs = useCallback(async () => {
    const activeTab = getActiveTab();
    if (!activeTab) {
      void showToolbarRequirementNotice(t('common.saveAs'), 'query');
      setActiveMenu(null);
      return;
    }
    if (activeTab.type !== 'query') {
      void showToolbarRequirementNotice(t('common.saveAs'), 'query');
      setActiveMenu(null);
      return;
    }
    try {
      const filePath = await save({
        filters: [{ name: 'SQL', extensions: ['sql'] }]
      });
      if (filePath) {
        window.dispatchEvent(new CustomEvent('dbw:save-as', { detail: { filePath } }));
        setStatusMessage(`${t('common.save')}: ${filePath}`);
      }
    } catch (error) {
      setStatusMessage(`${t('error.saveFailed')}: ${error}`);
    }
    setActiveMenu(null);
  }, [setStatusMessage, getActiveTab, t]);

  const handleExit = useCallback(async () => {
    await exit(0);
  }, []);

  // 编辑菜单操作
  const handleUndo = useCallback(() => {
    window.dispatchEvent(new CustomEvent('dbw:undo'));
    setActiveMenu(null);
  }, []);

  const handleRedo = useCallback(() => {
    window.dispatchEvent(new CustomEvent('dbw:redo'));
    setActiveMenu(null);
  }, []);

  const handleCut = useCallback(() => {
    window.dispatchEvent(new CustomEvent('dbw:cut'));
    setActiveMenu(null);
  }, []);

  const handleCopy = useCallback(() => {
    window.dispatchEvent(new CustomEvent('dbw:copy'));
    setActiveMenu(null);
  }, []);

  const handlePaste = useCallback(() => {
    window.dispatchEvent(new CustomEvent('dbw:paste'));
    setActiveMenu(null);
  }, []);

  const handleSelectAll = useCallback(() => {
    window.dispatchEvent(new CustomEvent('dbw:select-all'));
    setActiveMenu(null);
  }, []);

  // 查看菜单操作
  const handleRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent('dbw:global-refresh', { detail: { source: 'menu' } }));
    setStatusMessage(t('status.loading'));
    setActiveMenu(null);
  }, [setStatusMessage, t]);

  const handleErDiagram = useCallback(() => {
    if (!activeConnection?.profile) {
      void showToolbarRequirementNotice(t('menu.view.erDiagram'), 'connection');
      setActiveMenu(null);
      return;
    }

    if (!activeDatabase) {
      void showToolbarRequirementNotice(t('menu.view.erDiagram'), 'database');
      setActiveMenu(null);
      return;
    }

    addTab({
      type: 'erDiagram',
      title: t('tabTitles.erDiagram', { database: activeDatabase }),
      connectionId: activeConnection.profile.name,
      connectionProfile: activeConnection.profile,
      database: activeDatabase,
    });
    setActiveMenu(null);
  }, [activeConnection, activeDatabase, addTab]);

  const handleProperties = useCallback(() => {
    setIsPropertiesDialogOpen(true);
    setStatusMessage(t('dialog.properties.title'));
    setActiveMenu(null);
  }, [setStatusMessage, t]);

  const handleToggleSidebarMenu = useCallback(() => {
    toggleSidebar();
    setStatusMessage(t('menu.view.toggleSidebar'));
    setActiveMenu(null);
  }, [toggleSidebar, setStatusMessage, t]);

  const handleToggleStatusBarMenu = useCallback(() => {
    toggleStatusBar();
    setStatusMessage(statusBarVisible ? t('menu.view.hideStatusbar') : t('menu.view.showStatusbar'));
    setActiveMenu(null);
  }, [toggleStatusBar, statusBarVisible, setStatusMessage, t]);

  // 收藏夹菜单操作
  const handleAddToFavorites = useCallback(() => {
    setIsAddFavoriteDialogOpen(true);
    setActiveMenu(null);
  }, []);

  const handleManageFavorites = useCallback(() => {
    setIsFavoritesDialogOpen(true);
    setActiveMenu(null);
  }, []);

  // 工具菜单操作
  const handleBackupDatabase = useCallback(() => {
    if (!activeConnection?.profile || !activeDatabase) {
      void showToolbarRequirementNotice(t('database.backup'), 'database');
      setActiveMenu(null);
      return;
    }
    setIsBackupDialogOpen(true);
    setActiveMenu(null);
  }, [activeConnection, activeDatabase, addTab, t]);

  const handleRestoreDatabase = useCallback(() => {
    if (!activeConnection?.profile) {
      void showToolbarRequirementNotice(t('database.restore'), 'connection');
      setActiveMenu(null);
      return;
    }
    setIsRestoreDialogOpen(true);
    setActiveMenu(null);
  }, [activeConnection, t]);

  const handleDataDictionary = useCallback(() => {
    if (!activeConnection?.profile || !activeDatabase) {
      void showToolbarRequirementNotice(t('database.dataDictionary'), 'database');
      setActiveMenu(null);
      return;
    }
    addTab({
      type: 'dataDictionary',
      title: t('tabTitles.dataDictionary', { database: activeDatabase }),
      connectionId: activeConnection.profile.name,
      connectionProfile: activeConnection.profile,
      database: activeDatabase,
    });
    setActiveMenu(null);
  }, [activeConnection, activeDatabase, addTab, t]);

  const handleImportConnections = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (selected && typeof selected === 'string') {
        const content = await readTextFile(selected);
        const importedConnections = JSON.parse(content) as Array<{ profile?: ConnectionProfile }>;
        if (Array.isArray(importedConnections)) {
          let created = 0;
          let updated = 0;
          let skipped = 0;
          const existingByName = new Map(
            useConnectionStore
              .getState()
              .connections
              .map((conn) => [(conn.profile.name || '').trim(), conn.profile]),
          );

          for (const item of importedConnections) {
            if (!item?.profile) {
              skipped += 1;
              continue;
            }

            const importedProfile = item.profile;
            const profileName = (importedProfile.name || '').trim();
            if (!profileName) {
              skipped += 1;
              continue;
            }

            const existing = existingByName.get(profileName);
            if (!existing) {
              addConnection({ ...importedProfile, name: profileName });
              existingByName.set(profileName, importedProfile);
              created += 1;
              continue;
            }

            const sameConfig =
              JSON.stringify(normalizeConnectionProfile(existing))
              === JSON.stringify(normalizeConnectionProfile({ ...importedProfile, name: profileName }));
            if (sameConfig) {
              skipped += 1;
              continue;
            }

            const shouldOverwrite = await askForConfirm({
              title: t('common.confirm'),
              message: t('menu.tools.importConnectionsOverwritePrompt', { name: profileName }),
              intent: 'warning',
            });
            if (shouldOverwrite) {
              updateConnection(profileName, { ...importedProfile, name: profileName });
              existingByName.set(profileName, importedProfile);
              updated += 1;
            } else {
              skipped += 1;
            }
          }

          setStatusMessage(t('menu.tools.importConnectionsSummary', { created, updated, skipped }));
        }
      }
    } catch (error) {
      setStatusMessage(`${t('error.loadFailed')}: ${error}`);
    }
    setActiveMenu(null);
  }, [addConnection, askForConfirm, setStatusMessage, t, updateConnection]);

  const handleExportConnections = useCallback(() => {
    const selectable = connections
      .map((conn) => conn.profile.name || '')
      .filter((name): name is string => Boolean(name));

    if (selectable.length === 0) {
      setStatusMessage(t('menu.tools.noConnectionsToExport'));
      setActiveMenu(null);
      return;
    }

    const nextSelection: Record<string, boolean> = {};
    selectable.forEach((name) => {
      nextSelection[name] = true;
    });
    setExportSelection(nextSelection);
    setIsExportConnectionsDialogOpen(true);
    setActiveMenu(null);
  }, [connections, setStatusMessage, t]);

  // 窗口菜单操作
  const handleMaximize = useCallback(async () => {
    try {
      const appWindow = getCurrentWindow();
      const maximized = await appWindow.isMaximized();
      if (maximized) {
        await appWindow.unmaximize();
      } else {
        await appWindow.maximize();
      }
    } catch (error) {
      setStatusMessage(`${t('error.error')}: ${error}`);
    }
    setActiveMenu(null);
  }, [setStatusMessage, t]);

  const handleMinimize = useCallback(async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.minimize();
    } catch (error) {
      setStatusMessage(`${t('error.error')}: ${error}`);
    }
    setActiveMenu(null);
  }, [setStatusMessage, t]);

  const handleOptions = useCallback(() => {
    setIsOptionsDialogOpen(true);
    setStatusMessage(t('dialog.options.title'));
    setActiveMenu(null);
  }, [setStatusMessage, t]);

  const handleCloseCurrentTab = useCallback(() => {
    if (activeTabId) {
      window.dispatchEvent(new CustomEvent('dbw:request-close-tab', { detail: { tabId: activeTabId } }));
      setStatusMessage(t('menu.window.closeCurrentTab'));
    }
    setActiveMenu(null);
  }, [activeTabId, setStatusMessage, t]);

  const handleCloseAllTabs = useCallback(() => {
    closeAllTabs();
    setStatusMessage(t('menu.window.closeAllTabs'));
    setActiveMenu(null);
  }, [closeAllTabs, setStatusMessage, t]);

  const handleToggleThemeMenu = useCallback(() => {
    toggleTheme();
    setStatusMessage(t('menu.window.toggleTheme'));
    setActiveMenu(null);
  }, [toggleTheme, setStatusMessage, t]);

  // 监听键盘快捷键事件
  useEffect(() => {
    const handleNewConnectionEvent = () => {
      setIsConnectionDialogOpen(true);
    };

    const handleNewQueryEvent = () => {
      handleNewQuery();
    };

    const handleOpenSqlFileEvent = () => {
      handleOpenSqlFile();
    };

    const handleToggleThemeEvent = () => {
      handleToggleThemeMenu();
    };

    window.addEventListener('dbw:new-connection', handleNewConnectionEvent);
    window.addEventListener('dbw:new-query', handleNewQueryEvent);
    window.addEventListener('dbw:open-sql-file', handleOpenSqlFileEvent);
    window.addEventListener('dbw:toggle-theme', handleToggleThemeEvent);

    return () => {
      window.removeEventListener('dbw:new-connection', handleNewConnectionEvent);
      window.removeEventListener('dbw:new-query', handleNewQueryEvent);
      window.removeEventListener('dbw:open-sql-file', handleOpenSqlFileEvent);
      window.removeEventListener('dbw:toggle-theme', handleToggleThemeEvent);
    };
  }, [handleNewQuery, handleOpenSqlFile, handleToggleThemeMenu]);

  // 帮助菜单操作
  const handleMySQLDocs = useCallback(async () => {
    try {
      await openUrl('https://dev.mysql.com/doc/');
      setStatusMessage(t('menu.help.mysqlDocs'));
    } catch (error) {
      setStatusMessage(`${t('error.error')}: ${error}`);
    }
    setActiveMenu(null);
  }, [setStatusMessage, t]);

  const handleShortcuts = useCallback(() => {
    setIsShortcutsDialogOpen(true);
    setActiveMenu(null);
  }, []);

  const handleAbout = useCallback(() => {
    setIsAboutDialogOpen(true);
    setActiveMenu(null);
  }, []);

  const handleCheckUpdate = useCallback(() => {
    window.dispatchEvent(new CustomEvent('dbw:check-update'));
    setActiveMenu(null);
  }, []);

  const handleMenuItemClick = (item: MenuItemType) => {
    // 使用翻译后的标签进行匹配
    const label = item.label;
    
    // 文件菜单
    if (label === t('menu.file.newConnection')) {
      handleNewConnection();
      return;
    }
    if (label === t('menu.file.newQuery')) {
      handleNewQuery();
      return;
    }
    if (label === t('menu.file.open')) {
      handleOpenSqlFile();
      return;
    }
    if (label === t('menu.file.save')) {
      handleSave();
      return;
    }
    if (label === t('menu.file.saveAs')) {
      handleSaveAs();
      return;
    }
    if (label === t('menu.file.exit')) {
      handleExit();
      return;
    }

    // 编辑菜单
    if (label === t('menu.edit.undo')) {
      handleUndo();
      return;
    }
    if (label === t('menu.edit.redo')) {
      handleRedo();
      return;
    }
    if (label === t('menu.edit.cut')) {
      handleCut();
      return;
    }
    if (label === t('menu.edit.copy')) {
      handleCopy();
      return;
    }
    if (label === t('menu.edit.paste')) {
      handlePaste();
      return;
    }
    if (label === t('menu.edit.selectAll')) {
      handleSelectAll();
      return;
    }

    // 查看菜单
    if (label === t('menu.view.refresh')) {
      handleRefresh();
      return;
    }
    if (label === t('menu.view.erDiagram')) {
      handleErDiagram();
      return;
    }
    if (label === t('menu.view.properties')) {
      handleProperties();
      return;
    }
    if (label === t('menu.view.toggleSidebar')) {
      handleToggleSidebarMenu();
      return;
    }
    if (label === t('menu.view.toggleStatusbar')) {
      handleToggleStatusBarMenu();
      return;
    }

    // 收藏夹菜单
    if (label === t('menu.favorites.add')) {
      handleAddToFavorites();
      return;
    }
    if (label === t('menu.favorites.manage')) {
      handleManageFavorites();
      return;
    }

    // 工具菜单
    if (label === t('menu.tools.dataDictionary')) {
      handleDataDictionary();
      return;
    }
    if (label === t('menu.tools.backup')) {
      handleBackupDatabase();
      return;
    }
    if (label === t('menu.tools.restore')) {
      handleRestoreDatabase();
      return;
    }
    if (label === t('menu.tools.importConnections')) {
      handleImportConnections();
      return;
    }
    if (label === t('menu.tools.exportConnections')) {
      handleExportConnections();
      return;
    }
    if (label === t('menu.tools.options')) {
      handleOptions();
      return;
    }

    // 窗口菜单
    if (label === t('menu.window.maximize')) {
      handleMaximize();
      return;
    }
    if (label === t('menu.window.minimize')) {
      handleMinimize();
      return;
    }
    if (label === t('menu.window.closeCurrentTab')) {
      handleCloseCurrentTab();
      return;
    }
    if (label === t('menu.window.closeAllTabs')) {
      handleCloseAllTabs();
      return;
    }
    if (label === t('menu.window.toggleTheme')) {
      handleToggleThemeMenu();
      return;
    }

    // 帮助菜单
    if (label === t('menu.help.mysqlDocs')) {
      handleMySQLDocs();
      return;
    }
    if (label === t('menu.help.shortcuts')) {
      handleShortcuts();
      return;
    }
    if (label === t('menu.help.checkUpdate')) {
      handleCheckUpdate();
      return;
    }
    if (label === t('menu.help.about')) {
      handleAbout();
      return;
    }

    if (item.onClick) {
      item.onClick();
    }
    setActiveMenu(null);
  };

  const normalizeConnectionProfile = (profile: ConnectionProfile) => ({
    name: profile.name || '',
    host: profile.host,
    port: profile.port,
    username: profile.username,
    password: profile.password,
    database: profile.database || '',
    charset: profile.charset || '',
    collation: profile.collation || '',
    timeout: profile.timeout ?? 28800,
    connectionTimeout: profile.connectionTimeout ?? 30,
    autoReconnect: profile.autoReconnect ?? false,
    ssl: profile.ssl ?? false,
    sslMode: profile.sslMode || 'preferred',
    sslCaPath: profile.sslCaPath || '',
    sslCertPath: profile.sslCertPath || '',
    sslKeyPath: profile.sslKeyPath || '',
  });

  const findConnectionByName = (connectionName: string) => {
    const target = connectionName.trim();
    return useConnectionStore
      .getState()
      .connections
      .find((conn) => (conn.profile.name || '').trim() === target);
  };

  const parseProfilesFromConnectionJson = (content: string): ConnectionProfile[] => {
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const maybeProfile = (entry as { profile?: ConnectionProfile }).profile;
        if (!maybeProfile || typeof maybeProfile !== 'object') {
          return null;
        }
        return maybeProfile;
      })
      .filter((profile): profile is ConnectionProfile => Boolean(profile));
  };

  const loadProfileFromConnectionJson = async (
    filePath: string,
    preferredProfileName?: string,
    fallbackProfileName?: string,
  ): Promise<ConnectionProfile> => {
    const content = await readTextFile(filePath);
    const profiles = parseProfilesFromConnectionJson(content);
    if (profiles.length === 0) {
      throw new Error('连接配置文件中未找到有效 profile');
    }

    const candidateNames = [preferredProfileName, fallbackProfileName]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));

    for (const name of candidateNames) {
      const matched = profiles.find((profile) => (profile.name || '').trim() === name);
      if (matched) {
        return matched;
      }
    }

    const existingNames = new Set(
      useConnectionStore
        .getState()
        .connections
        .map((conn) => (conn.profile.name || '').trim())
        .filter(Boolean),
    );
    const matchedByExisting = profiles.filter((profile) => existingNames.has((profile.name || '').trim()));
    if (matchedByExisting.length === 1) {
      return matchedByExisting[0];
    }

    if (profiles.length === 1) {
      return profiles[0];
    }

    throw new Error('配置文件包含多个连接，请在收藏中指定连接名称');
  };

  const ensureConnectionOpened = async (connectionName: string): Promise<boolean> => {
    const connectionState = findConnectionByName(connectionName) || getConnectionState(connectionName);
    if (!connectionState) {
      return false;
    }

    const actualName = connectionState.profile.name || connectionName;
    setActiveConnection(actualName);

    if (!connectionState.isConnected) {
      const { allowed, current, max } = checkMaxConnections();
      if (!allowed) {
        setStatusMessage(t('metadataTree.maxConnectionsReached', { current, max }));
        return false;
      }

      await connect(actualName);
      const latest = findConnectionByName(actualName) || getConnectionState(actualName);
      if (!latest?.isConnected) {
        setStatusMessage(latest?.error || t('error.connectionFailed', { message: '连接打开失败' }));
        return false;
      }
    }

    window.dispatchEvent(new CustomEvent('dbw:open-connection-node', { detail: { connectionName: actualName } }));

    return true;
  };

  const ensureProfileReadyAndOpen = async (incomingProfile: ConnectionProfile): Promise<ConnectionProfile | null> => {
    const profileName = incomingProfile.name?.trim();
    if (!profileName) {
      setStatusMessage('连接配置缺少 name，无法打开。');
      return null;
    }

    const normalizedIncoming = { ...incomingProfile, name: profileName };
    const existing = findConnectionByName(profileName);

    if (!existing) {
      const shouldCreate = await askForConfirm({
        title: t('common.confirm'),
        message: `连接 "${profileName}" 不存在，是否先按收藏配置新建后再打开？`,
        intent: 'warning',
      });
      if (!shouldCreate) {
        return null;
      }
      addConnection(normalizedIncoming);
      const created = findConnectionByName(profileName);
      if (!created) {
        setStatusMessage(`新建连接失败：${profileName}`);
        return null;
      }

      const opened = await ensureConnectionOpened(profileName);
      if (!opened) {
        return null;
      }
      return findConnectionByName(profileName)?.profile || null;
    }

    const isSameConfig =
      JSON.stringify(normalizeConnectionProfile(existing.profile))
      === JSON.stringify(normalizeConnectionProfile(normalizedIncoming));

    if (!isSameConfig) {
      const shouldOverwrite = await askForConfirm({
        title: t('common.confirm'),
        message: `连接 "${profileName}" 已存在且配置不同，是否覆盖当前连接配置？\n选择“否”将直接打开当前连接。`,
        intent: 'warning',
      });

      if (shouldOverwrite) {
        updateConnection(profileName, normalizedIncoming);
      }
    }

    const opened = await ensureConnectionOpened(profileName);
    if (!opened) {
      return null;
    }
    return findConnectionByName(profileName)?.profile || null;
  };

  const openDatabaseObjectFromFavorite = async (
    objectType: DatabaseObjectType,
    objectName: string,
    openMode: DatabaseObjectOpenMode,
    connectionProfile: ConnectionProfile,
    database: string,
  ) => {
    setActiveDatabase(database);

    if (openMode === 'LIST') {
      addTab({
        type: objectType === 'TABLE' ? 'tableList' : objectType === 'VIEW' ? 'viewList' : 'functionList',
        title: `${objectType} - ${database}`,
        connectionId: connectionProfile.name,
        connectionProfile,
        database,
        objectType,
      });
      return;
    }

    if (objectType === 'TABLE') {
      if (openMode === 'DESIGNER') {
        addTab({
          type: 'designer',
          title: t('tabTitles.designer.edit', { tableName: objectName }),
          connectionId: connectionProfile.name,
          connectionProfile,
          database,
          table: objectName,
        });
        return;
      }
      addTab({
        type: 'tableData',
        title: t('tabTitles.tableData', { tableName: objectName, database, connectionName: connectionProfile.name }),
        connectionId: connectionProfile.name,
        connectionProfile,
        database,
        table: objectName,
      });
      return;
    }

    if (objectType === 'VIEW') {
      if (openMode === 'DESIGNER') {
        addTab({
          type: 'viewDesigner',
          title: t('tabTitles.viewDesigner', { viewName: objectName }),
          connectionId: connectionProfile.name,
          connectionProfile,
          database,
          objectName,
        });
        return;
      }
      addTab({
        type: 'viewData',
        title: t('tabTitles.viewData', { viewName: objectName, database, connectionName: connectionProfile.name }),
        connectionId: connectionProfile.name,
        connectionProfile,
        database,
        objectName,
      });
      return;
    }

    addTab({
      type: 'functionDesigner',
      title: t('tabTitles.functionDesigner.editFunction', { name: objectName }),
      connectionId: connectionProfile.name,
      connectionProfile,
      database,
      objectName,
      data: { functionType: 'FUNCTION' },
    });
  };

  const handleUseFavorite = async (item: FavoriteItem) => {
    const payload = parseFavoritePayload(item);

    if (item.type === 'SQL_QUERY') {
      const sql = payload?.kind === 'SQL_QUERY' ? payload.sql : (item.content || '');
      if (!sql.trim()) {
        setStatusMessage('该 SQL 收藏没有可执行内容。');
        return;
      }

      let targetProfile = activeConnection?.profile;
      const targetConnectionName = payload?.kind === 'SQL_QUERY' ? payload.connectionName : undefined;
      if (targetConnectionName) {
        const opened = await ensureConnectionOpened(targetConnectionName);
        if (!opened) {
          return;
        }
        targetProfile = useConnectionStore.getState().connections.find((conn) => conn.profile.name === targetConnectionName)?.profile;
      }

      if (!targetProfile) {
        void showToolbarRequirementNotice(t('menu.favorites.use'), 'connection');
        return;
      }

      addTab({
        type: 'query',
        title: item.name,
        connectionId: targetProfile.name,
        connectionProfile: targetProfile,
        database: (payload?.kind === 'SQL_QUERY' ? payload.database : undefined) || activeDatabase || undefined,
        sqlContent: sql,
      });

      if (item.id) {
        await recordUsage(item.id);
      }
      setStatusMessage(`${t('menu.favorites.opened')}: ${item.name}`);
      return;
    }

    if (item.type === 'CONNECTION_PROFILE') {
      if (!payload || payload.kind !== 'CONNECTION_PROFILE') {
        setStatusMessage('连接收藏内容无效，请重新编辑。');
        return;
      }

      try {
        const profile = await loadProfileFromConnectionJson(payload.filePath, payload.profileName, item.name);
        const readyProfile = await ensureProfileReadyAndOpen(profile);
        if (!readyProfile) {
          return;
        }

        const preferredDatabase = readyProfile.database || getLastUsedDatabaseForConnection(readyProfile.name);
        if (preferredDatabase) {
          setActiveDatabase(preferredDatabase);
        }
        if (item.id) {
          await recordUsage(item.id);
        }
        setStatusMessage(`${t('menu.favorites.connection')}: ${readyProfile.name}`);
      } catch (error) {
        setStatusMessage(`连接收藏打开失败: ${String(error)}`);
      }
      return;
    }

    if (!payload || payload.kind !== 'DATABASE_OBJECT') {
      setStatusMessage('数据库对象收藏内容无效，请重新编辑。');
      return;
    }

    const objectType = payload.objectType;
    const objectName = payload.objectName;
    const database = payload.database;
    const connectionName = payload.connectionName;
    const openMode = payload.openMode || 'DATA';

    if (!objectType || !objectName || !database || !connectionName) {
      setStatusMessage(`数据库对象路径无效：${payload.path}`);
      return;
    }

    try {
      const profile = findConnectionByName(connectionName)?.profile || null;

      if (!profile?.name) {
        setStatusMessage(`未找到连接：${connectionName}`);
        return;
      }

      const opened = await ensureConnectionOpened(profile.name);
      if (!opened) {
        return;
      }

      await openDatabaseObjectFromFavorite(objectType, objectName, openMode, profile, database);
      if (item.id) {
        await recordUsage(item.id);
      }
      setStatusMessage(`${t('menu.favorites.object')}: ${item.name}`);
    } catch (error) {
      setStatusMessage(`数据库对象收藏打开失败: ${String(error)}`);
    }
  };

  const handleConfirmExportConnections = useCallback(async () => {
    const selectedNames = Object.entries(exportSelection)
      .filter(([, checked]) => checked)
      .map(([name]) => name);

    if (selectedNames.length === 0) {
      setStatusMessage(t('menu.tools.selectAtLeastOneConnection'));
      return;
    }

    try {
      const filePath = await save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: 'connections.json'
      });
      if (!filePath) {
        return;
      }

      const selectedSet = new Set(selectedNames.map((name) => name.trim()));
      const exportData = connections
        .filter((conn) => selectedSet.has((conn.profile.name || '').trim()))
        .map((conn) => ({ profile: conn.profile }));

      await writeTextFile(filePath, JSON.stringify(exportData, null, 2));
      setStatusMessage(t('menu.tools.exportConnectionsSaved', { count: exportData.length, filePath }));
      setIsExportConnectionsDialogOpen(false);
    } catch (error) {
      setStatusMessage(`${t('error.saveFailed')}: ${error}`);
    }
  }, [connections, exportSelection, setStatusMessage, t]);

  const handleAddFavorite = async (item: Omit<FavoriteItem, 'id'>) => {
    try {
      await add(item);
      setStatusMessage(t('menu.favorites.added'));
      await getAll();
    } catch (error) {
      setStatusMessage(t('menu.favorites.addFailed'));
    }
  };

  const renderMenuItems = (items: MenuItemType[], menuLabel: string) => {
    if (menuLabel === t('menu.favorites.title')) {
      const staticItems = items.filter(item => item.label === t('menu.favorites.add') || item.label === t('menu.favorites.manage') || item.divider);

      const sqlFavorites = recentFavorites.filter(f => f.type === 'SQL_QUERY');
      const connectionFavorites = recentFavorites.filter(f => f.type === 'CONNECTION_PROFILE');
      const objectFavorites = recentFavorites.filter(f => f.type === 'DATABASE_OBJECT');

      return (
        <>
          {staticItems.map((item, index) => {
            if (item.divider) {
              return <Divider key={`divider-${index}`} />;
            }
            return (
              <MenuItem
                key={`${item.label}-${index}`}
                text={item.label}
                label={item.shortcut}
                disabled={item.disabled}
                onClick={() => handleMenuItemClick(item)}
              />
            );
          })}

          <Divider />

          {sqlFavorites.length > 0 && (
            <>
              <MenuItem text={t('menu.favorites.sqlQueries')} disabled>
                {sqlFavorites.map(fav => (
                  <MenuItem
                    key={fav.id}
                    text={fav.name}
                    onClick={() => handleUseFavorite(fav)}
                  />
                ))}
              </MenuItem>
              <Divider />
            </>
          )}

          {connectionFavorites.length > 0 && (
            <>
              <MenuItem text={t('menu.favorites.connections')} disabled>
                {connectionFavorites.map(fav => (
                  <MenuItem
                    key={fav.id}
                    text={fav.name}
                    onClick={() => handleUseFavorite(fav)}
                  />
                ))}
              </MenuItem>
              <Divider />
            </>
          )}

          {objectFavorites.length > 0 && (
            <>
              <MenuItem text={t('menu.favorites.object')} disabled>
                {objectFavorites.map(fav => (
                  <MenuItem
                    key={fav.id}
                    text={fav.name}
                    onClick={() => handleUseFavorite(fav)}
                  />
                ))}
              </MenuItem>
              <Divider />
            </>
          )}

          {recentFavorites.length === 0 && (
            <MenuItem text={t('menu.favorites.empty')} disabled />
          )}
        </>
      );
    }

    const showUpdateIndicator = updateAvailable && !updateDismissed;

    return items.map((item, index) => {
      if (item.divider) {
        return <Divider key={`divider-${index}`} />;
      }

      const isCheckUpdateItem = item.label === t('menu.help.checkUpdate');
      const shouldShowDot = showUpdateIndicator && isCheckUpdateItem;

      return (
        <MenuItem
          key={`${item.label}-${index}`}
          text={
            shouldShowDot ? (
              <span className="menu-item-with-dot">
                {item.label}
                <span className="update-dot" />
              </span>
            ) : (
              item.label
            )
          }
          label={item.shortcut}
          disabled={item.disabled}
          onClick={() => handleMenuItemClick(item)}
        />
      );
    });
  };

  return (
    <>
      <div ref={menuBarRef} className="menubar">
        {menuConfig.map((menu) => {
          const isHelpMenu = menu.label === t('menu.help.title');
          const showHelpDot = isHelpMenu && updateAvailable && !updateDismissed;
          
          return (
            <Popover
              key={menu.label}
              isOpen={activeMenu === menu.label}
              onClose={() => setActiveMenu(null)}
              position={Position.BOTTOM_LEFT}
              minimal
              content={
                <Menu className="menubar-popover">
                  {renderMenuItems(menu.items, menu.label)}
                </Menu>
              }
            >
              <button
                className={`menubar-item ${activeMenu === menu.label ? 'active' : ''}`}
                onClick={() => handleMenuClick(menu.label)}
              >
                {menu.label}
                {showHelpDot && <span className="menu-dot-indicator" />}
              </button>
            </Popover>
          );
        })}
      </div>

      <FavoritesDialog
        isOpen={isFavoritesDialogOpen}
        onClose={() => setIsFavoritesDialogOpen(false)}
        onUseFavorite={handleUseFavorite}
      />

      <AddFavoriteDialog
        isOpen={isAddFavoriteDialogOpen}
        onClose={() => setIsAddFavoriteDialogOpen(false)}
        onSave={handleAddFavorite}
      />

      <AboutDialog
        isOpen={isAboutDialogOpen}
        onClose={() => setIsAboutDialogOpen(false)}
      />

      <ShortcutsDialog
        isOpen={isShortcutsDialogOpen}
        onClose={() => setIsShortcutsDialogOpen(false)}
      />

      <ConnectionDialog
        isOpen={isConnectionDialogOpen}
        onClose={() => setIsConnectionDialogOpen(false)}
      />

      <OptionsDialog
        isOpen={isOptionsDialogOpen}
        onClose={() => setIsOptionsDialogOpen(false)}
      />

      <PropertiesDialog
        isOpen={isPropertiesDialogOpen}
        onClose={() => setIsPropertiesDialogOpen(false)}
      />

      <BackupDialog
        isOpen={isBackupDialogOpen}
        onClose={() => setIsBackupDialogOpen(false)}
        connectionProfile={activeConnection?.profile}
        database={activeDatabase || undefined}
      />

      <RestoreDialog
        isOpen={isRestoreDialogOpen}
        onClose={() => setIsRestoreDialogOpen(false)}
        connectionProfile={activeConnection?.profile}
        initialDatabase={activeDatabase || undefined}
      />

      <Dialog
        isOpen={isExportConnectionsDialogOpen}
        onClose={() => setIsExportConnectionsDialogOpen(false)}
        title={t('menu.tools.exportConnectionsSelectTitle')}
        icon="export"
      >
        <div className={Classes.DIALOG_BODY}>
          <p>{t('menu.tools.exportConnectionsSelectDescription')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
            {connections
              .map((conn) => conn.profile.name || '')
              .filter((name): name is string => Boolean(name))
              .map((name) => (
                <Checkbox
                  key={name}
                  checked={!!exportSelection[name]}
                  onChange={(event) => {
                    const checked = (event.target as HTMLInputElement).checked;
                    setExportSelection((prev) => ({ ...prev, [name]: checked }));
                  }}
                  label={name}
                />
              ))}
          </div>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setIsExportConnectionsDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button intent="primary" onClick={() => { void handleConfirmExportConnections(); }}>
              {t('menu.tools.exportConnections')}
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        isOpen={confirmDialogState.isOpen}
        onClose={closeConfirmDialog}
        onConfirm={handleConfirmDialogConfirm}
        onCancel={handleConfirmDialogCancel}
        title={confirmDialogState.title}
        message={confirmDialogState.message}
        intent={confirmDialogState.intent}
        confirmText={t('common.yes')}
        cancelText={t('common.no')}
      />
    </>
  );
};
