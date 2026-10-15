import React from 'react';
import { Loader2 } from 'lucide-react';

export const LoadingState = ({ message = 'Loading...', fullPage = false, className = '' }) => {
  return (
    <div className={`loading-state-container ${fullPage ? 'full-page' : ''} ${className}`}>
      <Loader2 size={32} className="loading-spinner" />
      <span className="loading-message">{message}</span>
    </div>
  );
};

export default LoadingState;
