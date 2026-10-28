import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/navigation/Sidebar';
import TopNav from '../components/navigation/TopNav';
import { ToastContainer } from '../components/ui/Toast';
import { healthService } from '../services/healthService';
import { PanelTopOpen } from 'lucide-react';

export const MainLayout = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('task_manager_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const [isNavbarHidden, setIsNavbarHidden] = useState(() => {
    try {
      return localStorage.getItem('task_manager_navbar_hidden') === 'true';
    } catch {
      return false;
    }
  });

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [apiStatus, setApiStatus] = useState({ status: 'checking', isConnected: false });

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('task_manager_sidebar_collapsed', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const toggleNavbar = () => {
    setIsNavbarHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('task_manager_navbar_hidden', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Periodically verify API health without intrusive polling
  useEffect(() => {
    let isMounted = true;

    const checkHealth = async () => {
      try {
        const response = await healthService.getHealthStatus();
        if (isMounted) {
          setApiStatus({
            status: response.status,
            database: response.database,
            services: response.services,
            environment: response.environment
          });
        }
      } catch (err) {
        if (isMounted) {
          setApiStatus({
            status: 'offline',
            error: err.message
          });
        }
      }
    };

    checkHealth();
    // Re-check periodically every 5 minutes when tab is visible
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        checkHealth();
      }
    }, 300000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="app-shell">
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      <div
        className={`app-main-layout ${isSidebarCollapsed ? 'sidebar-collapsed' : ''} ${
          isNavbarHidden ? 'navbar-hidden' : ''
        }`}
      >
        {!isNavbarHidden && (
          <TopNav
            onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
            apiStatus={apiStatus}
            onToggleNavbar={toggleNavbar}
          />
        )}

        {isNavbarHidden && (
          <button
            type="button"
            className="floating-show-navbar-btn"
            onClick={toggleNavbar}
            title="Show Top Navbar"
            aria-label="Show Top Navbar"
          >
            <PanelTopOpen size={14} />
            <span>Show Navbar</span>
          </button>
        )}

        <main className="app-content-area" role="main">
          <Outlet
            context={{
              apiStatus,
              isNavbarHidden,
              setIsNavbarHidden,
              toggleNavbar,
              isSidebarCollapsed,
              setIsSidebarCollapsed,
              toggleSidebar
            }}
          />
        </main>
      </div>

      <ToastContainer />
    </div>
  );
};

export default MainLayout;
