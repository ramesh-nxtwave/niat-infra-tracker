import React, { useState } from 'react';
import { X, Save, Building, Users, Calendar, MapPin, Hash, Loader } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useAuth, ZONES } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

export default function UniversityMetadataModal({ university, onClose }) {
  const { updateUniversityMetadata } = useData();
  const { users } = useAuth();
  const { showToast } = useToast();
  const apmUsers = (users || []).filter(u => u.role === 'apm');
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: university.name || '',
    zone_id: university.zone_id || '',
    apm_name: university.apmName || '',
    poc_name: university.pocName || '',
    poc_phone: university.pocNumber || '',
    start_date: university.startDate || '',
    target_date: university.targetDate || '',
    num_classrooms: university.numClassrooms || '',
    classroom_capacity: university.classroomCapacity || '',
    classroom_allocation_done: university.classroomAllocationDone || false,
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Prepare payload - convert empty strings to null for integers
      const payload = {
        name: formData.name,
        zone_id: (formData.zone_id !== "" && formData.zone_id !== null) ? parseInt(formData.zone_id, 10) : null,
        apm_name: formData.apm_name,
        poc_name: formData.poc_name,
        poc_phone: formData.poc_phone,
        start_date: formData.start_date || null,
        target_date: formData.target_date || null,
        num_classrooms: (formData.num_classrooms !== "" && formData.num_classrooms !== null) ? parseInt(formData.num_classrooms, 10) : null,
        classroom_capacity: (formData.classroom_capacity !== "" && formData.classroom_capacity !== null) ? parseInt(formData.classroom_capacity, 10) : null,
        classroom_allocation_done: formData.classroom_allocation_done
      };
      
      const uniId = university.id || university.uuid_id;
      if (!uniId) throw new Error("University ID is missing. Cannot save.");
      
      await updateUniversityMetadata(uniId, payload);
      showToast('University details updated successfully!', 'success');
      onClose();
    } catch (err) {
      showToast(`Error saving metadata: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)'
    }}>
      <div className="glass-panel fade-in" style={{
        width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto',
        background: 'var(--bg-secondary)', border: '1px solid var(--accent-primary)', padding: '2rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 className="page-title" style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building size={20} className="text-accent-primary" /> Edit University Details
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>University Name</label>
              <input type="text" className="form-input" name="name" value={formData.name} onChange={handleChange} required />
            </div>
          </div>

          <div style={{ padding: '1rem', background: 'rgba(59,130,246,0.05)', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.1)' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={16} /> Assignment & Contacts
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Mapping Zone</label>
                <select 
                  className="form-select" 
                  name="zone_id"
                  value={formData.zone_id} 
                  onChange={handleChange}
                  style={{ width: '100%', padding: '0.625rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                >
                  <option value="">Select a Zone</option>
                  {Object.entries(ZONES).map(([id, z]) => (
                    <option key={id} value={id}>{z.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Assigned APM</label>
                <select 
                  className="form-select" 
                  name="apm_name"
                  value={formData.apm_name} 
                  onChange={handleChange}
                  style={{ width: '100%', padding: '0.625rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                >
                  <option value="">Select an APM</option>
                  {apmUsers.map(u => (
                    <option key={u.id} value={u.name}>{u.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>POC Name</label>
                <input type="text" className="form-input" name="poc_name" value={formData.poc_name} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>POC Number</label>
                <input type="text" className="form-input" name="poc_phone" value={formData.poc_phone} onChange={handleChange} />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}><Calendar size={12}/> Start Date</label>
              <input type="date" className="form-input" name="start_date" value={formData.start_date} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}><Calendar size={12}/> Target Date</label>
              <input type="date" className="form-input" name="target_date" value={formData.target_date} onChange={handleChange} />
            </div>
          </div>

          <div style={{ padding: '1rem', background: 'rgba(245,158,11,0.05)', borderRadius: '8px', border: '1px solid rgba(245,158,11,0.1)' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--warning)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building size={16} /> Classroom Planning
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}><Hash size={12}/> No. of Classrooms</label>
                <input type="number" className="form-input" name="num_classrooms" value={formData.num_classrooms} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Capacity per Classroom</label>
                <input type="number" className="form-input" name="classroom_capacity" value={formData.classroom_capacity} onChange={handleChange} />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', background: 'var(--bg-primary)', padding: '0.75rem', borderRadius: '6px' }}>
              <input type="checkbox" name="classroom_allocation_done" checked={formData.classroom_allocation_done} onChange={handleChange} style={{ width: '1.25rem', height: '1.25rem' }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Classroom Allocation Completed</span>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
            <button type="button" onClick={onClose} className="button button-secondary">Cancel</button>
            <button type="submit" disabled={loading} className="button button-primary">
              {loading ? <Loader size={16} className="animate-spin" /> : <Save size={16} />} Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
