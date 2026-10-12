import React, { useState } from 'react';
import { useAuth, ZONES } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { Users, Shield, MapPin, Building2, Edit, Trash2, Plus, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';

export default function AccessManagement() {
  const { user: currentUser, users, refreshUsers, createUser, updateUser, deleteUser } = useAuth();
  const { universities, loading: dataLoading } = useData();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    name: '', email: '', password: '', role: 'apm', zoneIds: '', universityIds: '', isActive: true,
  });
  const [saving, setSaving] = useState(false);

  if (currentUser?.role !== 'admin') {
    return (
      <div className="app-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Shield size={48} className="text-danger mb-4" />
        <h2 className="text-xl font-bold">Unauthorized Access</h2>
        <p className="text-secondary">Only system administrators can access personnel management.</p>
      </div>
    );
  }

  const getZoneName = (zoneIds) => {
    const ids = Array.isArray(zoneIds) ? zoneIds : [];
    if (!ids.length) return 'No Zones Assigned';
    return ids.map(id => ZONES[id]?.name?.split('—')[0]?.trim() || `Zone ${id}`).join(', ');
  };

  const getUniNames = (ids) => {
    if (!ids?.length) return 'No Universities Assigned';
    return ids.map(id => universities.find(u => String(u.id) === String(id))?.name || `ID: ${id}`).join(', ');
  };

  const parseIds = (str) =>
    String(str || '').split(',').map(s => s.trim()).filter(Boolean);

  const handleOpenModal = (user = null) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        name: user.name || '',
        email: user.email || '',
        password: '',
        role: user.role || 'apm',
        zoneIds: (user.zoneIds || []).join(', '),
        universityIds: (user.universityIds || []).join(', '),
        isActive: user.isActive !== false,
      });
    } else {
      setEditingUser(null);
      setFormData({ name: '', email: '', password: '', role: 'apm', zoneIds: '', universityIds: '', isActive: true });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => { setIsModalOpen(false); setEditingUser(null); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        email: formData.email,
        role: formData.role,
        isActive: formData.isActive,
        zoneIds: formData.role === 'zonal_manager'
          ? parseIds(formData.zoneIds).map(Number).filter(n => !isNaN(n))
          : [],
        universityIds: formData.role === 'apm'
          ? parseIds(formData.universityIds)
          : [],
      };
      if (formData.password) payload.password = formData.password;

      if (editingUser) {
        await updateUser(editingUser.id, payload);
        showToast('User updated successfully', 'success');
      } else {
        if (!formData.password) { showToast('Password is required for new users', 'error'); return; }
        payload.password = formData.password;
        await createUser(payload);
        showToast('User created successfully', 'success');
      }
      handleCloseModal();
    } catch (err) {
      showToast(err.message || 'Error saving user', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await confirm('Delete User', 'Are you sure you want to delete this user? This cannot be undone.', { confirmLabel: 'Delete' });
    if (!confirmed) return;
    try {
      await deleteUser(id);
      showToast('User deleted', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to delete user', 'error');
    }
  };

  const toggleActive = async (user) => {
    try {
      await updateUser(user.id, { isActive: !user.isActive });
      showToast(`User ${!user.isActive ? 'activated' : 'deactivated'}`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update status', 'error');
    }
  };

  const roleColors = { admin: '#ef4444', zonal_manager: '#3b82f6', apm: '#10b981', ops: '#f59e0b' };

  return (
    <div className="app-container fade-in" style={{ paddingBottom: '3rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '2.5rem' }}>
        <div>
          <h1 className="page-title text-gradient" style={{ fontSize: '2.2rem', fontWeight: 900, marginBottom: '0.5rem' }}>Access Management</h1>
          <p className="text-secondary">Manage personnel, roles, and access permissions.</p>
        </div>
        <button className="button button-primary" onClick={() => handleOpenModal()}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Plus size={18} /> Add Personnel
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Total Users', value: users.length, icon: <Users size={20} /> },
          { label: 'Admins', value: users.filter(u => u.role === 'admin').length, icon: <Shield size={20} /> },
          { label: 'Zonal Managers', value: users.filter(u => u.role === 'zonal_manager').length, icon: <MapPin size={20} /> },
          { label: 'APMs', value: users.filter(u => u.role === 'apm').length, icon: <Building2 size={20} /> },
        ].map(stat => (
          <div key={stat.label} className="glass-panel" style={{ padding: '1.25rem', textAlign: 'center' }}>
            <div style={{ color: 'var(--accent-primary)', marginBottom: '0.5rem', display: 'flex', justifyContent: 'center' }}>{stat.icon}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{stat.value}</div>
            <div className="text-secondary" style={{ fontSize: '0.75rem' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Name & Email', 'Role', 'Access Scope', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '1rem', textAlign: 'left', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} style={{ borderBottom: '1px solid var(--border)', opacity: user.isActive ? 1 : 0.5 }}>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: `linear-gradient(135deg, ${roleColors[user.role] || '#666'}, #1e293b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0 }}>
                        {(user.name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>{user.name}</p>
                        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ background: `${roleColors[user.role] || '#666'}20`, color: roleColors[user.role] || '#666', border: `1px solid ${roleColors[user.role] || '#666'}40`, padding: '0.3rem 0.75rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' }}>
                      {user.role?.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    {user.role === 'admin' && <span className="text-success text-sm font-semibold" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Shield size={13} /> Full Access</span>}
                    {user.role === 'zonal_manager' && <span style={{ fontSize: '0.8rem' }}>{getZoneName(user.zoneIds)}</span>}
                    {user.role === 'apm' && <span style={{ fontSize: '0.8rem' }}>{getUniNames(user.universityIds)}</span>}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <button onClick={() => toggleActive(user)}
                      style={{ background: user.isActive ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: user.isActive ? '#10b981' : '#ef4444', border: `1px solid ${user.isActive ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`, padding: '0.3rem 0.75rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="button button-secondary" style={{ padding: '0.5rem' }} onClick={() => handleOpenModal(user)} title="Edit">
                        <Edit size={15} />
                      </button>
                      {user.id !== currentUser?.id && (
                        <button className="button button-secondary" style={{ padding: '0.5rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.2)' }} onClick={() => handleDelete(user.id)} title="Delete">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No users found. Add personnel above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '5rem', overflowY: 'auto' }}>
          <div className="glass-panel fade-in" style={{ background: 'var(--bg-secondary)', position: 'relative', width: '100%', maxWidth: '42rem', margin: '0 1rem 3rem', padding: '2rem', borderRadius: '24px' }}>
            <button onClick={handleCloseModal} style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            <h2 style={{ marginBottom: '1.5rem', paddingRight: '2rem' }}>{editingUser ? 'Edit Personnel' : 'Add New Personnel'}</h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Name</label>
                  <input type="text" className="form-input" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input type="email" className="form-input" required value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select className="form-select" value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })}>
                    <option value="apm">APM (University Level)</option>
                    <option value="zonal_manager">Zonal Manager (Zone Level)</option>
                    <option value="admin">Admin (Full Access)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Password {editingUser && <span className="text-secondary">(leave blank to keep current)</span>}</label>
                  <input type="password" className="form-input" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })}
                    placeholder={editingUser ? 'Leave blank to keep unchanged' : 'Required'} required={!editingUser} />
                </div>
              </div>

              {formData.role === 'zonal_manager' && (
                <div className="form-group">
                  <label className="form-label">Assigned Zones</label>
                  <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.5rem', background: 'var(--bg-primary)' }}>
                    {Object.entries(ZONES).map(([id, z]) => {
                      const selectedIds = parseIds(formData.zoneIds);
                      const isSelected = selectedIds.includes(String(id));
                      return (
                        <label key={id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', borderRadius: '8px', cursor: 'pointer', background: isSelected ? 'var(--bg-secondary)' : 'transparent' }}>
                          <input type="checkbox" checked={isSelected} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-primary)' }}
                            onChange={() => {
                              const newIds = isSelected ? selectedIds.filter(v => v !== String(id)) : [...selectedIds, String(id)];
                              setFormData({ ...formData, zoneIds: newIds.join(', ') });
                            }} />
                          <span style={{ fontSize: '0.9rem' }}>{z.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {formData.role === 'apm' && (
                <div className="form-group">
                  <label className="form-label">Assigned Universities</label>
                  <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.5rem', background: 'var(--bg-primary)' }}>
                    {dataLoading ? <p className="text-secondary text-sm p-2">Loading universities...</p> : (
                      universities.map(uni => {
                        const selectedIds = parseIds(formData.universityIds);
                        const isSelected = selectedIds.includes(String(uni.id));
                        return (
                          <label key={uni.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', borderRadius: '8px', cursor: 'pointer', background: isSelected ? 'var(--bg-secondary)' : 'transparent' }}>
                            <input type="checkbox" checked={isSelected} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-primary)' }}
                              onChange={() => {
                                const newIds = isSelected ? selectedIds.filter(v => v !== String(uni.id)) : [...selectedIds, String(uni.id)];
                                setFormData({ ...formData, universityIds: newIds.join(', ') });
                              }} />
                            <span style={{ fontSize: '0.9rem', flex: 1 }}>{uni.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {editingUser && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={formData.isActive} onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-primary)' }} />
                  <span style={{ fontWeight: 700, color: formData.isActive ? '#10b981' : '#ef4444' }}>
                    {formData.isActive ? 'Active Account' : 'Deactivated / Suspended'}
                  </span>
                </label>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="button" className="button button-secondary" onClick={handleCloseModal}>Cancel</button>
                <button type="submit" className="button button-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
