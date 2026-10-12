import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { Plus, Search, Filter, ShieldCheck, MapPin, Calendar, ArrowRight, BarChart2, Activity } from 'lucide-react';

export default function UniversitiesList() {
  const { universities, addUniversity } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRisk, setFilterRisk] = useState('ALL');

  const filtered = universities.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(searchTerm.toLowerCase()) || u.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRisk = filterRisk === 'ALL' || u.riskStatus === filterRisk;
    return matchesSearch && matchesRisk;
  });

  const stats = {
    total: universities.length,
    active: universities.filter(u => u.overallReadiness < 100).length,
    avgReadiness: Math.round(universities.reduce((acc, curr) => acc + (curr.overallReadiness || 0), 0) / (universities.length || 1)),
    atRisk: universities.filter(u => u.riskStatus === 'RED').length
  };

  return (
    <div className="min-h-screen pb-24 px-4 md:px-8 max-w-7xl mx-auto pt-10 fade-in">
      {/* Executive Command Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-12 mb-16">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-accent-primary/10 border border-accent-primary/20">
             <div className="w-2 h-2 rounded-full bg-accent-primary animate-ping"></div>
             <span className="text-[10px] font-black text-accent-primary uppercase tracking-[0.2em]">Global Fleet Pulse</span>
          </div>
          <h1 className="text-6xl font-black tracking-tight leading-none" style={{ color: 'var(--text-primary)' }}>
            Infrastructure <br/><span className="text-accent-primary">Command Center</span>
          </h1>
          <p className="text-secondary max-w-lg font-medium text-lg leading-relaxed">
            Real-time readiness orchestration for your national institutional fleet.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 min-w-[400px]">
           {[
             { label: 'Total Institutions', val: stats.total, icon: <ShieldCheck size={20}/>, color: 'text-accent-primary' },
             { label: 'Fleet Readiness', val: stats.avgReadiness + '%', icon: <Activity size={20}/>, color: 'text-accent-success' },
             { label: 'Active Deployments', val: stats.active, icon: <BarChart2 size={20}/>, color: 'text-accent-secondary' },
             { label: 'Critical Blockers', val: stats.atRisk, icon: <Activity size={20}/>, color: 'text-accent-danger' }
           ].map((s, i) => (
             <div key={i} className="glass-panel p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                <div className={`${s.color} mb-3`}>{s.icon}</div>
                <div className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>{s.val}</div>
                <div className="text-[10px] font-black text-secondary uppercase tracking-widest mt-1">{s.label}</div>
             </div>
           ))}
        </div>
      </div>

      {/* Action Controls */}
      <div className="flex flex-col md:flex-row items-center gap-6 mb-12">
        <div className="relative flex-1 group">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-secondary group-focus-within:text-accent-primary transition-colors" size={20} />
          <input 
            type="text" 
            placeholder="Search by Institution Name or ID..." 
            className="w-full bg-white border border-border-color rounded-2xl p-5 pl-14 text-sm font-medium focus:ring-4 focus:ring-accent-primary/10 transition-all"
            style={{ color: 'var(--text-primary)' }}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative flex-1 md:w-48 group">
            <Filter className="absolute left-5 top-1/2 -translate-y-1/2 text-secondary group-focus-within:text-accent-primary transition-colors" size={18} />
            <select 
              className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 pl-14 text-xs font-bold uppercase tracking-widest appearance-none cursor-pointer"
              value={filterRisk}
              onChange={(e) => setFilterRisk(e.target.value)}
            >
              <option value="ALL">All Priorities</option>
              <option value="GREEN">Green (On Track)</option>
              <option value="AMBER">Amber (Delayed)</option>
              <option value="RED">Red (Critical)</option>
            </select>
          </div>
          
          <button 
            onClick={() => addUniversity({ name: 'New Institution', target_date: new Date().toISOString().split('T')[0] })}
            className="btn-primary flex items-center gap-3 whitespace-nowrap"
          >
            <Plus size={20} /> Add Institution
          </button>
        </div>
      </div>

      {/* Fleet List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filtered.map((uni, idx) => (
          <Link 
            key={uni.id} 
            to={`/university/${uni.id}`}
            className="glass-panel p-8 group relative overflow-hidden flex flex-col justify-between hover:border-accent-primary/30"
            style={{ animationDelay: `${idx * 0.05}s` }}
          >
            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-20 group-hover:scale-125 transition-all">
               <ShieldCheck size={120} className="text-accent-primary" />
            </div>

            <div className="relative z-10 space-y-6">
              <div className="flex justify-between items-start">
                 <div className="space-y-1">
                    <span className="text-[10px] font-black text-secondary uppercase tracking-[0.2em]">{uni.id}</span>
                    <h3 className="text-2xl font-black group-hover:text-accent-primary transition-colors leading-tight" style={{ color: 'var(--text-primary)' }}>{uni.name}</h3>
                 </div>
                 <div className={`px-3 py-1 rounded-lg text-[9px] font-black border ${uni.riskStatus === 'RED' ? 'bg-accent-danger/10 text-accent-danger border-accent-danger/20' : 'bg-accent-success/10 text-accent-success border-accent-success/20'}`}>
                    {uni.riskStatus}
                 </div>
              </div>

              <div className="space-y-2">
                 <div className="flex justify-between items-end text-xs font-bold mb-1">
                    <span className="text-secondary uppercase tracking-widest text-[9px]">Module Readiness</span>
                    <span style={{ color: 'var(--text-primary)' }}>{uni.overallReadiness || 0}%</span>
                 </div>
                 <div className="progress-track h-2">
                    <div className="progress-fill" style={{ width: `${uni.overallReadiness || 0}%` }}></div>
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5">
                 <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[9px] font-black text-secondary uppercase tracking-widest">
                       <MapPin size={12} className="text-accent-primary" /> Target Date
                    </div>
                    <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{uni.targetDate || 'TBD'}</div>
                 </div>
                 <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[9px] font-black text-secondary uppercase tracking-widest">
                       <ShieldCheck size={12} className="text-accent-primary" /> Modules
                    </div>
                    <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>4 Active Tracks</div>
                 </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between group/link relative z-10">
               <span className="text-[10px] font-black text-secondary uppercase tracking-widest group-hover/link:text-accent-primary transition-colors">Enter Audit Board</span>
               <div className="p-2 rounded-lg bg-white/5 group-hover:bg-accent-primary transition-all">
                  <ArrowRight size={16} className="text-white" />
               </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
