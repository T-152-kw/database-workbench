import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  Classes,
  Button,
  InputGroup,
  Spinner,
  Intent,
  Tag,
  Icon,
  NonIdealState,
  Card,
  Elevation,
  HTMLSelect,
  Divider,
} from '@blueprintjs/core';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { useTranslation } from 'react-i18next';
import { tauriApi } from '../../hooks';
import { useFavorites } from '../../hooks/useFavorites';
import { useConnectionStore } from '../../stores';
import type { FavoriteItem, FavoriteType } from '../../types/api';
import {
  buildDatabaseObjectPath,
  parseDatabaseObjectPath,
  parseFavoritePayload,
  type DatabaseObjectOpenMode,
  type DatabaseObjectType,
} from '../../utils';
import '../../styles/favorites-dialog.css';

interface FavoritesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onUseFavorite?: (item: FavoriteItem) => void;
}

import type { IconName } from '@blueprintjs/icons';

export const FavoritesDialog: React.FC<FavoritesDialogProps> = ({
  isOpen,
  onClose,
  onUseFavorite,
}) => {
  const { t } = useTranslation();
  const { favorites, loading, error, getAll, add, update, remove } = useFavorites();

  const [searchKeyword, setSearchKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [editingItem, setEditingItem] = useState<FavoriteItem | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addDefaultType, setAddDefaultType] = useState<FavoriteType>('SQL_QUERY');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const TYPE_OPTIONS = [
    { label: t('dialog.favorites.allTypes'), value: 'ALL' },
    { label: t('dialog.favorites.sqlQuery'), value: 'SQL_QUERY' },
    { label: t('dialog.favorites.connectionProfile'), value: 'CONNECTION_PROFILE' },
    { label: t('dialog.favorites.databaseObject'), value: 'DATABASE_OBJECT' },
  ];

  const TYPE_CONFIG: Record<FavoriteType, { label: string; icon: IconName; color: string }> = {
    SQL_QUERY: { label: t('dialog.favorites.sqlQueryShort'), icon: 'code', color: '#2196F3' },
    CONNECTION_PROFILE: { label: t('dialog.favorites.connectionShort'), icon: 'database', color: '#4CAF50' },
    DATABASE_OBJECT: { label: t('dialog.favorites.objectShort'), icon: 'cube', color: '#FF9800' },
  };

  useEffect(() => {
    if (isOpen) {
      getAll();
    }
  }, [isOpen, getAll]);

  const filteredFavorites = useMemo(() => {
    let filtered = favorites;

    if (typeFilter !== 'ALL') {
      filtered = filtered.filter((item) => item.type === typeFilter);
    }

    if (searchKeyword) {
      const keyword = searchKeyword.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.name.toLowerCase().includes(keyword) ||
          item.description?.toLowerCase().includes(keyword)
      );
    }

    return filtered.sort((a, b) => b.lastUsedTime - a.lastUsedTime);
  }, [favorites, searchKeyword, typeFilter]);

  const handleExport = () => {
    const dataStr = JSON.stringify(filteredFavorites, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `favorites_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const imported = JSON.parse(text) as Omit<FavoriteItem, 'id'>[];
        for (const item of imported) {
          await add(item);
        }
        await getAll();
      } catch (err) {
        console.error(t('dialog.favorites.importFailed'), err);
      }
    };
    input.click();
  };

  const handleAdd = () => {
    setEditingItem(null);
    setAddDefaultType(typeFilter === 'ALL' ? 'SQL_QUERY' : (typeFilter as FavoriteType));
    setIsAddDialogOpen(true);
  };

  const handleEdit = (item: FavoriteItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingItem(item);
    setIsAddDialogOpen(true);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleteConfirmId === id) {
      await remove(id);
      setDeleteConfirmId(null);
    } else {
      setDeleteConfirmId(id);
      setTimeout(() => setDeleteConfirmId(null), 3000);
    }
  };

  const handleRowClick = (item: FavoriteItem) => {
    onUseFavorite?.(item);
    onClose();
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return t('dialog.favorites.today', { time: date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) });
    } else if (diffDays === 1) {
      return t('dialog.favorites.yesterday');
    } else if (diffDays < 7) {
      return t('dialog.favorites.daysAgo', { days: diffDays });
    } else {
      return date.toLocaleDateString('zh-CN');
    }
  };

  const getTypeTag = (type: FavoriteType) => {
    const config = TYPE_CONFIG[type];
    return (
      <Tag minimal style={{ color: config.color, backgroundColor: `${config.color}20` }}>
        <Icon icon={config.icon} size={12} style={{ marginRight: 4 }} />
        {config.label}
      </Tag>
    );
  };

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title={t('dialog.favorites.title')}
        icon="star"
        className="favorites-dialog"
        style={{ width: 800, maxWidth: '90vw', minHeight: 500 }}
      >
        <div className={Classes.DIALOG_BODY} style={{ padding: 0 }}>
          {/* 工具栏 */}
          <div className="favorites-toolbar">
            <div className="favorites-toolbar-left">
              <InputGroup
                leftIcon="search"
                placeholder={t('dialog.favorites.searchPlaceholder')}
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="favorites-search"
              />
              <HTMLSelect
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="favorites-type-filter"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </HTMLSelect>
            </div>
            <div className="favorites-toolbar-right">
              <Button icon="export" minimal onClick={handleExport} title={t('dialog.favorites.export')}>
                {t('dialog.favorites.export')}
              </Button>
              <Button icon="import" minimal onClick={handleImport} title={t('dialog.favorites.import')}>
                {t('dialog.favorites.import')}
              </Button>
              <Divider />
              <Button icon="add" intent={Intent.PRIMARY} onClick={handleAdd}>
                {t('dialog.favorites.addFavorite')}
              </Button>
            </div>
          </div>

          {/* 内容区域 */}
          <div className="favorites-content">
            {loading ? (
              <div className="favorites-loading">
                <Spinner size={40} />
                <p>{t('common.loading')}</p>
              </div>
            ) : error ? (
              <NonIdealState icon="error" title={t('error.error')} description={error} />
            ) : filteredFavorites.length === 0 ? (
              <NonIdealState
                icon="star-empty"
                title={searchKeyword || typeFilter !== 'ALL' ? t('dialog.favorites.noResults') : t('dialog.favorites.empty')}
                description={
                  searchKeyword || typeFilter !== 'ALL'
                    ? t('dialog.favorites.adjustSearch')
                    : t('dialog.favorites.createFirst')
                }
                action={<Button icon="add" intent={Intent.PRIMARY} onClick={handleAdd} text={t('dialog.favorites.addFavorite')} />}
              />
            ) : (
              <div className="favorites-list">
                {filteredFavorites.map((item) => (
                  <Card
                    key={item.id}
                    className={`favorite-item ${editingItem?.id === item.id ? 'selected' : ''}`}
                    elevation={Elevation.ONE}
                    onClick={() => handleRowClick(item)}
                    interactive
                  >
                    <div className="favorite-item-header">
                      <div className="favorite-item-title">
                        <Icon icon={TYPE_CONFIG[item.type].icon} size={16} color={TYPE_CONFIG[item.type].color} />
                        <span className="favorite-name">{item.name}</span>
                        {getTypeTag(item.type)}
                      </div>
                      <div className="favorite-item-actions">
                        <Button
                          icon="edit"
                          minimal
                          small
                          onClick={(e) => handleEdit(item, e)}
                          title={t('common.edit')}
                        />
                        <Button
                          icon={deleteConfirmId === item.id ? 'tick' : 'trash'}
                          minimal
                          small
                          intent={deleteConfirmId === item.id ? Intent.DANGER : undefined}
                          onClick={(e) => handleDelete(item.id!, e)}
                          title={deleteConfirmId === item.id ? t('common.confirm') : t('common.delete')}
                        />
                      </div>
                    </div>
                    {item.description && (
                      <div className="favorite-item-description">{item.description}</div>
                    )}
                    <div className="favorite-item-footer">
                      <span className="favorite-usage">
                        <Icon icon="play" size={12} />
                        {t('dialog.favorites.usedCount', { count: item.usageCount })}
                      </span>
                      <span className="favorite-date">
                        <Icon icon="time" size={12} />
                        {formatDate(item.lastUsedTime)}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* 底部统计 */}
          {!loading && !error && favorites.length > 0 && (
            <div className="favorites-footer">
              <span>
                {t('dialog.favorites.totalCount', { count: favorites.length })}
                {(searchKeyword || typeFilter !== 'ALL') && (
                  <>, {t('dialog.favorites.showingCount', { count: filteredFavorites.length })}</>
                )}
              </span>
            </div>
          )}
        </div>

        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={onClose}>{t('common.close')}</Button>
          </div>
        </div>
      </Dialog>

      <FavoriteEditDialog
        isOpen={isAddDialogOpen}
        onClose={() => {
          setIsAddDialogOpen(false);
          setEditingItem(null);
        }}
        onSave={async (item) => {
          if (editingItem?.id) {
            await update({ ...item, id: editingItem.id });
          } else {
            await add(item);
          }
          await getAll();
          setIsAddDialogOpen(false);
          setEditingItem(null);
        }}
        editItem={editingItem}
        defaultType={addDefaultType}
      />
    </>
  );
};

interface FavoriteEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: Omit<FavoriteItem, 'id'>) => Promise<void>;
  editItem: FavoriteItem | null;
  defaultType?: FavoriteType;
}

const FavoriteEditDialog: React.FC<FavoriteEditDialogProps> = ({
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

  useEffect(() => {
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
      } else {
        if (editItem.type === 'SQL_QUERY') {
          setSqlText(editItem.content || '');
        }
      }
    } else {
      setName('');
      setDescription('');
      setType(defaultType);
      resetFields();
    }
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
      .filter((name): name is string => Boolean(name));
  }, [connections]);

  const generatedObjectPath = buildDatabaseObjectPath(
    objectConnectionName,
    objectDatabase,
    objectType,
    objectName,
  );

  const canSaveByType = (() => {
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
      // keep dialog responsive; user can still paste manually
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

  const handleSave = async () => {
    if (!canSaveByType) {
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
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={editItem ? t('dialog.favorites.editTitle') : t('dialog.favorites.addTitle')}
      icon="edit"
      className="favorite-edit-dialog"
      style={{ width: 520 }}
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
                    const value = e.target.value;
                    setObjectConnectionName(value);
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
          <Button intent={Intent.PRIMARY} onClick={handleSave} loading={isSaving} disabled={!canSaveByType}>
            {editItem ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
