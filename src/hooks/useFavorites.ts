import { useState, useCallback } from 'react';
import { favoritesApi } from './useTauri';
import type { FavoriteItem, FavoriteType } from '../types/api';

export interface UseFavoritesReturn {
  favorites: FavoriteItem[];
  loading: boolean;
  error: string | null;
  getAll: () => Promise<void>;
  getByType: (type: FavoriteType) => Promise<void>;
  search: (keyword: string) => Promise<void>;
  get: (id: string) => Promise<FavoriteItem | null>;
  add: (item: Omit<FavoriteItem, 'id'>) => Promise<FavoriteItem>;
  update: (item: FavoriteItem) => Promise<void>;
  remove: (id: string) => Promise<void>;
  recordUsage: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  total: () => Promise<number>;
  stats: () => Promise<Record<FavoriteType, number>>;
}

export function useFavorites(): UseFavoritesReturn {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await favoritesApi.getAll();
      setFavorites(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get favorites');
    } finally {
      setLoading(false);
    }
  }, []);

  const getByType = useCallback(async (type: FavoriteType) => {
    setLoading(true);
    setError(null);
    try {
      const result = await favoritesApi.getByType(type);
      setFavorites(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get favorites by type');
    } finally {
      setLoading(false);
    }
  }, []);

  const search = useCallback(async (keyword: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await favoritesApi.search(keyword);
      setFavorites(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search favorites');
    } finally {
      setLoading(false);
    }
  }, []);

  const get = useCallback(async (id: string): Promise<FavoriteItem | null> => {
    setError(null);
    try {
      return await favoritesApi.get(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get favorite');
      return null;
    }
  }, []);

  const add = useCallback(async (item: Omit<FavoriteItem, 'id'>): Promise<FavoriteItem> => {
    setLoading(true);
    setError(null);
    try {
      const result = await favoritesApi.add(item);
      setFavorites(prev => [...prev, result]);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add favorite');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const update = useCallback(async (item: FavoriteItem): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await favoritesApi.update(item);
      setFavorites(prev => prev.map(fav => fav.id === item.id ? item : fav));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await favoritesApi.remove(id);
      setFavorites(prev => prev.filter(fav => fav.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove favorite');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const recordUsage = useCallback(async (id: string): Promise<void> => {
    setError(null);
    try {
      await favoritesApi.recordUsage(id);
      setFavorites(prev => prev.map(fav => 
        fav.id === id 
          ? { ...fav, lastUsedTime: Date.now(), usageCount: fav.usageCount + 1 }
          : fav
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record usage');
    }
  }, []);

  const clear = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await favoritesApi.clear();
      setFavorites([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear favorites');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const total = useCallback(async (): Promise<number> => {
    setError(null);
    try {
      return await favoritesApi.total();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get total count');
      return 0;
    }
  }, []);

  const stats = useCallback(async (): Promise<Record<FavoriteType, number>> => {
    setError(null);
    try {
      return await favoritesApi.stats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get stats');
      return {
        SQL_QUERY: 0,
        CONNECTION_PROFILE: 0,
        DATABASE_OBJECT: 0,
      };
    }
  }, []);

  return {
    favorites,
    loading,
    error,
    getAll,
    getByType,
    search,
    get,
    add,
    update,
    remove,
    recordUsage,
    clear,
    total,
    stats,
  };
}
