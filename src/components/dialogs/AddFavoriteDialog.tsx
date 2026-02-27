import React, { useState, useEffect } from 'react';
import { Dialog, Classes, Button, FormGroup, InputGroup, Intent } from '@blueprintjs/core';
import type { FavoriteItem, FavoriteType } from '../../types/api';
import '../../styles/add-favorite-dialog.css';

interface AddFavoriteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: Omit<FavoriteItem, 'id'>) => void;
  editItem?: FavoriteItem;
}

const FAVORITE_TYPES: { value: FavoriteType; label: string; icon: string; placeholder: string }[] = [
  {
    value: 'SQL_QUERY',
    label: 'SQL 查询',
    icon: 'code',
    placeholder: '输入 SQL 查询语句...',
  },
  {
    value: 'CONNECTION_PROFILE',
    label: '连接配置',
    icon: 'database',
    placeholder: '输入连接配置信息...',
  },
  {
    value: 'DATABASE_OBJECT',
    label: '数据库对象',
    icon: 'cube',
    placeholder: '输入数据库对象路径...',
  },
];

export const AddFavoriteDialog: React.FC<AddFavoriteDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  editItem,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<FavoriteType>('SQL_QUERY');
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const currentType = FAVORITE_TYPES.find((t) => t.value === type);

  useEffect(() => {
    if (isOpen) {
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
    }
  }, [isOpen, editItem]);

  const handleSave = async () => {
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        content: content.trim() || undefined,
        createdTime: editItem?.createdTime || Date.now(),
        lastUsedTime: editItem?.lastUsedTime || Date.now(),
        usageCount: editItem?.usageCount || 0,
      });
      handleClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setType('SQL_QUERY');
    setContent('');
    onClose();
  };

  const canSave = name.trim().length > 0;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={editItem ? '编辑收藏' : '添加收藏'}
      icon="star"
      className="add-favorite-dialog"
      style={{ width: 560 }}
    >
      <div className={Classes.DIALOG_BODY}>
        <div className="add-favorite-form">
          {/* 类型选择 */}
          <div className="add-favorite-type-selector">
            {FAVORITE_TYPES.map((t) => (
              <button
                key={t.value}
                className={`type-option ${type === t.value ? 'active' : ''}`}
                onClick={() => setType(t.value)}
                type="button"
              >
                <span className="type-icon">{t.icon}</span>
                <span className="type-label">{t.label}</span>
              </button>
            ))}
          </div>

          {/* 名称 */}
          <FormGroup
            label="名称"
            labelInfo="*"
            helperText="给您的收藏起个名字，方便日后查找"
          >
            <InputGroup
              placeholder="例如：每日销售统计查询"
              value={name}
              onChange={(e) => setName(e.target.value)}
              large
            />
          </FormGroup>

          {/* 描述 */}
          <FormGroup
            label="描述"
            helperText="简要描述这个收藏的用途（可选）"
          >
            <InputGroup
              placeholder="例如：查询今日所有订单的销售统计..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormGroup>

          {/* 内容 */}
          <FormGroup
            label={currentType?.label}
            helperText={`输入${currentType?.label}的具体内容`}
          >
            <textarea
              placeholder={currentType?.placeholder}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="add-favorite-textarea"
              rows={8}
            />
          </FormGroup>
        </div>
      </div>

      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={handleClose} large>
            取消
          </Button>
          <Button
            intent={Intent.PRIMARY}
            onClick={handleSave}
            disabled={!canSave}
            loading={isSaving}
            large
            icon="tick"
          >
            {editItem ? '保存修改' : '添加收藏'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
