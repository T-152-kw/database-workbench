import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore, useTabStore } from '../../stores';
import { useConnectionStore } from '../../stores';
import { ConnectionDialog } from '../dialogs';
import { showToolbarRequirementNotice } from '../../utils';

// 工具栏按钮配置 - 完全按照Java版
interface ToolButton {
  id: string;
  label: string;
  iconType: 'connection' | 'query' | 'table' | 'view' | 'function' | 'backup' | 'restore' | 'refresh' | 'user';
  shortcut?: string;
  onClick: () => void;
}

// 完全按照Java版代码绘制的图标 - 64x64画布，缩放至40x40
const ToolbarIcon: React.FC<{ type: ToolButton['iconType']; size?: number }> = ({ type, size = 40 }) => {
  const renderIcon = () => {
    switch (type) {
      case 'connection':
        // 现代化连接图标：两个数据库圆柱体连接
        return (
          <svg width={size} height={size} viewBox="0 0 64 64">
            {/* 左侧小数据库 - 浅蓝色（远处的） */}
            <ellipse cx="18" cy="22" rx="10" ry="5" fill="#64B5F6"/>
            <rect x="8" y="22" width="20" height="16" fill="#64B5F6"/>
            <ellipse cx="18" cy="38" rx="10" ry="5" fill="#42A5F5"/>
            {/* 左侧数据库横线 */}
            <rect x="11" y="28" width="14" height="2" rx="1" fill="white" opacity="0.8"/>
            
            {/* 连接线 */}
            <rect x="26" y="30" width="8" height="4" fill="#90CAF9"/>
            
            {/* 右侧大数据库 - 深蓝色（当前的） */}
            <ellipse cx="46" cy="18" rx="14" ry="7" fill="#2196F3"/>
            <rect x="32" y="18" width="28" height="28" fill="#2196F3"/>
            <ellipse cx="46" cy="46" rx="14" ry="7" fill="#1976D2"/>
            {/* 右侧数据库横线 */}
            <rect x="36" y="28" width="20" height="3" rx="1" fill="white" opacity="0.9"/>
            <rect x="36" y="36" width="16" height="3" rx="1" fill="white" opacity="0.7"/>
          </svg>
        );
      
      case 'query':
        // Java版: 蓝色圆角矩形纸张 + 白色横线 + 绿色三角形
        return (
          <svg width={size} height={size} viewBox="0 0 64 64">
            {/* 蓝色纸张 */}
            <rect x="10" y="8" width="44" height="48" rx="8" fill="#2196F3" />
            {/* 白色横线 */}
            <rect x="18" y="18" width="28" height="4" fill="white" />
            <rect x="18" y="28" width="20" height="4" fill="white" />
            <rect x="18" y="38" width="28" height="4" fill="white" />
            {/* 绿色三角形播放按钮 */}
            <polygon points="40,40 58,52 40,64" fill="#4CAF50" />
          </svg>
        );
      
      case 'table':
        // Java版: 青色矩形表格 + 白色网格线
        return (
          <svg width={size} height={size} viewBox="0 0 64 64">
            {/* 青色背景 */}
            <rect x="8" y="12" width="48" height="40" fill="#00BCD4" />
            {/* 白色横线 */}
            <rect x="12" y="24" width="40" height="2" fill="white" />
            <rect x="12" y="36" width="40" height="2" fill="white" />
            {/* 白色竖线 */}
            <rect x="24" y="16" width="2" height="32" fill="white" />
            <rect x="40" y="16" width="2" height="32" fill="white" />
          </svg>
        );
      
      case 'view':
        // Java版: 青色圆角矩形 + 白色横线 + 深蓝色眼镜
        return (
          <svg width={size} height={size} viewBox="0 0 64 64">
            {/* 青色背景 */}
            <rect x="8" y="12" width="48" height="40" rx="4" fill="#00BCD4" />
            {/* 白色横线 */}
            <rect x="12" y="24" width="40" height="2" fill="white" />
            <rect x="12" y="36" width="40" height="2" fill="white" />
            {/* 深蓝色眼镜 */}
            <circle cx="23" cy="43" r="7" fill="none" stroke="#3F51B5" strokeWidth="4" />
            <circle cx="41" cy="43" r="7" fill="none" stroke="#3F51B5" strokeWidth="4" />
            <line x1="30" y1="43" x2="34" y2="43" stroke="#3F51B5" strokeWidth="4" />
          </svg>
        );
      
      case 'function':
        // Java版: 蓝色斜体f(x)文字
        return (
          <svg width={size} height={size} viewBox="0 0 64 64">
            <text 
              x="0" 
              y="44" 
              fill="#2196F3" 
              fontSize="34" 
              fontFamily="Serif" 
              fontStyle="italic" 
              fontWeight="bold"
            >
              f(x)
            </text>
          </svg>
        );
      
      case 'backup':
        // Java版: 紫色圆角矩形 + 白色横线 + 绿色向下箭头
        return (
          <svg width={size} height={size} viewBox="0 0 64 64">
            {/* 紫色数据库 */}
            <rect x="12" y="10" width="40" height="36" rx="6" fill="#9C27B0" />
            {/* 白色横线 */}
            <rect x="18" y="16" width="28" height="4" fill="white" />
            <rect x="18" y="24" width="28" height="4" fill="white" />
            {/* 绿色向下箭头 */}
            <polygon points="32,58 44,46 20,46" fill="#4CAF50" />
            <rect x="28" y="36" width="8" height="10" fill="#4CAF50" />
          </svg>
        );
      
      case 'restore':
        // Java版: 橙色圆角矩形 + 白色横线 + 绿色向上箭头
        return (
          <svg width={size} height={size} viewBox="0 0 64 64">
            {/* 橙色数据库 */}
            <rect x="12" y="18" width="40" height="36" rx="6" fill="#E67E22" />
            {/* 白色横线 */}
            <rect x="18" y="24" width="28" height="4" fill="white" />
            <rect x="18" y="32" width="28" height="4" fill="white" />
            {/* 绿色向上箭头 */}
            <polygon points="32,10 20,22 44,22" fill="#27AE60" />
            <rect x="28" y="22" width="8" height="10" fill="#27AE60" />
          </svg>
        );
      
      case 'refresh':
        // Java版: 橙色圆环 + 三角形箭头
        return (
          <svg width={size} height={size} viewBox="0 0 64 64">
            {/* 橙色圆环 */}
            <circle 
              cx="32" 
              cy="32" 
              r="20" 
              fill="none" 
              stroke="#FF9800" 
              strokeWidth="8" 
              strokeLinecap="round"
            />
            {/* 箭头三角形 */}
            <polygon points="42,12 58,22 42,32" fill="#FF9800" />
          </svg>
        );
      
      case 'user':
        // Java版: 紫色圆形头部 + 弧形身体
        return (
          <svg width={size} height={size} viewBox="0 0 64 64">
            {/* 头部 */}
            <circle cx="32" cy="20" r="10" fill="#9C27B0" />
            {/* 身体 - 使用path绘制弧形 */}
            <path 
              d="M 12 52 Q 12 34 32 34 Q 52 34 52 52" 
              fill="#9C27B0" 
            />
          </svg>
        );
      
      default:
        return null;
    }
  };

  return (
    <div style={{ width: size, height: size }}>
      {renderIcon()}
    </div>
  );
};

export const ToolBar: React.FC = () => {
  const { t } = useTranslation();
  const { theme, setStatusMessage } = useAppStore();
  const { addTab } = useTabStore();
  const { connections, activeConnectionId, activeDatabase, getLastUsedDatabaseForConnection } = useConnectionStore();
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const activeConnection = connections.find((c) => c.profile.name === activeConnectionId);

  const handleGlobalRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent('dbw:global-refresh', { detail: { source: 'toolbar' } }));
    setStatusMessage(t('status.loading'));
  }, [setStatusMessage, t]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F5') {
        event.preventDefault();
        handleGlobalRefresh();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleGlobalRefresh]);

  const toolButtons: ToolButton[] = [
    {
      id: 'connection',
      label: t('toolbar.connection'),
      iconType: 'connection',
      shortcut: 'Ctrl+N',
      onClick: () => {
        setIsConnectionDialogOpen(true);
      },
    },
    {
      id: 'query',
      label: t('toolbar.query'),
      iconType: 'query',
      shortcut: 'Ctrl+Q',
      onClick: () => {
        const inheritedDatabase = activeDatabase || getLastUsedDatabaseForConnection(activeConnection?.profile.name);
        addTab({
          type: 'query',
          title: t('query.new'),
          connectionId: activeConnection?.profile.name,
          connectionProfile: activeConnection?.profile,
          database: inheritedDatabase,
        });
      },
    },
    {
      id: 'table',
      label: t('toolbar.table'),
      iconType: 'table',
      onClick: () => {
        if (!activeConnection?.profile || !activeDatabase) {
          void showToolbarRequirementNotice(t('database.tables'), 'database');
          return;
        }
        addTab({
          type: 'tableList',
          title: `${t('database.tables')} - ${activeDatabase}`,
          connectionId: activeConnection?.profile.name,
          connectionProfile: activeConnection?.profile,
          database: activeDatabase,
          objectType: 'TABLE',
        });
      },
    },
    {
      id: 'view',
      label: t('toolbar.view'),
      iconType: 'view',
      onClick: () => {
        if (!activeConnection?.profile || !activeDatabase) {
          void showToolbarRequirementNotice(t('database.views'), 'database');
          return;
        }
        addTab({
          type: 'viewList',
          title: `${t('database.views')} - ${activeDatabase}`,
          connectionId: activeConnection?.profile.name,
          connectionProfile: activeConnection?.profile,
          database: activeDatabase,
          objectType: 'VIEW',
        });
      },
    },
    {
      id: 'function',
      label: t('toolbar.function'),
      iconType: 'function',
      onClick: () => {
        if (!activeConnection?.profile || !activeDatabase) {
          void showToolbarRequirementNotice(t('database.functions'), 'database');
          return;
        }
        addTab({
          type: 'functionList',
          title: `${t('database.functions')} - ${activeDatabase}`,
          connectionId: activeConnection?.profile.name,
          connectionProfile: activeConnection?.profile,
          database: activeDatabase,
          objectType: 'FUNCTION',
        });
      },
    },
    {
      id: 'backup',
      label: t('toolbar.backup'),
      iconType: 'backup',
      onClick: () => {
        if (!activeConnection?.profile || !activeDatabase) {
          void showToolbarRequirementNotice(t('database.backup'), 'database');
          return;
        }
        addTab({
          type: 'backup',
          title: `${t('database.backup')} - ${activeDatabase}`,
          connectionId: activeConnection.profile.name,
          connectionProfile: activeConnection.profile,
          database: activeDatabase,
        });
      },
    },
    {
      id: 'restore',
      label: t('toolbar.restore'),
      iconType: 'restore',
      onClick: () => {
        if (!activeConnection?.profile) {
          void showToolbarRequirementNotice(t('database.restore'), 'connection');
          return;
        }
        addTab({
          type: 'restore',
          title: `${t('database.restore')} - ${activeConnection.profile.name || activeConnection.profile.host}`,
          connectionId: activeConnection.profile.name,
          connectionProfile: activeConnection.profile,
          database: activeDatabase || undefined,
        });
      },
    },
    {
      id: 'refresh',
      label: t('toolbar.refresh'),
      iconType: 'refresh',
      shortcut: 'F5',
      onClick: handleGlobalRefresh,
    },
    {
      id: 'user',
      label: t('toolbar.user'),
      iconType: 'user',
      onClick: () => {
        if (!activeConnection?.profile) {
          void showToolbarRequirementNotice(t('database.users'), 'connection');
          return;
        }
        addTab({
          type: 'userManager',
          title: t('database.users'),
          connectionId: activeConnection?.profile.name,
          connectionProfile: activeConnection?.profile,
        });
      },
    },
  ];

  return (
    <>
      <div className={`toolbar bp5-${theme}`}>
        <div className="toolbar-inner">
          {toolButtons.map((button) => (
            <button
              key={button.id}
              className="toolbar-item"
              onClick={button.onClick}
              title={`${button.label}${button.shortcut ? ` (${button.shortcut})` : ''}`}
            >
              <div className="toolbar-icon">
                <ToolbarIcon type={button.iconType} size={40} />
              </div>
              <span className="toolbar-label">{button.label}</span>
            </button>
          ))}
        </div>
      </div>
      
      <ConnectionDialog
        isOpen={isConnectionDialogOpen}
        onClose={() => setIsConnectionDialogOpen(false)}
      />
    </>
  );
};
