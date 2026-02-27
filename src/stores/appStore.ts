import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Theme } from '../types';

interface AppStore {
  theme: Theme;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  statusBarVisible: boolean;
  isLoading: boolean;
  statusMessage: string;
  updateAvailable: boolean;
  updateVersion: string | null;
  updateDismissed: boolean;

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
  toggleStatusBar: () => void;
  setStatusBarVisible: (visible: boolean) => void;
  setLoading: (loading: boolean) => void;
  setStatusMessage: (message: string) => void;
  setUpdateAvailable: (available: boolean, version?: string) => void;
  dismissUpdate: () => void;
  resetUpdateState: () => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      theme: 'light',
      sidebarCollapsed: false,
      sidebarWidth: 280,
      statusBarVisible: true,
      isLoading: false,
      statusMessage: 'Ready',
      updateAvailable: false,
      updateVersion: null,
      updateDismissed: false,

      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({
        theme: state.theme === 'light' ? 'dark' : 'light'
      })),
      toggleSidebar: () => set((state) => ({
        sidebarCollapsed: !state.sidebarCollapsed
      })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setSidebarWidth: (width) => set({ sidebarWidth: width }),
      toggleStatusBar: () => set((state) => ({
        statusBarVisible: !state.statusBarVisible
      })),
      setStatusBarVisible: (visible) => set({ statusBarVisible: visible }),
      setLoading: (loading) => set({ isLoading: loading }),
      setStatusMessage: (message) => set({ statusMessage: message }),
      setUpdateAvailable: (available, version) => set({
        updateAvailable: available,
        updateVersion: version || null,
        updateDismissed: false
      }),
      dismissUpdate: () => set({ updateDismissed: true }),
      resetUpdateState: () => set({
        updateAvailable: false,
        updateVersion: null,
        updateDismissed: false
      }),
    }),
    {
      name: 'app-storage',
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarWidth: state.sidebarWidth,
        statusBarVisible: state.statusBarVisible
      }),
    }
  )
);
