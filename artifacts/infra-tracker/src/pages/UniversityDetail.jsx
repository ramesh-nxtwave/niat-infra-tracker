import React, { useState, useRef, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { ArrowLeft, LayoutDashboard, Component, FlaskConical, Users, PieChart, Trash2, Loader, ClipboardList, Building2, MapPin, Calendar, AlertTriangle, Download, ListTodo, Flag } from 'lucide-react';
import { exportChecklistCSV } from '../utils/exportUtils';
import OverallClassroomForm from '../components/forms/OverallClassroomForm';
import Lab5Form from '../components/forms/Lab5Form';
import StaffRoomForm from '../components/forms/StaffRoomForm';
import UniversityUpdates from '../components/forms/UniversityUpdates';
import UniversityMetadataModal from '../components/forms/UniversityMetadataModal';
import ActionItems from '../components/ActionItems';
import { formatDate } from '../utils/dateUtils';
import { MODEL_CLASSROOM_ID, resolveChecklistDestination, withDetailTimeout } from '../utils/checklistDestination';

const PRIORITY_COLORS = {
  P1: '#ef4444',
  P2: '#f59e0b',
  P3: '#10b981',
};

export function checklistSaveToast(result) {
  if (result?.remarkOnly || (result?.savedRemarks && result?.writeCount === 0)) return 'Saved remarks';
  if (result?.writeCount === 0 && !result?.savedRemarks) return 'No unsaved checklist changes.';
  return 'Data saved successfully!';
}

export default function UniversityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { getUniversity, updateUniversity, deleteUniversity, loadUniversityDetail } = useData();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState('summary');
  const [loadState, setLoadState] = useState(null);
  const [retry, setRetry] = useState(0);
  const [target, setTarget] = useState(null);
  const [overallClassroomSelection, setOverallClassroomSelection] = useState(null);
  const appliedNavigation = useRef(null);
  const loader = useRef(loadUniversityDetail);
  loader.current = loadUniversityDetail;
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const navigationKey = `${location.key}:${id}:${location.search}`;
  const requestKey = `${navigationKey}:${user?.id}:${user?.role}:${retry}`;
  const currentLoad = loadState?.key === requestKey ? loadState : null;
  const detailLoading = !currentLoad || currentLoad.loading;
  const fetchError = currentLoad?.error;
  const university = currentLoad?.data ? (getUniversity(id) || currentLoad.data) : null;
  const destination = resolveChecklistDestination(university, location.search);
  const loadData = () => setRetry(value => value + 1);

  useEffect(() => {
    let cancelled = false;
    setLoadState({ key: requestKey, loading: true });
    // Validate access and existence afresh on navigation, not against an old cache.
    // The loader's identity changes after cache writes; it must not trigger reloads.
    withDetailTimeout(Promise.resolve().then(() => loader.current(id, true))).then(data => {
      if (!cancelled) setLoadState({
        key: requestKey, loading: false, data,
        error: data ? null : 'University not found or unavailable to your account.',
      });
    }).catch(error => {
      if (!cancelled) setLoadState({
        key: requestKey, loading: false,
        error: error.status === 403 ? 'You do not have access to this university.'
          : error.status === 404 ? 'This university could not be found.'
            : error.message || 'Failed to load university details. Please retry.',
      });
    });
    return () => { cancelled = true; };
  }, [requestKey, id]);

  // Scroll to top whenever the university id changes (navigating from Master Tracker)
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [id]);

  // Deep-link logic for blockers from Master Tracker
  useEffect(() => {
    if (detailLoading || fetchError || !university || appliedNavigation.current === navigationKey) return;
    setTarget(null);
    if (destination.kind === 'found') {
      appliedNavigation.current = navigationKey;
      setActiveTab(destination.tab);
      setTarget({ ...destination, navigationKey, revealed: false });
      setOverallClassroomSelection(
        destination.tab === 'overall'
          ? (destination.modelClassroom ? MODEL_CLASSROOM_ID : destination.classroomId)
          : null,
      );
      return;
    }
    // Explicit item targets always take precedence, including invalid targets.
    if (destination.kind !== 'none') return;
    appliedNavigation.current = navigationKey;
    const params = new URLSearchParams(location.search);
    if (params.get('focus') === 'blockers') {
      const getB = (items) => (items || []).filter(i => i?.status === 'Blocker').length;
      const t = university.trackers || {};
      const blockedClassroom = (t.overallClassroom?.classrooms || []).find(classroom =>
        getB(classroom.items) > 0
          || ['civil_status', 'electrical_status', 'tv_status', 'furniture_status', 'av_status']
            .some(field => classroom[field] === 'Blocker'),
      );
      if (getB(t.modelClassroom?.items) > 0) {
        setActiveTab('overall');
        setOverallClassroomSelection(MODEL_CLASSROOM_ID);
      } else if (blockedClassroom) {
        setActiveTab('overall');
        setOverallClassroomSelection(blockedClassroom.id);
      } else if (getB(t.lab5?.items) > 0) setActiveTab('lab5');
      else if (getB(t.staffRoom?.items) > 0) setActiveTab('staff');
      else if (getB((t.overallClassroom?.classrooms || []).flatMap(classroom => classroom.items || [])) > 0) {
        setActiveTab('overall');
        setOverallClassroomSelection(null);
      }
    }
  }, [detailLoading, fetchError, university, navigationKey, location.search, destination]);

  const onTargetRevealed = React.useCallback(key => {
    setTarget(current => current?.navigationKey === key ? { ...current, revealed: true } : current);
  }, []);
  const checklistTarget = !detailLoading && !fetchError && destination.kind === 'found' &&
    target?.navigationKey === navigationKey && target.tab === activeTab ? target : null;
  const selectTab = (tab, classroomId) => {
    setTarget(null);
    setActiveTab(tab);
    if (tab === 'overall') {
      setOverallClassroomSelection(classroomId === undefined ? null : classroomId);
    }
  };

  if (detailLoading || fetchError || !university) {
    return (
      <div className="app-container text-center" style={{ marginTop: '5rem' }}>
        {detailLoading ? (
          <div role="status">
            <Loader size={40} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-primary)', margin: '0 auto 1rem' }} />
            <h2 className="page-title">Loading university…</h2>
          </div>
        ) : (
          <div role="alert">
            <h2 className="page-title">Unable to open university</h2>
            <p>{fetchError || 'University not found or unavailable to your account.'}</p>
            <button type="button" onClick={loadData} className="button button-primary mt-4">Retry Loading</button>
          </div>
        )}
        <button onClick={() => navigate(-1)} className="button button-secondary mt-4">← Go Back</button>
        <Link to="/reports" className="button button-secondary mt-4">Open Reports</Link>
      </div>
    );
  }

  const handleUpdate = async (trackerName, newData) => {
    try {
      const result = await updateUniversity(id, trackerName, newData);
      if (result.refreshed) {
        showToast(checklistSaveToast(result), 'success');
      } else {
        showToast('Changes were saved, but summary data could not refresh yet.', 'warning');
      }
      return { ok: true, ...result };
    } catch (err) {
      console.error('Save failed:', err);
      const reference = err.correlationId ? ` Reference: ${err.correlationId}.` : '';
      showToast(`Error saving: ${err.message || 'Check your connection.'}${reference}`, 'error');
      return { ok: false, error: err };
    }
  };

  const tabs = [
    { id: 'summary',  label: 'Summary',             icon: <PieChart size={15} /> },
    { id: 'updates',  label: 'Updates & Actions',   icon: <ClipboardList size={15} /> },
    { id: 'lab5',     label: '5.0 Lab',             icon: <FlaskConical size={15} /> },
    { id: 'staff',    label: 'Staff Room',          icon: <Users size={15} /> },
    { id: 'overall',  label: 'All Classrooms',      icon: <LayoutDashboard size={15} /> },
  ];

  const CHECKLIST_TABS = ['lab5', 'staff', 'overall'];

  const priorityColor = PRIORITY_COLORS[university.priority] || PRIORITY_COLORS.MEDIUM;

  return (
    <div className="app-container fade-in" style={{ paddingBottom: '5rem' }}>
      {/* Back */}
      <div className="mb-6">
        <button onClick={() => navigate(-1)} className="text-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0 }}>
          <ArrowLeft size={16} /> Back
        </button>
      </div>

      {(destination.kind === 'invalid' || destination.kind === 'missing') && (
        <div role="alert" className="glass-panel mb-6" style={{ padding: '1rem', border: '1px solid var(--warning)' }}>
          <p>{destination.message}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
            <button type="button" onClick={loadData} className="button button-secondary">Retry Loading</button>
            <Link to={`/university/${encodeURIComponent(id)}`} className="button button-secondary">Browse university</Link>
            <Link to={`/reports?university=${encodeURIComponent(id)}`} className="button button-secondary">Open Reports</Link>
          </div>
        </div>
      )}

      {/* ── University Header Card ─────────────────────────────── */}
      <div className="glass-panel mb-8" style={{ padding: '1.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.25rem' }}>
          <div style={{ flex: '1 1 300px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              <h1 className="page-title text-gradient" style={{ marginBottom: 0 }}>{university.name}</h1>
              {university.priority && (
                <span style={{ background: `${priorityColor}18`, color: priorityColor, border: `1px solid ${priorityColor}40`, padding: '0.15rem 0.5rem', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <Flag size={10} /> {university.priority}
                </span>
              )}
              {(user?.role === 'admin' || user?.role === 'zonal_manager' || user?.role === 'apm') && (
                <button onClick={() => setIsEditModalOpen(true)} className="button button-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}>
                  Edit Info
                </button>
              )}
              <button
                onClick={() => exportChecklistCSV(university)}
                className="button button-secondary"
                style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                title="Export checklist to CSV"
              >
                <Download size={13} /> Export CSV
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', marginTop: '0.625rem' }}>
              {university.location && university.location !== 'TBD' && (
                <span className="text-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
                  <MapPin size={14} /> {university.location}
                </span>
              )}
              {university.targetDate && (
                <span className="text-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
                  <Calendar size={14} /> Target: <b style={{ color: 'var(--text-primary)' }}>{formatDate(university.targetDate)}</b>
                </span>
              )}
              {university.infraReadyMonth && (() => {
                const [yr, mo] = university.infraReadyMonth.split('-');
                const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                const label = `${months[parseInt(mo,10)-1]} ${yr}`;
                const nowYM = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
                const isDelayed = university.infraReadyMonth < nowYM && (university.overallReadiness || 0) < 100;
                return (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem',
                    background: isDelayed ? 'rgba(239,68,68,0.1)' : 'rgba(99,102,241,0.1)',
                    color: isDelayed ? '#ef4444' : '#6366f1',
                    padding: '0.2rem 0.65rem', borderRadius: '6px', fontWeight: 700 }}>
                    <Calendar size={14} /> Infra Ready: <b>{isDelayed ? '🚨 ' : '📅 '}{label}</b>
                  </span>
                );
              })()}
              {university.classCommencementDate && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem',
                  background: 'rgba(16,185,129,0.1)', color: '#10b981',
                  padding: '0.2rem 0.65rem', borderRadius: '6px', fontWeight: 700 }}>
                  <Calendar size={14} /> Commencement: <b>{formatDate(university.classCommencementDate)}</b>
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <span className="font-bold" style={{ fontSize: '2rem', lineHeight: 1, color: university.overallReadiness >= 75 ? '#10b981' : university.overallReadiness >= 40 ? '#f59e0b' : '#ef4444' }}>
                  {university.overallReadiness || 0}%
                </span>
                <span style={{
                  fontSize: '0.65rem', fontWeight: 700, padding: '0.25rem 0.6rem', borderRadius: '999px',
                  background: university.overallReadiness >= 75 ? 'rgba(16,185,129,0.15)' : university.overallReadiness >= 40 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                  color: university.overallReadiness >= 75 ? '#10b981' : university.overallReadiness >= 40 ? '#f59e0b' : '#ef4444',
                }}>
                  {university.overallReadiness >= 75 ? '✓ On Track' : university.overallReadiness >= 40 ? '● In Progress' : '! Needs Attention'}
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
                    navigate(-1);
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
            onClick={() => selectTab(tab.id)}
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
              <h3 className="chart-title mb-4" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <LayoutDashboard size={18} /> Space Readiness
              </h3>
              {detailLoading ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  {[1, 2, 3, 4].map(i => <div key={i} className="pulse" style={{ height: '88px', background: 'var(--bg-primary)', borderRadius: '12px' }} />)}
                </div>
              ) : Object.entries(university.spaceMetrics || {}).length === 0 ? (
                <p className="text-secondary text-center" style={{ padding: '2rem 0' }}>Load a checklist tab to see readiness data.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  {Object.entries(university.spaceMetrics || {}).map(([space, value]) => {
                    const tabMap = { 'Model Classroom': 'overall', '5.0 Lab': 'lab5', 'Staff Room': 'staff', 'All Classrooms': 'overall' };
                    const color = value >= 75 ? '#10b981' : value >= 40 ? '#f59e0b' : '#ef4444';
                    const label = value >= 75 ? '✓ On Track' : value >= 40 ? '● In Progress' : '! Needs Attention';
                    return (
                       <button
                         key={space}
                         onClick={() => selectTab(tabMap[space], space === 'Model Classroom' ? MODEL_CLASSROOM_ID : undefined)}
                        style={{
                          padding: '0.875rem 0.75rem', borderRadius: '12px', textAlign: 'center',
                          background: 'var(--bg-primary)', border: `1px solid ${color}30`,
                          cursor: 'pointer', transition: 'border-color 0.15s',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = color}
                        onMouseLeave={e => e.currentTarget.style.borderColor = `${color}30`}
                      >
                        <span style={{ fontSize: '1.6rem', fontWeight: 900, color, lineHeight: 1 }}>{value}%</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-primary)' }}>{space}</span>
                        <span style={{ fontSize: '0.58rem', fontWeight: 700, padding: '0.12rem 0.45rem', borderRadius: '999px', background: `${color}18`, color }}>
                          {label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Campus Details */}
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <h3 className="chart-title mb-4" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Building2 size={18} /> Campus Details
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {[
                  { label: 'APM Assigned', value: university.apmName || '—' },
                  university.priority ? { label: 'Priority', value: university.priority, highlight: PRIORITY_COLORS[university.priority] } : null,
                  { label: 'Start Date', value: formatDate(university.startDate) },
                  { label: 'Target Date', value: formatDate(university.targetDate) },
                  { label: 'Internal Timeline', value: formatDate(university.internalTimeline) },
                  university.modelClassroomTimeline ? { label: 'Model Classroom Timeline', value: formatDate(university.modelClassroomTimeline) } : null,
                  university.lab5Timeline ? { label: '5.0 Lab Timeline', value: formatDate(university.lab5Timeline) } : null,
                  university.staffRoomTimeline ? { label: 'Staff Room Timeline', value: formatDate(university.staffRoomTimeline) } : null,
                  university.allClassroomsTimeline ? { label: 'All Classrooms Timeline', value: formatDate(university.allClassroomsTimeline) } : null,
                  { label: 'No. of Classrooms', value: university.numClassrooms ?? '—' },
                  { label: 'Classroom Capacity', value: university.classroomCapacity ? `${university.classroomCapacity} seats` : '—' },
                  { label: 'Min. No. of Students', value: university.studentsCount ? university.studentsCount.toLocaleString() : '—' },
                  { label: 'Max. No. of Students', value: university.maxStudentsCount ? university.maxStudentsCount.toLocaleString() : '—' },
                  { label: 'Classroom Allocation', value: university.classroomAllocationDone ? '✅ Done' : '❌ Pending' },
                  university.allocationPendingRemarks && !university.classroomAllocationDone
                    ? { label: 'Pending Remarks', value: university.allocationPendingRemarks, dim: true }
                    : null,
                  university.effortsRequired ? { label: 'Efforts Required', value: university.effortsRequired } : null,
                  university.probabilityStatus ? { label: 'Probability Status', value: university.probabilityStatus } : null,
                  university.confidencePercentage != null ? { label: 'APM Confidence', value: `${university.confidencePercentage}%` } : null,
                ].filter(Boolean).map((r, i, arr) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.5rem', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span className="text-secondary" style={{ fontSize: '0.82rem' }}>{r.label}</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: r.highlight || (r.dim ? 'var(--text-secondary)' : 'var(--text-primary)'), fontStyle: r.dim ? 'italic' : 'normal', textAlign: 'right', maxWidth: '55%' }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <p className="text-secondary" style={{ marginBottom: '0.875rem', fontSize: '0.85rem' }}>Quick navigation to checklists:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.625rem' }}>
              <button
                onClick={() => selectTab('overall', MODEL_CLASSROOM_ID)}
                className="button button-secondary"
                style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <Component size={14} /> Model Classroom
              </button>
              {CHECKLIST_TABS.map(t => {
                const tab = tabs.find(tb => tb.id === t);
                return (
                  <button key={t} onClick={() => selectTab(t)} className="button button-secondary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {tab.icon} {tab.label}
                  </button>
                );
              })}
              <button onClick={() => selectTab('updates')} className="button button-secondary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <ClipboardList size={14} /> Updates & Actions
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Updates & Actions Tab ─────────────────────────────── */}
      {activeTab === 'updates' && (
        <div className="fade-in" style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="glass-panel" style={{ flex: '1 1 480px', padding: '1.5rem', minWidth: 0 }}>
            <UniversityUpdates universityId={university.id} />
          </div>
          <div className="glass-panel" style={{ flex: '1 1 380px', padding: '1.5rem', minWidth: 0 }}>
            <ActionItems universityId={university.id} />
          </div>
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
              {activeTab === 'lab5' && (
                <Lab5Form universityId={university.id} data={university.trackers.lab5} onSave={(d) => handleUpdate('lab5', d)} target={checklistTarget} onTargetRevealed={onTargetRevealed} />
              )}
              {activeTab === 'staff' && (
                <StaffRoomForm universityId={university.id} data={university.trackers.staffRoom} onSave={(d) => handleUpdate('staffRoom', d)} target={checklistTarget} onTargetRevealed={onTargetRevealed} />
              )}
              {activeTab === 'overall' && (
                <OverallClassroomForm
                  universityId={university.id}
                  data={university.trackers.overallClassroom}
                  modelClassroom={university.trackers.modelClassroom}
                  modelReadiness={university.spaceMetrics?.['Model Classroom']}
                  onSave={(d) => handleUpdate('overallClassroom', d)}
                  onModelSave={(d) => handleUpdate('modelClassroom', d)}
                  initialClassroomId={overallClassroomSelection}
                  target={checklistTarget}
                  onTargetRevealed={onTargetRevealed}
                />
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
