import React from 'react';
import { Dialog, Classes, Button } from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutDialog: React.FC<AboutDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('dialog.about.title')}
      icon="info-sign"
      className="about-dialog"
    >
      <div className={Classes.DIALOG_BODY}>
        <div className="about-content">
          <h2 className="about-title">Database Workbench</h2>
          <p className="about-version">{t('dialog.about.version', { version: '0.1.0' })}</p>
          <p className="about-description">
            {t('dialog.about.description')}
          </p>
          <div className="about-divider" />
          <div className="about-info">
            <p><strong>{t('dialog.about.techStack')}:</strong> Tauri + React + TypeScript</p>
            <p><strong>{t('dialog.about.uiLibrary')}:</strong> BlueprintJS</p>
            <p><strong>{t('dialog.about.license')}:</strong> MIT License</p>
          </div>
          <div className="about-copyright">
            <p>{t('dialog.about.copyright')}</p>
          </div>
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
