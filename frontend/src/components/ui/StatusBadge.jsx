import React from 'react';

export const StatusBadge = ({
  status,
  label,
  size = 'md',
  dot = true,
  className = ''
}) => {
  const normalized = (status || 'default').toLowerCase().replace(/\s+/g, '_');

  const labelMap = {
    pending: 'Pending',
    in_progress: 'In Progress',
    completed: 'Completed',
    overdue: 'Overdue',
    active: 'Active',
    archived: 'Archived',
    healthy: 'Healthy',
    degraded: 'Degraded',
    offline: 'Offline'
  };

  const displayText = label || labelMap[normalized] || status;

  return (
    <span className={`status-badge badge-${normalized} badge-${size} ${className}`}>
      {dot && <span className="status-badge-dot" />}
      <span className="status-badge-label">{displayText}</span>
    </span>
  );
};

export default StatusBadge;
