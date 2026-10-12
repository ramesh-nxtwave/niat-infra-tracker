import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { PlusCircle, Loader, CheckCircle2, Clock, AlertCircle, Trash2, Calendar, Edit2, Check, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const STATUS_CONFIG = {
  open: { label: 'Open', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', icon: <Clock size={12} /> },
  in_progress: { label: 'In Progress', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: <AlertCircle size={12} /> },
  resolved: { label: 'Resolved', color: '#10b981', bg: 'rgba(16,185,129,0.1)', icon: <CheckCircle2 size={12} /> },
};

export default function ActionItems({ universityId }) {
  const { user, authFetch } = useAuth();
  const { showToast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newItem, setNewItem] = useState({ content: '', dueDate: '' });
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => { fetchItems(); }, [universityId]); // eslint-disable-line

  const fetchItems = async () => {
    setLoading(true);
    try {
      const data = await authFetch(`/universities/${universityId}/action-items`);
      setItems(data || []);
    } catch (err) {
      console.error('Failed to fetch action items:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newItem.content.trim()) return;
    setSubmitting(true);
    try {
      const created = await authFetch(`/universities/${universityId}/action-items`, {
        method: 'POST',
        body: JSON.stringify({ content: newItem.content.trim(), dueDate: newItem.dueDate || null }),
      });
      setItems(prev => [created, ...prev]);
      setNewItem({ content: '', dueDate: '' });
      showToast('Action item added', 'success');
    } catch (err) {
      showToast('Failed to add action item', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (itemId, status) => {
    try {
      const updated = await authFetch(`/universities/${universityId}/action-items/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      setItems(prev => prev.map(i => i.id === itemId ? updated : i));
    } catch (err) {
      showToast('Failed to update status', 'error');
    }
  };

  const handleStartEdit = (item) => {
    setEditingId(item.id);
    setEditData({ content: item.content, dueDate: item.dueDate || '' });
  };

  const handleSaveEdit = async (itemId) => {
    if (!editData.content?.trim()) return;
    try {
      const updated = await authFetch(`/universities/${universityId}/action-items/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify({ content: editData.content.trim(), dueDate: editData.dueDate || null }),
      });
      setItems(prev => prev.map(i => i.id === itemId ? updated : i));
      setEditingId(null);
    } catch (err) {
      showToast('Failed to save', 'error');
    }
  };

  const handleDelete = async (itemId) => {
    setDeletingId(itemId);
    try {
      await authFetch(`/universities/${universityId}/action-items/${itemId}`, { method: 'DELETE' });
      setItems(prev => prev.filter(i => i.id !== itemId));
    } catch (err) {
      showToast('Failed to delete', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const openItems = items.filter(i => i.status !== 'resolved');
  const resolvedItems = items.filter(i => i.status === 'resolved');
  const [showResolved, setShowResolved] = useState(false);

  return (
    <div className="fade-in">
      {/* Add Form */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem', border: '1px solid rgba(59,130,246,0.2)' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <PlusCircle size={18} style={{ color: 'var(--accent-primary)' }} /> Add Action Item
        </h3>
        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <textarea className="form-textarea" rows={2} required
              placeholder="Describe the action item — who does what by when..."
              value={newItem.content}
              onChange={e => setNewItem(p => ({ ...p, content: e.target.value }))}
              style={{ fontSize: '0.9rem' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0, flex: '0 0 180px' }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>
                <Calendar size={12} style={{ display: 'inline', marginRight: '0.25rem' }} /> Due Date (optional)
              </label>
              <input type="date" className="form-input"
                value={newItem.dueDate}
                onChange={e => setNewItem(p => ({ ...p, dueDate: e.target.value }))} />
            </div>
            <button type="submit" className="button button-primary" disabled={submitting}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {submitting ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <PlusCircle size={16} />}
              {submitting ? 'Adding…' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>

      {/* Open Items */}
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.875rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Active Items ({openItems.length})
        </h3>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <Loader size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-primary)' }} />
          </div>
        ) : openItems.length === 0 ? (
          <div className="glass-panel text-center" style={{ padding: '2rem' }}>
            <CheckCircle2 size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.3, color: '#10b981' }} />
            <p className="text-secondary" style={{ fontSize: '0.9rem' }}>No open action items. Add one above.</p>
          </div>
        ) : (
          openItems.map(item => <ActionItemCard key={item.id} item={item} editingId={editingId} editData={editData}
            setEditData={setEditData} deletingId={deletingId}
            onEdit={handleStartEdit} onSaveEdit={handleSaveEdit} onCancelEdit={() => setEditingId(null)}
            onStatusChange={handleStatusChange} onDelete={handleDelete} />)
        )}
      </div>

      {/* Resolved Items */}
      {resolvedItems.length > 0 && (
        <div>
          <button onClick={() => setShowResolved(p => !p)}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: 0 }}>
            <CheckCircle2 size={14} style={{ color: '#10b981' }} />
            Resolved ({resolvedItems.length}) {showResolved ? '▲' : '▼'}
          </button>
          {showResolved && resolvedItems.map(item => <ActionItemCard key={item.id} item={item} editingId={editingId} editData={editData}
            setEditData={setEditData} deletingId={deletingId}
            onEdit={handleStartEdit} onSaveEdit={handleSaveEdit} onCancelEdit={() => setEditingId(null)}
            onStatusChange={handleStatusChange} onDelete={handleDelete} />)}
        </div>
      )}
    </div>
  );
}

function ActionItemCard({ item, editingId, editData, setEditData, deletingId, onEdit, onSaveEdit, onCancelEdit, onStatusChange, onDelete }) {
  const { user } = useAuth();
  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.open;
  const isEditing = editingId === item.id;
  const isDeleting = deletingId === item.id;
  const isResolved = item.status === 'resolved';

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const isOverdue = item.dueDate && item.status !== 'resolved' && new Date(item.dueDate) < new Date();

  return (
    <div className="glass-panel" style={{
      padding: '1rem 1.25rem', marginBottom: '0.625rem',
      borderLeft: `3px solid ${cfg.color}`,
      opacity: isResolved ? 0.65 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ flex: 1 }}>
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <textarea className="form-textarea" rows={2} value={editData.content}
                onChange={e => setEditData(p => ({ ...p, content: e.target.value }))}
                style={{ fontSize: '0.875rem' }} />
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input type="date" className="form-input" style={{ flex: '0 0 160px', padding: '0.35rem' }}
                  value={editData.dueDate}
                  onChange={e => setEditData(p => ({ ...p, dueDate: e.target.value }))} />
                <button onClick={() => onSaveEdit(item.id)} className="button button-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'flex', gap: '0.25rem' }}>
                  <Check size={13} /> Save
                </button>
                <button onClick={onCancelEdit} className="button button-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'flex', gap: '0.25rem' }}>
                  <X size={13} /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p style={{ margin: '0 0 0.35rem', fontSize: '0.9rem', lineHeight: 1.5, textDecoration: isResolved ? 'line-through' : 'none', color: isResolved ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                {item.content}
              </p>
              <div style={{ display: 'flex', gap: '0.875rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>By {item.authorName}</span>
                {item.dueDate && (
                  <span style={{ fontSize: '0.72rem', color: isOverdue ? '#ef4444' : 'var(--text-secondary)', fontWeight: isOverdue ? 700 : 400, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Calendar size={11} /> Due {formatDate(item.dueDate)} {isOverdue && '⚠ Overdue'}
                  </span>
                )}
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  Added {new Date(item.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </span>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          {/* Status selector */}
          <select
            value={item.status}
            onChange={e => onStatusChange(item.id, e.target.value)}
            style={{
              background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40`,
              borderRadius: '6px', padding: '0.25rem 0.5rem', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer'
            }}>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>

          {!isEditing && (
            <button onClick={() => onEdit(item)}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--accent-primary)', cursor: 'pointer', padding: '0.25rem 0.4rem', display: 'flex', alignItems: 'center' }}>
              <Edit2 size={12} />
            </button>
          )}

          {(user?.role === 'admin' || user?.role === 'zonal_manager') && (
            <button onClick={() => onDelete(item.id)} disabled={isDeleting}
              style={{ background: 'none', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', padding: '0.25rem 0.4rem', display: 'flex', alignItems: 'center', opacity: isDeleting ? 0.5 : 1 }}>
              {isDeleting ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={12} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
