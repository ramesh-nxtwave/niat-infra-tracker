import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  cancelChecklistRemarkSaveTimer,
  checklistRemarkSaveKey,
  hasPendingChecklistSave,
  scheduleChecklistRemarkSave,
} from '../../utils/checklistRemarkSaveQueue';
import {
  getChecklistDraft,
  subscribeChecklistDrafts,
} from '../../utils/checklistDraftStore';

export default function ChecklistRemarkField({
  item,
  universityId,
  patchChecklistStatus,
  onUpdateItem,
  showToast,
  onRemarkSaved,
  onFocusChange,
}) {
  const latestDraft = useRef();
  const [saveError, setSaveError] = useState(null);
  const mounted = useRef(true);
  const onUpdateItemRef = useRef(onUpdateItem);
  const patchChecklistStatusRef = useRef(patchChecklistStatus);
  const showToastRef = useRef(showToast);
  const onRemarkSavedRef = useRef(onRemarkSaved);
  const onFocusChangeRef = useRef(onFocusChange);
  const promptAfterSave = useRef(false);
  const saveKey = checklistRemarkSaveKey(universityId, item.id);
  onUpdateItemRef.current = onUpdateItem;
  patchChecklistStatusRef.current = patchChecklistStatus;
  showToastRef.current = showToast;
  onRemarkSavedRef.current = onRemarkSaved;
  onFocusChangeRef.current = onFocusChange;
  const storedDraft = useSyncExternalStore(
    subscribeChecklistDrafts,
    () => getChecklistDraft(universityId, item.id),
    () => null,
  );
  const storedRemarkFailed = !!(
    storedDraft?.failed
    && Object.hasOwn(storedDraft.fields || {}, 'remarks')
  );
  const storedNonRemarkFailed = !!(storedDraft?.failed && !storedRemarkFailed);

  const persistRemark = useCallback((remarks) => {
    cancelChecklistRemarkSaveTimer(saveKey);
    return patchChecklistStatusRef.current(universityId, item.id, { remarks }).then(() => {
      if (mounted.current) setSaveError(null);
      if (mounted.current && latestDraft.current === remarks) {
        onUpdateItemRef.current(item.id, { lastUpdated: new Date().toISOString() });
        if (promptAfterSave.current) {
          promptAfterSave.current = false;
          onRemarkSavedRef.current?.(remarks);
        }
      }
    }).catch(error => {
      if (mounted.current && latestDraft.current === remarks) {
        setSaveError(error);
        const reference = error.correlationId ? ` Reference: ${error.correlationId}.` : '';
        showToastRef.current(`Remark was not saved: ${error.message || 'Check your connection.'} Your draft is still visible.${reference}`, 'error');
      }
      throw error;
    });
  }, [item.id, saveKey, universityId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (cancelChecklistRemarkSaveTimer(saveKey) && latestDraft.current !== undefined) {
        persistRemark(latestDraft.current).catch(() => undefined);
      }
    };
  }, [persistRemark, saveKey]);

  const inputId = `checklist-remark-${item.id}`;

  return (
    <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <label htmlFor={inputId} style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Audit Remarks / Field Notes
      </label>
      <textarea
        id={inputId}
        className="form-textarea"
        style={{ fontSize: '0.95rem', padding: '1rem', flex: 1, minHeight: '120px', borderRadius: '12px', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: item.status === 'Blocker' ? '2px solid rgba(239,68,68,0.4)' : '1px solid var(--border)' }}
        placeholder="Describe deployment progress or specific blockers..."
        value={item.remarks || ''}
        onFocus={() => onFocusChangeRef.current?.(true)}
        onChange={event => {
          const remarks = event.target.value;
          setSaveError(null);
          latestDraft.current = remarks;
          onUpdateItem(item.id, { remarks, lastUpdated: new Date().toISOString() });
          scheduleChecklistRemarkSave(
            saveKey,
            () => persistRemark(remarks).catch(() => undefined),
            700,
          );
        }}
        onBlur={event => {
          onFocusChangeRef.current?.(false);
          if (latestDraft.current !== undefined) {
            const draft = getChecklistDraft(universityId, item.id);
            const hasUnsavedRemark = Object.hasOwn(draft?.fields || {}, 'remarks');
            if (!hasUnsavedRemark && !hasPendingChecklistSave(saveKey)) {
              onRemarkSavedRef.current?.(event.target.value);
              return;
            }
            promptAfterSave.current = true;
            persistRemark(event.target.value).catch(() => undefined);
          }
        }}
      />
      {(saveError || storedDraft?.failed) && (
        <div role="alert" style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>
          <span>
            {storedNonRemarkFailed
              ? 'This item has unsaved changes. Use Save Checklist to retry. '
              : 'Unsaved remark draft. '}
          </span>
          {(saveError?.correlationId || storedDraft?.correlationId) && (
            <span>Reference: {saveError?.correlationId || storedDraft?.correlationId}. </span>
          )}
          {(saveError || storedRemarkFailed) && (
            <button
              type="button"
              onClick={() => {
                latestDraft.current = item.remarks || '';
                persistRemark(item.remarks || '').catch(() => undefined);
              }}
              style={{ border: 0, padding: 0, background: 'none', color: 'var(--accent-primary)', fontWeight: 700, cursor: 'pointer' }}
            >
              Retry remark
            </button>
          )}
        </div>
      )}
    </div>
  );
}