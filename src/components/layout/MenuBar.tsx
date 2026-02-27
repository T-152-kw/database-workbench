import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Menu,
  MenuItem,
  Popover,
  Position,
  Divider,
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
import { showToolbarRequirementNotice } from '../../utils';
import {
  FavoritesDialog,
  AddFavoriteDialog,
  AboutDialog,
  ShortcutsDialog,
  ConnectionDialog,
  OptionsDialog,
  PropertiesDialog
} from '../dialogs';
import { useFavorites } from '../../hooks/useFavorites';
import type { FavoriteItem } from '../../types/api';
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
    addConnection
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
    addTab({
      type: 'backup',
      title: `${t('database.backup')} - ${activeDatabase}`,
      connectionId: activeConnection.profile.name,
      connectionProfile: activeConnection.profile,
      database: activeDatabase,
    });
    setActiveMenu(null);
  }, [activeConnection, activeDatabase, addTab, t]);

  const handleRestoreDatabase = useCallback(() => {
    if (!activeConnection?.profile) {
      void showToolbarRequirementNotice(t('database.restore'), 'connection');
      setActiveMenu(null);
      return;
    }
    addTab({
      type: 'restore',
      title: `${t('database.restore')} - ${activeConnection.profile.name || activeConnection.profile.host}`,
      connectionId: activeConnection.profile.name,
      connectionProfile: activeConnection.profile,
      database: activeDatabase || undefined,
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
        const importedConnections = JSON.parse(content);
        if (Array.isArray(importedConnections)) {
          importedConnections.forEach((conn) => {
            if (conn.profile) {
              addConnection(conn.profile);
            }
          });
          setStatusMessage(`${t('common.success')} ${importedConnections.length}`);
        }
      }
    } catch (error) {
      setStatusMessage(`${t('error.loadFailed')}: ${error}`);
    }
    setActiveMenu(null);
  }, [addConnection, setStatusMessage, t]);

  const handleExportConnections = useCallback(async () => {
    try {
      const filePath = await save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: 'connections.json'
      });
      if (filePath) {
        const exportData = connections.map(c => ({ profile: c.profile }));
        await writeTextFile(filePath, JSON.stringify(exportData, null, 2));
        setStatusMessage(`${t('common.save')}: ${filePath}`);
      }
    } catch (error) {
      setStatusMessage(`${t('error.saveFailed')}: ${error}`);
    }
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

  const handleUseFavorite = async (item: FavoriteItem) => {
    await recordUsage(item.id!);

    switch (item.type) {
      case 'SQL_QUERY':
        if (!activeConnection?.profile) {
          void showToolbarRequirementNotice(t('menu.favorites.use'), 'connection');
          return;
        }
        addTab({
          type: 'query',
          title: item.name,
          connectionId: activeConnection.profile.name,
          connectionProfile: activeConnection.profile,
          database: activeDatabase || undefined,
        });
        setStatusMessage(`${t('menu.favorites.opened')}: ${item.name}`);
        break;
      case 'CONNECTION_PROFILE':
        setStatusMessage(`${t('menu.favorites.connection')}: ${item.name}`);
        break;
      case 'DATABASE_OBJECT':
        setStatusMessage(`${t('menu.favorites.object')}: ${item.name}`);
        break;
    }
  };

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
    </>
  );
};
