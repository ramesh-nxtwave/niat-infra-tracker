import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, ShieldCheck, Database, School, LogOut, User, Activity } from 'lucide-react';

export default function Layout({ children }) {
  const location = useLocation();
  
  const navLinks = [
    { name: 'Dashboard', path: '/', icon: <LayoutDashboard size={18} /> },
    { name: 'Master Tracker', path: '/universities', icon: <Database size={18} /> },
    { name: 'Evidence Board', path: '/', icon: <ShieldCheck size={18} /> },
    { name: 'Institutional Fleet', path: '/', icon: <School size={18} /> },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-bg-main">
      {/* Top Navigation Bar - Recalibrated for Spacing */}
      <header className="navbar flex items-center justify-between px-10 border-b border-border-color bg-bg-main sticky top-0 z-[100] h-[80px]">
        <div className="flex items-center gap-12">
           <Link to="/" className="flex items-center gap-3 no-underline group">
              <div className="w-11 h-11 bg-accent-gradient rounded-2xl flex items-center justify-center text-white shadow-lg shadow-purple-500/20 group-hover:scale-110 transition-transform">
                 <ShieldCheck size={26} />
              </div>
              <div className="flex flex-col">
                 <span className="text-xl font-black tracking-tighter leading-none" style={{ color: 'var(--text-primary)' }}>B2B Infra<span style={{ color: 'var(--accent-primary)' }}>Tracker</span></span>
                 <span className="text-[9px] font-black uppercase tracking-[0.3em] mt-1" style={{ color: 'var(--accent-primary)' }}>NxtWave Executive</span>
              </div>
           </Link>

           <nav className="hidden xl:flex items-center gap-10">
             {navLinks.map(link => (
               <Link 
                 key={link.name} 
                 to={link.path} 
                 className={`text-sm font-bold tracking-tight no-underline transition-all`}
                 style={{ color: location.pathname === link.path ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
               >
                 {link.name}
               </Link>
             ))}
           </nav>
        </div>

        <div className="flex items-center gap-8">
           <div className="hidden lg:flex flex-col text-right">
              <span className="text-sm font-black leading-none" style={{ color: 'var(--text-primary)' }}>Riteesh Reddy</span>
              <span className="text-[10px] font-bold text-text-secondary mt-1">riteesh.reddy@nxtwave.co.in</span>
           </div>
           <div className="flex items-center gap-4 border-l border-border-color pl-8">
              <div className="w-10 h-10 rounded-2xl bg-black/5 border border-black/5 flex items-center justify-center text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 hover:border-accent-primary/20 transition-all cursor-pointer">
                 <User size={18} />
              </div>
              <div className="w-10 h-10 rounded-2xl bg-black/5 border border-black/5 flex items-center justify-center text-text-secondary hover:text-accent-danger hover:bg-accent-danger/10 hover:border-accent-danger/20 transition-all cursor-pointer">
                 <LogOut size={18} />
              </div>
           </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1600px] mx-auto w-full p-10 pt-6">
        {children}
      </main>
    </div>
  );
}
