import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import Button from './Button';

export const ErrorState = ({
  title = 'Something went wrong',
  message = 'An unexpected error occurred while communicating with the server.',
  suggestion = 'Please verify your backend connection or try again.',
  onRetry,
  retryLabel = 'Retry Connection',
  className = ''
}) => {
  return (
    <div className={`error-state-card ${className}`} role="alert">
      <div className="error-state-icon-container">
        <AlertCircle size={36} className="error-state-icon" />
      </div>
      <h3 className="error-state-title">{title}</h3>
      <p className="error-state-message">{message}</p>
      {suggestion && <p className="error-state-suggestion">{suggestion}</p>}
      
      {onRetry && (
        <div className="error-state-actions">
          <Button
            variant="outline"
            size="md"
            icon={RotateCcw}
            onClick={onRetry}
          >
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  );
};

export default ErrorState;
