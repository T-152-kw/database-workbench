import React, { useCallback } from 'react';
import { FocusStyleManager } from '@blueprintjs/core';
import { MenuBar } from './MenuBar';
import { ToolBar } from './ToolBar';
import { StatusBar } from './StatusBar';
import { Sidebar } from './Sidebar';
import { TabContainer } from './TabContainer';
import { Resizer } from './Resizer';
import { TitleBar } from './TitleBar';
import { useAppStore } from '../../stores';
import '../../styles/main-layout.css';

// 禁用Blueprint的焦点轮廓样式（更适合桌面应用）
FocusStyleManager.onlyShowFocusOnTabs();

// 侧边栏宽度限制
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 500;

export const MainLayout: React.FC = () => {
  const { theme, sidebarCollapsed, sidebarWidth, statusBarVisible, toggleSidebar, setSidebarWidth } = useAppStore();

  const handleResize = useCallback((delta: number) => {
    setSidebarWidth(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, sidebarWidth + delta)));
  }, [sidebarWidth, setSidebarWidth]);

  return (
    <div className={`main-layout bp5-${theme}`} data-theme={theme}>
      {/* 自定义标题栏 - 32px */}
      <TitleBar />

      {/* 顶部菜单栏 - 30px */}
      <div className="layout-menubar">
        <MenuBar />
      </div>

      {/* 工具栏 - 48px (比菜单栏大) */}
      <div className="layout-toolbar">
        <ToolBar />
      </div>

      {/* 主内容区 */}
      <div className="layout-body">
        {/* 左侧可折叠边栏 */}
        <Sidebar
          collapsed={sidebarCollapsed}
          width={sidebarWidth}
          onToggle={toggleSidebar}
        />

        {/* 可拖动分隔条 */}
        {!sidebarCollapsed && (
          <Resizer onResize={handleResize} />
        )}

        {/* 右侧标签页区域 */}
        <div className="layout-content">
          <TabContainer />
        </div>
      </div>

      {/* 底部状态栏 - 24px */}
      {statusBarVisible && (
        <div className="layout-statusbar">
          <StatusBar />
        </div>
      )}
    </div>
  );
};
