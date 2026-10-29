import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/navigation/Sidebar';
import TopNav from '../components/navigation/TopNav';
import { ToastContainer } from '../components/ui/Toast';
import { healthService } from '../services/healthService';

export const MainLayout = () => {
  const [isSidebarHidden, setIsSidebarHidden] = useState(() => {
    try {
      return localStorage.getItem('task_manager_sidebar_hidden') === 'true';
    } catch {
      return false;
    }
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [apiStatus, setApiStatus] = useState({ status: 'checking', isConnected: false });

  const toggleSidebarHidden = () => {
    setIsSidebarHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('task_manager_sidebar_hidden', String(next));
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
    <div className={`app-shell ${isSidebarHidden ? 'layout-sidebar-hidden' : ''}`}>
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        isHidden={isSidebarHidden}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      <div className={`app-main-layout ${isSidebarCollapsed ? 'sidebar-collapsed' : ''} ${isSidebarHidden ? 'sidebar-hidden' : ''}`}>
        <TopNav
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          apiStatus={apiStatus}
          isSidebarHidden={isSidebarHidden}
          onToggleSidebar={toggleSidebarHidden}
        />

        <main className={`app-content-area ${isSidebarHidden ? 'content-sidebar-hidden' : ''}`} role="main">
          <Outlet context={{ apiStatus, isSidebarHidden, toggleSidebar: toggleSidebarHidden }} />
        </main>
      </div>

      <ToastContainer />
    </div>
  );
};

export default MainLayout;
