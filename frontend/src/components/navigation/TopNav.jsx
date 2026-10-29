import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { useNotifications } from '../../hooks/useNotifications';
import { formatRelativeTime } from '../../utils/date';
import {
  Menu,
  Search,
  Bell,
  User,
  Shield,
  CheckCircle2,
  X,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';

export const TopNav = ({ onOpenMobileSidebar, apiStatus, isSidebarHidden, onToggleSidebar }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, role, logout } = useAuth();
  const { toast } = useToast();
  const {
    unreadCount,
    recentNotifications,
    fetchRecentNotifications,
    markAsRead,
    markAllAsRead
  } = useNotifications();

  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const notificationRef = useRef(null);
  const userMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const routeTitles = {
    '/': 'Dashboard',
    '/my-work': 'My Work',
    '/all-tasks': 'All Tasks',
    '/projects': 'Projects',
    '/calendar': 'Calendar',
    '/reports': 'Reports & Analytics',
    '/notifications': 'Notifications',
    '/settings': 'System Settings'
  };

  const currentTitle = routeTitles[location.pathname] || 'Workspace';

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      navigate(`/all-tasks?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.info('You have been signed out.');
      navigate('/login');
    } catch {
      toast.error('Failed to sign out. Please try again.');
    }
  };

  const handleBackToPortal = () => {
    const PORTAL_URL = 'https://pixxtech.vercel.app';

    // If inside Central Portal iframe, notify parent portal and redirect the main window
    if (window.top && window.top !== window.self) {
      try {
        window.top.postMessage('PIXXTECH_RETURN', '*');
        window.top.location.href = PORTAL_URL;
      } catch (e) {
        window.location.href = PORTAL_URL;
      }
    } else {
      // If opened directly in a browser tab
      window.location.href = PORTAL_URL;
    }
  };

  return (
    <header className="app-header">
      <div className="header-left">
        <button
          type="button"
          className="mobile-menu-btn mobile-only"
          onClick={onOpenMobileSidebar}
          aria-label="Open mobile navigation menu"
        >
          <Menu size={20} />
        </button>

        <button
          type="button"
          className={`sidebar-toggle-navbar-btn desktop-only ${isSidebarHidden ? 'is-collapsed' : ''}`}
          onClick={onToggleSidebar}
          title={isSidebarHidden ? "Show Sidebar" : "Hide Sidebar"}
          aria-label={isSidebarHidden ? "Show Sidebar" : "Hide Sidebar"}
        >
          {isSidebarHidden ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          <span className="sidebar-toggle-label">{isSidebarHidden ? 'Show Sidebar' : 'Hide Sidebar'}</span>
        </button>

        <div className="breadcrumb-trail">
          <span className="breadcrumb-root">Task Manager</span>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current">{currentTitle}</span>
        </div>
      </div>

      <div className="header-center">
        <div className="search-bar-container">
          <Search size={16} className="search-icon" />
          <input
            type="search"
            className="search-input"
            placeholder="Search tasks, project keys, or assignments (press Enter)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            aria-label="Search tasks"
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="header-right">
        {/* Backend Connectivity Status Indicator */}
        <div className="api-status-pill" title={`API Status: ${apiStatus?.status || 'connecting'}`}>
          <span className={`status-indicator-dot ${apiStatus?.status === 'healthy' ? 'healthy' : apiStatus?.status === 'degraded' ? 'degraded' : 'offline'}`} />
          <span className="api-status-text desktop-only">
            {apiStatus?.status === 'healthy' ? 'API Online' : apiStatus?.status === 'degraded' ? 'API (DB Offline)' : 'API Offline'}
          </span>
        </div>

        {/* Notifications Dropdown */}
        <div className="header-menu-container" ref={notificationRef}>
          <button
            type="button"
            className={`header-icon-btn ${showNotifications ? 'active' : ''}`}
            onClick={() => {
              const nextState = !showNotifications;
              setShowNotifications(nextState);
              setShowUserMenu(false);
              if (nextState) {
                fetchRecentNotifications();
              }
            }}
            aria-label={`Notifications (${unreadCount} unread)`}
            aria-expanded={showNotifications}
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="notification-badge-dot" aria-label={`${unreadCount} unread`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="header-dropdown-panel notification-dropdown" role="dialog" aria-label="Notifications Panel">
              <div className="dropdown-panel-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h4 className="dropdown-panel-title">Notifications</h4>
                  <span className="dropdown-tag">{unreadCount} Unread</span>
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    className="dropdown-action-text-btn"
                    onClick={markAllAsRead}
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <div className="dropdown-panel-body">
                {recentNotifications.length === 0 ? (
                  <div className="dropdown-empty-state">
                    <CheckCircle2 size={32} className="dropdown-empty-icon" />
                    <p className="dropdown-empty-title">All caught up!</p>
                    <p className="dropdown-empty-subtitle">
                      You will be notified when tasks are assigned to you or deadlines are modified.
                    </p>
                  </div>
                ) : (
                  <div className="dropdown-notifications-list">
                    {recentNotifications.map((n) => (
                      <div
                        key={n._id}
                        className={`dropdown-notif-item ${!n.isRead ? 'unread' : ''}`}
                        onClick={() => {
                          if (!n.isRead) markAsRead(n._id);
                          setShowNotifications(false);
                          navigate('/notifications');
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="dropdown-notif-dot-wrap">
                          {!n.isRead && <span className="unread-dot" />}
                        </div>
                        <div className="dropdown-notif-content">
                          <p className="dropdown-notif-title">{n.title}</p>
                          <p className="dropdown-notif-message">{n.message}</p>
                          <span className="dropdown-notif-time">{formatRelativeTime(n.createdAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="dropdown-panel-footer">
                <button
                  type="button"
                  className="dropdown-view-all-btn"
                  onClick={() => {
                    setShowNotifications(false);
                    navigate('/notifications');
                  }}
                >
                  View all notifications &rarr;
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Back to Central Portal Button */}
        <button
          type="button"
          onClick={handleBackToPortal}
          className="back-to-portal-btn"
          aria-label="Back to PixxTech Central Portal"
          title="Return to PixxTech Central Portal"
        >
          <span className="portal-arrow">←</span>
          <span>PixxTech Portal</span>
        </button>

        {/* User Profile Menu */}
        <div className="header-menu-container" ref={userMenuRef}>
          <button
            type="button"
            className={`user-avatar-btn ${showUserMenu ? 'active' : ''}`}
            onClick={() => {
              setShowUserMenu(!showUserMenu);
              setShowNotifications(false);
            }}
            aria-label="User Account Menu"
            aria-expanded={showUserMenu}
          >
            <div className="avatar-placeholder">
              <User size={16} />
            </div>
            <span className="user-name desktop-only">{user?.name || 'Account'} ({role || 'Member'})</span>
          </button>

          {showUserMenu && (
            <div className="header-dropdown-panel user-dropdown" role="menu">
              <div className="dropdown-user-header">
                <div className="dropdown-avatar-circle">
                  <User size={20} />
                </div>
                <div className="dropdown-user-details">
                  <span className="dropdown-user-name">{user?.name || 'User'} ({role || 'Member'})</span>
                  <span className="dropdown-user-email">{user?.email}</span>
                </div>
              </div>

              <div className="dropdown-divider" />

              <div className="dropdown-meta-box">
                <Shield size={14} className="meta-icon" />
                <span>{role || 'Member'}</span>
              </div>

              <div className="dropdown-divider" />

              <button
                type="button"
                className="dropdown-portal-action"
                onClick={handleBackToPortal}
              >
                <span style={{ fontSize: '14px', lineHeight: 1 }}>←</span>
                <span>PixxTech Central Portal</span>
              </button>

              <button
                type="button"
                className="dropdown-logout-action"
                onClick={handleLogout}
              >
                <LogOut size={16} />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default TopNav;
