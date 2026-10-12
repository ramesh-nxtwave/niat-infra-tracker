import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { Search, Filter, ChevronRight, Plus, X, User, Phone, Calendar } from 'lucide-react';
import { useToast } from '../context/ToastContext';

export default function UniversitiesList() {
  const { universities = [], loading, addUniversity } = useData();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [newUni, setNewUni] = useState({ name: '', targetDate: '', pocName: '', pocPhone: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (loading && !showModal) {
    return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)', fontWeight: 900 }}>SYNCHRONIZING PORTFOLIO...</div>;
  }

  const filteredUnis = (universities || []).filter(u => {
    if (!u || !u.name) return false;
    
    // Visibility Filtering
    const userZones = user?.zoneIds?.map(String) || (user?.zoneId ? [String(user.zoneId)] : []);
    if (user?.role === 'zonal_manager' && !userZones.includes(String(u.zone_id))) return false;
    if (user?.role === 'apm' && !(user.universityIds || []).includes(u.id)) return false;
    
    return u.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newUni.name || !newUni.targetDate) return;
    
    setIsSubmitting(true);
    try {
      const result = await addUniversity(newUni);
      if (result && result.success) {
        showToast('University added successfully!', 'success');
        setShowModal(false);
        setNewUni({ name: '', targetDate: '', pocName: '', pocPhone: '' });
      } else {
        showToast('Error: ' + (result?.error || 'Database rejected the entry'), 'error');
      }
    } catch (err) {
      showToast('System Error: ' + err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getRiskColor = (status) => {
    switch (status) {
      case 'RED': return '#ef4444';
      case 'AMBER': return '#f59e0b';
      case 'GREEN': return '#10b981';
      default: return '#94a3b8';
    }
  };

  return (
    <div style={{ padding: '2rem', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* Header Section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem', flexWrap: 'wrap', gap: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>University <span className="text-gradient">Portfolio</span></h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', fontWeight: 500 }}>Overseeing {universities.length} active institutions.</p>
        </div>
        {user?.role === 'admin' && (
          <button 
            onClick={() => setShowModal(true)} 
            style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '1rem 2rem', borderRadius: '12px', fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 10px 15px -3px rgba(59, 130, 246, 0.3)' }}
          >
            <Plus size={20} /> Add Institution
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '0.5rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '3rem', border: '1px solid var(--border)' }}>
        <Search size={20} color="var(--text-secondary)" />
        <input 
          type="text" 
          placeholder="Filter by university name..." 
          style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', width: '100%', padding: '1rem 0', fontSize: '1rem' }}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Institution Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '2rem' }}>
        {filteredUnis.map(uni => {
          const riskColor = getRiskColor(uni.riskStatus);
          const progress = Number(uni.overallReadiness) || 0;
          return (
            <Link 
              key={uni.id} 
              to={`/university/${uni.id}`}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '16px', padding: '2rem', textDecoration: 'none', display: 'block', transition: 'transform 0.2s', position: 'relative', overflow: 'hidden', boxShadow: 'var(--glass-shadow)' }}
            >
              <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: riskColor }}></div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{ color: 'var(--accent-primary)', fontSize: '1.2rem', fontWeight: 800, margin: '0 0 0.5rem 0' }}>{uni.name}</h3>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.2rem 0.6rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: riskColor }}></div>
                    <span style={{ fontSize: '10px', fontWeight: 900, color: riskColor, letterSpacing: '0.05em' }}>{uni.riskStatus}</span>
                  </div>
                </div>

                {/* Progress Circle */}
                <div style={{ width: '50px', height: '50px', position: 'relative' }}>
                   <svg width="50" height="50">
                     <circle cx="25" cy="25" r="22" stroke="var(--border)" strokeWidth="4" fill="none" />
                     <circle cx="25" cy="25" r="22" stroke="#3b82f6" strokeWidth="4" fill="none" strokeDasharray="138.2" strokeDashoffset={138.2 - (138.2 * progress) / 100} transform="rotate(-90 25 25)" />
                   </svg>
                   <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                     <span style={{ color: 'var(--text-primary)', fontSize: '10px', fontWeight: 900 }}>{progress}%</span>
                   </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                <div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '8px', fontWeight: 900, textTransform: 'uppercase', marginBottom: '4px' }}>POC</p>
                  <p style={{ color: 'var(--text-primary)', fontSize: '12px', fontWeight: 600, margin: 0 }}>{uni.pocName || 'TBD'}</p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '8px', fontWeight: 900, textTransform: 'uppercase', marginBottom: '4px' }}>Date</p>
                  <p style={{ color: 'var(--text-primary)', fontSize: '12px', fontWeight: 600, margin: 0 }}>{uni.targetDate || 'TBD'}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* UNBREAKABLE MODAL */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.4)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-card)', padding: '3rem', borderRadius: '24px', width: '100%', maxWidth: '500px', position: 'relative', border: '1px solid var(--border)', boxShadow: 'var(--glass-shadow)' }}>
            <button onClick={() => setShowModal(false)} style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={24}/></button>
            <h2 style={{ color: 'var(--text-primary)', fontSize: '2rem', fontWeight: 900, marginBottom: '2rem' }}>Add Institution</h2>
            <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
               <div>
                 <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', marginBottom: '0.5rem' }}>University Name</label>
                 <input type="text" required placeholder="Full name of institution" style={{ width: '100%', padding: '1rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }} value={newUni.name} onChange={e => setNewUni({...newUni, name: e.target.value})} />
               </div>
               <div>
                 <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Target Launch Date</label>
                 <input type="date" required style={{ width: '100%', padding: '1rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }} value={newUni.targetDate} onChange={e => setNewUni({...newUni, targetDate: e.target.value})} />
               </div>
               <button type="submit" disabled={isSubmitting} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '1.2rem', borderRadius: '12px', fontWeight: 900, cursor: 'pointer', marginTop: '1rem' }}>
                 {isSubmitting ? 'Processing...' : 'Complete Onboarding'}
               </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
