import React, { useEffect, useState } from 'react';
import {
  Dialog,
  Button,
  Icon,
  Callout,
} from '@blueprintjs/core';
import type { IconName } from '@blueprintjs/icons';
import { useTranslation } from 'react-i18next';
import { useConnectionStore } from '../../stores';
import { tauriApi } from '../../hooks';
import '../../styles/properties-dialog.css';

interface PropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = 'general' | 'connection' | 'database';

// 属性项组件
interface PropertyItemProps {
  label: string;
  value: string | number | boolean | undefined | null;
  isPassword?: boolean;
  isCopyable?: boolean;
}

const PropertyItem: React.FC<PropertyItemProps & { t: (key: string) => string }> = ({
  label,
  value,
  isPassword = false,
  isCopyable = true,
  t
}) => {
  const [copied, setCopied] = useState(false);
  const hasValue = value !== '' && value !== undefined && value !== null;

  const displayValue = isPassword
    ? '••••••••'
    : !hasValue
      ? '-'
      : String(value);

  const handleCopy = () => {
    if (isCopyable && !isPassword && hasValue) {
      navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="properties-item">
      <div className="properties-item-label">{label}</div>
      <div
        className={`properties-item-value ${isCopyable && !isPassword ? 'copyable' : ''} ${copied ? 'copied' : ''}`}
        onClick={handleCopy}
        title={isCopyable && !isPassword ? t('propertiesDialog.clickToCopy') : ''}
      >
        <span>{displayValue}</span>
        {isCopyable && !isPassword && hasValue && (
          <Icon icon={copied ? 'tick' : 'duplicate'} size={14} className="properties-copy-icon" />
        )}
      </div>
    </div>
  );
};

// 属性分组组件
interface PropertyGroupProps {
  title: string;
  children: React.ReactNode;
}

const PropertyGroup: React.FC<PropertyGroupProps> = ({ title, children }) => (
  <div className="properties-group">
    <div className="properties-group-title">{title}</div>
    <div className="properties-group-content">
      {children}
    </div>
  </div>
);

export const PropertiesDialog: React.FC<PropertiesDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [realProperties, setRealProperties] = useState<RealProperties | null>(null);
  const { connections, activeConnectionId, activeDatabase } = useConnectionStore();

  const activeConnection = connections.find(c => c.profile.name === activeConnectionId);

  useEffect(() => {
    let cancelled = false;

    const loadProperties = async () => {
      if (!isOpen || !activeConnection?.poolId) {
        setRealProperties(null);
        return;
      }

      try {
        const result = await tauriApi.pool.getConnectionProperties(
          activeConnection.poolId,
          activeDatabase ?? activeConnection.profile.database ?? null,
        );

        if (cancelled) return;

        setRealProperties({
          connectionStatus: result.connection_status,
          serverVersion: result.server_version ?? null,
          currentDatabase: result.current_database ?? null,
          charset: result.connection_charset ?? null,
          waitTimeoutSeconds: result.wait_timeout_seconds ?? null,
          sslMode: result.ssl_mode ?? null,
          tableCount: result.table_count ?? null,
          viewCount: result.view_count ?? null,
          functionCount: result.function_count ?? null,
          procedureCount: result.procedure_count ?? null,
        });
      } catch {
        if (cancelled) return;
        setRealProperties(null);
      }
    };

    void loadProperties();

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    activeConnection?.isConnected,
    activeConnection?.poolId,
    activeConnection?.profile.database,
    activeDatabase,
  ]);

  // Tab 配置
  const tabsConfig: { id: TabId; label: string; icon: IconName }[] = [
    { id: 'general', label: t('propertiesDialog.tabs.general'), icon: 'info-sign' },
    { id: 'connection', label: t('propertiesDialog.tabs.connection'), icon: 'data-connection' },
    { id: 'database', label: t('propertiesDialog.tabs.database'), icon: 'database' },
  ];

  // 获取连接状态
  const getConnectionStatus = () => {
    if (!activeConnection) return t('propertiesDialog.disconnected');
    const isConnected = realProperties?.connectionStatus ?? activeConnection.isConnected;
    return isConnected ? t('propertiesDialog.connected') : t('propertiesDialog.disconnected');
  };

  const getSslModeLabel = (value: string | null | undefined) => {
    if (!value) return t('propertiesDialog.unknown');
    const normalized = value.toLowerCase().replace(/_/g, '-');
    switch (normalized) {
      case 'disabled':
        return t('dialog.connection.sslModes.disabled');
      case 'preferred':
        return t('dialog.connection.sslModes.preferred');
      case 'required':
        return t('dialog.connection.sslModes.required');
      case 'verify-ca':
        return t('dialog.connection.sslModes.verify-ca');
      case 'verify-identity':
        return t('dialog.connection.sslModes.verify-identity');
      case 'enabled':
        return t('propertiesDialog.enabled');
      default:
        return value;
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title=""
      icon={null}
      className="properties-dialog-modern"
      style={{ width: 700, height: 500 }}
    >
      <div className="properties-dialog-container">
        {/* 左侧边栏 */}
        <div className="properties-sidebar">
          <div className="properties-sidebar-header">
            <Icon icon="properties" size={18} />
            <span>{t('propertiesDialog.title')}</span>
          </div>
          <nav className="properties-sidebar-nav">
            {tabsConfig.map((tab) => (
              <button
                key={tab.id}
                className={`properties-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon icon={tab.icon} size={16} />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
        
        {/* 右侧内容区 */}
        <div className="properties-content">
          <div className="properties-content-header">
            <h2>{tabsConfig.find(t => t.id === activeTab)?.label}</h2>
          </div>
          
          <div className="properties-content-body">
            {!activeConnection ? (
              <Callout intent="warning" icon="warning-sign" className="properties-callout">
                {t('propertiesDialog.noActiveConnection')}
              </Callout>
            ) : (
              <>
                {activeTab === 'general' && (
                  <GeneralPanel
                    connection={activeConnection}
                    database={realProperties?.currentDatabase ?? activeDatabase}
                    realProperties={realProperties}
                    t={t}
                  />
                )}
                {activeTab === 'connection' && (
                  <ConnectionPanel
                    connection={activeConnection}
                    realProperties={realProperties}
                    getSslModeLabel={getSslModeLabel}
                    t={t}
                  />
                )}
                {activeTab === 'database' && (
                  <DatabasePanel
                    connection={activeConnection}
                    database={realProperties?.currentDatabase ?? activeDatabase}
                    realProperties={realProperties}
                    t={t}
                  />
                )}
              </>
            )}
          </div>
          
          <div className="properties-content-footer">
            <div className="properties-footer-left">
              {activeConnection && (
                <span className="properties-status-indicator">
                  <span className={`status-dot ${(realProperties?.connectionStatus ?? activeConnection.isConnected) ? 'connected' : 'disconnected'}`} />
                  {getConnectionStatus()}
                </span>
              )}
            </div>
            <div className="properties-footer-right">
              <Button onClick={onClose} className="properties-btn-close">
                {t('common.close')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

// 常规信息面板
interface PanelProps {
  connection: any;
  database?: string | null;
  realProperties: RealProperties | null;
  t: (key: string) => string;
}

interface RealProperties {
  connectionStatus: boolean;
  serverVersion: string | null;
  currentDatabase: string | null;
  charset: string | null;
  waitTimeoutSeconds: number | null;
  sslMode: string | null;
  tableCount: number | null;
  viewCount: number | null;
  functionCount: number | null;
  procedureCount: number | null;
}

const GeneralPanel: React.FC<PanelProps> = ({ connection, database, realProperties, t }) => (
  <div className="properties-panel">
    <PropertyGroup title={t('propertiesDialog.groups.basicInfo')}>
      <PropertyItem label={t('propertiesDialog.labels.connectionName')} value={connection.profile.name} t={t} />
      <PropertyItem label={t('propertiesDialog.labels.connectionType')} value="MySQL" t={t} />
      <PropertyItem label={t('propertiesDialog.labels.currentStatus')} value={(realProperties?.connectionStatus ?? connection.isConnected) ? t('propertiesDialog.connected') : t('propertiesDialog.disconnected')} t={t} />
      <PropertyItem label={t('propertiesDialog.labels.currentDatabase')} value={database || t('propertiesDialog.notSelected')} t={t} />
    </PropertyGroup>

    <PropertyGroup title={t('propertiesDialog.groups.serverInfo')}>
      <PropertyItem label={t('propertiesDialog.labels.host')} value={connection.profile.host} t={t} />
      <PropertyItem label={t('propertiesDialog.labels.port')} value={connection.profile.port} t={t} />
      <PropertyItem label={t('propertiesDialog.labels.serverVersion')} value={realProperties?.serverVersion || t('propertiesDialog.unknown')} t={t} />
    </PropertyGroup>
  </div>
);

// 连接详情面板
const ConnectionPanel: React.FC<{
  connection: any;
  realProperties: RealProperties | null;
  getSslModeLabel: (value: string | null | undefined) => string;
  t: (key: string) => string;
}> = ({ connection, realProperties, getSslModeLabel, t }) => (
  <div className="properties-panel">
    <PropertyGroup title={t('propertiesDialog.groups.connectionConfig')}>
      <PropertyItem label={t('propertiesDialog.labels.host')} value={connection.profile.host} t={t} />
      <PropertyItem label={t('propertiesDialog.labels.port')} value={connection.profile.port} t={t} />
      <PropertyItem label={t('propertiesDialog.labels.username')} value={connection.profile.username} t={t} />
      <PropertyItem label={t('propertiesDialog.labels.password')} value="hidden" isPassword t={t} />
      <PropertyItem label={t('propertiesDialog.labels.defaultDatabase')} value={connection.profile.database || t('propertiesDialog.notSet')} t={t} />
    </PropertyGroup>

    <PropertyGroup title={t('propertiesDialog.groups.connectionParams')}>
      <PropertyItem label={t('propertiesDialog.labels.charset')} value={realProperties?.charset || connection.profile.charset || t('propertiesDialog.unknown')} t={t} />
      <PropertyItem
        label={t('propertiesDialog.labels.connectionTimeout')}
        value={connection.profile.connectionTimeout != null
          ? `${connection.profile.connectionTimeout} ${t('propertiesDialog.seconds')}`
          : `30 ${t('propertiesDialog.seconds')}`}
        t={t}
      />
      <PropertyItem
        label={t('propertiesDialog.labels.timeout')}
        value={connection.profile.timeout != null
          ? `${connection.profile.timeout} ${t('propertiesDialog.seconds')}`
          : (realProperties?.waitTimeoutSeconds != null
            ? `${realProperties.waitTimeoutSeconds} ${t('propertiesDialog.seconds')}`
            : `28800 ${t('propertiesDialog.seconds')}`)}
        t={t}
      />
      <PropertyItem
        label={t('propertiesDialog.labels.autoReconnect')}
        value={connection.profile.autoReconnect ? t('propertiesDialog.enabled') : t('propertiesDialog.disabled')}
        t={t}
      />
      <PropertyItem
        label={t('propertiesDialog.labels.sslMode')}
        value={getSslModeLabel(realProperties?.sslMode || connection.profile.sslMode)}
        t={t}
      />
    </PropertyGroup>
  </div>
);

// 数据库信息面板
const DatabasePanel: React.FC<PanelProps> = ({ connection, database, realProperties, t }) => (
  <div className="properties-panel">
    <PropertyGroup title={t('propertiesDialog.groups.databaseInfo')}>
      <PropertyItem label={t('propertiesDialog.labels.currentDatabase')} value={database || t('propertiesDialog.notSelected')} t={t} />
      <PropertyItem label={t('propertiesDialog.labels.databaseType')} value="MySQL" t={t} />
      <PropertyItem label={t('propertiesDialog.labels.charset')} value={realProperties?.charset || connection.profile.charset || t('propertiesDialog.unknown')} t={t} />
    </PropertyGroup>

    <PropertyGroup title={t('propertiesDialog.groups.statistics')}>
      <PropertyItem label={t('propertiesDialog.labels.tableCount')} value={realProperties?.tableCount ?? '-'} isCopyable={false} t={t} />
      <PropertyItem label={t('propertiesDialog.labels.viewCount')} value={realProperties?.viewCount ?? '-'} isCopyable={false} t={t} />
      <PropertyItem label={t('propertiesDialog.labels.procedureCount')} value={realProperties?.procedureCount ?? '-'} isCopyable={false} t={t} />
      <PropertyItem label={t('propertiesDialog.labels.functionCount')} value={realProperties?.functionCount ?? '-'} isCopyable={false} t={t} />
    </PropertyGroup>
  </div>
);


