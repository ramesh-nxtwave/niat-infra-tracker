import React, { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import ChecklistSection from './ChecklistSection';
import BulkApplyModal from './BulkApplyModal';
import useChecklistFormDraft, { ChecklistSaveFeedback } from './useChecklistFormDraft';
import {
  getPendingChecklistDrafts,
} from '../../utils/checklistDraftStore';
import { MODEL_CLASSROOM_COPY_FIELDS } from './bulkApplyContract';

export default function ModelClassroomForm({
  data,
  onSave,
  universityId,
  classrooms = [],
  target,
  onTargetRevealed,
}) {
  const {
    formData, setFormData, updateItem: handleUpdateItem, updateField, submit,
    saving, saveFailure,
  } = useChecklistFormDraft({ data, universityId, onSave });
  const [bulkApplyOpen, setBulkApplyOpen] = useState(false);
  const [savedItemsForBulk, setSavedItemsForBulk] = useState([]);
  const [bulkApplyCopyFields, setBulkApplyCopyFields] = useState(MODEL_CLASSROOM_COPY_FIELDS);
  const [bulkApplyDefaultCopyFields, setBulkApplyDefaultCopyFields] = useState(MODEL_CLASSROOM_COPY_FIELDS);
  const [pendingCommittedCopies, setPendingCommittedCopies] = useState([]);
  const [pendingUploadStates, setPendingUploadStates] = useState({});
  const [copyBlockedError, setCopyBlockedError] = useState(null);
  const [focusedRemarkId, setFocusedRemarkId] = useState(null);

  const handleUploadStateChange = useCallback((itemId, hasPendingWork, sourceId = 'model') => {
    if (itemId == null) return;
    const key = `${sourceId || 'model'}:${String(itemId)}`;
    setPendingUploadStates(previous => (
      previous[key] === hasPendingWork
        ? previous
        : { ...previous, [key]: hasPendingWork }
    ));
  }, []);

  const handleCommittedFieldSaved = useCallback((item, copyFields) => {
    if (classrooms.length === 0) return;
    setPendingCommittedCopies(previous => [
      ...previous,
      {
        item: { ...item },
        copyFields: [...copyFields],
      },
    ]);
  }, [classrooms.length]);

  useEffect(() => {
    if (
      pendingCommittedCopies.length === 0
      || bulkApplyOpen
      || focusedRemarkId != null
    ) return;
    const pendingRemarkDrafts = getPendingChecklistDrafts(
      universityId,
      (formData?.items || []).map(item => item.id).filter(Boolean),
      ['remarks'],
    );
    if (pendingRemarkDrafts.length > 0) return;
    const [nextCopy, ...remainingCopies] = pendingCommittedCopies;
    setPendingCommittedCopies(remainingCopies);
    setSavedItemsForBulk([nextCopy.item]);
    setBulkApplyCopyFields(MODEL_CLASSROOM_COPY_FIELDS);
    setBulkApplyDefaultCopyFields(nextCopy.copyFields);
    setBulkApplyOpen(true);
  }, [bulkApplyOpen, focusedRemarkId, formData?.items, pendingCommittedCopies, universityId]);

  const handleSubmit = async event => {
    setCopyBlockedError(null);
    const outcome = await submit(event);
    if (!outcome?.ok) return outcome;

    const submitted = outcome.submittedPayload || formData;
    const submittedItems = (submitted?.items || []).map(item => ({ ...item }));
    const pendingSourceDrafts = getPendingChecklistDrafts(
      universityId,
      submittedItems.map(item => item.id).filter(Boolean),
    );
    if (outcome.changedDuringSave || pendingSourceDrafts.length > 0) {
      const labels = pendingSourceDrafts.map(draft => draft.label).filter(Boolean);
      setCopyBlockedError(
        labels.length > 0
          ? `Saved this snapshot, but newer edits for ${labels.join(', ')} are still pending. Wait for the latest save, then save again.`
          : 'Newer edits arrived while this save was in progress. Save again to include the latest edits.',
      );
      return outcome;
    }
    // Saving the checklist is intentionally independent from propagation.
    // Copy prompts are raised only by independently committed field actions
    // (for example a photo upload or a remark save), never by the whole-form
    // Save button.
    return outcome;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    updateField(name, value);
  };

  const handleVendorChange = (category, vendor) => {
    setFormData(prev => ({ ...prev, categoryVendors: { ...(prev.categoryVendors || {}), [category]: vendor } }));
  };

  const items = formData?.items || [];
  const categories = [...new Map(items.map(i => [i.category, i.sortOrder ?? 999])).entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([cat]) => cat);

  return (
    <>
      <form onSubmit={handleSubmit} className="fade-in">
      <div className="page-header">
        <h2 className="page-title" style={{ fontSize: '1.5rem' }}>Model Classroom Tracker</h2>
        <span className="badge badge-neutral">Relational Checklist</span>
      </div>

      <div className="form-grid mb-6">
        <div className="form-group">
          <label className="form-label">Room Number</label>
          <input type="text" className="form-input" name="roomNumber" value={formData.roomNumber || ''} onChange={handleChange} placeholder="e.g. A-101" />
        </div>
        <div className="form-group form-group-full-width">
          <label className="form-label">Overall Model Classroom Remarks</label>
          <textarea className="form-textarea" name="remarks" rows="1" placeholder="Overall notes for this space..." value={formData.remarks || ''} onChange={handleChange} />
        </div>
      </div>

      <div className="mb-8">
        <h3 className="font-semibold mb-4 text-accent-secondary" style={{ fontSize: '1.1rem' }}>Detailed Checklist</h3>
        {categories.map(cat => (
          <ChecklistSection key={cat} category={cat} items={formData.items} onUpdateItem={handleUpdateItem}
            universityId={universityId}
            categoryVendor={(formData.categoryVendors || {})[cat]}
             onVendorChange={(v) => handleVendorChange(cat, v)}
             target={target}
              onTargetRevealed={onTargetRevealed}
               onUploadStateChange={handleUploadStateChange}
              onCommittedFieldSaved={handleCommittedFieldSaved}
              onRemarkFocusChange={(itemId, focused) => {
                setFocusedRemarkId(current => (
                  focused
                    ? String(itemId)
                    : current === String(itemId)
                      ? null
                      : current
                ));
              }}
              enableItemBulkApply={false} />
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', position: 'sticky', bottom: '1rem', zIndex: 10 }}>
        <div>
          <ChecklistSaveFeedback error={saveFailure} onRetry={handleSubmit} saving={saving} />
          {copyBlockedError && (
            <div role="alert" aria-live="polite" style={{ marginBottom: '0.75rem', padding: '0.75rem 1rem', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '10px', background: 'rgba(245,158,11,0.08)', color: 'var(--text-secondary)' }}>
              {copyBlockedError}
            </div>
          )}
          <button type="submit" disabled={saving} className="button button-primary" style={{ boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
            <Save size={18} /> {saving ? 'Saving…' : 'Save Checklist'}
          </button>
        </div>
      </div>
      </form>
      {bulkApplyOpen && (
        <BulkApplyModal
          key={`${savedItemsForBulk[0]?.id}:${savedItemsForBulk[0]?.promptId ?? 'saved'}`}
          universityId={universityId}
          savedItems={savedItemsForBulk}
          classrooms={classrooms}
          mode="model"
          copyFields={bulkApplyCopyFields}
          defaultSelectedCopyFields={bulkApplyDefaultCopyFields}
          skipBlankValues
          sourceSpaceType="model_classroom"
          includePhotoMetadata
          pendingUploads={Boolean(
            pendingUploadStates[`model:${String(savedItemsForBulk[0]?.id)}`],
          )}
          sourceLabel="Model Classroom"
          onClose={() => setBulkApplyOpen(false)}
          onApplied={() => setBulkApplyOpen(false)}
        />
      )}
    </>
  );
}
