import React, { useState, useEffect, useCallback } from 'react';
import PageContainer from '../components/layout/PageContainer';
import Button from '../components/ui/Button';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import TaskDetailsModal from '../components/tasks/TaskDetailsModal';
import { notificationService } from '../services/notificationService';
import { useNotifications } from '../hooks/useNotifications';
import { useToast } from '../hooks/useToast';
import { formatRelativeTime, formatDateTime } from '../utils/date';
import {
  Bell,
  CheckCircle2,
  Trash2,
  Check,
  Clock,
  MessageSquare,
  AlertTriangle,
  FolderKanban,
  CheckSquare,
  Eye,
  RefreshCw
} from 'lucide-react';

export const NotificationsPage = () => {
  const { unreadCount: globalUnreadCount, fetchUnreadCount } = useNotifications();
  const { toast } = useToast();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Selected Task for Details Modal
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [isTaskDetailsOpen, setIsTaskDetailsOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await notificationService.getNotifications({
        page,
        limit: 15,
        unread: unreadOnly ? 'true' : undefined
      });
      setNotifications(res.data.notifications || []);
      setTotalPages(res.data.pagination?.pages || 1);
      setTotalCount(res.data.pagination?.total || 0);
      fetchUnreadCount();
    } catch (err) {
      setError(err.message || 'Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  }, [page, unreadOnly, fetchUnreadCount]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAsRead = async (id) => {
    try {
      await notificationService.markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, isRead: true } : n))
      );
      fetchUnreadCount();
      toast.success('Marked as read.');
    } catch (err) {
      toast.error(err.message || 'Failed to mark as read.');
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      fetchUnreadCount();
      toast.success('All notifications marked as read.');
    } catch (err) {
      toast.error(err.message || 'Failed to mark all as read.');
    }
  };

  const handleDelete = async (id) => {
    try {
      await notificationService.deleteNotification(id);
      setNotifications((prev) => prev.filter((n) => n._id !== id));
      setTotalCount((prev) => Math.max(0, prev - 1));
      fetchUnreadCount();
      toast.success('Notification deleted.');
    } catch (err) {
      toast.error(err.message || 'Failed to delete notification.');
    }
  };

  const handleOpenTask = (taskId) => {
    if (!taskId) return;
    setSelectedTaskId(taskId);
    setIsTaskDetailsOpen(true);
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'TASK_ASSIGNED':
      case 'TASK_UNASSIGNED':
        return <CheckSquare size={18} className="notif-type-icon assigned" />;
      case 'TASK_STATUS_CHANGED':
        return <RefreshCw size={18} className="notif-type-icon status" />;
      case 'TASK_COMMENT_ADDED':
        return <MessageSquare size={18} className="notif-type-icon comment" />;
      case 'TASK_OVERDUE':
        return <AlertTriangle size={18} className="notif-type-icon overdue" />;
      case 'TASK_UPCOMING_DUE':
      case 'TASK_DUE_DATE_CHANGED':
        return <Clock size={18} className="notif-type-icon due" />;
      case 'PROJECT_MEMBER_ADDED':
      case 'PROJECT_MEMBER_REMOVED':
        return <FolderKanban size={18} className="notif-type-icon project" />;
      default:
        return <Bell size={18} className="notif-type-icon default" />;
    }
  };

  const headerActions = (
    <div style={{ display: 'flex', gap: '8px' }}>
      {globalUnreadCount > 0 && (
        <Button
          variant="secondary"
          size="sm"
          icon={Check}
          onClick={handleMarkAllAsRead}
        >
          Mark all as read
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        icon={RefreshCw}
        onClick={fetchNotifications}
        aria-label="Refresh notifications"
      />
    </div>
  );

  return (
    <PageContainer
      title="Notifications Center"
      subtitle="Centralized operational activity inbox for task assignments, discussions, and deadlines."
      badge={<StatusBadge status="active" label={`${globalUnreadCount} Unread`} />}
      actions={headerActions}
    >
      {/* Tabs Filter Bar */}
      <div className="mywork-tabs-bar">
        <button
          type="button"
          className={`tab-btn ${!unreadOnly ? 'active' : ''}`}
          onClick={() => {
            setUnreadOnly(false);
            setPage(1);
          }}
        >
          All Notifications ({!unreadOnly ? totalCount : 'All'})
        </button>

        <button
          type="button"
          className={`tab-btn ${unreadOnly ? 'active' : ''}`}
          onClick={() => {
            setUnreadOnly(true);
            setPage(1);
          }}
        >
          Unread Only ({globalUnreadCount})
        </button>
      </div>

      {/* Main Content */}
      {loading && <LoadingState message="Loading notifications..." />}

      {error && (
        <ErrorState
          title="Could not load notifications"
          message={error}
          onRetry={fetchNotifications}
        />
      )}

      {!loading && !error && notifications.length === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title={unreadOnly ? 'No Unread Notifications' : 'Notification Inbox is Empty'}
          description={
            unreadOnly
              ? 'You have caught up with all your notifications. Switch to "All Notifications" to review past events.'
              : 'You will receive real-time notifications for task reminders, upcoming deadlines, status changes, and system updates.'
          }
        />
      )}

      {!loading && !error && notifications.length > 0 && (
        <div className="notifications-list-container">
          <div className="notifications-cards-list">
            {notifications.map((n) => (
              <div
                key={n._id}
                className={`notification-card ${!n.isRead ? 'unread' : ''}`}
              >
                <div className="notification-icon-container">
                  {getNotificationIcon(n.type)}
                </div>

                <div className="notification-card-body">
                  <div className="notification-card-header">
                    <h4 className="notification-title">{n.title}</h4>
                    <span className="notification-time-relative" title={formatDateTime(n.createdAt)}>
                      {formatRelativeTime(n.createdAt)}
                    </span>
                  </div>

                  <p className="notification-message">{n.message}</p>

                  <div className="notification-meta-tags">
                    {n.task && (
                      <button
                        type="button"
                        className="notif-pill-btn"
                        onClick={() => handleOpenTask(n.task._id || n.task)}
                        title="View deliverable details"
                      >
                        <Eye size={13} />
                        <span>Task: {n.task.taskKey || 'Details'}</span>
                      </button>
                    )}

                    {n.project && (
                      <span className="notif-project-tag">
                        <FolderKanban size={13} />
                        <span>{n.project.name || 'Project'}</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="notification-card-actions">
                  {!n.isRead && (
                    <button
                      type="button"
                      className="icon-action-btn read-btn"
                      onClick={() => handleMarkAsRead(n._id)}
                      title="Mark as read"
                    >
                      <Check size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-action-btn delete-btn"
                    onClick={() => handleDelete(n._id)}
                    title="Delete notification"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="pagination-bar">
              <span className="text-sm text-muted">
                Page {page} of {totalPages} ({totalCount} total)
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Task Details Modal */}
      <TaskDetailsModal
        isOpen={isTaskDetailsOpen}
        taskId={selectedTaskId}
        onClose={() => setIsTaskDetailsOpen(false)}
        onTaskUpdated={fetchNotifications}
      />
    </PageContainer>
  );
};

export default NotificationsPage;
