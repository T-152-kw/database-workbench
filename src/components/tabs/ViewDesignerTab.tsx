import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button,
  Intent,
  Callout,
  InputGroup,
} from '@blueprintjs/core';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useTranslation } from 'react-i18next';
import type { ConnectionProfile } from '../../types';
import { metadataApi, poolApi } from '../../hooks/useTauri';
import { useAppStore } from '../../stores';
import { registerSQLCompletionProvider, updateCompletionProviderState } from '../../utils/sqlCompletionProvider';
import { registerEditor, unregisterEditor, getEditorSettings, applySettingsToAllEditors } from '../../utils/editorSettings';
import '../../styles/view-designer-tab.css';

interface ViewDesignerTabProps {
  tabId: string;
  connectionProfile: ConnectionProfile;
  database: string;
  viewName?: string;
}

export const ViewDesignerTab: React.FC<ViewDesignerTabProps> = ({
  tabId: _tabId,
  connectionProfile,
  database,
  viewName: initialViewName,
}) => {
  const { t } = useTranslation();
  const [viewName, setViewName] = useState(initialViewName || '');
  const [sqlDefinition, setSqlDefinition] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isNewView, setIsNewView] = useState(!initialViewName || initialViewName === 'new_view');
  const { theme } = useAppStore();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [editorSettings, setEditorSettings] = useState(getEditorSettings());

  const handleEditorMount = useCallback((
    editorInstance: editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor'),
  ) => {
    editorRef.current = editorInstance;
    // 注册编辑器到全局管理器
    registerEditor(editorInstance, monaco);
    // 启用自动补全
    if (editorSettings.editorAutoComplete) {
      registerSQLCompletionProvider(monaco);
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

  const formatSql = (sql: string): string => {
    // 移除多余的空白
    let formatted = sql.replace(/\s+/g, ' ').trim();
    
    // 在关键字前添加换行
    const keywords = [
      'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 
      'LIMIT', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 
      'OUTER JOIN', 'CROSS JOIN', 'UNION', 'UNION ALL', 'INTERSECT',
      'EXCEPT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'VALUES',
      'ON', 'AND', 'OR', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END'
    ];
    
    // 先处理特殊的关键字组合
    formatted = formatted
      .replace(/\s*,\s*/g, ',\n    ')  // 逗号后换行并缩进
      .replace(/\s*\(\s*/g, ' (')     // 左括号前空格
      .replace(/\s*\)\s*/g, ') ');    // 右括号后空格
    
    // 处理主要关键字
    keywords.forEach(keyword => {
      const regex = new RegExp(`\\s*\\b${keyword}\\b\\s*`, 'gi');
      if (keyword === 'SELECT') {
        formatted = formatted.replace(regex, '\nSELECT\n    ');
      } else if (keyword === 'FROM' || keyword === 'WHERE' || keyword === 'GROUP BY' || 
                 keyword === 'HAVING' || keyword === 'ORDER BY' || keyword === 'LIMIT') {
        formatted = formatted.replace(regex, `\n${keyword}\n    `);
      } else if (keyword.includes('JOIN')) {
        formatted = formatted.replace(regex, `\n${keyword} `);
      } else if (keyword === 'ON') {
        formatted = formatted.replace(regex, `\n    ${keyword} `);
      } else if (keyword === 'AND' || keyword === 'OR') {
        formatted = formatted.replace(regex, `\n        ${keyword} `);
      } else if (keyword === 'UNION' || keyword === 'UNION ALL' || keyword === 'INTERSECT' || keyword === 'EXCEPT') {
        formatted = formatted.replace(regex, `\n${keyword}\n`);
      }
    });
    
    // 清理多余的空行
    formatted = formatted
      .replace(/\n\s*\n/g, '\n')
      .trim();
    
    return formatted;
  };

  const loadViewDefinition = useCallback(async () => {
    if (!initialViewName || initialViewName === 'new_view') {
      setIsNewView(true);
      setSqlDefinition('SELECT\n    \nFROM\n    \n');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const viewDetails = await metadataApi.listViewDetails(connectionProfile, database);
      const view = viewDetails.find(v => v.Name === initialViewName);
      
      if (view && view.Definition) {
        let selectSql = view.Definition;
        
        const createViewMatch = selectSql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?VIEW\s+[`\w.]+\s+AS\s+(.*)$/is);
        if (createViewMatch) {
          selectSql = createViewMatch[1].trim();
        }
        
        if (selectSql.endsWith(';')) {
          selectSql = selectSql.slice(0, -1).trim();
        }
        
        selectSql = formatSql(selectSql);
        
        setSqlDefinition(selectSql);
        setIsNewView(false);
      } else {
        setError(t('viewTab.designer.errors.loadFailed', { name: initialViewName }));
      }
    } catch (err) {
      setError(t('viewTab.designer.errors.loadDefinitionFailed', { error: err }));
    } finally {
      setIsLoading(false);
    }
  }, [connectionProfile, database, initialViewName]);

  useEffect(() => {
    loadViewDefinition();
  }, [loadViewDefinition]);

  const createPoolAndExecute = async (sql: string): Promise<void> => {
    let poolId: number | null = null;
    let connId: number | null = null;

    try {
      poolId = await poolApi.create(connectionProfile);
      connId = await poolApi.getConnection(poolId);
      
      await poolApi.execute(poolId, connId, `USE \`${database.replace(/`/g, '``')}\``);
      await poolApi.execute(poolId, connId, sql);
    } finally {
      if (poolId !== null && connId !== null) {
        try {
          await poolApi.releaseConnection(poolId, connId);
        } catch {}
        try {
          await poolApi.close(poolId);
        } catch {}
      }
    }
  };

  const handleSave = async () => {
    if (!viewName.trim()) {
      setError(t('viewTab.designer.errors.enterViewName'));
      return;
    }

    if (!sqlDefinition.trim()) {
      setError(t('viewTab.designer.errors.enterDefinition'));
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const escapedName = viewName.trim().replace(/`/g, '``');
      const createViewSql = `CREATE OR REPLACE VIEW \`${escapedName}\` AS ${sqlDefinition.trim()}`;
      
      await createPoolAndExecute(createViewSql);
      
      setSuccess(t('viewTab.designer.successes.saved', { name: viewName }));
      setIsNewView(false);
    } catch (err) {
      setError(t('viewTab.designer.errors.saveFailed', { error: err }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAsNew = async () => {
    const newName = prompt(t('viewTab.designer.prompts.enterNewViewName'), 'new_view');
    
    if (!newName || !newName.trim()) {
      return;
    }

    if (!sqlDefinition.trim()) {
      setError(t('viewTab.designer.errors.enterDefinition'));
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const escapedName = newName.trim().replace(/`/g, '``');
      const createViewSql = `CREATE VIEW \`${escapedName}\` AS ${sqlDefinition.trim()}`;
      
      await createPoolAndExecute(createViewSql);
      
      setSuccess(t('viewTab.designer.successes.created', { name: newName.trim() }));
    } catch (err) {
      setError(t('viewTab.designer.errors.createFailed', { error: err }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleFormatSql = () => {
    if (!sqlDefinition.trim()) return;
    const formatted = formatSql(sqlDefinition);
    setSqlDefinition(formatted);
  };

  const handleClear = () => {
    setSqlDefinition('');
    setError(null);
    setSuccess(null);
  };

  return (
    <div className="view-designer-tab">
      <div className="view-designer-header">
        <h3 className="view-designer-title">
          {isNewView ? t('viewTab.designer.newView') : `${t('viewTab.designer.editView')}: ${initialViewName}`}
        </h3>
        <span className="view-designer-database">
          {t('viewTab.designer.database')}: {database}
        </span>
      </div>

      <div className="view-designer-toolbar">
        {isNewView && (
          <div className="view-name-input">
            <InputGroup
              placeholder={t('viewTab.designer.viewNamePlaceholder')}
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              small
            />
          </div>
        )}
        <div className="view-designer-actions">
          <Button
            text={t('viewTab.designer.save')}
            intent={Intent.PRIMARY}
            onClick={handleSave}
            disabled={isLoading || isSaving}
            loading={isSaving}
            icon="floppy-disk"
          />
          <Button
            text={t('viewTab.designer.saveAsNew')}
            onClick={handleSaveAsNew}
            disabled={isLoading || isSaving}
            icon="duplicate"
          />
          <Button
            text={t('viewTab.designer.format')}
            onClick={handleFormatSql}
            disabled={isLoading || isSaving || !sqlDefinition.trim()}
            icon="align-left"
          />
          <Button
            text={t('viewTab.designer.clear')}
            onClick={handleClear}
            disabled={isLoading || isSaving || !sqlDefinition.trim()}
            icon="eraser"
          />
        </div>
      </div>

      {error && (
        <Callout
          intent={Intent.DANGER}
          title={t('viewTab.designer.error')}
          className="view-designer-message"
        >
          {error}
        </Callout>
      )}

      {success && (
        <Callout
          intent={Intent.SUCCESS}
          title={t('viewTab.designer.success')}
          className="view-designer-message"
        >
          {success}
        </Callout>
      )}

      <div className="view-designer-content">
        <div className="view-designer-editor-label">
          {t('viewTab.designer.definitionLabel')}:
        </div>
        <div className="view-designer-sql-editor">
          <Editor
            height="100%"
            defaultLanguage="sql"
            value={sqlDefinition}
            onChange={(newValue) => {
              setSqlDefinition(newValue || '');
              setError(null);
              setSuccess(null);
            }}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: editorSettings.editorMinimap },
              lineNumbers: 'on',
              roundedSelection: false,
              scrollBeyondLastLine: false,
              readOnly: isLoading || isSaving,
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

      {isLoading && (
        <div className="view-designer-loading">
          <span>{t('viewTab.designer.loading')}</span>
        </div>
      )}
    </div>
  );
};
