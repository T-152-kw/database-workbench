import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Tabs,
  Tab,
  FormGroup,
  InputGroup,
  Checkbox,
  Button,
  HTMLSelect,
  Spinner,
  Intent,
  Callout,
} from '@blueprintjs/core';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { ConnectionProfile, UserModel } from '../../types';
import { metadataApi } from '../../hooks/useTauri';
import { useAppStore } from '../../stores';
import { ConfirmDialog } from '../dialogs';
import { registerEditor, unregisterEditor, getEditorSettings, applySettingsToAllEditors } from '../../utils/editorSettings';
import '../../styles/user-editor-tab.css';

interface UserEditorTabProps {
  tabId: string;
  connectionProfile: ConnectionProfile;
  username?: string;
  host?: string;
}

const SERVER_PRIVILEGES: string[] = [
  'Alter',
  'Alter Routine',
  'Create',
  'Create Role',
  'Create Routine',
  'Create Tablespace',
  'Create Temporary Tables',
  'Create User',
  'Create View',
  'Delete',
  'Drop',
  'Drop Role',
  'Event',
  'Execute',
  'File',
  'Grant Option',
  'Index',
  'Insert',
  'Lock Tables',
  'Process',
  'References',
  'Reload',
  'Replication Client',
  'Replication Slave',
  'Select',
  'Show Databases',
  'Show View',
  'Shutdown',
  'Super',
  'System User',
  'Trigger',
  'Update',
];

const DATABASE_SCOPE_PRIVILEGES: string[] = [
  'Alter',
  'Alter Routine',
  'Create',
  'Create Routine',
  'Create Temporary Tables',
  'Create View',
  'Delete',
  'Drop',
  'Event',
  'Execute',
  'Grant Option',
  'Index',
  'Insert',
  'Lock Tables',
  'References',
  'Select',
  'Show View',
  'Trigger',
  'Update',
];

const COLUMN_LEVEL_PRIVILEGES = new Set(['Select', 'Insert', 'Update', 'References']);

const AUTH_PLUGINS: string[] = [
  'caching_sha2_password',
  'mysql_native_password',
  'sha256_password',
  'auth_socket',
  'mysql_no_login',
];

const SYSTEM_USERS = new Set(['root', 'mysql.sys', 'mysql.session', 'mysql.infoschema']);

const createEmptyUserModel = (): UserModel => ({
  username: '',
  host: '%',
  plugin: 'mysql_native_password',
  password: '',
  serverPrivileges: [],
  databasePrivileges: {},
});

const parseScopeKey = (scope: string): { db: string; table: string; column: string } => {
  const parts = scope.split('.');
  if (parts.length >= 3) {
    return { db: parts[0] || '', table: parts[1] || '*', column: parts.slice(2).join('.') || '*' };
  }
  if (parts.length === 2) {
    return { db: parts[0] || '', table: parts[1] || '*', column: '*' };
  }
  return { db: parts[0] || '', table: '*', column: '*' };
};

const buildScopeKey = (db: string, table: string, column: string): string => `${db}.${table}.${column}`;

export const UserEditorTab: React.FC<UserEditorTabProps> = ({
  connectionProfile,
  username,
  host,
}) => {
  const isNewUser = !username || !host;
  const { theme } = useAppStore();
  const { t } = useTranslation();

  const [isLoading, setIsLoading] = useState(!isNewUser);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [userModel, setUserModel] = useState<UserModel>(createEmptyUserModel());
  const [originalUserModel, setOriginalUserModel] = useState<UserModel | undefined>(undefined);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [generatedSql, setGeneratedSql] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<string>('');
  const [selectedTable, setSelectedTable] = useState<string>('*');
  const [selectedColumn, setSelectedColumn] = useState<string>('*');
  const [tableOptions, setTableOptions] = useState<string[]>([]);
  const [columnOptions, setColumnOptions] = useState<string[]>([]);
  const [tableCache, setTableCache] = useState<Record<string, string[]>>({});
  const [columnCache, setColumnCache] = useState<Record<string, string[]>>({});
  const [activeTabId, setActiveTabId] = useState<string>('general');
  const [systemUserConfirmOpen, setSystemUserConfirmOpen] = useState(false);
  const [editorSettings, setEditorSettings] = useState(getEditorSettings());
  const sqlEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // 监听设置变更事件
  useEffect(() => {
    const handleSettingsChanged = () => {
      const newSettings = getEditorSettings();
      setEditorSettings(newSettings);
      // 应用设置到所有编辑器
      applySettingsToAllEditors();
    };

    window.addEventListener('dbw:settings-changed', handleSettingsChanged as EventListener);
    return () => {
      window.removeEventListener('dbw:settings-changed', handleSettingsChanged as EventListener);
    };
  }, []);

  const handleSqlEditorMount = useCallback((
    editorInstance: editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor'),
  ) => {
    sqlEditorRef.current = editorInstance;
    // 注册只读编辑器
    registerEditor(editorInstance, monaco);
    return () => {
      unregisterEditor(editorInstance);
    };
  }, []);

  useEffect(() => {
    const loadUserData = async () => {
      if (!isNewUser && username && host) {
        setIsLoading(true);
        setError(null);
        try {
          const model = await metadataApi.getUserModel(connectionProfile, username, host);
          const user: UserModel = {
            username: model.username,
            host: model.host,
            plugin: model.plugin,
            password: '',
            serverPrivileges: model.serverPrivileges || [],
            databasePrivileges: model.databasePrivileges || {},
          };
          setUserModel(user);
          setOriginalUserModel(user);
        } catch (err) {
          setError(t('userEditor.errors.loadFailed', { error: err }));
        } finally {
          setIsLoading(false);
        }
      }
    };

    loadUserData();
  }, [connectionProfile, username, host, isNewUser]);

  useEffect(() => {
    const loadDatabases = async () => {
      try {
        const dbList = await metadataApi.getAllDatabases(connectionProfile);
        setDatabases(dbList);
        if (dbList.length > 0) {
          setSelectedDatabase(dbList[0]);
        }
      } catch (err) {
        console.error('加载数据库列表失败:', err);
      }
    };

    loadDatabases();
  }, [connectionProfile]);

  useEffect(() => {
    setSelectedTable('*');
    setSelectedColumn('*');
  }, [selectedDatabase]);

  useEffect(() => {
    const loadTables = async () => {
      if (!selectedDatabase) {
        setTableOptions([]);
        return;
      }
      if (tableCache[selectedDatabase]) {
        setTableOptions(tableCache[selectedDatabase]);
        return;
      }
      try {
        const tables = await metadataApi.listTables(connectionProfile, selectedDatabase);
        setTableCache((prev) => ({ ...prev, [selectedDatabase]: tables }));
        setTableOptions(tables);
      } catch (err) {
        console.error('加载表列表失败:', err);
        setTableOptions([]);
      }
    };

    loadTables();
  }, [connectionProfile, selectedDatabase, tableCache]);

  useEffect(() => {
    setSelectedColumn('*');

    const loadColumns = async () => {
      if (!selectedDatabase || !selectedTable || selectedTable === '*') {
        setColumnOptions([]);
        return;
      }

      const cacheKey = `${selectedDatabase}.${selectedTable}`;
      if (columnCache[cacheKey]) {
        setColumnOptions(columnCache[cacheKey]);
        return;
      }

      try {
        const columns = await metadataApi.listColumns(connectionProfile, selectedDatabase, selectedTable);
        const colNames = columns
          .map((c) => c.COLUMN_NAME)
          .filter((name): name is string => typeof name === 'string' && name.length > 0);
        setColumnCache((prev) => ({ ...prev, [cacheKey]: colNames }));
        setColumnOptions(colNames);
      } catch (err) {
        console.error('加载字段列表失败:', err);
        setColumnOptions([]);
      }
    };

    loadColumns();
  }, [connectionProfile, selectedDatabase, selectedTable, columnCache]);

  const generateSqlPreview = useCallback(async () => {
    try {
      const sql = await metadataApi.generateUserSql(
        userModel,
        isNewUser,
        originalUserModel,
      );
      setGeneratedSql(sql);
    } catch (err) {
      setGeneratedSql(t('userEditor.errors.generateSqlFailed', { error: err }));
    }
  }, [userModel, isNewUser, originalUserModel, t]);

  useEffect(() => {
    generateSqlPreview();
  }, [generateSqlPreview]);

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserModel((prev) => ({ ...prev, username: e.target.value }));
  };

  const handleHostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserModel((prev) => ({ ...prev, host: e.target.value }));
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserModel((prev) => ({ ...prev, password: e.target.value }));
  };

  const handlePluginChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setUserModel((prev) => ({ ...prev, plugin: e.target.value }));
  };

  const handleConfirmPasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfirmPassword(e.target.value);
  };

  const handleServerPrivilegeChange = (privilege: string, checked: boolean) => {
    setUserModel((prev) => {
      const privileges = checked
        ? [...prev.serverPrivileges, privilege]
        : prev.serverPrivileges.filter((p) => p !== privilege);
      return { ...prev, serverPrivileges: privileges };
    });
  };

  const handleDatabasePrivilegeChange = (scope: string, privilege: string, checked: boolean) => {
    setUserModel((prev) => {
      const dbPrivileges = { ...prev.databasePrivileges };
      if (!dbPrivileges[scope]) {
        dbPrivileges[scope] = [];
      }
      if (checked) {
        if (!dbPrivileges[scope].includes(privilege)) {
          dbPrivileges[scope] = [...dbPrivileges[scope], privilege];
        }
      } else {
        dbPrivileges[scope] = dbPrivileges[scope].filter((p) => p !== privilege);
        if (dbPrivileges[scope].length === 0) {
          delete dbPrivileges[scope];
        }
      }
      return { ...prev, databasePrivileges: dbPrivileges };
    });
  };

  const handleAddDatabasePrivileges = () => {
    if (!selectedDatabase) return;
    const scopeKey = buildScopeKey(selectedDatabase, selectedTable || '*', selectedColumn || '*');
    setUserModel((prev) => {
      const dbPrivileges = { ...prev.databasePrivileges };
      if (!dbPrivileges[scopeKey]) {
        dbPrivileges[scopeKey] = [];
      }
      return { ...prev, databasePrivileges: dbPrivileges };
    });
  };

  const handleRemoveDatabasePrivileges = (scope: string) => {
    setUserModel((prev) => {
      const dbPrivileges = { ...prev.databasePrivileges };
      delete dbPrivileges[scope];
      return { ...prev, databasePrivileges: dbPrivileges };
    });
  };

  const executeSave = async () => {
    setError(null);
    setSuccessMessage(null);

    if (!userModel.username.trim()) {
      setError(t('userEditor.errors.usernameRequired'));
      return;
    }

    if (!userModel.host.trim()) {
      setError(t('userEditor.errors.hostRequired'));
      return;
    }

    if (isNewUser) {
      if (!userModel.password) {
        setError(t('userEditor.errors.passwordRequired'));
        return;
      }
      if (userModel.password !== confirmPassword) {
        setError(t('userEditor.errors.passwordMismatch'));
        return;
      }
    } else if (userModel.password && userModel.password !== confirmPassword) {
      setError(t('userEditor.errors.passwordMismatch'));
      return;
    }

    setIsSaving(true);
    try {
      await metadataApi.executeSql(connectionProfile, generatedSql);
      setSuccessMessage(isNewUser ? t('userEditor.success.userCreated') : t('userEditor.success.userUpdated'));
      if (isNewUser) {
        setOriginalUserModel({ ...userModel, password: '' });
        setUserModel((prev) => ({ ...prev, password: '' }));
        setConfirmPassword('');
      } else if (originalUserModel) {
        setOriginalUserModel({ ...userModel, password: '' });
        setUserModel((prev) => ({ ...prev, password: '' }));
        setConfirmPassword('');
      }
      generateSqlPreview();
    } catch (err) {
      setError(t('userEditor.errors.saveFailed', { error: err }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    const hasChanges = generatedSql.trim().length > 0;
    const isEditingSystemUser = !isNewUser && !!originalUserModel && SYSTEM_USERS.has(originalUserModel.username.toLowerCase());
    if (isEditingSystemUser && hasChanges) {
      setSystemUserConfirmOpen(true);
      return;
    }
    await executeSave();
  };

  if (isLoading) {
    return (
      <div className="user-editor-loading">
        <Spinner size={50} />
        <span>{t('userEditor.loading')}</span>
      </div>
    );
  }

  const renderGeneralTab = () => (
    <div className="user-editor-tab-content">
      <FormGroup label={t('userEditor.form.username')} labelFor="username" labelInfo={!isNewUser ? t('userEditor.form.required') : ''}>
        <InputGroup
          id="username"
          value={userModel.username}
          onChange={handleUsernameChange}
          disabled={!isNewUser}
          placeholder={t('userEditor.form.placeholders.username')}
        />
      </FormGroup>

      <FormGroup label={t('userEditor.form.host')} labelFor="host" labelInfo={t('userEditor.form.required')}>
        <InputGroup
          id="host"
          value={userModel.host}
          onChange={handleHostChange}
          disabled={!isNewUser}
          placeholder={t('userEditor.form.placeholders.host')}
        />
      </FormGroup>

      <FormGroup label={t('userEditor.form.password')} labelFor="password" labelInfo={isNewUser ? t('userEditor.form.required') : ''}>
        <InputGroup
          id="password"
          type="password"
          value={userModel.password}
          onChange={handlePasswordChange}
          placeholder={isNewUser ? t('userEditor.form.placeholders.passwordNew') : t('userEditor.form.placeholders.passwordEdit')}
        />
      </FormGroup>

      <FormGroup label={t('userEditor.form.confirmPassword')} labelFor="confirmPassword" labelInfo={(isNewUser || !!userModel.password) ? t('userEditor.form.required') : ''}>
        <InputGroup
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={handleConfirmPasswordChange}
          placeholder={t('userEditor.form.placeholders.confirmPassword')}
        />
      </FormGroup>

      <FormGroup label={t('userEditor.form.authPlugin')} labelFor="authPlugin" labelInfo={t('userEditor.form.required')}>
        <HTMLSelect
          id="authPlugin"
          value={userModel.plugin || 'mysql_native_password'}
          onChange={handlePluginChange}
          options={[
            ...AUTH_PLUGINS.map((plugin) => ({ label: plugin, value: plugin })),
            ...(userModel.plugin && !AUTH_PLUGINS.includes(userModel.plugin)
              ? [{ label: userModel.plugin, value: userModel.plugin }]
              : []),
          ]}
        />
      </FormGroup>
    </div>
  );

  const renderServerPrivilegesTab = () => (
    <div className="user-editor-tab-content">
      <div className="user-editor-privileges-grid">
        {SERVER_PRIVILEGES.map((privilege) => (
          <Checkbox
            key={privilege}
            label={privilege}
            checked={userModel.serverPrivileges.includes(privilege)}
            onChange={(e) => handleServerPrivilegeChange(privilege, e.target.checked)}
          />
        ))}
      </div>
    </div>
  );

  const renderDatabasePrivilegesTab = () => (
    <div className="user-editor-tab-content">
      <div className="user-editor-database-selector">
        <HTMLSelect
          value={selectedDatabase}
          onChange={(e) => setSelectedDatabase(e.target.value)}
          options={databases.map((db) => ({ label: db, value: db }))}
        />
        <HTMLSelect
          value={selectedTable}
          onChange={(e) => setSelectedTable(e.target.value)}
          options={[
            { label: '*', value: '*' },
            ...tableOptions.map((table) => ({ label: table, value: table })),
          ]}
        />
        <HTMLSelect
          value={selectedColumn}
          onChange={(e) => setSelectedColumn(e.target.value)}
          disabled={selectedTable === '*'}
          options={[
            { label: '*', value: '*' },
            ...columnOptions.map((column) => ({ label: column, value: column })),
          ]}
        />
        <Button
          icon="add"
          text={t('userEditor.databasePrivileges.add')}
          onClick={handleAddDatabasePrivileges}
          disabled={!selectedDatabase || !!userModel.databasePrivileges[buildScopeKey(selectedDatabase, selectedTable || '*', selectedColumn || '*')]}
        />
      </div>

      <div className="user-editor-database-privileges">
        {Object.keys(userModel.databasePrivileges).length === 0 ? (
          <Callout intent={Intent.PRIMARY} className="user-editor-callout">
            {t('userEditor.databasePrivileges.hint')}
          </Callout>
        ) : (
          <div className="user-editor-db-table-wrapper">
            <table className="user-editor-db-privilege-table">
              <thead>
                <tr>
                  <th>{t('userEditor.databasePrivileges.name')}</th>
                  {DATABASE_SCOPE_PRIVILEGES.map((priv) => (
                    <th key={priv}>{priv}</th>
                  ))}
                  <th>{t('userEditor.databasePrivileges.operation')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(userModel.databasePrivileges)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([scopeKey, privileges]) => {
                    const scope = parseScopeKey(scopeKey);
                    const isColumnScope = scope.column !== '*';
                    return (
                      <tr key={scopeKey}>
                        <td className="user-editor-db-scope-cell">{buildScopeKey(scope.db, scope.table, scope.column)}</td>
                        {DATABASE_SCOPE_PRIVILEGES.map((privilege) => {
                          const disabled = isColumnScope && !COLUMN_LEVEL_PRIVILEGES.has(privilege);
                          return (
                            <td key={`${scopeKey}-${privilege}`}>
                              <Checkbox
                                checked={privileges.includes(privilege)}
                                disabled={disabled}
                                onChange={(e) => handleDatabasePrivilegeChange(scopeKey, privilege, e.target.checked)}
                              />
                            </td>
                          );
                        })}
                        <td>
                          <Button
                            icon="remove"
                            minimal
                            onClick={() => handleRemoveDatabasePrivileges(scopeKey)}
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const renderSqlPreviewTab = () => (
    <div className="user-editor-sql-preview-container">
      <Editor
        height="100%"
        defaultLanguage="sql"
        value={generatedSql}
        theme={theme === 'dark' ? 'vs-dark' : 'light'}
        onMount={handleSqlEditorMount}
        options={{
          minimap: { enabled: editorSettings.editorMinimap },
          lineNumbers: 'on',
          roundedSelection: false,
          scrollBeyondLastLine: false,
          readOnly: true,
          fontSize: editorSettings.editorFontSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
          lineHeight: 22,
          padding: { top: 10, bottom: 10 },
          automaticLayout: true,
          wordWrap: 'on',
          tabSize: editorSettings.editorTabSize,
          insertSpaces: true,
          folding: true,
          foldingHighlight: true,
          showFoldingControls: 'always',
          matchBrackets: 'always',
        }}
      />
    </div>
  );

  return (
    <div className="user-editor-tab">
      <div className="user-editor-header">
        <h3 className="user-editor-title">
          {isNewUser ? t('userEditor.newUser') : t('userEditor.editUser', { username, host })}
        </h3>
      </div>

      {error && (
        <Callout intent={Intent.DANGER} className="user-editor-message">
          {error}
        </Callout>
      )}

      {successMessage && (
        <Callout intent={Intent.SUCCESS} className="user-editor-message">
          {successMessage}
        </Callout>
      )}

      <Tabs
        id="user-editor-tabs"
        selectedTabId={activeTabId}
        onChange={(tabId) => setActiveTabId(tabId as string)}
        className="user-editor-tabs"
      >
        <Tab id="general" title={t('userEditor.tabs.general')} panel={renderGeneralTab()} />
        <Tab id="server-privileges" title={t('userEditor.tabs.serverPrivileges')} panel={renderServerPrivilegesTab()} />
        <Tab id="database-privileges" title={t('userEditor.tabs.databasePrivileges')} panel={renderDatabasePrivilegesTab()} />
        <Tab id="sql-preview" title={t('userEditor.tabs.sqlPreview')} panel={renderSqlPreviewTab()} />
      </Tabs>

      <div className="user-editor-footer">
        <Button
          intent={Intent.PRIMARY}
          text={isSaving ? t('userEditor.buttons.saving') : t('userEditor.buttons.save')}
          onClick={handleSave}
          loading={isSaving}
        />
      </div>

      <ConfirmDialog
        isOpen={systemUserConfirmOpen}
        onClose={() => setSystemUserConfirmOpen(false)}
        onConfirm={executeSave}
        title={t('userEditor.systemUserConfirm.title')}
        message={t('userEditor.systemUserConfirm.message', { username: originalUserModel?.username, host: originalUserModel?.host })}
        intent="warning"
        confirmText={t('userEditor.systemUserConfirm.confirm')}
        cancelText={t('userEditor.systemUserConfirm.cancel')}
      />
    </div>
  );
};

export default UserEditorTab;
