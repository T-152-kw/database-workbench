import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  Classes,
  Button,
  InputGroup,
  Intent,
  HTMLSelect,
  Icon,
} from '@blueprintjs/core';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { useTranslation } from 'react-i18next';
import { tauriApi } from '../../hooks';
import { useConnectionStore } from '../../stores';
import type { FavoriteItem, FavoriteType } from '../../types/api';
import {
  buildDatabaseObjectPath,
  parseDatabaseObjectPath,
  parseFavoritePayload,
  type DatabaseObjectOpenMode,
  type DatabaseObjectType,
} from '../../utils';
import '../../styles/add-favorite-dialog.css';
import '../../styles/favorites-dialog.css';

interface AddFavoriteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: Omit<FavoriteItem, 'id'>) => Promise<void> | void;
  editItem?: FavoriteItem;
  defaultType?: FavoriteType;
}

export const AddFavoriteDialog: React.FC<AddFavoriteDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  editItem,
  defaultType = 'SQL_QUERY',
}) => {
  const { t } = useTranslation();
  const { connections, activeConnectionId } = useConnectionStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<FavoriteType>('SQL_QUERY');

  const [sqlText, setSqlText] = useState('');
  const [sqlFilePath, setSqlFilePath] = useState('');

  const [connectionFilePath, setConnectionFilePath] = useState('');
  const [connectionProfileName, setConnectionProfileName] = useState('');

  const [objectConnectionName, setObjectConnectionName] = useState('');
  const [objectDatabase, setObjectDatabase] = useState('');
  const [objectType, setObjectType] = useState<DatabaseObjectType>('TABLE');
  const [objectName, setObjectName] = useState('');
  const [objectOpenMode, setObjectOpenMode] = useState<DatabaseObjectOpenMode>('DATA');

  const [databaseOptions, setDatabaseOptions] = useState<string[]>([]);
  const [objectOptions, setObjectOptions] = useState<string[]>([]);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const resetFields = () => {
    setSqlText('');
    setSqlFilePath('');
    setConnectionFilePath('');
    setConnectionProfileName('');
    setObjectConnectionName('');
    setObjectDatabase('');
    setObjectType('TABLE');
    setObjectName('');
    setObjectOpenMode('DATA');
    setDatabaseOptions([]);
    setObjectOptions([]);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (editItem) {
      setName(editItem.name);
      setDescription(editItem.description || '');
      setType(editItem.type);
      resetFields();

      const payload = parseFavoritePayload(editItem);
      if (payload?.kind === 'SQL_QUERY') {
        setSqlText(payload.sql || '');
        setSqlFilePath(payload.sourceFilePath || '');
      } else if (payload?.kind === 'CONNECTION_PROFILE') {
        setConnectionFilePath(payload.filePath || '');
        setConnectionProfileName(payload.profileName || '');
      } else if (payload?.kind === 'DATABASE_OBJECT') {
        const parsedPath = parseDatabaseObjectPath(payload.path);
        setObjectConnectionName(payload.connectionName || parsedPath.connectionName || '');
        setObjectDatabase(payload.database || parsedPath.database || '');
        setObjectType(payload.objectType || parsedPath.objectType || 'TABLE');
        setObjectName(payload.objectName || parsedPath.objectName || '');
        setObjectOpenMode(payload.openMode || 'DATA');
      }
      return;
    }

    setName('');
    setDescription('');
    setType(defaultType);
    resetFields();
  }, [defaultType, editItem, isOpen]);

  useEffect(() => {
    if (type !== 'DATABASE_OBJECT' || objectConnectionName.trim()) {
      return;
    }

    if (activeConnectionId) {
      setObjectConnectionName(activeConnectionId);
      return;
    }

    const firstConnection = connections[0]?.profile.name;
    if (firstConnection) {
      setObjectConnectionName(firstConnection);
    }
  }, [type, objectConnectionName, activeConnectionId, connections]);

  useEffect(() => {
    if (type !== 'DATABASE_OBJECT') {
      return;
    }

    const selectedConnectionName = objectConnectionName.trim();
    if (!selectedConnectionName) {
      setDatabaseOptions([]);
      setObjectDatabase('');
      setObjectOptions([]);
      setObjectName('');
      return;
    }

    const selectedConnection = connections.find((conn) => conn.profile.name === selectedConnectionName)?.profile;
    if (!selectedConnection) {
      setDatabaseOptions([]);
      setObjectDatabase('');
      setObjectOptions([]);
      setObjectName('');
      return;
    }

    let cancelled = false;
    const loadDatabases = async () => {
      setLoadingDatabases(true);
      try {
        const databases = await tauriApi.metadata.listDatabases(selectedConnection);
        if (cancelled) {
          return;
        }
        setDatabaseOptions(databases);
        if (!databases.includes(objectDatabase)) {
          setObjectDatabase('');
          setObjectOptions([]);
          setObjectName('');
        }
      } catch {
        if (!cancelled) {
          setDatabaseOptions([]);
          setObjectDatabase('');
          setObjectOptions([]);
          setObjectName('');
        }
      } finally {
        if (!cancelled) {
          setLoadingDatabases(false);
        }
      }
    };

    void loadDatabases();

    return () => {
      cancelled = true;
    };
  }, [type, objectConnectionName, objectDatabase, connections]);

  useEffect(() => {
    if (type !== 'DATABASE_OBJECT') {
      return;
    }

    const selectedConnection = connections.find((conn) => conn.profile.name === objectConnectionName.trim())?.profile;
    const selectedDatabase = objectDatabase.trim();
    if (!selectedConnection || !selectedDatabase) {
      setObjectOptions([]);
      setObjectName('');
      return;
    }

    let cancelled = false;
    const loadObjects = async () => {
      setLoadingObjects(true);
      try {
        const objects = objectType === 'TABLE'
          ? await tauriApi.metadata.listTables(selectedConnection, selectedDatabase)
          : objectType === 'VIEW'
            ? await tauriApi.metadata.listViews(selectedConnection, selectedDatabase)
            : await tauriApi.metadata.listFunctions(selectedConnection, selectedDatabase);

        if (cancelled) {
          return;
        }

        setObjectOptions(objects);
        if (!objects.includes(objectName)) {
          setObjectName('');
        }
      } catch {
        if (!cancelled) {
          setObjectOptions([]);
          setObjectName('');
        }
      } finally {
        if (!cancelled) {
          setLoadingObjects(false);
        }
      }
    };

    void loadObjects();

    return () => {
      cancelled = true;
    };
  }, [type, objectConnectionName, objectDatabase, objectType, objectName, connections]);

  const connectionNameOptions = useMemo(() => {
    return connections
      .map((conn) => conn.profile.name || '')
      .filter((connName): connName is string => Boolean(connName));
  }, [connections]);

  const generatedObjectPath = buildDatabaseObjectPath(
    objectConnectionName,
    objectDatabase,
    objectType,
    objectName,
  );

  const canSave = (() => {
    if (!name.trim()) {
      return false;
    }
    if (type === 'SQL_QUERY') {
      return sqlText.trim().length > 0;
    }
    if (type === 'CONNECTION_PROFILE') {
      return connectionFilePath.trim().length > 0;
    }
    return (
      objectConnectionName.trim().length > 0
      && objectDatabase.trim().length > 0
      && objectName.trim().length > 0
    );
  })();

  const pickSqlFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'SQL', extensions: ['sql'] }],
    });
    if (!selected || typeof selected !== 'string') {
      return;
    }

    try {
      const content = await readTextFile(selected);
      setSqlText(content);
      setSqlFilePath(selected);
    } catch {
      // ignore
    }
  };

  const pickConnectionJsonFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!selected || typeof selected !== 'string') {
      return;
    }
    setConnectionFilePath(selected);
  };

  const buildFavoriteContent = (): string => {
    if (type === 'SQL_QUERY') {
      return JSON.stringify({
        version: 1,
        kind: 'SQL_QUERY',
        sql: sqlText,
        sourceFilePath: sqlFilePath || undefined,
      });
    }

    if (type === 'CONNECTION_PROFILE') {
      return JSON.stringify({
        version: 1,
        kind: 'CONNECTION_PROFILE',
        filePath: connectionFilePath,
        profileName: connectionProfileName || undefined,
      });
    }

    return JSON.stringify({
      version: 1,
      kind: 'DATABASE_OBJECT',
      path: generatedObjectPath,
      connectionName: objectConnectionName,
      database: objectDatabase,
      objectType,
      objectName,
      openMode: objectOpenMode,
    });
  };

  const handleSave = async () => {
    if (!canSave) {
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        content: buildFavoriteContent(),
        createdTime: editItem?.createdTime || Date.now(),
        lastUsedTime: editItem?.lastUsedTime || Date.now(),
        usageCount: editItem?.usageCount || 0,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={editItem ? t('dialog.favorites.editTitle') : t('dialog.favorites.addTitle')}
      icon="star"
      className="add-favorite-dialog"
      style={{ width: 620 }}
    >
      <div className={Classes.DIALOG_BODY}>
        <div className="favorite-form">
          <div className="favorite-form-row">
            <label className="favorite-form-label">
              <Icon icon="label" size={14} />
              {t('dialog.favorites.nameLabel')} <span className="required">*</span>
            </label>
            <InputGroup
              placeholder={t('dialog.favorites.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="favorite-form-input"
            />
          </div>

          <div className="favorite-form-row">
            <label className="favorite-form-label">
              <Icon icon="tag" size={14} />
              {t('dialog.favorites.typeLabel')}
            </label>
            <HTMLSelect
              value={type}
              onChange={(e) => setType(e.target.value as FavoriteType)}
              className="favorite-form-select"
            >
              <option value="SQL_QUERY">{t('dialog.favorites.sqlQuery')}</option>
              <option value="CONNECTION_PROFILE">{t('dialog.favorites.connectionProfile')}</option>
              <option value="DATABASE_OBJECT">{t('dialog.favorites.databaseObject')}</option>
            </HTMLSelect>
          </div>

          <div className="favorite-form-row">
            <label className="favorite-form-label">
              <Icon icon="annotation" size={14} />
              {t('dialog.favorites.descriptionLabel')}
            </label>
            <InputGroup
              placeholder={t('dialog.favorites.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="favorite-form-input"
            />
          </div>

          {type === 'SQL_QUERY' && (
            <>
              <div className="favorite-form-row">
                <label className="favorite-form-label">
                  <Icon icon="document-open" size={14} />
                  {t('dialog.favorites.sqlFileLabel')}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <InputGroup
                    placeholder={t('dialog.favorites.sqlFilePlaceholder')}
                    value={sqlFilePath}
                    onChange={(e) => setSqlFilePath(e.target.value)}
                    className="favorite-form-input"
                  />
                  <Button icon="folder-open" onClick={() => { void pickSqlFile(); }}>
                    {t('dialog.favorites.selectFile')}
                  </Button>
                </div>
              </div>
              <div className="favorite-form-row">
                <label className="favorite-form-label">
                  <Icon icon="code" size={14} />
                  {t('dialog.favorites.contentLabel')}
                </label>
                <textarea
                  placeholder={t('dialog.favorites.sqlPlaceholder')}
                  value={sqlText}
                  onChange={(e) => setSqlText(e.target.value)}
                  className="favorite-form-textarea"
                  rows={8}
                />
              </div>
            </>
          )}

          {type === 'CONNECTION_PROFILE' && (
            <>
              <div className="favorite-form-row">
                <label className="favorite-form-label">
                  <Icon icon="folder-open" size={14} />
                  {t('dialog.favorites.connectionJsonLabel')}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <InputGroup
                    placeholder={t('dialog.favorites.connectionJsonPlaceholder')}
                    value={connectionFilePath}
                    onChange={(e) => setConnectionFilePath(e.target.value)}
                    className="favorite-form-input"
                  />
                  <Button icon="folder-open" onClick={() => { void pickConnectionJsonFile(); }}>
                    {t('dialog.favorites.selectFile')}
                  </Button>
                </div>
              </div>
              <div className="favorite-form-row">
                <label className="favorite-form-label">
                  <Icon icon="search-template" size={14} />
                  {t('dialog.favorites.connectionProfileNameLabel')}
                </label>
                <InputGroup
                  placeholder={t('dialog.favorites.connectionProfileNamePlaceholder')}
                  value={connectionProfileName}
                  onChange={(e) => setConnectionProfileName(e.target.value)}
                  className="favorite-form-input"
                />
              </div>
            </>
          )}

          {type === 'DATABASE_OBJECT' && (
            <>
              <div className="favorite-form-row">
                <label className="favorite-form-label">
                  <Icon icon="database" size={14} />
                  {t('dialog.favorites.objectConnectionNameLabel')}
                </label>
                <HTMLSelect
                  value={objectConnectionName}
                  onChange={(e) => {
                    setObjectConnectionName(e.target.value);
                    setObjectDatabase('');
                    setObjectName('');
                  }}
                  className="favorite-form-select"
                >
                  <option value="">{t('dialog.favorites.selectConnectionName')}</option>
                  {connectionNameOptions.map((connName) => (
                    <option key={connName} value={connName}>{connName}</option>
                  ))}
                </HTMLSelect>
              </div>

              <div className="favorite-form-row">
                <label className="favorite-form-label">
                  <Icon icon="folder-open" size={14} />
                  {t('dialog.favorites.objectDatabaseLabel')}
                </label>
                <HTMLSelect
                  value={objectDatabase}
                  onChange={(e) => {
                    setObjectDatabase(e.target.value);
                    setObjectName('');
                  }}
                  className="favorite-form-select"
                  disabled={!objectConnectionName || loadingDatabases}
                >
                  <option value="">{loadingDatabases ? t('common.loading') : t('dialog.favorites.selectDatabase')}</option>
                  {databaseOptions.map((databaseName) => (
                    <option key={databaseName} value={databaseName}>{databaseName}</option>
                  ))}
                </HTMLSelect>
              </div>

              <div className="favorite-form-row">
                <label className="favorite-form-label">
                  <Icon icon="cube" size={14} />
                  {t('dialog.favorites.objectTypeLabel')}
                </label>
                <HTMLSelect
                  value={objectType}
                  onChange={(e) => setObjectType(e.target.value as DatabaseObjectType)}
                  className="favorite-form-select"
                >
                  <option value="TABLE">{t('dialog.favorites.objectTypeTable')}</option>
                  <option value="VIEW">{t('dialog.favorites.objectTypeView')}</option>
                  <option value="FUNCTION">{t('dialog.favorites.objectTypeFunction')}</option>
                </HTMLSelect>
              </div>

              <div className="favorite-form-row">
                <label className="favorite-form-label">
                  <Icon icon="tag" size={14} />
                  {t('dialog.favorites.objectNameLabel')}
                </label>
                <HTMLSelect
                  value={objectName}
                  onChange={(e) => setObjectName(e.target.value)}
                  className="favorite-form-select"
                  disabled={!objectDatabase || loadingObjects}
                >
                  <option value="">{loadingObjects ? t('common.loading') : t('dialog.favorites.selectObjectName')}</option>
                  {objectOptions.map((dbObjectName) => (
                    <option key={dbObjectName} value={dbObjectName}>{dbObjectName}</option>
                  ))}
                </HTMLSelect>
              </div>

              <div className="favorite-form-row">
                <label className="favorite-form-label">
                  <Icon icon="application" size={14} />
                  {t('dialog.favorites.openModeLabel')}
                </label>
                <HTMLSelect
                  value={objectOpenMode}
                  onChange={(e) => setObjectOpenMode(e.target.value as DatabaseObjectOpenMode)}
                  className="favorite-form-select"
                >
                  <option value="LIST">{t('dialog.favorites.openModeList')}</option>
                  <option value="DATA">{t('dialog.favorites.openModeData')}</option>
                  <option value="DESIGNER">{t('dialog.favorites.openModeDesigner')}</option>
                </HTMLSelect>
              </div>

              <div className="favorite-form-row">
                <label className="favorite-form-label">
                  <Icon icon="path-search" size={14} />
                  {t('dialog.favorites.objectPathLabel')}
                </label>
                <InputGroup value={generatedObjectPath} readOnly className="favorite-form-input" />
              </div>
            </>
          )}
        </div>
      </div>

      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button intent={Intent.PRIMARY} onClick={handleSave} disabled={!canSave} loading={isSaving}>
            {editItem ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
