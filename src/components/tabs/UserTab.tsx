import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button,
  Spinner,
  Alert,
} from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import type { ConnectionProfile, UserSummary } from '../../types';
import { metadataApi } from '../../hooks/useTauri';
import '../../styles/user-tab.css';

interface ColumnDef {
  key: string;
  title: string;
  width: number;
  minWidth: number;
  render: (user: UserSummary) => React.ReactNode;
}

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

interface UserTabProps {
  tabId: string;
  connectionProfile: ConnectionProfile;
  onOpenUserEditor?: (username: string, host: string) => void;
}

const RefreshIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M14 8A6 6 0 1 1 8 2v2a4 4 0 1 0 4 4h-2l3-3 3 3h-2z" />
  </svg>
);

const AddIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const EditIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 12l1 1 9-9-1-1-9 9zM12 2l2 2-1 1-2-2 1-1z" />
  </svg>
);

const DeleteIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 4v10h8V4H4zm2 0V2h4v2h2v1H4V4h2zm1 2v6h1V6H7zm2 0v6h1V6H9z" />
  </svg>
);

const SearchIcon: React.FC<{ size?: number; className?: string }> = ({ size = 16, className }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className}>
    <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M9 9l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const UserIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="#9C27B0">
    <circle cx="8" cy="5" r="3" />
    <path d="M2 14c0-3 3-5 6-5s6 2 6 5" fill="none" stroke="#9C27B0" strokeWidth="2" />
  </svg>
);

export const UserTab: React.FC<UserTabProps> = ({
  tabId: _tabId,
  connectionProfile,
  onOpenUserEditor,
}) => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserSummary | null>(null);

  const getInitialColumns = (): ColumnDef[] => [
    {
      key: 'username',
      title: t('userTab.username'),
      width: 200,
      minWidth: 120,
      render: (user) => (
        <div className="user-name">
          <UserIcon size={16} />
          <span>{user.username}</span>
        </div>
      ),
    },
    {
      key: 'host',
      title: t('userTab.host'),
      width: 150,
      minWidth: 100,
      render: (user) => user.host,
    },
    {
      key: 'plugin',
      title: t('userTab.plugin'),
      width: 180,
      minWidth: 120,
      render: (user) => user.plugin || '-',
    },
    {
      key: 'status',
      title: t('userTab.status'),
      width: 120,
      minWidth: 100,
      render: (user) => user.status,
    },
  ];

  const [columns, setColumns] = useState<ColumnDef[]>(getInitialColumns());

  // Reset columns when language changes
  useEffect(() => {
    setColumns(getInitialColumns());
  }, [t]);

  const handleColumnResize = useCallback((key: string, newWidth: number) => {
    setColumns((prev) =>
      prev.map((col) => (col.key === key ? { ...col, width: newWidth } : col))
    );
  }, []);

  const fetchUsers = useCallback(async () => {
    if (!connectionProfile) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await metadataApi.getAllUsers(connectionProfile);
      setUsers(data);

      // 刷新后检查当前选中的用户是否还存在，如果不存在则清除选中状态
      setSelectedUser((prevSelected) => {
        if (prevSelected) {
          const stillExists = data.some(
            (user) => user.username === prevSelected.username && user.host === prevSelected.host
          );
          return stillExists ? prevSelected : null;
        }
        return null;
      });
    } catch (err) {
      setError(t('userTab.loadFailed', { error: err }));
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  }, [connectionProfile, t]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRefresh = useCallback(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleNew = useCallback(() => {
    onOpenUserEditor?.('', '');
  }, [onOpenUserEditor]);

  const handleEdit = useCallback((user: UserSummary) => {
    onOpenUserEditor?.(user.username, user.host);
  }, [onOpenUserEditor]);

  const handleDelete = useCallback((user: UserSummary) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!userToDelete) return;

    try {
      const sql = `DROP USER '${userToDelete.username.replace(/'/g, "''")}'@'${userToDelete.host.replace(/'/g, "''")}'`;
      await metadataApi.executeSql(connectionProfile, sql);
      setDeleteDialogOpen(false);

      // 如果被删除的用户是当前选中的用户，清除选中状态
      if (selectedUser?.username === userToDelete.username && selectedUser?.host === userToDelete.host) {
        setSelectedUser(null);
      }

      setUserToDelete(null);
      fetchUsers();
    } catch (err) {
      setError(t('userTab.deleteFailed', { error: err }));
    }
  }, [userToDelete, connectionProfile, fetchUsers, selectedUser, t]);

  const handleDoubleClick = useCallback((user: UserSummary) => {
    onOpenUserEditor?.(user.username, user.host);
  }, [onOpenUserEditor]);

  const filteredUsers = users.filter((user) => {
    if (!searchText) return true;
    return (
      user.username.toLowerCase().includes(searchText.toLowerCase()) ||
      user.host.toLowerCase().includes(searchText.toLowerCase())
    );
  });

  return (
    <div className="user-tab">
      <div className="user-toolbar">
        <div className="user-toolbar-row">
          <div className="user-search-box">
            <SearchIcon size={14} className="user-search-icon" />
            <input
              type="text"
              className="user-search-input"
              placeholder={t('userTab.searchPlaceholder')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            {searchText && (
              <button
                className="user-search-clear"
                onClick={() => setSearchText('')}
              >
                <DeleteIcon size={12} />
              </button>
            )}
          </div>

          <div className="user-info-inline">
            <span className="user-count">
              {t('userTab.totalCount', { count: filteredUsers.length })}
            </span>
          </div>

          <div className="user-toolbar-spacer" />

          <div className="user-toolbar-group">
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

            <Button
              minimal
              small
              icon={<AddIcon size={14} />}
              onClick={handleNew}
              title={t('userTab.newUser')}
            >
              {t('common.create')}
            </Button>

            {selectedUser && (
              <>
                <Button
                  minimal
                  small
                  icon={<EditIcon size={14} />}
                  onClick={() => handleEdit(selectedUser)}
                  title={t('common.edit')}
                >
                  {t('common.edit')}
                </Button>
                <Button
                  minimal
                  small
                  icon={<DeleteIcon size={14} />}
                  intent="danger"
                  onClick={() => handleDelete(selectedUser)}
                  title={t('common.delete')}
                >
                  {t('common.delete')}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="user-content">
        {isLoading && (
          <div className="user-loading">
            <Spinner size={32} />
            <span>{t('userTab.loading')}</span>
          </div>
        )}

        {error && (
          <div className="user-error">
            <span>{error}</span>
            <Button minimal small onClick={handleRefresh}>
              {t('common.retry')}
            </Button>
          </div>
        )}

        {!isLoading && !error && filteredUsers.length === 0 && (
          <div className="user-empty">
            <span>{t('userTab.empty')}</span>
          </div>
        )}

        {!isLoading && !error && filteredUsers.length > 0 && (
          <div className="user-table-wrapper">
            <table className="user-table resizable-table">
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
                {filteredUsers.map((user) => (
                  <tr
                    key={`${user.username}@${user.host}`}
                    className={`user-row ${selectedUser?.username === user.username && selectedUser?.host === user.host ? 'selected' : ''}`}
                    onClick={() => setSelectedUser(user)}
                    onDoubleClick={() => handleDoubleClick(user)}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        style={{ width: col.width, minWidth: col.minWidth }}
                      >
                        {col.render(user)}
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
          setUserToDelete(null);
        }}
        onConfirm={confirmDelete}
      >
        <p>
          {t('userTab.deleteConfirm', { username: userToDelete?.username, host: userToDelete?.host })}
        </p>
        <p>{t('userTab.deleteWarning')}</p>
      </Alert>
    </div>
  );
};

export default UserTab;
