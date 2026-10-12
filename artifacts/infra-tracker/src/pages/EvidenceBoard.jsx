import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Image as ImageIcon, Filter, Calendar, Search, X, Loader, RefreshCw, ChevronDown, ChevronUp, Clock, User, Tag } from 'lucide-react';
import ImageLightbox from '../components/ImageLightbox';
import { getImageUrl } from '../utils/imageUtils';
import EvidenceMedia from '../components/EvidenceMedia';

const STATUS_COLORS = {
  Done: '#10b981',
  'In-Progress': '#3b82f6',
  'Yet to start': '#64748b',
  Blocker: '#ef4444',
  'Need to revamp': '#f59e0b',
  'No info as of now': '#94a3b8',
};

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};
const formatDateTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

function EvidenceCard({ item, onOpen, allItems, myIndex }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const { authFetch } = useAuth();

  const mainSrc = item.photoUrl ? getImageUrl(item.photoUrl) : null;

  const loadHistory = async () => {
    if (history !== null) { setHistoryOpen(o => !o); return; }
    setLoadingHistory(true);
    try {
      const data = await authFetch(`/photo-history/${item.id}`);
      setHistory(Array.isArray(data) ? data : []);
      setHistoryOpen(true);
    } catch {
      setHistory([]);
      setHistoryOpen(true);
    } finally {
      setLoadingHistory(false);
    }
  };

  const allGalleryImages = useMemo(() => {
    return allItems
      .filter(i => i.photoUrl)
      .map(i => ({
        id: i.id,
        photoUrl: i.photoUrl,
        contentType: i.photoContentType,
        itemName: i.itemName,
        uniName: i.uniName,
        lastUpdated: i.lastUpdated,
      }));
  }, [allItems]);

  const galleryStartIdx = allGalleryImages.findIndex(img => img.id === item.id);

  return (
    <div className="glass-panel" style={{ overflow: 'hidden', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', transition: 'transform 0.2s, box-shadow 0.2s' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 28px rgba(0,0,0,0.12)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}>

      {/* Thumbnail */}
      <div style={{ position: 'relative', height: '200px', background: 'var(--bg-primary)', overflow: 'hidden', cursor: mainSrc ? 'zoom-in' : 'default', flexShrink: 0 }}
        onClick={() => mainSrc && onOpen(allGalleryImages, galleryStartIdx >= 0 ? galleryStartIdx : 0)}>
        {mainSrc ? (
          <>
            <EvidenceMedia
              path={item.photoUrl}
              contentType={item.photoContentType}
              alt={item.itemName}
              controls
              muted
              imageStyle={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform 0.3s' }}
              videoStyle={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' }}
              onImageError={e => { e.currentTarget.style.display = 'none'; }}
            />
            <div style={{ display: 'none', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '0.5rem', color: 'var(--text-secondary)' }}>
              <ImageIcon size={32} style={{ opacity: 0.3 }} />
              <span style={{ fontSize: '0.75rem' }}>Image unavailable</span>
            </div>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.5) 100%)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: '0.6rem', left: '0.6rem' }}>
              <span style={{ background: STATUS_COLORS[item.status] || '#64748b', color: 'white', fontSize: '0.65rem', fontWeight: 800, padding: '0.2rem 0.6rem', borderRadius: '999px', letterSpacing: '0.04em' }}>
                {item.status}
              </span>
            </div>
            <div style={{ position: 'absolute', bottom: '0.6rem', right: '0.6rem' }}>
              <span style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.9)', fontSize: '0.65rem', padding: '0.2rem 0.5rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.3rem', backdropFilter: 'blur(4px)' }}>
                <ImageIcon size={10} /> Click to expand
              </span>
            </div>
          </>
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '0.75rem' }}>
            <ImageIcon size={40} style={{ opacity: 0.15 }} />
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>No photo uploaded</span>
            <span style={{ background: STATUS_COLORS[item.status] || '#64748b', color: 'white', fontSize: '0.65rem', fontWeight: 800, padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
              {item.status}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: '0.875rem', lineHeight: 1.4, color: 'var(--text-primary)' }}>{item.itemName}</p>
          <p style={{ margin: '0.15rem 0 0', fontSize: '0.72rem', color: 'var(--accent-primary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.category}</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: STATUS_COLORS[item.status] || '#64748b', flexShrink: 0 }} />
          <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.uniName}</p>
        </div>
        <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{item.source}</p>

        <div style={{ marginTop: 'auto', paddingTop: '0.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.25rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
            <Clock size={10} /> {formatDate(item.lastUpdated)}
          </span>
          {item.photoUrl && (
            <button onClick={loadHistory} disabled={loadingHistory}
              style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', padding: 0 }}>
              {loadingHistory ? <Loader size={11} style={{ animation: 'spin 1s linear infinite' }} /> : (historyOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
              {history ? `History (${history.length})` : 'View history'}
            </button>
          )}
        </div>
      </div>

      {/* Photo history strip */}
      {historyOpen && history && (
        <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
          {history.length === 0 ? (
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>No upload history yet.</p>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
              {history.map((h, i) => (
                <div key={h.id ?? i} style={{ flexShrink: 0, width: '80px' }}>
                  <div style={{ borderRadius: '6px', overflow: 'hidden', border: i === 0 ? '2px solid var(--accent-primary)' : '1px solid var(--border)', cursor: 'zoom-in', position: 'relative' }}
                    onClick={() => onOpen(history.map(hh => ({
                      id: hh.id,
                      photoUrl: hh.photoUrl,
                      contentType: hh.contentType,
                      uploaded_by: hh.uploadedBy,
                      uploaded_at: hh.uploadedAt,
                      itemName: item.itemName,
                      uniName: item.uniName,
                      remarks: hh.remarks,
                    })), i)}>
                    <EvidenceMedia
                      path={h.photoUrl}
                      contentType={h.contentType}
                      alt={`Upload ${i + 1}`}
                      controls={false}
                      muted
                      imageStyle={{ width: '80px', height: '56px', objectFit: 'cover', display: 'block' }}
                      videoStyle={{ width: '80px', height: '56px', objectFit: 'cover', display: 'block', background: '#000' }}
                    />
                    {i === 0 && <span style={{ position: 'absolute', top: '2px', left: '2px', background: 'var(--accent-primary)', color: 'white', fontSize: '0.52rem', fontWeight: 700, padding: '1px 4px', borderRadius: '999px' }}>LATEST</span>}
                  </div>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.6rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>{formatDateTime(h.uploadedAt)}</p>
                  {h.uploadedBy && <p style={{ margin: '0.1rem 0 0', fontSize: '0.62rem', color: 'var(--text-secondary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.uploadedBy}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EvidenceBoard() {
  const { authFetch } = useAuth();
  const [evidenceData, setEvidenceData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterDate, setFilterDate] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const [showOnlyWithPhotos, setShowOnlyWithPhotos] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [serverTotal, setServerTotal] = useState(0);

  const fetchEvidence = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCategory !== 'All') params.set('category', filterCategory);
      if (searchTerm) params.set('search', searchTerm);
      params.set('page', String(p));
      params.set('limit', '48');
      const resp = await authFetch(`/evidence?${params}`);
      // API now returns { data: [], total, page, pages, limit }
      const list = resp?.data ?? resp;
      setEvidenceData(Array.isArray(list) ? list : []);
      if (resp?.total !== undefined) {
        setServerTotal(resp.total);
        setTotalPages(resp.pages ?? 1);
        setPage(resp.page ?? p);
      }
    } catch (err) {
      console.error('Evidence fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [authFetch, filterCategory, searchTerm]);

  // Reset to page 1 when filters change, then fetch
  useEffect(() => { setPage(1); fetchEvidence(1); }, [filterCategory, searchTerm]); // eslint-disable-line
  useEffect(() => { fetchEvidence(1); }, []); // eslint-disable-line

  const categories = useMemo(() => ['All', ...new Set(evidenceData.map(e => e.category).filter(Boolean))], [evidenceData]);

  const filteredEvidence = useMemo(() => {
    return evidenceData.filter(e => {
      const matchCat = filterCategory === 'All' || e.category === filterCategory;
      const matchSearch = !searchTerm ||
        (e.itemName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (e.uniName || '').toLowerCase().includes(searchTerm.toLowerCase());
      let matchDate = true;
      if (filterDate && e.lastUpdated) {
        matchDate = new Date(e.lastUpdated).toDateString() === new Date(filterDate).toDateString();
      }
      const matchPhoto = !showOnlyWithPhotos || !!e.photoUrl;
      return matchCat && matchSearch && matchDate && matchPhoto;
    });
  }, [evidenceData, filterCategory, searchTerm, filterDate, showOnlyWithPhotos]);

  const withPhotos = evidenceData.filter(e => e.photoUrl).length;
  const withoutPhotos = evidenceData.length - withPhotos;
  const displayTotal = serverTotal || evidenceData.length;

  return (
    <div className="app-container fade-in" style={{ maxWidth: '1400px' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="page-title text-gradient" style={{ fontSize: '2rem', fontWeight: 900, marginBottom: '0.4rem' }}>
          Portfolio Evidence Board
        </h1>
        <p className="page-subtitle" style={{ opacity: 0.75, marginBottom: '1.25rem' }}>
          Visual proof of infrastructure readiness across all partner universities.
        </p>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          {[
            { label: 'Total Items', value: displayTotal, color: 'var(--accent-primary)' },
            { label: 'With Photos', value: withPhotos, color: '#10b981' },
            { label: 'Missing Photos', value: withoutPhotos, color: '#ef4444' },
            { label: 'Showing', value: filteredEvidence.length, color: '#f59e0b' },
          ].map(s => (
            <div key={s.label} className="glass-panel" style={{ padding: '0.75rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: '110px' }}>
              <p style={{ margin: 0, fontSize: '1.4rem', fontWeight: 900, color: s.color }}>{s.value}</p>
              <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div className="glass-panel" style={{ padding: '0.875rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input type="text" placeholder="Search university or item..." className="form-input"
              style={{ paddingLeft: '2.25rem', height: '38px' }}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchEvidence()} />
          </div>

          <select className="form-select" style={{ minWidth: '140px', height: '38px' }}
            value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
            {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Calendar size={14} style={{ color: 'var(--text-secondary)' }} />
            <input type="date" className="form-input" style={{ minWidth: '140px', height: '38px' }}
              value={filterDate} onChange={e => setFilterDate(e.target.value)} />
            {filterDate && (
              <button onClick={() => setFilterDate('')} className="button button-secondary" style={{ height: '38px', width: '38px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={14} />
              </button>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', userSelect: 'none' }}>
            <input type="checkbox" checked={showOnlyWithPhotos} onChange={e => setShowOnlyWithPhotos(e.target.checked)}
              style={{ accentColor: 'var(--accent-primary)', width: '15px', height: '15px' }} />
            Photos only
          </label>

          <button className="button button-secondary" onClick={fetchEvidence} disabled={loading}
            style={{ height: '38px', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            Refresh
          </button>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '5rem' }}>
          <Loader size={36} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-primary)' }} />
        </div>
      ) : filteredEvidence.length === 0 ? (
        <div className="glass-panel text-center" style={{ padding: '5rem' }}>
          <ImageIcon size={56} style={{ margin: '0 auto 1.5rem', opacity: 0.2 }} />
          <h3 className="page-title" style={{ marginBottom: '0.5rem' }}>No Evidence Found</h3>
          <p className="text-secondary">Upload photos from the checklist items to see them here.</p>
          {(filterCategory !== 'All' || filterDate || searchTerm || showOnlyWithPhotos) && (
            <button className="button button-secondary" style={{ marginTop: '1.5rem' }}
              onClick={() => { setFilterCategory('All'); setFilterDate(''); setSearchTerm(''); setShowOnlyWithPhotos(false); }}>
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '1.25rem' }}>
          {filteredEvidence.map((item, idx) => (
            <EvidenceCard
              key={item.id}
              item={item}
              onOpen={(imgs, startIdx) => setLightbox({ images: imgs, startIndex: startIdx })}
              allItems={filteredEvidence}
              myIndex={idx}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', marginTop: '2rem', flexWrap: 'wrap' }}>
          <button
            className="button button-secondary"
            onClick={() => { const p = Math.max(1, page - 1); setPage(p); fetchEvidence(p); }}
            disabled={page <= 1 || loading}
            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
          >
            ← Prev
          </button>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              const startPage = Math.max(1, Math.min(page - 3, totalPages - 6));
              const p = startPage + i;
              if (p > totalPages) return null;
              return (
                <button key={p}
                  onClick={() => { setPage(p); fetchEvidence(p); }}
                  style={{
                    padding: '0.5rem 0.85rem',
                    borderRadius: '8px',
                    border: p === page ? 'none' : '1px solid var(--border)',
                    background: p === page ? 'var(--accent-primary)' : 'white',
                    color: p === page ? 'white' : 'var(--text-primary)',
                    fontWeight: p === page ? 700 : 500,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    minWidth: '38px',
                  }}
                >{p}</button>
              );
            })}
          </div>
          <button
            className="button button-secondary"
            onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); fetchEvidence(p); }}
            disabled={page >= totalPages || loading}
            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
          >
            Next →
          </button>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Page {page} of {totalPages} ({displayTotal} total)
          </span>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          startIndex={lightbox.startIndex}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
