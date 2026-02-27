import type { editor } from 'monaco-editor';

// 编辑器设置接口
export interface EditorSettings {
  editorFontSize: number;
  editorTabSize: number;
  editorAutoComplete: boolean;
  editorMinimap: boolean;
  editorAutoSave: boolean;
}

// 默认设置
export const defaultEditorSettings: EditorSettings = {
  editorFontSize: 14,
  editorTabSize: 2,
  editorAutoComplete: true,
  editorMinimap: true,
  editorAutoSave: false,
};

// 保存所有已注册的编辑器实例
const registeredEditors = new Set<editor.IStandaloneCodeEditor>();

// 保存 monaco 实例
let monacoInstance: typeof import('monaco-editor') | null = null;

/**
 * 注册编辑器实例
 */
export function registerEditor(
  editorInstance: editor.IStandaloneCodeEditor,
  monaco: typeof import('monaco-editor')
): void {
  registeredEditors.add(editorInstance);
  monacoInstance = monaco;

  // 应用当前设置
  applySettingsToEditor(editorInstance);
}

/**
 * 注销编辑器实例
 */
export function unregisterEditor(editorInstance: editor.IStandaloneCodeEditor): void {
  registeredEditors.delete(editorInstance);
}

/**
 * 获取当前编辑器设置
 */
export function getEditorSettings(): EditorSettings {
  if (typeof window === 'undefined') return defaultEditorSettings;

  const savedSettings = localStorage.getItem('dbw-settings');
  if (savedSettings) {
    try {
      const parsed = JSON.parse(savedSettings);
      return {
        editorFontSize: parsed.editorFontSize ?? defaultEditorSettings.editorFontSize,
        editorTabSize: parsed.editorTabSize ?? defaultEditorSettings.editorTabSize,
        editorAutoComplete: parsed.editorAutoComplete ?? defaultEditorSettings.editorAutoComplete,
        editorMinimap: parsed.editorMinimap ?? defaultEditorSettings.editorMinimap,
        editorAutoSave: parsed.editorAutoSave ?? defaultEditorSettings.editorAutoSave,
      };
    } catch {
      return defaultEditorSettings;
    }
  }
  return defaultEditorSettings;
}

/**
 * 应用设置到单个编辑器
 */
export function applySettingsToEditor(editorInstance: editor.IStandaloneCodeEditor): void {
  const settings = getEditorSettings();

  editorInstance.updateOptions({
    fontSize: settings.editorFontSize,
    tabSize: settings.editorTabSize,
    minimap: { enabled: settings.editorMinimap },
  });
}

/**
 * 应用设置到所有已注册的编辑器
 */
export function applySettingsToAllEditors(): void {
  const settings = getEditorSettings();

  registeredEditors.forEach((editorInstance) => {
    if (editorInstance) {
      editorInstance.updateOptions({
        fontSize: settings.editorFontSize,
        tabSize: settings.editorTabSize,
        minimap: { enabled: settings.editorMinimap },
      });
    }
  });
}

/**
 * 获取 Monaco 实例
 */
export function getMonacoInstance(): typeof import('monaco-editor') | null {
  return monacoInstance;
}

/**
 * 设置 Monaco 实例
 */
export function setMonacoInstance(monaco: typeof import('monaco-editor')): void {
  monacoInstance = monaco;
}
