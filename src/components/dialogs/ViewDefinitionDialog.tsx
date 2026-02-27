import { useEffect, useState, useCallback, useRef } from 'react';
import { Dialog, Classes, Spinner, Callout, Button } from '@blueprintjs/core';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { ConnectionProfile } from '../../types';
import { poolApi } from '../../hooks/useTauri';
import { useAppStore } from '../../stores';
import { registerEditor, unregisterEditor, getEditorSettings, applySettingsToAllEditors } from '../../utils/editorSettings';

interface ViewDefinitionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connectionProfile: ConnectionProfile;
  database: string;
  viewName: string;
}

interface ViewState {
  ddl: string;
  isLoading: boolean;
  error: string | null;
}

const formatViewDDL = (ddl: string): string => {
  if (!ddl) return '';
  
  let formatted = ddl.trim();
  
  formatted = formatted.replace(/\s+/g, ' ');
  
  const keywords = [
    'CREATE', 'OR', 'REPLACE', 'VIEW', 'AS', 'SELECT', 'FROM', 'WHERE', 
    'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AND', 'OR', 'NOT',
    'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL',
    'DISTINCT', 'INSERT', 'UPDATE', 'DELETE', 'SET', 'VALUES', 'INTO',
    'ALTER', 'TABLE', 'INDEX', 'KEY', 'PRIMARY', 'FOREIGN', 'REFERENCES',
    'CONSTRAINT', 'DEFAULT', 'NULL', 'NOT', 'UNIQUE', 'CHECK', 'CASCADE',
    'WITH', 'CASCADED', 'LOCAL', 'CHECK', 'OPTION'
  ];
  
  const upperKeywords = new Set(keywords);
  
  formatted = formatted.replace(/\b(\w+)\b/g, (match) => {
    if (upperKeywords.has(match.toUpperCase())) {
      return match.toUpperCase();
    }
    return match;
  });
  
  formatted = formatted.replace(/\s*,\s*/g, ',\n  ');
  
  const clauseKeywords = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 
    'LIMIT', 'OFFSET', 'UNION', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN',
    'INNER JOIN', 'OUTER JOIN', 'ON', 'AND', 'OR'
  ];
  
  for (const keyword of clauseKeywords) {
    const regex = new RegExp(`\\s+${keyword}\\s+`, 'gi');
    formatted = formatted.replace(regex, `\n${keyword}\n  `);
  }
  
  formatted = formatted.replace(/\n\s*\n/g, '\n');
  
  formatted = formatted.trim();
  
  return formatted;
};

export const ViewDefinitionDialog: React.FC<ViewDefinitionDialogProps> = ({
  isOpen,
  onClose,
  connectionProfile,
  database,
  viewName,
}) => {
  const [state, setState] = useState<ViewState>({
    ddl: '',
    isLoading: false,
    error: null,
  });
  const { theme } = useAppStore();
  const [editorSettings, setEditorSettings] = useState(getEditorSettings());
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // 监听设置变更事件
  useEffect(() => {
    const handleSettingsChanged = () => {
      const newSettings = getEditorSettings();
      setEditorSettings(newSettings);
      // 应用设置到所有编辑器
      applySettingsToAllEditors();
    };

    window.addEventListener('dbw:settings-changed', handleSettingsChanged as EventListener);
    return () => {
      window.removeEventListener('dbw:settings-changed', handleSettingsChanged as EventListener);
    };
  }, []);

  const handleEditorMount = useCallback((
    editorInstance: editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor'),
  ) => {
    editorRef.current = editorInstance;
    // 注册只读编辑器
    registerEditor(editorInstance, monaco);
    return () => {
      unregisterEditor(editorInstance);
    };
  }, []);

  const fetchViewDefinition = useCallback(async () => {
    if (!isOpen || !connectionProfile || !database || !viewName) return;

    setState({ ddl: '', isLoading: true, error: null });

    try {
      const poolId = await poolApi.create(connectionProfile);
      const connId = await poolApi.getConnection(poolId);
      
      try {
        const sql = `SHOW CREATE VIEW \`${database}\`.\`${viewName}\``;
        const result = await poolApi.query(poolId, connId, sql);
        
        if (result.rows && result.rows.length > 0) {
          const createViewColumn = result.columns.findIndex(
            col => col.name.toLowerCase().includes('create view') || 
                   col.name.toLowerCase() === 'create view'
          );
          
          const ddlIndex = createViewColumn >= 0 ? createViewColumn : 1;
          const rawDDL = String(result.rows[0][ddlIndex] || '');
          const formattedDDL = formatViewDDL(rawDDL);
          
          setState({ ddl: formattedDDL, isLoading: false, error: null });
        } else {
          setState({ ddl: '', isLoading: false, error: '无法获取视图定义' });
        }
      } finally {
        await poolApi.releaseConnection(poolId, connId);
        await poolApi.close(poolId);
      }
    } catch (err) {
      setState({ 
        ddl: '', 
        isLoading: false, 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
  }, [isOpen, connectionProfile, database, viewName]);

  useEffect(() => {
    if (isOpen) {
      fetchViewDefinition();
    } else {
      setState({ ddl: '', isLoading: false, error: null });
    }
  }, [isOpen, fetchViewDefinition]);

  const editorTheme = theme === 'dark' ? 'vs-dark' : 'vs';

  const renderContent = () => {
    if (state.isLoading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <Spinner intent="primary" size={50} />
        </div>
      );
    }

    if (state.error) {
      return (
        <Callout intent="danger" title="加载失败">
          {state.error}
        </Callout>
      );
    }

    return (
      <div style={{ height: '400px', border: '1px solid #ddd', borderRadius: '4px' }}>
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={state.ddl}
          onMount={handleEditorMount}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            fontSize: editorSettings.editorFontSize,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            lineHeight: 20,
            wordWrap: 'on',
            automaticLayout: true,
            folding: true,
            renderLineHighlight: 'all',
            contextmenu: false,
          }}
          theme={editorTheme}
        />
      </div>
    );
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={`视图定义: ${viewName}`}
      icon="code-block"
      style={{ width: '700px' }}
    >
      <div className={Classes.DIALOG_BODY}>
        <Callout intent="primary" style={{ marginBottom: '15px' }}>
          <strong>数据库:</strong> {database} &nbsp;|&nbsp; <strong>视图:</strong> {viewName}
        </Callout>
        {renderContent()}
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>关闭</Button>
        </div>
      </div>
    </Dialog>
  );
};
