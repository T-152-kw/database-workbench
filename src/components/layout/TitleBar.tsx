import React, { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';
import appIcon from '../../assets/Database Workbench.png';
import '../../styles/titlebar.css';

export const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    const checkMaximized = async () => {
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    };
    checkMaximized();

    const handleResize = async () => {
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [appWindow]);

  const handleMinimize = async () => {
    await appWindow.minimize();
  };

  const handleMaximize = async () => {
    if (isMaximized) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
  };

  const handleClose = async () => {
    await appWindow.close();
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-content">
        <div className="titlebar-icon">
          <img src={appIcon} alt="Database Workbench" className="titlebar-icon-img" />
        </div>
        <span className="titlebar-title" data-tauri-drag-region>Database Workbench</span>
      </div>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn titlebar-minimize"
          onClick={handleMinimize}
          title="最小化"
        >
          <Minus size={14} />
        </button>
        <button
          className="titlebar-btn titlebar-maximize"
          onClick={handleMaximize}
          title={isMaximized ? "还原" : "最大化"}
        >
          <Square size={12} />
        </button>
        <button
          className="titlebar-btn titlebar-close"
          onClick={handleClose}
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
