import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useAppStore } from '../../stores';
import { registerEditor, unregisterEditor, getEditorSettings, applySettingsToAllEditors } from '../../utils/editorSettings';
import { registerSQLCompletionProvider, updateCompletionProviderState } from '../../utils/sqlCompletionProvider';

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  onSelectionChange?: (hasSelection: boolean) => void;
}

export interface QueryEditorRef {
  getValue: () => string;
  getSelection: () => { isEmpty: () => boolean; startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null;
  getModel: () => editor.ITextModel | null;
  executeEdits: (source: string, edits: editor.IIdentifiedSingleEditOperation[]) => boolean;
  getPosition: () => { lineNumber: number; column: number } | null;
  setPosition: (position: { lineNumber: number; column: number }) => void;
  focus: () => void;
}

export const QueryEditor = forwardRef<QueryEditorRef, QueryEditorProps>(
  ({ value, onChange, onExecute, onSelectionChange }, ref) => {
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const { theme } = useAppStore();
    const [settings, setSettings] = useState(getEditorSettings());

    useImperativeHandle(ref, () => ({
      getValue: () => editorRef.current?.getValue() || '',
      getSelection: () => editorRef.current?.getSelection() || null,
      getModel: () => editorRef.current?.getModel() || null,
      executeEdits: (source: string, edits: editor.IIdentifiedSingleEditOperation[]) => {
        return editorRef.current?.executeEdits(source, edits) || false;
      },
      getPosition: () => editorRef.current?.getPosition() || null,
      setPosition: (position: { lineNumber: number; column: number }) => {
        editorRef.current?.setPosition(position);
      },
      focus: () => {
        editorRef.current?.focus();
      },
    }));

    const handleEditorDidMount = useCallback((
      editorInstance: editor.IStandaloneCodeEditor,
      monaco: typeof import('monaco-editor'),
    ) => {
      editorRef.current = editorInstance;

      // 注册编辑器到全局管理器（会自动应用当前设置）
      registerEditor(editorInstance, monaco);

      // 根据设置注册自动补全
      if (settings.editorAutoComplete) {
        registerSQLCompletionProvider(monaco);
      }

      editorInstance.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => {
          onExecute();
        }
      );

      editorInstance.onDidChangeCursorSelection((event) => {
        onSelectionChange?.(!event.selection.isEmpty());
      });

      // 组件卸载时注销
      return () => {
        unregisterEditor(editorInstance);
      };
    }, [onExecute, onSelectionChange, settings.editorAutoComplete]);

    // 监听设置变更事件，即时响应所有设置
    useEffect(() => {
      const handleSettingsChanged = () => {
        const newSettings = getEditorSettings();
        setSettings(newSettings);
        
        // 应用设置到所有编辑器（字体大小、Tab缩进）
        applySettingsToAllEditors();
        
        // 更新自动补全状态
        updateCompletionProviderState();
      };

      window.addEventListener('dbw:settings-changed', handleSettingsChanged as EventListener);
      return () => {
        window.removeEventListener('dbw:settings-changed', handleSettingsChanged as EventListener);
      };
    }, []);

    const editorTheme = theme === 'dark' ? 'vs-dark' : 'vs';

    return (
      <div className="query-editor">
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={value}
          onChange={(newValue) => onChange(newValue || '')}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: settings.editorMinimap },
            lineNumbers: 'on',
            roundedSelection: false,
            scrollBeyondLastLine: false,
            readOnly: false,
            fontSize: settings.editorFontSize,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            lineHeight: 22,
            padding: { top: 10, bottom: 10 },
            automaticLayout: true,
            wordWrap: 'off',
            tabSize: settings.editorTabSize,
            insertSpaces: true,
            folding: true,
            foldingHighlight: true,
            showFoldingControls: 'always',
            unfoldOnClickAfterEndOfLine: false,
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
            mouseWheelZoom: false,
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
          theme={editorTheme}
        />
      </div>
    );
  }
);

QueryEditor.displayName = 'QueryEditor';
