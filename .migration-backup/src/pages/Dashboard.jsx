import React, { useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { 
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { 
  Building2, TrendingUp, ShieldAlert, Clock, 
  MapPin, Calendar, ArrowRight, AlertTriangle 
} from 'lucide-react';
import { Link } from 'react-router-dom';

const STATUS_COLORS = {
  'Done': '#10b981',
  'Not Done': '#ef4444',
  'Given': '#3b82f6',
  'Not Given': '#94a3b8'
};

export default function Dashboard() {
  const { universities } = useData();
  const { user } = useAuth();
  
  const visibleUnis = useMemo(() => {
    return (universities || []).filter(u => {
      if (!u) return false;

      // Visibility Filtering: Handle Admin, Zonal Manager, and APM
      if (user?.role === 'admin') {
        return true;
      } else if (user?.role === 'zonal_manager') {
        const userZoneSet = new Set(
          [
            ...(Array.isArray(user?.zoneIds) ? user.zoneIds : []),
            ...(user?.zoneId != null ? [user.zoneId] : [])
          ].map(id => Number(id)).filter(n => !isNaN(n))
        );
        const uniZone = u.zone_id != null ? Number(u.zone_id) : null;
        
        // If user has no zones, show everything (safe fallback)
        if (userZoneSet.size === 0) return true;
        
        // Show if matches user zone OR if university has no zone assigned (yet)
        return (uniZone != null && userZoneSet.has(uniZone)) || (uniZone == null);

      } else if (user?.role === 'apm') {
        const mappedIds = new Set(
          (Array.isArray(user?.universityIds) ? user.universityIds : []).map(id => String(id))
        );
        const idMatch = mappedIds.has(String(u.id));
        const nameMatch =
          u.apm_name && user?.name &&
          u.apm_name.toLowerCase().trim() === user.name.toLowerCase().trim();
        return idMatch || nameMatch;
      }
      return true;
    });
  }, [universities, user]);

  const stats = useMemo(() => {
    const total = visibleUnis.length;
    let allocationDone = 0;
    let timelineGiven = 0;
    let totalBlockers = 0;
    let readinessSum = 0;
    
    const delayedUnis = [];

    visibleUnis.forEach(uni => {
      if (uni.classroomAllocationDone) allocationDone++;
      
      // Timeline check: if targetDate exists and isn't TBD
      const hasTimeline = uni.targetDate && uni.targetDate !== 'TBD' && uni.targetDate !== '';
      if (hasTimeline) timelineGiven++;
      
      readinessSum += (uni.overallReadiness || 0);

      // Blocker calculation
      const trackers = uni.trackers || {};
      const allItems = [
        ...(trackers.modelClassroom?.items || []),
        ...(trackers.lab5?.items || []),
        ...(trackers.staffRoom?.items || []),
        ...(trackers.overallClassroom?.items || [])
      ];
      const blockerCount = allItems.filter(i => i.status === 'Blocker').length;
      totalBlockers += blockerCount;

      // Real delay calculation: if targetDate is passed and readiness < 100
      if (hasTimeline && uni.overallReadiness < 100) {
        const target = new Date(uni.targetDate);
        const today = new Date();
        if (target < today) {
          const diffDays = Math.ceil((today - target) / (1000 * 60 * 60 * 24));
          delayedUnis.push({ name: uni.name, delay: diffDays, target: uni.targetDate, id: uni.id });
        }
      }
    });

    const top5Delayed = [...delayedUnis].sort((a, b) => b.delay - a.delay).slice(0, 5);

    return {
      total,
      avgReadiness: total > 0 ? Math.round(readinessSum / total) : 0,
      allocationData: [
        { name: 'Done', value: allocationDone },
        { name: 'Not Done', value: total - allocationDone }
      ],
      timelineData: [
        { name: 'Given', value: timelineGiven },
        { name: 'Not Given', value: total - timelineGiven }
      ],
      totalBlockers,
      top5Delayed,
      timelinesPending: total - timelineGiven
    };
  }, [visibleUnis]);

  return (
    <div className="app-container fade-in pb-20" style={{ maxWidth: '1400px' }}>
      {/* ── Page Header ────────────────────────────────────────────── */}
      <div className="page-header mb-8">
        <div className="page-header-column">
          <h1 className="page-title text-gradient" style={{ fontSize: '2.2rem', fontWeight: 900 }}>Executive Overview</h1>
          <p className="page-subtitle" style={{ fontSize: '1rem', opacity: 0.8 }}>Strategic insights across {stats.total} active university deployments.</p>
        </div>
      </div>

      {/* ── Top Level Summary Tiles ────────────────────────────────── */}
      <div className="dashboard-stats-grid mb-8" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
        <div className="glass-panel stat-card-premium" style={{ background: 'white', padding: '1.5rem', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Portfolio Readiness</p>
              <h2 style={{ margin: '0.5rem 0 0', fontSize: '2rem', fontWeight: 900, color: 'var(--text-primary)' }}>{stats.avgReadiness}%</h2>
            </div>
            <div style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', padding: '0.75rem', borderRadius: '12px' }}><TrendingUp size={24} /></div>
          </div>
        </div>

        <div className="glass-panel stat-card-premium" style={{ background: 'white', padding: '1.5rem', borderLeft: '4px solid #ef4444' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active Blockers</p>
              <h2 style={{ margin: '0.5rem 0 0', fontSize: '2rem', fontWeight: 900, color: '#ef4444' }}>{stats.totalBlockers}</h2>
            </div>
            <div style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', padding: '0.75rem', borderRadius: '12px' }}><ShieldAlert size={24} /></div>
          </div>
        </div>

        <div className="glass-panel stat-card-premium" style={{ background: 'white', padding: '1.5rem', borderLeft: '4px solid #f59e0b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timelines Pending</p>
              <h2 style={{ margin: '0.5rem 0 0', fontSize: '2rem', fontWeight: 900, color: '#f59e0b' }}>{stats.timelinesPending}</h2>
            </div>
            <div style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', padding: '0.75rem', borderRadius: '12px' }}><Clock size={24} /></div>
          </div>
        </div>

        <div className="glass-panel stat-card-premium" style={{ background: 'white', padding: '1.5rem', borderLeft: '4px solid #10b981' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Campuses</p>
              <h2 style={{ margin: '0.5rem 0 0', fontSize: '2rem', fontWeight: 900, color: 'var(--text-primary)' }}>{stats.total}</h2>
            </div>
            <div style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', padding: '0.75rem', borderRadius: '12px' }}><Building2 size={24} /></div>
          </div>
        </div>
      </div>

      {/* ── Main Analytics Section ─────────────────────────────────── */}
      <div className="dashboard-charts-grid mb-8" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem' }}>
        
        {/* Classroom Allocation */}
        <div className="glass-panel chart-card" style={{ background: 'white', padding: '1.75rem' }}>
          <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MapPin size={18} className="text-accent-primary" /> Classroom Allocation Done?
          </h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={stats.allocationData} 
                  innerRadius={70} 
                  outerRadius={100} 
                  paddingAngle={8} 
                  dataKey="value"
                  stroke="none"
                >
                  {stats.allocationData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.name]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ background: 'white', border: '1px solid var(--border)', borderRadius: '12px', fontWeight: 700 }}
                />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Timeline Commitment */}
        <div className="glass-panel chart-card" style={{ background: 'white', padding: '1.75rem' }}>
          <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Calendar size={18} className="text-accent-primary" /> Timeline Given?
          </h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={stats.timelineData} 
                  innerRadius={70} 
                  outerRadius={100} 
                  paddingAngle={8} 
                  dataKey="value"
                  stroke="none"
                >
                  {stats.timelineData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.name]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ background: 'white', border: '1px solid var(--border)', borderRadius: '12px', fontWeight: 700 }}
                />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Delay Audit Section ────────────────────────────────────── */}
      <div className="glass-panel" style={{ background: 'white', padding: '2rem', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertTriangle className="text-danger" /> Top 5 Delayed Universities
          </h3>
          <Link to="/master-tracker" className="button button-secondary" style={{ fontSize: '0.85rem' }}>Full Portfolio Tracker &rarr;</Link>
        </div>

        <div className="table-responsive">
          <table className="data-table" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 0.5rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th style={{ padding: '1rem', borderTopLeftRadius: '8px', borderBottomLeftRadius: '8px' }}>University Name</th>
                <th style={{ padding: '1rem' }}>Delay Severity</th>
                <th style={{ padding: '1rem' }}>Target Date</th>
                <th style={{ padding: '1rem', borderTopRightRadius: '8px', borderBottomRightRadius: '8px' }}>Drill Down</th>
              </tr>
            </thead>
            <tbody>
              {stats.top5Delayed.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    All campuses are currently on track or ahead of schedule.
                  </td>
                </tr>
              ) : (
                stats.top5Delayed.map((uni, idx) => (
                  <tr key={idx} className="table-row-hover" style={{ background: 'var(--bg-primary)', transition: 'all 0.2s ease' }}>
                    <td style={{ padding: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>{uni.name}</td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ flex: 1, height: '8px', background: 'var(--bg-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(uni.delay * 4, 100)}%`, height: '100%', background: '#ef4444' }} />
                        </div>
                        <span style={{ fontWeight: 900, color: '#ef4444', minWidth: '80px' }}>{uni.delay} Days</span>
                      </div>
                    </td>
                    <td style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{uni.target}</td>
                    <td style={{ padding: '1rem' }}>
                      <Link to={`/university/${uni.id}`} className="button button-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        Investigate <ArrowRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        .stat-card-premium {
          transition: transform 0.3s ease, box-shadow 0.3s ease;
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        .stat-card-premium:hover {
          transform: translateY(-5px);
          box-shadow: 0 12px 24px rgba(0,0,0,0.1);
        }
        .table-row-hover:hover {
          background: #f8fafc !important;
          transform: scale(1.002);
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
      `}</style>
    </div>
  );
}
