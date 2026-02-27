import React from 'react';
import { Dialog, Classes, Button } from '@blueprintjs/core';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCancel?: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  intent?: 'primary' | 'success' | 'warning' | 'danger';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  onCancel,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  intent = 'primary',
}) => {
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    onClose();
  };

  const getIcon = () => {
    switch (intent) {
      case 'danger':
        return 'error';
      case 'warning':
        return 'warning-sign';
      case 'success':
        return 'tick';
      default:
        return 'info-sign';
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={getIcon()}
      className="confirm-dialog"
    >
      <div className={Classes.DIALOG_BODY}>
        <p style={{ whiteSpace: 'pre-wrap' }}>{message}</p>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={handleCancel}>{cancelText}</Button>
          <Button intent={intent} onClick={handleConfirm}>
            {confirmText}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
