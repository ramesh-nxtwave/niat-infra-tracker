import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Globe, AlertTriangle, TrendingUp, CheckCircle, Clock, ChevronRight, Filter } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useMemo } from 'react';

export default function MobileDashboard() {
  const { dashboardStats, universities, loading } = useData();
  const { user } = useAuth();

  const visibleUnis = useMemo(() => {
    return (universities || []).filter(u => {
      const userZones = user?.zoneIds?.map(String) || (user?.zoneId ? [String(user.zoneId)] : []);
      if (user?.role === 'zonal_manager' && !userZones.includes(String(u.zone_id))) return false;
      if (user?.role === 'apm' && !(user.universityIds || []).map(String).includes(String(u.id))) return false;
      return true;
    });
  }, [universities, user]);

  const stats = useMemo(() => {
    const total = visibleUnis.length;
    const avg = total > 0 ? Math.round(visibleUnis.reduce((acc, curr) => acc + (curr.overallReadiness || 0), 0) / total) : 0;
    let delayedItemsCount = 0;
    visibleUnis.forEach(uni => {
      const trackers = uni.trackers || {};
      [trackers.modelClassroom, trackers.lab5, trackers.staffRoom].forEach(t => {
        if (t && t.items) t.items.forEach(item => { if (item.status !== 'Done' && item.daysDelayed > 0) delayedItemsCount++; });
      });
    });
    return { avgReadiness: avg, delayedItemsCount };
  }, [visibleUnis]);

  if (loading) return <div className="loading-container">Syncing Infrastructure...</div>;

  return (
    <div className="app-container fade-in pb-24 px-4 pt-4">
      {/* 🚀 QUICK STATS - HORIZONTAL SCROLL ON MOBILE */}
      <div className="flex gap-4 overflow-x-auto pb-6 no-scrollbar">
        <div className="glass-panel min-w-[280px] p-6 border-accent-primary/20 bg-accent-primary/5">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-accent-primary/20 rounded-xl text-accent-primary">
              <TrendingUp size={20} />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-accent-primary">Overall readiness</span>
          </div>
          <h2 className="text-4xl font-black" style={{ color: 'var(--text-primary)' }}>{stats.avgReadiness}%</h2>
          <div className="mt-4 progress-container h-1.5 bg-white/5">
            <div className="progress-bar bg-accent-primary" style={{ width: `${stats.avgReadiness}%` }}></div>
          </div>
        </div>

        <div className="glass-panel min-w-[280px] p-6 border-red-500/20 bg-red-500/5">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-red-500/20 rounded-xl text-red-500">
              <AlertTriangle size={20} />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-red-500">Delayed items</span>
          </div>
          <h2 className="text-4xl font-black" style={{ color: 'var(--text-primary)' }}>{stats.delayedItemsCount}</h2>
          <p className="text-[10px] text-secondary mt-2 font-bold uppercase tracking-widest">Requires Immediate Action</p>
        </div>
      </div>

      {/* 📊 UNIVERSITY PROGRESS LIST */}
      <div className="mt-8">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>Portfolio <span className="text-gradient">Progress</span></h3>
          <Filter size={18} className="text-secondary" />
        </div>

        <div className="space-y-4">
          {visibleUnis.map(uni => (
            <div key={uni.id} className="glass-panel p-5 border-white/5 bg-white/2 hover:bg-white/5 transition-all">
              <div className="flex justify-between items-center mb-4">
                <div className="flex-1">
                  <h4 className="text-md font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{uni.name}</h4>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${uni.riskStatus === 'RED' ? 'bg-red-500' : 'bg-success'}`}></div>
                    <span className="text-[9px] font-black text-secondary uppercase tracking-widest">{uni.riskStatus} RISK</span>
                  </div>
                </div>
                <div className="text-right">
                   <p className="text-lg font-black leading-none" style={{ color: 'var(--text-primary)' }}>{uni.overallReadiness}%</p>
                   <span className="text-[8px] font-bold text-secondary uppercase">Ready</span>
                </div>
              </div>
              
              <div className="progress-container h-1 bg-white/5 overflow-hidden">
                <div className="progress-bar bg-accent-primary" style={{ width: `${uni.overallReadiness}%` }}></div>
              </div>

              <div className="mt-4 flex justify-between items-center">
                 <div className="flex -space-x-2">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-[8px] font-bold" style={{ borderColor: 'var(--bg-secondary)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                        {uni.name[i]}
                      </div>
                    ))}
                 </div>
                 <button className="text-accent-primary text-[10px] font-black uppercase flex items-center gap-1">
                   View Trackers <ChevronRight size={14} />
                 </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
