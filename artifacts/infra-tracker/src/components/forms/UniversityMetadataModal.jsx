import React, { useState } from 'react';
import { X, Save, Building, Users, Calendar, Hash, Loader, TrendingUp, Target, Flag } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useAuth, ZONES } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

const EFFORTS_OPTIONS = ['HIGH', 'MEDIUM', 'LOW'];
const PROBABILITY_OPTIONS = ['High', 'Medium', 'Low', 'At Risk', 'On Track'];
const PRIORITY_OPTIONS = [
  { value: 'P1', label: '🔴 P1', color: '#ef4444' },
  { value: 'P2', label: '🟡 P2', color: '#f59e0b' },
  { value: 'P3', label: '🟢 P3', color: '#10b981' },
];

export default function UniversityMetadataModal({ university, onClose }) {
  const { updateUniversityMetadata } = useData();
  const { users, user, updateUser } = useAuth();
  const { showToast } = useToast();
  const isApm = user?.role === 'apm';
  const apmUsers = (users || []).filter(u => u.role === 'apm');
  const [loading, setLoading] = useState(false);
  const irmParts = (university.infraReadyMonth || '').split('-');
  const [formData, setFormData] = useState({
    name: university.name || '',
    zone_id: university.zone_id || '',
    apm_name: university.apmName || '',
    apm_user_id: apmUsers.find(u => u.name === university.apmName)?.id || '',
    start_date: university.startDate || '',
    target_date: university.targetDate || '',
    internal_timeline: university.internalTimeline || '',
    class_commencement_date: university.classCommencementDate || '',
    num_classrooms: university.numClassrooms || '',
    classroom_capacity: university.classroomCapacity || '',
    classroom_allocation_done: university.classroomAllocationDone || false,
    allocation_pending_remarks: university.allocationPendingRemarks || '',
    studentsCount: university.studentsCount || '',
    maxStudentsCount: university.maxStudentsCount || '',
    effortsRequired: university.effortsRequired || '',
    confidencePercentage: university.confidencePercentage ?? '',
    probabilityStatus: university.probabilityStatus || '',
    apmConfidenceDate: university.apmConfidenceDate || '',
    reminderDays: university.reminderDays ?? 5,
    priority: university.priority || 'P2',
    modelClassroomTimeline: university.modelClassroomTimeline || '',
    lab5Timeline: university.lab5Timeline || '',
    staffRoomTimeline: university.staffRoomTimeline || '',
    allClassroomsTimeline: university.allClassroomsTimeline || '',
    infraReadyMonth: university.infraReadyMonth || '',
    _irmYear: irmParts[0] || '',
    _irmMonth: irmParts[1] || '',
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
      const payload = {
        name: formData.name,
        zone_id: (formData.zone_id !== '' && formData.zone_id !== null) ? parseInt(formData.zone_id, 10) : null,
        apm_name: formData.apm_name,
        start_date: formData.start_date || null,
        target_date: formData.target_date || null,
        internal_timeline: formData.internal_timeline || null,
        class_commencement_date: formData.class_commencement_date || null,
        num_classrooms: formData.num_classrooms !== '' ? parseInt(formData.num_classrooms, 10) : null,
        classroom_capacity: formData.classroom_capacity !== '' ? parseInt(formData.classroom_capacity, 10) : null,
        classroom_allocation_done: formData.classroom_allocation_done,
        allocation_pending_remarks: formData.allocation_pending_remarks || null,
        studentsCount: formData.studentsCount !== '' ? parseInt(formData.studentsCount, 10) : null,
        maxStudentsCount: formData.maxStudentsCount !== '' ? parseInt(formData.maxStudentsCount, 10) : null,
        effortsRequired: formData.effortsRequired || null,
        confidencePercentage: formData.confidencePercentage !== '' ? parseInt(formData.confidencePercentage, 10) : null,
        probabilityStatus: formData.probabilityStatus || null,
        apmConfidenceDate: formData.apmConfidenceDate || null,
        reminderDays: formData.reminderDays !== '' ? parseInt(formData.reminderDays, 10) : 5,
        priority: formData.priority || 'P2',
        modelClassroomTimeline: formData.modelClassroomTimeline || null,
        lab5Timeline: formData.lab5Timeline || null,
        staffRoomTimeline: formData.staffRoomTimeline || null,
        allClassroomsTimeline: formData.allClassroomsTimeline || null,
        infraReadyMonth: formData.infraReadyMonth || null,
      };

      const uniId = university.id || university.uuid_id;
      if (!uniId) throw new Error('University ID is missing. Cannot save.');

      await updateUniversityMetadata(uniId, payload);

      // Sync APM user's universityIds so Access Control reflects the change
      if (!isApm && users.length > 0) {
        const newApmUser = apmUsers.find(u => u.id === formData.apm_user_id);
        const oldApmUser = apmUsers.find(u => u.name === university.apmName && u.id !== formData.apm_user_id);
        if (oldApmUser) {
          const cleaned = (oldApmUser.universityIds || []).filter(id => String(id) !== String(uniId));
          await updateUser(oldApmUser.id, { universityIds: cleaned });
        }
        if (newApmUser && !(newApmUser.universityIds || []).map(String).includes(String(uniId))) {
          await updateUser(newApmUser.id, { universityIds: [...(newApmUser.universityIds || []), uniId] });
        }
      }

      showToast('University details updated successfully!', 'success');
      onClose();
    } catch (err) {
      showToast(`Error saving metadata: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const sectionStyle = (color) => ({
    padding: '1rem',
    background: `rgba(${color},0.05)`,
    borderRadius: '8px',
    border: `1px solid rgba(${color},0.1)`,
    marginBottom: '0'
  });

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)'
    }}>
      <div className="glass-panel fade-in" style={{
        width: '100%', maxWidth: '720px', maxHeight: '92vh', overflowY: 'auto',
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

          {/* Basic Info */}
          <div className="form-group">
            <label className="form-label" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>University Name *</label>
            <input type="text" className="form-input" name="name" value={formData.name} onChange={handleChange} required />
          </div>

          {/* Assignment */}
          <div style={sectionStyle('59,130,246')}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={16} /> Assignment
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Mapping Zone</label>
                <select className="form-select" name="zone_id" value={formData.zone_id} onChange={handleChange}
                  style={{ width: '100%', padding: '0.625rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                  <option value="">Select a Zone</option>
                  {Object.entries(ZONES).map(([id, z]) => (
                    <option key={id} value={id}>{z.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Assigned APM</label>
                <select className="form-select" name="apm_user_id" value={formData.apm_user_id}
                  onChange={(e) => {
                    const sel = apmUsers.find(u => u.id === e.target.value);
                    setFormData(prev => ({ ...prev, apm_user_id: e.target.value, apm_name: sel?.name || '' }));
                  }}
                  style={{ width: '100%', padding: '0.625rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                  <option value="">Select an APM</option>
                  {apmUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Priority */}
          <div style={sectionStyle('139,92,246')}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#8b5cf6', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Flag size={16} /> Priority
            </h3>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {PRIORITY_OPTIONS.map(opt => (
                <label key={opt.value}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer',
                    padding: '0.5rem 1rem', borderRadius: '8px',
                    border: `2px solid ${formData.priority === opt.value ? opt.color : 'var(--border)'}`,
                    background: formData.priority === opt.value ? `${opt.color}15` : 'var(--bg-primary)',
                    transition: 'all 0.15s',
                  }}>
                  <input type="radio" name="priority" value={opt.value} checked={formData.priority === opt.value} onChange={handleChange} style={{ display: 'none' }} />
                  <span style={{ fontSize: '0.875rem', fontWeight: formData.priority === opt.value ? 800 : 500, color: formData.priority === opt.value ? opt.color : 'var(--text-secondary)' }}>
                    {opt.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Infra Ready Month */}
          <div style={sectionStyle('99,102,241')}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#6366f1', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={16} /> Infra Ready Month
            </h3>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Expected Month of Infrastructure Readiness</label>
              {(() => {
                const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                const currentYear = new Date().getFullYear();
                const years = Array.from({ length: 5 }, (_, i) => currentYear - 1 + i);
                const selectStyle = { padding: '0.42rem 0.65rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none', cursor: 'pointer' };
                const onChangeIRM = (type, val) => {
                  setFormData(prev => {
                    const newYear  = type === 'year'  ? val : prev._irmYear;
                    const newMonth = type === 'month' ? val : prev._irmMonth;
                    return {
                      ...prev,
                      _irmYear: newYear,
                      _irmMonth: newMonth,
                      infraReadyMonth: newYear && newMonth ? `${newYear}-${newMonth}` : '',
                    };
                  });
                };
                return (
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select value={formData._irmMonth} onChange={e => onChangeIRM('month', e.target.value)} style={selectStyle}>
                      <option value="">— Month —</option>
                      {MONTHS.map((m, i) => (
                        <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>
                      ))}
                    </select>
                    <select value={formData._irmYear} onChange={e => onChangeIRM('year', e.target.value)} style={selectStyle}>
                      <option value="">— Year —</option>
                      {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
                    </select>
                    {(formData._irmMonth || formData._irmYear) && (
                      <button type="button" onClick={() => setFormData(prev => ({ ...prev, _irmMonth: '', _irmYear: '', infraReadyMonth: '' }))}
                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.78rem', padding: '0.2rem 0.4rem' }}>
                        ✕ Clear
                      </button>
                    )}
                  </div>
                );
              })()}
              {formData.infraReadyMonth && (() => {
                const [yr, mo] = formData.infraReadyMonth.split('-');
                const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                return (
                  <p style={{ margin: '0.45rem 0 0', fontSize: '0.75rem', color: '#6366f1', fontWeight: 700 }}>
                    📅 {MONTHS[parseInt(mo, 10) - 1]} {yr}
                  </p>
                );
              })()}
            </div>
          </div>

          {/* Timelines */}
          <div style={sectionStyle('16,185,129')}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10b981', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={16} /> Timelines
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Start Date</label>
                <input type="date" className="form-input" name="start_date" value={formData.start_date} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Target Date</label>
                <input type="date" className="form-input" name="target_date" value={formData.target_date} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Internal Timeline</label>
                <input type="date" className="form-input" name="internal_timeline" value={formData.internal_timeline} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Class Commencement Date</label>
                <input type="date" className="form-input" name="class_commencement_date" value={formData.class_commencement_date} onChange={handleChange} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>APM Confidence Date</label>
                <input type="date" className="form-input" name="apmConfidenceDate" value={formData.apmConfidenceDate} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Reminder (days before target)</label>
                <input type="number" className="form-input" name="reminderDays" min="1" max="30" value={formData.reminderDays} onChange={handleChange} />
              </div>
            </div>
            {/* Category-specific timelines */}
            <h4 style={{ fontSize: '0.78rem', fontWeight: 700, color: '#10b981', marginBottom: '0.75rem', marginTop: '0.25rem' }}>
              Category Timelines
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Model Classroom</label>
                <input type="date" className="form-input" name="modelClassroomTimeline" value={formData.modelClassroomTimeline} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>5.0 Lab</label>
                <input type="date" className="form-input" name="lab5Timeline" value={formData.lab5Timeline} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Staff Room</label>
                <input type="date" className="form-input" name="staffRoomTimeline" value={formData.staffRoomTimeline} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>All Classrooms</label>
                <input type="date" className="form-input" name="allClassroomsTimeline" value={formData.allClassroomsTimeline} onChange={handleChange} />
              </div>
            </div>
          </div>

          {/* Effort & Confidence */}
          <div style={sectionStyle('245,158,11')}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f59e0b', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={16} /> Effort & Confidence
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Efforts Required</label>
                <select className="form-select" name="effortsRequired" value={formData.effortsRequired} onChange={handleChange}
                  style={{ width: '100%', padding: '0.625rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                  <option value="">Select Level</option>
                  {EFFORTS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Probability Status</label>
                <select className="form-select" name="probabilityStatus" value={formData.probabilityStatus} onChange={handleChange}
                  style={{ width: '100%', padding: '0.625rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                  <option value="">Select Status</option>
                  {PROBABILITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Confidence % (0–100)</label>
                <input type="number" className="form-input" name="confidencePercentage" min="0" max="100"
                  value={formData.confidencePercentage} onChange={handleChange} placeholder="e.g. 75" />
              </div>
            </div>
          </div>

          {/* Students & Capacity */}
          <div style={sectionStyle('59,130,246')}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building size={16} /> Classroom & Students
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}><Hash size={12}/> No. of Classrooms</label>
                <input type="number" className="form-input" name="num_classrooms" value={formData.num_classrooms} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Capacity / Classroom</label>
                <input type="number" className="form-input" name="classroom_capacity" value={formData.classroom_capacity} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Min. No. of Students</label>
                <input type="number" className="form-input" name="studentsCount" value={formData.studentsCount} onChange={handleChange} placeholder="e.g. 500" />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Max. No. of Students</label>
                <input type="number" className="form-input" name="maxStudentsCount" value={formData.maxStudentsCount} onChange={handleChange} placeholder="e.g. 1200" />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', background: 'var(--bg-primary)', padding: '0.75rem', borderRadius: '6px' }}>
              <input type="checkbox" name="classroom_allocation_done" checked={formData.classroom_allocation_done} onChange={handleChange} style={{ width: '1.25rem', height: '1.25rem' }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Classroom Allocation Completed</span>
            </label>
            {!formData.classroom_allocation_done && (
              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Allocation Pending Remarks</label>
                <textarea className="form-textarea" name="allocation_pending_remarks"
                  value={formData.allocation_pending_remarks} onChange={handleChange}
                  placeholder="Why is allocation pending? What is needed?"
                  style={{ minHeight: '60px', padding: '0.625rem', fontSize: '0.85rem' }} />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '0.5rem' }}>
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
