import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth, ZONES } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { Search, MapPin, ChevronRight, Calendar, Trash2 } from 'lucide-react';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';

export default function UniversityList() {
  const { universities, deleteUniversity, updateUniversityZone, loading } = useData();
  const { user, users, ZONES } = useAuth();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const apmUsers = (users || []).filter(u => u.role === 'apm');
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(null);
  const [newUniData, setNewUniData] = useState({
    name: '', location: '', pocName: '', pocNumber: '', targetDate: '', zone_id: '', apm_name: ''
  });

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    const { addUniversity } = useData();
    await addUniversity(newUniData);
    setShowModal(false);
    resetForm();
  };

  const handleZoneChange = async (uniId, zoneId) => {
    setIsUpdating(uniId);
    const success = await updateUniversityZone(uniId, zoneId);
    if (success) {
      showToast('University mapped to zone successfully', 'success');
    } else {
      showToast('Failed to update mapping', 'error');
    }
    setIsUpdating(null);
  };

  // Build the user's zone set once
  const userZoneSet = React.useMemo(() => {
    if (user?.role !== 'zonal_manager') return new Set();
    return new Set(
      [
        ...(Array.isArray(user?.zoneIds) ? user.zoneIds : []),
        ...(user?.zoneId != null ? [user.zoneId] : [])
      ].map(id => Number(id)).filter(n => !isNaN(n))
    );
  }, [user]);

  const filteredUniversities = React.useMemo(() => {
    const all = (universities || []).filter(u => !!u);

    // ── Visibility Filtering ────────────────────────────────────────────────
    if (user?.role === 'zonal_manager') {
      // If user has no zones configured at all → show everything (data issue)
      if (userZoneSet.size === 0) return all;

      // Zonal Manager: Show assigned zones + any UNTAGGED universities (fallback)
      const visible = all.filter(u => {
        const uniZone = u.zone_id != null ? Number(u.zone_id) : null;
        // Show if zone matches OR if university has no zone assigned (yet)
        return (uniZone != null && userZoneSet.has(uniZone)) || (uniZone == null);
      });

      // Apply search on top
      if (!searchTerm) return visible;
      const s = searchTerm.toLowerCase();
      return visible.filter(u => (u.name || '').toLowerCase().includes(s) || String(u.id).toLowerCase().includes(s));

    } else if (user?.role === 'apm') {
      const mappedIds = new Set(
        (Array.isArray(user?.universityIds) ? user.universityIds : []).map(id => String(id))
      );
      const visible = all.filter(u => {
        const idMatch = mappedIds.has(String(u.id));
        const nameMatch = u.apm_name && user?.name &&
          u.apm_name.toLowerCase().trim() === user.name.toLowerCase().trim();
        return idMatch || nameMatch;
      });
      if (!searchTerm) return visible;
      const s = searchTerm.toLowerCase();
      return visible.filter(u => (u.name || '').toLowerCase().includes(s));
    }

    // Admin → sees everything, apply search
    if (!searchTerm) return all;
    const s = searchTerm.toLowerCase();
    return all.filter(u => (u.name || '').toLowerCase().includes(s) || String(u.id).toLowerCase().includes(s));
  }, [universities, user, userZoneSet, searchTerm]);

  const getStatusColor = (status) => {
    switch(status) {
      case 'Done': return 'badge-success';
      case 'In-Progress': return 'badge-warning';
      case 'Yet to start': return 'badge-danger';
      case 'Blocked': return 'badge-danger';
      case 'RED': return 'badge-danger';
      case 'YELLOW': return 'badge-warning';
      case 'GREEN': return 'badge-success';
      default: return 'badge-neutral';
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'TBD';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? 'TBD' : d.toLocaleDateString();
  };

  return (
    <>
      <div className="app-container fade-in">
        <div className="page-header">
          <div className="page-header-column">
            <h1 className="page-title text-gradient">Universities</h1>
            <p className="page-subtitle">Manage and update tracking data for all locations.</p>
          </div>
          <div className="header-actions">
            {user?.role === 'admin' && (
              <button 
                className="button button-primary"
                onClick={() => setShowModal(true)}
                style={{ marginRight: '0.5rem' }}
              >
                + Add University
              </button>
            )}
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Search universities..." 
                className="form-input search-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <Search className="search-icon" size={18} />
            </div>
          </div>
        </div>

        {/* Diagnostic banner for zonal managers */}
        {user?.role === 'zonal_manager' && (
          <div style={{
            background: userZoneSet.size === 0
              ? 'rgba(239,68,68,0.08)'
              : 'rgba(59,130,246,0.06)',
            border: `1px solid ${userZoneSet.size === 0 ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.2)'}`,
            borderRadius: '12px',
            padding: '0.75rem 1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap'
          }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {userZoneSet.size === 0
                  ? '⚠️ No zones assigned to your account. Contact admin.'
                  : `✅ Zones assigned: ${[...userZoneSet].join(', ')} — Showing ${filteredUniversities.length} universities`}
              </p>
              {userZoneSet.size > 0 && filteredUniversities.length === universities?.length && (
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.7rem', color: '#f59e0b' }}>
                  ⚠️ Showing all universities — some may not have zones set in database. Ask admin to assign zones.
                </p>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginTop: '1rem' }}>
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="glass-panel pulse" style={{ flex: '1 1 300px', height: '220px', background: 'rgba(255,255,255,0.05)', borderRadius: '16px' }} />
            ))}
          </div>
        ) : (
          <div className="university-grid">
          {filteredUniversities.map(uni => {
            const trackers = uni.trackers || {};
            const modelStatus = (trackers.modelClassroom && trackers.modelClassroom.status) || 'In-Progress';
            const riskStatus = uni.riskStatus || 'GREEN';

            return (
              <Link to={`/university/${uni.id}`} key={uni.id} style={{ textDecoration: 'none' }}>
                <div className="glass-panel university-card" style={{ 
                  padding: '1.5rem', 
                  position: 'relative', 
                  overflow: 'hidden',
                  background: 'linear-gradient(135deg, var(--bg-secondary) 0%, rgba(255,255,255,0.7) 100%)',
                  border: '1px solid var(--border)',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }}>
                  {/* Header: Name and Action */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                    <h3 style={{ 
                      fontSize: '1.15rem', 
                      fontWeight: 800, 
                      color: 'var(--text-primary)', 
                      margin: 0,
                      lineHeight: 1.3,
                      flex: 1
                    }}>
                      {uni.name || 'Unnamed Institution'}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {user?.role === 'admin' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(59, 130, 246, 0.05)', padding: '0.2rem 0.5rem', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.1)' }}>
                          <MapPin size={12} className="text-accent-primary" />
                          <select 
                            value={uni.zone_id || ''} 
                            disabled={isUpdating === uni.id}
                            onChange={(e) => handleZoneChange(uni.id, e.target.value)}
                            style={{ 
                              background: 'transparent', 
                              border: 'none', 
                              fontSize: '0.7rem', 
                              fontWeight: 700, 
                              color: 'var(--accent-primary)',
                              cursor: 'pointer',
                              outline: 'none',
                              padding: '0.1rem'
                            }}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          >
                            <option value="">No Zone</option>
                            {Object.entries(ZONES).map(([id, z]) => (
                              <option key={id} value={id}>{z.name.split('—')[0].trim()}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {user?.role === 'admin' && (
                        <button 
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const isConfirmed = await confirm(
                              `Delete ${uni.name}?`,
                              'This will permanently remove the institution and all its tracking data.',
                              { confirmLabel: 'Delete Portfolio', isDanger: true }
                            );
                            if (isConfirmed) {
                              await deleteUniversity(uni.id);
                              showToast('Institution removed', 'info');
                            }
                          }}
                          style={{ background: 'rgba(239, 68, 68, 0.05)', border: 'none', padding: '0.4rem', borderRadius: '8px', cursor: 'pointer', color: '#ef4444' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Bento Grid Info - 4 Cells */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginBottom: '1.25rem' }}>
                    {/* Target Date */}
                    <div style={{ background: 'rgba(59, 130, 246, 0.04)', padding: '0.65rem', borderRadius: '10px', border: '1px solid rgba(59, 130, 246, 0.08)' }}>
                      <p style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.15rem', letterSpacing: '0.05em' }}>Target Date</p>
                      <p style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-primary)', margin: 0 }}>
                        {formatDate(uni.targetDate)}
                      </p>
                    </div>
                    {/* Classrooms */}
                    <div style={{ background: 'rgba(16, 185, 129, 0.04)', padding: '0.65rem', borderRadius: '10px', border: '1px solid rgba(16, 185, 129, 0.08)' }}>
                      <p style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.15rem', letterSpacing: '0.05em' }}>Classrooms</p>
                      <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#10b981', margin: 0 }}>
                        {uni.numClassrooms || 0} Rooms
                      </p>
                    </div>
                    {/* Zone */}
                    <div style={{ background: 'rgba(139, 92, 246, 0.04)', padding: '0.65rem', borderRadius: '10px', border: '1px solid rgba(139, 92, 246, 0.08)' }}>
                      <p style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.15rem', letterSpacing: '0.05em' }}>Zone</p>
                      <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#8b5cf6', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {ZONES[uni.zone_id]?.name?.split('—')[1] || 'TBD'}
                      </p>
                    </div>
                    {/* APM */}
                    <div style={{ background: 'rgba(245, 158, 11, 0.04)', padding: '0.65rem', borderRadius: '10px', border: '1px solid rgba(245, 158, 11, 0.08)' }}>
                      <p style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.15rem', letterSpacing: '0.05em' }}>Assigned APM</p>
                      <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f59e0b', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {uni.apmName || 'TBD'}
                      </p>
                    </div>
                  </div>

                  {/* Progress Section */}
                  <div style={{ background: 'var(--bg-primary)', padding: '1rem', borderRadius: '16px', marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Overall Readiness</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-primary)' }}>{uni.overallReadiness || 0}%</span>
                    </div>
                    <div className="progress-container" style={{ height: '6px' }}>
                      <div 
                        className="progress-bar" 
                        style={{ width: `${uni.overallReadiness || 0}%`, boxShadow: '0 0 10px rgba(37, 99, 235, 0.3)' }}
                      ></div>
                    </div>
                  </div>
                  
                  {/* Footer: Action only */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', fontSize: '0.75rem' }}>
                    <div style={{ color: 'var(--accent-primary)', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      View Details <ChevronRight size={14} />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
          </div>
        )}
      </div>
      
      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999
        }}>
          <div className="glass-panel" style={{ padding: '2rem', width: '100%', maxWidth: '500px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--accent-primary)', zIndex: 10000 }}>
            <h2 className="mb-4 text-gradient">Add New University</h2>
            <form onSubmit={handleAddSubmit}>
              <div className="mb-4">
                <label className="text-secondary block mb-2 text-sm">University Name</label>
                <input 
                  type="text" 
                  className="form-input w-full" 
                  required
                  value={newUniData.name}
                  onChange={e => setNewUniData({...newUniData, name: e.target.value})}
                />
              </div>
              <div className="mb-4">
                <label className="text-secondary block mb-2 text-sm">Location</label>
                <input 
                  type="text" 
                  className="form-input w-full" 
                  required
                  value={newUniData.location}
                  onChange={e => setNewUniData({...newUniData, location: e.target.value})}
                />
              </div>
              <div className="mb-4">
                <label className="text-secondary block mb-2 text-sm">POC Name</label>
                <input 
                  type="text" 
                  className="form-input w-full" 
                  required
                  value={newUniData.pocName}
                  onChange={e => setNewUniData({...newUniData, pocName: e.target.value})}
                />
              </div>
              <div className="mb-4">
                <label className="text-secondary block mb-2 text-sm">POC Phone</label>
                <input 
                  type="text" 
                  className="form-input w-full" 
                  required
                  value={newUniData.pocNumber}
                  onChange={e => setNewUniData({...newUniData, pocNumber: e.target.value})}
                />
              </div>
              <div className="mb-6">
                <label className="text-secondary block mb-2 text-sm">Target Launch Date</label>
                <input 
                  type="date" 
                  className="form-input w-full" 
                  required
                  value={newUniData.targetDate}
                  onChange={e => setNewUniData({...newUniData, targetDate: e.target.value})}
                />
              </div>
              <div className="mb-6">
                <label className="text-secondary block mb-2 text-sm">Mapping Zone</label>
                <select 
                  className="form-select w-full" 
                  required
                  value={newUniData.zone_id}
                  onChange={e => setNewUniData({...newUniData, zone_id: e.target.value})}
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.625rem' }}
                >
                  <option value="">Select a Zone</option>
                  {Object.entries(ZONES).map(([id, z]) => (
                    <option key={id} value={id}>{z.name}</option>
                  ))}
                </select>
              </div>
              <div className="mb-6">
                <label className="text-secondary block mb-2 text-sm">Assign APM</label>
                <select 
                  className="form-select w-full" 
                  value={newUniData.apm_name}
                  onChange={e => setNewUniData({...newUniData, apm_name: e.target.value})}
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.625rem' }}
                >
                  <option value="">Select an APM</option>
                  {apmUsers.map(u => (
                    <option key={u.id} value={u.name}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button type="button" className="button button-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="button button-primary">Save University</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
