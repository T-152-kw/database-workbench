import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Button,
  InputGroup,
  Spinner,
  HTMLSelect,
  Checkbox,
  Dialog,
  Classes,
  Callout,
  Intent,
  Tabs,
  Tab,
  TextArea,
} from '@blueprintjs/core';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useTranslation } from 'react-i18next';
import type { ConnectionProfile, RoutineParamInfo, MultiQueryResultData, QueryResultData } from '../../types';
import { metadataApi, poolApi } from '../../hooks/useTauri';
import { useAppStore } from '../../stores';
import { registerSQLCompletionProvider, updateCompletionProviderState } from '../../utils/sqlCompletionProvider';
import { registerEditor, unregisterEditor, getEditorSettings, applySettingsToAllEditors } from '../../utils/editorSettings';
import '../../styles/function-designer-tab.css';

interface FunctionDesignerTabProps {
  tabId: string;
  connectionProfile: ConnectionProfile;
  database: string;
  functionName?: string;
  functionType?: 'FUNCTION' | 'PROCEDURE';
  autoExecute?: boolean;
}

const RefreshIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M14 8A6 6 0 1 1 8 2v2a4 4 0 1 0 4 4h-2l3-3 3 3h-2z" />
  </svg>
);

const SaveIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 2v12h12V5l-3-3H2zm2 0h6v4h4v8H4V2z" />
  </svg>
);

const PlayIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <polygon points="4,2 14,8 4,14" />
  </svg>
);

export const FunctionDesignerTab: React.FC<FunctionDesignerTabProps> = ({
  tabId: _tabId,
  connectionProfile,
  database,
  functionName: initialFunctionName,
  functionType: initialFunctionType = 'FUNCTION',
  autoExecute = false,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initialFunctionName || '');
  const [type, setType] = useState<'FUNCTION' | 'PROCEDURE'>(initialFunctionType);
  const [returnType, setReturnType] = useState('INT');
  const [isDeterministic, setIsDeterministic] = useState(false);
  const [comment, setComment] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState(t('functionTab.status.ready'));
  const [isNew, setIsNew] = useState(!initialFunctionName);
  const [savedName, setSavedName] = useState<string | null>(initialFunctionName || null);
  
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [executeParams, setExecuteParams] = useState<RoutineParamInfo[]>([]);
  const [executeParamValues, setExecuteParamValues] = useState<Record<string, string>>({});
  const [executeResults, setExecuteResults] = useState<QueryResultData[]>([]);
  const [executeMessage, setExecuteMessage] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeResultTab, setActiveResultTab] = useState<string>('message');
  const [activeResultSetIndex, setActiveResultSetIndex] = useState<number>(0);
  
  const [poolId, setPoolId] = useState<number | null>(null);
  const [connId, setConnId] = useState<number | null>(null);
  
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const { theme } = useAppStore();

  const generateTemplate = useCallback((funcName: string, funcType: 'FUNCTION' | 'PROCEDURE', retType: string, deterministic: boolean, funcComment: string) => {
    const escapedName = funcName || (funcType === 'FUNCTION' ? '<function_name>' : '<procedure_name>');
    const commentClause = funcComment ? ` COMMENT '${funcComment.replace(/'/g, "''")}'` : '';
    const deterministicClause = deterministic ? 'DETERMINISTIC' : 'NOT DETERMINISTIC';
    
    if (funcType === 'FUNCTION') {
      return `DELIMITER //

CREATE FUNCTION \`${database}\`.\`${escapedName}\`(
    param1 ${retType},
    param2 VARCHAR(255)
)
RETURNS ${retType}
${deterministicClause}
${commentClause}
BEGIN
    DECLARE result ${retType};
    
    ${t('functionTab.template.functionComment')}
    SET result = param1 + 1;
    
    RETURN result;
END //

DELIMITER ;`;
    } else {
      // 存储过程不需要 DETERMINISTIC 子句
      return `DELIMITER //

CREATE PROCEDURE \`${database}\`.\`${escapedName}\`(
    IN param1 INT,
    IN param2 VARCHAR(255),
    OUT result VARCHAR(255)
)
${commentClause}
BEGIN
    ${t('functionTab.template.procedureComment')}
    SET result = CONCAT('Processed: ', param2);
    
END //

DELIMITER ;`;
    }
  }, [database, t]);

  const syncRoutineNameInCode = useCallback((sqlCode: string, routineName: string) => {
    if (!sqlCode) return sqlCode;

    const fallbackName = type === 'FUNCTION' ? '<function_name>' : '<procedure_name>';
    const targetName = routineName.trim() || fallbackName;
    const escapedTargetName = targetName.replace(/`/g, '``');

    const placeholderRegex = /<function_name>|<procedure_name>/g;
    if (placeholderRegex.test(sqlCode)) {
      return sqlCode.replace(placeholderRegex, targetName);
    }

    const createHeaderRegex = /(CREATE\s+(?:DEFINER\s*=\s*`[^`]+`@`[^`]+`\s+)?(?:FUNCTION|PROCEDURE)\s+)(`[^`]+`\.)?`[^`]*`/i;
    if (createHeaderRegex.test(sqlCode)) {
      return sqlCode.replace(createHeaderRegex, (_, prefix: string, schemaPart: string | undefined) => {
        const targetSchemaPart = schemaPart ?? `\`${database}\`.`;
        return `${prefix}${targetSchemaPart}\`${escapedTargetName}\``;
      });
    }

    return sqlCode;
  }, [database, type]);

  const loadFunction = useCallback(async () => {
    if (!connectionProfile || !database || !initialFunctionName) return;

    setIsLoading(true);
    setError(null);
    setStatusMessage(t('functionTab.status.loading'));

    try {
      const ddl = await metadataApi.getFunctionDdl(connectionProfile, database, initialFunctionName, initialFunctionType);
      if (ddl) {
        setCode(ddl);
        
        const commentMatch = ddl.match(/COMMENT\s+'([^']*)'/i);
        if (commentMatch) {
          setComment(commentMatch[1].replace(/''/g, "'"));
        }
        
        setIsDeterministic(ddl.toUpperCase().includes('DETERMINISTIC') && !ddl.toUpperCase().includes('NOT DETERMINISTIC'));
        
        if (initialFunctionType === 'FUNCTION') {
          const returnsMatch = ddl.match(/RETURNS\s+(\w+(?:\([^)]+\))?)/i);
          if (returnsMatch) {
            setReturnType(returnsMatch[1]);
          }
        }
        
        setStatusMessage(t('functionTab.status.loadComplete'));
      } else {
        setError(t('functionTab.errors.loadFailed', { type: initialFunctionType === 'FUNCTION' ? t('functionTab.types.function') : t('functionTab.types.procedure') }));
        setStatusMessage(t('functionTab.status.loadFailed'));
      }
    } catch (err) {
      setError(t('functionTab.errors.loadError', { type: initialFunctionType === 'FUNCTION' ? t('functionTab.types.function') : t('functionTab.types.procedure'), error: err }));
      setStatusMessage(t('functionTab.status.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [connectionProfile, database, initialFunctionName, initialFunctionType, t]);

  // 初始加载时生成模板（仅执行一次）
  useEffect(() => {
    if (initialFunctionName) {
      loadFunction();
    } else {
      // 新建模式：只生成一次初始模板
      setCode(generateTemplate('', type, returnType, isDeterministic, comment));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFunctionName]);

  // 当名称变化时，只更新 CREATE 头部中的对象名，不重新生成整个模板
  useEffect(() => {
    if (isNew && !initialFunctionName) {
      setCode((previousCode) => {
        const newCode = syncRoutineNameInCode(previousCode, name);
        return newCode === previousCode ? previousCode : newCode;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, isNew, initialFunctionName, type, syncRoutineNameInCode]);

  useEffect(() => {
    const initConnection = async () => {
      if (!connectionProfile) return;
      
      try {
        const newPoolId = await poolApi.create(connectionProfile);
        const newConnId = await poolApi.getConnection(newPoolId);
        setPoolId(newPoolId);
        setConnId(newConnId);
      } catch (err) {
        console.error('Failed to create connection:', err);
      }
    };

    initConnection();

    return () => {
      if (poolId !== null && connId !== null) {
        poolApi.releaseConnection(poolId, connId).catch(() => {});
        poolApi.close(poolId).catch(() => {});
      }
    };
  }, [connectionProfile]);

  useEffect(() => {
    if (autoExecute && savedName && !isNew) {
      handleExecute();
    }
  }, [autoExecute, savedName, isNew]);

  const [editorSettings, setEditorSettings] = useState(getEditorSettings());

  const handleEditorMount = useCallback((
    editorInstance: editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor'),
  ) => {
    editorRef.current = editorInstance;
    // 注册编辑器到全局管理器
    registerEditor(editorInstance, monaco);
    // 启用自动补全（包含存储过程/函数特有关键字）
    if (editorSettings.editorAutoComplete) {
      registerSQLCompletionProvider(monaco, true);
    }

    return () => {
      unregisterEditor(editorInstance);
    };
  }, [editorSettings.editorAutoComplete]);

  // 监听设置变更事件，即时响应所有设置
  useEffect(() => {
    const handleSettingsChanged = () => {
      const newSettings = getEditorSettings();
      setEditorSettings(newSettings);
      // 应用设置到所有编辑器
      applySettingsToAllEditors();
      // 更新自动补全状态
      updateCompletionProviderState();
    };

    window.addEventListener('dbw:settings-changed', handleSettingsChanged as EventListener);
    return () => {
      window.removeEventListener('dbw:settings-changed', handleSettingsChanged as EventListener);
    };
  }, []);

  const handleCodeChange = useCallback((newValue: string | undefined) => {
    if (newValue !== undefined) {
      setCode(newValue);
      setError(null);
      setSuccess(null);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError(t('functionTab.errors.enterName', { type: type === 'FUNCTION' ? t('functionTab.types.function') : t('functionTab.types.procedure') }));
      return;
    }

    if (!code.trim()) {
      setError(t('functionTab.errors.enterCode', { type: type === 'FUNCTION' ? t('functionTab.types.function') : t('functionTab.types.procedure') }));
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);
    setStatusMessage(t('functionTab.status.saving'));

    let effectivePoolId: number | null = poolId;
    let effectiveConnId: number | null = connId;
    let createdTempConnection = false;

    try {
      let finalCode = code;
      if (isNew) {
        finalCode = code.replace(/<function_name>|<procedure_name>/g, name);
      }

      if (effectivePoolId === null || effectiveConnId === null) {
        effectivePoolId = await poolApi.create(connectionProfile);
        effectiveConnId = await poolApi.getConnection(effectivePoolId);
        createdTempConnection = true;
      }

      const escapedDatabase = database.replace(/`/g, '``');
      await poolApi.execute(effectivePoolId, effectiveConnId, `USE \`${escapedDatabase}\``);

      if (!isNew && savedName) {
        const escapedSavedName = savedName.replace(/`/g, '``');
        const dropSql = `DROP ${type} IF EXISTS \`${escapedDatabase}\`.\`${escapedSavedName}\``;
        await poolApi.execute(effectivePoolId, effectiveConnId, dropSql);
      }

      const statements = await invoke<string[]>('sql_split_statements', {
        sql: finalCode,
        dbType: 'MYSQL',
      });

      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (!trimmed || trimmed.toLowerCase().startsWith('delimiter')) {
          continue;
        }
        await poolApi.execute(effectivePoolId, effectiveConnId, trimmed);
      }

      setSuccess(t('functionTab.success.saved', { type: type === 'FUNCTION' ? t('functionTab.types.function') : t('functionTab.types.procedure') }));
      setStatusMessage(t('functionTab.status.saveSuccess'));
      setIsNew(false);
      setSavedName(name);
    } catch (err) {
      setError(t('functionTab.errors.saveError', { error: err }));
      setStatusMessage(t('functionTab.status.saveFailed'));
    } finally {
      if (createdTempConnection && effectivePoolId !== null && effectiveConnId !== null) {
        await poolApi.releaseConnection(effectivePoolId, effectiveConnId).catch(() => false);
        await poolApi.close(effectivePoolId).catch(() => {});
      }
      setIsSaving(false);
    }
  }, [name, type, code, isNew, savedName, connectionProfile, database, poolId, connId]);

  const handleExecute = useCallback(async () => {
    if (!savedName) {
      setError(t('functionTab.errors.executeSaveFirst'));
      return;
    }

    setExecuteDialogOpen(true);
    setIsExecuting(true);
    setExecuteResults([]);
    setExecuteMessage(null);
    setExecuteParamValues({});
    setActiveResultSetIndex(0);

    try {
      const params = await metadataApi.getRoutineParams(connectionProfile, database, savedName);
      setExecuteParams(params);
      
      if (params.length === 0 && autoExecute) {
        await performExecute(params, {});
      }
    } catch (err) {
      setExecuteMessage(t('functionTab.errors.loadParamsFailed', { error: err }));
    } finally {
      setIsExecuting(false);
    }
  }, [connectionProfile, database, savedName, autoExecute, t]);

  const performExecute = useCallback(async (params: RoutineParamInfo[], values: Record<string, string>) => {
    if (!poolId || !connId || !savedName) return;

    setIsExecuting(true);
    setExecuteResults([]);
    setExecuteMessage(null);
    setActiveResultSetIndex(0);

    try {
      await poolApi.execute(poolId, connId, `USE \`${database}\``);

      const inParams = params.filter(p => p.mode === 'IN' || p.mode === 'INOUT');
      const outParams = params.filter(p => p.mode === 'OUT' || p.mode === 'INOUT');

      let sql = '';
      if (type === 'FUNCTION') {
        const args = inParams.map(p => values[p.name] || 'NULL').join(', ');
        sql = `SELECT \`${savedName}\`(${args}) AS result`;
      } else {
        const args = params.map(p => {
          if (p.mode === 'OUT' || p.mode === 'INOUT') {
            return `@${p.name}`;
          }
          return values[p.name] || 'NULL';
        }).join(', ');
        sql = `CALL \`${savedName}\`(${args})`;
      }

      // Use multi-result set query for stored procedures
      let results: QueryResultData[] = [];
      if (type === 'PROCEDURE') {
        const multiResult = await invoke<MultiQueryResultData>('pool_query_multi', {
          poolId,
          connId,
          sql,
        });
        results = multiResult.result_sets;
      } else {
        // For functions, use regular query
        const result = await poolApi.query(poolId, connId, sql);
        // Convert QueryResult to QueryResultData
        results = [{
          columns: result.columns.map(col => ({
            name: col.name,
            label: col.label,
            type_name: col.typeName,
          })),
          rows: result.rows,
        }];
      }

      // If there are OUT parameters, fetch them
      if (type === 'PROCEDURE' && outParams.length > 0) {
        const selectOut = `SELECT ${outParams.map(p => `@${p.name} AS ${p.name}`).join(', ')}`;
        const outResult = await poolApi.query(poolId, connId, selectOut);
        if (outResult.rows.length > 0) {
          // Convert QueryResult to QueryResultData
          results.push({
            columns: outResult.columns.map(col => ({
              name: col.name,
              label: col.label,
              type_name: col.typeName,
            })),
            rows: outResult.rows,
          });
        }
      }

      setExecuteResults(results);
      
      if (results.length === 0) {
        setExecuteMessage(t('functionTab.execute.success', { count: 0 }));
      } else if (results.length === 1) {
        setExecuteMessage(t('functionTab.execute.success', { count: results[0].rows.length }));
      } else {
        const totalRows = results.reduce((sum, r) => sum + r.rows.length, 0);
        setExecuteMessage(t('functionTab.execute.multiResultSuccess', { 
          setCount: results.length, 
          totalRows 
        }));
      }
      setActiveResultTab('data');
    } catch (err) {
      setExecuteMessage(t('functionTab.execute.failed', { error: err }));
      setActiveResultTab('message');
    } finally {
      setIsExecuting(false);
    }
  }, [poolId, connId, savedName, type, database, t]);

  const handleParamValueChange = useCallback((paramName: string, value: string) => {
    setExecuteParamValues(prev => ({ ...prev, [paramName]: value }));
  }, []);

  const getModeColor = (mode?: string): string => {
    switch (mode) {
      case 'IN': return '#28a745';
      case 'OUT': return '#dc3545';
      case 'INOUT': return '#fd7e14';
      case 'RETURN': return '#6f42c1';
      default: return '#6c757d';
    }
  };

  const handleRefresh = useCallback(() => {
    if (!isNew && savedName) {
      loadFunction();
    }
  }, [isNew, savedName, loadFunction]);

  if (isLoading) {
    return (
      <div className="function-designer-loading">
        <Spinner size={32} />
        <span>{t('functionTab.loading', { type: type === 'FUNCTION' ? t('functionTab.types.function') : t('functionTab.types.procedure') })}</span>
      </div>
    );
  }

  return (
    <div className="function-designer-tab">
      <div className="function-designer-toolbar">
        <Button
          minimal
          small
          icon={<RefreshIcon size={14} />}
          onClick={handleRefresh}
          disabled={isNew}
          title={t('functionTab.toolbar.refresh')}
        >
          {t('functionTab.toolbar.refresh')}
        </Button>
        <Button
          minimal
          small
          icon="add"
          onClick={() => {
            setIsNew(true);
            setName('');
            setSavedName(null);
            setCode(generateTemplate('', type, returnType, isDeterministic, comment));
          }}
          title={t('functionTab.toolbar.new')}
        >
          {t('functionTab.toolbar.new')}
        </Button>
        {!isNew && savedName && (
          <Button
            minimal
            small
            icon={<PlayIcon size={14} />}
            onClick={handleExecute}
            title={t('functionTab.toolbar.execute')}
          >
            {t('functionTab.toolbar.execute')}
          </Button>
        )}
        <Button
          minimal
          small
          icon={<SaveIcon size={14} />}
          onClick={handleSave}
          loading={isSaving}
          intent="primary"
          title={t('functionTab.toolbar.save')}
        >
          {t('functionTab.toolbar.save')}
        </Button>
      </div>

      {error && (
        <Callout intent={Intent.DANGER} className="function-designer-message">
          {error}
        </Callout>
      )}

      {success && (
        <Callout intent={Intent.SUCCESS} className="function-designer-message">
          {success}
        </Callout>
      )}

      <div className="function-designer-content">
        <div className="function-designer-properties">
          <div className="function-property">
            <label>{t('functionTab.properties.name')}</label>
            <InputGroup
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'FUNCTION' ? t('functionTab.properties.placeholders.functionName') : t('functionTab.properties.placeholders.procedureName')}
            />
          </div>

          <div className="function-property">
            <label>{t('functionTab.properties.type')}</label>
            <HTMLSelect
              value={type}
              onChange={(e) => {
                const newType = e.target.value as 'FUNCTION' | 'PROCEDURE';
                setType(newType);
                // 类型切换时只替换 CREATE FUNCTION/PROCEDURE 关键字，保留用户代码
                if (code) {
                  let newCode = code;
                  if (newType === 'FUNCTION') {
                    newCode = code.replace(/CREATE\s+PROCEDURE/i, 'CREATE FUNCTION');
                    // 如果没有 RETURNS 子句，添加一个默认的
                    if (!newCode.includes('RETURNS')) {
                      newCode = newCode.replace(
                        /(CREATE\s+FUNCTION\s+[^)]+\))/i,
                        `$1\nRETURNS ${returnType}`
                      );
                    }
                  } else {
                    newCode = code.replace(/CREATE\s+FUNCTION/i, 'CREATE PROCEDURE');
                    // 移除 RETURNS 子句和 DETERMINISTIC
                    newCode = newCode.replace(/\s*RETURNS\s+\w+(?:\([^)]+\))?/i, '');
                    newCode = newCode.replace(/\s*(NOT\s+)?DETERMINISTIC/i, '');
                  }
                  setCode(newCode);
                }
              }}
              disabled={!isNew}
            >
              <option value="FUNCTION">{t('functionTab.types.function')}</option>
              <option value="PROCEDURE">{t('functionTab.types.procedure')}</option>
            </HTMLSelect>
          </div>

          {type === 'FUNCTION' && (
            <div className="function-property">
              <label>{t('functionTab.properties.returnType')}</label>
              <InputGroup
                value={returnType}
                onChange={(e) => setReturnType(e.target.value)}
                placeholder={t('functionTab.properties.placeholders.returnType')}
              />
            </div>
          )}

          {type === 'FUNCTION' && (
            <div className="function-property">
              <label>{t('functionTab.properties.deterministic')}</label>
              <Checkbox
                checked={isDeterministic}
                onChange={(e) => setIsDeterministic(e.target.checked)}
                label="DETERMINISTIC"
              />
            </div>
          )}

          <div className="function-property">
            <label>{t('functionTab.properties.comment')}</label>
            <TextArea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={type === 'FUNCTION' ? t('functionTab.properties.placeholders.functionComment') : t('functionTab.properties.placeholders.procedureComment')}
              rows={3}
              fill
            />
          </div>
        </div>

        <div className="function-designer-editor">
          <label>{t('functionTab.editor.label')}</label>
          <div className="function-designer-monaco">
            <Editor
              height="100%"
              defaultLanguage="sql"
              value={code}
              onChange={handleCodeChange}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: editorSettings.editorMinimap },
                lineNumbers: 'on',
                roundedSelection: false,
                scrollBeyondLastLine: false,
                readOnly: isSaving,
                fontSize: editorSettings.editorFontSize,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                lineHeight: 22,
                padding: { top: 10, bottom: 10 },
                automaticLayout: true,
                wordWrap: 'off',
                tabSize: editorSettings.editorTabSize,
                insertSpaces: true,
                folding: true,
                foldingHighlight: true,
                showFoldingControls: 'always',
                matchBrackets: 'always',
                autoIndent: 'full',
                formatOnPaste: true,
                formatOnType: true,
                suggestOnTriggerCharacters: true,
                quickSuggestions: true,
                quickSuggestionsDelay: 100,
                wordBasedSuggestions: 'currentDocument',
                parameterHints: { enabled: true },
                hover: { enabled: true },
                contextmenu: true,
                smoothScrolling: true,
                cursorBlinking: 'blink',
                cursorSmoothCaretAnimation: 'on',
                selectionHighlight: true,
                occurrencesHighlight: 'singleFile',
                renderLineHighlight: 'all',
                renderWhitespace: 'selection',
                guides: {
                  bracketPairs: true,
                  indentation: true,
                },
              }}
              theme={theme === 'dark' ? 'vs-dark' : 'vs'}
            />
          </div>
        </div>
      </div>

      <div className="function-designer-status">
        <span>{statusMessage}</span>
      </div>

      <Dialog
        isOpen={executeDialogOpen}
        onClose={() => setExecuteDialogOpen(false)}
        title={t('functionTab.executeDialog.title', { type: type === 'FUNCTION' ? t('functionTab.types.function') : t('functionTab.types.procedure'), name: savedName })}
        className="function-execute-dialog"
      >
        <div className={Classes.DIALOG_BODY}>
          <div className="function-execute-params">
            <label className="function-execute-params-label">{t('functionTab.executeDialog.params')}</label>
            {isExecuting ? (
              <div className="function-execute-loading">
                <Spinner size={24} />
                <span>{t('functionTab.executeDialog.loadingParams')}</span>
              </div>
            ) : executeParams.length === 0 ? (
              <div className="function-execute-no-params">
                {t('functionTab.executeDialog.noParams')}
              </div>
            ) : (
              <div className="function-execute-params-grid">
                {executeParams.map((param) => (
                  <div key={param.name} className="function-execute-param-row">
                    <span className="function-execute-param-name">{param.name}</span>
                    <span 
                      className="function-execute-param-mode"
                      style={{ color: getModeColor(param.mode) }}
                    >
                      {param.mode || 'IN'}
                    </span>
                    <span className="function-execute-param-type">{param.type}</span>
                    {param.mode !== 'OUT' && (
                      <InputGroup
                        value={executeParamValues[param.name] || ''}
                        onChange={(e) => handleParamValueChange(param.name, e.target.value)}
                        placeholder={t('functionTab.executeDialog.placeholder', { type: param.type })}
                        small
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="function-execute-result">
            <label className="function-execute-result-label">{t('functionTab.executeDialog.result')}</label>
            <Tabs
              id="execute-result-tabs"
              selectedTabId={activeResultTab}
              onChange={(id) => setActiveResultTab(id as string)}
            >
              <Tab
                id="message"
                title={t('functionTab.executeDialog.tabs.message')}
                panel={
                  <div className="function-execute-message">
                    {executeMessage || t('functionTab.executeDialog.defaultMessage')}
                  </div>
                }
              />
              <Tab
                id="data"
                title={t('functionTab.executeDialog.tabs.data')}
                panel={
                  <div className="function-execute-data">
                    {executeResults.length > 0 ? (
                      <>
                        {/* Result set selector for multiple result sets */}
                        {executeResults.length > 1 && (
                          <div className="function-execute-result-set-selector">
                            <label>{t('functionTab.executeDialog.resultSetSelector')}:</label>
                            <HTMLSelect
                              value={activeResultSetIndex}
                              onChange={(e) => setActiveResultSetIndex(Number(e.target.value))}
                              options={executeResults.map((result, index) => ({
                                value: index,
                                label: t('functionTab.executeDialog.resultSetLabel', { 
                                  index: index + 1, 
                                  count: result.rows.length 
                                }),
                              }))}
                            />
                          </div>
                        )}
                        {/* Display active result set */}
                        {executeResults[activeResultSetIndex] && executeResults[activeResultSetIndex].rows.length > 0 ? (
                          <table className="function-execute-table">
                            <thead>
                              <tr>
                                {executeResults[activeResultSetIndex].columns.map((col) => (
                                  <th key={col.name}>{col.label}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {executeResults[activeResultSetIndex].rows.map((row, idx) => (
                                <tr key={idx}>
                                  {(row as unknown[]).map((cell, cellIdx) => (
                                    <td key={cellIdx}>{cell?.toString() ?? 'NULL'}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="function-execute-no-data">{t('functionTab.executeDialog.noData')}</div>
                        )}
                      </>
                    ) : (
                      <div className="function-execute-no-data">{t('functionTab.executeDialog.noData')}</div>
                    )}
                  </div>
                }
              />
            </Tabs>
          </div>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setExecuteDialogOpen(false)}>{t('functionTab.executeDialog.close')}</Button>
            <Button
              intent="primary"
              onClick={() => performExecute(executeParams, executeParamValues)}
              loading={isExecuting}
            >
              {t('functionTab.executeDialog.execute')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default FunctionDesignerTab;
