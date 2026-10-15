import React, { useState, useEffect, useCallback } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import LoadingState from '../ui/LoadingState';
import EmptyState from '../ui/EmptyState';
import ErrorState from '../ui/ErrorState';
import StatusBadge from '../ui/StatusBadge';
import { taskService } from '../../services/taskService';
import { userService } from '../../services/userService';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { formatWhatsAppNumber } from '../../utils/phone';
import {
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatMinutesToHours,
  formatBytes,
  isTaskOverdue
} from '../../utils/date';
import {
  Info,
  History,
  MessageSquare,
  Paperclip,
  Clock,
  Send,
  Trash2,
  UploadCloud,
  FileText,
  ExternalLink,
  FolderKanban,
  AlertCircle,
  X
} from 'lucide-react';

export const TaskDetailsModal = ({
  isOpen,
  onClose,
  taskId,
  onTaskUpdated,
  initialTab = 'overview'
}) => {
  const { user, canEditTask, canManageBoard } = useAuth();
  const canManage = canManageBoard();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState('overview');
  const [task, setTask] = useState(null);
  const [whatsappNotifications, setWhatsappNotifications] = useState([]);
  const [whatsappHistoryError, setWhatsappHistoryError] = useState('');
  const [retryingNotificationId, setRetryingNotificationId] = useState(null);
  const [loadingTask, setLoadingTask] = useState(false);
  const [taskError, setTaskError] = useState(null);

  // Activity Timeline State
  const [activity, setActivity] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [activityError, setActivityError] = useState(null);

  // Comments State
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);
  const [previewImage, setPreviewImage] = useState(null);

  // Attachments State
  const [uploadingFile, setUploadingFile] = useState(false);
  const [attachmentError, setAttachmentError] = useState(null);

  // Time Tracking State
  const [timeEntries, setTimeEntries] = useState([]);
  const [loadingTime, setLoadingTime] = useState(false);
  const [timeMinutes, setTimeMinutes] = useState('');
  const [timeDesc, setTimeDesc] = useState('');
  const [timeDate, setTimeDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [submittingTime, setSubmittingTime] = useState(false);

  // Fetch full task data
  const loadTask = useCallback(async () => {
    if (!taskId) return;
    setLoadingTask(true);
    setTaskError(null);
    try {
      const res = await taskService.getTaskById(taskId);
      setTask(res.data.task);
      setWhatsappNotifications(res.data.task.whatsappNotifications || []);
      setWhatsappHistoryError('');
    } catch (err) {
      setTaskError(err.message || 'Failed to load task details.');
    } finally {
      setLoadingTask(false);
    }
  }, [taskId]);

  const loadWhatsAppNotifications = useCallback(async () => {
    if (!taskId) return;
    try {
      const response = await taskService.getWhatsAppNotifications(taskId);
      setWhatsappNotifications(response.data.notifications || []);
      setWhatsappHistoryError('');
    } catch (error) {
      setWhatsappHistoryError(error.message || 'Could not refresh WhatsApp notification history.');
      throw error;
    }
  }, [taskId]);

  useEffect(() => {
    const isSending = whatsappNotifications.some(({ status }) =>
      status === 'pending' || status === 'processing' || status === 'server_ack'
    );
    if (!isOpen || !taskId || !isSending) return undefined;

    const timer = setInterval(() => {
      loadWhatsAppNotifications().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [isOpen, taskId, whatsappNotifications, loadWhatsAppNotifications]);

  const handleRetryWhatsAppNotification = async (notificationId) => {
    setRetryingNotificationId(notificationId);
    try {
      const response = await taskService.retryWhatsAppNotification(taskId, notificationId);
      setWhatsappNotifications((current) => current.map((notification) =>
        notification._id === notificationId ? response.data.notification : notification
      ));
      toast.success('WhatsApp notification retry queued.');
      await loadWhatsAppNotifications();
    } catch (err) {
      toast.error(err.message || 'Could not retry WhatsApp notification.');
    } finally {
      setRetryingNotificationId(null);
    }
  };

  // Fetch Activity
  const loadActivity = useCallback(async () => {
    if (!taskId) return;
    setLoadingActivity(true);
    setActivityError(null);
    try {
      const res = await taskService.getActivity(taskId);
      setActivity(res.data.activity || []);
    } catch (err) {
      setActivityError(err.message || 'Failed to load task activity timeline.');
    } finally {
      setLoadingActivity(false);
    }
  }, [taskId]);

  // Fetch Comments
  const loadComments = useCallback(async () => {
    if (!taskId) return;
    setLoadingComments(true);
    try {
      const res = await taskService.getComments(taskId);
      setComments(res.data.comments || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load task comments.');
    } finally {
      setLoadingComments(false);
    }
  }, [taskId, toast]);

  // Fetch Time Entries
  const loadTimeEntries = useCallback(async () => {
    if (!taskId) return;
    setLoadingTime(true);
    try {
      const res = await taskService.getTimeEntries(taskId);
      setTimeEntries(res.data.entries || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load time entries.');
    } finally {
      setLoadingTime(false);
    }
  }, [taskId, toast]);

  // Load task initially when modal opens
  useEffect(() => {
    if (isOpen && taskId) {
      loadTask();
      setActiveTab(initialTab);
    }
  }, [isOpen, taskId, loadTask, initialTab]);

  // Tab switch effect
  useEffect(() => {
    if (!isOpen || !taskId) return;
    if (activeTab === 'activity') loadActivity();
    if (activeTab === 'comments') loadComments();
    if (activeTab === 'time') loadTimeEntries();
  }, [activeTab, isOpen, taskId, loadActivity, loadComments, loadTimeEntries]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'comments' || teamMembers.length) return;
    userService.getUsers({ limit: 100, status: 'active' })
      .then((res) => setTeamMembers(res.data.users || []))
      .catch((err) => toast.error(err.message || 'Failed to load team members.'));
  }, [activeTab, isOpen, teamMembers.length, toast]);

  // Fast status switcher inside modal
  const handleStatusChange = async (newStatus) => {
    try {
      await taskService.changeStatus(taskId, newStatus);
      toast.success(`Status updated to ${newStatus}.`);
      setTask((prev) => (prev ? { ...prev, status: newStatus } : prev));
      if (onTaskUpdated) onTaskUpdated();
      if (activeTab === 'activity') loadActivity();
    } catch (err) {
      toast.error(err.message || 'Failed to update status.');
    }
  };

  // Add Comment
  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setSubmittingComment(true);
    try {
      const res = await taskService.createComment(taskId, newComment.trim());
      setComments((prev) => [...prev, res.data.comment]);
      setNewComment('');
      toast.success('Comment posted.');
      if (activeTab === 'activity') loadActivity();
    } catch (err) {
      toast.error(err.message || 'Failed to post comment.');
    } finally {
      setSubmittingComment(false);
    }
  };

  // Delete Comment
  const handleDeleteComment = async (commentId) => {
    try {
      await taskService.deleteComment(taskId, commentId);
      setComments((prev) => prev.filter((c) => c._id !== commentId));
      toast.success('Comment deleted.');
      if (activeTab === 'activity') loadActivity();
    } catch (err) {
      toast.error(err.message || 'Failed to delete comment.');
    }
  };

  // File Upload
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingFile(true);
    setAttachmentError(null);

    try {
      const res = await taskService.uploadAttachment(taskId, file);
      setTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          attachments: [...(prev.attachments || []), res.data.attachment]
        };
      });
      toast.success(`File "${file.name}" uploaded successfully.`);
      e.target.value = ''; // Reset input
      if (onTaskUpdated) onTaskUpdated();
      if (activeTab === 'activity') loadActivity();
    } catch (err) {
      const msg = err.message || 'Failed to upload attachment.';
      setAttachmentError(msg);
      toast.error(msg);
    } finally {
      setUploadingFile(false);
    }
  };

  const mentionQuery = newComment.match(/(?:^|\s)@([^\s@]*)$/)?.[1];
  const mentionMatches = mentionQuery === undefined
    ? []
    : teamMembers.filter((member) =>
      member.name?.toLowerCase().includes(mentionQuery.toLowerCase())
    ).slice(0, 5);

  const insertMention = (member) => {
    setNewComment((value) => value.replace(/(?:^|\s)@[^\s@]*$/, (match) => {
      const prefix = match.startsWith(' ') ? ' ' : '';
      return `${prefix}@${member.name} `;
    }));
  };

  // Delete Attachment
  const handleDeleteAttachment = async (attachmentId) => {
    try {
      await taskService.deleteAttachment(taskId, attachmentId);
      setTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          attachments: (prev.attachments || []).filter((a) => a._id !== attachmentId)
        };
      });
      toast.success('Attachment deleted.');
      if (onTaskUpdated) onTaskUpdated();
      if (activeTab === 'activity') loadActivity();
    } catch (err) {
      toast.error(err.message || 'Failed to remove attachment.');
    }
  };

  // Log Time
  const handleLogTime = async (e) => {
    e.preventDefault();
    const mins = parseInt(timeMinutes, 10);
    if (isNaN(mins) || mins < 1 || mins > 1440) {
      toast.error('Please enter a duration between 1 and 1440 minutes.');
      return;
    }

    setSubmittingTime(true);
    try {
      const res = await taskService.createTimeEntry(taskId, {
        durationMinutes: mins,
        description: timeDesc.trim(),
        date: timeDate
      });
      setTimeEntries((prev) => [res.data.entry, ...prev]);
      setTask((prev) => (prev ? { ...prev, totalTimeSpentMinutes: res.data.totalTimeSpentMinutes } : prev));
      setTimeMinutes('');
      setTimeDesc('');
      toast.success(`Logged ${formatMinutesToHours(mins)} of work.`);
      if (onTaskUpdated) onTaskUpdated();
      if (activeTab === 'activity') loadActivity();
    } catch (err) {
      toast.error(err.message || 'Failed to log time.');
    } finally {
      setSubmittingTime(false);
    }
  };

  // Delete Time Entry
  const handleDeleteTimeEntry = async (entryId) => {
    try {
      await taskService.deleteTimeEntry(taskId, entryId);
      const entryToDelete = timeEntries.find((e) => e._id === entryId);
      const freedMins = entryToDelete?.durationMinutes || 0;

      setTimeEntries((prev) => prev.filter((e) => e._id !== entryId));
      setTask((prev) => {
        if (!prev) return prev;
        const updated = Math.max(0, (prev.totalTimeSpentMinutes || 0) - freedMins);
        return { ...prev, totalTimeSpentMinutes: updated };
      });

      toast.success('Time entry deleted.');
      if (onTaskUpdated) onTaskUpdated();
      if (activeTab === 'activity') loadActivity();
    } catch (err) {
      toast.error(err.message || 'Failed to delete time entry.');
    }
  };

  // Helper to render action descriptions in activity timeline
  const renderEventDescription = (event) => {
    const { action, details } = event;
    switch (action) {
      case 'TASK_CREATED':
        return <span>Created task <strong>"{details?.title || 'Deliverable'}"</strong></span>;
      case 'STATUS_CHANGED':
        return (
          <span>
            Changed status from <span className="timeline-val">{details?.previousValue || 'None'}</span> to{' '}
            <span className="timeline-val highlight">{details?.newValue}</span>
          </span>
        );
      case 'PRIORITY_CHANGED':
        return (
          <span>
            Changed priority from <span className="timeline-val">{details?.previousValue}</span> to{' '}
            <span className="timeline-val highlight">{details?.newValue}</span>
          </span>
        );
      case 'DUE_DATE_CHANGED':
        return (
          <span>
            Updated due date to <span className="timeline-val highlight">{formatDate(details?.newValue)}</span>
          </span>
        );
      case 'ASSIGNMENT_CHANGED':
        return <span>Updated task assignees</span>;
      case 'COMMENT_ADDED':
        return <span>Added a discussion comment</span>;
      case 'COMMENT_DELETED':
        return <span>Removed a comment</span>;
      case 'ATTACHMENT_ADDED':
        return <span>Attached file <strong>{details?.fileName}</strong></span>;
      case 'ATTACHMENT_REMOVED':
        return <span>Removed file <strong>{details?.fileName}</strong></span>;
      case 'TIME_LOGGED':
        return (
          <span>
            Logged <strong>{formatMinutesToHours(details?.durationMinutes)}</strong> of work
            {details?.description ? `: "${details.description}"` : ''}
          </span>
        );
      case 'TIME_DELETED':
        return <span>Deleted time log ({formatMinutesToHours(details?.durationMinutes)})</span>;
      case 'TASK_ARCHIVED':
        return <span>Archived task</span>;
      case 'TASK_RESTORED':
        return <span>Restored task from archive</span>;
      case 'TASK_UPDATED':
      default:
        return <span>Updated task details</span>;
    }
  };

  if (!isOpen) return null;

  const overdue = task && isTaskOverdue(task.dueDate, task.status);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        task ? (
          <div className="task-modal-header-title">
            <span className="task-id-badge">{task.taskKey}</span>
            <span className="task-modal-name">{task.title}</span>
          </div>
        ) : (
          'Task Details'
        )
      }
      maxWidth="780px"
      className="task-details-modal"
    >
      {loadingTask && <LoadingState message="Loading task details..." />}

      {taskError && (
        <ErrorState
          title="Could not open task"
          message={taskError}
          onRetry={loadTask}
        />
      )}

      {!loadingTask && !taskError && task && (
        <div className="task-details-body">
          {/* Quick Info Bar */}
          <div className="task-modal-quickbar">
            <div className="quickbar-item">
              <FolderKanban size={15} className="quickbar-icon" />
              <span>{task.project?.name || 'Project'}</span>
            </div>

            <div className="quickbar-item">
              <span className={`priority-badge priority-${task.priority.toLowerCase()}`}>
                {task.priority} Priority
              </span>
            </div>

            <div className="quickbar-item">
              <Clock size={15} className="quickbar-icon" />
              <span>{formatMinutesToHours(task.totalTimeSpentMinutes)} logged</span>
            </div>

            <div className="quickbar-status-select-wrap">
              <select
                className={`inline-status-select status-${task.status.toLowerCase().replace(/\s+/g, '_')}`}
                value={task.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                disabled={!canEditTask(task)}
              >
                <option value="Backlog">Backlog</option>
                <option value="To Do">To Do</option>
                <option value="Working on it">Working on it</option>
                <option value="In Progress">In Progress</option>
                <option value="Stuck">Stuck</option>
                <option value="Blocked">Blocked</option>
                <option value="In Review">In Review</option>
                <option value="Applied">Applied</option>
                <option value="Done">Done</option>
              </select>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="task-modal-tabs">
            <button
              type="button"
              className={`modal-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <Info size={15} />
              <span>Details</span>
            </button>

            <button
              type="button"
              className={`modal-tab-btn ${activeTab === 'activity' ? 'active' : ''}`}
              onClick={() => setActiveTab('activity')}
            >
              <History size={15} />
              <span>Activity Log</span>
            </button>

            <button
              type="button"
              className={`modal-tab-btn ${activeTab === 'comments' ? 'active' : ''}`}
              onClick={() => setActiveTab('comments')}
            >
              <MessageSquare size={15} />
              <span>Updates ({comments.length || 0})</span>
            </button>

            <button
              type="button"
              className={`modal-tab-btn ${activeTab === 'attachments' ? 'active' : ''}`}
              onClick={() => setActiveTab('attachments')}
            >
              <Paperclip size={15} />
              <span>Files ({task.attachments?.length || 0})</span>
            </button>

            <button
              type="button"
              className={`modal-tab-btn ${activeTab === 'time' ? 'active' : ''}`}
              onClick={() => setActiveTab('time')}
            >
              <Clock size={15} />
              <span>Time ({formatMinutesToHours(task.totalTimeSpentMinutes)})</span>
            </button>
          </div>

          {/* Tab 1: Overview */}
          {activeTab === 'overview' && (
            <div className="tab-pane overview-pane">
              <div className="overview-section">
                <h4 className="section-label">Description & Acceptance Criteria</h4>
                <div className="task-desc-box">
                  {task.description ? (
                    <p className="task-full-desc">{task.description}</p>
                  ) : (
                    <p className="text-muted italic">No detailed description provided for this deliverable.</p>
                  )}
                </div>
              </div>

              <div className="overview-section">
                <h4 className="section-label">Assignment & WhatsApp History</h4>
                <div className="task-desc-box">
                  <p>
                    <strong>Assigned contact:</strong>{' '}
                    {task.assignedContact?.fullName || 'Unassigned'}
                    {task.assignedContact?.whatsappNumber && ` · ${formatWhatsAppNumber(task.assignedContact.whatsappNumber)}`}
                    {task.assignedContact && !task.assignedContact.isActive && ' (Inactive contact)'}
                  </p>
                  {task.contactAssignedAt && (
                    <p><strong>Assigned:</strong> {formatDateTime(task.contactAssignedAt)}</p>
                  )}
                  {whatsappHistoryError && (
                    <p className="text-danger" role="status">{whatsappHistoryError}</p>
                  )}
                  {whatsappNotifications.length === 0 ? (
                    <p className="text-muted italic mt-2">
                      {task.assignedContact ? 'No WhatsApp notification has been recorded.' : 'Assign a contact to create WhatsApp notification history.'}
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {whatsappNotifications.map((notification) => (
                        <div key={notification._id} className="border-t pt-3">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                            <strong>Status:</strong>
                            {notification.status === 'delivered' ? (
                              <StatusBadge status="completed" label="✓ Delivered" size="sm" />
                            ) : notification.status === 'server_ack' ? (
                              <StatusBadge status="active" label="Server acknowledged" size="sm" />
                            ) : notification.status === 'sent' ? (
                              <StatusBadge status="active" label="Accepted by Baileys" size="sm" />
                            ) : notification.status === 'processing' ? (
                              <StatusBadge status="in_progress" label="Processing" size="sm" />
                            ) : notification.status === 'failed' ? (
                              <StatusBadge status="offline" label="Failed" size="sm" />
                            ) : (
                              <StatusBadge status="pending" label="Pending" size="sm" />
                            )}
                          </div>
                          <p><strong>Contact:</strong> {notification.contactName} · {formatWhatsAppNumber(notification.recipientNumber)}</p>
                          {notification.createdAt && <p><strong>Attempt started:</strong> {formatDateTime(notification.createdAt)}</p>}
                          {notification.attempts > 0 && <p><strong>Attempts:</strong> {notification.attempts}</p>}
                          {notification.sentAt && <p><strong>Accepted by Baileys:</strong> {formatDateTime(notification.sentAt)}</p>}
                          {notification.serverAckAt && <p><strong>Server acknowledged:</strong> {formatDateTime(notification.serverAckAt)}</p>}
                          {notification.deliveredAt && <p><strong>Delivery confirmed:</strong> {formatDateTime(notification.deliveredAt)}</p>}
                          {notification.providerMessageId && <p><strong>Provider message ID:</strong> {notification.providerMessageId}</p>}
                          {notification.failureReason && <p className="text-danger"><strong>Failure:</strong> {notification.failureReason}</p>}
                          {notification.status === 'failed' && canManage && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              isLoading={retryingNotificationId === notification._id}
                              disabled={Boolean(retryingNotificationId)}
                              onClick={() => handleRetryWhatsAppNotification(notification._id)}
                              className="mt-2"
                            >
                              Retry WhatsApp notification
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="overview-grid">
                <div className="meta-card">
                  <span className="meta-card-label">Owner</span>
                  <div className="meta-card-content">
                    <span className="owner-name">{user?.name || 'Workspace Owner'}</span>
                  </div>
                </div>

                <div className="meta-card">
                  <span className="meta-card-label">Timeline & Deadlines</span>
                  <div className="meta-card-content">
                    <div className="date-row">
                      <span className="date-label">Start Date:</span>
                      <span>{formatDate(task.startDate)}</span>
                    </div>
                    <div className="date-row">
                      <span className="date-label">Due Date:</span>
                      <span className={overdue ? 'text-danger font-semibold' : ''}>
                        {formatDate(task.dueDate)} {overdue && '(Overdue)'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="meta-card">
                  <span className="meta-card-label">Creator & Timestamp</span>
                  <div className="meta-card-content">
                    <p>Created by: <strong>{task.creator?.name || 'Manager'}</strong></p>
                    <p className="text-muted text-xs">Logged: {formatDateTime(task.createdAt)}</p>
                  </div>
                </div>

                <div className="meta-card">
                  <span className="meta-card-label">Total Work Logged</span>
                  <div className="meta-card-content">
                    <p className="time-highlight">{formatMinutesToHours(task.totalTimeSpentMinutes)}</p>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => setActiveTab('time')}
                    >
                      + Log time on this task
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Activity Timeline */}
          {activeTab === 'activity' && (
            <div className="tab-pane activity-pane">
              {loadingActivity && <LoadingState message="Fetching audit timeline..." />}

              {activityError && (
                <ErrorState
                  title="Could not load activity"
                  message={activityError}
                  onRetry={loadActivity}
                />
              )}

              {!loadingActivity && !activityError && activity.length === 0 && (
                <EmptyState
                  icon={History}
                  title="No Activity Events Recorded"
                  description="All status changes, updates, comments, and uploads will automatically appear here."
                />
              )}

              {!loadingActivity && !activityError && activity.length > 0 && (
                <div className="activity-timeline">
                  {activity.map((event) => (
                    <div key={event._id} className="timeline-item">
                      <div className="timeline-marker" />
                      <div className="timeline-content">
                        <div className="timeline-header">
                          <span className="timeline-actor">{event.user?.name || 'System User'}</span>
                          <span className="timeline-role">({event.user?.role || 'Staff'})</span>
                          <span className="timeline-time">{formatRelativeTime(event.createdAt)}</span>
                        </div>
                        <div className="timeline-body">
                          {renderEventDescription(event)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Comments */}
          {activeTab === 'comments' && (
            <div className="tab-pane comments-pane">
              {loadingComments && <LoadingState message="Loading discussion..." />}

              {!loadingComments && (
                <>
                  <div className="comments-stream">
                    {comments.length === 0 ? (
                      <EmptyState
                        icon={MessageSquare}
                        title="No Discussion Yet"
                        description="Start the conversation by posting an update or asking a question below."
                      />
                    ) : (
                      comments.map((comment) => {
                        const canDelete = canManage || comment.author?._id === user?._id;
                        return (
                          <div key={comment._id} className="comment-card">
                            <div className="comment-header">
                              <div className="comment-author-info">
                                <span className="comment-author-name">{comment.author?.name}</span>
                                <span className="comment-author-role">({comment.author?.role})</span>
                                <span className="comment-date">{formatRelativeTime(comment.createdAt)}</span>
                              </div>
                              {canDelete && (
                                <button
                                  type="button"
                                  className="icon-delete-btn"
                                  onClick={() => handleDeleteComment(comment._id)}
                                  title="Delete comment"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                            <p className="comment-body">{comment.content}</p>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Add Comment Form */}
                  {canEditTask(task) && <form onSubmit={handleAddComment} className="comment-input-box">
                    {mentionMatches.length > 0 && (
                      <div className="mention-suggestions" role="listbox" aria-label="Mention a team member">
                        {mentionMatches.map((member) => (
                          <button type="button" key={member._id} onClick={() => insertMention(member)}>
                            <span>{member.name}</span><small>{member.email}</small>
                          </button>
                        ))}
                      </div>
                    )}
                    <textarea
                      placeholder="Write a comment or project update..."
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      rows={3}
                      className="comment-textarea"
                      required
                    />
                    <div className="comment-actions">
                      <label className="comment-upload-button" title="Attach a file or image">
                        <UploadCloud size={15} />
                        <span>{uploadingFile ? 'Uploading…' : 'Attach'}</span>
                        <input
                          type="file"
                          className="hidden-file-input"
                          onChange={handleFileUpload}
                          disabled={uploadingFile}
                        />
                      </label>
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        icon={Send}
                        isLoading={submittingComment}
                        disabled={!newComment.trim()}
                      >
                        Post Comment
                      </Button>
                    </div>
                  </form>}
                </>
              )}
            </div>
          )}

          {/* Tab 4: Attachments */}
          {activeTab === 'attachments' && (
            <div className="tab-pane attachments-pane">
              {attachmentError && (
                <div className="alert-box-warning">
                  <AlertCircle size={16} />
                  <span>{attachmentError}</span>
                </div>
              )}

              {/* Upload Drop Area */}
              {canEditTask(task) && <div className="attachment-upload-box">
                <UploadCloud size={28} className="upload-icon" />
                <p className="upload-title">Upload Task Attachments</p>
                <p className="upload-subtitle">
                  Supports images, documents, PDFs, and spreadsheets up to 10MB.
                </p>
                <label className="file-input-label">
                  <span>{uploadingFile ? 'Uploading to Cloudinary...' : 'Select File from Computer'}</span>
                  <input
                    type="file"
                    className="hidden-file-input"
                    onChange={handleFileUpload}
                    disabled={uploadingFile}
                  />
                </label>
              </div>}

              {/* Files List */}
              <div className="attachments-list">
                <h4 className="section-label">Attached Files ({task.attachments?.length || 0})</h4>
                {(!task.attachments || task.attachments.length === 0) ? (
                  <p className="text-muted text-sm italic">No files attached to this deliverable yet.</p>
                ) : (
                  <div className="files-grid">
                    {task.attachments.map((file) => {
                      const canDelete = canManage || file.uploadedBy === user?._id;
                      const isImage = file.fileType?.startsWith('image/');
                      return (
                        <div key={file._id} className="file-card">
                          {isImage
                            ? <button type="button" className="file-image-preview" onClick={() => setPreviewImage(file)} aria-label={`Preview ${file.fileName}`}><img src={file.url} alt={file.fileName} /></button>
                            : <div className="file-icon-wrap"><FileText size={20} /></div>}
                          <div className="file-info">
                            <span className="file-name" title={file.fileName}>{file.fileName}</span>
                            <span className="file-meta">
                              {formatBytes(file.bytes)} • {formatDate(file.uploadedAt)}
                            </span>
                          </div>
                          <div className="file-actions">
                            <a
                              href={file.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="file-link-btn"
                              title="Download / View asset"
                            >
                              <ExternalLink size={15} />
                            </a>
                            {canDelete && (
                              <button
                                type="button"
                                className="icon-delete-btn"
                                onClick={() => handleDeleteAttachment(file._id)}
                                title="Delete file"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 5: Time Tracking */}
          {activeTab === 'time' && (
            <div className="tab-pane time-pane">
              {/* Summary Card */}
              <div className="time-summary-card">
                <div className="time-stat">
                  <span className="time-stat-label">Total Time Invested</span>
                  <span className="time-stat-value">{formatMinutesToHours(task.totalTimeSpentMinutes)}</span>
                </div>
                <div className="time-stat">
                  <span className="time-stat-label">Decimal Hours</span>
                  <span className="time-stat-value">
                    {( (task.totalTimeSpentMinutes || 0) / 60 ).toFixed(2)} hrs
                  </span>
                </div>
              </div>

              {/* Log Time Form */}
              {canEditTask(task) && <form onSubmit={handleLogTime} className="time-log-form">
                <h4 className="section-label">Log Work Time</h4>
                <div className="time-form-inputs">
                  <div className="time-input-group">
                    <label htmlFor="duration-min" className="input-label">Minutes</label>
                    <input
                      id="duration-min"
                      type="number"
                      min="1"
                      max="1440"
                      placeholder="e.g. 60"
                      value={timeMinutes}
                      onChange={(e) => setTimeMinutes(e.target.value)}
                      className="filter-search-input"
                      required
                    />
                  </div>

                  <div className="time-input-group">
                    <label htmlFor="log-date" className="input-label">Date</label>
                    <input
                      id="log-date"
                      type="date"
                      value={timeDate}
                      onChange={(e) => setTimeDate(e.target.value)}
                      className="filter-search-input"
                      required
                    />
                  </div>

                  <div className="time-input-group full-width">
                    <label htmlFor="log-notes" className="input-label">Work Summary / Notes</label>
                    <input
                      id="log-notes"
                      type="text"
                      placeholder="What deliverables or subtasks were completed?"
                      value={timeDesc}
                      onChange={(e) => setTimeDesc(e.target.value)}
                      className="filter-search-input"
                    />
                  </div>
                </div>

                <div className="time-presets">
                  <span className="text-xs text-muted">Quick presets:</span>
                  <button type="button" className="preset-btn" onClick={() => setTimeMinutes('15')}>15m</button>
                  <button type="button" className="preset-btn" onClick={() => setTimeMinutes('30')}>30m</button>
                  <button type="button" className="preset-btn" onClick={() => setTimeMinutes('60')}>1h</button>
                  <button type="button" className="preset-btn" onClick={() => setTimeMinutes('120')}>2h</button>
                  <button type="button" className="preset-btn" onClick={() => setTimeMinutes('240')}>4h</button>
                </div>

                <div className="time-form-submit">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    icon={Clock}
                    isLoading={submittingTime}
                  >
                    Log Time
                  </Button>
                </div>
              </form>}

              {/* Time Log Table */}
              <div className="time-logs-list">
                <h4 className="section-label">Logged Entries ({timeEntries.length})</h4>
                {loadingTime && <LoadingState message="Loading time history..." />}

                {!loadingTime && timeEntries.length === 0 && (
                  <p className="text-muted text-sm italic">No individual time entries logged yet.</p>
                )}

                {!loadingTime && timeEntries.length > 0 && (
                  <div className="data-table-container">
                    <table className="data-table" aria-label="Task time entries">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>User</th>
                          <th>Duration</th>
                          <th>Description</th>
                          <th className="text-right" style={{ width: '60px' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {timeEntries.map((entry) => {
                          const canDelete = canManage || entry.user?._id === user?._id;
                          return (
                            <tr key={entry._id}>
                              <td>{formatDate(entry.date)}</td>
                              <td>{entry.user?.name || 'Staff'}</td>
                              <td>
                                <span className="time-badge">
                                  {formatMinutesToHours(entry.durationMinutes)}
                                </span>
                              </td>
                              <td>{entry.description || '—'}</td>
                              <td className="text-right">
                                {canDelete && (
                                  <button
                                    type="button"
                                    className="icon-delete-btn"
                                    onClick={() => handleDeleteTimeEntry(entry._id)}
                                    title="Delete entry"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {previewImage && (
        <div className="attachment-image-lightbox" role="dialog" aria-modal="true" aria-label={previewImage.fileName} onClick={() => setPreviewImage(null)}>
          <button type="button" aria-label="Close image preview" onClick={() => setPreviewImage(null)}><X size={22} /></button>
          <img src={previewImage.url} alt={previewImage.fileName} onClick={(event) => event.stopPropagation()} />
          <span>{previewImage.fileName}</span>
        </div>
      )}
    </Modal>
  );
};

export default TaskDetailsModal;
