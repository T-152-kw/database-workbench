import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import type { ConnectionProfile, ConnectionState, PoolStats } from '../types';

interface ConnectionStore {
  connections: ConnectionState[];
  activeConnectionId: string | null;
  activeDatabase: string | null;
  lastUsedDatabaseByConnection: Record<string, string>;
  poolStats: Map<number, PoolStats>;

  // Actions
  addConnection: (profile: ConnectionProfile) => void;
  removeConnection: (id: string) => void;
  updateConnection: (id: string, profile: ConnectionProfile) => void;
  setActiveConnection: (id: string | null) => void;
  setActiveDatabase: (database: string | null) => void;
  setLastUsedDatabaseForConnection: (connectionId: string, database: string) => void;
  getLastUsedDatabaseForConnection: (connectionId: string | null | undefined) => string | undefined;
  clearLastUsedDatabaseForConnection: (connectionId: string) => void;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  disconnectAll: () => Promise<void>;
  getConnectionState: (id: string) => ConnectionState | undefined;
  getActiveConnection: () => ConnectionState | undefined;
  getActiveConnectionCount: () => number;
  checkMaxConnections: () => { allowed: boolean; current: number; max: number };
}

const generateId = () => `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
const connectInFlight = new Map<string, Promise<void>>();

export const useConnectionStore = create<ConnectionStore>()(
  persist(
    (set, get) => ({
      connections: [],
      activeConnectionId: null,
      activeDatabase: null,
      lastUsedDatabaseByConnection: {},
      poolStats: new Map(),
      
      addConnection: (profile) => {
        const id = generateId();
        set((state) => ({
          connections: [
            ...state.connections,
            {
              profile,
              isConnected: false,
              isConnecting: false,
            },
          ],
        }));
        return id;
      },
      
      removeConnection: async (id) => {
        const state = get();
        const conn = state.connections.find((c) => c.profile.name === id);
        if (conn?.poolId) {
          await invoke('pool_close', { poolId: conn.poolId });
        }
        const nextLastUsed = { ...state.lastUsedDatabaseByConnection };
        delete nextLastUsed[id];
        set((state) => ({
          connections: state.connections.filter((c) => c.profile.name !== id),
          activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
          activeDatabase: state.activeConnectionId === id ? null : state.activeDatabase,
          lastUsedDatabaseByConnection: nextLastUsed,
        }));
      },
      
      updateConnection: (id, profile) => {
        set((state) => ({
          connections: state.connections.map((c) =>
            c.profile.name === id ? { ...c, profile } : c
          ),
        }));
      },
      
      setActiveConnection: (id) => {
        set({ activeConnectionId: id });
      },

      setActiveDatabase: (database) => {
        set({ activeDatabase: database });
      },

      setLastUsedDatabaseForConnection: (connectionId, database) => {
        if (!connectionId || !database) return;
        set((state) => ({
          lastUsedDatabaseByConnection: {
            ...state.lastUsedDatabaseByConnection,
            [connectionId]: database,
          },
        }));
      },

      getLastUsedDatabaseForConnection: (connectionId) => {
        if (!connectionId) return undefined;
        return get().lastUsedDatabaseByConnection[connectionId];
      },

      clearLastUsedDatabaseForConnection: (connectionId) => {
        if (!connectionId) return;
        set((state) => {
          const next = { ...state.lastUsedDatabaseByConnection };
          delete next[connectionId];
          return { lastUsedDatabaseByConnection: next };
        });
      },
      
      connect: async (id) => {
        const existing = connectInFlight.get(id);
        if (existing) {
          await existing;
          return;
        }

        const task = (async () => {
          const state = get();
          const conn = state.connections.find((c) => c.profile.name === id);
          if (!conn) return;
          if (conn.isConnected && conn.poolId) return;
          if (conn.isConnecting) return;

          set((state) => ({
            connections: state.connections.map((c) =>
              c.profile.name === id ? { ...c, isConnecting: true, error: undefined } : c
            ),
          }));

          try {
            const latestConn = get().connections.find((c) => c.profile.name === id);
            if (!latestConn) return;

            const poolId = await invoke<number>('pool_create', { profile: latestConn.profile });
            set((state) => ({
              connections: state.connections.map((c) =>
                c.profile.name === id
                  ? { ...c, isConnected: true, isConnecting: false, poolId }
                  : c
              ),
            }));
          } catch (error) {
            set((state) => ({
              connections: state.connections.map((c) =>
                c.profile.name === id
                  ? { ...c, isConnected: false, isConnecting: false, error: String(error) }
                  : c
              ),
            }));
          }
        })();

        connectInFlight.set(id, task);
        try {
          await task;
        } finally {
          connectInFlight.delete(id);
        }
      },
      
      disconnect: async (id) => {
        const state = get();
        const conn = state.connections.find((c) => c.profile.name === id);
        if (conn?.poolId) {
          await invoke('pool_close', { poolId: conn.poolId });
        }
        set((state) => ({
          connections: state.connections.map((c) =>
            c.profile.name === id
              ? { ...c, isConnected: false, poolId: undefined }
              : c
          ),
        }));
      },
      
      disconnectAll: async () => {
        await invoke('pool_close_all');
        set((state) => ({
          connections: state.connections.map((c) => ({
            ...c,
            isConnected: false,
            poolId: undefined,
          })),
        }));
      },
      
      getConnectionState: (id) => {
        return get().connections.find((c) => c.profile.name === id);
      },
      
      getActiveConnection: () => {
        const { connections, activeConnectionId } = get();
        return connections.find((c) => c.profile.name === activeConnectionId);
      },

      getActiveConnectionCount: () => {
        const { connections } = get();
        return connections.filter((c) => c.isConnected).length;
      },

      checkMaxConnections: () => {
        const { connections } = get();
        const current = connections.filter((c) => c.isConnected).length;

        // 从设置中读取最大连接数
        const settings = localStorage.getItem('dbw-settings');
        let maxConnections = 10; // 默认值
        if (settings) {
          try {
            const parsed = JSON.parse(settings);
            if (parsed.maxConnections !== undefined) {
              maxConnections = parsed.maxConnections;
            }
          } catch {
            // 忽略解析错误，使用默认值
          }
        }

        return {
          allowed: current < maxConnections,
          current,
          max: maxConnections,
        };
      },
    }),
    {
      name: 'connection-storage',
      partialize: (state) => ({ 
        connections: state.connections.map(c => ({ 
          profile: c.profile, 
          isConnected: false,
          isConnecting: false 
        })),
        activeConnectionId: state.activeConnectionId,
        activeDatabase: state.activeDatabase,
        lastUsedDatabaseByConnection: state.lastUsedDatabaseByConnection,
      }),
    }
  )
);
