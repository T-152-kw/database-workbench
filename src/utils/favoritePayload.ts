import type { FavoriteItem } from '../types/api';

export type FavoritePayloadKind = 'SQL_QUERY' | 'CONNECTION_PROFILE' | 'DATABASE_OBJECT';

export interface SqlFavoritePayload {
  version: 1;
  kind: 'SQL_QUERY';
  sql: string;
  sourceFilePath?: string;
  connectionName?: string;
  database?: string;
}

export interface ConnectionFavoritePayload {
  version: 1;
  kind: 'CONNECTION_PROFILE';
  filePath: string;
  profileName?: string;
}

export type DatabaseObjectType = 'TABLE' | 'VIEW' | 'FUNCTION';
export type DatabaseObjectOpenMode = 'LIST' | 'DATA' | 'DESIGNER';

export interface DatabaseObjectFavoritePayload {
  version: 1;
  kind: 'DATABASE_OBJECT';
  path: string;
  connectionName?: string;
  database?: string;
  objectType?: DatabaseObjectType;
  objectName?: string;
  openMode?: DatabaseObjectOpenMode;
  connectionConfigPath?: string;
}

export type FavoritePayload = SqlFavoritePayload | ConnectionFavoritePayload | DatabaseObjectFavoritePayload;

const isObjectType = (value: string): value is DatabaseObjectType => {
  return value === 'TABLE' || value === 'VIEW' || value === 'FUNCTION';
};

const isOpenMode = (value: string): value is DatabaseObjectOpenMode => {
  return value === 'LIST' || value === 'DATA' || value === 'DESIGNER';
};

export const buildDatabaseObjectPath = (
  connectionName: string,
  database: string,
  objectType: DatabaseObjectType,
  objectName: string,
): string => {
  return [connectionName, database, objectType, objectName]
    .map((segment) => segment.trim())
    .join('/');
};

export const parseDatabaseObjectPath = (path: string): {
  connectionName?: string;
  database?: string;
  objectType?: DatabaseObjectType;
  objectName?: string;
} => {
  const parts = path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (parts.length < 4) {
    return {};
  }

  const [connectionName, database, rawType, ...rest] = parts;
  const maybeType = rawType.toUpperCase();
  if (!isObjectType(maybeType)) {
    return { connectionName, database };
  }

  return {
    connectionName,
    database,
    objectType: maybeType,
    objectName: rest.join('/'),
  };
};

export const parseFavoritePayload = (item: FavoriteItem): FavoritePayload | null => {
  const content = item.content?.trim();
  if (!content) {
    return null;
  }

  try {
    const raw = JSON.parse(content) as Partial<FavoritePayload> & { kind?: string; version?: number };
    if (raw.version === 1 && raw.kind === 'SQL_QUERY' && typeof raw.sql === 'string') {
      return {
        version: 1,
        kind: 'SQL_QUERY',
        sql: raw.sql,
        sourceFilePath: typeof raw.sourceFilePath === 'string' ? raw.sourceFilePath : undefined,
        connectionName: typeof raw.connectionName === 'string' ? raw.connectionName : undefined,
        database: typeof raw.database === 'string' ? raw.database : undefined,
      };
    }

    if (raw.version === 1 && raw.kind === 'CONNECTION_PROFILE' && typeof raw.filePath === 'string') {
      return {
        version: 1,
        kind: 'CONNECTION_PROFILE',
        filePath: raw.filePath,
        profileName: typeof raw.profileName === 'string' ? raw.profileName : undefined,
      };
    }

    if (raw.version === 1 && raw.kind === 'DATABASE_OBJECT' && typeof raw.path === 'string') {
      return {
        version: 1,
        kind: 'DATABASE_OBJECT',
        path: raw.path,
        connectionName: typeof raw.connectionName === 'string' ? raw.connectionName : undefined,
        database: typeof raw.database === 'string' ? raw.database : undefined,
        objectType:
          typeof raw.objectType === 'string' && isObjectType(raw.objectType)
            ? raw.objectType
            : undefined,
        objectName: typeof raw.objectName === 'string' ? raw.objectName : undefined,
        openMode:
          typeof raw.openMode === 'string' && isOpenMode(raw.openMode)
            ? raw.openMode
            : undefined,
        connectionConfigPath:
          typeof raw.connectionConfigPath === 'string' ? raw.connectionConfigPath : undefined,
      };
    }
  } catch {
    // Backward compatibility fallback is handled below.
  }

  if (item.type === 'SQL_QUERY') {
    return {
      version: 1,
      kind: 'SQL_QUERY',
      sql: content,
    };
  }

  if (item.type === 'DATABASE_OBJECT') {
    const parsed = parseDatabaseObjectPath(content);
    return {
      version: 1,
      kind: 'DATABASE_OBJECT',
      path: content,
      connectionName: parsed.connectionName,
      database: parsed.database,
      objectType: parsed.objectType,
      objectName: parsed.objectName,
    };
  }

  return null;
};
