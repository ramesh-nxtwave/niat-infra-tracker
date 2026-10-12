import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import {
  Building2, TrendingUp, ShieldAlert,
  ArrowRight, AlertTriangle, Zap, Bell,
  Mail, Send, RefreshCw, CheckCircle2, XCircle, Clock, Calendar
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDate, isOverdue, isUpcoming, daysOverdue, daysUntil } from '../utils/dateUtils';

const STATUS_COLORS = {
  'Done': '#10b981',
  'Not Done': '#ef4444',
  'Given': '#3b82f6',
  'Not Given': '#94a3b8'
};

const EFFORT_COLORS = {
  HIGH: '#ef4444',
  MEDIUM: '#f59e0b',
  LOW: '#10b981',
};

export default function Dashboard() {
  const { universities } = useData();
  const { user, authFetch } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Backend already filters by RBAC — use universities directly
  const stats = useMemo(() => {
    const total = universities.length;
    let allocationDone = 0;
    let timelineGiven = 0;
    let totalBlockers = 0;
    let readinessSum = 0;

    const overdueList = [];
    const upcomingList = [];
    const effortCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 };

    universities.forEach(uni => {
      if (uni.classroomAllocationDone) allocationDone++;

      const hasTimeline = uni.targetDate && uni.targetDate !== 'TBD' && uni.targetDate !== '';
      if (hasTimeline) timelineGiven++;

      readinessSum += (uni.overallReadiness || 0);

      const trackers = uni.trackers || {};
      const allItems = [
        ...(trackers.modelClassroom?.items || []),
        ...(trackers.lab5?.items || []),
        ...(trackers.staffRoom?.items || []),
        ...(trackers.overallClassroom?.classrooms?.flatMap(c => c.items || []) || [])
      ];
      totalBlockers += allItems.filter(i => i.status === 'Blocker').length;

      const effort = uni.effortsRequired?.toUpperCase();
      if (effort === 'HIGH') effortCounts.HIGH++;
      else if (effort === 'MEDIUM') effortCounts.MEDIUM++;
      else if (effort === 'LOW') effortCounts.LOW++;

      if (hasTimeline) {
        if (isOverdue(uni.targetDate, uni.overallReadiness)) {
          overdueList.push({
            id: uni.id, name: uni.name,
            delay: daysOverdue(uni.targetDate),
            target: uni.targetDate,
            readiness: uni.overallReadiness || 0
          });
        } else if (isUpcoming(uni.targetDate, uni.reminderDays ?? 5)) {
          overdueList; // already tracked above
          upcomingList.push({
            id: uni.id, name: uni.name,
            daysLeft: daysUntil(uni.targetDate),
            target: uni.targetDate,
            readiness: uni.overallReadiness || 0,
            effortsRequired: uni.effortsRequired
          });
        }
      }
    });

    const top5Delayed = [...overdueList].sort((a, b) => b.delay - a.delay).slice(0, 5);

    const nowDate = new Date();
    const thisMonth = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;
    const nextMonthDate = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 1);
    const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const in3MonthsDate = new Date(nowDate.getFullYear(), nowDate.getMonth() + 3, 1);
    const in3Months = `${in3MonthsDate.getFullYear()}-${String(in3MonthsDate.getMonth() + 1).padStart(2, '0')}`;

    const formatIRM = (ym) => {
      if (!ym) return '';
      const [y, m] = ym.split('-');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(m,10)-1]} ${y}`;
    };

    const infraThisMonth = universities.filter(u => u.infraReadyMonth === thisMonth);
    const infraNextMonth = universities.filter(u => u.infraReadyMonth === nextMonth);
    const infraNext3 = universities.filter(u => u.infraReadyMonth && u.infraReadyMonth > thisMonth && u.infraReadyMonth <= in3Months);
    const infraDelayed = universities.filter(u => u.infraReadyMonth && u.infraReadyMonth < thisMonth && (u.overallReadiness || 0) < 100);

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
      overdueCount: overdueList.length,
      upcomingList: upcomingList.slice(0, 5),
      effortCounts,
      timelinesPending: total - timelineGiven,
      infraThisMonth, infraNextMonth, infraNext3, infraDelayed, formatIRM,
      thisMonthLabel: formatIRM(thisMonth), nextMonthLabel: formatIRM(nextMonth),
    };
  }, [universities]);

  return (
    <div className="app-container fade-in pb-20" style={{ maxWidth: '1400px' }}>
      {/* Header */}
      <div className="page-header mb-8">
        <div className="page-header-column">
          <h1 className="page-title text-gradient" style={{ fontSize: '2.2rem', fontWeight: 900 }}>Executive Overview</h1>
          <p className="page-subtitle" style={{ fontSize: '1rem', opacity: 0.8 }}>
            Strategic insights across {stats.total} active university deployments.
          </p>
        </div>
      </div>

      {/* Top Summary Tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <StatCard label="Portfolio Readiness" value={`${stats.avgReadiness}%`} icon={<TrendingUp size={24} />} color="#3b82f6" />
        <StatCard label="Active Blockers" value={stats.totalBlockers} icon={<ShieldAlert size={24} />} color="#ef4444" />
        <StatCard label="Overdue Campuses" value={stats.overdueCount} icon={<AlertTriangle size={24} />} color="#dc2626" />
        <StatCard label="Upcoming Deadlines" value={stats.upcomingList.length} icon={<Bell size={24} />} color="#f59e0b" />
        <StatCard label="Total Campuses" value={stats.total} icon={<Building2 size={24} />} color="#10b981" />
      </div>

      {/* ── Infra Ready Month Widgets ── */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#6366f1', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <Calendar size={16} /> Infra Ready Month
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          {/* This Month */}
          <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid rgba(16,185,129,0.25)', background: 'rgba(16,185,129,0.04)', borderRadius: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
              <span style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', padding: '0.5rem', borderRadius: '8px', display: 'flex' }}><Calendar size={16} /></span>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ready This Month</span>
            </div>
            <h3 style={{ margin: 0, fontSize: '2rem', fontWeight: 900, color: '#10b981', lineHeight: 1 }}>{stats.infraThisMonth.length}</h3>
            <p style={{ margin: '0.3rem 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{stats.thisMonthLabel}</p>
            {stats.infraThisMonth.length > 0 && (
              <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {stats.infraThisMonth.slice(0, 3).map(u => (
                  <Link key={u.id} to={`/university/${u.id}`} style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    → {u.name}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Next Month */}
          <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.04)', borderRadius: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
              <span style={{ background: 'rgba(99,102,241,0.15)', color: '#6366f1', padding: '0.5rem', borderRadius: '8px', display: 'flex' }}><Calendar size={16} /></span>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ready Next Month</span>
            </div>
            <h3 style={{ margin: 0, fontSize: '2rem', fontWeight: 900, color: '#6366f1', lineHeight: 1 }}>{stats.infraNextMonth.length}</h3>
            <p style={{ margin: '0.3rem 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{stats.nextMonthLabel}</p>
            {stats.infraNextMonth.length > 0 && (
              <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {stats.infraNextMonth.slice(0, 3).map(u => (
                  <Link key={u.id} to={`/university/${u.id}`} style={{ fontSize: '0.72rem', color: '#6366f1', fontWeight: 600, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    → {u.name}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming 3 months */}
          <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid rgba(59,130,246,0.25)', background: 'rgba(59,130,246,0.04)', borderRadius: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
              <span style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6', padding: '0.5rem', borderRadius: '8px', display: 'flex' }}><Calendar size={16} /></span>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Next 3 Months</span>
            </div>
            <h3 style={{ margin: 0, fontSize: '2rem', fontWeight: 900, color: '#3b82f6', lineHeight: 1 }}>{stats.infraNext3.length}</h3>
            <p style={{ margin: '0.3rem 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Upcoming readiness window</p>
            {stats.infraNext3.length > 0 && (
              <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {stats.infraNext3.slice(0, 3).map(u => (
                  <Link key={u.id} to={`/university/${u.id}`} style={{ fontSize: '0.72rem', color: '#3b82f6', fontWeight: 600, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    → {u.name} ({stats.formatIRM(u.infraReadyMonth)})
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Delayed */}
          <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.04)', borderRadius: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
              <span style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '0.5rem', borderRadius: '8px', display: 'flex' }}><AlertTriangle size={16} /></span>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Infra Delayed</span>
            </div>
            <h3 style={{ margin: 0, fontSize: '2rem', fontWeight: 900, color: '#ef4444', lineHeight: 1 }}>{stats.infraDelayed.length}</h3>
            <p style={{ margin: '0.3rem 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Past target, not 100%</p>
            {stats.infraDelayed.length > 0 && (
              <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {stats.infraDelayed.slice(0, 3).map(u => (
                  <Link key={u.id} to={`/university/${u.id}`} style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 600, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    🚨 {u.name} ({stats.formatIRM(u.infraReadyMonth)})
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Effort Level Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {Object.entries(stats.effortCounts).map(([level, count]) => (
          <div key={level} className="glass-panel" style={{ background: 'white', padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', border: `1px solid ${EFFORT_COLORS[level]}22` }}>
            <div style={{ background: `${EFFORT_COLORS[level]}15`, color: EFFORT_COLORS[level], padding: '0.75rem', borderRadius: '10px' }}>
              <Zap size={20} />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{level} Effort</p>
              <h3 style={{ margin: '0.25rem 0 0', fontSize: '1.5rem', fontWeight: 900, color: EFFORT_COLORS[level] }}>{count}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
        <ChartCard title="Classroom Allocation Done?" data={stats.allocationData} />
        <ChartCard title="Timeline Given?" data={stats.timelineData} />
      </div>

      {/* Upcoming Deadlines */}
      {stats.upcomingList.length > 0 && (
        <div className="glass-panel" style={{ background: 'white', padding: '2rem', border: '1px solid rgba(245,158,11,0.2)', marginBottom: '2rem' }}>
          <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 900, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Bell style={{ color: '#f59e0b' }} size={20} /> Upcoming Deadlines
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {stats.upcomingList.map(uni => (
              <div key={uni.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1rem', background: 'rgba(245,158,11,0.04)', borderRadius: '10px', border: '1px solid rgba(245,158,11,0.12)' }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: '0.95rem' }}>{uni.name}</p>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Target: {formatDate(uni.target)} · {uni.readiness}% ready
                    {uni.effortsRequired && <span style={{ marginLeft: '0.5rem', color: EFFORT_COLORS[uni.effortsRequired?.toUpperCase()] }}>· {uni.effortsRequired} effort</span>}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', padding: '0.3rem 0.75rem', borderRadius: '999px', fontWeight: 800, fontSize: '0.8rem' }}>
                    {uni.daysLeft === 0 ? 'Today!' : `${uni.daysLeft}d left`}
                  </span>
                  <Link to={`/university/${uni.id}`} style={{ color: 'var(--accent-primary)', fontWeight: 700, fontSize: '0.8rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    View <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overdue / Delay Audit */}
      <div className="glass-panel" style={{ background: 'white', padding: '2rem', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertTriangle className="text-danger" /> Top Delayed Universities
          </h3>
          <Link to="/master-tracker" className="button button-secondary" style={{ fontSize: '0.85rem' }}>
            Full Portfolio Tracker &rarr;
          </Link>
        </div>

        <div className="table-responsive">
          <table className="data-table" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 0.5rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th style={{ padding: '1rem' }}>University Name</th>
                <th style={{ padding: '1rem' }}>Delay Severity</th>
                <th style={{ padding: '1rem' }}>Target Date</th>
                <th style={{ padding: '1rem' }}>Readiness</th>
                <th style={{ padding: '1rem' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {stats.top5Delayed.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    All campuses are currently on track or ahead of schedule.
                  </td>
                </tr>
              ) : (
                stats.top5Delayed.map((uni, idx) => (
                  <tr key={idx} className="table-row-hover" style={{ background: 'var(--bg-primary)' }}>
                    <td style={{ padding: '1rem', fontWeight: 800 }}>{uni.name}</td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ flex: 1, height: '8px', background: 'var(--bg-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(uni.delay * 4, 100)}%`, height: '100%', background: '#ef4444' }} />
                        </div>
                        <span style={{ fontWeight: 900, color: '#ef4444', minWidth: '70px' }}>{uni.delay} days</span>
                      </div>
                    </td>
                    <td style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{formatDate(uni.target)}</td>
                    <td style={{ padding: '1rem' }}>
                      <span style={{ fontWeight: 800, color: uni.readiness >= 75 ? '#10b981' : uni.readiness >= 50 ? '#f59e0b' : '#ef4444' }}>
                        {uni.readiness}%
                      </span>
                    </td>
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

      {/* AI Reports Panel — admin only */}
      {isAdmin && <ReportPanel authFetch={authFetch} />}

      <style>{`
        .stat-card-premium { transition: transform 0.3s ease, box-shadow 0.3s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .stat-card-premium:hover { transform: translateY(-5px); box-shadow: 0 12px 24px rgba(0,0,0,0.1); }
        .table-row-hover:hover { background: #f8fafc !important; }
      `}</style>
    </div>
  );
}

function ReportPanel({ authFetch }) {
  const [status, setStatus] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await authFetch('/reports/status');
      setStatus(data);
    } catch {
      // ignore
    }
  }, [authFetch]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  return (
    <div className="glass-panel" style={{ background: 'var(--bg-primary)', padding: '2rem', border: '1px solid rgba(37,99,235,0.2)', marginTop: '2rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ background: 'rgba(37,99,235,0.12)', color: '#2563eb', padding: '0.75rem', borderRadius: '12px' }}>
            <Mail size={20} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900 }}>AI Automated Reports</h3>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Auto-generated email report sent to varshith, karthik @nxtwave.tech & riteesh.reddy@nxtwave.co.in every 3 days
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button onClick={fetchStatus} className="button button-secondary" style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <RefreshCw size={13} /> Refresh
          </button>
          <Link
            to="/reports"
            className="button button-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
          >
            <Send size={15} />
            Review Pending Report
          </Link>
        </div>
      </div>

      {/* Scheduler info strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.875rem' }}>
        <div style={{ background: 'rgba(37,99,235,0.06)', borderRadius: '10px', padding: '0.875rem 1rem', border: '1px solid rgba(37,99,235,0.1)' }}>
          <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.25rem' }}>Schedule</p>
          <p style={{ margin: 0, fontWeight: 700, fontSize: '0.85rem' }}>{status?.schedule ?? 'Every 3 days at 08:00 IST'}</p>
        </div>
        <div style={{ background: 'rgba(16,185,129,0.06)', borderRadius: '10px', padding: '0.875rem 1rem', border: '1px solid rgba(16,185,129,0.1)' }}>
          <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.25rem' }}>Last Sent</p>
          <p style={{ margin: 0, fontWeight: 700, fontSize: '0.85rem' }}>
            {status?.lastRunAt ? new Date(status.lastRunAt).toLocaleString('en-IN') : 'Never (pending first run)'}
          </p>
        </div>
        <div style={{ background: status?.isRunning ? 'rgba(245,158,11,0.08)' : 'rgba(100,116,139,0.06)', borderRadius: '10px', padding: '0.875rem 1rem', border: `1px solid ${status?.isRunning ? 'rgba(245,158,11,0.2)' : 'rgba(100,116,139,0.1)'}` }}>
          <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.25rem' }}>Status</p>
          <p style={{ margin: 0, fontWeight: 700, fontSize: '0.85rem', color: status?.isRunning ? '#f59e0b' : '#10b981', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {status?.isRunning ? <><RefreshCw size={13} /> Generating…</> : <><CheckCircle2 size={13} /> Ready</>}
          </p>
        </div>
        <div style={{ background: 'rgba(139,92,246,0.06)', borderRadius: '10px', padding: '0.875rem 1rem', border: '1px solid rgba(139,92,246,0.1)' }}>
          <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.25rem' }}>Recipients</p>
          <p style={{ margin: 0, fontWeight: 700, fontSize: '0.72rem', lineHeight: 1.4 }}>varshith, karthik @nxtwave.tech<br/>riteesh.reddy @nxtwave.co.in</p>
        </div>
      </div>

      {/* What's included */}
      <div style={{ marginTop: '1.25rem', padding: '0.875rem 1.25rem', borderRadius: '10px', background: 'rgba(100,116,139,0.05)', border: '1px solid var(--border)' }}>
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Report Includes</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {['AI Key Observations', 'Allocation Status', 'Space Readiness %', 'Timeline Summary', 'Critical Delays', 'Low Readiness Alerts', 'Zone-wise Breakdown', 'Pending Action Items'].map(tag => (
            <span key={tag} style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: '999px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>{tag}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color }) {
  return (
    <div className="glass-panel stat-card-premium" style={{ background: 'white', padding: '1.5rem', borderLeft: `4px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
          <h2 style={{ margin: '0.5rem 0 0', fontSize: '1.9rem', fontWeight: 900, color: 'var(--text-primary)' }}>{value}</h2>
        </div>
        <div style={{ background: `${color}18`, color, padding: '0.75rem', borderRadius: '12px' }}>{icon}</div>
      </div>
    </div>
  );
}

function ChartCard({ title, data }) {
  return (
    <div className="glass-panel" style={{ background: 'white', padding: '1.75rem' }}>
      <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 800 }}>{title}</h3>
      <div style={{ height: '260px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} innerRadius={65} outerRadius={95} paddingAngle={8} dataKey="value" stroke="none">
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.name]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ background: 'white', border: '1px solid var(--border)', borderRadius: '12px', fontWeight: 700 }} />
            <Legend verticalAlign="bottom" height={36} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
