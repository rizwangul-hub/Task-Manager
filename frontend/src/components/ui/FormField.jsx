import React from 'react';

export const FormField = ({
  id,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  error,
  helperText,
  required = false,
  disabled = false,
  as = 'input',
  children,
  className = '',
  ...rest
}) => {
  const Component = as;
  const generatedId = React.useId();
  const fieldId = id || generatedId;
  const customControl =
    React.isValidElement(children) &&
    typeof children.type === 'string' &&
    ['input', 'select', 'textarea'].includes(children.type);

  return (
    <div className={`form-field-group ${error ? 'has-error' : ''} ${className}`}>
      {label && (
        <label htmlFor={fieldId} className="form-label">
          {label}
          {required && <span className="required-mark" aria-hidden="true">*</span>}
        </label>
      )}

      {customControl ? (
        React.cloneElement(children, {
          id: children.props.id || fieldId,
          'aria-invalid': Boolean(error),
          'aria-describedby': error ? `${fieldId}-error` : helperText ? `${fieldId}-helper` : undefined
        })
      ) : (
        <Component
          id={fieldId}
          type={as === 'input' ? type : undefined}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className={`form-control ${as === 'textarea' ? 'form-textarea' : ''} ${as === 'select' ? 'form-select' : ''}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${fieldId}-error` : helperText ? `${fieldId}-helper` : undefined}
          {...rest}
        >
          {children}
        </Component>
      )}

      {error ? (
        <p id={`${fieldId}-error`} className="form-error-message" role="alert">
          {error}
        </p>
      ) : helperText ? (
        <p id={`${fieldId}-helper`} className="form-helper-text">
          {helperText}
        </p>
      ) : null}
    </div>
  );
};

export default FormField;
