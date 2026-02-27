import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Tree, Menu, MenuItem, showContextMenu, Divider, Alert } from '@blueprintjs/core';
import type { TreeNodeInfo } from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import {
  MySqlConnectionIcon,
  DatabaseIcon,
  FolderIcon,
  TableIcon,
  ViewIcon,
  FunctionIcon,
  FieldListIcon,
  KeyIcon,
  IndexIcon,
  ForeignKeyIcon,
  CheckIcon,
  TriggerIcon,
  ParamIcon,
} from '../icons';
import { useConnectionStore, useAppStore } from '../../stores';
import { tauriApi } from '../../hooks';
import type { ConnectionProfile } from '../../types';
import { ConfirmDialog, CreateDatabaseDialog, ConnectionDialog } from '../dialogs';
import { showEditConnectionNotice } from '../../utils';

const SYSTEM_DATABASES = new Set(['mysql', 'information_schema', 'performance_schema', 'sys']);
const GLOBAL_REFRESH_EVENT = 'dbw:global-refresh';

interface TreeNodeData {
  connection?: ConnectionProfile;
  connectionId?: string;
  database?: string;
  table?: string;
  routineType?: 'FUNCTION' | 'PROCEDURE';
  isSystemDb?: boolean;
  folderType?: 'tables' | 'views' | 'functions' | 'columns' | 'indexes' | 'foreignKeys' | 'checks' | 'triggers';
  itemType?: 'table' | 'view' | 'function' | 'column' | 'index' | 'foreignKey' | 'check' | 'trigger' | 'param';
  isDbOpened?: boolean;
}

type TreeNode = TreeNodeInfo<TreeNodeData>;

const isConnectionNodeLikeJava = (node: TreeNode, parent: TreeNode | null): boolean => {
  return parent === null && !!node.nodeData?.connection;
};

const isDatabaseNodeLikeJava = (node: TreeNode, parent: TreeNode | null): boolean => {
  return parent !== null && isConnectionNodeLikeJava(parent, null) && !!node.nodeData?.database;
};

const findNodePathById = (
  treeNodes: TreeNode[],
  targetId: string,
  parent: TreeNode | null = null,
): Array<{ node: TreeNode; parent: TreeNode | null }> | null => {
  for (const node of treeNodes) {
    const current = { node, parent };
    if (String(node.id) === targetId) {
      return [current];
    }
    if (node.childNodes && node.childNodes.length > 0) {
      const childPath = findNodePathById(node.childNodes as TreeNode[], targetId, node);
      if (childPath) {
        return [current, ...childPath];
      }
    }
  }
  return null;
};

const getSelectedProfileLikeJava = (treeNodes: TreeNode[], selectedId: string): ConnectionProfile | undefined => {
  const path = findNodePathById(treeNodes, selectedId);
  if (!path || path.length === 0) return undefined;

  for (let i = path.length - 1; i >= 0; i -= 1) {
    const current = path[i];
    if (isConnectionNodeLikeJava(current.node, current.parent)) {
      return current.node.nodeData?.connection;
    }
  }
  return undefined;
};

const getSelectedDatabaseLikeJava = (treeNodes: TreeNode[], selectedId: string): string | undefined => {
  const path = findNodePathById(treeNodes, selectedId);
  if (!path || path.length === 0) return undefined;

  const selected = path[path.length - 1];
  if (isDatabaseNodeLikeJava(selected.node, selected.parent)) {
    return selected.node.nodeData?.database;
  }

  for (let i = path.length - 1; i >= 0; i -= 1) {
    const current = path[i];
    if (isDatabaseNodeLikeJava(current.node, current.parent)) {
      return current.node.nodeData?.database;
    }
    if (current.parent) {
      const grandParent = i - 2 >= 0 ? path[i - 2].node : null;
      if (isDatabaseNodeLikeJava(current.parent, grandParent)) {
        return current.parent.nodeData?.database;
      }
    }
  }

  return undefined;
};

const applySelectionToNodes = (treeNodes: TreeNode[], selectedId: string | null): TreeNode[] => {
  return treeNodes.map((node) => {
    const nodeId = String(node.id);
    const selected = !!selectedId && nodeId === selectedId;
    return {
      ...node,
      isSelected: selected,
      childNodes: node.childNodes
        ? applySelectionToNodes(node.childNodes as TreeNode[], selectedId)
        : node.childNodes,
    };
  });
};

export const MetadataTree: React.FC<{ searchQuery: string }> = ({ searchQuery }) => {
  const { t } = useTranslation();
  const { theme, setStatusMessage } = useAppStore();
  const {
    connections,
    setActiveConnection,
    setActiveDatabase,
    setLastUsedDatabaseForConnection,
    clearLastUsedDatabaseForConnection,
    removeConnection,
    connect,
    disconnect,
    checkMaxConnections,
  } = useConnectionStore();
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const nodesRef = useRef<TreeNode[]>([]);
  const [, setSelectedNodeId] = useState<string | null>(null);
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    intent?: 'primary' | 'danger';
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  
  const [createDbDialog, setCreateDbDialog] = useState<{
    isOpen: boolean;
    connection?: ConnectionProfile;
    nodeId?: string;
  }>({ isOpen: false });
  
  const [editConnectionDialog, setEditConnectionDialog] = useState<{
    isOpen: boolean;
    profile?: ConnectionProfile;
    nodeId?: string;
  }>({ isOpen: false });
  
  const [alertDialog, setAlertDialog] = useState<{
    isOpen: boolean;
    message: string;
  }>({ isOpen: false, message: '' });

  const [systemDbConfirmDialog, setSystemDbConfirmDialog] = useState<{
    isOpen: boolean;
    node?: TreeNode;
  }>({ isOpen: false });

  const isConnectionConnected = useCallback((node: TreeNode): boolean => {
    return !!(node.childNodes && node.childNodes.length > 0);
  }, []);

  const isDatabaseOpened = useCallback((node: TreeNode): boolean => {
    return node.nodeData?.isDbOpened === true;
  }, []);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    setNodes((prev) => {
      const previousById = new Map(prev.map((node) => [String(node.id), node]));

      return connections.map((conn, index) => {
        const connId = conn.profile.name || `conn-${index}`;
        const existing = previousById.get(connId);

        if (existing) {
          return {
            ...existing,
            id: connId,
            label: conn.profile.name || `${conn.profile.host}:${conn.profile.port}`,
            nodeData: {
              ...(existing.nodeData || {}),
              connection: conn.profile,
              connectionId: connId,
            },
          };
        }

        return {
          id: connId,
          label: conn.profile.name || `${conn.profile.host}:${conn.profile.port}`,
          icon: <MySqlConnectionIcon active={false} size={16} />,
          isExpanded: false,
          hasCaret: false,
          childNodes: undefined,
          nodeData: {
            connection: conn.profile,
            connectionId: connId,
          },
        };
      });
    });
  }, [connections]);

  const buildTableCategoryNodes = useCallback((
    baseId: string,
    profile: ConnectionProfile,
    database: string,
    table: string
  ): TreeNode[] => {
    return [
      {
        id: `${baseId}-columns`,
        label: t('metadataTree.columns'),
        icon: <FieldListIcon size={16} />,
        isExpanded: false,
        hasCaret: true,
        nodeData: {
          connection: profile,
          database,
          table,
          folderType: 'columns',
        },
      },
      {
        id: `${baseId}-indexes`,
        label: t('metadataTree.indexes'),
        icon: <IndexIcon size={16} />,
        isExpanded: false,
        hasCaret: true,
        nodeData: {
          connection: profile,
          database,
          table,
          folderType: 'indexes',
        },
      },
      {
        id: `${baseId}-foreign-keys`,
        label: t('metadataTree.foreignKeys'),
        icon: <ForeignKeyIcon size={16} />,
        isExpanded: false,
        hasCaret: true,
        nodeData: {
          connection: profile,
          database,
          table,
          folderType: 'foreignKeys',
        },
      },
      {
        id: `${baseId}-checks`,
        label: t('metadataTree.checks'),
        icon: <CheckIcon size={16} />,
        isExpanded: false,
        hasCaret: true,
        nodeData: {
          connection: profile,
          database,
          table,
          folderType: 'checks',
        },
      },
      {
        id: `${baseId}-triggers`,
        label: t('metadataTree.triggers'),
        icon: <TriggerIcon size={16} />,
        isExpanded: false,
        hasCaret: true,
        nodeData: {
          connection: profile,
          database,
          table,
          folderType: 'triggers',
        },
      },
    ];
  }, [t]);

  const renderRoutineLabel = useCallback((name: string, routineType?: string, returnType?: string) => {
    if (routineType === 'FUNCTION' && returnType) {
      return (
        <span>
          {name}
          <span style={{ color: '#2f6fed', marginLeft: 8 }}>{returnType}</span>
        </span>
      );
    }
    return name;
  }, []);

  const buildParamLabel = useCallback((param: { name: string; type?: string; mode?: string }, parentType?: string) => {
    const modeText = parentType === 'PROCEDURE' && param.mode ? `${param.mode} ` : '';
    return (
      <span style={{ color: '#808080' }}>
        {modeText}{param.name}{param.type ? ` : ${param.type}` : ''}
      </span>
    );
  }, []);

  const getNoParamsText = useCallback(() => {
    return `<${t('metadataTree.noParams')}>`;
  }, [t]);

  const connectConnection = useCallback(async (node: TreeNode) => {
    if (!node.nodeData?.connection) return;
    const nodeId = node.id as string;
    if (loadingNodes.has(nodeId)) return;

    // 检查最大连接数限制
    const { allowed, current, max } = checkMaxConnections();
    if (!allowed) {
      setAlertDialog({
        isOpen: true,
        message: t('metadataTree.maxConnectionsReached', { current, max }),
      });
      return;
    }

    setLoadingNodes(prev => new Set([...prev, nodeId]));

    try {
      const connectionName = node.nodeData.connection.name;
      if (connectionName) {
        await connect(connectionName);
      }

      setStatusMessage(t('metadataTree.loadingDatabases'));
      const databases = await tauriApi.metadata.listDatabases(node.nodeData.connection);
      
      const systemDbs = databases.filter(db => SYSTEM_DATABASES.has(db.toLowerCase()));
      const userDbs = databases.filter(db => !SYSTEM_DATABASES.has(db.toLowerCase()));
      const allDbs = [...systemDbs, ...userDbs];

      const dbNodes: TreeNode[] = allDbs.map(db => ({
        id: `${nodeId}-${db}`,
        label: db,
        icon: <DatabaseIcon
          opened={false}
          isSystemDb={SYSTEM_DATABASES.has(db.toLowerCase())}
          size={16}
        />,
        className: SYSTEM_DATABASES.has(db.toLowerCase()) ? 'system-db-node' : undefined,
        isExpanded: false,
        hasCaret: false,
        nodeData: {
          connection: node.nodeData?.connection,
          database: db,
          isSystemDb: SYSTEM_DATABASES.has(db.toLowerCase()),
          isDbOpened: false,
        },
      }));

      setNodes(prev => prev.map(n =>
        n.id === nodeId
          ? {
              ...n,
              childNodes: dbNodes,
              isExpanded: true,
              hasCaret: true,
              icon: <MySqlConnectionIcon active={true} size={16} />,
            }
          : n
      ));
      if (node.nodeData?.connection?.name) {
        setActiveConnection(node.nodeData.connection.name);
      }
      setStatusMessage(t('metadataTree.databasesLoaded', { count: dbNodes.length }));
    } catch (error) {
      console.error(t('metadataTree.connectionFailed'), error);
      setStatusMessage(t('metadataTree.connectionFailedWithError', { error: String(error) }));
    } finally {
      setLoadingNodes(prev => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }
  }, [loadingNodes, connect, setStatusMessage, setActiveConnection, t]);

  const closeConnection = useCallback(async (node: TreeNode) => {
    if (!node.nodeData?.connection) return;
    const nodeId = node.id as string;
    
    const connectionName = node.nodeData.connection.name;
    if (connectionName) {
      try {
        await disconnect(connectionName);
      } catch (e) {
        console.warn('关闭连接池失败:', e);
      }
    }
    
    setNodes(prev => prev.map(n =>
      n.id === nodeId
        ? {
            ...n,
            childNodes: undefined,
            isExpanded: false,
            hasCaret: false,
            icon: <MySqlConnectionIcon active={false} size={16} />,
          }
        : n
    ));
    setStatusMessage(t('metadataTree.connectionClosed'));
  }, [disconnect, setStatusMessage, t]);

  const connectDatabase = useCallback(async (node: TreeNode) => {
    if (!node.nodeData?.connection || !node.nodeData?.database) return;
    const nodeId = node.id as string;
    if (loadingNodes.has(nodeId)) return;
    setLoadingNodes(prev => new Set([...prev, nodeId]));

    try {
      const folderNodes: TreeNode[] = [
        {
          id: `${nodeId}-tables`,
          label: t('metadataTree.tables'),
          icon: <FolderIcon type="table" size={16} />,
          isExpanded: false,
          hasCaret: true,
          nodeData: {
            connection: node.nodeData.connection,
            database: node.nodeData.database,
            folderType: 'tables',
          },
        },
        {
          id: `${nodeId}-views`,
          label: t('metadataTree.views'),
          icon: <FolderIcon type="view" size={16} />,
          isExpanded: false,
          hasCaret: true,
          nodeData: {
            connection: node.nodeData.connection,
            database: node.nodeData.database,
            folderType: 'views',
          },
        },
        {
          id: `${nodeId}-functions`,
          label: t('metadataTree.functions'),
          icon: <FolderIcon type="function" size={16} />,
          isExpanded: false,
          hasCaret: true,
          nodeData: {
            connection: node.nodeData.connection,
            database: node.nodeData.database,
            folderType: 'functions',
          },
        },
      ];

      setNodes(prev => {
        const updateNode = (nodes: TreeNode[]): TreeNode[] => {
          return nodes.map(n => {
            if (n.id === nodeId) {
              return {
                ...n,
                childNodes: folderNodes,
                isExpanded: true,
                hasCaret: true,
                icon: <DatabaseIcon
                  opened={true}
                  isSystemDb={n.nodeData?.isSystemDb || false}
                  size={16}
                />,
                nodeData: { ...n.nodeData!, isDbOpened: true },
              };
            }
            if (n.childNodes) {
              return { ...n, childNodes: updateNode(n.childNodes as TreeNode[]) };
            }
            return n;
          });
        };
        return updateNode(prev);
      });
    } catch (error) {
      console.error(t('metadataTree.openDatabaseFailed'), error);
    } finally {
      setLoadingNodes(prev => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }
  }, [loadingNodes]);

  const closeDatabase = useCallback(async (node: TreeNode) => {
    const nodeId = node.id as string;
    
    setNodes(prev => {
      const updateNode = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map(n => {
          if (n.id === nodeId) {
            return {
              ...n,
              childNodes: undefined,
              isExpanded: false,
              hasCaret: false,
              icon: <DatabaseIcon
                opened={false}
                isSystemDb={n.nodeData?.isSystemDb || false}
                size={16}
              />,
              nodeData: { ...n.nodeData!, isDbOpened: false },
            };
          }
          if (n.childNodes) {
            return { ...n, childNodes: updateNode(n.childNodes as TreeNode[]) };
          }
          return n;
        });
      };
      return updateNode(prev);
    });
    setStatusMessage(t('metadataTree.databaseClosed'));
  }, [setStatusMessage, t]);

  const loadFolder = useCallback(async (node: TreeNode) => {
    if (!node.nodeData?.folderType || !node.nodeData?.connection || !node.nodeData?.database) return;
    const nodeId = node.id as string;
    if (loadingNodes.has(nodeId)) return;
    setLoadingNodes(prev => new Set([...prev, nodeId]));

    try {
      let items: string[] = [];
      let routines: Array<{ name: string; type: string; returnType?: string; params: Array<{ name: string; type: string; mode?: string }> }> = [];
      let records: Array<Record<string, string>> = [];
      switch (node.nodeData.folderType) {
        case 'tables':
          items = await tauriApi.metadata.listTables(node.nodeData.connection, node.nodeData.database);
          break;
        case 'views':
          items = await tauriApi.metadata.listViews(node.nodeData.connection, node.nodeData.database);
          break;
        case 'functions':
          routines = await tauriApi.metadata.listRoutinesWithDetails(node.nodeData.connection, node.nodeData.database);
          break;
        case 'columns':
          if (node.nodeData.table) {
            records = await tauriApi.metadata.listColumns(node.nodeData.connection, node.nodeData.database, node.nodeData.table);
          }
          break;
        case 'indexes':
          if (node.nodeData.table) {
            records = await tauriApi.metadata.listIndexes(node.nodeData.connection, node.nodeData.database, node.nodeData.table);
          }
          break;
        case 'foreignKeys':
          if (node.nodeData.table) {
            records = await tauriApi.metadata.listForeignKeys(node.nodeData.connection, node.nodeData.database, node.nodeData.table);
          }
          break;
        case 'checks':
          if (node.nodeData.table) {
            records = await tauriApi.metadata.listChecks(node.nodeData.connection, node.nodeData.database, node.nodeData.table);
          }
          break;
        case 'triggers':
          if (node.nodeData.table) {
            records = await tauriApi.metadata.listTriggers(node.nodeData.connection, node.nodeData.database, node.nodeData.table);
          }
          break;
      }

      let itemNodes: TreeNode[] = [];

      if (node.nodeData.folderType === 'tables') {
        if (items.length === 0) {
          itemNodes = [{
            id: `${nodeId}-empty`,
            label: `<${t('metadataTree.noTables')}>`,
            hasCaret: false,
          }];
        } else {
          itemNodes = items.map(item => {
          const baseId = `${nodeId}-${item}`;
          return {
            id: baseId,
            label: item,
            icon: <TableIcon size={16} />,
            isExpanded: false,
            hasCaret: true,
            childNodes: buildTableCategoryNodes(baseId, node.nodeData!.connection!, node.nodeData!.database!, item),
            nodeData: {
              connection: node.nodeData?.connection,
              database: node.nodeData?.database,
              table: item,
              itemType: 'table',
            },
          };
          });
        }
      } else if (node.nodeData.folderType === 'views') {
        if (items.length === 0) {
          itemNodes = [{
            id: `${nodeId}-empty`,
            label: `<${t('metadataTree.noViews')}>`,
            hasCaret: false,
          }];
        } else {
          itemNodes = items.map(item => ({
            id: `${nodeId}-${item}`,
            label: item,
            icon: <ViewIcon size={16} />,
            hasCaret: false,
            nodeData: {
              connection: node.nodeData?.connection,
              database: node.nodeData?.database,
              itemType: 'view',
            },
          }));
        }
      } else if (node.nodeData.folderType === 'functions') {
        if (routines.length === 0) {
          itemNodes = [{
            id: `${nodeId}-empty`,
            label: `<${t('metadataTree.noFunctions')}>`,
            hasCaret: false,
          }];
        } else {
          itemNodes = routines.map(routine => {
          const paramNodes: TreeNode[] = routine.params && routine.params.length > 0
            ? routine.params.map((param, index) => ({
                id: `${nodeId}-${routine.name}-param-${index}`,
                label: buildParamLabel(param, routine.type),
                icon: <ParamIcon size={12} />,
                hasCaret: false,
                nodeData: {
                  connection: node.nodeData?.connection,
                  database: node.nodeData?.database,
                  itemType: 'param',
                },
              }))
            : [{
                id: `${nodeId}-${routine.name}-param-none`,
                label: getNoParamsText(),
                hasCaret: false,
                nodeData: {
                  connection: node.nodeData?.connection,
                  database: node.nodeData?.database,
                  itemType: 'param',
                },
              }];

          return {
            id: `${nodeId}-${routine.name}`,
            label: renderRoutineLabel(routine.name, routine.type, routine.returnType),
            icon: <FunctionIcon size={16} />,
            isExpanded: false,
            hasCaret: true,
            childNodes: paramNodes,
            nodeData: {
              connection: node.nodeData?.connection,
              database: node.nodeData?.database,
              itemType: 'function',
              routineType: routine.type as 'FUNCTION' | 'PROCEDURE',
            },
          };
          });
        }
      } else if (node.nodeData.folderType === 'columns') {
        if (records.length === 0) {
          itemNodes = [{
            id: `${nodeId}-empty`,
            label: `<${t('metadataTree.noColumns')}>`,
            hasCaret: false,
          }];
        } else {
          itemNodes = records.map((record, index) => {
            const name = record.COLUMN_NAME || '';
            const type = record.COLUMN_TYPE || '';
            const keyType = record.COLUMN_KEY || '';
            return {
              id: `${nodeId}-col-${index}`,
              label: `${name} - ${type}`,
              icon: <KeyIcon size={14} keyType={keyType} />,
              hasCaret: false,
              nodeData: {
                connection: node.nodeData?.connection,
                database: node.nodeData?.database,
                table: node.nodeData?.table,
                itemType: 'column',
              },
            };
          });
        }
      } else if (node.nodeData.folderType === 'indexes') {
        if (records.length === 0) {
          itemNodes = [{ id: `${nodeId}-empty`, label: `<${t('metadataTree.noIndexes')}>`, hasCaret: false }];
        } else {
          itemNodes = records.map((record, index) => {
            const name = record.INDEX_NAME || '';
            const nonUnique = record.NON_UNIQUE || '';
            const cols = record.COLUMNS || '';
            const label = `${name}${nonUnique === '0' ? ' (Unique)' : ''} : ${cols}`;
            return {
              id: `${nodeId}-idx-${index}`,
              label,
              icon: <IndexIcon size={14} />,
              hasCaret: false,
              nodeData: {
                connection: node.nodeData?.connection,
                database: node.nodeData?.database,
                table: node.nodeData?.table,
                itemType: 'index',
              },
            };
          });
        }
      } else if (node.nodeData.folderType === 'foreignKeys') {
        if (records.length === 0) {
          itemNodes = [{ id: `${nodeId}-empty`, label: `<${t('metadataTree.noForeignKeys')}>`, hasCaret: false }];
        } else {
          itemNodes = records.map((record, index) => {
            const label = `${record.CONSTRAINT_NAME || ''} (${record.COLUMN_NAME || ''} -> ${record.REFERENCED_TABLE_NAME || ''}.${record.REFERENCED_COLUMN_NAME || ''})`;
            return {
              id: `${nodeId}-fk-${index}`,
              label,
              icon: <ForeignKeyIcon size={14} />,
              hasCaret: false,
              nodeData: {
                connection: node.nodeData?.connection,
                database: node.nodeData?.database,
                table: node.nodeData?.table,
                itemType: 'foreignKey',
              },
            };
          });
        }
      } else if (node.nodeData.folderType === 'checks') {
        if (records.length === 0) {
          itemNodes = [{ id: `${nodeId}-empty`, label: `<${t('metadataTree.noChecks')}>`, hasCaret: false }];
        } else {
          itemNodes = records.map((record, index) => ({
            id: `${nodeId}-check-${index}`,
            label: `${record.CONSTRAINT_NAME || ''}: ${record.CHECK_CLAUSE || ''}`,
            icon: <CheckIcon size={14} />,
            hasCaret: false,
            nodeData: {
              connection: node.nodeData?.connection,
              database: node.nodeData?.database,
              table: node.nodeData?.table,
              itemType: 'check',
            },
          }));
        }
      } else if (node.nodeData.folderType === 'triggers') {
        if (records.length === 0) {
          itemNodes = [{ id: `${nodeId}-empty`, label: `<${t('metadataTree.noTriggers')}>`, hasCaret: false }];
        } else {
          itemNodes = records.map((record, index) => ({
            id: `${nodeId}-trigger-${index}`,
            label: `${record.TRIGGER_NAME || ''} (${record.ACTION_TIMING || ''} ${record.EVENT_MANIPULATION || ''})`,
            icon: <TriggerIcon size={14} />,
            hasCaret: false,
            nodeData: {
              connection: node.nodeData?.connection,
              database: node.nodeData?.database,
              table: node.nodeData?.table,
              itemType: 'trigger',
            },
          }));
        }
      }

      setNodes(prev => {
        const updateNode = (nodes: TreeNode[]): TreeNode[] => {
          return nodes.map(n => {
            if (n.id === nodeId) {
              return { ...n, childNodes: itemNodes, isExpanded: true };
            }
            if (n.childNodes) {
              return { ...n, childNodes: updateNode(n.childNodes as TreeNode[]) };
            }
            return n;
          });
        };
        return updateNode(prev);
      });
    } catch (error) {
      console.error(t('metadataTree.loadFailed'), error);
    } finally {
      setLoadingNodes(prev => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }
  }, [loadingNodes, buildTableCategoryNodes, buildParamLabel, renderRoutineLabel]);

  const handleNodeDoubleClick = useCallback((node: TreeNode) => {
    if (!node.nodeData) return;
    if (node.nodeData.connectionId && (!node.childNodes || node.childNodes.length === 0)) {
      connectConnection(node);
    } else if (node.nodeData.database && node.nodeData.isDbOpened === false && !node.nodeData.folderType && !node.nodeData.itemType) {
      if (node.nodeData.isSystemDb) {
        setSystemDbConfirmDialog({ isOpen: true, node });
      } else {
        connectDatabase(node);
      }
    }
  }, [connectConnection, connectDatabase]);

  const handleNodeClick = useCallback((node: TreeNode, _nodePath: number[], e: React.MouseEvent<HTMLElement>) => {
    if (e.detail === 2) {
      handleNodeDoubleClick(node);
      return;
    }

    const clickedNodeId = String(node.id);
    setSelectedNodeId(clickedNodeId);
    setNodes(prev => applySelectionToNodes(prev, clickedNodeId));

    const selectedProfile = getSelectedProfileLikeJava(nodes, clickedNodeId);
    const selectedDatabase = getSelectedDatabaseLikeJava(nodes, clickedNodeId);

    if (selectedProfile?.name) {
      setActiveConnection(selectedProfile.name);
      if (selectedDatabase) {
        setLastUsedDatabaseForConnection(selectedProfile.name, selectedDatabase);
      } else {
        // 当没有选中数据库时，清除该连接的lastUsedDatabase
        clearLastUsedDatabaseForConnection(selectedProfile.name);
      }
    }

    setActiveDatabase(selectedDatabase || null);

    if (node.nodeData?.connectionId && node.childNodes && node.childNodes.length > 0 && !node.isExpanded) {
      const nodeId = node.id as string;
      setNodes(prev => prev.map(n =>
        n.id === nodeId ? { ...n, isExpanded: true } : n
      ));
    }
    if (node.nodeData?.database && node.nodeData.isDbOpened && node.childNodes && node.childNodes.length > 0 && !node.isExpanded) {
      const nodeId = node.id as string;
      setNodes(prev => {
        const updateNode = (nodes: TreeNode[]): TreeNode[] => {
          return nodes.map(n => {
            if (n.id === nodeId) {
              return { ...n, isExpanded: true };
            }
            if (n.childNodes) {
              return { ...n, childNodes: updateNode(n.childNodes as TreeNode[]) };
            }
            return n;
          });
        };
        return updateNode(prev);
      });
    }
  }, [
    handleNodeDoubleClick,
    nodes,
    setActiveConnection,
    setActiveDatabase,
    setLastUsedDatabaseForConnection,
    clearLastUsedDatabaseForConnection,
  ]);

  const handleNodeExpand = useCallback((node: TreeNode) => {
    const nodeId = node.id as string;
    setNodes(prev => {
      const updateNode = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map(n => {
          if (n.id === nodeId) {
            return { ...n, isExpanded: true };
          }
          if (n.childNodes) {
            return { ...n, childNodes: updateNode(n.childNodes as TreeNode[]) };
          }
          return n;
        });
      };
      return updateNode(prev);
    });
    if (node.nodeData?.folderType && (!node.childNodes || node.childNodes.length === 0)) {
      loadFolder(node);
    }
  }, [loadFolder]);

  const handleNodeCollapse = useCallback((node: TreeNode) => {
    const nodeId = node.id as string;
    setNodes(prev => {
      const updateNode = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map(n => {
          if (n.id === nodeId) {
            return { ...n, isExpanded: false };
          }
          if (n.childNodes) {
            return { ...n, childNodes: updateNode(n.childNodes as TreeNode[]) };
          }
          return n;
        });
      };
      return updateNode(prev);
    });
  }, []);

  const handleCreateDatabase = useCallback(async (name: string, charset: string, collation: string) => {
    if (!createDbDialog.connection) return;

    try {
      setStatusMessage(t('metadataTree.creatingDatabase'));
      const sql = `CREATE DATABASE \`${name}\` CHARACTER SET ${charset} COLLATE ${collation}`;
      await tauriApi.metadata.executeSql(createDbDialog.connection, sql);
      setStatusMessage(t('metadataTree.databaseCreated', { name }));

      if (createDbDialog.nodeId) {
        const connNode = nodes.find(n => n.id === createDbDialog.nodeId);
        if (connNode) {
          await closeConnection(connNode);
          await connectConnection(connNode);
        }
      }
    } catch (error) {
      console.error(t('metadataTree.createDatabaseFailed'), error);
      setStatusMessage(t('metadataTree.createFailed', { error: String(error) }));
    }
  }, [createDbDialog, nodes, closeConnection, connectConnection, setStatusMessage, t]);

  const handleDeleteDatabase = useCallback(async (node: TreeNode) => {
    if (!node.nodeData?.connection || !node.nodeData?.database) return;
    const dbName = node.nodeData.database;
    const isSystemDb = node.nodeData.isSystemDb;

    if (isSystemDb) {
      setAlertDialog({ isOpen: true, message: t('metadataTree.systemDbProtected') });
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: t('metadataTree.confirmDeleteDatabase'),
      message: t('metadataTree.deleteDatabaseWarning', { name: dbName }),
      intent: 'danger',
      onConfirm: async () => {
        try {
          setStatusMessage(t('metadataTree.deletingDatabase'));
          const sql = `DROP DATABASE \`${dbName}\``;
          await tauriApi.metadata.executeSql(node.nodeData!.connection!, sql);
          setStatusMessage(t('metadataTree.databaseDeleted', { name: dbName }));

          const nodeId = node.id as string;
          setNodes(prev => {
            const removeDbNode = (nodes: TreeNode[]): TreeNode[] => {
              return nodes.map(n => {
                if (n.childNodes) {
                  return { ...n, childNodes: (n.childNodes as TreeNode[]).filter(child => child.id !== nodeId) };
                }
                return n;
              });
            };
            return removeDbNode(prev);
          });
        } catch (error) {
          console.error(t('metadataTree.deleteDatabaseFailed'), error);
          setStatusMessage(t('metadataTree.deleteFailed', { error: String(error) }));
        }
      },
    });
  }, [setStatusMessage, t]);

  const handleDeleteConnection = useCallback((node: TreeNode) => {
    const connName = node.nodeData?.connection?.name;
    if (!connName) return;

    setConfirmDialog({
      isOpen: true,
      title: t('metadataTree.confirmDeleteConnection'),
      message: t('metadataTree.deleteConnectionWarning', { name: connName }),
      intent: 'danger',
      onConfirm: () => {
        removeConnection(connName);
        setStatusMessage(t('metadataTree.connectionDeleted', { name: connName }));
      },
    });
  }, [removeConnection, setStatusMessage, t]);

  const refreshMetadataTree = useCallback(async () => {
    const currentNodes = nodesRef.current;
    const connectedNodes = currentNodes.filter((node) => {
      return Boolean(
        node.nodeData?.connection && node.childNodes && (node.childNodes as TreeNode[]).length > 0
      );
    });

    if (connectedNodes.length === 0) {
      setStatusMessage(t('metadataTree.noMetadataToRefresh'));
      return;
    }

    setStatusMessage(t('metadataTree.refreshingMetadata'));

    for (const connectionNode of connectedNodes) {
      const openedDatabases = ((connectionNode.childNodes as TreeNode[]) || [])
        .filter((dbNode) => dbNode.nodeData?.database && dbNode.nodeData?.isDbOpened)
        .map((dbNode) => dbNode.nodeData?.database)
        .filter((dbName): dbName is string => Boolean(dbName));

      await connectConnection(connectionNode);

      const latestConnectionNode = nodesRef.current.find((node) => node.id === connectionNode.id);
      if (!latestConnectionNode?.childNodes || openedDatabases.length === 0) {
        continue;
      }

      for (const dbName of openedDatabases) {
        const dbNode = (latestConnectionNode.childNodes as TreeNode[]).find(
          (child) => child.nodeData?.database === dbName,
        );

        if (dbNode) {
          await connectDatabase(dbNode);
        }
      }
    }

    setStatusMessage(t('metadataTree.metadataRefreshed'));
  }, [connectConnection, connectDatabase, setStatusMessage, t]);

  useEffect(() => {
    const handleGlobalRefresh = () => {
      void refreshMetadataTree();
    };

    window.addEventListener(GLOBAL_REFRESH_EVENT, handleGlobalRefresh);
    return () => {
      window.removeEventListener(GLOBAL_REFRESH_EVENT, handleGlobalRefresh);
    };
  }, [refreshMetadataTree]);

  const handleEditConnection = useCallback((node: TreeNode) => {
    if (!node.nodeData?.connection) return;
    
    // 检查连接是否处于打开状态
    const isConnected = isConnectionConnected(node);
    if (isConnected) {
      // 如果连接已打开，显示提示并阻止编辑
      void showEditConnectionNotice(node.nodeData.connection.name || '未命名');
      return;
    }
    
    setEditConnectionDialog({
      isOpen: true,
      profile: node.nodeData.connection,
      nodeId: node.id as string,
    });
  }, [isConnectionConnected]);

  const showConnectionMenu = useCallback((node: TreeNode, e: React.MouseEvent<HTMLElement>) => {
    const isConnected = isConnectionConnected(node);

    const menu = (
      <Menu className="tree-context-menu">
        <MenuItem
          text={t('metadataTree.openConnection')}
          disabled={isConnected}
          onClick={() => connectConnection(node)}
        />
        <MenuItem
          text={t('metadataTree.closeConnection')}
          disabled={!isConnected}
          onClick={() => closeConnection(node)}
        />
        <Divider />
        <MenuItem
          text={t('metadataTree.newDatabase')}
          disabled={!isConnected}
          onClick={() => {
            setCreateDbDialog({
              isOpen: true,
              connection: node.nodeData?.connection,
              nodeId: node.id as string,
            });
          }}
        />
        <Divider />
        <MenuItem
          text={t('metadataTree.editConnection')}
          onClick={() => handleEditConnection(node)}
        />
        <MenuItem
          text={t('metadataTree.deleteConnection')}
          onClick={() => handleDeleteConnection(node)}
        />
      </Menu>
    );

    showContextMenu({
      content: menu,
      targetOffset: { left: e.clientX, top: e.clientY },
    });
  }, [isConnectionConnected, connectConnection, closeConnection, handleEditConnection, handleDeleteConnection, t]);

  const showDatabaseMenu = useCallback((node: TreeNode, e: React.MouseEvent<HTMLElement>) => {
    const isOpened = isDatabaseOpened(node);
    const isSystemDb = node.nodeData?.isSystemDb || false;

    const menuItems: React.ReactNode[] = [];

    if (isSystemDb) {
      menuItems.push(
        <MenuItem
          key="warning"
          text={t('metadataTree.systemDbWarning')}
          disabled
        />
      );
    }

    menuItems.push(
      <MenuItem
        key="open"
        text={t('metadataTree.openDatabase')}
        disabled={isOpened}
        onClick={() => {
          if (isSystemDb) {
            setSystemDbConfirmDialog({ isOpen: true, node });
          } else {
            connectDatabase(node);
          }
        }}
      />,
      <MenuItem
        key="close"
        text={t('metadataTree.closeDatabase')}
        disabled={!isOpened}
        onClick={() => closeDatabase(node)}
      />,
      <Divider key="div1" />,
      <MenuItem
        key="create"
        text={t('metadataTree.newDatabase')}
        onClick={() => {
          const parentConnId = (node.id as string).split('-').slice(0, -1).join('-');
          const parentConn = nodes.find(n => n.id === parentConnId);
          setCreateDbDialog({
            isOpen: true,
            connection: parentConn?.nodeData?.connection || node.nodeData?.connection,
            nodeId: parentConnId,
          });
        }}
      />,
      <MenuItem
        key="delete"
        text={isSystemDb ? t('metadataTree.deleteSystemDb') : t('metadataTree.deleteDatabase')}
        disabled={isSystemDb}
        onClick={() => handleDeleteDatabase(node)}
      />
    );

    const menu = (
      <Menu className="tree-context-menu">
        {menuItems}
      </Menu>
    );

    showContextMenu({
      content: menu,
      targetOffset: { left: e.clientX, top: e.clientY },
    });
  }, [isDatabaseOpened, connectDatabase, closeDatabase, nodes, handleDeleteDatabase, t]);

  const handleNodeContextMenu = useCallback((node: TreeNode, _nodePath: number[], e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    
    if (node.nodeData?.connectionId && !node.nodeData?.database) {
      showConnectionMenu(node, e);
    } else if (node.nodeData?.database && !node.nodeData?.folderType && !node.nodeData?.itemType) {
      showDatabaseMenu(node, e);
    }
  }, [showConnectionMenu, showDatabaseMenu]);

  const filterNodes = (nodes: TreeNode[], query: string): TreeNode[] => {
    if (!query) return nodes;
    return nodes.reduce<TreeNode[]>((filtered, node) => {
      const label = (node.label as string) || '';
      const matches = label.toLowerCase().includes(query.toLowerCase());
      let filteredChildren: TreeNode[] = [];
      if (node.childNodes) {
        filteredChildren = filterNodes(node.childNodes as TreeNode[], query);
      }
      if (matches || filteredChildren.length > 0) {
        filtered.push({
          ...node,
          childNodes: filteredChildren.length > 0 ? filteredChildren : node.childNodes,
          isExpanded: true,
        });
      }
      return filtered;
    }, []);
  };

  const filteredNodes = filterNodes(nodes, searchQuery);

  if (connections.length === 0) {
    return (
      <div className="metadata-tree-empty">
        <p>{t('metadataTree.noConnections')}</p>
        <p className="hint">{t('metadataTree.addConnectionHint')}</p>
      </div>
    );
  }

  return (
    <div className={`metadata-tree bp5-${theme}`}>
      <Tree
        contents={filteredNodes}
        onNodeExpand={handleNodeExpand}
        onNodeCollapse={handleNodeCollapse}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        className="metadata-tree-inner"
      />
      
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        intent={confirmDialog.intent}
      />
      
      <CreateDatabaseDialog
        isOpen={createDbDialog.isOpen}
        onClose={() => setCreateDbDialog({ isOpen: false })}
        onCreate={handleCreateDatabase}
      />
      
      <ConnectionDialog
        isOpen={editConnectionDialog.isOpen}
        onClose={() => setEditConnectionDialog({ isOpen: false })}
        editProfile={editConnectionDialog.profile}
      />
      
      <Alert
        isOpen={alertDialog.isOpen}
        onClose={() => setAlertDialog({ isOpen: false, message: '' })}
        confirmButtonText={t('common.ok')}
        icon="warning-sign"
      >
        {alertDialog.message}
      </Alert>

      <ConfirmDialog
        isOpen={systemDbConfirmDialog.isOpen}
        onClose={() => setSystemDbConfirmDialog({ isOpen: false })}
        onConfirm={() => {
          if (systemDbConfirmDialog.node) {
            connectDatabase(systemDbConfirmDialog.node);
          }
          setSystemDbConfirmDialog({ isOpen: false });
        }}
        title={t('metadataTree.openSystemDbTitle')}
        message={t('metadataTree.openSystemDbWarning')}
        intent="warning"
      />
    </div>
  );
};
