import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  LayoutDashboard,
  CheckSquare,
  ListTodo,
  FolderKanban,
  ContactRound,
  Calendar,
  BarChart3,
  Bell,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Inbox
} from 'lucide-react';

export const Sidebar = ({
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile
}) => {
  const { user } = useAuth();

  const navItems = [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard },
    { label: 'My Work', path: '/my-work', icon: CheckSquare },
    { label: 'All Tasks', path: '/all-tasks', icon: ListTodo },
    { label: 'WhatsApp Inbox', path: '/whatsapp-inbox', icon: Inbox },
    { label: 'Projects', path: '/projects', icon: FolderKanban },
    { label: 'Contacts', path: '/contacts', icon: ContactRound },
    { label: 'Calendar', path: '/calendar', icon: Calendar },
    { label: 'Reports', path: '/reports', icon: BarChart3 },
    { label: 'Notifications', path: '/notifications', icon: Bell },
    { label: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isMobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`app-sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}
        aria-label="Sidebar Navigation"
      >
        <div className="sidebar-brand">
          <div className="brand-logo-container">
            <div className="brand-logo-mark">
              <Sparkles size={20} className="brand-logo-icon" />
            </div>
            {!isCollapsed && (
              <div className="brand-info">
                <span className="brand-title">Task Manager</span>
                <span className="brand-subtitle">by PixxTechnologies</span>
              </div>
            )}
          </div>

          <button
            type="button"
            className="sidebar-collapse-btn desktop-only"
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group-title">{!isCollapsed && 'WORKSPACE'}</div>
          <ul className="nav-list">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.path} className="nav-item">
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      if (isMobileOpen && onCloseMobile) {
                        onCloseMobile();
                      }
                    }}
                    title={isCollapsed ? item.label : undefined}
                  >
                    <Icon size={18} className="nav-icon" />
                    {!isCollapsed && <span className="nav-label">{item.label}</span>}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div className="workspace-badge">
            <div className="workspace-dot" />
            {!isCollapsed && (
              <div className="workspace-text">
                <span className="workspace-name">Private Workspace</span>
                <span className="workspace-phase">Single User</span>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
