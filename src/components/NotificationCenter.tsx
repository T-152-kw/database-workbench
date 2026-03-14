import React, { useCallback, useMemo } from 'react';
import { Button, Icon, Intent } from '@blueprintjs/core';
import type { IconName } from '@blueprintjs/icons';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore, type Notification } from '../stores';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

const getIntentIcon = (intent: string): IconName => {
  switch (intent) {
    case 'success':
      return 'tick-circle';
    case 'warning':
      return 'warning-sign';
    case 'danger':
      return 'error';
    case 'primary':
    default:
      return 'info-sign';
  }
};

const getIntentColor = (intent: string): string => {
  switch (intent) {
    case 'success':
      return 'var(--bp5-intent-success)';
    case 'warning':
      return 'var(--bp5-intent-warning)';
    case 'danger':
      return 'var(--bp5-intent-danger)';
    case 'primary':
    default:
      return 'var(--bp5-intent-primary)';
  }
};

const formatTimeAgo = (timestamp: number, t: (key: string, options?: Record<string, unknown>) => string): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (minutes < 1) {
    return t('notification.justNow');
  } else if (minutes < 60) {
    return t('notification.minutesAgo', { count: minutes });
  } else if (hours < 24) {
    return t('notification.hoursAgo', { count: hours });
  } else {
    const date = new Date(timestamp);
    return date.toLocaleDateString();
  }
};

const NotificationItem: React.FC<{
  notification: Notification;
  onRemove: (id: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}> = ({ notification, onRemove, t }) => {
  const handleRemove = useCallback(() => {
    onRemove(notification.id);
  }, [onRemove, notification.id]);

  return (
    <div className="notification-item">
      <div className="notification-item-content">
        <Icon
          icon={getIntentIcon(notification.intent)}
          size={16}
          color={getIntentColor(notification.intent)}
          className="notification-item-icon"
        />
        <div className="notification-item-text">
          <div className="notification-item-message">{notification.message}</div>
          <div className="notification-item-time">
            {formatTimeAgo(notification.timestamp, t)}
          </div>
        </div>
      </div>
      <Button
        minimal
        small
        icon="cross"
        className="notification-item-remove"
        onClick={handleRemove}
        aria-label={t('common.close')}
      />
    </div>
  );
};

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { notifications, removeNotification, clearAll, getUnreadCount } = useNotificationStore();

  const unreadCount = useMemo(() => getUnreadCount(), [getUnreadCount, notifications]);

  const handleClearAll = useCallback(() => {
    clearAll();
  }, [clearAll]);

  const handleRemove = useCallback((id: string) => {
    removeNotification(id);
  }, [removeNotification]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="notification-center-overlay" onClick={onClose}>
      <div className="notification-center-panel" onClick={(e) => e.stopPropagation()}>
        <div className="notification-center-header">
          <div className="notification-center-title">
            {t('notification.title')}
            {unreadCount > 0 && (
              <span className="notification-center-count">({unreadCount})</span>
            )}
          </div>
          <Button
            minimal
            small
            className="notification-center-close-btn"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <ChevronDown size={16} />
          </Button>
        </div>

        <div className="notification-center-body">
          {notifications.length === 0 ? (
            <div className="notification-center-empty">
              <Icon icon="notifications" size={32} className="notification-empty-icon" />
              <div className="notification-empty-text">{t('notification.empty')}</div>
            </div>
          ) : (
            <div className="notification-list">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onRemove={handleRemove}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>

        {notifications.length > 0 && (
          <div className="notification-center-footer">
            <Button
              minimal
              small
              intent={Intent.DANGER}
              onClick={handleClearAll}
            >
              {t('notification.clearAll')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
