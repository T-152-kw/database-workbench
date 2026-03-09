import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UpdateInfo {
  available: boolean;
  version?: string;
  date?: string;
  body?: string;
  preferredSource?: 'github' | 'gitee';
  countryCode?: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

interface BackendUpdateInfo {
  available: boolean;
  version?: string;
  date?: string;
  body?: string;
  preferred_source: 'github' | 'gitee';
  country_code?: string;
}

interface BackendDownloadProgressEvent {
  event: 'Started' | 'Progress' | 'Finished';
  content_length?: number;
  chunk_length?: number;
  downloaded: number;
  total?: number;
  percentage?: number;
}

class UpdaterServiceClass {
  async checkForUpdate(): Promise<UpdateInfo | null> {
    try {
      const update = await invoke<BackendUpdateInfo>('updater_check_by_region');
      if (update.available) {
        return {
          available: true,
          version: update.version,
          date: update.date,
          body: update.body,
          preferredSource: update.preferred_source,
          countryCode: update.country_code,
        };
      }

      return {
        available: false,
        preferredSource: update.preferred_source,
        countryCode: update.country_code,
      };
    } catch (error) {
      console.error('Failed to check for updates:', error);
      return null;
    }
  }

  async downloadAndInstall(
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<{ success: boolean; error?: string }> {
    let unlisten: (() => void) | null = null;

    try {
      unlisten = await listen<BackendDownloadProgressEvent>(
        'updater-download-progress',
        (event) => {
          if (!onProgress) return;

          const payload = event.payload;
          const total = payload.total || payload.content_length || 0;
          const downloaded = payload.downloaded || 0;

          if (total > 0) {
            onProgress({
              downloaded,
              total,
              percentage:
                payload.percentage ?? Math.min(100, Math.round((downloaded / total) * 100)),
            });
          }
        }
      );

      await invoke('updater_download_and_install_by_region');

      if (unlisten) {
        unlisten();
        unlisten = null;
      }

      if (onProgress) {
        onProgress({
          downloaded: 1,
          total: 1,
          percentage: 100,
        });
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to download and install update:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      if (unlisten) {
        unlisten();
      }
    }
  }

  async relaunchApp(): Promise<void> {
    await relaunch();
  }
}

export const UpdaterService = new UpdaterServiceClass();
