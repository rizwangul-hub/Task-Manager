import React from 'react';

export const StatCard = ({
  title,
  value,
  icon: Icon,
  variant = 'default',
  description,
  badgeText,
  isSetupState = false,
  className = ''
}) => {
  return (
    <div className={`stat-card stat-card-${variant} ${className}`}>
      <div className="stat-card-header">
        <span className="stat-card-title">{title}</span>
        {Icon && (
          <div className={`stat-icon-wrapper stat-icon-${variant}`}>
            <Icon size={20} />
          </div>
        )}
      </div>

      <div className="stat-card-body">
        <div className="stat-card-value-row">
          <span className="stat-card-value">{value}</span>
          {badgeText && <span className={`stat-card-badge badge-${variant}`}>{badgeText}</span>}
        </div>
        {description && (
          <p className={`stat-card-description ${isSetupState ? 'setup-hint' : ''}`}>
            {description}
          </p>
        )}
      </div>
    </div>
  );
};

export default StatCard;
