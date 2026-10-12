import React from 'react';
import { useData } from '../context/DataContext';
import { Image as ImageIcon, AlertCircle, ExternalLink } from 'lucide-react';

export default function MediaProofView() {
  const { dashboardStats, loading } = useData();

  if (loading) return <div className="loading-container">Retrieving Media...</div>;

  return (
    <div className="app-container fade-in pb-20">
      <div className="page-header mb-8">
        <div>
          <h1 className="page-title text-gradient">Media Proof & Compliance</h1>
          <p className="page-subtitle">Visual verification and evidence board.</p>
        </div>
      </div>

      <div className="dashboard-stats-grid mb-8">
        <div className="glass-panel stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}><ImageIcon size={24} /></div>
          <div>
            <p className="form-label mb-0">Evidence Uploaded</p>
            <p className="page-title">{dashboardStats.mediaProofs.total}</p>
          </div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}><AlertCircle size={24} /></div>
          <div>
            <p className="form-label mb-0">Missing Proofs (Done Items)</p>
            <p className="page-title text-danger">{dashboardStats.mediaProofs.missing}</p>
          </div>
        </div>
      </div>

      <div className="glass-panel p-6">
        <h2 className="chart-title mb-6">Execution Gallery</h2>
        {dashboardStats.mediaProofs.gallery.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {dashboardStats.mediaProofs.gallery.map((media, idx) => (
              <div key={idx} className="glass-panel overflow-hidden group hover:border-accent-primary transition-colors cursor-pointer">
                <div className="aspect-video bg-black/50 relative overflow-hidden">
                  <img 
                    src={media.url} 
                    alt={media.item} 
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    onError={(e) => { e.target.src = 'https://via.placeholder.com/400x225?text=Invalid+Link'; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                    <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{media.item}</p>
                    <p className="text-secondary text-xs">{media.university}</p>
                  </div>
                </div>
                <div className="p-3 flex justify-between items-center">
                   <div className="overflow-hidden">
                    <p className="font-semibold text-xs truncate" style={{ color: 'var(--text-primary)' }}>{media.university}</p>
                    <p className="text-secondary text-[10px] truncate">{media.item}</p>
                   </div>
                   <a href={media.url} target="_blank" rel="noopener noreferrer" className="text-accent-primary p-2">
                     <ExternalLink size={14} />
                   </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 rounded-xl border border-dashed" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <ImageIcon size={48} className="mx-auto mb-4" style={{ color: 'var(--border)' }} />
            <p className="text-secondary">No visual evidence has been uploaded to the system yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
