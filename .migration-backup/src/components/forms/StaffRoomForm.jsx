import React from 'react';
import { Save } from 'lucide-react';
import ChecklistSection from './ChecklistSection';

export default function StaffRoomForm({ data, onSave, universityId }) {
  const [formData, setFormData] = React.useState(data);
  React.useEffect(() => { setFormData(data); }, [data]);

  const handleUpdateItem = (id, updates) => {
    setFormData(prev => ({ ...prev, items: prev.items.map(item => item.id === id ? { ...item, ...updates } : item) }));
  };
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  const handleVendorChange = (category, vendor) => {
    setFormData(prev => ({ ...prev, categoryVendors: { ...(prev.categoryVendors || {}), [category]: vendor } }));
  };
  const handleSubmit = (e) => { e.preventDefault(); onSave(formData); };
  const categories = [...new Set((formData?.items || []).map(i => i.category))];

  return (
    <form onSubmit={handleSubmit} className="fade-in">
      <div className="page-header">
        <h2 className="page-title" style={{ fontSize: '1.5rem' }}>Staff Room Tracker</h2>
        <span className="badge badge-neutral">Relational Checklist</span>
      </div>
      <div className="form-grid mb-6">
        <div className="form-group form-group-full-width">
          <label className="form-label">Overall Staff Room Remarks</label>
          <textarea className="form-textarea" name="remarks" rows="1" value={formData.remarks || ''} onChange={handleChange} placeholder="General notes for staff room..." />
        </div>
      </div>
      <div className="mb-8">
        <h3 className="font-semibold mb-4 text-accent-secondary" style={{ fontSize: '1.1rem' }}>Detailed Space Checklist</h3>
        {categories.map(cat => (
          <ChecklistSection key={cat} category={cat} items={formData.items} onUpdateItem={handleUpdateItem}
            universityId={universityId}
            categoryVendor={(formData.categoryVendors || {})[cat]}
            onVendorChange={(v) => handleVendorChange(cat, v)} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', position: 'sticky', bottom: '1rem', zIndex: 10 }}>
        <button type="submit" className="button button-primary" style={{ boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
          <Save size={18} /> Save Checklist
        </button>
      </div>
    </form>
  );
}
