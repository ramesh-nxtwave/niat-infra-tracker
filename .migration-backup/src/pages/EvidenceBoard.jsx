import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '../config/supabase';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { Image as ImageIcon, ExternalLink, Filter, Calendar, Search, MapPin, CheckCircle2 } from 'lucide-react';

export default function EvidenceBoard() {
  const { universities, loading: contextLoading } = useData();
  const { user } = useAuth();
  const [evidenceData, setEvidenceData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterDate, setFilterDate] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchEvidence = async () => {
      setLoading(true);
      try {
        console.log('📡 Fetching relational evidence cards...');
        const { data, error } = await supabase
          .from('space_checklist_status')
          .select(`
            id, photo_url, current_status, remarks, updated_at, meta,
            checklist_items (name, category),
            universities (id, name, zone_id),
            spaces (id, name, space_type)
          `)
          .not('photo_url', 'is', null)
          .order('updated_at', { ascending: false });

        if (error) throw error;
        setEvidenceData(data || []);
      } catch (err) {
        console.error('Evidence fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchEvidence();
  }, []);

  const allEvidence = useMemo(() => {
    const evidence = [];
    const seenIds = new Set();
    const userZones = user?.zoneIds?.map(String) || (user?.zoneId ? [String(user.zoneId)] : []);

    // 1. Process Relational Data (Direct Fetch)
    if (evidenceData && Array.isArray(evidenceData)) {
      evidenceData.forEach(update => {
        const uni = update.universities;
        if (!uni) return;
        
        if (user?.role === 'zonal_manager' && !userZones.includes(String(uni.zone_id))) return;
        if (user?.role === 'apm' && !(user.universityIds || []).map(String).includes(String(uni.id))) return;

        const eId = `rel-${update.id}`;
        seenIds.add(eId);
        
        evidence.push({
          id: eId,
          uniName: uni.name || 'Unnamed',
          location: uni.location || '',
          source: update.spaces?.name || 'General',
          category: update.checklist_items?.category || 'Other',
          itemName: update.checklist_items?.name || 'Unnamed Item',
          status: update.current_status || 'In-Progress',
          photoLink: update.photo_url,
          lastUpdated: update.updated_at || null
        });
      });
    }

    // 2. Process Legacy Data (Fallback)
    if (universities && Array.isArray(universities)) {
      universities.forEach(uni => {
        if (!uni || !uni.trackers) return;
        
        if (user?.role === 'zonal_manager' && !userZones.includes(String(uni.zone_id))) return;
        if (user?.role === 'apm' && !(user.universityIds || []).map(String).includes(String(uni.id))) return;

        const processItems = (items, source) => {
          if (!items || !Array.isArray(items)) return;
          items.forEach(item => {
            if (item && item.photoLink && !item.isRelational) {
              const eId = `leg-${uni.id}-${item.id}`;
              if (seenIds.has(eId)) return;

              evidence.push({
                id: eId,
                uniName: uni.name || 'Unnamed',
                location: uni.location || '',
                source: source,
                category: item.category || 'Other',
                itemName: item.name || 'Unnamed Item',
                status: item.status || 'Yet to start',
                photoLink: item.photoLink,
                lastUpdated: item.lastUpdated || null
              });
            }
          });
        };

        processItems(uni.trackers.modelClassroom?.items, 'Model Classroom');
        processItems(uni.trackers.lab5?.items, '5.0 Lab');
        processItems(uni.trackers.staffRoom?.items, 'Staff Room');
        processItems(uni.trackers.overallClassroom?.items, 'Overall Classroom');
      });
    }

    // Sort by date descending
    return evidence.sort((a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0));
  }, [evidenceData, universities, user]);

  const categories = ['All', ...new Set(allEvidence.map(e => e.category).filter(Boolean))];

  const filteredEvidence = useMemo(() => {
    return allEvidence.filter(e => {
      const matchCat = filterCategory === 'All' || e.category === filterCategory;
      const matchSearch = e.itemName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          e.uniName.toLowerCase().includes(searchTerm.toLowerCase());
      
      let matchDate = true;
      if (filterDate && e.lastUpdated) {
        const targetDate = new Date(filterDate).toDateString();
        const itemDate = new Date(e.lastUpdated).toDateString();
        matchDate = targetDate === itemDate;
      }
      
      return matchCat && matchSearch && matchDate;
    });
  }, [allEvidence, filterCategory, searchTerm, filterDate]);

  const formatDate = (isoString) => {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleDateString('en-IN', { 
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="app-container fade-in" style={{ maxWidth: '1400px' }}>
      {/* ── Header Section ─────────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: '2.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title text-gradient" style={{ fontSize: '2.2rem', fontWeight: 900, marginBottom: '0.5rem' }}>Portfolio Evidence Board</h1>
          <p className="page-subtitle" style={{ fontSize: '1rem', opacity: 0.8 }}>Verify 2026 infrastructure milestones through site evidence.</p>
        </div>

        {/* Filter Bar */}
        <div className="glass-panel" style={{ width: '100%', padding: '1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', background: 'rgba(255,255,255,0.7)', border: '1px solid var(--border)' }}>
          <div style={{ position: 'relative', flex: '1 1 300px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input 
              type="text" 
              placeholder="Search university or item..." 
              className="form-input"
              style={{ paddingLeft: '2.5rem', background: 'white' }}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* Category Filter */}
            <div className="filter-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: 'white', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <Filter size={14} className="text-secondary" />
              <select 
                className="bg-transparent border-none text-sm outline-none font-semibold"
                style={{ minWidth: '130px', cursor: 'pointer' }}
                value={filterCategory} 
                onChange={(e) => setFilterCategory(e.target.value)}
              >
                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>

            {/* Date Filter */}
            <div className="filter-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: 'white', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <Calendar size={14} className="text-secondary" />
              <input 
                type="date" 
                className="bg-transparent border-none text-sm outline-none font-semibold"
                style={{ cursor: 'pointer' }}
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
              />
              {filterDate && (
                <button 
                  onClick={() => setFilterDate('')}
                  style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1, color: 'var(--text-secondary)' }}
                >×</button>
              )}
            </div>
          </div>

          <div style={{ marginLeft: 'auto', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Showing {filteredEvidence.length} Evidence Cards
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <div key={i} className="glass-panel pulse" style={{ height: '300px', borderRadius: '16px', background: 'rgba(255,255,255,0.05)' }} />
          ))}
        </div>
      ) : filteredEvidence.length === 0 ? (
        <div className="glass-panel" style={{ padding: '5rem', textAlign: 'center', border: '2px dashed var(--border)', background: 'rgba(255,255,255,0.4)' }}>
          <div style={{ display: 'inline-block', padding: '1.5rem', borderRadius: '50%', background: 'rgba(0,0,0,0.05)', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            <ImageIcon size={64} />
          </div>
          <h2 className="page-title" style={{ fontSize: '1.75rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>No Matches Found</h2>
          <p className="text-secondary" style={{ maxWidth: '500px', margin: '0 auto', lineHeight: 1.6, fontSize: '1.1rem' }}>
            {allEvidence.length === 0 
              ? "No photo evidence has been uploaded to the system yet." 
              : "Try adjusting your filters or search terms to find what you're looking for."}
          </p>
        </div>
      ) : (
        <div className="evidence-grid" style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', 
          gap: '2rem' 
        }}>
          {filteredEvidence.map(evidence => (
            <div key={evidence.id} className="glass-panel evidence-card-premium" style={{ 
              overflow: 'hidden', 
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              background: 'white',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {/* Photo Viewport */}
              <div style={{ position: 'relative', paddingTop: '65%', background: '#f1f5f9', overflow: 'hidden' }}>
                <img 
                  src={evidence.photoLink} 
                  alt={evidence.itemName} 
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.5s ease' }}
                  className="evidence-img"
                />
                <div className="evidence-card-overlay" style={{ 
                  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
                  background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)',
                  display: 'flex', alignItems: 'flex-end', padding: '1rem', opacity: 0, transition: 'opacity 0.3s ease'
                }}>
                  <a href={evidence.photoLink} target="_blank" rel="noopener noreferrer" 
                    className="button button-primary" style={{ width: '100%', textAlign: 'center', backdropFilter: 'blur(10px)', background: 'rgba(59,130,246,0.9)' }}>
                    View Full Resolution
                  </a>
                </div>
                
                {/* Status Badge Overlays */}
                <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', gap: '0.5rem' }}>
                  <span style={{ 
                    padding: '0.35rem 0.65rem', borderRadius: '6px', fontSize: '0.65rem', fontWeight: 900, 
                    background: evidence.status === 'Done' ? '#10b981' : '#f59e0b', color: 'white', textTransform: 'uppercase'
                  }}>
                    {evidence.status}
                  </span>
                </div>
              </div>

              {/* Content Details */}
              <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {evidence.category}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    <Calendar size={12} /> {formatDate(evidence.lastUpdated)}
                  </div>
                </div>

                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.25rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                  {evidence.itemName}
                </h3>

                <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)' }}>
                      <CheckCircle2 size={16} />
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)' }}>{evidence.uniName}</p>
                      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{evidence.source}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Internal Page Styles */}
      <style>{`
        .evidence-card-premium:hover {
          transform: translateY(-8px);
          box-shadow: 0 20px 40px rgba(0,0,0,0.12) !important;
          border-color: var(--accent-primary) !important;
        }
        .evidence-card-premium:hover .evidence-img {
          transform: scale(1.08);
        }
        .evidence-card-premium:hover .evidence-card-overlay {
          opacity: 1 !important;
        }
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
