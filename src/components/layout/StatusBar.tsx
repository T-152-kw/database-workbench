import React, { useCallback, useEffect, useMemo } from 'react';
import { Button, Tooltip } from '@blueprintjs/core';
import { Moon, Sun, PanelLeft, Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore, useNotificationStore } from '../../stores';

interface StatusBarProps {
  onToggleNotificationCenter: () => void;
  isNotificationCenterOpen: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  onToggleNotificationCenter,
  isNotificationCenterOpen,
}) => {
  const { theme, toggleTheme, statusMessage, sidebarCollapsed, toggleSidebar } = useAppStore();
  const { notifications, markAllAsRead, getUnreadCount } = useNotificationStore();
  const { t } = useTranslation();

  const unreadCount = useMemo(() => getUnreadCount(), [getUnreadCount, notifications]);

  // 当通知中心打开时，标记所有通知为已读
  useEffect(() => {
    if (isNotificationCenterOpen) {
      markAllAsRead();
    }
  }, [isNotificationCenterOpen, markAllAsRead]);

  const handleToggleNotificationCenter = useCallback(() => {
    onToggleNotificationCenter();
  }, [onToggleNotificationCenter]);

  return (
    <div className={`statusbar bp5-${theme}`}>
      <div className="statusbar-left">
        <span className="statusbar-item">
          <span className="status-indicator ready" />
          {statusMessage}
        </span>
        <span className="statusbar-separator" />
        <span className="statusbar-item">
          {t('statusBar.ready')}
        </span>
      </div>

      <div className="statusbar-right">
        <Tooltip content={sidebarCollapsed ? t('statusBar.showSidebar') : t('statusBar.hideSidebar')}>
          <Button
            minimal
            small
            className="statusbar-button"
            onClick={toggleSidebar}
          >
            <PanelLeft size={14} />
          </Button>
        </Tooltip>

        <Tooltip content={theme === 'dark' ? t('statusBar.switchToLight') : t('statusBar.switchToDark')}>
          <Button
            minimal
            small
            className="statusbar-button"
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </Button>
        </Tooltip>

        <Tooltip content={t('notification.title')}>
          <Button
            minimal
            small
            className={`statusbar-button notification-button ${isNotificationCenterOpen ? 'active' : ''}`}
            onClick={handleToggleNotificationCenter}
          >
            <div className="notification-icon-wrapper">
              <Bell size={14} />
              {unreadCount > 0 && (
                <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </div>
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};
