import React, { useEffect, useCallback, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { X, ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { getImageUrl } from '../utils/imageUtils';
import EvidenceMedia from './EvidenceMedia';

/**
 * Full-screen image lightbox with:
 * - ESC / click-backdrop to close
 * - Prev / Next navigation (keyboard ← →)
 * - Pinch-to-zoom on mobile, scroll-zoom on desktop
 * - Swipe left/right on mobile to navigate
 * - Download button
 * - Metadata panel (uploadedBy, uploadedAt, itemName, uniName)
 */
export default function ImageLightbox({ images, startIndex = 0, onClose }) {
  const [idx, setIdx] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, panX: 0, panY: 0 });
  const touchRef = useRef({ touches: [], startIdx: 0, startX: 0 });
  const imgRef = useRef(null);

  const current = images?.[idx];
  const hasPrev = idx > 0;
  const hasNext = idx < (images?.length ?? 0) - 1;

  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);
  const prev = useCallback(() => { if (hasPrev) { setIdx(i => i - 1); resetZoom(); } }, [hasPrev, resetZoom]);
  const next = useCallback(() => { if (hasNext) { setIdx(i => i + 1); resetZoom(); } }, [hasNext, resetZoom]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, prev, next]);

  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  const handleScroll = (e) => {
    e.preventDefault();
    setZoom(z => Math.min(5, Math.max(1, z - e.deltaY * 0.002)));
    if (zoom <= 1) setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e) => {
    if (zoom <= 1) return;
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
  };
  const handleMouseMove = (e) => {
    if (!dragRef.current.dragging) return;
    setPan({ x: dragRef.current.panX + e.clientX - dragRef.current.startX, y: dragRef.current.panY + e.clientY - dragRef.current.startY });
  };
  const handleMouseUp = () => { dragRef.current.dragging = false; };

  const handleTouchStart = (e) => {
    const touches = Array.from(e.touches);
    touchRef.current = { touches, startIdx: idx, startX: touches[0]?.clientX ?? 0, startY: touches[0]?.clientY ?? 0 };
  };
  const handleTouchEnd = (e) => {
    if (touchRef.current.touches.length !== 1) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchRef.current.startX;
    const dy = Math.abs((e.changedTouches[0]?.clientY ?? 0) - touchRef.current.startY);
    if (Math.abs(dx) > 60 && dy < 60 && zoom <= 1) {
      if (dx < 0) next();
      else prev();
    }
  };

  const handleDownload = () => {
    const url = getImageUrl(current?.photoUrl || current?.photo_url || current?.src);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = url.split('/').pop() || 'evidence.jpg';
    a.click();
  };

  const formatTs = (ts) => ts
    ? new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  if (!current) return null;
  const src = getImageUrl(current.photoUrl || current.photo_url || current.src);
  const uploadedBy = current.uploadedBy || current.uploaded_by || '';
  const uploadedAt = current.uploadedAt || current.uploaded_at || current.lastUpdated || '';
  const label = current.itemName || current.label || '';
  const uniName = current.uniName || current.universityName || '';
  const remarks = current.remarks || '';
  const total = images?.length ?? 1;

  const content = (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.96)' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      role="dialog"
      aria-modal="true"
      aria-label={label ? `Attachment viewer: ${label}` : 'Attachment viewer'}
    >
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.6)', flexShrink: 0, gap: '1rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {label && <p style={{ margin: 0, fontWeight: 700, color: 'white', fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</p>}
          {uniName && <p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem' }}>{uniName}</p>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          {total > 1 && <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', fontWeight: 600 }}>{idx + 1} / {total}</span>}
          <button onClick={() => setZoom(z => Math.min(5, z + 0.5))} title="Zoom in" aria-label="Zoom in" style={iconBtn}><ZoomIn size={17} /></button>
          <button onClick={() => setZoom(z => Math.max(1, z - 0.5))} title="Zoom out" aria-label="Zoom out" style={iconBtn}><ZoomOut size={17} /></button>
          <button onClick={resetZoom} title="Reset zoom" aria-label="Reset zoom" style={iconBtn}><RotateCcw size={17} /></button>
          <button onClick={handleDownload} title="Download" aria-label="Download attachment" style={iconBtn}><Download size={17} /></button>
          <button onClick={onClose} title="Close (Esc)" aria-label="Close attachment viewer" style={{ ...iconBtn, background: 'rgba(239,68,68,0.25)', color: '#fca5a5' }}><X size={18} /></button>
        </div>
      </div>

      {/* Image area */}
      <div
        style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: zoom > 1 ? 'grab' : 'default' }}
        onWheel={handleScroll}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={(e) => { if (e.target === e.currentTarget && zoom <= 1) onClose(); }}
      >
        <EvidenceMedia
          key={current.id ?? src}
          path={current.photoUrl || current.photo_url || current.src}
          contentType={current.contentType || current.content_type}
          alt={label || 'Evidence'}
          controls
          videoStyle={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: '6px', background: '#000' }}
          imageStyle={{
            maxWidth: zoom > 1 ? 'none' : '90vw',
            maxHeight: zoom > 1 ? 'none' : '80vh',
            width: zoom > 1 ? `${zoom * 100}%` : 'auto',
            objectFit: 'contain',
            borderRadius: '6px',
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            transition: dragRef.current.dragging ? 'none' : 'transform 0.1s ease',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
          onImageError={e => { e.currentTarget.alt = 'Evidence unavailable'; }}
        />

        {/* Prev / Next */}
        {hasPrev && (
          <button onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="Previous attachment" style={navBtn('left')}>
            <ChevronLeft size={28} />
          </button>
        )}
        {hasNext && (
          <button onClick={(e) => { e.stopPropagation(); next(); }} aria-label="Next attachment" style={navBtn('right')}>
            <ChevronRight size={28} />
          </button>
        )}
      </div>

      {/* Bottom metadata bar */}
      {(uploadedBy || uploadedAt || remarks) && (
        <div style={{ padding: '0.6rem 1.25rem', background: 'rgba(0,0,0,0.6)', display: 'flex', flexWrap: 'wrap', gap: '1.25rem', flexShrink: 0, alignItems: 'center' }}>
          {uploadedBy && (
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.78rem' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', marginRight: '0.4rem' }}>By</span>
              <strong style={{ color: 'white' }}>{uploadedBy}</strong>
            </span>
          )}
          {uploadedAt && (
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.78rem' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', marginRight: '0.4rem' }}>At</span>
              {formatTs(uploadedAt)}
            </span>
          )}
          {remarks && (
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.78rem', fontStyle: 'italic' }}>"{remarks}"</span>
          )}
        </div>
      )}

      {/* Thumbnail strip (when > 1 image) */}
      {total > 1 && (
        <div style={{ display: 'flex', gap: '0.4rem', padding: '0.5rem 1rem', background: 'rgba(0,0,0,0.7)', overflowX: 'auto', flexShrink: 0, justifyContent: total <= 8 ? 'center' : 'flex-start' }}>
          {images.map((img, i) => {
            return (
              <button key={img.id ?? i} onClick={() => { setIdx(i); resetZoom(); }}
                style={{ flexShrink: 0, width: '52px', height: '40px', borderRadius: '5px', overflow: 'hidden', border: i === idx ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.1)', padding: 0, background: 'rgba(255,255,255,0.05)', cursor: 'pointer', transition: 'border-color 0.2s' }}>
                <EvidenceMedia
                  path={img.photoUrl || img.photo_url || img.src}
                  contentType={img.contentType || img.content_type}
                  alt=""
                  controls={false}
                  muted
                  imageStyle={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  videoStyle={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}

const iconBtn = {
  background: 'rgba(255,255,255,0.12)',
  border: 'none',
  color: 'rgba(255,255,255,0.85)',
  width: '34px',
  height: '34px',
  borderRadius: '8px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s',
};

const navBtn = (side) => ({
  position: 'absolute',
  [side]: '1rem',
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'rgba(255,255,255,0.12)',
  border: 'none',
  color: 'white',
  width: '48px',
  height: '48px',
  borderRadius: '50%',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backdropFilter: 'blur(8px)',
  transition: 'background 0.2s',
  zIndex: 2,
});
