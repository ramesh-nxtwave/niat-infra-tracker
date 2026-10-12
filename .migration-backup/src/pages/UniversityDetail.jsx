import React, { useState, useMemo, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { ArrowLeft, LayoutDashboard, Component, FlaskConical, Users, PieChart, Trash2, Loader, ClipboardList, Building2, MapPin, Phone, Calendar, AlertTriangle } from 'lucide-react';
import OverallClassroomForm from '../components/forms/OverallClassroomForm';
import ModelClassroomForm from '../components/forms/ModelClassroomForm';
import Lab5Form from '../components/forms/Lab5Form';
import StaffRoomForm from '../components/forms/StaffRoomForm';
import UniversityUpdates from '../components/forms/UniversityUpdates';
import UniversityMetadataModal from '../components/forms/UniversityMetadataModal';

export default function UniversityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { getUniversity, updateUniversity, deleteUniversity, loadUniversityDetail } = useData();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState('summary');
  const [detailLoading, setDetailLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const university = getUniversity(id);

  const loadData = React.useCallback(async (force = false) => {
    setDetailLoading(true);
    setFetchError(null);
    try {
      await loadUniversityDetail(id, force);
    } catch (err) {
      setFetchError(err.message || 'Failed to load details');
    } finally {
      setDetailLoading(false);
    }
  }, [id, loadUniversityDetail]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Deep-link logic for blockers from Master Tracker
  useEffect(() => {
    if (detailLoading || !university) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('focus') === 'blockers') {
      const getB = (items) => (items || []).filter(i => i?.status === 'Blocker').length;
      const t = university.trackers || {};
      
      // Smart detection: switch to the first tab that actually has a blocker
      if (getB(t.modelClassroom?.items) > 0) setActiveTab('model');
      else if (university.classrooms?.some(c => ['civil_status', 'electrical_status', 'tv_status', 'furniture_status', 'av_status'].some(f => c[f] === 'Blocker'))) setActiveTab('overall');
      else if (getB(t.lab5?.items) > 0) setActiveTab('lab5');
      else if (getB(t.staffRoom?.items) > 0) setActiveTab('staff');
      else if (getB(t.overallClassroom?.items) > 0) setActiveTab('overall');
    }
  }, [detailLoading, university]);

  if (!university) {
    return (
      <div className="app-container text-center" style={{ marginTop: '5rem' }}>
        <Loader size={40} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-primary)', margin: '0 auto 1rem' }} />
        <h2 className="page-title">Loading university…</h2>
        <button onClick={() => navigate('/universities')} className="button button-secondary mt-4">← Go Back</button>
      </div>
    );
  }

  const handleUpdate = async (trackerName, newData) => {
    try {
      await updateUniversity(id, trackerName, newData);
      showToast('Data saved successfully!', 'success');
    } catch (err) {
      console.error('Save failed:', err);
      showToast(`Error saving: ${err.message || 'Check your connection.'}`, 'error');
    }
  };

  const riskColor = university.riskStatus === 'RED' ? '#ef4444' : university.riskStatus === 'YELLOW' ? '#f59e0b' : '#10b981';

  const tabs = [
    { id: 'summary',  label: 'Summary',          icon: <PieChart size={15} /> },
    { id: 'updates',  label: 'Daily Updates',     icon: <ClipboardList size={15} /> },
    { id: 'model',    label: 'Model Classroom',   icon: <Component size={15} /> },
    { id: 'lab5',     label: '5.0 Lab',           icon: <FlaskConical size={15} /> },
    { id: 'staff',    label: 'Staff Room',        icon: <Users size={15} /> },
    { id: 'overall',  label: 'Overall Classroom', icon: <LayoutDashboard size={15} /> },
  ];

  const CHECKLIST_TABS = ['model', 'lab5', 'staff', 'overall'];

  return (
    <div className="app-container fade-in" style={{ paddingBottom: '5rem' }}>
      {/* Back */}
      <div className="mb-6">
        <Link to="/universities" className="text-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', fontSize: '0.875rem' }}>
          <ArrowLeft size={16} /> Back to Universities
        </Link>
      </div>

      {/* ── University Header Card ─────────────────────────────── */}
      <div className="glass-panel mb-8" style={{ padding: '1.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.25rem' }}>
          <div style={{ flex: '1 1 300px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <h1 className="page-title text-gradient" style={{ marginBottom: 0 }}>{university.name}</h1>
              <span style={{ padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 800, background: `${riskColor}22`, color: riskColor, border: `1px solid ${riskColor}55`, letterSpacing: '0.05em' }}>
                {university.riskStatus || 'GREEN'}
              </span>
              {(user?.role === 'admin' || user?.role === 'zonal_manager' || user?.role === 'apm') && (
                <button onClick={() => setIsEditModalOpen(true)} className="button button-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                  Edit Info
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', marginTop: '0.625rem' }}>
              {university.location && university.location !== 'TBD' && (
                <span className="text-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
                  <MapPin size={14} /> {university.location}
                </span>
              )}
              {university.pocName && (
                <span className="text-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
                  <Phone size={14} /> {university.pocName} {university.pocNumber && `· ${university.pocNumber}`}
                </span>
              )}
              {university.targetDate && (
                <span className="text-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
                  <Calendar size={14} /> Target: <b style={{ color: 'var(--text-primary)' }}>{university.targetDate}</b>
                </span>
              )}
              {university.apmName && (
                <span className="text-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
                  APM: <b style={{ color: 'var(--text-primary)' }}>{university.apmName}</b>
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Overall Progress</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                <div className="progress-container" style={{ width: '180px', height: '8px' }}>
                  <div className="progress-bar" style={{ width: `${university.overallReadiness || 0}%` }} />
                </div>
                <span className="font-bold" style={{ fontSize: '1.75rem', color: university.overallReadiness >= 75 ? '#10b981' : university.overallReadiness >= 40 ? '#f59e0b' : '#ef4444' }}>
                  {university.overallReadiness || 0}%
                </span>
              </div>
            </div>
            {user?.role === 'admin' && (
              <button
                onClick={async () => { 
                  const isConfirmed = await confirm(
                    `Delete ${university.name}?`,
                    'All data, checklists, and photo history for this university will be permanently deleted.',
                    { confirmLabel: 'Delete Portfolio', isDanger: true }
                  );
                  if (isConfirmed) {
                    await deleteUniversity(university.id); 
                    showToast('University portfolio deleted', 'info');
                    navigate('/universities'); 
                  }
                }}
                className="button button-secondary"
                style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.2)', padding: '0.5rem', borderRadius: '8px' }}
                title="Delete University"
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tab Navigation ────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`button ${activeTab === tab.id ? 'button-primary' : 'button-secondary'}`}
            style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', padding: '0.5rem 0.875rem' }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── Summary Tab ───────────────────────────────────────── */}
      {activeTab === 'summary' && (
        <div className="fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Space Readiness */}
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <h3 className="chart-title mb-5" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <LayoutDashboard size={18} /> Space Readiness
              </h3>
              {detailLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {[1, 2, 3].map(i => <div key={i} className="pulse" style={{ height: '30px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }} />)}
                </div>
              ) : Object.entries(university.spaceMetrics || {}).length === 0 ? (
                <p className="text-secondary text-center" style={{ padding: '2rem 0' }}>Load a checklist tab to see readiness data.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {Object.entries(university.spaceMetrics || {}).map(([space, value], idx) => (
                    <div key={idx}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <span className="font-semibold" style={{ fontSize: '0.875rem' }}>{space}</span>
                        <span className="font-bold" style={{ fontSize: '0.875rem', color: value >= 75 ? '#10b981' : value >= 40 ? '#f59e0b' : '#ef4444' }}>{value}%</span>
                      </div>
                      <div className="progress-container" style={{ height: '6px' }}>
                        <div className="progress-bar" style={{ width: `${value}%`, background: value >= 75 ? '#10b981' : value >= 40 ? '#f59e0b' : '#ef4444' }} />
                      </div>

                      {/* Individual Room Progress for Overall Classrooms */}
                      {space === 'Overall Classroom' && university.trackers.overallClassroom?.classrooms?.length > 0 && (
                        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.625rem', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', borderLeft: '3px solid var(--accent-primary)' }}>
                          {university.trackers.overallClassroom.classrooms.map(room => {
                            const roomReadiness = (function() {
                              if (!room.items || room.items.length === 0) return 0;
                              const done = room.items.filter(i => i.status === 'Done').length;
                              return Math.round((done / room.items.length) * 100);
                            })();
                            return (
                              <div key={room.id}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{room.room_id}</span>
                                  <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{roomReadiness}%</span>
                                </div>
                                <div className="progress-container" style={{ height: '3px', background: 'rgba(255,255,255,0.05)' }}>
                                  <div className="progress-bar" style={{ width: `${roomReadiness}%`, background: 'var(--accent-primary)', opacity: 0.7 }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Classroom Info */}
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <h3 className="chart-title mb-4" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Building2 size={18} /> Classroom Info
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {[
                  { label: 'Classroom Allocation', value: university.classroomAllocationDone ? '✅ Done' : '❌ Pending', highlight: university.classroomAllocationDone },
                  { label: 'No. of Classrooms', value: university.numClassrooms ?? '—' },
                  { label: 'Classroom Capacity', value: university.classroomCapacity ? `${university.classroomCapacity} seats` : '—' },
                  { label: 'Start Date', value: university.startDate || '—' },
                  { label: 'Target Date', value: university.targetDate || '—' },
                  { label: 'APM Assigned', value: university.apmName || '—' },
                ].map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.625rem', borderBottom: '1px solid var(--border)' }}>
                    <span className="text-secondary" style={{ fontSize: '0.85rem' }}>{r.label}</span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <p className="text-secondary" style={{ marginBottom: '0.875rem', fontSize: '0.85rem' }}>Quick navigation to checklists:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.625rem' }}>
              {CHECKLIST_TABS.map(t => {
                const tab = tabs.find(tb => tb.id === t);
                return (
                  <button key={t} onClick={() => setActiveTab(t)} className="button button-secondary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {tab.icon} {tab.label}
                  </button>
                );
              })}
              <button onClick={() => setActiveTab('updates')} className="button button-secondary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <ClipboardList size={14} /> Daily Updates
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Daily Updates Tab ─────────────────────────────────── */}
      {activeTab === 'updates' && (
        <div className="glass-panel fade-in" style={{ padding: '1.5rem' }}>
          <UniversityUpdates universityId={university.id} />
        </div>
      )}

      {/* ── Checklist Form Tabs ───────────────────────────────── */}
      {CHECKLIST_TABS.includes(activeTab) && (
        <div className="glass-panel fade-in" style={{ padding: '1.5rem' }}>
          {detailLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '1rem' }}>
              <Loader size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-primary)' }} />
              <p className="text-secondary">Loading checklist data…</p>
            </div>
          ) : fetchError ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '1rem', textAlign: 'center' }}>
              <AlertTriangle size={48} className="text-danger mb-2" />
              <p className="font-bold text-danger">{fetchError}</p>
              <button onClick={() => loadData(true)} className="button button-primary">Retry Loading</button>
            </div>
          ) : (
            <>
              {activeTab === 'model' && (
                <ModelClassroomForm universityId={university.id} data={university.trackers.modelClassroom} onSave={(d) => handleUpdate('modelClassroom', d)} />
              )}
              {activeTab === 'lab5' && (
                <Lab5Form universityId={university.id} data={university.trackers.lab5} onSave={(d) => handleUpdate('lab5', d)} />
              )}
              {activeTab === 'staff' && (
                <StaffRoomForm universityId={university.id} data={university.trackers.staffRoom} onSave={(d) => handleUpdate('staffRoom', d)} />
              )}
              {activeTab === 'overall' && (
                <OverallClassroomForm universityId={university.id} data={university.trackers.overallClassroom} onSave={(d) => handleUpdate('overallClassroom', d)} />
              )}
            </>
          )}
        </div>
      )}

      {/* ── Metadata Modal ────────────────────────────────────── */}
      {isEditModalOpen && (
        <UniversityMetadataModal university={university} onClose={() => setIsEditModalOpen(false)} />
      )}
    </div>
  );
}
