import React, { useState, useEffect, useCallback } from 'react';
import { NotificationContext } from './notificationContextDef';
import { notificationService } from '../services/notificationService';
import { socketService } from '../services/socket';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

export const NotificationProvider = ({ children }) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [unreadCount, setUnreadCount] = useState(0);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchUnreadCount = useCallback(async () => {
    if (!user?._id) return;
    try {
      const res = await notificationService.getUnreadCount();
      setUnreadCount(res.data.unreadCount || 0);
    } catch {
      // Ignore background unread check errors silently
    }
  }, [user?._id]);

  const fetchRecentNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await notificationService.getNotifications({ limit: 5 });
      setRecentNotifications(res.data.notifications || []);
      setUnreadCount(res.data.unreadCount || 0);
    } catch {
      // Fail gracefully
    } finally {
      setLoading(false);
    }
  }, [user]);

  const markAsRead = async (id) => {
    try {
      await notificationService.markAsRead(id);
      setRecentNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      toast.error(err.message || 'Failed to mark notification as read.');
    }
  };

  const markAllAsRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setRecentNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
      toast.success('All notifications marked as read.');
    } catch (err) {
      toast.error(err.message || 'Failed to mark all as read.');
    }
  };

  const deleteNotification = async (id) => {
    try {
      await notificationService.deleteNotification(id);
      const target = recentNotifications.find((n) => n._id === id);
      if (target && !target.isRead) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
      setRecentNotifications((prev) => prev.filter((n) => n._id !== id));
      toast.success('Notification removed.');
    } catch (err) {
      toast.error(err.message || 'Failed to remove notification.');
    }
  };

  // Socket and Polling lifecycle
  useEffect(() => {
    if (!user) {
      socketService.disconnect();
      setUnreadCount(0);
      setRecentNotifications([]);
      return;
    }

    // Connect WebSocket
    const socket = socketService.connect();

    const handleNewNotification = (notif) => {
      setUnreadCount((prev) => prev + 1);
      setRecentNotifications((prev) => [notif, ...prev.slice(0, 4)]);
      toast.info(notif.title);
    };

    if (socket) {
      socket.on('notification:new', handleNewNotification);
    }

    // Initial count fetch
    fetchUnreadCount();

    // Fallback sync every 3 minutes when tab is active
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchUnreadCount();
      }
    }, 180000);

    return () => {
      if (socket) {
        socket.off('notification:new', handleNewNotification);
      }
      clearInterval(interval);
    };
  }, [user?._id, fetchUnreadCount]);

  const value = {
    unreadCount,
    recentNotifications,
    loading,
    fetchUnreadCount,
    fetchRecentNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export default NotificationProvider;
