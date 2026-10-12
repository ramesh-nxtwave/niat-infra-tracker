import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { Search, Filter, ChevronRight, Activity, Calendar } from 'lucide-react';

export default function UniversitySelection() {
  const { universities, loading } = useData();
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');

  if (loading) return <div className="loading-container">Loading Portfolio...</div>;

  const filteredUnis = React.useMemo(() => {
    const all = universities || [];
    
    if (user?.role === 'zonal_manager') {
      const userZoneSet = new Set(
        [
          ...(Array.isArray(user?.zoneIds) ? user.zoneIds : []),
          ...(user?.zoneId != null ? [user.zoneId] : [])
        ].map(id => Number(id)).filter(n => !isNaN(n))
      );
      
      // If no zones configured → show all
      if (userZoneSet.size === 0) return all.filter(u => u.name.toLowerCase().includes(searchTerm.toLowerCase()));

      // Pass 1: Strict Match
      const zoneMatched = all.filter(u => {
        const uniZone = u.zone_id != null ? Number(u.zone_id) : null;
        return (uniZone != null && userZoneSet.has(uniZone)) || (uniZone == null);
      });

      const visible = zoneMatched.length > 0 ? zoneMatched : all;
      return visible.filter(u => u.name.toLowerCase().includes(searchTerm.toLowerCase()));

    } else if (user?.role === 'apm') {
      const mappedIds = new Set((user.universityIds || []).map(String));
      return all.filter(u => {
        const idMatch = mappedIds.has(String(u.id));
        const nameMatch = u.apm_name && user?.name &&
          u.apm_name.toLowerCase().trim() === user.name.toLowerCase().trim();
        
        return (idMatch || nameMatch) && u.name.toLowerCase().includes(searchTerm.toLowerCase());
      });
    }

    return all.filter(u => u.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [universities, user, searchTerm]);

  const getRiskColor = (status) => {
    switch (status) {
      case 'RED': return '#ef4444';
      case 'AMBER': return '#f59e0b';
      case 'GREEN': return '#10b981';
      default: return '#94a3b8';
    }
  };

  return (
    <div className="app-container fade-in pb-20">
      <div className="page-header mb-8">
        <div>
          <h1 className="page-title text-gradient">University Portfolio</h1>
          <p className="page-subtitle">Select an institution to drill down into technical progress.</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="glass-panel p-2 flex items-center flex-1">
          <Search size={18} className="text-secondary ml-2" />
          <input 
            type="text" 
            placeholder="Search by university name..." 
            className="bg-transparent border-none outline-none w-full px-3 py-2"
            style={{ color: 'var(--text-primary)' }}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button className="button button-secondary flex items-center gap-2">
          <Filter size={16} /> Filter by Risk
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredUnis.map(uni => (
          <Link 
            key={uni.id} 
            to={`/university/${uni.id}`}
            className="glass-panel p-6 hover:border-accent-primary transition-all group relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-100 transition-opacity">
              <ChevronRight size={24} className="text-accent-primary" />
            </div>

            <div className="flex flex-col h-full">
              <div className="mb-4">
                <h3 className="text-xl font-bold group-hover:text-accent-primary transition-colors" style={{ color: 'var(--text-primary)' }}>{uni.name}</h3>
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getRiskColor(uni.riskStatus) }}></div>
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: getRiskColor(uni.riskStatus) }}>{uni.riskStatus} RISK</span>
                </div>
              </div>

              <div className="space-y-4 mt-auto">
                <div className="flex justify-between items-end">
                  <div className="flex items-center gap-2 text-secondary">
                    <Activity size={14} />
                    <span className="text-xs">Overall Progress</span>
                  </div>
                  <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{uni.overallReadiness}%</span>
                </div>
                <div className="progress-container h-1.5">
                  <div 
                    className="progress-bar transition-all duration-1000" 
                    style={{ 
                      width: `${uni.overallReadiness}%`,
                      backgroundColor: uni.overallReadiness > 80 ? '#10b981' : uni.overallReadiness > 40 ? '#f59e0b' : '#ef4444'
                    }}
                  ></div>
                </div>

                <div className="flex items-center gap-2 text-secondary pt-2 border-t border-white/5">
                  <Calendar size={14} />
                  <span className="text-xs">Target: {uni.targetDate}</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {filteredUnis.length === 0 && (
        <div className="text-center py-20 bg-white/5 rounded-2xl border border-dashed border-white/10">
          <p className="text-secondary">No universities found matching your search criteria.</p>
        </div>
      )}
    </div>
  );
}
