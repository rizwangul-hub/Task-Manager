import React from 'react';

export const PageContainer = ({
  title,
  subtitle,
  actions,
  badge,
  children,
  className = ''
}) => {
  return (
    <div className={`page-container ${className}`}>
      {(title || actions || subtitle) && (
        <header className="page-header">
          <div className="page-header-main">
            <div className="page-title-row">
              {title && <h1 className="page-title">{title}</h1>}
              {badge && <div className="page-header-badge">{badge}</div>}
            </div>
            {subtitle && <p className="page-subtitle">{subtitle}</p>}
          </div>

          {actions && (
            <div className="page-header-actions">
              {actions}
            </div>
          )}
        </header>
      )}

      <main className="page-body">
        {children}
      </main>
    </div>
  );
};

export default PageContainer;
