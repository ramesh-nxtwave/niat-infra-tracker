import React from 'react';
import { Save } from 'lucide-react';
import ChecklistSection from './ChecklistSection';
import useChecklistFormDraft, { ChecklistSaveFeedback } from './useChecklistFormDraft';

export default function Lab5Form({ data, onSave, universityId, target, onTargetRevealed }) {
  const {
    formData, setFormData, updateItem: handleUpdateItem, updateField, submit,
    saving, saveFailure,
  } = useChecklistFormDraft({ data, universityId, onSave });
  const handleChange = (e) => {
    const { name, value } = e.target;
    updateField(name, value);
  };
  const handleVendorChange = (category, vendor) => {
    setFormData(prev => ({ ...prev, categoryVendors: { ...(prev.categoryVendors || {}), [category]: vendor } }));
  };
  const handleSubmit = submit;
  const items = formData?.items || [];
  const categories = [...items.reduce((map, i) => {
    const cur = map.has(i.category) ? map.get(i.category) : (i.sortOrder ?? 999);
    return map.set(i.category, Math.min(cur, i.sortOrder ?? 999));
  }, new Map()).entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([cat]) => cat);

  return (
    <form onSubmit={handleSubmit} className="fade-in">
      <div className="page-header">
        <h2 className="page-title" style={{ fontSize: '1.5rem' }}>5.0 Lab Tracker</h2>
        <span className="badge badge-neutral">Relational Checklist</span>
      </div>
      
      {/* Overall Remarks moved to checklist item level per user preference, 
          but keeping a small summary field if needed. */}
      <div className="form-grid mb-6">
        <div className="form-group form-group-full-width">
          <label className="form-label">Overall Lab Remarks</label>
          <textarea className="form-textarea" name="remarks" rows="1" value={formData.remarks || ''} onChange={handleChange} placeholder="General notes for this lab..." />
        </div>
      </div>
      <div className="mb-8">
        <h3 className="font-semibold mb-4 text-accent-secondary" style={{ fontSize: '1.1rem' }}>Detailed Equipment Checklist</h3>
        {categories.map(cat => (
          <ChecklistSection key={cat} category={cat} items={formData.items} onUpdateItem={handleUpdateItem}
            universityId={universityId}
            categoryVendor={(formData.categoryVendors || {})[cat]}
             onVendorChange={(v) => handleVendorChange(cat, v)}
             target={target}
             onTargetRevealed={onTargetRevealed} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', position: 'sticky', bottom: '1rem', zIndex: 10 }}>
        <div>
          <ChecklistSaveFeedback error={saveFailure} onRetry={submit} saving={saving} />
          <button type="submit" disabled={saving} className="button button-primary" style={{ boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
            <Save size={18} /> {saving ? 'Saving…' : 'Save Checklist'}
          </button>
        </div>
      </div>
    </form>
  );
}
