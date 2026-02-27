import React from 'react';
import { Dialog, Classes, Button, HTMLTable } from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';

interface ShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  category: string;
  items: {
    action: string;
    shortcut: string;
  }[];
}

export const ShortcutsDialog: React.FC<ShortcutsDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  
  const shortcutsData: ShortcutItem[] = [
    {
      category: t('dialog.shortcuts.fileOperations'),
      items: [
        { action: t('menu.file.newConnection'), shortcut: 'Ctrl + N' },
        { action: t('menu.file.newQuery'), shortcut: 'Ctrl + Q' },
        { action: t('menu.file.open'), shortcut: 'Ctrl + O' },
        { action: t('menu.file.save'), shortcut: 'Ctrl + S' },
        { action: t('menu.file.saveAs'), shortcut: 'Ctrl + Alt + S' },
      ],
    },
    {
      category: t('dialog.shortcuts.editOperations'),
      items: [
        { action: t('menu.edit.undo'), shortcut: 'Ctrl + Z' },
        { action: t('menu.edit.redo'), shortcut: 'Ctrl + Y' },
        { action: t('menu.edit.cut'), shortcut: 'Ctrl + X' },
        { action: t('menu.edit.copy'), shortcut: 'Ctrl + C' },
        { action: t('menu.edit.paste'), shortcut: 'Ctrl + V' },
        { action: t('menu.edit.selectAll'), shortcut: 'Ctrl + A' },
      ],
    },
    {
      category: t('dialog.shortcuts.viewOperations'),
      items: [
        { action: t('menu.view.refresh'), shortcut: 'F5' },
      ],
    },
    {
      category: t('dialog.shortcuts.otherOperations'),
      items: [
        { action: t('menu.window.closeCurrentTab'), shortcut: 'Ctrl + W' },
        { action: t('menu.window.toggleTheme'), shortcut: 'Ctrl + Shift + L' },
      ],
    },
  ];

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('dialog.shortcuts.title')}
      icon="key"
      className="shortcuts-dialog"
    >
      <div className={Classes.DIALOG_BODY}>
        <div className="shortcuts-content">
          {shortcutsData.map((category) => (
            <div key={category.category} className="shortcuts-category">
              <h3 className="shortcuts-category-title">{category.category}</h3>
              <HTMLTable compact striped className="shortcuts-table">
                <tbody>
                  {category.items.map((item) => (
                    <tr key={item.action}>
                      <td className="shortcuts-action">{item.action}</td>
                      <td className="shortcuts-key">
                        <kbd>{item.shortcut}</kbd>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
            </div>
          ))}
        </div>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button intent="primary" onClick={onClose}>
            {t('common.ok')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
