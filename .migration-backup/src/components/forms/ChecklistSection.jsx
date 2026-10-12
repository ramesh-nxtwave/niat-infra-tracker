import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Calendar, Camera, Loader, Ruler, History, CheckCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { fetchPhotoHistory, uploadAuditPhoto } from '../../utils/imageUtils';
import { useToast } from '../../context/ToastContext';
import { logAuditAction } from '../../utils/auditLogger';

const STATUS_OPTIONS = ['Done', 'In-Progress', 'Blocker', 'Yet to start', 'No info as of now'];

// ── Photo History Viewer ────────────────────────────────────────────────────
function PhotoHistory({ statusUpdateId }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (history !== null) { setOpen(o => !o); return; }
    setLoading(true);
    const data = await fetchPhotoHistory(statusUpdateId);
    setHistory(data);
    setLoading(false);
    setOpen(true);
  };

  const formatTs = (ts) => ts
    ? new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';

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
                {history.map((h, idx) => (
                  <div key={h.id} style={{ flex: '0 0 auto', width: '120px' }}>
                    <a href={h.photo_url} target="_blank" rel="noreferrer"
                      style={{ display: 'block', borderRadius: '6px', overflow: 'hidden', position: 'relative',
                        border: idx === 0 ? '2px solid var(--accent-primary)' : '1px solid var(--border)' }}>
                      <img src={h.photo_url} alt={`Upload ${idx + 1}`}
                        style={{ width: '120px', height: '80px', objectFit: 'cover', display: 'block' }} />
                      {idx === 0 && (
                        <span style={{ position: 'absolute', top: '3px', left: '3px', background: 'var(--accent-primary)', color: 'white', fontSize: '0.58rem', fontWeight: 700, padding: '1px 5px', borderRadius: '999px' }}>LATEST</span>
                      )}
                    </a>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.65rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>{formatTs(h.uploaded_at)}</p>
                    {h.uploaded_by && <p style={{ margin: '0.1rem 0 0', fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{h.uploaded_by}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ChecklistSection ───────────────────────────────────────────────────
export default function ChecklistSection({ category, items, onUpdateItem, universityId }) {
  const { user } = useAuth();
  const { updateUniversity } = useData();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(true);
  const [uploadingIds, setUploadingIds] = useState({});

  const categoryItems = items.filter(i => i.category === category);
  const doneCount = categoryItems.filter(i => i.status === 'Done').length;
  const progress = Math.round((doneCount / categoryItems.length) * 100) || 0;
  const hasBlocker = categoryItems.some(i => i.status === 'Blocker');

  const handleFieldChange = async (id, field, value) => {
    const item = items.find(i => i.id === id);
    if (field === 'status' && value === 'Done') {
      if (!item.photoLink || item.photoLink.trim() === '') {
        showToast('Action Denied: Mandatory photo required for "Done"', 'warning');
        return;
      }
    }
    
    await onUpdateItem(id, { [field]: value, lastUpdated: new Date().toISOString() });
  };

  const formatDate = (isoString) => {
    if (!isoString) return 'Not set';
    return new Date(isoString).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case 'Done':        return { border: '1px solid rgba(16,185,129,0.2)', background: 'rgba(16,185,129,0.02)' };
      case 'In-Progress': return { border: '1px solid rgba(245,158,11,0.2)', background: 'rgba(245,158,11,0.02)' };
      case 'Blocker':     return { border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.04)' };
      default:            return { border: '1px solid var(--border)', background: 'white' };
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

      {/* ── Category Header ─────────────────────────────────────── */}
      <div className="checklist-header" onClick={() => setIsOpen(!isOpen)}
        style={{ 
          background: hasBlocker ? 'rgba(239,68,68,0.08)' : 'white',
          borderRadius: '12px',
          padding: '1.25rem',
          border: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer'
        }}>
        <div className="checklist-title-group" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h3 className="font-bold" style={{ fontSize: '1.1rem', margin: 0 }}>{category}</h3>
          <span className={`badge ${progress === 100 ? 'badge-success' : progress >= 50 ? 'badge-warning' : 'badge-danger'}`} style={{ padding: '0.4rem 0.75rem' }}>
            {doneCount}/{categoryItems.length} Complete ({progress}%)
          </span>
          {hasBlocker && <span className="badge badge-danger">⚠ BLOCKER ACTIVE</span>}
        </div>
        {isOpen ? <ChevronUp size={22} /> : <ChevronDown size={22} />}
      </div>

      {isOpen && (
        <div className="checklist-content" style={{ marginTop: '1rem' }}>
          {/* ── Checklist Items ──────────────────────────────────── */}
          {categoryItems.map(item => {
            const statusStyle = getStatusStyle(item.status);
            
            return (
              <div key={item.id} className="checklist-item-row-premium"
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
                  background: 'white'
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
                        <Clock size={12} /> Last updated {formatDate(item.lastUpdated)}
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
                        <option key={opt} value={opt} style={{ background: 'white', color: '#1e293b', fontWeight: 600 }}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Row 2: Timelines */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', position: 'relative', zIndex: 1 }}>
                  <div className="form-group">
                    <label style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <Calendar size={14} /> University Timeline
                    </label>
                    <input type="date" className="form-input" style={{ padding: '0.75rem', fontSize: '0.9rem', borderRadius: '10px', background: 'white' }}
                      value={item.universityTimeline || ''} onChange={e => handleFieldChange(item.id, 'universityTimeline', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <Clock size={14} /> Target Timeline
                    </label>
                    <input type="date" className="form-input" style={{ padding: '0.75rem', fontSize: '0.9rem', borderRadius: '10px', background: 'white' }}
                      value={item.targetDate || ''} onChange={e => handleFieldChange(item.id, 'targetDate', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <CheckCircle size={14} /> Actual Completion
                    </label>
                    <input type="date" className="form-input" style={{ padding: '0.75rem', fontSize: '0.9rem', borderRadius: '10px', background: 'white' }}
                      value={item.actualDate || ''} onChange={e => handleFieldChange(item.id, 'actualDate', e.target.value)} />
                  </div>
                </div>

                {/* Capacity (Conditional) */}
                {item.requiresCapacity && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.25rem', background: 'rgba(245,158,11,0.06)', borderRadius: '12px', border: '1px solid rgba(245,158,11,0.15)' }}>
                    <Ruler size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--warning)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Required Capacity</span>
                    <input type="text" className="form-input"
                      style={{ flex: 1, padding: '0.6rem 1rem', fontSize: '0.95rem', borderColor: 'rgba(245,158,11,0.3)', background: 'white' }}
                      placeholder="e.g. 62.5 KVA"
                      value={item.capacity || ''} onChange={e => handleFieldChange(item.id, 'capacity', e.target.value)} />
                  </div>
                )}

                {/* Photo & Remarks Section */}
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
                  <div style={{ flex: '0 0 auto', minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {item.photoLink && (item.photoLink.startsWith('http') || item.photoLink.startsWith('data:image')) ? (
                      <div style={{ position: 'relative', height: '120px', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 8px 16px rgba(0,0,0,0.08)' }}>
                        <img src={item.photoLink} alt="Evidence" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <button onClick={() => handleFieldChange(item.id, 'photoLink', '')}
                          style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.85)', color: 'white', border: 'none', borderRadius: '50%', width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem' }}>✕</button>
                      </div>
                    ) : (
                      <input type="url" className="form-input" style={{ padding: '0.75rem', fontSize: '0.85rem', borderRadius: '10px' }}
                        placeholder="Paste Evidence Link..."
                        value={item.photoLink || ''} onChange={e => handleFieldChange(item.id, 'photoLink', e.target.value)} />
                    )}

                    <label className={`button button-secondary ${uploadingIds[item.id] ? 'disabled' : ''}`}
                      style={{ 
                        fontSize: '0.85rem', 
                        padding: '0.75rem', 
                        display: 'flex', 
                        justifyContent: 'center', 
                        alignItems: 'center', 
                        gap: '0.5rem', 
                        cursor: uploadingIds[item.id] ? 'not-allowed' : 'pointer', 
                        background: uploadingIds[item.id] ? 'var(--bg-secondary)' : 'white', 
                        fontWeight: 700, 
                        borderRadius: '10px', 
                        border: '1px solid var(--border)',
                        color: uploadingIds[item.id] ? 'var(--text-secondary)' : 'var(--text-primary)'
                      }}>
                      {uploadingIds[item.id] ? <Loader size={16} className="animate-spin text-accent-primary" /> : <Camera size={16} />}
                      {uploadingIds[item.id] ? 'Uploading...' : item.photoLink ? 'Update Photo' : 'Capture Site Photo'}
                      <input type="file" accept="image/*" capture="environment" disabled={!!uploadingIds[item.id]} style={{ display: 'none' }}
                        onChange={async (e) => {
                          const file = e.target.files[0];
                          if (!file) return;
                          
                          // File size check removed as per requirement, 
                                              try {
                            const url = await uploadAuditPhoto(universityId, item.id, file, user?.name || 'Field Auditor');
                            
                            // 1. Prepare updated state
                            const newStatus = item.status === 'Yet to start' ? 'In-Progress' : item.status;
                            const updatedItem = { 
                              ...item, 
                              photoLink: url, 
                              status: newStatus,
                              lastUpdated: new Date().toISOString()
                            };

                            // 2. IMMEDIATE PERSISTENCE: Save to Supabase (Relational)
                            // This ensures the photo link and status are not lost
                            await updateUniversity(universityId, category, { items: [updatedItem] });
                            console.log('✅ Photo URL and status persisted to database');
                            
                            // 3. Update local state for UI responsiveness
                            handleFieldChange(item.id, 'photoLink', url);
                            if (item.status === 'Yet to start') {
                              handleFieldChange(item.id, 'status', 'In-Progress');
                            }
                            
                            await logAuditAction({
                                action: 'UPLOAD_PHOTO',
                                module: 'Checklist',
                                entityId: item.id,
                                updatedValue: url,
                                user: user?.name
                            });
                            
                            showToast('Photo uploaded & synced successfully!', 'success');
                          } catch (err) {
                            console.error('Upload failed:', err);
                            // Show error for longer (30s) so user can read it
                            showToast(`Upload Failed: ${err.message}`, 'error');
                          } finally {
                            setUploadingIds(v => { const n = { ...v }; delete n[item.id]; return n; });
                            e.target.value = '';
                          }
                        }} />
                    </label>
                    {item.id && (item.isRelational || String(item.id).length > 20 || !isNaN(item.id)) && <PhotoHistory statusUpdateId={item.id} />}
                  </div>

                  <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Audit Remarks / Field Notes</label>
                    <textarea className="form-textarea"
                      style={{ fontSize: '0.95rem', padding: '1rem', flex: 1, minHeight: '120px', borderRadius: '12px', background: 'rgba(255,255,255,0.7)', border: item.status === 'Blocker' ? '2px solid rgba(239,68,68,0.4)' : '1px solid var(--border)' }}
                      placeholder="Describe deployment progress or specific blockers..."
                      value={(item.remarks?.startsWith('http') && item.remarks === item.photoLink) ? '' : (item.remarks || '')}
                      onChange={e => handleFieldChange(item.id, 'remarks', e.target.value)}
                    />
                  </div>
                </div>

                <style>{`
                  .checklist-item-row-premium:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 12px 24px rgba(0,0,0,0.06);
                  }
                  .hover-lift:hover {
                    transform: translateY(-1px);
                    background: var(--accent-primary) !important;
                    color: white !important;
                  }
                `}</style>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
