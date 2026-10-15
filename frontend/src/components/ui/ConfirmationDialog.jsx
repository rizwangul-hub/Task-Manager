import React from 'react';
import Modal from './Modal';
import Button from './Button';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';

export const ConfirmationDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false
}) => {
  const iconMap = {
    danger: <AlertCircle size={24} className="confirmation-icon danger" />,
    warning: <AlertTriangle size={24} className="confirmation-icon warning" />,
    info: <Info size={24} className="confirmation-icon info" />
  };

  const footer = (
    <>
      <Button
        variant="ghost"
        onClick={onClose}
        disabled={isLoading}
      >
        {cancelLabel}
      </Button>
      <Button
        variant={variant === 'danger' ? 'danger' : 'primary'}
        onClick={onConfirm}
        isLoading={isLoading}
      >
        {confirmLabel}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={footer}
      maxWidth="480px"
    >
      <div className="confirmation-dialog-content">
        <div className="confirmation-icon-container">
          {iconMap[variant] || iconMap.info}
        </div>
        <div className="confirmation-text">
          <p>{message}</p>
        </div>
      </div>
    </Modal>
  );
};

export default ConfirmationDialog;
