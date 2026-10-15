import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import ProtectedRoute from './components/navigation/ProtectedRoute';
import MainLayout from './layouts/MainLayout';
import LoginPage from './pages/LoginPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import DashboardPage from './pages/DashboardPage';
import MyWorkPage from './pages/MyWorkPage';
import AllTasksPage from './pages/AllTasksPage';
import ProjectsPage from './pages/ProjectsPage';
import CalendarPage from './pages/CalendarPage';
import ReportsPage from './pages/ReportsPage';
import NotificationsPage from './pages/NotificationsPage';
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';
import { Navigate } from 'react-router-dom';

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <NotificationProvider>
          <BrowserRouter>
            <Routes>
              {/* Public authentication route */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/unauthorized" element={<UnauthorizedPage />} />

              {/* Protected Application Workspace */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <MainLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="my-work" element={<MyWorkPage />} />
                <Route path="all-tasks" element={<AllTasksPage />} />
                <Route path="projects" element={<ProjectsPage />} />
                <Route path="calendar" element={<CalendarPage />} />
                <Route path="team" element={<Navigate to="/all-tasks" replace />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </NotificationProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
