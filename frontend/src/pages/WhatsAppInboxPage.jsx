import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../components/layout/PageContainer';
import Button from '../components/ui/Button';
import StatusBadge from '../components/ui/StatusBadge';
import FormField from '../components/ui/FormField';
import Modal from '../components/ui/Modal';
import LoadingState from '../components/ui/LoadingState';
import EmptyState from '../components/ui/EmptyState';
import ErrorState from '../components/ui/ErrorState';
import { whatsappService } from '../services/whatsappService';
import { projectService } from '../services/projectService';
import { socketService } from '../services/socket';
import { useToast } from '../hooks/useToast';
import {
  Inbox,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Copy,
  Clock,
  Sparkles,
  AlertTriangle,
  ExternalLink,
  MessageSquare,
  ShieldAlert,
  Search,
  Filter,
  Eye,
  Check,
  User,
  Bot
} from 'lucide-react';

const STATUS_TABS = [
  { key: 'all', label: 'All Drafts' },
  { key: 'awaiting_review', label: 'Awaiting Review' },
  { key: 'needs_clarification', label: 'Needs Clarification' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'failed', label: 'Failed' }
];

export const WhatsAppInboxPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [drafts, setDrafts] = useState([]);
  const [counts, setCounts] = useState({
    all: 0,
    awaiting_review: 0,
    needs_clarification: 0,
    approved: 0,
    rejected: 0,
    failed: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [groups, setGroups] = useState([]);

  // Projects for dropdown
  const [projects, setProjects] = useState([]);

  // Review Modal State
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submittingAction, setSubmittingAction] = useState(false);

  // Form Fields inside Modal
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editProjectId, setEditProjectId] = useState('');
  const [editPriority, setEditPriority] = useState('Medium');
  const [editStartDate, setEditStartDate] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editAssigneeName, setEditAssigneeName] = useState('');
  const [editAssigneePhone, setEditAssigneePhone] = useState('');

  // Fetch groups and projects
  useEffect(() => {
    whatsappService
      .getGroups()
      .then((res) => {
        setGroups(res.data?.groups || []);
      })
      .catch(() => {});

    projectService
      .getProjects({ limit: 100 })
      .then((res) => {
        setProjects(res.data?.projects || []);
      })
      .catch(() => {});
  }, []);

  // Fetch drafts
  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (activeTab !== 'all') params.status = activeTab;
      if (selectedGroup) params.groupJid = selectedGroup;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      const res = await whatsappService.getDrafts(params);
      setDrafts(res.data?.drafts || []);
      if (res.data?.counts) {
        setCounts(res.data.counts);
      }
    } catch (err) {
      setError(err.message || 'Failed to load task drafts.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedGroup, searchQuery]);

  useEffect(() => {
    fetchDrafts();

    const socket = socketService.connect();
    if (!socket) return;

    const handleNewDraft = () => {
      fetchDrafts();
    };

    socket.on('whatsapp:draft_created', handleNewDraft);
    socket.on('whatsapp:draft_updated', handleNewDraft);

    return () => {
      socket.off('whatsapp:draft_created', handleNewDraft);
      socket.off('whatsapp:draft_updated', handleNewDraft);
    };
  }, [fetchDrafts]);

  // Open Review Modal
  const handleOpenReview = (draft) => {
    setSelectedDraft(draft);
    setEditTitle(draft.editableFields?.title || draft.aiExtraction?.title || '');
    setEditDescription(
      draft.editableFields?.description !== undefined
        ? draft.editableFields.description
        : draft.aiExtraction?.description || draft.rawMessageText || ''
    );
    setEditProjectId(
      draft.editableFields?.projectId?._id ||
        draft.editableFields?.projectId ||
        draft.aiExtraction?.projectId?._id ||
        draft.aiExtraction?.projectId ||
        (projects.length > 0 ? projects[0]._id : '')
    );
    setEditPriority(
      draft.editableFields?.priority || draft.aiExtraction?.priority || 'Medium'
    );
    setEditStartDate(
      draft.editableFields?.startDate
        ? new Date(draft.editableFields.startDate).toISOString().slice(0, 10)
        : draft.aiExtraction?.startDate
          ? new Date(draft.aiExtraction.startDate).toISOString().slice(0, 10)
          : ''
    );
    setEditDueDate(
      draft.editableFields?.dueDate
        ? new Date(draft.editableFields.dueDate).toISOString().slice(0, 10)
        : draft.aiExtraction?.dueDate
          ? new Date(draft.aiExtraction.dueDate).toISOString().slice(0, 10)
          : ''
    );
    setEditAssigneeName(
      draft.editableFields?.assigneeName ||
        draft.aiExtraction?.assigneeName ||
        ''
    );
    setEditAssigneePhone(
      draft.editableFields?.assigneePhone ||
        draft.aiExtraction?.assigneePhone ||
        ''
    );
    setModalOpen(true);
  };

  // Copy raw message
  const handleCopyMessage = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Original message copied to clipboard.');
  };

  // Approve & Create Task
  const handleApprove = async () => {
    if (!editTitle.trim()) {
      toast.error('Task title is required.');
      return;
    }
    if (!editProjectId) {
      toast.error('Please assign this task to a workspace project.');
      return;
    }

    setSubmittingAction(true);
    try {
      const payload = {
        title: editTitle.trim(),
        description: editDescription.trim(),
        projectId: editProjectId,
        priority: editPriority,
        startDate: editStartDate ? new Date(editStartDate).toISOString() : null,
        dueDate: editDueDate ? new Date(editDueDate).toISOString() : null,
        assigneeName: editAssigneeName.trim(),
        assigneePhone: editAssigneePhone.trim()
      };

      const res = await whatsappService.approveDraft(selectedDraft._id, payload);
      toast.success(res.message || 'Task created successfully from WhatsApp draft!');
      setModalOpen(false);
      fetchDrafts();
    } catch (err) {
      toast.error(err.message || 'Failed to approve draft and create task.');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Reject Draft
  const handleReject = async () => {
    setSubmittingAction(true);
    try {
      await whatsappService.rejectDraft(selectedDraft._id);
      toast.info('Draft has been rejected.');
      setModalOpen(false);
      fetchDrafts();
    } catch (err) {
      toast.error(err.message || 'Failed to reject draft.');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Retry AI
  const handleRetry = async () => {
    setSubmittingAction(true);
    try {
      const res = await whatsappService.retryDraft(selectedDraft._id);
      toast.success(res.message || 'Draft reprocessed successfully.');
      setSelectedDraft(res.data?.draft);
      fetchDrafts();
    } catch (err) {
      toast.error(err.message || 'Failed to reprocess draft.');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Redact Raw Text
  const handleRedactRaw = async () => {
    if (!window.confirm('Are you sure you want to delete the raw message text for privacy? This cannot be undone.')) {
      return;
    }
    try {
      const res = await whatsappService.deleteRawMessage(selectedDraft._id);
      toast.success('Raw message text redacted.');
      setSelectedDraft(res.data?.draft);
      fetchDrafts();
    } catch (err) {
      toast.error(err.message || 'Failed to redact text.');
    }
  };

  const getStatusBadgeVariant = (status) => {
    switch (status) {
      case 'awaiting_review':
        return 'warning';
      case 'needs_clarification':
        return 'info';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'default';
      case 'failed':
        return 'danger';
      default:
        return 'default';
    }
  };

  const getStatusBadgeLabel = (status) => {
    switch (status) {
      case 'awaiting_review':
        return 'Awaiting Review';
      case 'needs_clarification':
        return 'Needs Clarification';
      case 'approved':
        return 'Approved & Created';
      case 'rejected':
        return 'Rejected';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  };

  return (
    <PageContainer
      title="WhatsApp Task Inbox"
      description="Review, refine, and approve task drafts generated from monitored WhatsApp group messages."
      actions={
        <Button variant="secondary" icon={RefreshCw} onClick={fetchDrafts} isLoading={loading}>
          Refresh Inbox
        </Button>
      }
    >
      {/* Status Filter Tabs */}
      <div className="filter-tabs-container" style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
        {STATUS_TABS.map((tab) => {
          const count = counts[tab.key] ?? 0;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`filter-tab-btn ${isActive ? 'active' : ''}`}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #e2e8f0)',
                background: isActive ? 'var(--primary-color, #2563eb)' : 'var(--card-bg, #ffffff)',
                color: isActive ? '#ffffff' : 'var(--text-primary, #1e293b)',
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.875rem'
              }}
            >
              <span>{tab.label}</span>
              <span
                style={{
                  padding: '0.125rem 0.375rem',
                  borderRadius: '12px',
                  background: isActive ? 'rgba(255, 255, 255, 0.25)' : 'var(--bg-subtle, #f1f5f9)',
                  fontSize: '0.75rem',
                  fontWeight: 600
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search and Group Filters */}
      <div
        className="inbox-filters-bar"
        style={{
          display: 'flex',
          gap: '1rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '10px', color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Search by title, sender, or text..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem 0.5rem 2rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color, #cbd5e1)',
              background: 'var(--input-bg, #fff)',
              fontSize: '0.875rem'
            }}
          />
        </div>

        <div style={{ flex: '0 1 240px' }}>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color, #cbd5e1)',
              background: 'var(--input-bg, #fff)',
              fontSize: '0.875rem'
            }}
          >
            <option value="">All Monitored Groups</option>
            {groups.map((g) => (
              <option key={g.groupJid} value={g.groupJid}>
                {g.groupName || g.groupJid}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <LoadingState message="Loading WhatsApp task drafts..." />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchDrafts} />
      ) : drafts.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No Task Drafts Found"
          description={
            activeTab === 'all'
              ? 'No incoming messages from monitored groups have generated task drafts yet. Make sure group monitoring is enabled in Settings.'
              : `No drafts found with status "${STATUS_TABS.find((t) => t.key === activeTab)?.label}".`
          }
        />
      ) : (
        <div className="drafts-grid" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {drafts.map((draft) => {
            const title =
              draft.editableFields?.title ||
              draft.aiExtraction?.title ||
              draft.rawMessageText.slice(0, 80) ||
              'Untitled Task Draft';

            const matchedProject =
              draft.editableFields?.projectId?.title ||
              draft.aiExtraction?.projectId?.title ||
              null;

            const priority =
              draft.editableFields?.priority ||
              draft.aiExtraction?.priority ||
              'Medium';

            const dueDate =
              draft.editableFields?.dueDate ||
              draft.aiExtraction?.dueDate ||
              null;

            const confidence = draft.aiExtraction?.confidence;
            const confidencePct = confidence !== undefined ? Math.round(confidence * 100) : null;

            return (
              <div
                key={draft._id}
                className="draft-card"
                style={{
                  background: 'var(--card-bg, #ffffff)',
                  border: '1px solid var(--border-color, #e2e8f0)',
                  borderRadius: '10px',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                }}
              >
                {/* Header Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <StatusBadge
                      variant={getStatusBadgeVariant(draft.status)}
                      label={getStatusBadgeLabel(draft.status)}
                    />
                    {confidencePct !== null && (
                      <span
                        style={{
                          fontSize: '0.75rem',
                          background: 'var(--bg-subtle, #f1f5f9)',
                          padding: '0.125rem 0.5rem',
                          borderRadius: '4px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          color: '#475569'
                        }}
                      >
                        <Sparkles size={12} color="#f59e0b" />
                        {confidencePct}% AI confidence
                      </span>
                    )}
                    {draft.aiExtraction?.modelUsed && (
                      <span
                        style={{
                          fontSize: '0.75rem',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          padding: '0.125rem 0.5rem',
                          borderRadius: '4px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          color: '#64748b'
                        }}
                      >
                        <Bot size={12} color="#6366f1" />
                        {draft.aiExtraction.modelUsed}
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Clock size={14} />
                    <span>{new Date(draft.messageTimestamp).toLocaleString()}</span>
                  </div>
                </div>

                {/* Title */}
                <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary, #0f172a)' }}>
                  {title}
                </h4>

                {/* Metadata Pills */}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: '#e0f2fe', color: '#0369a1' }}>
                    📁 {matchedProject || 'No project assigned'}
                  </span>
                  <span style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: '#fef3c7', color: '#92400e' }}>
                    ⚡ {priority}
                  </span>
                  {dueDate && (
                    <span style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: '#f3e8ff', color: '#6b21a8' }}>
                      📅 Due: {new Date(dueDate).toLocaleDateString()}
                    </span>
                  )}
                  {(draft.editableFields?.assigneeName || draft.aiExtraction?.assigneeName) && (
                    <span style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: '#ecfdf5', color: '#047857', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      <User size={12} /> Assignee: {draft.editableFields?.assigneeName || draft.aiExtraction?.assigneeName}
                      {(draft.editableFields?.assigneePhone || draft.aiExtraction?.assigneePhone) && (
                        <span style={{ opacity: 0.8, fontSize: '0.75rem' }}>({draft.editableFields?.assigneePhone || draft.aiExtraction?.assigneePhone})</span>
                      )}
                    </span>
                  )}
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    💬 {draft.groupName || 'WhatsApp Group'} &bull; <strong>{draft.senderName || draft.senderJid}</strong>
                  </span>
                </div>

                {draft.aiExtraction?.reason && (
                  <div style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Sparkles size={12} color="#f59e0b" />
                    <span><strong>AI Analysis:</strong> {draft.aiExtraction.reason}</span>
                  </div>
                )}
                {draft.processingError && (
                  <p className="text-danger" role="status">{draft.processingError}</p>
                )}

                {/* Original Message Snippet */}
                <div
                  style={{
                    background: 'var(--bg-subtle, #f8fafc)',
                    borderLeft: '3px solid #3b82f6',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0 6px 6px 0',
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary, #334155)',
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '80px',
                    overflowY: 'auto'
                  }}
                >
                  {draft.rawMessageText}
                </div>

                {(draft.previewImage?.url || draft.attachments?.length > 0) && (() => {
                  const hasAudio = draft.attachments?.some(a => a?.fileType?.startsWith('audio/') || a?.fileName?.includes('voice'));
                  const imgUrl = draft.previewImage?.url || (!hasAudio ? draft.attachments?.[0]?.url : null);
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}>
                      {hasAudio ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', color: '#047857', fontWeight: 600 }}>
                          <span>🎙️ Voice Note</span>
                        </div>
                      ) : imgUrl ? (
                        <>
                          <img
                            src={imgUrl}
                            alt="Thumbnail"
                            style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                          />
                          <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>📷 Image attached</span>
                        </>
                      ) : null}
                    </div>
                  );
                })()}

                {/* Warning / missing info callout */}
                {draft.aiExtraction?.missingInformation?.length > 0 && (
                  <div
                    style={{
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '6px',
                      padding: '0.5rem 0.75rem',
                      fontSize: '0.8rem',
                      color: '#b45309',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}
                  >
                    <AlertTriangle size={14} />
                    <span>Clarification: {draft.aiExtraction.missingInformation.join('; ')}</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                  {draft.status === 'approved' && draft.createdTask ? (
                    <Button
                      variant="secondary"
                      icon={ExternalLink}
                      onClick={() => navigate(`/all-tasks?search=${draft.createdTask?.taskKey || ''}`)}
                    >
                      View Created Task ({draft.createdTask?.taskKey})
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      icon={Eye}
                      onClick={() => handleOpenReview(draft)}
                    >
                      Review & Approve
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Review & Approval Modal */}
      {selectedDraft && (
        <Modal
          isOpen={modalOpen}
          onClose={() => !submittingAction && setModalOpen(false)}
          title="Review & Approve Task Draft"
          maxWidth="700px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Source Box */}
            <div
              style={{
                background: 'var(--bg-subtle, #f8fafc)',
                border: '1px solid var(--border-color, #e2e8f0)',
                borderRadius: '8px',
                padding: '0.75rem 1rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <MessageSquare size={14} />
                  ORIGINAL WHATSAPP MESSAGE
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button
                    variant="ghost"
                    size="small"
                    icon={Copy}
                    onClick={() => handleCopyMessage(selectedDraft.rawMessageText)}
                  >
                    Copy
                  </Button>
                  {!selectedDraft.isRawMessageRedacted && (
                    <Button
                      variant="ghost"
                      size="small"
                      icon={ShieldAlert}
                      onClick={handleRedactRaw}
                    >
                      Redact
                    </Button>
                  )}
                </div>
              </div>

              <div
                style={{
                  fontSize: '0.875rem',
                  color: '#1e293b',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '120px',
                  overflowY: 'auto'
                }}
              >
                {selectedDraft.rawMessageText}
              </div>

              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.5rem' }}>
                From: <strong>{selectedDraft.senderName || selectedDraft.senderJid}</strong> in{' '}
                <strong>{selectedDraft.groupName || selectedDraft.groupJid}</strong> &bull;{' '}
                {new Date(selectedDraft.messageTimestamp).toLocaleString()}
              </div>
            </div>

            {/* Attached WhatsApp Image / Media Preview */}
            {(selectedDraft.previewImage?.url || selectedDraft.attachments?.length > 0) && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '0.75rem'
                }}
              >
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span>📷 Attached Picture / Media ({selectedDraft.attachments?.length || 1})</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {(selectedDraft.attachments?.length > 0
                    ? selectedDraft.attachments
                    : [selectedDraft.previewImage]
                  ).filter(a => a?.url).map((att, idx) => {
                    const isAudio = att.fileType?.startsWith('audio/') || att.fileName?.includes('voice');
                    if (isAudio) {
                      return (
                        <div key={idx} style={{ width: '100%', padding: '0.5rem', background: '#f1f5f9', borderRadius: '6px' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span>🎙️ Voice Note Audio Player:</span>
                          </div>
                          <audio controls src={att.url} style={{ width: '100%', height: '36px' }} />
                        </div>
                      );
                    }
                    return (
                      <a
                        key={idx}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Click to view full image in Cloudinary"
                        style={{
                          display: 'inline-block',
                          borderRadius: '6px',
                          overflow: 'hidden',
                          border: '1px solid #cbd5e1',
                          background: '#0f172a',
                          textDecoration: 'none'
                        }}
                      >
                        <img
                          src={att.url}
                          alt={att.fileName || 'WhatsApp Attachment'}
                          style={{
                            maxWidth: '260px',
                            maxHeight: '180px',
                            objectFit: 'contain',
                            display: 'block'
                          }}
                        />
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Missing Info Warning */}
            {selectedDraft.processingError && (
              <p className="text-danger" role="status">{selectedDraft.processingError}</p>
            )}

            {selectedDraft.aiExtraction?.missingInformation?.length > 0 && (
              <div
                style={{
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '6px',
                  padding: '0.75rem',
                  fontSize: '0.85rem',
                  color: '#92400e',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem'
                }}
              >
                <AlertTriangle size={16} style={{ marginTop: '2px', flexShrink: 0 }} />
                <div>
                  <strong>Missing details flagged by AI:</strong>
                  <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
                    {selectedDraft.aiExtraction.missingInformation.map((m, idx) => (
                      <li key={idx}>{m}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* AI Reasoning Callout */}
            {selectedDraft.aiExtraction?.reason && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '0.6rem 0.75rem',
                  fontSize: '0.825rem',
                  color: '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                <Bot size={16} color="#6366f1" style={{ flexShrink: 0 }} />
                <div>
                  <strong>{selectedDraft.extractorProvider || 'AI'} Reasoning ({selectedDraft.aiExtraction?.modelUsed || 'default model'}):</strong>{' '}
                  {selectedDraft.aiExtraction.reason}
                </div>
              </div>
            )}

            {/* Editable Fields Form */}
            <FormField
              id="edit-draft-title"
              label="Task Title"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="e.g. Update UK property expense tracker"
              required
            />

            <FormField
              id="edit-draft-desc"
              label="Task Description"
              as="textarea"
              rows={3}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Detailed instructions..."
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label className="form-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
                  Project *
                </label>
                <select
                  className="form-input"
                  value={editProjectId}
                  onChange={(e) => setEditProjectId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color, #cbd5e1)'
                  }}
                  required
                >
                  <option value="">Select Target Project</option>
                  {projects.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
                  Priority
                </label>
                <select
                  className="form-input"
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color, #cbd5e1)'
                  }}
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <FormField
                id="edit-draft-start"
                label="Start Date"
                type="date"
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
              />

              <FormField
                id="edit-draft-due"
                label="Due Date"
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                helperText={selectedDraft.aiExtraction?.dateInterpretation || ''}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <FormField
                id="edit-draft-assignee-name"
                label="Assignee Name"
                value={editAssigneeName}
                onChange={(e) => setEditAssigneeName(e.target.value)}
                placeholder="e.g. Rizwan"
                helperText="Matched against workspace users or contacts"
              />

              <FormField
                id="edit-draft-assignee-phone"
                label="Assignee WhatsApp Phone"
                type="tel"
                value={editAssigneePhone}
                onChange={(e) => setEditAssigneePhone(e.target.value)}
                placeholder="e.g. +447123456789"
                helperText="Optional phone for WhatsApp task alert"
              />
            </div>

            {/* Modal Actions */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: '1rem',
                borderTop: '1px solid var(--border-color, #e2e8f0)',
                flexWrap: 'wrap',
                gap: '0.5rem'
              }}
            >
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button
                  variant="danger"
                  icon={XCircle}
                  onClick={handleReject}
                  isLoading={submittingAction}
                >
                  Reject Draft
                </Button>
                {selectedDraft.status === 'failed' && (
                  <Button
                    variant="secondary"
                    icon={RefreshCw}
                    onClick={handleRetry}
                    isLoading={submittingAction}
                  >
                    Retry AI
                  </Button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button
                  variant="ghost"
                  onClick={() => setModalOpen(false)}
                  disabled={submittingAction}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  icon={CheckCircle2}
                  onClick={handleApprove}
                  isLoading={submittingAction}
                  style={{ background: '#16a34a', borderColor: '#16a34a', color: '#fff' }}
                >
                  Approve & Create Task
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </PageContainer>
  );
};

export default WhatsAppInboxPage;
