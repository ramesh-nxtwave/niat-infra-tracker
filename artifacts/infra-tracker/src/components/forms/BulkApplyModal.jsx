import React, { useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, CheckSquare, Square, AlertTriangle, Loader, Search } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { checklistRemarkSaveKey, getChecklistRemarkSaveState } from '../../utils/checklistRemarkSaveQueue';
import {
  getChecklistDraftSubmission,
  getPendingChecklistDrafts,
} from '../../utils/checklistDraftStore';
import {
  buildBulkUpdate,
  describeCopyFields,
  getBulkResultSummary,
  getBulkTargetIssue,
  getBulkTargetItem,
  getSourceIssue,
  formatBulkApplyError,
  WHOLE_CLASSROOM_COPY_FIELDS,
  MODEL_CLASSROOM_COPY_FIELDS,
  MODEL_CLASSROOM_COPY_FIELD_LABELS,
  normalizeCopyFields,
} from './bulkApplyContract';

const STATUS_COLOR = {
  'Partially Done':  { bg: '#b45309', text: 'white' },
  'Done':            { bg: '#10b981', text: 'white' },
  'In-Progress':     { bg: '#f59e0b', text: 'white' },
  'Blocker':         { bg: '#ef4444', text: 'white' },
  'Yet to start':    { bg: '#2563eb', text: 'white' },
  'No info as of now': { bg: '#6b7280', text: 'white' },
  'Need to revamp':  { bg: '#8b5cf6', text: 'white' },
};

function StatusChip({ status }) {
  const s = STATUS_COLOR[status] || { bg: '#6b7280', text: 'white' };
  return (
    <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '999px', background: s.bg, color: s.text, whiteSpace: 'nowrap' }}>
      {status || 'Yet to start'}
    </span>
  );
}

export default function BulkApplyModal({
  universityId,
  savedItems,
  classrooms,
  currentClassroomId,
  onClose,
  onApplied,
  mode = 'ordinary',
  copyFields,
  skipBlankValues = false,
  sourceSpaceType,
  includePhotoMetadata = false,
  pendingUploads = false,
  sourceLabel,
  defaultSelectedCopyFields,
}) {
  const { patchChecklistBulk, loadUniversityDetail } = useData();
  const { showToast } = useToast();
  const isModelMode = mode === 'model';
  const effectiveSourceSpaceType = isModelMode
    ? (sourceSpaceType || 'model_classroom')
    : undefined;
  const targetMatchOptions = effectiveSourceSpaceType
    ? { sourceSpaceType: effectiveSourceSpaceType }
    : undefined;
  const requestedCopyFields = isModelMode
    ? (copyFields || MODEL_CLASSROOM_COPY_FIELDS)
    : (copyFields || WHOLE_CLASSROOM_COPY_FIELDS);
  const availableCopyFields = useMemo(
    () => normalizeCopyFields(requestedCopyFields),
    [requestedCopyFields],
  );
  const fieldLabels = isModelMode ? MODEL_CLASSROOM_COPY_FIELD_LABELS : undefined;
  const initialSelectedCopyFields = defaultSelectedCopyFields == null
    ? availableCopyFields
    : normalizeCopyFields(defaultSelectedCopyFields)
      .filter(field => availableCopyFields.includes(field));

  const otherClassrooms = useMemo(
    () => classrooms.filter(c => c.id !== currentClassroomId),
    [classrooms, currentClassroomId]
  );

  const [selectedItems, setSelectedItems] = useState(() => new Set(savedItems.map(i => i.id)));
  const [selectedRooms, setSelectedRooms] = useState(() => new Set(
    otherClassrooms
      .filter(room => savedItems.every(item => !getBulkTargetIssue(room, item, targetMatchOptions)))
      .map(c => c.id),
  ));
  const [skipDone, setSkipDone] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState(null);
  const [applyGuidance, setApplyGuidance] = useState(null);
  const [roomSearch, setRoomSearch] = useState('');
  const [selectedCopyFields, setSelectedCopyFields] = useState(
    () => new Set(initialSelectedCopyFields),
  );
  const applyingRef = useRef(false);
  const fieldsToApply = isModelMode ? availableCopyFields.filter(field => selectedCopyFields.has(field)) : availableCopyFields;
  const describedFields = describeCopyFields(fieldsToApply, { labels: fieldLabels });

  const requestClose = () => {
    // A dismissed dialog must not leave an in-flight mutation without a
    // visible recovery state, and reopening it must not allow a second copy
    // to be submitted while the first one is still pending.
    if (applyingRef.current) return;
    onClose?.();
  };

  const filteredRooms = useMemo(
    () => otherClassrooms.filter(c => c.room_id?.toLowerCase().includes(roomSearch.toLowerCase())),
    [otherClassrooms, roomSearch]
  );

  const toggleItem = (id) => setSelectedItems(prev => {
    if (applyingRef.current) return prev;
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleRoom = (id) => setSelectedRooms(prev => {
    if (applyingRef.current) return prev;
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selectAllRooms = () => {
    if (applyingRef.current) return;
    setSelectedRooms(new Set(filteredRooms
      .filter(room => savedItems
        .filter(item => selectedItems.has(item.id))
         .every(item => !getBulkTargetIssue(room, item, targetMatchOptions)))
      .map(c => c.id)));
  };
  const clearAllRooms = () => {
    if (!applyingRef.current) setSelectedRooms(new Set());
  };
  const selectAllItems = () => {
    if (!applyingRef.current) setSelectedItems(new Set(savedItems.map(i => i.id)));
  };
  const clearAllItems = () => {
    if (!applyingRef.current) setSelectedItems(new Set());
  };
  const toggleCopyField = (field) => setSelectedCopyFields(previous => {
    if (applyingRef.current) return previous;
    const next = new Set(previous);
    next.has(field) ? next.delete(field) : next.add(field);
    return next;
  });
  const selectAllCopyFields = () => {
    if (!applyingRef.current) setSelectedCopyFields(new Set(availableCopyFields));
  };
  const clearAllCopyFields = () => {
    if (!applyingRef.current) setSelectedCopyFields(new Set());
  };

  const getExistingStatus = (room, item) => {
    const existing = getBulkTargetItem(room, item, targetMatchOptions);
    return existing?.status || 'Yet to start';
  };

  const doneRoomCount = (item) =>
    otherClassrooms.filter(c => selectedRooms.has(c.id) && getExistingStatus(c, item) === 'Done').length;

  const handleApply = async () => {
    if (applyingRef.current) return;
    let itemsToApply = savedItems
      .filter(i => selectedItems.has(i.id))
      .map(item => ({ ...item }));
    const roomsToApply = otherClassrooms.filter(c => selectedRooms.has(c.id));
    if (itemsToApply.length === 0 || roomsToApply.length === 0) {
      const message = 'Select at least one item and one valid classroom.';
      setApplyError(message);
      showToast(message, 'warning');
      return;
    }
    if (fieldsToApply.length === 0) {
      const message = 'Select at least one field to copy.';
      setApplyError(message);
      showToast(message, 'warning');
      return;
    }
    if (pendingUploads) {
      const message = 'Copy is blocked while a source upload is pending. Finish or remove staged files, then retry.';
      setApplyError(message);
      showToast(message, 'warning');
      return;
    }

    // Prompts are field-scoped. An unrelated source draft must not block a
    // saved remark/photo snapshot, while a newer draft for any selected field
    // remains a real source race and must wait for acknowledgement.
    let pendingSourceDrafts = getPendingChecklistDrafts(
      universityId,
      itemsToApply.map(item => item.id),
      fieldsToApply,
    );
    const confirmedSourceValues = new Map(
      pendingSourceDrafts
        .map(draft => [
          String(draft.statusId),
          getChecklistDraftSubmission(universityId, draft.statusId)?.data || {},
        ]),
    );
    // A successful source save can still be in the per-item queue when the
    // confirmation is clicked (for example, Save Checklist followed a remark
    // blur by a few milliseconds). Wait for that admitted write, then inspect
    // the generations again. Drafts without a live writer remain a genuine
    // newer-edit conflict and are never silently folded into this snapshot.
    if (pendingSourceDrafts.length > 0) {
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
        pendingSourceDrafts = getPendingChecklistDrafts(
          universityId,
          itemsToApply.map(item => item.id),
          fieldsToApply,
        );
        // The queue may have completed and acknowledged the draft before
        // React receives the cache refresh. Use only the values captured from
        // that acknowledged generation to rebuild this prompt's source
        // snapshot; unrelated fields remain the original user-selected
        // snapshot and are still protected by the server's source check.
        itemsToApply = itemsToApply.map(item => {
          const confirmed = confirmedSourceValues.get(String(item.id));
          if (!confirmed) return item;
          const next = { ...item };
          fieldsToApply.forEach(field => {
            if (Object.prototype.hasOwnProperty.call(confirmed, field)) {
              next[field] = confirmed[field];
            }
          });
          return next;
        });
      }
    }
    if (pendingSourceDrafts.length > 0) {
      const message = `Newer source edits for ${pendingSourceDrafts.map(draft => draft.label).join(', ')} are still unsaved. Wait for the latest save or retry before copying this snapshot.`;
      setApplyError(message);
      showToast(message, 'warning');
      applyingRef.current = false;
      setApplying(false);
      return;
    }

    const sourceIssue = itemsToApply.map(item => getSourceIssue(item)).find(Boolean);
    const unavailable = roomsToApply.flatMap(room => itemsToApply
       .map(item => ({ room, item, reason: getBulkTargetIssue(room, item, targetMatchOptions) }))
      .filter(entry => entry.reason));
    if (sourceIssue || unavailable.length > 0) {
      const message = sourceIssue
        || `Cannot copy because ${unavailable[0].room.room_id || unavailable[0].room.id} is unavailable for ${unavailable[0].item.name}: ${unavailable[0].reason}`;
      setApplyError(message);
      showToast(message, 'error');
      applyingRef.current = false;
      setApplying(false);
      return;
    }

    applyingRef.current = true;
    setApplying(true);
    setApplyError(null);
    setApplyGuidance(null);
    try {
      const updates = itemsToApply.map(item =>
        buildBulkUpdate(item, roomsToApply, fieldsToApply, {
          skipDone: isModelMode ? false : skipDone,
          skipBlankValues: isModelMode && skipBlankValues,
           sourceSpaceType: effectiveSourceSpaceType,
          includePhotoMetadata: isModelMode && includePhotoMetadata,
        }));

      const result = await patchChecklistBulk(universityId, updates);
      const summary = getBulkResultSummary(
        result,
        itemsToApply.length * roomsToApply.length,
        updates.flatMap(update => update.targetStatusIds || []),
      );
      if (!summary.complete) {
        if (!summary.targetIdsMatch) {
          const guidance = formatBulkApplyError({ code: 'CHECKLIST_BULK_RESULT_MISMATCH' });
          setApplyError(guidance.text);
          setApplyGuidance(guidance);
          showToast(guidance.text, 'warning');
          return;
        }
        const message = `Copy reached ${summary.successful} of ${summary.expected} selected item destinations`
          + `${summary.skipped ? `; ${summary.skipped} skipped` : ''}. `
          + 'No source data was changed. Review the destinations and retry.';
        setApplyError(message);
        showToast(message, 'warning');
        return;
      }
      try {
        await loadUniversityDetail(universityId, true);
        showToast(
          `Copied ${describedFields} to ${summary.successful} item destination${summary.successful !== 1 ? 's' : ''}`
            + `${summary.unchanged ? ` (${summary.unchanged} already matched)` : ''}.`,
          'success',
        );
      } catch {
        showToast('Bulk changes were saved, but summary data could not refresh yet. Reload to verify destinations.', 'warning');
      }
      onApplied?.(result);
      onClose();
    } catch (err) {
      const guidance = formatBulkApplyError(err);
      setApplyError(guidance.text);
      setApplyGuidance(guidance);
      const isRecoveryWarning = ['busy', 'concurrency', 'related-record', 'source-changed', 'destination', 'pending-draft'].includes(guidance.kind);
      showToast(guidance.text, isRecoveryWarning ? 'warning' : 'error');
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };

  if (otherClassrooms.length === 0) return null;
  const retryBlocked = !!applyGuidance && !applyGuidance.retryable;

  // The real classroom host has animated/transformed ancestors. Mount at the
  // document root so fixed positioning stays viewport-scoped.
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      aria-busy={applying}
      onClick={e => e.target === e.currentTarget && requestClose()}>
      <div role="dialog" aria-modal="true" style={{ background: 'var(--bg-primary)', borderRadius: '16px', width: '100%', maxWidth: '720px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 60px rgba(0,0,0,0.4)', border: '1px solid var(--border)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(37,99,235,0.05)' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
               <Copy size={18} style={{ color: 'var(--accent-primary)' }} /> {isModelMode ? 'Copy Model Classroom to Other Rooms' : 'Apply to Other Classrooms'}
            </h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Copy the saved {sourceLabel || (isModelMode ? 'Model Classroom' : 'source')} snapshot to one or more classrooms. This writes {describedFields} only; unrelated destination fields remain unchanged.
            </p>
          </div>
          <button onClick={requestClose} disabled={applying} aria-label="Close" style={{ background: 'none', border: 'none', cursor: applying ? 'not-allowed' : 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', padding: '0.4rem', opacity: applying ? 0.5 : 1 }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Items to propagate */}
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
                Checklist Items to Propagate
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={selectAllItems} style={{ fontSize: '0.7rem', background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 700 }}>All</button>
                <button onClick={clearAllItems} style={{ fontSize: '0.7rem', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700 }}>None</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '200px', overflowY: 'auto', paddingRight: '0.25rem' }}>
              {savedItems.map(item => {
                const checked = selectedItems.has(item.id);
                const doneCount = doneRoomCount(item);
                return (
                  <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.875rem', borderRadius: '10px', cursor: 'pointer', background: checked ? 'rgba(37,99,235,0.07)' : 'var(--bg-secondary)', border: `1px solid ${checked ? 'rgba(37,99,235,0.2)' : 'var(--border)'}`, transition: 'all 0.15s' }}>
                    <input type="checkbox" checked={checked} disabled={applying} onChange={() => toggleItem(item.id)} style={{ display: 'none' }} />
                    {checked
                      ? <CheckSquare size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                      : <Square size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                    }
                    <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: checked ? 700 : 500, color: 'var(--text-primary)' }}>{item.name}</span>
                    <StatusChip status={item.status} />
                    {!isModelMode && skipDone && doneCount > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.65rem', color: '#f59e0b', fontWeight: 700 }}>
                        <AlertTriangle size={10} /> {doneCount} Done
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </section>

          {isModelMode && (
            <section>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
                  Fields to copy
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={selectAllCopyFields} style={{ fontSize: '0.7rem', background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 700 }}>All</button>
                  <button type="button" onClick={clearAllCopyFields} style={{ fontSize: '0.7rem', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700 }}>None</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.4rem' }}>
                {availableCopyFields.map(field => {
                  const checked = selectedCopyFields.has(field);
                  return (
                    <label key={field} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.6rem 0.875rem', borderRadius: '10px', cursor: 'pointer', background: checked ? 'rgba(37,99,235,0.07)' : 'var(--bg-secondary)', border: `1px solid ${checked ? 'rgba(37,99,235,0.2)' : 'var(--border)'}` }}>
                      <input type="checkbox" checked={checked} disabled={applying} onChange={() => toggleCopyField(field)} />
                      <span style={{ fontSize: '0.82rem', fontWeight: checked ? 700 : 500 }}>{fieldLabels[field] || field}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {/* Target classrooms */}
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
                Target Classrooms
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={selectAllRooms} style={{ fontSize: '0.7rem', background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 700 }}>All</button>
                <button onClick={clearAllRooms} style={{ fontSize: '0.7rem', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700 }}>None</button>
              </div>
            </div>

            {otherClassrooms.length > 4 && (
              <div style={{ position: 'relative', marginBottom: '0.6rem' }}>
                <Search size={13} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input
                  type="text"
                  placeholder="Search classrooms…"
                  value={roomSearch}
                  onChange={e => setRoomSearch(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem 0.5rem 2rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }}
                />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.4rem', maxHeight: '220px', overflowY: 'auto', paddingRight: '0.25rem' }}>
              {filteredRooms.map(room => {
                const checked = selectedRooms.has(room.id);
                const selectedSourceItems = savedItems.filter(item => selectedItems.has(item.id));
                const issue = selectedSourceItems
                   .map(item => getBulkTargetIssue(room, item, targetMatchOptions))
                  .find(Boolean);
                const hasDoneItems = selectedItems.size > 0 &&
                  [...selectedItems].some(iid => {
                    const item = savedItems.find(i => i.id === iid);
                    return item && getExistingStatus(room, item) === 'Done';
                  });
                return (
                  <label key={room.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.875rem', borderRadius: '10px', cursor: issue ? 'not-allowed' : 'pointer', background: issue ? 'rgba(239,68,68,0.06)' : checked ? 'rgba(37,99,235,0.07)' : 'var(--bg-secondary)', border: `1px solid ${issue ? 'rgba(239,68,68,0.25)' : checked ? 'rgba(37,99,235,0.2)' : 'var(--border)'}`, transition: 'all 0.15s' }}>
                    <input type="checkbox" checked={checked} disabled={applying || !!issue} onChange={() => toggleRoom(room.id)} style={{ display: 'none' }} />
                    {issue
                      ? <AlertTriangle size={14} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                      : checked
                      ? <CheckSquare size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                      : <Square size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                    }
                    <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: checked ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.room_id}</span>
                    {issue
                      ? <span style={{ fontSize: '0.62rem', color: 'var(--danger)', textAlign: 'right' }}>{issue}</span>
                      : !isModelMode && hasDoneItems && skipDone && (
                      <AlertTriangle size={12} style={{ color: '#f59e0b', flexShrink: 0 }} title="Has Done items — will be skipped" />
                    )}
                  </label>
                );
              })}
              {filteredRooms.length === 0 && (
                <p style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '1rem 0' }}>No classrooms match.</p>
              )}
            </div>
             {otherClassrooms.some(room => savedItems.some(item => getBulkTargetIssue(room, item, targetMatchOptions))) && (
              <div role="alert" style={{ marginTop: '0.6rem', padding: '0.7rem 0.8rem', borderRadius: '9px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                <strong style={{ color: 'var(--danger)' }}>Some destinations are unavailable:</strong> their classroom/checklist destination is not valid for the selected source items. They cannot be guessed or copied into. Review the details above and reload after correcting the destination.
              </div>
            )}
          </section>

          {!isModelMode && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderRadius: '10px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={skipDone} disabled={applying} onChange={e => setSkipDone(e.target.checked)} />
              <div>
                <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>Skip classrooms where the item is already Done</p>
                <p style={{ margin: '0.1rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Prevents overwriting completed work in other classrooms.</p>
              </div>
            </label>
          )}
          {isModelMode && (
            <div role="note" style={{ padding: '0.75rem 0.9rem', borderRadius: '10px', border: '1px solid rgba(37,99,235,0.2)', background: 'rgba(37,99,235,0.06)', color: 'var(--text-secondary)', fontSize: '0.76rem' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Confirmation:</strong>{' '}
              Replace {describedFields} in{' '}
              {otherClassrooms.filter(room => selectedRooms.has(room.id)).map(room => room.room_id || room.name || room.id).join(', ') || 'the selected rooms'}.
              {' Empty source values are skipped so each destination value is preserved.'}
            </div>
          )}
          {applyError && (
            <div role="alert" aria-live="polite" style={{ padding: '0.7rem 0.8rem', borderRadius: '9px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'var(--danger)', fontSize: '0.75rem' }}>
              {applyError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', background: 'var(--bg-primary)' }}>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            {selectedItems.size} item{selectedItems.size !== 1 ? 's' : ''} → {selectedRooms.size} classroom{selectedRooms.size !== 1 ? 's' : ''}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button onClick={requestClose} disabled={applying} className="button button-secondary" style={{ fontSize: '0.85rem', opacity: applying ? 0.6 : 1 }}>Cancel</button>
            <button
              onClick={handleApply}
              disabled={applying || retryBlocked || selectedItems.size === 0 || selectedRooms.size === 0 || fieldsToApply.length === 0}
              className="button button-primary"
              style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: (applying || retryBlocked || selectedItems.size === 0 || selectedRooms.size === 0 || fieldsToApply.length === 0) ? 0.6 : 1 }}>
              {applying ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Copy size={14} />}
              {applying ? 'Applying…' : applyError
                ? retryBlocked ? 'Refresh before retrying' : 'Retry copy'
                : 'Apply'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
