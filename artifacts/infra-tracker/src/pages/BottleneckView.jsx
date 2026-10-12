import React from 'react';
import { useData } from '../context/DataContext';
import { AlertTriangle, UserCog, PackageSearch, ArrowRightCircle } from 'lucide-react';

export default function BottleneckView() {
  const { dashboardStats, loading } = useData();

  if (loading) return <div className="loading-container">Analyzing Blockers...</div>;

  const pendingCategories = Object.keys(dashboardStats.bottlenecks.byCategory)
    .map(cat => ({ name: cat, count: dashboardStats.bottlenecks.byCategory[cat] }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="app-container fade-in pb-20">
      <div className="page-header mb-8">
        <div>
          <h1 className="page-title text-gradient">Bottleneck Tracker</h1>
          <p className="page-subtitle">Identifying and resolving impediments across the portfolio.</p>
        </div>
      </div>

      <div className="dashboard-stats-grid mb-8">
        <div className="glass-panel stat-card" style={{ borderLeft: '4px solid #ef4444' }}>
          <div className="stat-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}><AlertTriangle size={24} /></div>
          <div>
            <p className="form-label mb-0">Critical Blockers</p>
            <p className="page-title text-danger">{dashboardStats.bottlenecks.vendorRequired.length}</p>
          </div>
        </div>
        <div className="glass-panel stat-card" style={{ borderLeft: '4px solid #f59e0b' }}>
          <div className="stat-icon" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}><UserCog size={24} /></div>
          <div>
            <p className="form-label mb-0">Vendor Interventions Needed</p>
            <p className="page-title text-warning">{dashboardStats.bottlenecks.vendorRequired.length}</p>
          </div>
        </div>
      </div>

      <div className="dashboard-charts-grid mb-8">
        {/* Pending by Category */}
        <div className="glass-panel chart-card">
          <h2 className="chart-title flex items-center gap-2"><PackageSearch size={20} /> Pending Items by Category</h2>
          <div className="mt-6 flex flex-col gap-4">
            {pendingCategories.map(cat => (
              <div key={cat.name} className="flex flex-col gap-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{cat.name}</span>
                  <span className="text-secondary">{cat.count} Items Pending</span>
                </div>
                <div className="progress-container h-2">
                  <div className="progress-bar" style={{ width: `${(cat.count / 150) * 100}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Vendor Required List */}
        <div className="glass-panel chart-card">
          <h2 className="chart-title flex items-center gap-2 text-warning"><UserCog size={20} /> Vendor Action Required</h2>
          <div className="mt-6 overflow-y-auto max-h-[400px] flex flex-col gap-3">
            {dashboardStats.bottlenecks.vendorRequired.length > 0 ? (
              dashboardStats.bottlenecks.vendorRequired.map((item, idx) => (
                <div key={idx} className="glass-panel p-3 border-l-2 border-warning flex justify-between items-center" style={{ background: 'var(--bg-secondary)' }}>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{item.item}</p>
                    <p className="text-xs text-secondary">{item.university}</p>
                  </div>
                  <ArrowRightCircle size={18} className="text-warning" />
                </div>
              ))
            ) : (
              <p className="text-secondary text-center py-10">No vendor interventions required at this time.</p>
            )}
          </div>
        </div>
      </div>

      <div className="glass-panel p-6 text-center">
        <p className="text-secondary mb-4">Need to revamp a specific category or change resource allocation?</p>
        <button className="button button-primary">Initiate Global Status Revamp</button>
      </div>
    </div>
  );
}
