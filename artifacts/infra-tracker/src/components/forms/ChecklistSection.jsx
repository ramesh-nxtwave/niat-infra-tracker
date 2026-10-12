import React, { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Calendar, Camera, Loader, Ruler, History, CheckCircle, PlayCircle, Trash2, Upload, X, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { fetchPhotoHistory, uploadMultipleFiles, isVideoFile, validateSelectedMediaFiles } from '../../utils/imageUtils';
import { useToast } from '../../context/ToastContext';
import {
  saveChecklistFieldAndRefresh,
  saveChecklistStatusAndRefresh,
} from '../../utils/checklistStatusSync';
import { logAuditAction } from '../../utils/auditLogger';
import { formatDate } from '../../utils/dateUtils';
import {
  getChecklistDraft,
  getPendingChecklistDrafts,
  mergeChecklistItemDraft,
} from '../../utils/checklistDraftStore';
import {
  checklistRemarkSaveKey,
  waitForChecklistSaveIdle,
} from '../../utils/checklistRemarkSaveQueue';
import {
  buildCommittedUploadUpdates,
  buildUploadPatch,
} from './uploadEvidenceContract';
import ImageLightbox from '../ImageLightbox';
import EvidenceMedia from '../EvidenceMedia';
import ChecklistPhotoPreview from './ChecklistPhotoPreview';
import ItemBulkApplyModal from './ItemBulkApplyModal';
import ChecklistRemarkField from './ChecklistRemarkField';

const STATUS_OPTIONS = ['Done', 'Partially Done', 'In-Progress', 'Blocker', 'Yet to start', 'No info as of now', 'Need to revamp', 'N/A'];

const ACCEPTED_TYPES = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/x-msvideo,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.avi';

function FilePreviewThumb({ file, progress, onRemove }) {
  const isVideo = file.type.startsWith('video/');
  const [objUrl] = useState(() => URL.createObjectURL(file));
  return (
    <div style={{ position: 'relative', width: '80px', flexShrink: 0 }}>
      <div style={{ width: '80px', height: '60px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {isVideo ? (
          <video src={objUrl} muted playsInline preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <img src={objUrl} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {progress !== undefined && progress < 100 && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px' }}>
            <span style={{ color: 'white', fontSize: '0.7rem', fontWeight: 700 }}>{progress}%</span>
          </div>
        )}
        {progress === 100 && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(16,185,129,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px' }}>
            <CheckCircle size={18} style={{ color: '#10b981' }} />
          </div>
        )}
      </div>
      {progress === undefined && onRemove && (
        <button onClick={onRemove} style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', width: '18px', height: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 5 }}>
          <X size={10} />
        </button>
      )}
      <p style={{ margin: '0.2rem 0 0', fontSize: '0.58rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80px' }}>{file.name}</p>
    </div>
  );
}

function PhotoHistory({ statusUpdateId, onPhotoDeleted }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const load = async () => {
    if (history !== null) { setOpen(o => !o); return; }
    setLoading(true);
    const data = await fetchPhotoHistory(statusUpdateId);
    setHistory(data);
    setLoading(false);
    setOpen(true);
  };

  const handleDelete = async (historyId) => {
    if (!window.confirm('Delete this photo from history? This cannot be undone.')) return;
    setDeletingId(historyId);
    try {
      const token = localStorage.getItem('niat_token');
      const resp = await fetch(`/api/photo-history/${historyId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error('Delete failed');
      const result = await resp.json();
      const newHistory = (history || []).filter(h => h.id !== historyId);
      setHistory(newHistory);
      if (lightbox !== null) setLightbox(null);
      onPhotoDeleted?.(result.newPhotoUrl || '', result.newPhotoContentType || null);
    } catch (err) {
      alert('Failed to delete photo: ' + err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const formatTs = (ts) => ts
    ? new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';

  const lightboxImages = (history || []).map(h => ({
    id: h.id,
    photoUrl: h.photo_url,
    contentType: h.content_type,
    uploadedBy: h.uploaded_by,
    uploadedAt: h.uploaded_at,
    remarks: h.remarks,
  }));

  return (
    <div style={{ marginTop: '0.4rem' }}>
      <button type="button" onClick={load} disabled={loading}
        style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.15rem 0', fontWeight: 600 }}>
        {loading
          ? <><Loader size={11} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</>
          : <><History size={11} /> {open ? 'Hide' : 'View'} photo history{history ? ` (${history.length})` : ''}</>}
      </button>

      {open && history !== null && (
        <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border)' }}>
          {history.length === 0 ? (
            <p className="text-secondary" style={{ fontSize: '0.78rem', margin: 0 }}>No upload history yet.</p>
          ) : (
            <>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                {history.length} upload{history.length !== 1 ? 's' : ''} · most recent first
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
                {history.map((h, idx) => {
                  const isVid = isVideoFile(h.photo_url || '', h.content_type);
                  return (
                    <div key={h.id} style={{ flex: '0 0 auto', width: '120px' }}>
                      <div onClick={() => !isVid && setLightbox(idx)}
                        style={{ display: 'block', borderRadius: '6px', overflow: 'hidden', position: 'relative', cursor: isVid ? 'default' : 'zoom-in',
                          border: idx === 0 ? '2px solid var(--accent-primary)' : '1px solid var(--border)' }}>
                        <EvidenceMedia
                          path={h.photo_url}
                          contentType={h.content_type}
                          alt={`Upload ${idx + 1}`}
                          controls
                          muted
                          imageStyle={{ width: '120px', height: '80px', objectFit: 'cover', display: 'block' }}
                          videoStyle={{ width: '120px', height: '80px', objectFit: 'cover', display: 'block', background: '#000' }}
                        />
                        {idx === 0 && (
                          <span style={{ position: 'absolute', top: '3px', left: '3px', background: 'var(--accent-primary)', color: 'white', fontSize: '0.58rem', fontWeight: 700, padding: '1px 5px', borderRadius: '999px' }}>LATEST</span>
                        )}
                      </div>
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.65rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>{formatTs(h.uploaded_at)}</p>
                      {h.uploaded_by && <p style={{ margin: '0.1rem 0 0', fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{h.uploaded_by}</p>}
                      {user?.role === 'admin' && (
                        <button
                          onClick={() => handleDelete(h.id)}
                          disabled={deletingId === h.id}
                          style={{ marginTop: '0.25rem', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.2rem', padding: '0.1rem 0', opacity: deletingId === h.id ? 0.5 : 1 }}
                          title="Delete this photo">
                          {deletingId === h.id ? <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={10} />}
                          Delete
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {lightbox !== null && (
        <ImageLightbox images={lightboxImages} startIndex={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

export default function ChecklistSection({
  category,
  items,
  onUpdateItem,
  universityId,
  classrooms = [],
  currentClassroomId,
  currentClassroomName,
  target,
  onTargetRevealed,
  onUploadStateChange,
  onCommittedFieldSaved,
  onCopyPrompt,
  onRemarkFocusChange,
  enableItemBulkApply = true,
}) {
  const { user } = useAuth();
  const { patchChecklistStatus, loadUniversityDetail } = useData();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [lightboxItem, setLightboxItem] = useState(null);
  const [pendingBulkItems, setPendingBulkItems] = useState([]);
  const nextPromptId = useRef(1);
  const deferredStatusPrompts = useRef(new Map());

  const [pendingFiles, setPendingFiles] = useState({});
  const [fileProgress, setFileProgress] = useState({});
  const [uploading, setUploading] = useState({});
  const targetRowRef = useRef(null);
  const itemsRef = useRef(items);
  const revealNavigation = useRef({ key: null, applied: false });
  const contentId = React.useId();
  itemsRef.current = items;

  // Keep unavailable rooms in the chooser so the user sees why they cannot
  // be selected; silently filtering them made a zero-target copy look like a
  // successful no-op.
  const otherClassrooms = classrooms.filter(c => c.id !== currentClassroomId);

  const categoryItems = items.filter(i => i.category === category);
  const targetItem = target
    ? categoryItems.find(item => String(item.id) === String(target.itemId))
    : null;
  const navigationKey = target?.navigationKey ?? null;
  if (revealNavigation.current.key !== navigationKey) {
    revealNavigation.current = { key: navigationKey, applied: false };
  }
  const hasTarget = Boolean(targetItem && target?.navigationKey);
  const shouldRevealTarget = Boolean(
    hasTarget
    && !target.revealed
    && !revealNavigation.current.applied
  );
  const doneCount = categoryItems.filter(i => i.status === 'Done' || i.status === 'N/A').length;
  const progress = Math.round((doneCount / categoryItems.length) * 100) || 0;
  const hasBlocker = categoryItems.some(i => i.status === 'Blocker');

  React.useEffect(() => {
    if (!onUploadStateChange) return undefined;
    categoryItems.forEach(item => {
      const hasPendingWork = (pendingFiles[item.id] || []).length > 0 || !!uploading[item.id];
      onUploadStateChange(item.id, hasPendingWork, currentClassroomId);
    });
    return () => {
      categoryItems.forEach(item => onUploadStateChange(item.id, false, currentClassroomId));
    };
  }, [category, currentClassroomId, items, onUploadStateChange, pendingFiles, uploading]);

  React.useEffect(() => {
    if (hasTarget) setIsOpen(true);
  }, [hasTarget, target?.navigationKey]);

  useLayoutEffect(() => {
    if (!shouldRevealTarget || !isOpen || !targetRowRef.current) return;

    // Claim this navigation before invoking user code so a synchronous parent
    // update or React Strict Mode cannot apply it twice.
    revealNavigation.current.applied = true;
    const row = targetRowRef.current;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    row.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    try {
      row.focus({ preventScroll: true });
    } catch {
      row.focus();
    }
    onTargetRevealed?.(target.navigationKey);
  }, [isOpen, onTargetRevealed, shouldRevealTarget, target]);

  const handleFieldChange = async (id, field, value) => {
    const item = items.find(i => i.id === id);
    if (field === 'status' && value === 'Done') {
      if (!item.photoLink || item.photoLink.trim() === '') {
        showToast('Reminder: No photo evidence attached. Consider uploading site proof before saving.', 'warning');
      }
    }
    const lastUpdated = new Date().toISOString();
    await onUpdateItem(id, { [field]: value, lastUpdated });

    if (field === 'status') {
      let refreshed;
      try {
        refreshed = await saveChecklistStatusAndRefresh({
          patchChecklistStatus,
          loadUniversityDetail,
          universityId,
          statusId: id,
          status: value,
        });
      } catch (error) {
        const reference = error.correlationId ? ` Reference: ${error.correlationId}.` : '';
        showToast(`Status was not saved: ${error.message || 'Check your connection.'} Your selected status is preserved for retry.${reference}`, 'error');
        return;
      }
      if (!refreshed) {
        showToast('Status saved, but summary percentages could not refresh yet.', 'warning');
      }
    }

    if (field === 'universityTimeline') {
      try {
        const refreshed = await saveChecklistFieldAndRefresh({
          patchChecklistStatus,
          loadUniversityDetail,
          universityId,
          statusId: id,
          data: { universityTimeline: value },
        });
        if (!refreshed) {
          showToast('University Timeline saved, but the refreshed checklist could not load yet.', 'warning');
        }
      } catch (error) {
        const reference = error.correlationId ? ` Reference: ${error.correlationId}.` : '';
        showToast(`University Timeline was not saved: ${error.message || 'Check your connection.'} Your change is preserved for retry.${reference}`, 'error');
      }
    }

    if (
      field === 'status'
      && (enableItemBulkApply || onCopyPrompt)
      && otherClassrooms.length > 0
    ) {
      const updatedItem = { ...item, status: value };
      updatedItem.copyFields = ['status'];
      // A remark typed while this status request was in flight is serialized
      // behind it. Do not interrupt the user with a propagation prompt until
      // that newer remark save has finished and its draft is acknowledged.
      await waitForChecklistSaveIdle(checklistRemarkSaveKey(universityId, id));
      const pendingRemarks = getPendingChecklistDrafts(
        universityId,
        [id],
        ['remarks'],
      );
      if (pendingRemarks.length > 0) {
        deferredStatusPrompts.current.set(String(id), updatedItem);
        return;
      }
      queueCopyPrompt(updatedItem, ['status']);
    }
  };

  const queueCopyPrompt = (item, copyFields) => {
    const prompt = {
      ...item,
      copyFields: [...copyFields],
      promptId: nextPromptId.current++,
    };
    if (onCopyPrompt) {
      onCopyPrompt(prompt, [...copyFields], {
        currentClassroomId,
        currentClassroomName,
      });
      return;
    }
    if (onCommittedFieldSaved) {
      onCommittedFieldSaved(prompt, [...copyFields]);
      return;
    }
    setPendingBulkItems(previous => [...previous, prompt]);
  };

  const handleRemarkSaved = (item, remarks) => {
    // ChecklistRemarkField calls this only after the queue acknowledges the
    // same generation that is still current in the textarea.  Keep the copy
    // snapshot field-scoped so a stale item prop cannot re-save status, dates,
    // or evidence while the remark confirmation is open.
    const committedItem = {
      ...item,
      remarks,
      copyFields: ['remarks'],
    };
    queueCopyPrompt(committedItem, ['remarks']);
    const deferredStatus = deferredStatusPrompts.current.get(String(item.id));
    if (deferredStatus) {
      deferredStatusPrompts.current.delete(String(item.id));
      queueCopyPrompt(deferredStatus, ['status']);
    }
  };

  const addFilesForItem = async (itemId, incoming) => {
    const typeValid = Array.from(incoming).filter(f => {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const okExt = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'mp4', 'mov', 'avi'].includes(ext);
      const okType = f.type.startsWith('image/') || f.type.startsWith('video/');
      return okExt || okType;
    });
    if (!typeValid.length) return;

    const { accepted, rejected } = await validateSelectedMediaFiles(typeValid);
    if (rejected.length) {
      showToast(
        rejected.length === 1
          ? rejected[0].message
          : `${rejected.length} videos were not added because your browser cannot play them. Convert them to MP4 using H.264 video and AAC audio, then try again.`,
        'warning',
      );
    }
    if (!accepted.length) return;

    setPendingFiles(prev => {
      const existing = prev[itemId] || [];
      if (existing.length + accepted.length > 20) {
        showToast('Maximum 20 files at a time', 'warning');
        return prev;
      }
      return { ...prev, [itemId]: [...existing, ...accepted] };
    });
  };

  const removeFileForItem = (itemId, index) => {
    setPendingFiles(prev => {
      const updated = (prev[itemId] || []).filter((_, i) => i !== index);
      return { ...prev, [itemId]: updated };
    });
  };

  const handleUpload = async (item) => {
    const files = pendingFiles[item.id] || [];
    if (!files.length) return;

    setUploading(prev => ({ ...prev, [item.id]: true }));
    const progMap = {};
    files.forEach((_, i) => { progMap[i] = 0; });
    setFileProgress(prev => ({ ...prev, [item.id]: { ...progMap } }));

    try {
      const results = await uploadMultipleFiles(
        files, universityId, item.id, user?.name || 'Field Auditor',
        (index, pct) => setFileProgress(prev => ({
          ...prev,
          [item.id]: { ...(prev[item.id] || {}), [index]: pct },
        }))
      );

      const successfulUploads = results.filter(r => r.objectPath);
      const successPaths = successfulUploads.map(r => r.objectPath);
      const failCount = results.filter(r => r.error).length;

       if (successPaths.length > 0) {
         let automaticStatusApplied = false;
         for (const upload of successfulUploads) {
           // Uploads can take long enough for a status edit to arrive. Read
           // the live item/draft for every request instead of replaying the
           // pre-upload status captured by this handler.
           const latestItem = mergeChecklistItemDraft(
             universityId,
             itemsRef.current.find(candidate => candidate.id === item.id) || item,
           );
            const statusDraft = getChecklistDraft(universityId, item.id)?.fields?.status;
            const uploadPatch = buildUploadPatch(item, latestItem, upload, statusDraft);
            automaticStatusApplied ||= uploadPatch.automaticStatusApplied;
            await patchChecklistStatus(universityId, item.id, uploadPatch.patch);
         }

        setFileProgress(prev => {
          const done = {};
          (pendingFiles[item.id] || []).forEach((_, i) => { done[i] = 100; });
          return { ...prev, [item.id]: done };
        });

         const latestUpload = successfulUploads[successfulUploads.length - 1];
         const latestSourceItem = mergeChecklistItemDraft(
           universityId,
           itemsRef.current.find(candidate => candidate.id === item.id) || item,
         );
         const statusDraft = getChecklistDraft(universityId, item.id)?.fields?.status;
         const committedUpdates = buildCommittedUploadUpdates(
           item,
           latestSourceItem,
           latestUpload,
           automaticStatusApplied,
           statusDraft,
         );
         onUpdateItem(item.id, committedUpdates, { committed: true });
          setPendingFiles(prev => ({ ...prev, [item.id]: [] }));
          setFileProgress(prev => ({ ...prev, [item.id]: {} }));
          setUploading(prev => ({ ...prev, [item.id]: false }));
          loadUniversityDetail(universityId, true).catch(() => {});
          logAuditAction({ action: 'UPLOAD_MEDIA', module: 'Checklist', entityId: item.id, updatedValue: `${successPaths.length} file(s)`, user: user?.name });
          const committedPhotoItem = {
            ...latestSourceItem,
            ...committedUpdates,
            photoLink: latestUpload.objectPath,
            photoContentType: latestUpload.contentType,
          };
          // Evidence is the committed change being offered for propagation.
          // Uploads may promote a source item from "Yet to start" to
          // "In-Progress" as a local convenience, but that status must never
          // become an implicit copy selection.
          queueCopyPrompt(committedPhotoItem, ['photoLink', 'photoContentType']);
        if (failCount > 0) {
          showToast(`${successPaths.length} uploaded, ${failCount} failed`, 'warning');
        } else {
          showToast(`${successPaths.length} file${successPaths.length > 1 ? 's' : ''} uploaded successfully`, 'success');
        }
      } else {
        showToast('All uploads failed. Please try again.', 'error');
        setUploading(prev => ({ ...prev, [item.id]: false }));
      }
    } catch (err) {
      showToast(`Upload failed: ${err.message}`, 'error');
      setUploading(prev => ({ ...prev, [item.id]: false }));
    }
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case 'Done':        return { border: '1px solid rgba(16,185,129,0.2)', background: 'rgba(16,185,129,0.02)' };
      case 'In-Progress': return { border: '1px solid rgba(245,158,11,0.2)', background: 'rgba(245,158,11,0.02)' };
      case 'Blocker':     return { border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.04)' };
      default:            return { border: '1px solid var(--border)', background: 'var(--bg-card)' };
    }
  };

  const getStatusSelectStyle = (status) => {
    switch (status) {
      case 'Done':        return { background: '#10b981', color: 'white', borderColor: '#10b981', glow: 'rgba(16,185,129,0.15)' };
      case 'In-Progress': return { background: '#f59e0b', color: 'white', borderColor: '#f59e0b', glow: 'rgba(245,158,11,0.15)' };
      case 'Blocker':     return { background: '#ef4444', color: 'white', borderColor: '#ef4444', glow: 'rgba(239,68,68,0.15)' };
      default:            return { background: '#2563eb', color: 'white', borderColor: '#2563eb', glow: 'rgba(37,99,235,0.15)' };
    }
  };

  return (
    <div className="checklist-accordion" style={{ marginBottom: '1.5rem' }}>

      <button type="button" className="checklist-header checklist-header-button"
        onClick={() => setIsOpen(open => !open)}
        aria-expanded={isOpen}
        aria-controls={contentId}
        style={{
          background: hasBlocker ? 'rgba(239,68,68,0.08)' : 'var(--bg-card)',
          borderRadius: '12px',
          padding: '1.25rem',
          border: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          width: '100%',
          color: 'var(--text-primary)',
          textAlign: 'left'
        }}>
        <div className="checklist-title-group" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h3 className="font-bold" style={{ fontSize: '1.1rem', margin: 0 }}>{category}</h3>
          <span className={`badge ${progress === 100 ? 'badge-success' : progress >= 50 ? 'badge-warning' : 'badge-danger'}`} style={{ padding: '0.4rem 0.75rem' }}>
            {doneCount}/{categoryItems.length} Complete ({progress}%)
          </span>
          {hasBlocker && <span className="badge badge-danger">⚠ BLOCKER ACTIVE</span>}
        </div>
        {isOpen ? <ChevronUp size={22} /> : <ChevronDown size={22} />}
      </button>

      {isOpen && (
        <div id={contentId} className="checklist-content" style={{ marginTop: '1rem' }}>
          {categoryItems.map(item => {
            const statusStyle = getStatusStyle(item.status);
            const hasPhoto = !!item.photoLink;
            const isVid = isVideoFile(item.photoLink || '', item.photoContentType);
            const itemPending = pendingFiles[item.id] || [];
            const itemProgress = fileProgress[item.id] || {};
            const isUploading = !!uploading[item.id];
            const inputId = `fi-${item.id}`;

            return (
              <div key={item.id}
                ref={targetItem === item ? targetRowRef : null}
                className={`checklist-item-row-premium${targetItem === item ? ' checklist-item-target' : ''}`}
                tabIndex={targetItem === item ? -1 : undefined}
                aria-label={targetItem === item ? `Target checklist item: ${item.name}` : undefined}
                style={{
                  ...statusStyle,
                  borderRadius: '16px',
                  padding: '1.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1.25rem',
                  marginBottom: '1.25rem',
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.02)',
                  borderLeft: `6px solid ${getStatusSelectStyle(item.status).background}`,
                  background: 'var(--bg-card)'
                }}>

                <div className="premium-glow" style={{
                  position: 'absolute', top: '-50px', right: '-50px', width: '250px', height: '250px',
                  background: `radial-gradient(circle, ${getStatusSelectStyle(item.status).glow} 0%, transparent 70%)`,
                  pointerEvents: 'none'
                }} />

                {/* Row 1: Name + Status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
                  <div style={{ flex: '1 1 280px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      <h4 className="font-bold" style={{
                        fontSize: '1.15rem',
                        margin: 0,
                        textDecoration: item.status === 'Done' ? 'line-through' : 'none',
                        opacity: item.status === 'Done' ? 0.6 : 1,
                        color: 'var(--text-primary)'
                      }}>
                        {item.name}
                      </h4>
                      {item.requiresCapacity && (
                        <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>CAPACITY REQUIRED</span>
                      )}
                    </div>
                    {item.spec && <p className="text-secondary" style={{ fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>{item.spec}</p>}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '200px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.25rem' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                        <Clock size={12} /> Updated {formatDate(item.lastUpdated)}
                      </span>
                    </div>
                    <select className="form-select status-select-premium"
                      style={{
                        padding: '0.75rem 1rem',
                        fontSize: '0.95rem',
                        fontWeight: 900,
                        borderRadius: '12px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        ...getStatusSelectStyle(item.status)
                      }}
                      value={item.status}
                      onChange={e => handleFieldChange(item.id, 'status', e.target.value)}>
                      {STATUS_OPTIONS.map(opt => (
                        <option key={opt} value={opt} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontWeight: 600 }}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Row 2: Timelines */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', position: 'relative', zIndex: 1 }}>
                  <div className="form-group">
                    <label style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <PlayCircle size={13} /> Start Date
                    </label>
                    <input type="date" className="form-input" style={{ padding: '0.75rem', fontSize: '0.9rem', borderRadius: '10px', background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
                      value={item.itemStartDate || ''} onChange={e => handleFieldChange(item.id, 'itemStartDate', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <Calendar size={14} /> University Timeline
                    </label>
                    <input type="date" className="form-input" style={{ padding: '0.75rem', fontSize: '0.9rem', borderRadius: '10px', background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
                      value={item.universityTimeline || ''} onChange={e => handleFieldChange(item.id, 'universityTimeline', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label htmlFor={`target-timeline-${item.id}`} style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <Calendar size={14} /> Target Timeline
                    </label>
                    <input id={`target-timeline-${item.id}`} type="date" className="form-input" style={{ padding: '0.75rem', fontSize: '0.9rem', borderRadius: '10px', background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
                      value={item.targetDate || ''} onChange={e => handleFieldChange(item.id, 'targetDate', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <CheckCircle size={14} /> Actual Completion
                    </label>
                    <input type="date" className="form-input" style={{ padding: '0.75rem', fontSize: '0.9rem', borderRadius: '10px', background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
                      value={item.actualDate || ''} onChange={e => handleFieldChange(item.id, 'actualDate', e.target.value)} />
                  </div>
                </div>

                {/* Capacity */}
                {item.requiresCapacity && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.25rem', background: 'rgba(245,158,11,0.06)', borderRadius: '12px', border: '1px solid rgba(245,158,11,0.15)' }}>
                    <Ruler size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--warning)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Required Capacity</span>
                    <input type="text" className="form-input"
                      style={{ flex: 1, padding: '0.6rem 1rem', fontSize: '0.95rem', borderColor: 'rgba(245,158,11,0.3)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                      placeholder="e.g. 62.5 KVA"
                      value={item.capacity || ''} onChange={e => handleFieldChange(item.id, 'capacity', e.target.value)} />
                  </div>
                )}

                {/* Photo & Remarks Section */}
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
                  <div style={{ flex: '0 0 auto', minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

                    {/* ── Always-present hidden file input ── */}
                    {/* The label below is the ONLY trigger — no JS .click() calls */}
                    <input
                      id={inputId}
                      type="file"
                      accept={ACCEPTED_TYPES}
                      multiple
                      disabled={isUploading}
                      style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0, overflow: 'hidden', zIndex: -1 }}
                      onChange={async e => {
                        if (e.target.files?.length) {
                          const selectedFiles = Array.from(e.target.files);
                          e.target.value = '';
                          await addFilesForItem(item.id, selectedFiles);
                        }
                      }}
                    />

                    {/* Current photo/video preview */}
                    {hasPhoto && !itemPending.length && !isUploading && (
                      <div style={{ position: 'relative', height: '120px', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 8px 16px rgba(0,0,0,0.08)' }}>
                        {isVid ? (
                          <EvidenceMedia
                            path={item.photoLink}
                            contentType={item.photoContentType}
                            alt="Evidence"
                            controls
                            muted
                            videoStyle={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' }}
                          />
                        ) : (
                          <ChecklistPhotoPreview
                            key={item.photoLink}
                            path={item.photoLink}
                            contentType={item.photoContentType}
                            onOpen={() => setLightboxItem(item)}
                          />
                        )}
                        <button type="button" onClick={(e) => {
                          e.stopPropagation();
                          // Keep the clear explicit in the draft. Saving only
                          // an omitted photo field would preserve the server's
                          // current reference, while history must remain an
                          // audit gallery and never repopulate this preview.
                          onUpdateItem(item.id, {
                            photoLink: '',
                            photoContentType: null,
                            lastUpdated: new Date().toISOString(),
                          });
                        }}
                          style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.75)', color: 'white', border: 'none', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem' }}>✕</button>
                      </div>
                    )}

                    {/* No media placeholder */}
                    {!hasPhoto && !itemPending.length && !isUploading && (
                      <div style={{ height: '120px', borderRadius: '12px', border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(59,130,246,0.02)', color: 'var(--text-secondary)', fontSize: '0.8rem', flexDirection: 'column', gap: '0.5rem' }}>
                        <Camera size={22} style={{ opacity: 0.4 }} />
                        <span>No media yet</span>
                      </div>
                    )}

                    {/* Pending files preview strip */}
                    {(itemPending.length > 0 || isUploading) && (
                      <div style={{ border: '1px solid var(--border)', borderRadius: '12px', padding: '0.75rem', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {itemPending.map((f, i) => (
                            <FilePreviewThumb
                              key={`${f.name}-${i}`}
                              file={f}
                              progress={isUploading ? (itemProgress[i] ?? 0) : undefined}
                              onRemove={isUploading ? null : () => removeFileForItem(item.id, i)}
                            />
                          ))}
                          {/* Add more — label directly triggers the same input */}
                          {!isUploading && (
                            <label htmlFor={inputId} style={{ width: '80px', height: '60px', border: '2px dashed var(--border)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: 'var(--text-secondary)' }}>
                              <Plus size={20} />
                            </label>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                           <button
                             type="button"
                            onClick={() => handleUpload(item)}
                            disabled={isUploading || !itemPending.length}
                            style={{ flex: 1, padding: '0.6rem', borderRadius: '8px', border: 'none', background: isUploading ? 'var(--bg-secondary)' : 'var(--accent-primary)', color: isUploading ? 'var(--text-secondary)' : 'white', fontWeight: 700, fontSize: '0.82rem', cursor: isUploading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                            {isUploading ? <><Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> Uploading…</> : <><Upload size={13} /> Upload {itemPending.length} file{itemPending.length !== 1 ? 's' : ''}</>}
                          </button>
                          {!isUploading && (
                             <button
                               type="button"
                              onClick={() => { setPendingFiles(p => ({ ...p, [item.id]: [] })); setFileProgress(p => ({ ...p, [item.id]: {} })); }}
                              style={{ padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Upload button — THIS IS A LABEL so clicking it opens the file picker natively */}
                    <label
                      htmlFor={isUploading ? undefined : inputId}
                      style={{
                        fontSize: '0.85rem',
                        padding: '0.75rem',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: '0.5rem',
                        cursor: isUploading ? 'not-allowed' : 'pointer',
                        background: 'var(--bg-primary)',
                        fontWeight: 700,
                        borderRadius: '10px',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        userSelect: 'none',
                      }}>
                      <Upload size={16} />
                      {hasPhoto || itemPending.length > 0 ? 'Add More Media' : 'Upload Photo / Video'}
                    </label>

                    {item.id && (
                      <PhotoHistory
                        key={item.photoLink || item.id}
                        statusUpdateId={item.id}
                        onPhotoDeleted={(newUrl, newContentType) => {
                          onUpdateItem(item.id, {
                            photoLink: newUrl,
                            photoUrl: newUrl,
                            photoContentType: newContentType,
                          }, { committed: true });
                          loadUniversityDetail(universityId, true).catch(() => {});
                        }}
                      />
                    )}
                  </div>

                  <ChecklistRemarkField
                    item={item}
                    universityId={universityId}
                    patchChecklistStatus={patchChecklistStatus}
                    onUpdateItem={onUpdateItem}
                    showToast={showToast}
                    onRemarkSaved={remarks => handleRemarkSaved(item, remarks)}
                    onFocusChange={focused => onRemarkFocusChange?.(item.id, focused)}
                  />
                </div>

                <style>{`
                  .checklist-item-row-premium:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 12px 24px rgba(0,0,0,0.06);
                  }
                `}</style>
              </div>
            );
          })}
        </div>
      )}

      {lightboxItem && (
        <ImageLightbox
          images={[{
            id: lightboxItem.id,
            photoUrl: lightboxItem.photoLink,
            contentType: lightboxItem.photoContentType,
            itemName: lightboxItem.name,
            uploadedAt: lightboxItem.lastUpdated,
          }]}
          startIndex={0}
          onClose={() => setLightboxItem(null)}
        />
      )}

      {pendingBulkItems[0] && enableItemBulkApply && otherClassrooms.length > 0 && (
        <ItemBulkApplyModal
          key={pendingBulkItems[0].promptId}
          item={pendingBulkItems[0]}
          universityId={universityId}
          classrooms={classrooms}
          currentClassroomId={currentClassroomId}
          currentClassroomName={currentClassroomName}
          copyFields={pendingBulkItems[0].copyFields}
          pendingUploads={
            ((pendingFiles[pendingBulkItems[0].id] || []).length > 0)
            || !!uploading[pendingBulkItems[0].id]
          }
          onClose={() => setPendingBulkItems(previous => {
            if (previous[0]?.promptId !== pendingBulkItems[0].promptId) return previous;
            return previous.slice(1);
          })}
          onApplied={() => setPendingBulkItems(previous => {
            if (previous[0]?.promptId !== pendingBulkItems[0].promptId) return previous;
            return previous.slice(1);
          })}
        />
      )}
    </div>
  );
}
