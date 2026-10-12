import React from 'react';
import {
  mergeChecklistItemsWithDrafts,
  getChecklistDraftOwner,
  getChecklistDraftVersion,
  recordChecklistDraft,
  subscribeChecklistDrafts,
} from '../../utils/checklistDraftStore';

function withDrafts(data, universityId) {
  if (!data) return data;
  return {
    ...data,
    items: mergeChecklistItemsWithDrafts(universityId, data.items || []),
  };
}

export default function useChecklistFormDraft({ data, universityId, onSave }) {
  const [formData, setFormData] = React.useState(() => withDrafts(data, universityId));
  const [saving, setSaving] = React.useState(false);
  const [saveFailure, setSaveFailure] = React.useState(null);
  const submitting = React.useRef(false);
  const formDataRef = React.useRef(formData);
  const dirtyFormFields = React.useRef(new Set());
  const formRevision = React.useRef(0);
  const draftVersion = React.useSyncExternalStore(
    subscribeChecklistDrafts,
    getChecklistDraftVersion,
    () => 0,
  );
  const ownerRef = React.useRef(getChecklistDraftOwner());
  formDataRef.current = formData;

  React.useEffect(() => {
    const next = withDrafts(data, universityId);
    if (!next) return;
    dirtyFormFields.current.forEach(field => {
      next[field] = formDataRef.current?.[field];
    });
    formDataRef.current = next;
    setFormData(next);
  }, [data, universityId]);

  React.useEffect(() => {
    const owner = getChecklistDraftOwner();
    const base = ownerRef.current === owner ? formDataRef.current : data;
    ownerRef.current = owner;
    const next = withDrafts(base, universityId);
    if (!next) return;
    formDataRef.current = next;
    setFormData(next);
  }, [data, draftVersion, universityId]);

  const updateItem = React.useCallback((id, updates, { committed = false } = {}) => {
    formRevision.current += 1;
    const item = (formDataRef.current?.items || []).find(candidate => candidate.id === id);
    const recorded = item && !committed
      ? recordChecklistDraft(universityId, item, updates)
      : null;
    setFormData(previous => {
      const next = {
      ...previous,
      items: (previous?.items || []).map(item => {
        if (item.id !== id) return item;
        return { ...item, ...updates };
      }),
      };
      formDataRef.current = next;
      return next;
    });
    return recorded;
  }, [universityId]);

  const updateField = React.useCallback((name, value) => {
    formRevision.current += 1;
    dirtyFormFields.current.add(name);
    setFormData(previous => {
      const next = { ...previous, [name]: value };
      formDataRef.current = next;
      return next;
    });
  }, []);

  const submit = React.useCallback(async event => {
    event?.preventDefault?.();
    if (submitting.current) return { ok: false, duplicate: true };
    submitting.current = true;
    setSaving(true);
    const submittedRevision = formRevision.current;
    let payload;
    try {
      payload = { ...formDataRef.current };
      ['roomNumber', 'remarks'].forEach(field => {
        if (!dirtyFormFields.current.has(field)) delete payload[field];
      });
      const result = await onSave(payload);
      const outcome = result === false
        ? { ok: false, error: new Error('Checklist changes were not saved.') }
        : (result?.ok === false ? result : { ok: true, ...(result || {}) });
      const changedDuringSave = formRevision.current !== submittedRevision;
      const completed = {
        ...outcome,
        submittedPayload: payload,
        changedDuringSave,
      };
      if (outcome.ok && !changedDuringSave) {
        dirtyFormFields.current.clear();
        setSaveFailure(null);
      }
      else if (!outcome.ok) setSaveFailure(outcome.error || new Error('Checklist changes were not saved.'));
      return completed;
    } catch (error) {
      setSaveFailure(error);
      return {
        ok: false,
        error,
        submittedPayload: payload,
        changedDuringSave: formRevision.current !== submittedRevision,
      };
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }, [onSave]);

  return {
    formData,
    setFormData,
    updateItem,
    updateField,
    submit,
    saving,
    saveFailure,
  };
}

export function ChecklistSaveFeedback({ error, onRetry, saving }) {
  if (!error) return null;
  const failedItems = error.failedItems || [];
  return React.createElement(
    'div',
    {
      role: 'alert',
      style: { marginBottom: '0.75rem', padding: '0.75rem 1rem', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '10px', background: 'rgba(239,68,68,0.08)' },
    },
    React.createElement(
      'p',
      { style: { margin: 0, color: 'var(--danger)', fontWeight: 700 } },
      failedItems.length > 0
        ? `Not saved: ${failedItems.map(item => item.name).join(', ')}`
        : error.message || 'Checklist changes were not saved.',
    ),
    React.createElement(
      'p',
      { className: 'text-secondary', style: { margin: '0.25rem 0 0', fontSize: '0.78rem' } },
      `Your current draft is preserved.${error.correlationId ? ` Reference: ${error.correlationId}.` : ''}`,
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        onClick: onRetry,
        disabled: saving,
        className: 'button button-secondary',
        style: { marginTop: '0.5rem', fontSize: '0.78rem' },
      },
      saving ? 'Retrying…' : 'Retry unsaved changes',
    ),
  );
}