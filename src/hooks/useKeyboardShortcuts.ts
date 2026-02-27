import { useEffect, useCallback } from 'react';

interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: string;
  detail?: Record<string, unknown>;
}

const SHORTCUTS: ShortcutConfig[] = [
  { key: 'n', ctrl: true, action: 'dbw:new-connection' },
  { key: 'q', ctrl: true, action: 'dbw:new-query' },
  { key: 'o', ctrl: true, action: 'dbw:open-sql-file' },
  { key: 's', ctrl: true, shift: false, action: 'dbw:save-current-tab' },
  { key: 's', ctrl: true, alt: true, action: 'dbw:save-as' },
  { key: 'F5', action: 'dbw:global-refresh', detail: { source: 'keyboard' } },
  { key: 'w', ctrl: true, action: 'dbw:request-close-tab' },
  { key: 'l', ctrl: true, shift: true, action: 'dbw:toggle-theme' },
  { key: 'Enter', ctrl: true, action: 'dbw:execute-sql' },
];

const isInputElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  const isContentEditable = target.isContentEditable;
  return (
    isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  );
};

export const useKeyboardShortcuts = () => {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const { key, ctrlKey, shiftKey, altKey, target } = event;

    for (const shortcut of SHORTCUTS) {
      const keyMatch = key.toLowerCase() === shortcut.key.toLowerCase();
      const ctrlMatch = !!shortcut.ctrl === ctrlKey;
      const shiftMatch = !!shortcut.shift === shiftKey;
      const altMatch = !!shortcut.alt === altKey;

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        if (isInputElement(target) && !ctrlKey) {
          continue;
        }

        event.preventDefault();
        event.stopPropagation();

        const customEvent = new CustomEvent(shortcut.action, {
          detail: shortcut.detail || {},
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(customEvent);
        break;
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [handleKeyDown]);
};

export default useKeyboardShortcuts;
