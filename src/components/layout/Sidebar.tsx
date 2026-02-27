import React from 'react';
import { Button, Tooltip } from '@blueprintjs/core';
import { Search, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MetadataTree } from '../tree/MetadataTree';
import { useAppStore } from '../../stores';

interface SidebarProps {
  collapsed: boolean;
  width: number;
  onToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  width,
  onToggle,
}) => {
  const { theme } = useAppStore();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = React.useState('');

  return (
    <>
      <div
        className={`sidebar-collapsed bp5-${theme}`}
        style={{ display: collapsed ? 'flex' : 'none' }}
      >
        <Tooltip content={t('sidebar.expandSidebar')} position="right">
          <Button
            minimal
            small
            className="sidebar-toggle-btn"
            onClick={onToggle}
          >
            <PanelLeftOpen size={18} />
          </Button>
        </Tooltip>
      </div>

      <div
        className={`sidebar bp5-${theme}`}
        style={{ width, display: collapsed ? 'none' : 'flex' }}
      >
        {/* 搜索框 */}
        <div className="sidebar-header">
          <div className="search-box">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder={t('sidebar.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <Tooltip content={t('sidebar.collapseSidebar')}>
            <Button
              minimal
              small
              className="sidebar-toggle-btn"
              onClick={onToggle}
            >
              <PanelLeftClose size={16} />
            </Button>
          </Tooltip>
        </div>

        {/* 元数据树 */}
        <div className="sidebar-content">
          <MetadataTree searchQuery={searchQuery} />
        </div>
      </div>
    </>
  );
};
