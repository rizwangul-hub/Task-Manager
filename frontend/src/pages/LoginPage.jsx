import React, { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import FormField from '../components/ui/FormField';
import Button from '../components/ui/Button';
import PwaInstallCard from '../components/pwa/PwaInstallCard';
import { Sparkles, Eye, EyeOff, LogIn, AlertCircle, Server } from 'lucide-react';

export const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated } = useAuth();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [isDbOffline, setIsDbOffline] = useState(false);

  // If already authenticated, redirect to target or home
  const from = location.state?.from?.pathname || '/';
  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setIsDbOffline(false);

    if (!email.trim() || !password) {
      setFormError('Please enter both your email address and password.');
      return;
    }

    setLoading(true);
    try {
      await login(email, password);
      toast.success('Signed in successfully.');
      navigate(from, { replace: true });
    } catch (err) {
      if (err.status === 503) {
        setIsDbOffline(true);
        setFormError('Database service is currently offline. Ensure MongoDB is running and MONGODB_URI is configured in backend/.env.');
      } else {
        setFormError(err.message || 'Invalid email or password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen-container">
      <div className="login-card">
        {/* Brand Header */}
        <div className="login-header">
          <div className="login-logo-mark">
            <img src="/logo.png" alt="Task Manager Logo" className="login-logo-img" />
          </div>
          <h1 className="login-brand-title">Task Manager</h1>
          <p className="login-brand-subtitle">by PixxTechnologies</p>
        </div>

        {/* Database Offline Notice */}
        {isDbOffline && (
          <div className="login-db-notice" role="alert">
            <Server size={18} className="db-notice-icon" />
            <div className="db-notice-text">
              <strong>Database Connection Required</strong>
              <p>
                The server is running, but MongoDB is not connected. Configure <code>MONGODB_URI</code> in <code>backend/.env</code> and run <code>npm run seed:owner</code> to initialize your account.
              </p>
            </div>
          </div>
        )}

        {/* Standard Error Notice */}
        {formError && !isDbOffline && (
          <div className="login-error-notice" role="alert">
            <AlertCircle size={18} className="error-notice-icon" />
            <span>{formError}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <FormField
            id="login-email"
            label="Work Email Address"
            type="email"
            placeholder="e.g. manager@pixxtechnologiees.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          <div className="password-field-wrapper">
            <FormField
              id="login-password"
              label="Password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            <button
              type="button"
              className="password-toggle-btn"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            icon={LogIn}
            isLoading={loading}
            className="login-submit-btn"
          >
            Sign In
          </Button>
        </form>

        <PwaInstallCard />

        <div className="login-footer">
          <p className="login-security-notice">
            Private single-user workspace. Public registration and external account creation are disabled.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
