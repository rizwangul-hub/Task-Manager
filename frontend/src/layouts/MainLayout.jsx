import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/navigation/Sidebar';
import TopNav from '../components/navigation/TopNav';
import { ToastContainer } from '../components/ui/Toast';
import { healthService } from '../services/healthService';

export const MainLayout = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [apiStatus, setApiStatus] = useState({ status: 'checking', isConnected: false });

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
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      <div className={`app-main-layout ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <TopNav
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          apiStatus={apiStatus}
        />

        <main className="app-content-area" role="main">
          <Outlet context={{ apiStatus }} />
        </main>
      </div>

      <ToastContainer />
    </div>
  );
};

export default MainLayout;
