import React from 'react';
import { useData } from '../context/DataContext';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { Building2, Activity, ShieldAlert, Clock, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const COLORS = {
  GREEN: '#10b981',
  AMBER: '#f59e0b',
  RED: '#ef4444'
};

export default function CommandCenter() {
  const { dashboardStats, loading } = useData();

  if (loading) return <div className="loading-container">Scanning Portfolio...</div>;

  const riskData = Object.keys(dashboardStats.riskSplit).map(key => ({
    name: key,
    value: dashboardStats.riskSplit[key]
  }));

  const performanceData = dashboardStats.ranking.slice(0, 10).map(u => ({
    name: u.name,
    readiness: u.overallReadiness
  }));

  return (
    <div className="app-container fade-in pb-20">
      <div className="page-header mb-8">
        <div>
          <h1 className="page-title text-gradient">Founder Command Center</h1>
          <p className="page-subtitle">Portfolio-wide strategic overview.</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="dashboard-stats-grid mb-8">
        <div className="glass-panel stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}><Building2 size={24} /></div>
          <div>
            <p className="form-label mb-0">Total Universities</p>
            <p className="page-title">{dashboardStats.totalUnis}</p>
          </div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}><Activity size={24} /></div>
          <div>
            <p className="form-label mb-0">Avg Readiness %</p>
            <p className="page-title">{dashboardStats.avgReadiness}%</p>
          </div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}><Clock size={24} /></div>
          <div>
            <p className="form-label mb-0">Delayed Portfolio</p>
            <p className="page-title text-danger">{dashboardStats.delayedCount}</p>
          </div>
        </div>
      </div>

      <div className="dashboard-charts-grid mb-8">
        {/* Risk Distribution */}
        <div className="glass-panel chart-card">
          <h2 className="chart-title">Portfolio Risk Split</h2>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={riskData} innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                  {riskData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[entry.name] || '#94a3b8'} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)' }} itemStyle={{color: 'var(--text-primary)'}} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Performers */}
        <div className="glass-panel chart-card">
          <h2 className="chart-title">Top 10 Performing Universities</h2>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={performanceData} layout="vertical">
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis dataKey="name" type="category" width={100} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} itemStyle={{color: 'var(--text-primary)'}} />
                <Bar dataKey="readiness" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Critical Action Items Table */}
      <div className="glass-panel table-container">
        <h2 className="chart-title mb-4">Urgent: Delayed Universities</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>University</th>
              <th>Target Date</th>
              <th>Readiness</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {dashboardStats.delayedUnis.map(uni => (
              <tr key={uni.id} className="table-row-hover">
                <td className="font-semibold">{uni.name}</td>
                <td>{uni.targetDate}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{uni.overallReadiness}%</span>
                    <div className="progress-container w-24"><div className="progress-bar" style={{ width: `${uni.overallReadiness}%`, background: COLORS.RED }}></div></div>
                  </div>
                </td>
                <td><span className="badge badge-danger">DELAYED</span></td>
                <td>
                  <Link to={`/university/${uni.id}`} className="button button-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}>
                    Intervene <ChevronRight size={14} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
