import React from 'react';
import Button from './Button';

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionIcon,
  secondaryActionLabel,
  onSecondaryAction,
  className = ''
}) => {
  return (
    <div className={`empty-state-card ${className}`}>
      {Icon && (
        <div className="empty-state-icon-container">
          <Icon size={36} className="empty-state-icon" />
        </div>
      )}
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      
      {(actionLabel || secondaryActionLabel) && (
        <div className="empty-state-actions">
          {actionLabel && onAction && (
            <Button
              variant="primary"
              size="md"
              icon={actionIcon}
              onClick={onAction}
            >
              {actionLabel}
            </Button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <Button
              variant="outline"
              size="md"
              onClick={onSecondaryAction}
            >
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
