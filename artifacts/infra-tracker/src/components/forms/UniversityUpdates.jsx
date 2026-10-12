import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { PlusCircle, Calendar, User, MessageSquare, Loader, ChevronDown, ChevronUp, Edit2, Check, X, Camera, Image, ExternalLink, Plus } from 'lucide-react';
import { getImageUrl, markMediaPath, uploadMultipleFiles } from '../../utils/imageUtils';
import EvidenceMedia from '../EvidenceMedia';

const ACCEPTED_TYPES = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/x-msvideo,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.avi';
const EDIT_WINDOW_MS = 15 * 60 * 1000;

function MediaThumb({ file, onRemove }) {
  const isVideo = file.type.startsWith('video/');
  const [objUrl] = useState(() => URL.createObjectURL(file));
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div style={{ width: '72px', height: '56px', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isVideo
          ? <video src={objUrl} muted playsInline preload="metadata"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <img src={objUrl} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
      {onRemove && (
        <button type="button" onClick={onRemove}
          style={{ position: 'absolute', top: '-5px', right: '-5px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', width: '16px', height: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 5 }}>
          <X size={9} />
        </button>
      )}
      <p style={{ margin: '0.15rem 0 0', fontSize: '0.55rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '72px' }}>{file.name}</p>
    </div>
  );
}

function UpdateMedia({ imageUrl }) {
  let urls = [];
  if (!imageUrl) return null;
  try {
    const parsed = JSON.parse(imageUrl);
    urls = Array.isArray(parsed) ? parsed : [imageUrl];
  } catch {
    urls = [imageUrl];
  }

  return (
    <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
      {urls.map((url, idx) => {
        const src = getImageUrl(url);
        return (
          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <EvidenceMedia
              path={url}
              alt={`Daily update media ${idx + 1}`}
              controls
              preload="metadata"
              imageStyle={{ maxWidth: '240px', maxHeight: '160px', objectFit: 'contain', borderRadius: '6px', border: '1px solid var(--border)', display: 'block' }}
              videoStyle={{ width: 'min(420px, 100%)', maxHeight: '280px', objectFit: 'contain', borderRadius: '8px', border: '1px solid var(--border)', display: 'block', background: '#000' }}
            />
            <a href={src} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.65rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>
              <ExternalLink size={10} /> Open original
            </a>
          </div>
        );
      })}
    </div>
  );
}

export default function UniversityUpdates({ universityId }) {
  const { user, authFetch } = useAuth();
  const { loadUniversityDetail } = useData();
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newUpdate, setNewUpdate] = useState({ date: new Date().toISOString().split('T')[0], text: '' });
  const [expandedIds, setExpandedIds] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [now, setNow] = useState(Date.now());

  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(null);
  const fileInputId = `update-files-${universityId}`;

  useEffect(() => { fetchUpdates(); }, [universityId]); // eslint-disable-line

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const fetchUpdates = async () => {
    setLoading(true);
    try {
      const data = await authFetch(`/universities/${universityId}/updates`);
      setUpdates(data || []);
    } catch (err) {
      console.error('Failed to fetch updates:', err);
    } finally {
      setLoading(false);
    }
  };

  const addFiles = (incoming) => {
    const valid = Array.from(incoming).filter(f => {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const okExt = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'mp4', 'mov', 'avi'].includes(ext);
      const okType = f.type.startsWith('image/') || f.type.startsWith('video/');
      return okExt || okType;
    });
    if (!valid.length) return;
    setPendingFiles(prev => {
      const combined = [...prev, ...valid];
      return combined.slice(0, 20);
    });
  };

  const removeFile = (index) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newUpdate.text.trim()) return;
    setSubmitting(true);
    let imageUrl = null;

    if (pendingFiles.length > 0) {
      setUploadProgress(0);
      try {
        const progressMap = {};
        const results = await uploadMultipleFiles(
          pendingFiles, universityId, null, user?.name || 'Field Team',
          (index, pct) => {
            progressMap[index] = pct;
            const avg = Math.round(Object.values(progressMap).reduce((a, b) => a + b, 0) / pendingFiles.length);
            setUploadProgress(avg);
          }
        );
        const urls = results
          .filter(r => r.objectPath)
          .map(r => markMediaPath(r.objectPath, r.file));
        if (urls.length === 1) {
          imageUrl = urls[0];
        } else if (urls.length > 1) {
          imageUrl = JSON.stringify(urls);
        }
        const failed = results.filter(r => r.error).length;
        if (failed > 0 && urls.length === 0) {
          alert(`All ${failed} file(s) failed to upload. The update will be saved without media.`);
        } else if (failed > 0) {
          alert(`${urls.length} file(s) uploaded, ${failed} failed.`);
        }
      } catch (uploadErr) {
        console.error('Upload failed:', uploadErr);
        alert(`Upload failed: ${uploadErr.message}\n\nThe update will be saved without media.`);
      } finally {
        setUploadProgress(null);
      }
    }

    try {
      const data = await authFetch(`/universities/${universityId}/updates`, {
        method: 'POST',
        body: JSON.stringify({ content: newUpdate.text.trim(), tags: [], imageUrl }),
      });
      setUpdates(prev => [data, ...prev]);
      setNewUpdate({ date: new Date().toISOString().split('T')[0], text: '' });
      setPendingFiles([]);
      loadUniversityDetail(String(universityId), true).catch(() => {});
    } catch (err) {
      console.error('Failed to add update:', err);
      alert(`Failed to save update: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartEdit = (u) => {
    setEditingId(u.id);
    setEditText(u.content || u.update_text || '');
  };

  const handleCancelEdit = () => { setEditingId(null); setEditText(''); };

  const handleSaveEdit = async (updateId) => {
    if (!editText.trim()) return;
    setEditSaving(true);
    try {
      const updated = await authFetch(`/universities/${universityId}/updates/${updateId}`, {
        method: 'PUT',
        body: JSON.stringify({ content: editText.trim() }),
      });
      setUpdates(prev => prev.map(u => u.id === updateId ? { ...u, content: updated.content } : u));
      setEditingId(null);
      setEditText('');
      loadUniversityDetail(String(universityId), true).catch(() => {});
    } catch (err) {
      alert(err.message || 'Failed to save edit');
    } finally {
      setEditSaving(false);
    }
  };

  const isEditable = (u) => {
    if (!user || u.authorName !== user.name) return false;
    const ageMs = now - new Date(u.createdAt).getTime();
    return ageMs <= EDIT_WINDOW_MS;
  };

  const editMinutesLeft = (u) => {
    const ageMs = now - new Date(u.createdAt).getTime();
    return Math.max(0, Math.ceil((EDIT_WINDOW_MS - ageMs) / 60000));
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const groupByDate = (items) => {
    const groups = {};
    items.forEach(u => {
      const key = u.createdAt?.split('T')[0] || 'Unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(u);
    });
    return groups;
  };

  const grouped = groupByDate(updates);
  const isUploading = uploadProgress !== null;

  return (
    <div className="fade-in">
      {/* Add Form */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem', border: '1px solid rgba(59,130,246,0.2)' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <PlusCircle size={18} style={{ color: 'var(--accent-primary)' }} />
          Add Daily Update
        </h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: '0 0 180px' }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>
                <Calendar size={12} style={{ display: 'inline', marginRight: '0.25rem' }} /> Date
              </label>
              <input type="date" className="form-input" value={newUpdate.date}
                onChange={e => setNewUpdate(p => ({ ...p, date: e.target.value }))} required />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: '200px' }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>
                <User size={12} style={{ display: 'inline', marginRight: '0.25rem' }} /> Author
              </label>
              <input type="text" className="form-input" value={user?.name || ''} disabled style={{ opacity: 0.6 }} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" style={{ fontSize: '0.75rem' }}>
              <MessageSquare size={12} style={{ display: 'inline', marginRight: '0.25rem' }} /> Update / Progress Note *
            </label>
            <textarea className="form-textarea" rows={4} required
              placeholder="Describe today's progress, activities, issues, or next steps..."
              value={newUpdate.text} onChange={e => setNewUpdate(p => ({ ...p, text: e.target.value }))}
              style={{ fontSize: '0.9rem' }} />
          </div>

          {/* ── Always-present hidden file input — triggered by label ── */}
          <input
            id={fileInputId}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            disabled={isUploading || submitting}
            style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0, overflow: 'hidden', zIndex: -1 }}
            onChange={e => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ''; } }}
          />

          {/* Media attach area */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label className="form-label" style={{ fontSize: '0.75rem', margin: 0 }}>
                <Image size={12} style={{ display: 'inline', marginRight: '0.25rem' }} />
                Attach Photos / Videos <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(optional — up to 20)</span>
              </label>
              {pendingFiles.length > 0 && !isUploading && (
                <button type="button" onClick={() => setPendingFiles([])}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.2rem', padding: 0 }}>
                  <X size={12} /> Clear all
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {pendingFiles.map((f, i) => (
                <MediaThumb key={`${f.name}-${i}`} file={f}
                  onRemove={isUploading ? null : () => removeFile(i)} />
              ))}

              {/* Add / Choose button = label directly triggers input */}
              <label htmlFor={isUploading || submitting ? undefined : fileInputId}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                  cursor: isUploading || submitting ? 'not-allowed' : 'pointer',
                  padding: pendingFiles.length ? '0 0.4rem' : '0.5rem 0.875rem',
                  height: pendingFiles.length ? '56px' : 'auto',
                  width: pendingFiles.length ? '72px' : 'auto',
                  justifyContent: 'center',
                  fontSize: '0.85rem', fontWeight: 600,
                  border: pendingFiles.length ? '2px dashed var(--border)' : '1px solid var(--border)',
                  borderRadius: '6px',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                  userSelect: 'none',
                  flexShrink: 0,
                  opacity: isUploading || submitting ? 0.5 : 1,
                }}>
                {pendingFiles.length ? <Plus size={18} /> : <><Camera size={15} /> Choose Photos / Videos</>}
              </label>
            </div>

            {isUploading && (
              <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
                Uploading {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''}… {uploadProgress}%
                <div style={{ flex: 1, height: '4px', background: 'var(--border)', borderRadius: '2px' }}>
                  <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'var(--accent-primary)', borderRadius: '2px', transition: 'width 0.2s' }} />
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="button button-primary" disabled={submitting || isUploading}
              style={{ gap: '0.5rem', display: 'flex', alignItems: 'center' }}>
              {(submitting || isUploading) ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <PlusCircle size={16} />}
              {isUploading ? `Uploading… ${uploadProgress}%` : submitting ? 'Saving…' : 'Post Update'}
            </button>
          </div>
        </form>
      </div>

      {/* History */}
      <div>
        <h3 style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          History ({updates.length} updates)
        </h3>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <Loader size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-primary)' }} />
          </div>
        ) : updates.length === 0 ? (
          <div className="glass-panel text-center" style={{ padding: '3rem' }}>
            <MessageSquare size={40} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
            <p className="text-secondary">No updates yet. Post the first one above.</p>
          </div>
        ) : (
          Object.entries(grouped).map(([date, dayUpdates]) => (
            <div key={date} style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div style={{ padding: '0.3rem 0.875rem', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 700, color: 'white' }}>
                  {formatDate(date)}
                </div>
                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                <span className="text-secondary" style={{ fontSize: '0.72rem' }}>{dayUpdates.length} update{dayUpdates.length !== 1 ? 's' : ''}</span>
              </div>
              {dayUpdates.map(u => {
                const isExpanded = expandedIds[u.id];
                const text = u.content || u.update_text || '';
                const isLong = text.length > 200;
                const canEdit = isEditable(u);
                const minsLeft = canEdit ? editMinutesLeft(u) : 0;
                const isCurrentlyEditing = editingId === u.id;

                return (
                  <div key={u.id} className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '0.625rem', borderLeft: '3px solid var(--accent-primary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: 'white' }}>
                          {(u.authorName || 'T').charAt(0).toUpperCase()}
                        </div>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.85rem' }}>{u.authorName || 'Team'}</p>
                        {canEdit && !isCurrentlyEditing && (
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', background: 'rgba(59,130,246,0.08)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                            editable {minsLeft}m left
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                          {u.createdAt ? new Date(u.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                        {canEdit && !isCurrentlyEditing && (
                          <button onClick={() => handleStartEdit(u)}
                            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--accent-primary)', cursor: 'pointer', padding: '0.2rem 0.5rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Edit2 size={11} /> Edit
                          </button>
                        )}
                      </div>
                    </div>

                    {isCurrentlyEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <textarea className="form-textarea" rows={4} value={editText}
                          onChange={e => setEditText(e.target.value)}
                          style={{ fontSize: '0.875rem', lineHeight: 1.6 }} />
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button onClick={handleCancelEdit} className="button button-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <X size={13} /> Cancel
                          </button>
                          <button onClick={() => handleSaveEdit(u.id)} disabled={editSaving} className="button button-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            {editSaving ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={13} />}
                            {editSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflow: 'hidden', maxHeight: isLong && !isExpanded ? '4.5em' : 'none' }}>
                          {text}
                        </p>
                        {isLong && (
                          <button onClick={() => setExpandedIds(p => ({ ...p, [u.id]: !isExpanded }))}
                            style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '0.78rem', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem', padding: 0 }}>
                            {isExpanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Read more</>}
                          </button>
                        )}
                        {u.imageUrl && <UpdateMedia imageUrl={u.imageUrl} />}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
