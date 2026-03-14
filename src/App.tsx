import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { MainLayout } from './components';
import { useKeyboardShortcuts } from './hooks';
import { useTabStore, useAppStore } from './stores';
import { UpdateDialog } from './components/dialogs/UpdateDialog';
import { UpdaterService } from './services/updaterService';
import './i18n';
import './styles/global.css';

const defaultSettings = {
  showWelcomePage: true,
  sidebarDefaultCollapsed: false,
  statusBarVisible: true,
  autoCheckUpdate: true,
};

function App() {
  useKeyboardShortcuts();
  const { addTab, tabs } = useTabStore();
  const { setSidebarCollapsed, setStatusBarVisible, setUpdateAvailable } = useAppStore();
  const theme = useAppStore(state => state.theme);
  const { t } = useTranslation();
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [isManualCheck, setIsManualCheck] = useState(false);
  const hasAutoCreatedWelcomeRef = useRef(false);

  // Sync theme to HTML element to ensure consistent scrollbar and dialog styles
  useEffect(() => {
    document.documentElement.classList.remove('bp5-light', 'bp5-dark', 'bp6-light', 'bp6-dark');
    document.documentElement.classList.add(`bp5-${theme}`);
    document.documentElement.classList.add(`bp6-${theme}`);
  }, [theme]);

  // Remove the programmatic show window logic
  // to avoid blocking the software from rendering.
  useEffect(() => {
    getCurrentWindow().show().catch(console.error);
  }, []);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-native-contextmenu="true"]')) {
        return;
      }
      event.preventDefault();
    };

    window.addEventListener('contextmenu', handleContextMenu);
    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  useEffect(() => {
    const settings = localStorage.getItem('dbw-settings');
    const parsed = settings ? JSON.parse(settings) : defaultSettings;

    try {
      if (parsed.sidebarDefaultCollapsed !== undefined) {
        setSidebarCollapsed(parsed.sidebarDefaultCollapsed);
      }
      if (parsed.statusBarVisible !== undefined) {
        setStatusBarVisible(parsed.statusBarVisible);
      }
      if (parsed.showWelcomePage && tabs.length === 0 && !hasAutoCreatedWelcomeRef.current) {
        hasAutoCreatedWelcomeRef.current = true;
        addTab({
          type: 'welcome',
          title: t('tabTitles.welcome'),
        });
      }
    } catch {
    }
  }, [t, setSidebarCollapsed, setStatusBarVisible, addTab, tabs.length]);

  useEffect(() => {
    const settings = localStorage.getItem('dbw-settings');
    const parsed = settings ? JSON.parse(settings) : defaultSettings;

    if (parsed.autoCheckUpdate) {
      const checkUpdate = async () => {
        try {
          const info = await UpdaterService.checkForUpdate();
          if (info?.available) {
            setUpdateAvailable(true, info.version);
          }
        } catch (error) {
          console.error('Auto update check failed:', error);
        }
      };

      const timer = setTimeout(checkUpdate, 2000);
      return () => clearTimeout(timer);
    }
  }, [setUpdateAvailable]);

  useEffect(() => {
    const handleCheckUpdate = () => {
      setIsManualCheck(true);
      setShowUpdateDialog(true);
    };

    window.addEventListener('dbw:check-update', handleCheckUpdate);
    return () => {
      window.removeEventListener('dbw:check-update', handleCheckUpdate);
    };
  }, []);

  const handleCloseUpdateDialog = () => {
    setShowUpdateDialog(false);
    setIsManualCheck(false);
  };

  return (
    <>
      <MainLayout />
      <UpdateDialog
        isOpen={showUpdateDialog}
        onClose={handleCloseUpdateDialog}
        isManualCheck={isManualCheck}
      />
    </>
  );
}

export default App;
