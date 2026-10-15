import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AuthContext } from './authContextDef';
import { authService } from '../services/authService';

const normalizeRole = (role) => ({
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  EMPLOYEE: 'Member'
}[role] || role);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check current session on application mount
  const checkSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authService.getMe();
      setUser(response.data.user);
    } catch (err) {
      // If getMe fails, try refreshing the session
      try {
        const refreshResponse = await authService.refresh();
        setUser(refreshResponse.data.user);
      } catch {
        setUser(null);
        // If DB is offline, capture that diagnostic message
        if (err.status === 503) {
          setError(err.message);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    const handleSessionExpired = () => {
      setUser(null);
    };

    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => {
      window.removeEventListener('auth:session-expired', handleSessionExpired);
    };
  }, []);

  const login = useCallback(async (email, password) => {
    setError(null);
    try {
      const response = await authService.login(email, password);
      setUser(response.data.user);
      return response.data.user;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch (err) {
      console.warn('Logout API warning:', err);
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => {
      const role = normalizeRole(user?.role);
      const canManageBoard = () => role === 'Admin' || role === 'Manager';
      const canEditTask = (task) => {
        if (canManageBoard()) return true;
        if (role !== 'Member' || !task) return false;
        const userId = user?._id?.toString();
        return Boolean(userId && task.assignees?.some((assignee) =>
          (assignee?._id || assignee)?.toString() === userId
        ));
      };

      return {
        user,
        currentUser: user,
        role,
        loading,
        error,
        login,
        logout,
        checkSession,
        canManageBoard,
        canEditTask,
        isAuthenticated: Boolean(user),
        isAdmin: role === 'Admin',
        isManager: role === 'Manager',
        isEmployee: role === 'Member'
      };
    },
    [user, loading, error, login, logout, checkSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthProvider;
