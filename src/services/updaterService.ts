import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UpdateInfo {
  available: boolean;
  version?: string;
  date?: string;
  body?: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

export type DownloadEventHandler = (event: DownloadEvent) => void;

export interface DownloadEvent {
  event: 'Started' | 'Progress' | 'Finished';
  data: {
    contentLength?: number;
    chunkLength?: number;
  };
}

class UpdaterServiceClass {
  async checkForUpdate(): Promise<UpdateInfo | null> {
    try {
      const update = await check();
      if (update) {
        return {
          available: true,
          version: update.version,
          date: update.date,
          body: update.body,
        };
      }
      return { available: false };
    } catch (error) {
      console.error('Failed to check for updates:', error);
      return null;
    }
  }

  async downloadAndInstall(
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const update = await check();
      if (!update) {
        return { success: false, error: 'No update available' };
      }

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (onProgress && contentLength > 0) {
              onProgress({
                downloaded,
                total: contentLength,
                percentage: Math.round((downloaded / contentLength) * 100),
              });
            }
            break;
          case 'Finished':
            break;
        }
      });

      return { success: true };
    } catch (error) {
      console.error('Failed to download and install update:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async relaunchApp(): Promise<void> {
    await relaunch();
  }
}

export const UpdaterService = new UpdaterServiceClass();
