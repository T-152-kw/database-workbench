import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button,
  Spinner,
  Alert,
  OverlayToaster,
  Intent,
  Dialog,
  Classes,
  RadioGroup,
  Radio,
} from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import {
  RefreshIcon,
  AddIcon,
  EditIcon,
  DeleteIcon,
  SearchIcon,
  OpenIcon,
  DefinitionIcon,
  PlayIcon,
} from './DatabaseObjectIcons';
import { TableIcon, ViewIcon, FunctionIcon } from '../icons/TreeIcons';
import type {
  ConnectionProfile,
  TableDetail,
  ViewDetail,
  FunctionDetail,
  ObjectType,
} from '../../types';
import { metadataApi } from '../../hooks/useTauri';
import '../../styles/database-object-tab.css';

import type { Toaster } from '@blueprintjs/core';
let objectToaster: Toaster | null = null;
const getObjectToaster = async () => {
  if (!objectToaster) {
    objectToaster = await OverlayToaster.create({ position: 'top' });
  }
  return objectToaster;
};

interface DatabaseObjectTabProps {
  tabId: string;
  objectType: ObjectType;
  connectionProfile: ConnectionProfile;
  database: string;
  onOpenTableData?: (tableName: string) => void;
  onOpenViewData?: (viewName: string) => void;
  onViewDefinition?: (viewName: string) => void;
  onOpenViewDesigner?: (viewName: string) => void;
  onOpenFunctionDesigner?: (functionName: string, functionType?: 'FUNCTION' | 'PROCEDURE', autoExecute?: boolean) => void;
  onOpenDesigner?: (tableName?: string) => void;
}

type ObjectData = TableDetail | ViewDetail | FunctionDetail;

interface ColumnDef {
  key: string;
  title: string;
  width: number;
  minWidth: number;
  render: (obj: ObjectData) => React.ReactNode;
}

const formatBytes = (bytes?: number): string => {
  if (bytes === undefined || bytes === null) return '-';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatNumber = (num?: number): string => {
  if (num === undefined || num === null) return '-';
  return num.toLocaleString();
};

// Resizable header component
interface ResizableHeaderProps {
  column: ColumnDef;
  onResize: (key: string, newWidth: number) => void;
}

const ResizableHeader: React.FC<ResizableHeaderProps> = ({ column, onResize }) => {
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(column.width);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = column.width;
    e.preventDefault();
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.max(column.minWidth, startWidthRef.current + delta);
      onResize(column.key, newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, column.key, column.minWidth, onResize]);

  return (
    <th
      className="resizable-header"
      style={{ width: column.width, minWidth: column.minWidth }}
    >
      <div className="header-content">{column.title}</div>
      <div
        className={`resize-handle ${isResizing ? 'resizing' : ''}`}
        onMouseDown={handleMouseDown}
      />
    </th>
  );
};

export const DatabaseObjectTab: React.FC<DatabaseObjectTabProps> = ({
  tabId: _tabId,
  objectType,
  connectionProfile,
  database,
  onOpenTableData,
  onOpenViewData,
  onViewDefinition,
  onOpenViewDesigner,
  onOpenFunctionDesigner,
  onOpenDesigner,
}) => {
  const { t } = useTranslation();
  const [objects, setObjects] = useState<ObjectData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedObjectName, setSelectedObjectName] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [objectToDelete, setObjectToDelete] = useState<string | null>(null);
  const [newTypeDialogOpen, setNewTypeDialogOpen] = useState(false);
  const [selectedNewType, setSelectedNewType] = useState<'FUNCTION' | 'PROCEDURE'>('FUNCTION');

  const getObjectTypeKey = (type: ObjectType): string => {
    switch (type) {
      case 'TABLE':
        return 'table';
      case 'VIEW':
        return 'view';
      case 'FUNCTION':
        return 'function';
      default:
        return 'object';
    }
  };

  const getObjectIcon = (type: ObjectType) => {
    switch (type) {
      case 'TABLE':
        return <TableIcon size={16} />;
      case 'VIEW':
        return <ViewIcon size={16} />;
      case 'FUNCTION':
        return <FunctionIcon size={16} />;
      default:
        return null;
    }
  };

  // Define columns based on object type
  const getInitialColumns = (): ColumnDef[] => {
    switch (objectType) {
      case 'TABLE':
        return [
          {
            key: 'name',
            title: t('databaseObject.name'),
            width: 150,
            minWidth: 100,
            render: (obj) => (
              <div className="database-object-name">
                {getObjectIcon('TABLE')}
                <span>{(obj as TableDetail).Name}</span>
              </div>
            ),
          },
          {
            key: 'rows',
            title: t('databaseObject.rows'),
            width: 80,
            minWidth: 60,
            render: (obj) => formatNumber((obj as TableDetail).Rows),
          },
          {
            key: 'dataLength',
            title: t('databaseObject.dataLength'),
            width: 100,
            minWidth: 80,
            render: (obj) => formatBytes((obj as TableDetail).DataLength),
          },
          {
            key: 'engine',
            title: t('databaseObject.engine'),
            width: 100,
            minWidth: 80,
            render: (obj) => (obj as TableDetail).Engine || '-',
          },
          {
            key: 'updateTime',
            title: t('databaseObject.updateTime'),
            width: 150,
            minWidth: 120,
            render: (obj) => (obj as TableDetail).UpdateTime || '-',
          },
          {
            key: 'comment',
            title: t('databaseObject.comment'),
            width: 200,
            minWidth: 100,
            render: (obj) => (obj as TableDetail).Comment || '-',
          },
        ];
      case 'VIEW':
        return [
          {
            key: 'name',
            title: t('databaseObject.name'),
            width: 200,
            minWidth: 150,
            render: (obj) => (
              <div className="database-object-name">
                {getObjectIcon('VIEW')}
                <span>{(obj as ViewDetail).Name}</span>
              </div>
            ),
          },
          {
            key: 'updatable',
            title: t('databaseObject.updatable'),
            width: 80,
            minWidth: 60,
            render: (obj) => ((obj as ViewDetail).IsUpdatable === 'YES' ? t('common.yes') : t('common.no')),
          },
          {
            key: 'securityType',
            title: t('databaseObject.securityType'),
            width: 100,
            minWidth: 80,
            render: (obj) => (obj as ViewDetail).SecurityType || '-',
          },
          {
            key: 'definer',
            title: t('databaseObject.definer'),
            width: 150,
            minWidth: 120,
            render: (obj) => (obj as ViewDetail).Definer || '-',
          },
          {
            key: 'createTime',
            title: t('databaseObject.createTime'),
            width: 150,
            minWidth: 120,
            render: (obj) => (obj as ViewDetail).CreateTime || '-',
          },
          {
            key: 'updateTime',
            title: t('databaseObject.updateTime'),
            width: 150,
            minWidth: 120,
            render: (obj) => (obj as ViewDetail).UpdateTime || '-',
          },
        ];
      case 'FUNCTION':
        return [
          {
            key: 'name',
            title: t('databaseObject.name'),
            width: 150,
            minWidth: 100,
            render: (obj) => (
              <div className="database-object-name">
                {getObjectIcon('FUNCTION')}
                <span>{(obj as FunctionDetail).Name}</span>
              </div>
            ),
          },
          {
            key: 'type',
            title: t('databaseObject.type'),
            width: 100,
            minWidth: 80,
            render: (obj) => ((obj as FunctionDetail).Type === 'PROCEDURE' ? t('databaseObject.procedure') : t('databaseObject.function')),
          },
          {
            key: 'returnType',
            title: t('databaseObject.returnType'),
            width: 120,
            minWidth: 80,
            render: (obj) => (obj as FunctionDetail).DataType || '-',
          },
          {
            key: 'deterministic',
            title: t('databaseObject.deterministic'),
            width: 80,
            minWidth: 60,
            render: (obj) => ((obj as FunctionDetail).IsDeterministic === 'YES' ? t('common.yes') : t('common.no')),
          },
          {
            key: 'securityType',
            title: t('databaseObject.securityType'),
            width: 100,
            minWidth: 80,
            render: (obj) => (obj as FunctionDetail).SecurityType || '-',
          },
          {
            key: 'definer',
            title: t('databaseObject.definer'),
            width: 150,
            minWidth: 120,
            render: (obj) => (obj as FunctionDetail).Definer || '-',
          },
          {
            key: 'createTime',
            title: t('databaseObject.createTime'),
            width: 150,
            minWidth: 120,
            render: (obj) => (obj as FunctionDetail).CreateTime || '-',
          },
          {
            key: 'updateTime',
            title: t('databaseObject.updateTime'),
            width: 150,
            minWidth: 120,
            render: (obj) => (obj as FunctionDetail).UpdateTime || '-',
          },
          {
            key: 'comment',
            title: t('databaseObject.comment'),
            width: 150,
            minWidth: 80,
            render: (obj) => (obj as FunctionDetail).Comment || '-',
          },
        ];
      default:
        return [];
    }
  };

  const [columns, setColumns] = useState<ColumnDef[]>(getInitialColumns());

  // Reset columns when object type changes
  useEffect(() => {
    setColumns(getInitialColumns());
  }, [objectType, t]);

  const handleColumnResize = useCallback((key: string, newWidth: number) => {
    setColumns((prev) =>
      prev.map((col) => (col.key === key ? { ...col, width: newWidth } : col))
    );
  }, []);

  const fetchObjects = useCallback(async () => {
    if (!connectionProfile || !database) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let data: ObjectData[];
      switch (objectType) {
        case 'TABLE':
          data = await metadataApi.listTableDetails(connectionProfile, database);
          break;
        case 'VIEW':
          data = await metadataApi.listViewDetails(connectionProfile, database);
          break;
        case 'FUNCTION':
          data = await metadataApi.listFunctionDetails(connectionProfile, database);
          break;
        default:
          data = [];
      }
      setObjects(data);

      // 刷新后检查当前选中的对象是否还存在，如果不存在则清除选中状态
      setSelectedObjectName((prevSelected) => {
        if (prevSelected) {
          const stillExists = data.some((obj) => 'Name' in obj && obj.Name === prevSelected);
          return stillExists ? prevSelected : null;
        }
        return null;
      });
    } catch (err) {
      setError(t('databaseObject.loadFailed', { type: t(`databaseObject.${getObjectTypeKey(objectType)}`), error: err }));
      setObjects([]);
    } finally {
      setIsLoading(false);
    }
  }, [connectionProfile, database, objectType, t]);

  useEffect(() => {
    fetchObjects();
  }, [fetchObjects]);

  const handleRefresh = useCallback(() => {
    fetchObjects();
  }, [fetchObjects]);

  const handleNew = useCallback(() => {
    switch (objectType) {
      case 'TABLE':
        onOpenDesigner?.();
        break;
      case 'VIEW':
        onOpenViewDesigner?.('new_view');
        break;
      case 'FUNCTION':
        setNewTypeDialogOpen(true);
        break;
    }
  }, [objectType, onOpenDesigner, onOpenViewDesigner]);

  const handleNewTypeConfirm = useCallback(() => {
    setNewTypeDialogOpen(false);
    onOpenFunctionDesigner?.('', selectedNewType);
  }, [selectedNewType, onOpenFunctionDesigner]);

  const handleDesign = useCallback((name: string) => {
    switch (objectType) {
      case 'TABLE':
        onOpenDesigner?.(name);
        break;
      case 'VIEW':
        onOpenViewDesigner?.(name);
        break;
      case 'FUNCTION': {
        const func = objects.find((obj) => 'Name' in obj && obj.Name === name) as FunctionDetail | undefined;
        const funcType = func?.Type === 'PROCEDURE' ? 'PROCEDURE' : 'FUNCTION';
        onOpenFunctionDesigner?.(name, funcType);
        break;
      }
    }
  }, [objectType, onOpenDesigner, onOpenViewDesigner, onOpenFunctionDesigner, objects]);

  const handleDelete = useCallback((name: string) => {
    setObjectToDelete(name);
    setDeleteDialogOpen(true);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!objectToDelete) return;

    try {
      let sql = '';
      switch (objectType) {
        case 'TABLE':
          sql = `DROP TABLE \`${objectToDelete.replace(/`/g, '``')}\``;
          break;
        case 'VIEW':
          sql = `DROP VIEW \`${objectToDelete.replace(/`/g, '``')}\``;
          break;
        case 'FUNCTION': {
          const funcToDelete = objects.find((obj) => 'Name' in obj && obj.Name === objectToDelete) as FunctionDetail | undefined;
          const funcType = funcToDelete?.Type === 'PROCEDURE' ? 'PROCEDURE' : 'FUNCTION';
          sql = `DROP ${funcType} \`${objectToDelete.replace(/`/g, '``')}\``;
          break;
        }
      }

      await metadataApi.executeSql(connectionProfile, sql, database);
      setDeleteDialogOpen(false);
      const deletedName = objectToDelete;
      setObjectToDelete(null);

      // 如果被删除的对象是当前选中的对象，清除选中状态
      if (selectedObjectName === deletedName) {
        setSelectedObjectName(null);
      }

      fetchObjects();
      (await getObjectToaster())?.show({
        message: t('databaseObject.deleteSuccess', { type: t(`databaseObject.${getObjectTypeKey(objectType)}`), name: deletedName }),
        intent: Intent.SUCCESS,
        timeout: 3000,
      });
    } catch (err) {
      setError(t('databaseObject.deleteFailed', { type: t(`databaseObject.${getObjectTypeKey(objectType)}`), error: err }));
    }
  }, [objectToDelete, objectType, connectionProfile, database, fetchObjects, objects, selectedObjectName, t]);

  const handleDoubleClick = useCallback((obj: ObjectData) => {
    const name = 'Name' in obj ? obj.Name : '';
    switch (objectType) {
      case 'TABLE':
        onOpenTableData?.(name);
        break;
      case 'VIEW':
        onOpenViewData?.(name);
        break;
      case 'FUNCTION': {
        const func = obj as FunctionDetail;
        const funcType = func.Type === 'PROCEDURE' ? 'PROCEDURE' : 'FUNCTION';
        onOpenFunctionDesigner?.(name, funcType);
        break;
      }
    }
  }, [objectType, onOpenTableData, onOpenViewData, onOpenFunctionDesigner]);

  const filteredObjects = objects.filter((obj) => {
    if (!searchText) return true;
    const name = 'Name' in obj ? obj.Name : '';
    return name.toLowerCase().includes(searchText.toLowerCase());
  });

  const getObjectName = (obj: ObjectData): string => {
    return 'Name' in obj ? obj.Name : '';
  };

  return (
    <div className="database-object-tab">
      <div className="database-object-toolbar">
        <div className="database-object-toolbar-row">
          <div className="database-object-search-box">
            <SearchIcon size={14} className="database-object-search-icon" />
            <input
              type="text"
              className="database-object-search-input"
              placeholder={t('databaseObject.searchPlaceholder', { type: t(`databaseObject.${getObjectTypeKey(objectType)}`) })}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            {searchText && (
              <button
                className="database-object-search-clear"
                onClick={() => setSearchText('')}
              >
                <DeleteIcon size={12} />
              </button>
            )}
          </div>

          {/* 统计信息 - 放在搜索框旁边 */}
          <div className="database-object-info-inline">
            <span className="database-object-count">
              {t('databaseObject.totalCount', { count: filteredObjects.length, type: t(`databaseObject.${getObjectTypeKey(objectType)}`) })}
            </span>
          </div>

          <div className="database-object-toolbar-spacer" />

          <div className="database-object-toolbar-group">
            <Button
              minimal
              small
              icon={<RefreshIcon size={14} />}
              onClick={handleRefresh}
              loading={isLoading}
              title={t('common.refresh')}
            >
              {t('common.refresh')}
            </Button>

            {objectType === 'VIEW' && selectedObjectName && (
              <Button
                minimal
                small
                icon={<OpenIcon size={14} />}
                onClick={() => onOpenViewData?.(selectedObjectName)}
                title={t('databaseObject.openView')}
              >
                {t('databaseObject.open')}
              </Button>
            )}

            {objectType === 'FUNCTION' && selectedObjectName && (
              <Button
                minimal
                small
                icon={<PlayIcon size={14} />}
                onClick={() => {
                  const func = objects.find((obj) => 'Name' in obj && obj.Name === selectedObjectName) as FunctionDetail | undefined;
                  const funcType = func?.Type === 'PROCEDURE' ? 'PROCEDURE' : 'FUNCTION';
                  onOpenFunctionDesigner?.(selectedObjectName, funcType, true);
                }}
                title={t('common.execute')}
              >
                {t('common.execute')}
              </Button>
            )}

            <Button
              minimal
              small
              icon={<AddIcon size={14} />}
              onClick={handleNew}
              title={t('databaseObject.new', { type: t(`databaseObject.${getObjectTypeKey(objectType)}`) })}
            >
              {t('common.create')}
            </Button>

            {selectedObjectName && (
              <>
                {objectType === 'TABLE' && (
                  <Button
                    minimal
                    small
                    icon={<OpenIcon size={14} />}
                    onClick={() => onOpenTableData?.(selectedObjectName)}
                    title={t('databaseObject.open')}
                  >
                    {t('databaseObject.open')}
                  </Button>
                )}
                <Button
                  minimal
                  small
                  icon={<EditIcon size={14} />}
                  onClick={() => handleDesign(selectedObjectName)}
                  title={t('common.edit')}
                >
                  {t('common.edit')}
                </Button>
                {objectType === 'VIEW' && (
                  <Button
                    minimal
                    small
                    icon={<DefinitionIcon size={14} />}
                    onClick={() => onViewDefinition?.(selectedObjectName)}
                    title={t('databaseObject.definition')}
                  >
                    {t('databaseObject.definition')}
                  </Button>
                )}
                <Button
                  minimal
                  small
                  icon={<DeleteIcon size={14} />}
                  intent="danger"
                  onClick={() => handleDelete(selectedObjectName)}
                  title={t('common.delete')}
                >
                  {t('common.delete')}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="database-object-content">
        {isLoading && (
          <div className="database-object-loading">
            <Spinner size={32} />
            <span>{t('databaseObject.loading', { type: t(`databaseObject.${getObjectTypeKey(objectType)}`) })}</span>
          </div>
        )}

        {error && (
          <div className="database-object-error">
            <span>{error}</span>
            <Button minimal small onClick={handleRefresh}>
              {t('common.retry')}
            </Button>
          </div>
        )}

        {!isLoading && !error && filteredObjects.length === 0 && (
          <div className="database-object-empty">
            <span>{t('databaseObject.empty', { type: t(`databaseObject.${getObjectTypeKey(objectType)}`) })}</span>
          </div>
        )}

        {!isLoading && !error && filteredObjects.length > 0 && (
          <div className="database-object-table-wrapper">
            <table className="database-object-table resizable-table">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <ResizableHeader
                      key={col.key}
                      column={col}
                      onResize={handleColumnResize}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredObjects.map((obj) => (
                  <tr
                    key={getObjectName(obj)}
                    className={`database-object-row ${selectedObjectName === getObjectName(obj) ? 'selected' : ''}`}
                    onClick={() => setSelectedObjectName(getObjectName(obj))}
                    onDoubleClick={() => handleDoubleClick(obj)}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        style={{ width: col.width, minWidth: col.minWidth }}
                      >
                        {col.render(obj)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Alert
        isOpen={deleteDialogOpen}
        cancelButtonText={t('common.cancel')}
        confirmButtonText={t('common.delete')}
        icon={<DeleteIcon size={20} />}
        intent="danger"
        onCancel={() => {
          setDeleteDialogOpen(false);
          setObjectToDelete(null);
        }}
        onConfirm={confirmDelete}
      >
        <p>
          {t('databaseObject.deleteConfirm', { type: t(`databaseObject.${getObjectTypeKey(objectType)}`), name: objectToDelete })}
        </p>
        <p>{t('databaseObject.deleteWarning')}</p>
      </Alert>

      <Dialog
        isOpen={newTypeDialogOpen}
        onClose={() => setNewTypeDialogOpen(false)}
        title={t('databaseObject.newObject')}
        className="new-type-dialog"
      >
        <div className={Classes.DIALOG_BODY}>
          <p>{t('databaseObject.selectType')}</p>
          <RadioGroup
            selectedValue={selectedNewType}
            onChange={(e) => setSelectedNewType(e.currentTarget.value as 'FUNCTION' | 'PROCEDURE')}
          >
            <Radio label={t('databaseObject.function')} value="FUNCTION" />
            <Radio label={t('databaseObject.procedure')} value="PROCEDURE" />
          </RadioGroup>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setNewTypeDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button intent="primary" onClick={handleNewTypeConfirm}>
              {t('common.ok')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default DatabaseObjectTab;
