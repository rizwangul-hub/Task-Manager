import React from 'react';
import { Loader2 } from 'lucide-react';

export const Button = ({
  children,
  type = 'button',
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled = false,
  icon: Icon,
  iconPosition = 'left',
  className = '',
  onClick,
  ...rest
}) => {
  const isDisabled = disabled || isLoading;

  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size} ${className}`}
      disabled={isDisabled}
      onClick={onClick}
      {...rest}
    >
      {isLoading && <Loader2 size={16} className="btn-spinner" />}
      {!isLoading && Icon && iconPosition === 'left' && <Icon size={16} className="btn-icon left" />}
      <span className="btn-text">{children}</span>
      {!isLoading && Icon && iconPosition === 'right' && <Icon size={16} className="btn-icon right" />}
    </button>
  );
};

export default Button;
