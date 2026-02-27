import React, { useEffect, useState } from 'react';
import {
  Dialog,
  Classes,
  Button,
  FormGroup,
  InputGroup,
  Spinner,
  HTMLSelect,
  Tabs,
  Tab,
  Switch,
} from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import { useConnectionStore } from '../../stores';
import { tauriApi } from '../../hooks';
import type { ConnectionProfile } from '../../types';

// 密码占位符，用于编辑模式
const PASSWORD_PLACEHOLDER = '123456';

// 常用字符集选项
const CHARSET_OPTIONS = [
  { value: '', label: '' },
  { value: 'utf8mb4', label: 'utf8mb4' },
  { value: 'utf8', label: 'utf8' },
  { value: 'latin1', label: 'latin1' },
  { value: 'gbk', label: 'gbk' },
  { value: 'gb2312', label: 'gb2312' },
  { value: 'big5', label: 'big5' },
];

// 常用排序规则选项（根据字符集动态变化）
const COLLATION_OPTIONS: Record<string, string[]> = {
  '': [''],
  utf8mb4: ['', 'utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_bin', 'utf8mb4_0900_ai_ci'],
  utf8: ['', 'utf8_general_ci', 'utf8_unicode_ci', 'utf8_bin'],
  latin1: ['', 'latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin'],
  gbk: ['', 'gbk_chinese_ci', 'gbk_bin'],
  gb2312: ['', 'gb2312_chinese_ci', 'gb2312_bin'],
  big5: ['', 'big5_chinese_ci', 'big5_bin'],
};

interface ConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  editProfile?: ConnectionProfile;
}

export const ConnectionDialog: React.FC<ConnectionDialogProps> = ({
  isOpen,
  onClose,
  editProfile,
}) => {
  const { t } = useTranslation();
  const { addConnection, updateConnection } = useConnectionStore();

  // 基础连接信息
  const [name, setName] = useState('');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(3306);
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [isPasswordPlaceholder, setIsPasswordPlaceholder] = useState(false);

  // 高级连接配置
  const [database, setDatabase] = useState('');
  const [charset, setCharset] = useState('utf8mb4');
  const [collation, setCollation] = useState('utf8mb4_general_ci');
  const [connectionTimeout, setConnectionTimeout] = useState(30); // 连接超时，默认 30 秒
  const [timeout, setTimeout] = useState(28800); // 空闲超时，默认 28800 秒（8小时）
  const [autoReconnect, setAutoReconnect] = useState(false); // 自动重连，默认 false（安全优先）
  const [sslMode, setSslMode] = useState<ConnectionProfile['sslMode']>('preferred');
  const [sslCaPath, setSslCaPath] = useState('');
  const [sslCertPath, setSslCertPath] = useState('');
  const [sslKeyPath, setSslKeyPath] = useState('');

  // UI 状态
  const [activeTab, setActiveTab] = useState('general');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // 当对话框打开时，根据是否为编辑模式初始化表单数据
  useEffect(() => {
    if (isOpen) {
      if (editProfile) {
        // 编辑模式：加载真实数据（不设置默认值，保持原样）
        setName(editProfile.name || '');
        setHost(editProfile.host || 'localhost');
        setPort(editProfile.port || 3306);
        setUsername(editProfile.username || 'root');
        // 编辑模式下使用密码占位符
        setPassword(PASSWORD_PLACEHOLDER);
        setIsPasswordPlaceholder(true);

        // 高级配置 - 加载真实数据，如果没有设置则使用默认值
        setDatabase(editProfile.database || '');
        setCharset(editProfile.charset || '');
        setCollation(editProfile.collation || '');
        setConnectionTimeout(editProfile.connectionTimeout || 30); // 连接超时默认 30
        setTimeout(editProfile.timeout || 28800); // 空闲超时默认 28800
        setAutoReconnect(editProfile.autoReconnect || false); // 自动重连默认 false（安全优先）
        setSslMode(editProfile.sslMode || 'preferred');
        setSslCaPath(editProfile.sslCaPath || '');
        setSslCertPath(editProfile.sslCertPath || '');
        setSslKeyPath(editProfile.sslKeyPath || '');
      } else {
        // 新建模式：使用默认值
        setName('');
        setHost('localhost');
        setPort(3306);
        setUsername('root');
        setPassword('');
        setIsPasswordPlaceholder(false);

        // 从设置中读取连接超时模板值和自动重连设置
        const settings = localStorage.getItem('dbw-settings');
        let defaultConnectionTimeout = 30;
        let defaultAutoReconnect = false; // 默认关闭自动重连（安全优先）
        if (settings) {
          try {
            const parsed = JSON.parse(settings);
            if (parsed.connectionTimeout !== undefined) {
              defaultConnectionTimeout = parsed.connectionTimeout;
            }
            if (parsed.autoReconnect !== undefined) {
              defaultAutoReconnect = parsed.autoReconnect;
            }
          } catch {
            // 忽略解析错误，使用默认值
          }
        }

        // 高级配置默认值
        setDatabase('');
        setCharset('utf8mb4');
        setCollation('utf8mb4_0900_ai_ci');
        setConnectionTimeout(defaultConnectionTimeout); // 使用设置中的连接超时模板值
        setTimeout(28800); // 空闲超时默认 28800 秒（8小时）
        setAutoReconnect(defaultAutoReconnect); // 使用设置中的自动重连默认值
        setSslMode('preferred');
        setSslCaPath('');
        setSslCertPath('');
        setSslKeyPath('');
      }
      setActiveTab('general');
      setTestResult(null);
    }
  }, [isOpen, editProfile]);

  // 当字符集改变时，更新排序规则（仅在新建模式下自动选择，编辑模式下保持原值）
  useEffect(() => {
    const availableCollations = COLLATION_OPTIONS[charset] || [''];
    // 如果当前排序规则不在可用列表中，则清空
    if (!availableCollations.includes(collation)) {
      setCollation('');
    }
  }, [charset]);

  const buildProfile = (): ConnectionProfile => {
    // 如果是编辑模式且密码仍是占位符，保留原密码
    const finalPassword = editProfile && isPasswordPlaceholder ? editProfile.password : password;

    return {
      name: name || undefined,
      host,
      port,
      username,
      password: finalPassword,
      database: database || undefined,
      charset,
      collation,
      timeout, // 空闲超时
      connectionTimeout, // 连接超时
      autoReconnect, // 自动重连
      sslMode,
      sslCaPath: sslCaPath || undefined,
      sslCertPath: sslCertPath || undefined,
      sslKeyPath: sslKeyPath || undefined,
    };
  };

  const handleTestConnection = async () => {
    if (!host || !username) return;

    setIsTesting(true);
    setTestResult(null);

    try {
      const profile = buildProfile();
      const success = await tauriApi.pool.testConnection(profile);

      if (success) {
        setTestResult({ success: true, message: t('dialog.connection.testSuccess') });
      } else {
        setTestResult({ success: false, message: t('dialog.connection.testFailed') });
      }
    } catch (error) {
      setTestResult({ success: false, message: String(error) });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    const profile = buildProfile();

    if (editProfile) {
      updateConnection(editProfile.name || '', profile);
    } else {
      addConnection(profile);
    }

    onClose();
  };

  const handleClose = () => {
    setTestResult(null);
    onClose();
  };

  // 渲染常规选项卡
  const renderGeneralTab = () => (
    <div className="connection-dialog-tab-content">
      <FormGroup label={t('dialog.connection.name')} labelFor="connection-name">
        <InputGroup
          id="connection-name"
          placeholder={t('dialog.connection.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </FormGroup>

      <FormGroup label={t('dialog.connection.host')} labelFor="host">
        <InputGroup
          id="host"
          placeholder={t('dialog.connection.hostPlaceholder')}
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
      </FormGroup>

      <FormGroup label={t('dialog.connection.port')} labelFor="port">
        <InputGroup
          id="port"
          type="number"
          min="1"
          max="65535"
          value={String(port)}
          onChange={(e) => setPort(parseInt(e.target.value) || 3306)}
        />
      </FormGroup>

      <FormGroup label={t('dialog.connection.username')} labelFor="username">
        <InputGroup
          id="username"
          placeholder={t('dialog.connection.usernamePlaceholder')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </FormGroup>

      <FormGroup label={t('dialog.connection.password')} labelFor="password">
        <InputGroup
          id="password"
          type="password"
          placeholder={t('dialog.connection.password')}
          value={password}
          onChange={(e) => {
            // 如果是占位符状态，用户开始输入时清空
            if (isPasswordPlaceholder) {
              setPassword(e.target.value);
              setIsPasswordPlaceholder(false);
            } else {
              setPassword(e.target.value);
            }
          }}
          onFocus={() => {
            // 获得焦点时如果是占位符，清空
            if (isPasswordPlaceholder) {
              setPassword('');
              setIsPasswordPlaceholder(false);
            }
          }}
        />
      </FormGroup>
    </div>
  );

  // 渲染高级选项卡
  const renderAdvancedTab = () => (
    <div className="connection-dialog-tab-content">
      <FormGroup label={t('dialog.connection.database')} labelFor="database">
        <InputGroup
          id="database"
          placeholder={t('dialog.connection.databasePlaceholder')}
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
        />
      </FormGroup>

      <FormGroup label={t('dialog.connection.charset')} labelFor="charset">
        <HTMLSelect
          id="charset"
          value={charset}
          onChange={(e) => setCharset(e.target.value)}
          options={CHARSET_OPTIONS}
          fill
        />
      </FormGroup>

      <FormGroup label={t('dialog.connection.collation')} labelFor="collation">
        <HTMLSelect
          id="collation"
          value={collation}
          onChange={(e) => setCollation(e.target.value)}
          options={(COLLATION_OPTIONS[charset] || ['utf8mb4_general_ci']).map((c) => ({
            value: c,
            label: c,
          }))}
          fill
        />
      </FormGroup>

      <FormGroup label={t('dialog.connection.connectionTimeout')} labelFor="connectionTimeout">
        <InputGroup
          id="connectionTimeout"
          type="number"
          min="1"
          max="300"
          value={String(connectionTimeout)}
          onChange={(e) => setConnectionTimeout(parseInt(e.target.value) || 30)}
        />
      </FormGroup>

      <FormGroup label={t('dialog.connection.timeout')} labelFor="timeout">
        <InputGroup
          id="timeout"
          type="number"
          min="1"
          max="86400"
          value={String(timeout)}
          onChange={(e) => setTimeout(parseInt(e.target.value) || 28800)}
        />
      </FormGroup>

      <FormGroup label={t('dialog.connection.autoReconnect')} labelFor="autoReconnect">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0' }}>
          <Switch
            id="autoReconnect"
            checked={autoReconnect}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAutoReconnect(e.target.checked)}
            style={{ transform: 'scale(1.2)' }}
          />
          <span style={{ fontSize: '13px', color: '#666' }}>
            {t('dialog.connection.autoReconnectDesc')}
          </span>
        </div>
      </FormGroup>
    </div>
  );

  // 渲染 SSL 选项卡
  const renderSslTab = () => (
    <div className="connection-dialog-tab-content">
      <FormGroup label={t('dialog.connection.sslMode')} labelFor="sslMode">
        <HTMLSelect
          id="sslMode"
          value={sslMode}
          onChange={(e) => setSslMode(e.target.value as ConnectionProfile['sslMode'])}
          options={[
            { value: 'disabled', label: t('dialog.connection.sslModes.disabled') },
            { value: 'preferred', label: t('dialog.connection.sslModes.preferred') },
            { value: 'required', label: t('dialog.connection.sslModes.required') },
            { value: 'verify-ca', label: t('dialog.connection.sslModes.verify-ca') },
            { value: 'verify-identity', label: t('dialog.connection.sslModes.verify-identity') },
          ]}
          fill
        />
      </FormGroup>

      <FormGroup label={t('dialog.connection.sslCaPath')} labelFor="sslCaPath">
        <InputGroup
          id="sslCaPath"
          placeholder={t('dialog.connection.sslCaPathPlaceholder')}
          value={sslCaPath}
          onChange={(e) => setSslCaPath(e.target.value)}
        />
      </FormGroup>

      <FormGroup label={t('dialog.connection.sslCertPath')} labelFor="sslCertPath">
        <InputGroup
          id="sslCertPath"
          placeholder={t('dialog.connection.sslCertPathPlaceholder')}
          value={sslCertPath}
          onChange={(e) => setSslCertPath(e.target.value)}
        />
      </FormGroup>

      <FormGroup label={t('dialog.connection.sslKeyPath')} labelFor="sslKeyPath">
        <InputGroup
          id="sslKeyPath"
          placeholder={t('dialog.connection.sslKeyPathPlaceholder')}
          value={sslKeyPath}
          onChange={(e) => setSslKeyPath(e.target.value)}
        />
      </FormGroup>
    </div>
  );

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={handleClose}
        title={editProfile ? t('dialog.connection.editTitle') : t('dialog.connection.title')}
        icon="database"
        className="connection-dialog"
        style={{ width: 450 }}
      >
        <div className={Classes.DIALOG_BODY}>
          <Tabs
            id="connection-dialog-tabs"
            selectedTabId={activeTab}
            onChange={(tabId) => setActiveTab(tabId as string)}
          >
            <Tab id="general" title={t('propertiesDialog.tabs.general')} panel={renderGeneralTab()} />
            <Tab id="advanced" title={t('propertiesDialog.tabs.advanced')} panel={renderAdvancedTab()} />
            <Tab id="ssl" title={t('dialog.connection.sslTab')} panel={renderSslTab()} />
          </Tabs>

          {testResult && (
            <div
              className={`connection-test-result ${
                testResult.success ? 'success' : 'error'
              }`}
            >
              {testResult.success ? '✓' : '✗'} {testResult.message}
            </div>
          )}
        </div>

        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={handleClose}>{t('common.cancel')}</Button>
            <Button onClick={handleTestConnection} loading={isTesting} disabled={isTesting}>
              {isTesting ? <Spinner size={16} /> : t('dialog.connection.testConnection')}
            </Button>
            <Button intent="primary" onClick={handleSave}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
};
