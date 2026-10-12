import React, { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useAuth, ZONES } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { LayoutGrid, AlertCircle, CheckCircle2, Filter, Search, X } from 'lucide-react';

const ZONE_OPTIONS = Object.entries(ZONES).map(([id, z]) => ({ id: Number(id), name: z.name }));

export default function MasterTracker() {
  const { universities, loading } = useData();
  const { user } = useAuth();

  const [search, setSearch] = useState('');
  const [filterZone, setFilterZone] = useState('');
  const [filterAllocation, setFilterAllocation] = useState('');
  const [filterApm, setFilterApm] = useState('');
  const [filterReadiness, setFilterReadiness] = useState('');

  const getReadiness = (items) => {
    if (!items?.length) return 0;
    return Math.round((items.filter(i => i?.status === 'Done').length / items.length) * 100);
  };

  const getBlockers = (items) => (items || []).filter(i => i?.status === 'Blocker').length;

  const cellColor = (r) => {
    if (r >= 90) return { bg: 'rgba(16,185,129,0.15)', color: '#10b981', border: 'rgba(16,185,129,0.3)' };
    if (r >= 50) return { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: 'rgba(245,158,11,0.3)' };
    return { bg: 'rgba(239,68,68,0.15)', color: '#ef4444', border: 'rgba(239,68,68,0.3)' };
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

  // All unique APM names from the list
  const apmNames = useMemo(() => [...new Set(universities.map(u => u.apmName).filter(Boolean))], [universities]);

  const filtered = useMemo(() => {
    return universities.filter(u => {
      if (!u) return false;

      // Visibility Filtering: Handle Admin, Zonal Manager, and APM
      if (user?.role === 'admin') {
        // Admin sees all
      } else if (user?.role === 'zonal_manager') {
        const userZoneSet = new Set(
          [
            ...(Array.isArray(user?.zoneIds) ? user.zoneIds : []),
            ...(user?.zoneId != null ? [user.zoneId] : [])
          ].map(id => Number(id)).filter(n => !isNaN(n))
        );
        const uniZone = u.zone_id != null ? Number(u.zone_id) : null;
        
        // Show if matches user zone OR if university has no zone assigned (yet)
        const isVisible = (uniZone != null && userZoneSet.has(uniZone)) || (uniZone == null) || (userZoneSet.size === 0);
        
        if (!isVisible) return false;

      } else if (user?.role === 'apm') {
        const mappedIds = new Set(
          (Array.isArray(user?.universityIds) ? user.universityIds : []).map(id => String(id))
        );
        const idMatch = mappedIds.has(String(u.id));
        const nameMatch =
          u.apm_name && user?.name &&
          u.apm_name.toLowerCase().trim() === user.name.toLowerCase().trim();
        if (!idMatch && !nameMatch) return false;
      }

      // Existing UI Filters
      if (search && !u.name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterZone && String(u.zone_id) !== String(filterZone)) return false;
      if (filterAllocation && String(u.classroomAllocationDone) !== String(filterAllocation)) return false;
      if (filterApm && u.apmName !== filterApm) return false;
      if (filterReadiness) {
        const r = u.overallReadiness || 0;
        if (filterReadiness === '0-25' && r > 25) return false;
        if (filterReadiness === '25-50' && (r <= 25 || r > 50)) return false;
        if (filterReadiness === '50-75' && (r <= 50 || r > 75)) return false;
        if (filterReadiness === '75-100' && r <= 75) return false;
      }
      return true;
    });
  }, [universities, search, filterZone, filterAllocation, filterApm, filterReadiness, user]);

  const clearFilters = () => { setSearch(''); setFilterZone(''); setFilterAllocation(''); setFilterApm(''); setFilterReadiness(''); };
  const hasFilters = search || filterZone || filterAllocation || filterApm || filterReadiness;

  return (
    <div className="app-container fade-in" style={{ paddingBottom: '3rem', maxWidth: '1600px' }}>
      <div className="page-header" style={{ marginBottom: '1.5rem' }}>
        <div className="page-header-column">
          <h1 className="page-title text-gradient" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '2.1rem' }}>
            <LayoutGrid size={28} /> Portfolio Master Tracker
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-secondary)' }}>
            Executive Overview · {filtered.length} Universities Active
          </p>
        </div>
      </div>

      {/* ── High-Contrast Filter Bar ─────────────────────────────────────────────── */}
      <div className="glass-panel" style={{ 
        display: 'flex', 
        flexWrap: 'wrap', 
        gap: '0.75rem', 
        marginBottom: '1.5rem',
        padding: '1rem',
        background: 'rgba(255, 255, 255, 0.7)',
        backdropFilter: 'blur(10px)',
        border: '1px solid var(--border)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: '1 1 240px', background: 'var(--bg-primary)', borderRadius: '8px', padding: '0.5rem 0.875rem', border: '1px solid var(--border)' }}>
          <Search size={14} className="text-secondary" />
          <input type="text" placeholder="Search institution..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.875rem', width: '100%' }} />
        </div>

        <select className="form-select" style={{ flex: '1 1 150px', padding: '0.5rem', fontSize: '0.85rem' }}
          value={filterZone} onChange={e => setFilterZone(e.target.value)}>
          <option value="">All Zones</option>
          {ZONE_OPTIONS.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>

        {apmNames.length > 0 && (
          <select className="form-select" style={{ flex: '1 1 150px', padding: '0.5rem', fontSize: '0.85rem' }}
            value={filterApm} onChange={e => setFilterApm(e.target.value)}>
            <option value="">All APMs</option>
            {apmNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}

        <select className="form-select" style={{ flex: '1 1 150px', padding: '0.5rem', fontSize: '0.85rem' }}
          value={filterAllocation} onChange={e => setFilterAllocation(e.target.value)}>
          <option value="">Allocation Status</option>
          <option value="true">✅ Allocation Done</option>
          <option value="false">❌ Pending</option>
        </select>

        <select className="form-select" style={{ flex: '1 1 150px', padding: '0.5rem', fontSize: '0.85rem' }}
          value={filterReadiness} onChange={e => setFilterReadiness(e.target.value)}>
          <option value="">Readiness Filter</option>
          <option value="0-25">Critical (0-25%)</option>
          <option value="25-50">Behind (25-50%)</option>
          <option value="50-75">On Track (50-75%)</option>
          <option value="75-100">Near Completion (75-100%)</option>
        </select>

        {hasFilters && (
          <button onClick={clearFilters} className="button button-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
            <X size={14} /> Clear All
          </button>
        )}
      </div>

      {/* ── High-Visibility Table ──────────────────────────────────────────────────── */}
      <div className="glass-panel" style={{ overflow: 'hidden', padding: 0, border: '1px solid var(--border)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: '1350px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border)' }}>
                <th style={{ position: 'sticky', left: 0, background: 'var(--bg-secondary)', zIndex: 10, width: '250px', color: 'var(--text-primary)', fontWeight: 800 }}>University</th>
                <th style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Zone / APM</th>
                <th className="text-center" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Overall</th>
                <th className="text-center" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Model Classroom</th>
                <th className="text-center" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Overall Classroom</th>
                <th className="text-center" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>5.0 Lab</th>
                <th className="text-center" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Staff Room</th>
                <th className="text-center" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Blockers</th>
                <th style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Timelines</th>
                <th className="text-center" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Allocation</th>
                <th className="text-center" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Rooms</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [1, 2, 3, 4, 5].map(i => (
                  <tr key={i}>
                    <td colSpan={11} style={{ padding: '2rem' }}>
                      <div className="pulse" style={{ height: '20px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', width: '100%' }} />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>No institutions found matching filters.</td></tr>
              ) : (
                filtered.map(uni => {
                  const t = uni.trackers || {};
                  const modelR   = getReadiness(t.modelClassroom?.items);
                  const overallR = (uni.spaceMetrics && uni.spaceMetrics['Overall Classroom']) || 0;
                  const labR     = getReadiness(t.lab5?.items);
                  const staffR   = getReadiness(t.staffRoom?.items);
                  const blockers = getBlockers(t.modelClassroom?.items) + getBlockers(t.lab5?.items) + getBlockers(t.staffRoom?.items) + getBlockers(t.overallClassroom?.items);
                  
                  const riskColor = uni.riskStatus === 'RED' ? '#ef4444' : uni.riskStatus === 'YELLOW' ? '#f59e0b' : '#10b981';
                  const zoneName = ZONES[uni.zone_id]?.name?.split('—')[1]?.trim() || '—';

                  return (
                    <tr key={uni.id} className="table-row-hover" style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ position: 'sticky', left: 0, background: 'white', zIndex: 10, borderRight: '1px solid var(--border)', padding: '1.25rem 1rem' }}>
                        <Link to={`/university/${uni.id}`} style={{ textDecoration: 'none', color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.95rem', display: 'block' }}>
                          {uni.name}
                        </Link>
                      </td>
                      <td>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', margin: 0, fontWeight: 600 }}>{zoneName}</p>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>{uni.apmName || '—'}</p>
                      </td>
                      <td className="text-center">
                         <div style={{ 
                           display: 'inline-flex', 
                           padding: '0.4rem 0.6rem',
                           borderRadius: '8px',
                           background: cellColor(uni.overallReadiness).bg,
                           color: cellColor(uni.overallReadiness).color,
                           fontWeight: 900,
                           fontSize: '0.85rem',
                           border: `1px solid ${cellColor(uni.overallReadiness).border}`
                         }}>
                           {uni.overallReadiness || 0}%
                         </div>
                      </td>
                      {[modelR, overallR, labR, staffR].map((r, idx) => {
                        const s = cellColor(r);
                        return (
                          <td key={idx} className="text-center">
                            <div style={{ 
                              padding: '0.4rem 0.5rem',
                              borderRadius: '6px',
                              background: s.bg,
                              color: s.color,
                              border: `1px solid ${s.border}`,
                              fontSize: '0.82rem',
                              fontWeight: 800
                            }}>
                              {r}%
                            </div>
                          </td>
                        );
                      })}
                      <td className="text-center">
                        {blockers > 0 ? (
                          <Link 
                            to={`/university/${uni.id}?tab=checklists&focus=blockers`} 
                            style={{ 
                              color: '#ef4444', 
                              background: 'rgba(239,68,68,0.1)', 
                              padding: '0.35rem 0.6rem', 
                              borderRadius: '6px', 
                              textDecoration: 'none', 
                              fontWeight: 800, 
                              fontSize: '0.85rem', 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: '0.25rem',
                              border: '1px solid rgba(239,68,68,0.2)'
                            }}
                          >
                            <AlertCircle size={14} /> {blockers}
                          </Link>
                        ) : (
                          <CheckCircle2 size={18} style={{ color: '#10b981', opacity: 0.6 }} />
                        )}
                      </td>
                      <td>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>Target: <b style={{ color: 'var(--text-primary)' }}>{formatDate(uni.targetDate)}</b></p>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0 }}>Start: {formatDate(uni.startDate)}</p>
                      </td>
                      <td className="text-center">
                        <span style={{ fontSize: '1.1rem' }}>{uni.classroomAllocationDone ? '✅' : '❌'}</span>
                      </td>
                      <td className="text-center">
                         <span style={{ fontSize: '0.9rem', fontWeight: 800 }}>{uni.numClassrooms || '—'}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
