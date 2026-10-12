import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { X, Copy, CheckSquare, Square, Loader, ChevronRight, Home } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import {
  getChecklistDraftSubmission,
  getPendingChecklistDrafts,
} from '../../utils/checklistDraftStore';
import { checklistRemarkSaveKey, getChecklistRemarkSaveState } from '../../utils/checklistRemarkSaveQueue';
import {
  buildBulkUpdate,
  describeCopyFields,
  getBulkResultSummary,
  getBulkTargetIssue,
  getBulkTargetItem,
  getSourceIssue,
  formatBulkApplyError,
  normalizeCopyFields,
} from './bulkApplyContract';

const STATUS_COLOR = {
  'Partially Done':  { bg: '#b45309', text: 'white' },
  'Done':              { bg: '#10b981', text: 'white' },
  'In-Progress':       { bg: '#f59e0b', text: 'white' },
  'Blocker':           { bg: '#ef4444', text: 'white' },
  'Yet to start':      { bg: '#2563eb', text: 'white' },
  'No info as of now': { bg: '#6b7280', text: 'white' },
  'Need to revamp':    { bg: '#8b5cf6', text: 'white' },
};

function StatusChip({ status }) {
  const s = STATUS_COLOR[status] || { bg: '#6b7280', text: 'white' };
  return (
    <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: '999px', background: s.bg, color: s.text, whiteSpace: 'nowrap' }}>
      {status || 'Yet to start'}
    </span>
  );
}

export default function ItemBulkApplyModal({
  item,
  universityId,
  classrooms,
  currentClassroomId,
  currentClassroomName,
  copyFields,
  pendingUploads = false,
  onClose,
  onApplied,
}) {
  const { patchChecklistBulk, loadUniversityDetail } = useData();
  const { showToast } = useToast();

  const otherClassrooms = useMemo(
    () => classrooms.filter(c => c.id !== currentClassroomId),
    [classrooms, currentClassroomId]
  );

  const [scope, setScope] = useState('only');
  const [selectedRooms, setSelectedRooms] = useState(() => new Set(
    otherClassrooms.filter(room => !getBulkTargetIssue(room, item)).map(c => c.id),
  ));
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState(null);
  const [applyGuidance, setApplyGuidance] = useState(null);
  const applyingRef = useRef(false);
  const fieldsToCopy = normalizeCopyFields(copyFields);

  // Lock body scroll + ESC to close
  const stableClose = useCallback(() => {
    if (!applyingRef.current) onClose?.();
  }, [onClose]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') stableClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [stableClose]);

  const getExistingStatus = useCallback((room) => {
    const st = getBulkTargetItem(room, item);
    return st?.status || 'Yet to start';
  }, [item.checklistItemId]);

  const toggleRoom = (id) => setSelectedRooms(prev => {
    if (applyingRef.current) return prev;
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const requestClose = () => {
    if (!applyingRef.current) onClose?.();
  };

  const finishWithoutCopy = () => {
    if (applyingRef.current) return;
    // The source field is committed before this prompt is queued. Choosing
    // the source classroom only is therefore a dismissal, not a copy action,
    // and must not be blocked by destination/source-copy validation.
    showToast(`"${item.name}" was already saved to ${currentClassroomName || 'this classroom'}.`, 'success');
    onApplied?.();
    onClose?.();
  };

  const handleApply = async () => {
    if (applyingRef.current) return;
    if (scope === 'only') {
      finishWithoutCopy();
      return;
    }
    const sourceIssue = getSourceIssue(item);
    if (sourceIssue) {
      setApplyError(sourceIssue);
      return;
    }
    if (scope !== 'only' && pendingUploads) {
      const message = 'Copy is blocked while this source item has a pending upload. Finish or remove staged files, then retry.';
      setApplyError(message);
      showToast(message, 'warning');
      return;
    }
    let sourceSnapshot = item;
    let pendingSourceDrafts = getPendingChecklistDrafts(universityId, [item.id], fieldsToCopy);
    const confirmedSource = pendingSourceDrafts.length > 0
      ? getChecklistDraftSubmission(universityId, item.id)?.data || {}
      : null;
    const pendingWrites = pendingSourceDrafts
      .map(draft => getChecklistRemarkSaveState(
        checklistRemarkSaveKey(universityId, draft.statusId),
      )?.promise)
      .filter(Boolean);
    if (pendingWrites.length > 0) {
      applyingRef.current = true;
      setApplying(true);
      setApplyError(null);
      await Promise.allSettled(pendingWrites);
      pendingSourceDrafts = getPendingChecklistDrafts(universityId, [item.id], fieldsToCopy);
      if (confirmedSource) {
        sourceSnapshot = { ...item };
        fieldsToCopy.forEach(field => {
          if (Object.prototype.hasOwnProperty.call(confirmedSource, field)) {
            sourceSnapshot[field] = confirmedSource[field];
          }
        });
      }
    }
    if (pendingSourceDrafts.length > 0) {
      const message = `A newer source edit for ${pendingSourceDrafts.map(draft => draft.label).join(', ')} is still unsaved. Wait for it to finish or retry it before copying.`;
      setApplyError(message);
      showToast(message, 'warning');
      applyingRef.current = false;
      setApplying(false);
      return;
    }
    applyingRef.current = true;
    setApplying(true);
    setApplyError(null);
    setApplyGuidance(null);

    const targetRooms = scope === 'all'
      ? otherClassrooms
      : otherClassrooms.filter(c => selectedRooms.has(c.id));

    const unavailable = targetRooms
      .map(room => ({ room, reason: getBulkTargetIssue(room, item) }))
      .filter(entry => entry.reason);
    if (unavailable.length > 0) {
      const details = unavailable
        .map(({ room, reason }) => `${room.room_id || room.id}: ${reason}`)
        .join(' ');
      const message = `Cannot copy to ${unavailable.length} selected classroom${unavailable.length === 1 ? '' : 's'}: ${details}`;
      setApplyError(message);
      showToast(message, 'error');
      applyingRef.current = false;
      setApplying(false);
      return;
    }
    if (targetRooms.length === 0) {
      const message = 'No destination classrooms are selected. Choose at least one valid classroom and retry.';
      setApplyError(message);
      showToast(message, 'warning');
      applyingRef.current = false;
      setApplying(false);
      return;
    }

    try {
      const update = buildBulkUpdate(sourceSnapshot, targetRooms, fieldsToCopy);
      const result = await patchChecklistBulk(universityId, [
        update,
      ]);
      const summary = getBulkResultSummary(result, targetRooms.length, update.targetStatusIds);
      if (!summary.complete) {
        if (!summary.targetIdsMatch) {
          const guidance = formatBulkApplyError({ code: 'CHECKLIST_BULK_RESULT_MISMATCH' }, { action: 'Copy' });
          setApplyError(guidance.text);
          setApplyGuidance(guidance);
          showToast(guidance.text, 'warning');
          return;
        }
        const message = `Copy reached ${summary.successful} of ${summary.expected} selected classroom${summary.expected !== 1 ? 's' : ''}`
          + `${summary.skipped ? `; ${summary.skipped} skipped` : ''}. `
          + 'No source data was changed. Review the destinations and retry.';
        setApplyError(message);
        showToast(message, 'warning');
        return;
      }
      try {
        await loadUniversityDetail(universityId, true);
        showToast(
          `"${item.name}" copied ${describeCopyFields(fieldsToCopy)} to ${summary.successful} classroom${summary.successful !== 1 ? 's' : ''}`
            + `${summary.unchanged ? ` (${summary.unchanged} already matched)` : ''}.`,
          'success',
        );
      } catch {
        showToast('The classroom copy was saved, but summary data could not refresh yet. Reload to verify destinations.', 'warning');
      }
      onApplied?.(result);
      onClose();
    } catch (err) {
      const guidance = formatBulkApplyError(err, { action: 'Copy' });
      setApplyError(guidance.text);
      setApplyGuidance(guidance);
      const isRecoveryWarning = ['busy', 'concurrency', 'related-record', 'source-changed', 'destination', 'pending-draft'].includes(guidance.kind);
      showToast(guidance.text, isRecoveryWarning ? 'warning' : 'error');
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };

  const targetCount = scope === 'all'
    ? otherClassrooms.length
    : scope === 'selected'
    ? selectedRooms.size
    : 0;

  const btnDisabled = applying || (scope !== 'only' && targetCount === 0);
  const retryBlocked = !!applyGuidance && !applyGuidance.retryable;
  const unavailableRooms = otherClassrooms.filter(room => getBulkTargetIssue(room, item));

  const SCOPE_OPTIONS = [
    {
      value: 'only',
      label: 'Only this classroom',
      desc: `The ${describeCopyFields(fieldsToCopy)} change is already saved to ${currentClassroomName || 'this classroom'}. No other rooms change.`,
    },
    {
      value: 'selected',
      label: 'Selected classrooms',
      desc: 'Choose which rooms to update below.',
    },
    {
      value: 'all',
      label: `All destination classrooms (${otherClassrooms.length})`,
      desc: 'Apply to every valid destination room in this university.',
    },
  ];

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-busy={applying}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        backdropFilter: 'blur(2px)',
      }}
      onClick={e => e.target === e.currentTarget && requestClose()}>

      <div style={{
        background: 'var(--bg-primary)',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '480px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 32px 80px rgba(0,0,0,0.45)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          background: 'rgba(37,99,235,0.04)',
          flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Apply this update to other classrooms?
            </h3>

            {/* Source classroom badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.4rem' }}>
              <Home size={11} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                Updating from:
              </span>
              <span style={{ fontSize: '0.73rem', fontWeight: 800, color: 'var(--text-primary)', background: 'rgba(37,99,235,0.1)', padding: '0.1rem 0.45rem', borderRadius: '6px' }}>
                {currentClassroomName || 'Current classroom'}
              </span>
            </div>

            {/* Item + new status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>
                {item.name}
              </span>
              <ChevronRight size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              <StatusChip status={item.status} />
            </div>
            <p style={{ margin: '0.55rem 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              This confirmation copies <strong>{describeCopyFields(fieldsToCopy)}</strong> only. Other fields in each destination remain unchanged.
            </p>
          </div>
          <button
            onClick={requestClose}
            disabled={applying}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0.2rem', flexShrink: 0, marginLeft: '0.75rem' }}
            aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>

          {SCOPE_OPTIONS.map(opt => (
            <label
              key={opt.value}
              onClick={() => {
                if (applying) return;
                if (opt.value === 'only') {
                  finishWithoutCopy();
                  return;
                }
                setScope(opt.value);
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.875rem',
                padding: '0.875rem 1rem',
                borderRadius: '12px',
                cursor: 'pointer',
                background: scope === opt.value ? 'rgba(37,99,235,0.07)' : 'var(--bg-secondary)',
                border: `2px solid ${scope === opt.value ? 'var(--accent-primary)' : 'var(--border)'}`,
                transition: 'all 0.15s',
              }}>
              <div style={{
                width: '17px',
                height: '17px',
                borderRadius: '50%',
                border: `2px solid ${scope === opt.value ? 'var(--accent-primary)' : '#cbd5e1'}`,
                background: scope === opt.value ? 'var(--accent-primary)' : 'var(--bg-card)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: '2px',
                transition: 'all 0.15s',
              }}>
                {scope === opt.value && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'white' }} />}
              </div>
              <div>
                <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>{opt.label}</p>
                <p style={{ margin: '0.1rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{opt.desc}</p>
              </div>
            </label>
          ))}

          {/* Classroom checkbox list — only for 'selected' */}
          {scope === 'selected' && (
            <div style={{ marginTop: '0.25rem', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.6rem 0.875rem',
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                  {selectedRooms.size} / {otherClassrooms.length} selected
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => setSelectedRooms(new Set(otherClassrooms
                      .filter(room => !getBulkTargetIssue(room, item))
                      .map(c => c.id)))}
                    style={{ fontSize: '0.72rem', background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 700 }}>
                    All
                  </button>
                  <button
                    onClick={() => setSelectedRooms(new Set())}
                    style={{ fontSize: '0.72rem', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700 }}>
                    None
                  </button>
                </div>
              </div>
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {otherClassrooms.map(room => {
                  const checked = selectedRooms.has(room.id);
                  const existingStatus = getExistingStatus(room);
                  const issue = getBulkTargetIssue(room, item);
                  return (
                    <label
                      key={room.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.6rem 0.875rem',
                         cursor: issue ? 'not-allowed' : 'pointer',
                         background: issue ? 'rgba(239,68,68,0.06)' : checked ? 'rgba(37,99,235,0.08)' : 'var(--bg-card)',
                        borderBottom: '1px solid var(--border)',
                        transition: 'background 0.12s',
                      }}
                        onClick={() => !applying && !issue && toggleRoom(room.id)}>
                      {checked
                        ? <CheckSquare size={15} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                        : <Square size={15} style={{ color: '#cbd5e1', flexShrink: 0 }} />}
                      <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: checked ? 700 : 500, color: 'var(--text-primary)' }}>
                        {room.room_id}
                      </span>
                       {issue
                         ? <span style={{ fontSize: '0.63rem', color: 'var(--danger)', textAlign: 'right' }}>{issue}</span>
                         : <StatusChip status={existingStatus} />}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {unavailableRooms.length > 0 && (
            <div role="alert" style={{ padding: '0.7rem 0.8rem', borderRadius: '9px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
               <strong style={{ color: 'var(--danger)' }}>Unavailable destinations:</strong>{' '}
               {unavailableRooms.map(room => room.room_id || room.id).join(', ')}. They are not selectable because their classroom/checklist destination is not valid for this source item. Review the details above and reload after correcting the destination.
            </div>
          )}

          {applyError && (
           <div role="alert" aria-live="polite" style={{ padding: '0.7rem 0.8rem', borderRadius: '9px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'var(--danger)', fontSize: '0.75rem' }}>
              {applyError}
            </div>
          )}
        </div>

        {/* Sticky footer */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.75rem',
          background: 'var(--bg-primary)',
          flexShrink: 0,
        }}>
           <button onClick={requestClose} disabled={applying} className="button button-secondary" style={{ fontSize: '0.85rem', minHeight: '40px', padding: '0 1.25rem', opacity: applying ? 0.6 : 1 }}>
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={btnDisabled || retryBlocked}
            className="button button-primary"
            style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: btnDisabled || retryBlocked ? 0.55 : 1, minHeight: '40px', padding: '0 1.25rem' }}>
            {applying
              ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Applying…</>
               : scope === 'only'
               ? 'Close'
                : applyError
                ? retryBlocked ? 'Refresh before retrying' : 'Retry copy'
               : <><Copy size={13} /> Apply to {scope === 'all' ? `all ${otherClassrooms.length}` : targetCount} destination room{targetCount !== 1 ? 's' : ''}</>
            }
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
