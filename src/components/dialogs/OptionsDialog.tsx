import React, { useState, useEffect } from 'react';
import {
  Dialog,
  Button,
  NumericInput,
  HTMLSelect,
  Callout,
  Icon,
} from '@blueprintjs/core';
import type { IconName } from '@blueprintjs/icons';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores';
import '../../styles/options-dialog.css';

interface OptionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = 'general' | 'editor' | 'interface' | 'connection';
type TabCloseButtonType = 'hover' | 'always';

// 默认设置值
const defaultSettings = {
  showWelcomePage: true,
  autoCheckUpdate: true,
  language: 'zh-CN',
  editorFontSize: 14,
  editorAutoSave: false,
  editorAutoComplete: true,
  editorTabSize: 2,
  editorMinimap: true,
  sidebarDefaultCollapsed: false,
  statusBarVisible: true,
  tabCloseButton: 'hover' as TabCloseButtonType,
  connectionTimeout: 30,
  autoReconnect: false,
  maxConnections: 10,
};

// 获取翻译后的标签页配置
const useTabsConfig = () => {
  const { t } = useTranslation();
  return [
    { id: 'general' as TabId, label: t('dialog.options.general.title'), icon: 'settings' as IconName },
    { id: 'editor' as TabId, label: t('dialog.options.editor.title'), icon: 'code' as IconName },
    { id: 'interface' as TabId, label: t('dialog.options.interface.title'), icon: 'desktop' as IconName },
    { id: 'connection' as TabId, label: t('dialog.options.connection.title'), icon: 'database' as IconName },
  ];
};

export const OptionsDialog: React.FC<OptionsDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('general');
  
  const {
    theme,
    sidebarCollapsed,
    statusBarVisible,
    toggleSidebar,
    toggleStatusBar,
    setTheme,
  } = useAppStore();
  
  const [settings, setSettings] = useState(defaultSettings);
  const [hasChanges, setHasChanges] = useState(false);
  
  // 加载已保存的设置
  useEffect(() => {
    const savedSettings = localStorage.getItem('dbw-settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setSettings(prev => ({ ...prev, ...parsed }));
      } catch {
        // 忽略解析错误
      }
    }
  }, []);
  
  // 更新设置
  const updateSetting = <K extends keyof typeof settings>(
    key: K,
    value: typeof settings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };
  
  // 保存设置
  const handleSave = () => {
    localStorage.setItem('dbw-settings', JSON.stringify(settings));

    // 语言设置将在重启后生效

    if (settings.sidebarDefaultCollapsed !== sidebarCollapsed) {
      toggleSidebar();
    }
    if (settings.statusBarVisible !== statusBarVisible) {
      toggleStatusBar();
    }

    window.dispatchEvent(new CustomEvent('dbw:settings-changed', {
      detail: settings
    }));

    // Notify interface settings changed (for tab close button)
    window.dispatchEvent(new CustomEvent('dbw:interface-settings-changed', {
      detail: {
        statusBarVisible: settings.statusBarVisible,
        tabCloseButton: settings.tabCloseButton
      }
    }));

    setHasChanges(false);
    onClose();
  };
  
  // 恢复默认设置
  const handleReset = () => {
    setSettings(defaultSettings);
    setHasChanges(true);
  };
  
  // 取消并关闭
  const handleCancel = () => {
    // 重新加载保存的设置，放弃当前修改
    const savedSettings = localStorage.getItem('dbw-settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setSettings(prev => ({ ...prev, ...parsed }));
      } catch {
        setSettings(defaultSettings);
      }
    } else {
      setSettings(defaultSettings);
    }
    setHasChanges(false);
    onClose();
  };

  const languageOptions = [
    { value: 'zh-CN', label: t('language.zhCN') },
    { value: 'en-US', label: t('language.enUS') },
  ];

  const tabsConfigTranslated = useTabsConfig();
  
  const tabCloseButtonOptions = [
    { value: 'hover', label: t('dialog.options.interface.tabCloseButtonHover') },
    { value: 'always', label: t('dialog.options.interface.tabCloseButtonAlways') },
  ];

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleCancel}
      title=""
      icon={null}
      className="options-dialog-modern"
      style={{ width: 800, height: 550 }}
    >
      <div className="options-dialog-container">
        {/* 左侧导航栏 */}
        <div className="options-sidebar">
          <div className="options-sidebar-header">
            <Icon icon="cog" size={18} />
            <span>{t('dialog.options.title')}</span>
          </div>
          <nav className="options-sidebar-nav">
            {tabsConfigTranslated.map((tab) => (
              <button
                key={tab.id}
                className={`options-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon icon={tab.icon} size={16} />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
        
        {/* 右侧内容区 */}
        <div className="options-content">
          <div className="options-content-header">
            <h2>{tabsConfigTranslated.find(t => t.id === activeTab)?.label}</h2>
          </div>
          
          <div className="options-content-body">
            {activeTab === 'general' && (
              <GeneralPanel 
                settings={settings} 
                updateSetting={updateSetting}
                languageOptions={languageOptions}
              />
            )}
            {activeTab === 'editor' && (
              <EditorPanel 
                settings={settings} 
                updateSetting={updateSetting}
              />
            )}
            {activeTab === 'interface' && (
              <InterfacePanel 
                settings={settings} 
                updateSetting={updateSetting}
                theme={theme}
                setTheme={setTheme}
                setHasChanges={setHasChanges}
                tabCloseButtonOptions={tabCloseButtonOptions}
              />
            )}
            {activeTab === 'connection' && (
              <ConnectionPanel 
                settings={settings} 
                updateSetting={updateSetting}
              />
            )}
          </div>
          
          <div className="options-content-footer">
            <div className="options-footer-left">
              {hasChanges && (
                <span className="options-unsaved-indicator">{t('query.unsavedChanges')}</span>
              )}
            </div>
            <div className="options-footer-right">
              <Button minimal onClick={handleReset} className="options-btn-reset">
                {t('common.reset')}
              </Button>
              <Button onClick={handleCancel} className="options-btn-cancel">
                {t('common.cancel')}
              </Button>
              <Button 
                intent="primary" 
                onClick={handleSave}
                className="options-btn-save"
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

// 自定义 Switch 组件
interface CustomSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const CustomSwitch: React.FC<CustomSwitchProps> = ({ checked, onChange }) => (
  <label className="options-custom-switch">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className="options-custom-switch-slider" />
  </label>
);

// 设置项组件 - 开关
interface SettingItemSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const SettingItemSwitch: React.FC<SettingItemSwitchProps> = ({
  label,
  description,
  checked,
  onChange,
}) => (
  <div className="options-setting-item">
    <div className="options-setting-info">
      <div className="options-setting-label">{label}</div>
      {description && (
        <div className="options-setting-description">{description}</div>
      )}
    </div>
    <CustomSwitch checked={checked} onChange={onChange} />
  </div>
);

// 设置项组件 - 数字输入
interface SettingItemNumberProps {
  label: string;
  description?: string;
  value: number;
  min?: number;
  max?: number;
  stepSize?: number;
  suffix?: string;
  onChange: (value: number) => void;
}

const SettingItemNumber: React.FC<SettingItemNumberProps> = ({
  label,
  description,
  value,
  min,
  max,
  stepSize = 1,
  suffix,
  onChange,
}) => (
  <div className="options-setting-item">
    <div className="options-setting-info">
      <div className="options-setting-label">{label}</div>
      {description && (
        <div className="options-setting-description">{description}</div>
      )}
    </div>
    <div className="options-setting-control options-setting-control-number">
      <NumericInput
        value={value}
        min={min}
        max={max}
        stepSize={stepSize}
        onValueChange={onChange}
        buttonPosition="right"
        style={{ width: 80 }}
      />
      {suffix && <span className="options-setting-suffix">{suffix}</span>}
    </div>
  </div>
);

// 设置项组件 - 下拉选择
interface SettingItemSelectProps {
  label: string;
  description?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

const SettingItemSelect: React.FC<SettingItemSelectProps> = ({
  label,
  description,
  value,
  options,
  onChange,
}) => (
  <div className="options-setting-item">
    <div className="options-setting-info">
      <div className="options-setting-label">{label}</div>
      {description && (
        <div className="options-setting-description">{description}</div>
      )}
    </div>
    <HTMLSelect
      value={value}
      options={options}
      onChange={(e) => onChange(e.currentTarget.value)}
      className="options-setting-control options-setting-control-select"
    />
  </div>
);

// 设置分组组件
interface SettingGroupProps {
  title?: string;
  children: React.ReactNode;
}

const SettingGroup: React.FC<SettingGroupProps> = ({ title, children }) => (
  <div className="options-setting-group">
    {title && <div className="options-setting-group-title">{title}</div>}
    <div className="options-setting-group-content">
      {children}
    </div>
  </div>
);

// 常规设置面板
interface GeneralPanelProps {
  settings: typeof defaultSettings;
  updateSetting: <K extends keyof typeof defaultSettings>(
    key: K,
    value: typeof defaultSettings[K]
  ) => void;
  languageOptions: { value: string; label: string }[];
}

const GeneralPanel: React.FC<GeneralPanelProps> = ({
  settings,
  updateSetting,
  languageOptions,
}) => {
  const { t } = useTranslation();
  return (
    <div className="options-panel">
      <SettingGroup title={t('dialog.options.general.startupOptions')}>
        <SettingItemSwitch
          label={t('dialog.options.general.showWelcome')}
          description={t('dialog.options.general.showWelcomeDesc')}
          checked={settings.showWelcomePage}
          onChange={(v) => updateSetting('showWelcomePage', v)}
        />
        <SettingItemSwitch
          label={t('dialog.options.general.autoCheckUpdate')}
          description={t('dialog.options.general.autoCheckUpdateDesc')}
          checked={settings.autoCheckUpdate}
          onChange={(v) => updateSetting('autoCheckUpdate', v)}
        />
      </SettingGroup>
      
      <SettingGroup title={t('dialog.options.general.language')}>
        <SettingItemSelect
          label={t('dialog.options.general.language')}
          description=""
          value={settings.language}
          options={languageOptions}
          onChange={(v) => updateSetting('language', v)}
        />
      </SettingGroup>
      
      <Callout intent="primary" icon="info-sign" className="options-callout-modern">
        {t('dialog.options.general.languageTooltip')}
      </Callout>
    </div>
  );
};

// 编辑器设置面板
interface EditorPanelProps {
  settings: typeof defaultSettings;
  updateSetting: <K extends keyof typeof defaultSettings>(
    key: K,
    value: typeof defaultSettings[K]
  ) => void;
}

const EditorPanel: React.FC<EditorPanelProps> = ({ settings, updateSetting }) => {
  const { t } = useTranslation();
  return (
    <div className="options-panel">
      <SettingGroup title={t('dialog.options.editor.fontAndLayout')}>
        <SettingItemNumber
          label={t('dialog.options.editor.fontSize')}
          description={t('dialog.options.editor.fontSizeDesc')}
          value={settings.editorFontSize}
          min={12}
          max={20}
          suffix="px"
          onChange={(v) => updateSetting('editorFontSize', v)}
        />
        <SettingItemNumber
          label={t('dialog.options.editor.tabSize')}
          description={t('dialog.options.editor.tabSizeDesc')}
          value={settings.editorTabSize}
          min={2}
          max={8}
          stepSize={2}
          suffix={t('dialog.options.editor.spaces')}
          onChange={(v) => updateSetting('editorTabSize', v)}
        />
      </SettingGroup>
      
      <SettingGroup title={t('dialog.options.editor.behavior')}>
        <SettingItemSwitch
          label={t('dialog.options.editor.autoSave')}
          description={t('dialog.options.editor.autoSaveDesc')}
          checked={settings.editorAutoSave}
          onChange={(v) => updateSetting('editorAutoSave', v)}
        />
        <SettingItemSwitch
          label={t('dialog.options.editor.autoComplete')}
          description={t('dialog.options.editor.autoCompleteDesc')}
          checked={settings.editorAutoComplete}
          onChange={(v) => updateSetting('editorAutoComplete', v)}
        />
        <SettingItemSwitch
          label={t('dialog.options.editor.minimap')}
          description={t('dialog.options.editor.minimapDesc')}
          checked={settings.editorMinimap}
          onChange={(v) => updateSetting('editorMinimap', v)}
        />
      </SettingGroup>
    </div>
  );
};

// 界面设置面板
interface InterfacePanelProps {
  settings: typeof defaultSettings;
  updateSetting: <K extends keyof typeof defaultSettings>(
    key: K,
    value: typeof defaultSettings[K]
  ) => void;
  theme: string;
  setTheme: (theme: 'light' | 'dark') => void;
  setHasChanges: (has: boolean) => void;
  tabCloseButtonOptions: { value: string; label: string }[];
}

const InterfacePanel: React.FC<InterfacePanelProps> = ({
  settings,
  updateSetting,
  theme,
  setTheme,
  setHasChanges,
  tabCloseButtonOptions,
}) => {
  const { t } = useTranslation();
  return (
    <div className="options-panel">
      <SettingGroup title={t('dialog.options.interface.appearance')}>
        <div className="options-setting-item">
          <div className="options-setting-info">
            <div className="options-setting-label">{t('dialog.options.interface.theme')}</div>
            <div className="options-setting-description">{t('dialog.options.interface.themeDesc')}</div>
          </div>
          <div className="options-setting-control">
            <div className="options-theme-cards">
              <button
                className={`options-theme-card ${theme === 'light' ? 'active' : ''}`}
                onClick={() => {
                  setTheme('light');
                  setHasChanges(true);
                }}
              >
                <div className="options-theme-preview options-theme-preview-light">
                  <div className="options-theme-preview-header" />
                  <div className="options-theme-preview-sidebar" />
                  <div className="options-theme-preview-content" />
                </div>
                <span className="options-theme-card-label">{t('theme.light')}</span>
              </button>
              <button
                className={`options-theme-card ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => {
                  setTheme('dark');
                  setHasChanges(true);
                }}
              >
                <div className="options-theme-preview options-theme-preview-dark">
                  <div className="options-theme-preview-header" />
                  <div className="options-theme-preview-sidebar" />
                  <div className="options-theme-preview-content" />
                </div>
                <span className="options-theme-card-label">{t('theme.dark')}</span>
              </button>
            </div>
          </div>
        </div>
      </SettingGroup>
      
      <SettingGroup title={t('dialog.options.interface.elements')}>
        <SettingItemSwitch
          label={t('dialog.options.interface.sidebarDefaultCollapsed')}
          description={t('dialog.options.interface.sidebarDefaultCollapsedDesc')}
          checked={settings.sidebarDefaultCollapsed}
          onChange={(v) => updateSetting('sidebarDefaultCollapsed', v)}
        />
        <SettingItemSwitch
          label={t('dialog.options.interface.statusBarVisible')}
          description={t('dialog.options.interface.statusBarVisibleDesc')}
          checked={settings.statusBarVisible}
          onChange={(v) => updateSetting('statusBarVisible', v)}
        />
        <SettingItemSelect
          label={t('dialog.options.interface.tabCloseButton')}
          description={t('dialog.options.interface.tabCloseButtonDesc')}
          value={settings.tabCloseButton}
          options={tabCloseButtonOptions}
          onChange={(v) => updateSetting('tabCloseButton', v as TabCloseButtonType)}
        />
      </SettingGroup>
    </div>
  );
};

// 连接设置面板
interface ConnectionPanelProps {
  settings: typeof defaultSettings;
  updateSetting: <K extends keyof typeof defaultSettings>(
    key: K,
    value: typeof defaultSettings[K]
  ) => void;
}

const ConnectionPanel: React.FC<ConnectionPanelProps> = ({
  settings,
  updateSetting,
}) => {
  const { t } = useTranslation();
  return (
    <div className="options-panel">
      <SettingGroup title={t('dialog.options.connection.config')}>
        <SettingItemNumber
          label={t('dialog.options.connection.timeout')}
          description={t('dialog.options.connection.timeoutDesc')}
          value={settings.connectionTimeout}
          min={5}
          max={300}
          stepSize={5}
          suffix={t('dialog.options.connection.seconds')}
          onChange={(v) => updateSetting('connectionTimeout', v)}
        />
        <SettingItemNumber
          label={t('dialog.options.connection.maxConnections')}
          description={t('dialog.options.connection.maxConnectionsDesc')}
          value={settings.maxConnections}
          min={1}
          max={50}
          suffix={t('dialog.options.connection.count')}
          onChange={(v) => updateSetting('maxConnections', v)}
        />
      </SettingGroup>
      
      <SettingGroup title={t('dialog.options.connection.advanced')}>
        <SettingItemSwitch
          label={t('dialog.options.connection.autoReconnect')}
          description={t('dialog.options.connection.autoReconnectDesc')}
          checked={settings.autoReconnect}
          onChange={(v) => updateSetting('autoReconnect', v)}
        />
      </SettingGroup>
      
      <Callout intent="warning" icon="warning-sign" className="options-callout-modern">
        {t('dialog.options.connection.autoReconnectWarning')}
      </Callout>
    </div>
  );
};
