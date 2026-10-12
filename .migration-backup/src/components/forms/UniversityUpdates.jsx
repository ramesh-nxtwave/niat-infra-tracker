import React, { useState, useEffect } from 'react';
import { supabase } from '../../config/supabase';
import { useAuth } from '../../context/AuthContext';
import { PlusCircle, Calendar, User, MessageSquare, Loader, ChevronDown, ChevronUp } from 'lucide-react';

export default function UniversityUpdates({ universityId }) {
  const { user } = useAuth();
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newUpdate, setNewUpdate] = useState({ date: new Date().toISOString().split('T')[0], text: '' });
  const [expandedIds, setExpandedIds] = useState({});

  useEffect(() => {
    fetchUpdates();
  }, [universityId]);

  const fetchUpdates = async () => {
    setLoading(true);
    try {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('university_updates')
        .select('*')
        .eq('university_id', universityId)
        .order('update_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      setUpdates(data || []);
    } catch (err) {
      console.error('Failed to fetch updates:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newUpdate.text.trim()) return;
    setSubmitting(true);
    try {
      if (!supabase) throw new Error('Supabase not initialised');
      const { data, error } = await supabase
        .from('university_updates')
        .insert([{
          university_id: universityId,
          update_date: newUpdate.date,
          update_text: newUpdate.text.trim(),
          author_name: user?.name || 'Team',
          author_email: user?.email || '',
        }])
        .select()
        .single();
      if (error) throw error;
      setUpdates(prev => [data, ...prev]);
      setNewUpdate({ date: new Date().toISOString().split('T')[0], text: '' });
    } catch (err) {
      console.error('Failed to add update:', err);
      alert(`Failed to save update: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const groupByDate = (items) => {
    const groups = {};
    items.forEach(u => {
      const key = u.update_date || u.created_at?.split('T')[0] || 'Unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(u);
    });
    return groups;
  };

  const grouped = groupByDate(updates);

  return (
    <div className="fade-in">
      {/* Add Update Form */}
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
              <input
                type="date"
                className="form-input"
                value={newUpdate.date}
                onChange={e => setNewUpdate(p => ({ ...p, date: e.target.value }))}
                required
              />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: '200px' }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>
                <User size={12} style={{ display: 'inline', marginRight: '0.25rem' }} /> Author
              </label>
              <input
                type="text"
                className="form-input"
                value={user?.name || ''}
                disabled
                style={{ opacity: 0.6 }}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" style={{ fontSize: '0.75rem' }}>
              <MessageSquare size={12} style={{ display: 'inline', marginRight: '0.25rem' }} /> Update / Progress Note *
            </label>
            <textarea
              className="form-textarea"
              rows={4}
              required
              placeholder="Describe today's progress, activities, issues, or next steps..."
              value={newUpdate.text}
              onChange={e => setNewUpdate(p => ({ ...p, text: e.target.value }))}
              style={{ fontSize: '0.9rem' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="button button-primary" disabled={submitting} style={{ gap: '0.5rem' }}>
              {submitting ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <PlusCircle size={16} />}
              {submitting ? 'Saving…' : 'Post Update'}
            </button>
          </div>
        </form>
      </div>

      {/* Updates Timeline */}
      <div>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.8rem' }}>
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
              {/* Date badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div style={{ padding: '0.3rem 0.875rem', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 700, color: 'white' }}>
                  {formatDate(date)}
                </div>
                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                <span className="text-secondary" style={{ fontSize: '0.72rem' }}>{dayUpdates.length} update{dayUpdates.length !== 1 ? 's' : ''}</span>
              </div>

              {dayUpdates.map(u => {
                const isExpanded = expandedIds[u.id];
                const isLong = u.update_text.length > 200;
                return (
                  <div key={u.id} className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '0.625rem', borderLeft: '3px solid var(--accent-primary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: 'white' }}>
                          {(u.author_name || 'T').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.85rem' }}>{u.author_name || 'Team'}</p>
                          {u.author_email && <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{u.author_email}</p>}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        {u.created_at ? new Date(u.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflow: 'hidden', maxHeight: isLong && !isExpanded ? '4.5em' : 'none' }}>
                      {u.update_text}
                    </p>
                    {isLong && (
                      <button
                        onClick={() => setExpandedIds(p => ({ ...p, [u.id]: !isExpanded }))}
                        style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '0.78rem', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem', padding: 0 }}
                      >
                        {isExpanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Read more</>}
                      </button>
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
