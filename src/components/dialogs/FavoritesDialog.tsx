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
import { useTranslation } from 'react-i18next';
import { useFavorites } from '../../hooks/useFavorites';
import type { FavoriteItem, FavoriteType } from '../../types/api';
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
  const { favorites, loading, error, getAll, add, update, remove, recordUsage } = useFavorites();

  const [searchKeyword, setSearchKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [editingItem, setEditingItem] = useState<FavoriteItem | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
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

  const handleRowClick = async (item: FavoriteItem) => {
    await recordUsage(item.id!);
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
      />
    </>
  );
};

interface FavoriteEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: Omit<FavoriteItem, 'id'>) => Promise<void>;
  editItem: FavoriteItem | null;
}

const FavoriteEditDialog: React.FC<FavoriteEditDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  editItem,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<FavoriteType>('SQL_QUERY');
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (editItem) {
      setName(editItem.name);
      setDescription(editItem.description || '');
      setType(editItem.type);
      setContent(editItem.content || '');
    } else {
      setName('');
      setDescription('');
      setType('SQL_QUERY');
      setContent('');
    }
  }, [editItem, isOpen]);

  const handleSave = async () => {
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        content: content.trim() || undefined,
        createdTime: editItem?.createdTime || Date.now(),
        lastUsedTime: editItem?.lastUsedTime || Date.now(),
        usageCount: editItem?.usageCount || 0,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getContentPlaceholder = () => {
    switch (type) {
      case 'SQL_QUERY':
        return t('dialog.favorites.sqlPlaceholder');
      case 'CONNECTION_PROFILE':
        return t('dialog.favorites.connectionPlaceholder');
      case 'DATABASE_OBJECT':
        return t('dialog.favorites.objectPlaceholder');
      default:
        return '';
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

          <div className="favorite-form-row">
            <label className="favorite-form-label">
              <Icon icon="document" size={14} />
              {t('dialog.favorites.contentLabel')}
            </label>
            <textarea
              placeholder={getContentPlaceholder()}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="favorite-form-textarea"
              rows={6}
            />
          </div>
        </div>
      </div>

      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button intent={Intent.PRIMARY} onClick={handleSave} loading={isSaving} disabled={!name.trim()}>
            {editItem ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
