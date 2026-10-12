import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, LogOut, User } from 'lucide-react';

export default function Navbar() {
  const { logout, user } = useAuth();
  const location = useLocation();

  return (
    <nav className="navbar" style={{ padding: '0 2rem', borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(2, 6, 23, 0.8)', backdropFilter: 'blur(10px)', sticky: 'top', zIndex: 100 }}>
      <div className="nav-container" style={{ maxWidth: '1400px', margin: '0 auto', height: '70px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        
        {/* Logo Section */}
        <Link to="/" className="nav-logo" style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', textDecoration: 'none' }}>
          <div className="nav-logo-icon" style={{ background: '#3b82f6', p: '0.4rem', borderRadius: '8px', display: 'flex' }}>
             <LayoutDashboard size={20} color="white" />
          </div>
          <span className="text-gradient" style={{ fontWeight: 900, fontSize: '1.2rem' }}>InfraTracker</span>
        </Link>

        {/* Navigation Links - FIXED SPACING */}
        <div className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: '2.5rem' }}>
          <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`} style={{ fontSize: '0.85rem', fontWeight: 600, color: location.pathname === '/' ? '#3b82f6' : '#94a3b8', textDecoration: 'none' }}>Dashboard</Link>
          <Link to="/universities" className={`nav-link ${location.pathname === '/universities' ? 'active' : ''}`} style={{ fontSize: '0.85rem', fontWeight: 600, color: location.pathname === '/universities' ? '#3b82f6' : '#94a3b8', textDecoration: 'none' }}>Universities</Link>
          <Link to="/" state={{ tab: 'scorecard' }} className="nav-link" style={{ fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8', textDecoration: 'none' }}>Master Tracker</Link>
          <Link to="/" state={{ tab: 'evidence' }} className="nav-link" style={{ fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8', textDecoration: 'none' }}>Evidence Board</Link>
        </div>

        {/* User Profile Section */}
        <div className="flex items-center gap-6" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div className="hidden md:flex items-center gap-2" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.4rem', borderRadius: '50%', display: 'flex' }}>
              <User size={16} color="#94a3b8" />
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8' }}>{user?.email?.split('@')[0] || 'Admin'}</span>
          </div>
          
          <button 
            onClick={logout}
            className="button button-secondary" 
            style={{ padding: '0.4rem 1rem', fontSize: '0.75rem', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}
          >
            <LogOut size={14} /> Logout
          </button>
        </div>
      </div>
    </nav>
  );
}
