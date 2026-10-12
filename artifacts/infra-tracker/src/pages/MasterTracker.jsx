import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useData } from '../context/DataContext';
import { useAuth, ZONES } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import {
  LayoutGrid, AlertCircle, CheckCircle2, Search, X, Zap,
  ChevronDown, Calendar, Building2, TrendingUp, RefreshCw,
  Download, MoreVertical, Clock,
} from 'lucide-react';
import { formatDate, isOverdue, daysOverdue } from '../utils/dateUtils';

// ── Static data ───────────────────────────────────────────────────────────────
const ZONE_OPTIONS = Object.entries(ZONES).map(([id, z]) => ({ id: Number(id), name: z.name }));

const EFFORT_META = {
  HIGH:   { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444', label: 'HIGH'   },
  MEDIUM: { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', label: 'MEDIUM' },
  LOW:    { bg: 'rgba(16,185,129,0.12)', color: '#10b981', label: 'LOW'    },
};


const CATEGORIES = [
  { key: 'modelClassroom',   smKey: 'Model Classroom', tlKey: 'modelClassroomTimeline',  label: 'Model Classroom' },
  { key: 'lab5',             smKey: '5.0 Lab',         tlKey: 'lab5Timeline',            label: '5.0 Lab'        },
  { key: 'staffRoom',        smKey: 'Staff Room',      tlKey: 'staffRoomTimeline',       label: 'Staff Room'     },
  { key: 'overallClassroom', smKey: 'All Classrooms',  tlKey: 'allClassroomsTimeline',   label: 'All Classrooms' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function getReadiness(items) {
  if (!items?.length) return 0;
  return Math.round((items.filter(i => i?.status === 'Done' || i?.status === 'N/A').length / items.length) * 100);
}
function getBlockers(items) {
  return (items || []).filter(i => i?.status === 'Blocker').length;
}
function pctColor(r) {
  if (r >= 90) return { bg: 'rgba(16,185,129,0.12)', color: '#10b981', border: 'rgba(16,185,129,0.25)' };
  if (r >= 50) return { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: 'rgba(245,158,11,0.25)' };
  return        { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444', border: 'rgba(239,68,68,0.25)'  };
}

// ── Persist filters ───────────────────────────────────────────────────────────
const SS_KEY = 'mt_filters_v5';
function loadFilters() {
  try { return JSON.parse(sessionStorage.getItem(SS_KEY) || '{}'); } catch { return {}; }
}
function saveFilters(f) {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(f)); } catch {}
}

function formatInfraMonth(ym) {
  if (!ym) return null;
  const [year, month] = ym.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(month, 10) - 1]} ${year}`;
}

function currentYYYYMM() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

export async function runMasterTrackerRefresh(refreshUniversities, setRefreshing) {
  setRefreshing(true);
  try {
    await refreshUniversities();
  } finally {
    setRefreshing(false);
  }
}

function addMonths(ym, count) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + count, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Multi-Select Dropdown ─────────────────────────────────────────────────────
function MultiDropdown({ label, values, onChange, options, valueKey = 'id', labelKey = 'name', width = '140px' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = values.length > 0;

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const toggle = (val) => {
    if (values.includes(val)) onChange(values.filter(v => v !== val));
    else onChange([...values, val]);
  };

  const displayLabel = active
    ? values.length === 1
      ? (options.find(o => String(o[valueKey]) === values[0])?.[labelKey] || values[0])
      : `${values.length} selected`
    : `All (${options.length})`;

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', width, flexShrink: 0, position: 'relative' }}>
      <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <button onClick={() => setOpen(v => !v)} style={{
        appearance: 'none', padding: '0.42rem 1.6rem 0.42rem 0.65rem',
        borderRadius: '7px', border: `1px solid ${active ? 'rgba(59,130,246,0.45)' : 'var(--border)'}`,
        background: active ? 'rgba(59,130,246,0.07)' : 'var(--bg-card)',
        color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
        fontSize: '0.78rem', fontWeight: active ? 600 : 400, cursor: 'pointer', outline: 'none',
        textAlign: 'left', position: 'relative', whiteSpace: 'nowrap', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {displayLabel}
        <ChevronDown size={11} style={{ position: 'absolute', right: '0.4rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 300, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: '200px', overflow: 'hidden', marginTop: '2px' }}>
          <div style={{ padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => onChange(options.map(o => String(o[valueKey])))}
              style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem 0.3rem' }}>
              Select All
            </button>
            <span style={{ color: 'var(--border)' }}>|</span>
            <button onClick={() => onChange([])}
              style={{ fontSize: '0.7rem', fontWeight: 600, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem 0.3rem' }}>
              Clear
            </button>
          </div>
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {options.map(o => {
              const val = String(o[valueKey]);
              const checked = values.includes(val);
              return (
                <label key={val} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.75rem', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-primary)', background: checked ? 'rgba(59,130,246,0.06)' : 'transparent' }}
                  onMouseEnter={e => { if (!checked) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = checked ? 'rgba(59,130,246,0.06)' : 'transparent'; }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(val)}
                    style={{ accentColor: 'var(--accent-primary)', width: '13px', height: '13px', flexShrink: 0 }} />
                  {o[labelKey]}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ icon, value, label, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.8rem 1.1rem', flex: '1 1 120px', minWidth: '120px' }}>
      <div style={{ color, opacity: 0.85, flexShrink: 0 }}>{icon}</div>
      <div>
        <p style={{ margin: 0, fontSize: '1.35rem', fontWeight: 900, color, lineHeight: 1 }}>{value}</p>
        <p style={{ margin: '0.2rem 0 0', fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</p>
      </div>
    </div>
  );
}

// ── Percent Cell ──────────────────────────────────────────────────────────────
function PctCell({ r }) {
  const s = pctColor(r);
  return (
    <div style={{ display: 'inline-flex', padding: '0.2rem 0.5rem', borderRadius: '6px', background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontWeight: 800, fontSize: '0.78rem', minWidth: '38px', justifyContent: 'center' }}>
      {r}%
    </div>
  );
}

// ── Remarks Cell ──────────────────────────────────────────────────────────────
function RemarksCell({ text, isAlloc, timestamp }) {
  const [exp, setExp] = useState(false);
  if (!text) return <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', opacity: 0.45 }}>—</span>;
  const MAX = 80;
  const long = text.length > MAX;
  const timeStr = timestamp
    ? new Date(timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
    : null;
  return (
    <div>
      <p style={{ margin: 0, fontSize: '0.73rem', color: isAlloc ? '#f59e0b' : 'var(--text-primary)', lineHeight: 1.45, fontStyle: isAlloc ? 'italic' : 'normal', wordBreak: 'break-word' }}>
        {long && !exp ? `${text.slice(0, MAX)}…` : text}
      </p>
      {long && (
        <button onClick={() => setExp(v => !v)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-primary)', fontSize: '0.65rem', fontWeight: 600, marginTop: '0.2rem' }}>
          {exp ? '▲ less' : '▼ more'}
        </button>
      )}
      {timeStr && !isAlloc && (
        <p style={{ margin: '0.2rem 0 0', fontSize: '0.62rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          <Clock size={9} /> {timeStr}
        </p>
      )}
    </div>
  );
}

// ── Row Actions Menu ──────────────────────────────────────────────────────────
function RowMenu({ uni }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(v => !v)} style={{ background: 'none', border: 'none', padding: '0.2rem', cursor: 'pointer', color: 'var(--text-secondary)', borderRadius: '4px', display: 'flex' }}>
        <MoreVertical size={14} />
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 200, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,0.12)', minWidth: '160px', overflow: 'hidden' }}>
          {[
            { label: 'View Details', to: `/university/${uni.id}` },
            { label: 'Checklists',   to: `/university/${uni.id}?tab=checklists` },
            { label: 'Daily Updates',to: `/university/${uni.id}?tab=updates` },
            { label: 'Evidence',     to: `/university/${uni.id}?tab=evidence` },
          ].map(item => (
            <Link key={item.label} to={item.to} onClick={() => setOpen(false)} style={{ display: 'block', padding: '0.55rem 0.9rem', fontSize: '0.78rem', color: 'var(--text-primary)', textDecoration: 'none' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MasterTracker() {
  const { universities, loading, refreshUniversities } = useData();
  const { user } = useAuth();
  const saved = useMemo(loadFilters, []);

  const isApm = user?.role === 'apm';
  const apmUniversities = useMemo(() => {
    if (!isApm) return universities;
    const mapped = user?.universityIds || [];
    return universities.filter(u => mapped.includes(u.id));
  }, [universities, isApm, user?.universityIds]);

  const [search, setSearch]                     = useState(saved.search || '');
  const [filterZone, setFilterZone]             = useState(saved.filterZone || []);
  const [filterApm, setFilterApm]               = useState(saved.filterApm || []);
  const [filterEffort, setFilterEffort]         = useState(saved.filterEffort || []);
  const [filterAllocation, setFilterAllocation] = useState(saved.filterAllocation || []);
  const [filterTimeline, setFilterTimeline]         = useState(saved.filterTimeline || []);
  const [filterInfraMonth, setFilterInfraMonth]     = useState(saved.filterInfraMonth || []);
  const [refreshing, setRefreshing]                 = useState(false);

  useEffect(() => {
    saveFilters({ search, filterZone, filterApm, filterEffort, filterAllocation, filterTimeline, filterInfraMonth });
  }, [search, filterZone, filterApm, filterEffort, filterAllocation, filterTimeline, filterInfraMonth]);

  const apmOptions = useMemo(() =>
    [...new Set(apmUniversities.map(u => u.apmName).filter(Boolean))].map(n => ({ id: n, name: n })),
    [apmUniversities]
  );

  const thisMonth = useMemo(() => currentYYYYMM(), []);

  // Build infra month filter options from actual data values
  const infraMonthOptions = useMemo(() => {
    const used = new Set(apmUniversities.map(u => u.infraReadyMonth).filter(Boolean));
    // Also add next 6 months from today so users can filter even before data is set
    for (let i = 0; i <= 6; i++) used.add(addMonths(thisMonth, i));
    const sorted = [...used].sort();
    const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const opts = sorted.map(ym => {
      const [y, m] = ym.split('-');
      const label = `${MONS[parseInt(m, 10) - 1]} ${y}`;
      const isDelayed = ym < thisMonth;
      const isCurrent = ym === thisMonth;
      return { id: ym, name: `${isDelayed ? '🚨' : isCurrent ? '✅' : '📅'} ${label}` };
    });
    opts.push({ id: 'not_set', name: '⬜ Not Set' });
    return opts;
  }, [apmUniversities, thisMonth]);

  const filtered = useMemo(() =>
    apmUniversities.filter(u => {
      if (!u) return false;
      if (search && !u.name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterZone.length > 0 && !filterZone.includes(String(u.zone_id))) return false;
      if (filterApm.length > 0 && !filterApm.includes(u.apmName)) return false;
      if (filterEffort.length > 0 && !filterEffort.includes(u.effortsRequired?.toUpperCase())) return false;
      if (filterAllocation.length > 0 && !filterAllocation.includes(String(u.classroomAllocationDone))) return false;
      if (filterTimeline.includes('with') && filterTimeline.includes('without')) { /* show all */ }
      else if (filterTimeline.includes('with') && !u.targetDate && !u.internalTimeline) return false;
      else if (filterTimeline.includes('without') && (u.targetDate || u.internalTimeline)) return false;
      if (filterInfraMonth.length > 0) {
        const irm = u.infraReadyMonth;
        const specificMonths = filterInfraMonth.filter(v => v !== 'not_set');
        const wantsNotSet = filterInfraMonth.includes('not_set');
        const matchesSpecific = specificMonths.includes(irm);
        const matchesNotSet = wantsNotSet && !irm;
        if (!matchesSpecific && !matchesNotSet) return false;
      }
      return true;
    }),
    [apmUniversities, search, filterZone, filterApm, filterEffort, filterAllocation, filterTimeline, filterInfraMonth, thisMonth]
  );

  const clearFilters = () => {
    setSearch(''); setFilterZone([]); setFilterApm([]);
    setFilterEffort([]); setFilterAllocation([]); setFilterTimeline([]);
    setFilterInfraMonth([]);
  };
  const hasFilters = search || filterZone.length || filterApm.length || filterEffort.length || filterAllocation.length || filterTimeline.length || filterInfraMonth.length;

  // Stats
  const stats = useMemo(() => {
    const total = filtered.length;
    const high   = filtered.filter(u => u.effortsRequired?.toUpperCase() === 'HIGH').length;
    const medium = filtered.filter(u => u.effortsRequired?.toUpperCase() === 'MEDIUM').length;
    const low    = filtered.filter(u => u.effortsRequired?.toUpperCase() === 'LOW').length;
    const tlSet  = filtered.filter(u => u.targetDate || u.internalTimeline).length;
    const avg    = total ? Math.round(filtered.reduce((s, u) => s + (u.overallReadiness || 0), 0) / total) : 0;
    return { total, high, medium, low, tlSet, avg };
  }, [filtered]);

  const handleRefresh = async () => {
    await runMasterTrackerRefresh(refreshUniversities, setRefreshing);
  };

  // Export CSV
  const handleExport = () => {
    const headers = ['University', 'Effort', 'Overall %', 'Infra Ready Month', 'Allocation', 'No. of Classrooms', 'Min Students', 'Max Students', 'Model Class % / TL', 'Lab 5.0 % / TL', 'Staff Room % / TL', 'All Classrooms % / TL', 'Commencement Date', 'Target Date', 'Internal TL', 'Latest Remarks'];
    const rows = filtered.map(u => {
      const t = u.trackers || {};
      const sm = u.spaceMetrics || {};
      const cats = CATEGORIES.map(cat => {
        const r = cat.key === 'overallClassroom'
          ? (sm[cat.smKey] ?? getReadiness(t[cat.key]?.classrooms?.flatMap(c => c.items || [])))
          : (sm[cat.smKey] ?? getReadiness(t[cat.key]?.items));
        const tl = u[cat.tlKey] ? formatDate(u[cat.tlKey]) : '';
        return tl ? `${r}% / ${tl}` : `${r}%`;
      });
      return [u.name, u.effortsRequired || '', u.overallReadiness || 0, formatInfraMonth(u.infraReadyMonth) || '', u.classroomAllocationDone ? 'Yes' : 'No', u.numClassrooms ?? '', u.studentsCount ?? '', u.maxStudentsCount ?? '', ...cats, formatDate(u.classCommencementDate), formatDate(u.targetDate), formatDate(u.internalTimeline), u.latestUpdate || ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = 'master-tracker.csv'; a.click();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // TH style helpers
  const thBase = { padding: '0.6rem 0.75rem', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em' };
  const catTh  = (color) => ({ ...thBase, background: color, borderBottom: 'none', textAlign: 'center', color: 'white', fontSize: '0.68rem' });
  const subTh  = { ...thBase, textAlign: 'center', background: 'var(--bg-secondary)', fontSize: '0.65rem' };

  // Category colors for group headers
  const catColors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981'];

  return (
    <div className="app-container fade-in" style={{ paddingBottom: '3rem' }}>

      {/* ── Page Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 className="page-title text-gradient" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '1.75rem', margin: 0 }}>
            <LayoutGrid size={24} /> Master Tracker
          </h1>
          <p className="page-subtitle" style={{ margin: '0.2rem 0 0' }}>Overview of infrastructure readiness across all universities</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.9rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
            <Download size={13} /> Export
          </button>
          <button onClick={handleRefresh} disabled={refreshing} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.9rem', borderRadius: '8px', border: '1px solid var(--accent-primary)', background: 'var(--accent-primary)', color: 'white', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, opacity: refreshing ? 0.7 : 1 }}>
            <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.9rem 1.1rem', marginBottom: '1.1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '0.85rem' }}>
          {/* Search */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: '1 1 180px' }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Search</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', background: 'var(--bg-secondary)', borderRadius: '7px', padding: '0.42rem 0.7rem', border: '1px solid var(--border)' }}>
              <Search size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              <input type="text" placeholder="University name…" value={search} onChange={e => setSearch(e.target.value)}
                style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.78rem', width: '100%' }} />
              {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', color: 'var(--text-secondary)' }}><X size={11} /></button>}
            </div>
          </div>

          <MultiDropdown label="Zone"
            values={filterZone} onChange={setFilterZone}
            options={ZONE_OPTIONS.map(z => ({ id: String(z.id), name: ZONES[z.id]?.name?.split('—')[1]?.trim() || z.name }))}
          />
          <MultiDropdown label="APM" values={filterApm} onChange={setFilterApm} options={apmOptions} />
          <MultiDropdown label="Effort" values={filterEffort} onChange={setFilterEffort}
            options={[{ id: 'HIGH', name: 'High' }, { id: 'MEDIUM', name: 'Medium' }, { id: 'LOW', name: 'Low' }]} />
          <MultiDropdown label="Allocation" values={filterAllocation} onChange={setFilterAllocation}
            options={[{ id: 'true', name: '✅ Done' }, { id: 'false', name: '❌ Pending' }]} />
          <MultiDropdown label="Timeline" values={filterTimeline} onChange={setFilterTimeline}
            options={[{ id: 'with', name: '📅 Has Timeline' }, { id: 'without', name: '⚠️ Not Set' }]} />
          <MultiDropdown label="Infra Month" values={filterInfraMonth} onChange={setFilterInfraMonth}
            options={infraMonthOptions} />

          {hasFilters && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'transparent' }}>X</span>
              <button onClick={clearFilters} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.42rem 0.75rem', borderRadius: '7px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                <X size={11} /> Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Stats Row ── */}
      {!loading && (
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.1rem', flexWrap: 'wrap' }}>
          <StatCard icon={<Building2 size={20} />} value={stats.total}  label="Total Universities" color="var(--accent-primary)" />
          <StatCard icon={<Zap size={20} />}       value={stats.high}   label="High Effort"         color="#ef4444" />
          <StatCard icon={<Zap size={20} />}       value={stats.medium} label="Medium Effort"       color="#f59e0b" />
          <StatCard icon={<Zap size={20} />}       value={stats.low}    label="Low Effort"          color="#10b981" />
          <StatCard icon={<Calendar size={20} />}  value={stats.tlSet}  label="Timelines Set"       color="#8b5cf6" />
          <StatCard icon={<TrendingUp size={20} />} value={`${stats.avg}%`} label="Average Overall"  color={pctColor(stats.avg).color} />
        </div>
      )}

      {/* ── Table ── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'clip' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: '1200px', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 20 }}>
              <tr>
                <th style={{ ...thBase, position: 'sticky', left: 0, zIndex: 30, background: 'var(--sticky-bg)', borderRight: '2px solid var(--border)', textAlign: 'left', minWidth: '200px', padding: '0.7rem 1rem' }}>
                  University
                </th>
                <th style={{ ...thBase, minWidth: '80px', textAlign: 'left' }}>Effort</th>
                <th style={{ ...thBase, textAlign: 'center', minWidth: '68px' }}>Overall %</th>
                <th style={{ ...thBase, minWidth: '100px', textAlign: 'center', color: '#6366f1' }}>Infra Month</th>
                <th style={{ ...thBase, textAlign: 'center', minWidth: '68px' }}>Alloc</th>
                <th style={{ ...thBase, textAlign: 'center', minWidth: '80px' }}>Class / Stu</th>
                {CATEGORIES.map((cat, i) => (
                  <th key={cat.key} style={{ ...catTh(catColors[i]), minWidth: '110px' }}>{cat.label}</th>
                ))}
                <th style={{ ...thBase, minWidth: '100px', textAlign: 'center', color: '#10b981' }}>Commencement</th>
                <th style={{ ...thBase, minWidth: '90px', textAlign: 'center' }}>Target</th>
                <th style={{ ...thBase, minWidth: '180px', textAlign: 'left' }}>
                  Latest Remarks <span style={{ fontWeight: 400, opacity: 0.7 }}>(Latest Update)</span>
                </th>
                <th style={{ ...thBase, textAlign: 'center', minWidth: '70px' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [1, 2, 3, 4, 5, 6].map(i => (
                  <tr key={i}>
                    <td colSpan={13} style={{ padding: '1rem' }}>
                      <div className="pulse" style={{ height: '18px', background: 'var(--bg-secondary)', borderRadius: '4px' }} />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={13} style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
                    No universities match your filters.{' '}
                    {hasFilters && <button onClick={clearFilters} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>Clear filters</button>}
                  </td>
                </tr>
              ) : (
                filtered.map((uni, rowIdx) => {
                  const t = uni.trackers || {};
                  const sm = uni.spaceMetrics || {};

                  const cats = CATEGORIES.map(cat => {
                    const r = cat.key === 'overallClassroom'
                      ? (sm[cat.smKey] ?? getReadiness(t[cat.key]?.classrooms?.flatMap(c => c.items || [])))
                      : (sm[cat.smKey] ?? getReadiness(t[cat.key]?.items));
                    return { r, tl: uni[cat.tlKey] };
                  });

                  const totalBlockers = CATEGORIES.reduce((acc, cat) => {
                    if (cat.key === 'overallClassroom') return acc + getBlockers(t[cat.key]?.classrooms?.flatMap(c => c.items || []));
                    return acc + getBlockers(t[cat.key]?.items);
                  }, 0);

                  const overdue = isOverdue(uni.targetDate, uni.overallReadiness);
                  const overdayCount = overdue ? daysOverdue(uni.targetDate) : 0;
                  const zoneName = ZONES[uni.zone_id]?.name?.split('—')[1]?.trim() || '—';
                  const effortMeta = EFFORT_META[uni.effortsRequired?.toUpperCase()];
                  const overallC = pctColor(uni.overallReadiness || 0);
                  const rowBg = rowIdx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)';
                  // Sticky cell MUST use a fully opaque colour — see --sticky-bg / --sticky-overdue-bg
                  // CSS vars which are set per theme (light = #fff, dark = #1e293b).
                  const stickyBg = overdue ? 'var(--sticky-overdue-bg)' : 'var(--sticky-bg)';

                  const remarkText = uni.latestUpdate
                    || (!uni.classroomAllocationDone && uni.allocationPendingRemarks ? uni.allocationPendingRemarks : null);
                  const remarkIsAlloc = !uni.latestUpdate && !uni.classroomAllocationDone && uni.allocationPendingRemarks;

                  const tdBase = { padding: '0.65rem 0.75rem', borderBottom: '1px solid var(--border)', background: rowBg, verticalAlign: 'middle' };
                  const catTdStyle = (i) => ({ ...tdBase, textAlign: 'center', borderLeft: i === 0 ? '2px solid var(--border)' : '1px dashed rgba(128,128,128,0.2)' });

                  return (
                    <tr key={uni.id} style={{ transition: 'background 0.1s' }}
                      onMouseEnter={e => {
                        Array.from(e.currentTarget.cells).forEach((c, i) => {
                          c.style.background = i === 0 ? 'var(--sticky-hover-bg)' : 'rgba(59,130,246,0.04)';
                        });
                      }}
                      onMouseLeave={e => {
                        Array.from(e.currentTarget.cells).forEach((c, i) => {
                          c.style.background = i === 0 ? stickyBg : rowBg;
                        });
                      }}>

                      {/* University */}
                      <td style={{ ...tdBase, position: 'sticky', left: 0, zIndex: 25, borderRight: '2px solid var(--border)', background: stickyBg, padding: '0.65rem 1rem' }}>
                        <Link to={`/university/${uni.id}`} style={{ textDecoration: 'none', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.83rem', display: 'block', lineHeight: 1.3 }}>
                          {uni.name}
                        </Link>
                        {zoneName && (
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{zoneName}</span>
                        )}
                        {overdue && (
                          <span style={{ display: 'block', fontSize: '0.62rem', color: '#ef4444', fontWeight: 700, marginTop: '0.15rem' }}>
                            ⚠ {overdayCount}d overdue
                          </span>
                        )}
                      </td>

                      {/* Effort */}
                      <td style={{ ...tdBase }}>
                        {effortMeta ? (
                          <span style={{ background: effortMeta.bg, color: effortMeta.color, padding: '0.22rem 0.55rem', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                            <Zap size={10} /> {effortMeta.label}
                          </span>
                        ) : <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>—</span>}
                      </td>

                      {/* Overall % */}
                      <td style={{ ...tdBase, textAlign: 'center' }}>
                        <PctCell r={uni.overallReadiness || 0} />
                      </td>

                      {/* Infra Ready Month */}
                      <td style={{ ...tdBase, textAlign: 'center' }}>
                        {uni.infraReadyMonth ? (() => {
                          const irm = uni.infraReadyMonth;
                          const isDelayed = irm < thisMonth && (uni.overallReadiness || 0) < 100;
                          const isThisMonth = irm === thisMonth;
                          const color = isDelayed ? '#ef4444' : isThisMonth ? '#10b981' : '#6366f1';
                          const bg = isDelayed ? 'rgba(239,68,68,0.1)' : isThisMonth ? 'rgba(16,185,129,0.1)' : 'rgba(99,102,241,0.1)';
                          return (
                            <span style={{ background: bg, color, padding: '0.2rem 0.45rem', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700, display: 'inline-block', whiteSpace: 'nowrap' }}>
                              {isDelayed ? '🚨 ' : isThisMonth ? '✅ ' : '📅 '}{formatInfraMonth(irm)}
                            </span>
                          );
                        })() : (
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', opacity: 0.4 }}>—</span>
                        )}
                      </td>

                      {/* Allocation */}
                      <td style={{ ...tdBase, textAlign: 'center' }}>
                        <span style={{ fontSize: '1rem' }} title={uni.classroomAllocationDone ? 'Done' : 'Pending'}>
                          {uni.classroomAllocationDone ? '✅' : '❌'}
                        </span>
                      </td>

                      {/* Classrooms / Students (combined) */}
                      <td style={{ ...tdBase, textAlign: 'center' }}>
                        {uni.numClassrooms != null || uni.studentsCount != null ? (
                          <div style={{ lineHeight: 1.35 }}>
                            <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                              {uni.numClassrooms != null ? uni.numClassrooms : '—'}
                              <span style={{ fontSize: '0.6rem', fontWeight: 500, color: 'var(--text-secondary)', marginLeft: '2px' }}>cls</span>
                            </div>
                            <div style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {uni.studentsCount != null || uni.maxStudentsCount != null ? (
                                <>
                                  {uni.studentsCount != null ? uni.studentsCount : '—'}
                                  {uni.maxStudentsCount != null && (
                                    <span style={{ opacity: 0.6 }}>–{uni.maxStudentsCount}</span>
                                  )}
                                  <span style={{ fontSize: '0.6rem', fontWeight: 500, marginLeft: '2px' }}>stu</span>
                                </>
                              ) : (
                                <>—<span style={{ fontSize: '0.6rem', fontWeight: 500, marginLeft: '2px' }}>stu</span></>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', opacity: 0.4 }}>—</span>
                        )}
                      </td>

                      {/* Category cells: % stacked over Timeline */}
                      {cats.map(({ r, tl }, i) => (
                        <td key={i} style={{ ...catTdStyle(i), textAlign: 'center' }}>
                          <PctCell r={r} />
                          {tl ? (
                            <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginTop: '0.18rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.15rem', whiteSpace: 'nowrap' }}>
                              <Calendar size={8} /> {formatDate(tl)}
                            </div>
                          ) : null}
                        </td>
                      ))}

                      {/* Class Commencement Date */}
                      <td style={{ ...tdBase, textAlign: 'center' }}>
                        {uni.classCommencementDate ? (
                          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#10b981', whiteSpace: 'nowrap' }}>
                            {formatDate(uni.classCommencementDate)}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', opacity: 0.4 }}>—</span>
                        )}
                      </td>

                      {/* Target */}
                      <td style={{ ...tdBase, textAlign: 'center' }}>
                        {uni.targetDate ? (
                          <div>
                            <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 700, color: overdue ? '#ef4444' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                              {formatDate(uni.targetDate)}
                            </p>
                            {uni.internalTimeline && (
                              <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--text-secondary)' }}>
                                Int: {formatDate(uni.internalTimeline)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', opacity: 0.4 }}>—</span>
                        )}
                      </td>

                      {/* Latest Remarks */}
                      <td style={{ ...tdBase, maxWidth: '220px' }}>
                        <RemarksCell text={remarkText} isAlloc={remarkIsAlloc} timestamp={uni.latestUpdateTime} />
                      </td>

                      {/* Action Items */}
                      <td style={{ ...tdBase, textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                          {totalBlockers > 0 ? (
                            <Link to={`/university/${uni.id}?tab=checklists&focus=blockers`}
                              style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', borderRadius: '99px', width: '24px', height: '24px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', fontWeight: 900, fontSize: '0.72rem', border: '1px solid rgba(239,68,68,0.2)' }}
                              title={`${totalBlockers} blocker${totalBlockers !== 1 ? 's' : ''}`}>
                              {totalBlockers}
                            </Link>
                          ) : (
                            <CheckCircle2 size={16} style={{ color: '#10b981', opacity: 0.6 }} />
                          )}
                          <RowMenu uni={uni} />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {/* Footer */}
        {!loading && filtered.length > 0 && (
          <div style={{ padding: '0.65rem 1rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-secondary)' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              Showing <strong>{filtered.length}</strong> of <strong>{apmUniversities.length}</strong> universities{isApm && ' (your assigned)'}
            </span>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Clock size={11} /> Last loaded: {new Date().toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
