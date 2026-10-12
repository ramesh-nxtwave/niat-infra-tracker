import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth, ZONES } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { Search, ChevronRight, Trash2, Zap, AlertTriangle } from 'lucide-react';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { formatDate } from '../utils/dateUtils';

const EFFORT_COLORS_MAP = {
  HIGH: { bg: 'rgba(239,68,68,0.08)', color: '#ef4444', border: 'rgba(239,68,68,0.15)' },
  MEDIUM: { bg: 'rgba(245,158,11,0.08)', color: '#f59e0b', border: 'rgba(245,158,11,0.15)' },
  LOW: { bg: 'rgba(16,185,129,0.08)', color: '#10b981', border: 'rgba(16,185,129,0.15)' },
};

export default function UniversityList() {
  const {
    universities,
    deleteUniversity,
    updateUniversityZone,
    updateUniversityCriticalStatus,
    loading,
    addUniversity,
  } = useData();
  const { user, users } = useAuth();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const apmUsers = (users || []).filter(u => u.role === 'apm');
  const [searchTerm, setSearchTerm] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(null);
  const [criticalUpdatingId, setCriticalUpdatingId] = useState(null);
  const [newUniData, setNewUniData] = useState({
    name: '', location: '', targetDate: '', zone_id: '', apm_name: '',
    studentsCount: '', effortsRequired: '',
  });

  const resetForm = () => setNewUniData({
    name: '', location: '', targetDate: '', zone_id: '', apm_name: '',
    studentsCount: '', effortsRequired: '',
  });

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    try {
      await addUniversity(newUniData);
      showToast('University added successfully', 'success');
      setShowModal(false);
      resetForm();
    } catch (err) {
      showToast(`Failed to add: ${err.message}`, 'error');
    }
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

  const handleCriticalChange = async (uni) => {
    const nextIsCritical = !uni.isCritical;
    setCriticalUpdatingId(uni.id);
    try {
      await updateUniversityCriticalStatus(uni.id, nextIsCritical);
      showToast(
        nextIsCritical
          ? `${uni.name} marked as critical`
          : `${uni.name} removed from critical universities`,
        'success',
      );
    } catch (err) {
      showToast(
        `Failed to ${nextIsCritical ? 'mark' : 'unmark'} ${uni.name} as critical: ${err.message}`,
        'error',
      );
    } finally {
      setCriticalUpdatingId(null);
    }
  };

  // Backend already RBAC-filters the data — just apply local search on top
  const filteredUniversities = React.useMemo(() => {
    const all = (universities || []).filter(u => !!u);
    const criticalFiltered = criticalOnly ? all.filter(u => u.isCritical === true) : all;
    if (!searchTerm) return criticalFiltered;
    const s = searchTerm.toLowerCase();
    return criticalFiltered.filter(u =>
      (u.name || '').toLowerCase().includes(s) ||
      (u.location || '').toLowerCase().includes(s) ||
      String(u.id).toLowerCase().includes(s)
    );
  }, [universities, searchTerm, criticalOnly]);

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
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              color: 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: 700,
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
              <input
                type="checkbox"
                checked={criticalOnly}
                onChange={(event) => setCriticalOnly(event.target.checked)}
              />
              Critical universities only
            </label>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginTop: '1rem' }}>
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="glass-panel pulse" style={{ flex: '1 1 300px', height: '220px', background: 'rgba(255,255,255,0.05)', borderRadius: '16px' }} />
            ))}
          </div>
        ) : filteredUniversities.length === 0 ? (
          <div className="glass-panel text-center" style={{ padding: '4rem', marginTop: '2rem' }}>
            <h3 style={{ color: 'var(--text-secondary)' }}>No universities found</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              {searchTerm || criticalOnly
                ? 'Try adjusting your search or critical-university filter.'
                : 'No universities are assigned to your account yet.'}
            </p>
          </div>
        ) : (
          <div className="university-grid">
            {filteredUniversities.map(uni => {
              const effortStyle = EFFORT_COLORS_MAP[uni.effortsRequired?.toUpperCase()] || { bg: 'rgba(100,116,139,0.06)', color: '#64748b', border: 'rgba(100,116,139,0.12)' };

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
                    {/* Header: Name + Actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                      <h3 style={{
                        fontSize: '1.1rem',
                        fontWeight: 800,
                        color: 'var(--text-primary)',
                        margin: 0,
                        lineHeight: 1.3,
                        flex: 1,
                        paddingRight: '0.5rem'
                      }}>
                        <span>{uni.name || 'Unnamed Institution'}</span>
                        {uni.isCritical && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                            marginTop: '0.35rem', padding: '0.15rem 0.45rem', borderRadius: '999px',
                            background: 'rgba(239,68,68,0.12)', color: '#dc2626', fontSize: '0.62rem',
                            fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase',
                          }}>
                            <AlertTriangle size={11} aria-hidden="true" /> Critical
                          </span>
                        )}
                      </h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        {user?.role === 'admin' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(59,130,246,0.05)', padding: '0.2rem 0.5rem', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.1)' }}>
                            <select
                              value={uni.zone_id || ''}
                              disabled={isUpdating === uni.id}
                              onChange={(e) => handleZoneChange(uni.id, e.target.value)}
                              style={{ background: 'transparent', border: 'none', fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent-primary)', cursor: 'pointer', outline: 'none', padding: '0.1rem' }}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            >
                              <option value="">Zone</option>
                              {Object.entries(ZONES).map(([id, z]) => (
                                <option key={id} value={id}>{z.name.split('—')[0].trim()}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {user?.role === 'admin' && (
                          <button
                            type="button"
                            disabled={criticalUpdatingId === uni.id}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleCriticalChange(uni);
                            }}
                            aria-label={uni.isCritical
                              ? `Remove ${uni.name} from critical universities`
                              : `Mark ${uni.name} as critical`}
                            style={{
                              background: uni.isCritical ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.08)',
                              border: `1px solid ${uni.isCritical ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.2)'}`,
                              padding: '0.35rem 0.45rem', borderRadius: '8px', cursor: 'pointer',
                              color: uni.isCritical ? '#dc2626' : '#b45309', fontSize: '0.68rem', fontWeight: 800,
                              opacity: criticalUpdatingId === uni.id ? 0.65 : 1,
                            }}
                          >
                            {criticalUpdatingId === uni.id
                              ? 'Saving…'
                              : uni.isCritical ? 'Remove critical' : 'Mark critical'}
                          </button>
                        )}
                        {user?.role === 'admin' && (
                          <button
                            onClick={async (e) => {
                              e.preventDefault(); e.stopPropagation();
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
                            style={{ background: 'rgba(239,68,68,0.05)', border: 'none', padding: '0.4rem', borderRadius: '8px', cursor: 'pointer', color: '#ef4444' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Bento Grid: 4 cells */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginBottom: '1.25rem' }}>
                      {/* Target Date */}
                      <div style={{ background: 'rgba(59,130,246,0.04)', padding: '0.65rem', borderRadius: '10px', border: '1px solid rgba(59,130,246,0.08)' }}>
                        <p style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.15rem', letterSpacing: '0.05em' }}>Target Date</p>
                        <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-primary)', margin: 0 }}>
                          {formatDate(uni.targetDate)}
                        </p>
                      </div>
                      {/* Students */}
                      <div style={{ background: 'rgba(16,185,129,0.04)', padding: '0.65rem', borderRadius: '10px', border: '1px solid rgba(16,185,129,0.08)' }}>
                        <p style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.15rem', letterSpacing: '0.05em' }}>Students</p>
                        <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#10b981', margin: 0 }}>
                          {uni.studentsCount ? uni.studentsCount.toLocaleString() : `${uni.numClassrooms || 0} Rooms`}
                        </p>
                      </div>
                      {/* Efforts Required */}
                      <div style={{ background: effortStyle.bg, padding: '0.65rem', borderRadius: '10px', border: `1px solid ${effortStyle.border}` }}>
                        <p style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.15rem', letterSpacing: '0.05em' }}>Effort Level</p>
                        <p style={{ fontSize: '0.8rem', fontWeight: 800, color: effortStyle.color, margin: 0, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          {uni.effortsRequired ? (
                            <><Zap size={12} /> {uni.effortsRequired}</>
                          ) : '—'}
                        </p>
                      </div>
                      {/* Probability Status */}
                      <div style={{ background: 'rgba(139,92,246,0.04)', padding: '0.65rem', borderRadius: '10px', border: '1px solid rgba(139,92,246,0.08)' }}>
                        <p style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.15rem', letterSpacing: '0.05em' }}>Probability</p>
                        <p style={{ fontSize: '0.78rem', fontWeight: 700, color: '#8b5cf6', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {uni.probabilityStatus || '—'}
                        </p>
                      </div>
                    </div>

                    {/* Progress — compact chip */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
                      <span style={{
                        fontSize: '1.4rem', fontWeight: 900, lineHeight: 1,
                        color: (uni.overallReadiness || 0) >= 75 ? '#10b981' : (uni.overallReadiness || 0) >= 40 ? '#f59e0b' : '#ef4444'
                      }}>
                        {uni.overallReadiness || 0}%
                      </span>
                      <span style={{
                        fontSize: '0.62rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '999px',
                        background: (uni.overallReadiness || 0) >= 75 ? 'rgba(16,185,129,0.15)' : (uni.overallReadiness || 0) >= 40 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                        color: (uni.overallReadiness || 0) >= 75 ? '#10b981' : (uni.overallReadiness || 0) >= 40 ? '#f59e0b' : '#ef4444',
                      }}>
                        {(uni.overallReadiness || 0) >= 75 ? '✓ On Track' : (uni.overallReadiness || 0) >= 40 ? '● In Progress' : '! Needs Attention'}
                      </span>
                      <div style={{ marginLeft: 'auto', color: 'var(--accent-primary)', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem' }}>
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

      {/* Add University Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999
        }}>
          <div className="glass-panel" style={{ padding: '2rem', width: '100%', maxWidth: '540px', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--accent-primary)', zIndex: 10000 }}>
            <h2 className="mb-4 text-gradient">Add New University</h2>
            <form onSubmit={handleAddSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="text-secondary block mb-2 text-sm">University Name *</label>
                <input type="text" className="form-input w-full" required value={newUniData.name}
                  onChange={e => setNewUniData({ ...newUniData, name: e.target.value })} />
              </div>
              <div>
                <label className="text-secondary block mb-2 text-sm">Location</label>
                <input type="text" className="form-input w-full" value={newUniData.location}
                  onChange={e => setNewUniData({ ...newUniData, location: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="text-secondary block mb-2 text-sm">Target Launch Date</label>
                  <input type="date" className="form-input w-full" value={newUniData.targetDate}
                    onChange={e => setNewUniData({ ...newUniData, targetDate: e.target.value })} />
                </div>
                <div>
                  <label className="text-secondary block mb-2 text-sm">No. of Students</label>
                  <input type="number" className="form-input w-full" value={newUniData.studentsCount}
                    onChange={e => setNewUniData({ ...newUniData, studentsCount: e.target.value })}
                    placeholder="e.g. 800" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="text-secondary block mb-2 text-sm">Mapping Zone</label>
                  <select className="form-select w-full" value={newUniData.zone_id}
                    onChange={e => setNewUniData({ ...newUniData, zone_id: e.target.value })}
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.625rem' }}>
                    <option value="">Select a Zone</option>
                    {Object.entries(ZONES).map(([id, z]) => (
                      <option key={id} value={id}>{z.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-secondary block mb-2 text-sm">Efforts Required</label>
                  <select className="form-select w-full" value={newUniData.effortsRequired}
                    onChange={e => setNewUniData({ ...newUniData, effortsRequired: e.target.value })}
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.625rem' }}>
                    <option value="">Select Level</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-secondary block mb-2 text-sm">Assign APM</label>
                <select className="form-select w-full" value={newUniData.apm_name}
                  onChange={e => setNewUniData({ ...newUniData, apm_name: e.target.value })}
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.625rem' }}>
                  <option value="">Select an APM</option>
                  {apmUsers.map(u => (
                    <option key={u.id} value={u.name}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button type="button" className="button button-secondary" onClick={() => { setShowModal(false); resetForm(); }}>Cancel</button>
                <button type="submit" className="button button-primary">Save University</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
