import React from 'react';
import { Button, Tooltip } from '@blueprintjs/core';
import { Moon, Sun, PanelLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores';

export const StatusBar: React.FC = () => {
  const { theme, toggleTheme, statusMessage, sidebarCollapsed, toggleSidebar } = useAppStore();
  const { t } = useTranslation();

  return (
    <div className={`statusbar bp5-${theme}`}>
      <div className="statusbar-left">
        <span className="statusbar-item">
          <span className="status-indicator ready" />
          {statusMessage}
        </span>
        <span className="statusbar-separator" />
        <span className="statusbar-item">
          {t('statusBar.ready')}
        </span>
      </div>

      <div className="statusbar-right">
        <Tooltip content={sidebarCollapsed ? t('statusBar.showSidebar') : t('statusBar.hideSidebar')}>
          <Button
            minimal
            small
            className="statusbar-button"
            onClick={toggleSidebar}
          >
            <PanelLeft size={14} />
          </Button>
        </Tooltip>

        <Tooltip content={theme === 'dark' ? t('statusBar.switchToLight') : t('statusBar.switchToDark')}>
          <Button
            minimal
            small
            className="statusbar-button"
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};
